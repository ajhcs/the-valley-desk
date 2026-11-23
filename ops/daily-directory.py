"""Collect and load The Valley Desk's daily public directory changes."""

import argparse
from collections import Counter
from datetime import date, datetime, timedelta
import fcntl
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit
from uuid import uuid4
from zoneinfo import ZoneInfo

from daily_d1 import (
    D1, INBOX, KINDS, LISTINGS, PROJECTS, REMOVALS, command, compact, live_checks, quote, save, snapshot,
)
from daily_public_sources import collect_publications, discover_projects, qualify_repository, refresh_projects, roster_from_public
from daily_notify import queue
import daily_datasets

NY = ZoneInfo("America/New_York")
ROOT = Path(__file__).resolve().parents[1]
LEGACY = Path("/workspace/build/builderbob/tvd-weekly-publications")
READY = "SELECT enabled FROM study_visibility WHERE id=1"
INBOX_TABLE = "SELECT name FROM sqlite_master WHERE type='table' AND name='reader_inbox'"
GITHUB = re.compile(r"/([A-Za-z0-9-]{1,39})/([A-Za-z0-9_.-]{1,100})/?")
NCT = re.compile(r"/study/(NCT[0-9]{8})/?", re.I)


class StopRun(Exception):
    pass


def write_rows(path, rows):
    with path.open("w", encoding="utf-8") as output:
        for row in rows:
            output.write(compact(row) + "\n")


def material(record):
    return {k: v for k, v in record.items() if k != "checked" and v is not None}


SEMANTIC_FIELDS = {
    "name": ("name", "title"), "purpose": ("purpose",),
    "institution": ("institution", "institutions"), "county": ("county", "counties"),
    "label": ("label",), "topic": ("topic",), "license": ("license",),
    "language": ("language",), "archived": ("archived",),
}


def semantic_changes(before, after):
    return {name for name, fields in SEMANTIC_FIELDS.items()
            if any(before.get(field) != after.get(field) for field in fields)}


def changes(previous, candidates, removed, skipped):
    accepted = {}
    semantic = metadata_only = 0
    fields, metadata_fields = Counter(), Counter()
    for row in candidates:
        identifier = row["id"]
        if identifier in removed or identifier in previous and material(previous[identifier]) == material(row):
            skipped += 1
        elif identifier in accepted:
            raise StopRun("Duplicate change candidate")
        else:
            accepted[identifier] = {**row, "added": previous.get(identifier, row).get("added") or row.get("added") or ""}
            if identifier in previous:
                changed_fields = semantic_changes(previous[identifier], row)
                fields.update(changed_fields)
                guarded_fields = {field for names in SEMANTIC_FIELDS.values() for field in names}
                metadata_fields.update(field for field in set(previous[identifier]) | set(row)
                                       if field not in guarded_fields and field != "checked"
                                       and previous[identifier].get(field) != row.get(field))
                semantic += bool(changed_fields)
                metadata_only += not changed_fields
    added = sum(identifier not in previous for identifier in accepted)
    return accepted, {"added": added, "changed": len(accepted) - added, "semantic_changed": semantic,
                      "metadata_only": metadata_only, "semantic_fields": dict(fields), "metadata_fields": dict(metadata_fields),
                      "removed": 0, "skipped": skipped}


def gate(kind, previous, result):
    affected = result["added"] + result["semantic_changed"] + result["removed"]
    if result["removed"] > 25:
        raise StopRun(f"{kind} would remove {result['removed']:,} listings (limit 25)")
    if affected * 20 > len(previous):
        raise StopRun(f"{kind} would add, materially change or remove {affected:,} of {len(previous):,} listings (limit 5%)")


def studies(run_dir, previous, day):
    source = run_dir / "clinical"
    source.mkdir(mode=0o700)
    prior = source / "previous.jsonl"
    write_rows(prior, previous.values())
    result = json.loads(command(ROOT, sys.executable, "scripts/trials/collect.py", str(source),
                                "--previous", str(prior), "--date", day, "--verify-missing", label="ClinicalTrials.gov collector",
                                timeout=2400))
    with (source / "clinical-studies.jsonl").open(encoding="utf-8") as stream:
        rows = [json.loads(line) for line in stream]
    outside = set(result["confirmed_outside"])
    return rows, result["candidates"] - len(rows), outside, result["previous_missing"] - len(outside)


def inbox(d1, state, run_dir, day, records, removed, dataset_suggestions=None):
    """Reader text stays in D1. Visit only canonical registry identities and GitHub repos."""
    projects = records["project"]
    by_code = {row["code"].casefold().rstrip("/"): row for row in projects.values()}
    roster = roster_from_public(projects, ROOT)
    publications = {row["id"]: row["id"] for row in records["publication"].values()}
    for row in records["publication"].values():
        for field in ("doi", "pmid"):
            if row.get(field):
                publications[field + ":" + str(row[field])] = row["id"]
    additions, decisions = {}, []
    suggested_papers = {}
    for entry in d1.inbox():
        row_id = int(entry["id"])
        if entry["kind"] == "feedback":
            decisions.append((row_id, "reviewed", "Page feedback reviewed.", None))
            continue
        if entry["item_type"] == "dataset":
            if dataset_suggestions is not None:
                identifier = daily_datasets.suggestion_identifier(entry)
                dataset_suggestions.append((row_id, identifier))
            else:
                decisions.append((row_id, "declined", "Outside the current directory listing kinds.", None))
            continue
        try:
            raw = entry.get("url") or ""
            source = urlsplit(raw) if len(raw) < 2048 else urlsplit("")
        except ValueError:
            source = urlsplit("")
        host = source.netloc if source.scheme == "https" else ""
        kind, identifier, note = None, None, "No qualifying public source could be confirmed."
        github = GITHUB.fullmatch(source.path) if host == "github.com" else None
        if github and github[2] not in (".", "..") and entry["item_type"] in ("software", "tool", "other"):
            kind = "project"
            url = "https://github.com/" + "/".join(github.groups())
            result = by_code.get(url.casefold())
            if result is None:
                result, _ = qualify_repository(url, ROOT, day, roster.get(github[1].casefold()))
                if result is not None and result["id"] not in removed["project"]:
                    by_code[url.casefold()] = result
                    if result["id"] not in projects:
                        additions[result["id"]] = result
            if result is not None and result["id"] not in removed["project"]:
                identifier = result["id"]
        elif host == "clinicaltrials.gov":
            study = NCT.fullmatch(source.path)
            key = study[1].upper() if study else ""
            if key in records["study"]:
                kind, identifier = "study", key
        elif host in ("doi.org", "pubmed.ncbi.nlm.nih.gov"):
            path = unquote(source.path.strip("/"))
            key = ("doi:" + path.casefold()) if host == "doi.org" else ("pmid:" + path)
            if key in publications:
                kind, identifier = "publication", publications[key]
            elif key not in removed["publication"] and (
                re.fullmatch(r"doi:10\.\d{4,9}/[a-z0-9._;()/:%-]{1,180}", key) or re.fullmatch(r"pmid:[0-9]{1,12}", key)
            ):
                suggested_papers[row_id] = key
                continue
        elif entry["item_type"] == "dataset":
            note = "Outside the current directory listing kinds."
        decisions.append((row_id, "added" if identifier else "declined", note,
                          (kind, identifier) if identifier else None))
    papers = []
    if suggested_papers:
        source = run_dir / "inbox-publications"
        source.mkdir(mode=0o700)
        papers, _ = collect_publications(ROOT, state, source, records["publication"], removed["publication"],
                                         suggestions=set(suggested_papers.values()))
        for row in papers:
            for field in ("doi", "pmid"):
                if row.get(field):
                    publications[field + ":" + str(row[field])] = row["id"]
        for row_id, key in suggested_papers.items():
            identifier = publications.get(key)
            decisions.append((row_id, "added" if identifier else "declined",
                              "No qualifying regional publication could be confirmed.",
                              ("publication", identifier) if identifier else None))
    return additions, papers, decisions


def prepare_load(run_dir, deltas, decisions, revision, study_removals=()):
    projects = run_dir / "projects.json"
    pubs = run_dir / "publications.jsonl"
    trials = run_dir / "studies.jsonl"
    study_tombstones = run_dir / "study-removals.json"
    save(projects, list(deltas["project"].values()))
    write_rows(pubs, deltas["publication"].values())
    write_rows(trials, deltas["study"].values())
    save(study_tombstones, sorted(study_removals))
    dataset_args = []
    if "dataset" in deltas:
        datasets = run_dir / "datasets.jsonl"
        write_rows(datasets, deltas["dataset"].values())
        dataset_args = ["--datasets", str(datasets)]
    sql = command(ROOT, sys.executable, "ops/load-research.py", *dataset_args, "--project-upserts", str(projects),
                  "--publications", str(pubs), "--studies", str(trials), "--respect-removals",
                  "--study-removals", str(study_tombstones),
                  "--alias-reference", "src/content/public-directory-institutions.json", label="Research loader")
    with (run_dir / "load.sql").open("w", encoding="utf-8") as output:
        output.write(sql)
        for row_id, status, note, match in decisions:
            if match:
                kind, identifier = match
                exists = f"EXISTS(SELECT 1 FROM research_visible WHERE kind={quote(kind)} AND id={quote(identifier)})"
                output.write(f"UPDATE reader_inbox SET status=CASE WHEN {exists} THEN 'added' ELSE 'declined' END,"
                             f"note=CASE WHEN {exists} THEN {quote('Directory listing ' + identifier)} ELSE "
                             f"'Listing unavailable after rechecking removals.' END WHERE status='new' AND id={row_id};\n")
            else:
                output.write(f"UPDATE reader_inbox SET status={quote(status)},note={quote(note)} "
                             f"WHERE status='new' AND id={row_id};\n")
        output.write((ROOT / "ops/research-summary.sql").read_text())
        output.write(f"UPDATE research_summary_kinds SET first={quote(revision)} "
                     "WHERE scope_field='data' AND scope_value='' AND kind='directory';\n")


def measure(d1):
    d1.rows(PROJECTS, "Worker project catalog")
    d1.rows(PROJECTS + " AND id=" + quote(d1.probe()), "Worker project detail API")
    cache = (ROOT / "src/ingest/public-directory-cache.ts").read_text()
    version_sql = re.search(r"const versionSql = `([^`]+)`", cache)[1]
    d1.rows(version_sql, "Worker cache version")
    d1.rows(READY, "study visibility")
    for kind in KINDS:
        d1.rows(REMOVALS[kind], f"{kind} removals")
        d1.rows(LISTINGS.format(kind=quote(kind), after="''"), f"{kind} first inventory page")
    d1.revision()
    inbox_present = bool(d1.rows(INBOX_TABLE, "inbox schema"))
    if inbox_present:
        d1.rows(INBOX.format(after=0), "new inbox rows")
    return {"rows_read": dict(d1.reads), "unmeasured": sorted(d1.unmeasured), "inbox_available": inbox_present}


def collect(d1, state, run_dir, day, first, last, receipt):
    removed = {kind: {row["id"] for row in d1.rows(REMOVALS[kind], f"{kind} removals")} for kind in KINDS}
    baseline = {"project": d1.listings("project")}
    deltas = {}
    receipt["stage"] = "GitHub"
    projection, unavailable = refresh_projects(ROOT, run_dir, baseline["project"], removed["project"], day)
    receipt["github_unavailable"] = unavailable
    skipped = sum(identifier not in projection for identifier in baseline["project"])
    deltas["project"], receipt["counts"]["project"] = changes(
        baseline["project"], projection.values(), removed["project"], skipped)
    discovered, skipped = discover_projects(ROOT, projection, removed["project"], day, first.isoformat())
    deltas["project"].update(discovered)
    receipt["counts"]["project"]["added"] += len(discovered)
    receipt["counts"]["project"]["skipped"] += skipped

    receipt["stage"] = "Europe PMC"
    baseline["publication"] = d1.listings("publication")
    if first <= last:
        publications, skipped = collect_publications(ROOT, state, run_dir, baseline["publication"],
                                                      removed["publication"], first, last)
    else:
        publications, skipped = [], 0
    deltas["publication"], receipt["counts"]["publication"] = changes(
        baseline["publication"], publications, removed["publication"], skipped)

    receipt["stage"] = "ClinicalTrials.gov"
    baseline["study"] = d1.listings("study")
    registry, skipped, outside, missing = studies(run_dir, baseline["study"], day)
    receipt["registry_unresolved"] = missing
    deltas["study"], receipt["counts"]["study"] = changes(baseline["study"], registry, removed["study"], skipped)
    receipt["counts"]["study"]["removed"] = len(outside)

    receipt["stage"] = "reader inbox"
    public = {kind: {**baseline[kind], **deltas[kind]} for kind in KINDS}
    for identifier in outside:
        public["study"].pop(identifier, None)
    dataset_config = state / "datasets-config.json"
    dataset_enabled = dataset_config.exists() and json.loads(dataset_config.read_text()).get("enabled") is True
    dataset_suggestions = [] if dataset_enabled else None
    additions, papers, decisions = inbox(d1, state, run_dir, day, public, removed, dataset_suggestions)
    deltas["project"].update(additions)
    receipt["counts"]["project"]["added"] += len(additions)
    deltas["publication"].update((row["id"], row) for row in papers)
    receipt["counts"]["publication"]["added"] += len(papers)
    if dataset_enabled:
        receipt["stage"] = "datasets"
        config = json.loads(dataset_config.read_text())
        cursor = state / "datasets-cursor.json"
        if config.get("first_public_load_confirmed") is not True or not cursor.is_file():
            raise StopRun("Dataset first-load receipt or source checkpoint unavailable")
        if d1.rows("SELECT enabled FROM dataset_visibility WHERE id=1", "dataset visibility") != [{"enabled": 1}]:
            raise StopRun("Dataset first public load is not visible")
        checkpoint = json.loads(cursor.read_text())["datacite_through"]
        upper = datetime.now(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")
        baseline_dataset = d1.listings("dataset")
        if not baseline_dataset:
            raise StopRun("Dataset public baseline unavailable")
        dataset_removed = {row["id"] for row in d1.rows("SELECT id FROM dataset_removals", "dataset removals")}
        try:
            candidates = daily_datasets.collect_phase_one(ROOT, run_dir / "datasets-phase1", deltas["publication"].values(), checkpoint, upper, day, [identifier for _, identifier in dataset_suggestions if identifier])
            selected = {}
            for candidate in candidates:
                identifier = candidate["id"]
                if identifier in selected:
                    raise daily_datasets.StopRun("Duplicate dataset candidate")
                if identifier in dataset_removed:
                    continue
                old = baseline_dataset.get(identifier)
                if old:
                    candidate["added"] = old["added"]
                    if not set(old.get("papers") or []).issubset(candidate.get("papers") or []) or (old.get("label") == "Verified" and candidate.get("label") != "Verified"):
                        raise daily_datasets.StopRun("Dataset update would discard existing evidence")
                selected[identifier] = candidate
            dataset_counts = daily_datasets.guard(list(baseline_dataset.values()), list(selected.values()))
        except daily_datasets.StopRun as error:
            raise StopRun(str(error)) from None
        deltas["dataset"] = selected
        receipt["dataset_through"] = upper
        receipt["counts"]["dataset"] = {**dataset_counts, "skipped": 0}
        ids = (set(baseline_dataset) | set(selected)) - dataset_removed
        for row_id, identifier in dataset_suggestions:
            match = identifier if identifier in ids else None
            if match:
                decisions.append((row_id, "added", "", ("dataset", match)))
    for kind in KINDS:
        gate(kind, baseline[kind], receipt["counts"][kind])
    receipt["inbox"] = dict(Counter(status for _, status, _, _ in decisions))
    receipt["stage"] = "software listing validation"
    project_validation = run_dir / "project-validation.json"
    save(project_validation, list({**public["project"], **additions}.values()))
    command(ROOT, "node", "scripts/directory/validate.mjs", "--file", str(project_validation),
            label="Software listing validation")
    return deltas, decisions, outside


def daily_line(receipt):
    counts = " ".join(f"{kind} +{row['added']} ~{row['changed']} -{row['removed']} skip={row['skipped']}"
                      for kind, row in receipt["counts"].items())
    reads = sum(receipt["rows_read"].values())
    details = list(receipt.get("attempt_errors", []))
    if receipt.get("error") and receipt["error"] not in details:
        details.append(receipt["error"])
    if receipt["unmeasured"]:
        details.append("rows read unavailable for " + ", ".join(receipt["unmeasured"]))
    suffix = f" [{'; '.join(details)}]" if details else ""
    return " ".join(filter(None, (receipt["day"], receipt["outcome"], counts, f"rows_read={reads}{suffix}")))


def report(state, receipt):
    text = daily_line(receipt)
    log = state / "daily.log"
    lines = log.read_text().splitlines() if log.exists() else []
    lines = sorted([line for line in lines if not line.startswith(receipt["day"] + " ")] + [text])
    staged = log.with_suffix(".tmp")
    staged.write_text("\n".join(lines) + "\n")
    staged.replace(log)
    print(text, flush=True)
    if receipt["outcome"] in ("failed", "stopped"):
        queue(state, receipt["outcome"], text)
        return
    day = date.fromisoformat(receipt["day"])
    dates = {(day - timedelta(days=offset)).isoformat() for offset in range(3)}
    first_three = [line for line in lines if line[:10] in dates and line[11:].startswith("complete ")]
    report_path = state / "first-three-nights.txt"
    if receipt["outcome"] == "complete" and len(first_three) == 3 and not report_path.exists():
        queue(state, "three-nights", "\n".join(first_three), name="first-three-nights")
        report_path.write_text("\n".join(first_three) + "\n")


def retire_weekly(state, receipt):
    marker = state / "weekly-retired.json"
    if marker.exists() or not receipt["publication_window"] or receipt["counts"]["publication"]["added"] == 0:
        return
    command(ROOT, "systemctl", "--user", "disable", "--now", "valley-desk-publications.timer",
            label="weekly publication timer retirement", timeout=45)
    save(marker, {"day": receipt["day"], "loaded_through": receipt["loaded_through"]})


def apply_load(d1, sql, revision):
    label = "directory load and summary"
    try:
        d1.execute("--file", sql, label)
    except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError):
        # Wrangler can lose the final import status after D1 commits the whole file.
        if d1.revision() != revision:
            raise
        d1.unmeasured.add(label)
        return True
    if d1.revision() != revision:
        raise RuntimeError("Directory summary revision did not commit")
    return False


def run(state, d1, *, plan, scheduled):
    today = datetime.now(NY).date()
    day = today.isoformat()
    cursor = state / "cursor.json"
    previous = date.fromisoformat(json.loads((cursor if cursor.exists() else LEGACY / "cursor.json").read_text())["loaded_through"])
    last = max(previous, min(today - timedelta(days=1), previous + timedelta(days=14)))
    pending = state / "pending.json"
    resuming = not plan and pending.exists()
    receipt = json.loads(pending.read_text()) if resuming else {
        "day": day, "revision": uuid4().hex, "stage": "preflight", "counts": {}, "bookmarks": [],
        "loaded_through": last.isoformat(), "rows_read": {}, "scheduled": scheduled, "publication_window": previous < last,
    }
    prior_reads = Counter(receipt["rows_read"])
    prior_unmeasured = set(receipt.get("unmeasured", []))
    run_dir = state / "runs" / (receipt["day"] + "-" + receipt["revision"])
    run_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not plan and not resuming and (state / "daily.log").exists():
        complete_today = (f"{day} complete ", f"{day} manual-complete ")
        if any(line.startswith(complete_today) for line in (state / "daily.log").read_text().splitlines()):
            return 0
    try:
        if not plan:
            measured = state / "production-rows-read.json"
            if not measured.exists() or not json.loads(measured.read_text())["inbox_available"]:
                raise StopRun("Production inbox queries require a rows-read check")
            live_checks(ROOT, d1.probe())
            if not d1.rows(INBOX_TABLE, "inbox schema") or d1.rows(READY, "study visibility") != [{"enabled": 1}]:
                raise StopRun("Production inbox or study visibility is unavailable")
        if not resuming:
            receipt["base_revision"] = d1.revision()
            deltas, decisions, outside = collect(d1, state, run_dir, day, previous + timedelta(days=1), last, receipt)
            prepare_load(run_dir, deltas, decisions, receipt["revision"], outside)
            receipt["sql_sha256"] = sha256((run_dir / "load.sql").read_bytes()).hexdigest()
        if plan:
            receipt["outcome"] = "staged"
            return 0
        receipt["stage"] = "D1 load"
        live_revision = d1.revision()
        if live_revision != receipt["revision"]:
            if live_revision != receipt["base_revision"]:
                pending.unlink(missing_ok=True)
                raise StopRun("Directory changed while the batch was staged")
            sql = run_dir / "load.sql"
            if sha256(sql.read_bytes()).hexdigest() != receipt["sql_sha256"]:
                raise StopRun("Pending SQL differs from the guarded load")
            receipt["bookmarks"].append(d1.bookmark())
            receipt["rows_read"] = dict(prior_reads + Counter(d1.reads))
            save(pending, receipt)
            save(run_dir / "receipt.json", receipt)
            if apply_load(d1, sql, receipt["revision"]):
                receipt.setdefault("attempt_errors", []).append("Wrangler import response unavailable. D1 commit verified.")
        receipt["stage"] = "live checks"
        receipt["http"] = live_checks(ROOT, d1.probe())
        receipt["stage"] = "snapshot"
        receipt["snapshot"] = snapshot(ROOT, run_dir, receipt["day"], {kind: d1.listings(kind) for kind in KINDS})
        completed_today = datetime.now(NY).date().isoformat() == receipt["day"]
        nightly = scheduled and receipt["scheduled"] and completed_today
        if nightly:
            receipt["stage"] = "weekly timer retirement"
            retire_weekly(state, receipt)
        if receipt.get("dataset_through"):
            save(state / "datasets-cursor.json", {"datacite_through": receipt["dataset_through"]})
        save(cursor, {"loaded_through": receipt["loaded_through"]})
        receipt["outcome"] = ("complete" if nightly else "manual-complete") if completed_today else "recovered"
        return 0
    except StopRun as error:
        receipt.update(outcome="stopped", error=str(error))
        return 1
    except Exception as error:
        # No reader input or subprocess stderr belongs in the user journal or alerts.
        receipt.update(outcome="failed", error=f"{receipt['stage']} ({type(error).__name__})")
        return 1
    finally:
        if receipt["outcome"] in ("complete", "manual-complete", "recovered"):
            receipt.pop("error", None)
        elif receipt.get("error"):
            errors = receipt.setdefault("attempt_errors", [])
            if receipt["error"] not in errors:
                errors.append(receipt["error"])
        receipt["rows_read"] = dict(prior_reads + Counter(d1.reads))
        receipt["unmeasured"] = sorted(prior_unmeasured | d1.unmeasured)
        save(run_dir / "receipt.json", receipt)
        if plan:
            print(daily_line(receipt))
        else:
            report(state, receipt)
            if receipt["outcome"] in ("complete", "manual-complete", "recovered"):
                pending.unlink(missing_ok=True)
            elif pending.exists():
                save(pending, receipt)


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("state", type=Path)
    mode = cli.add_mutually_exclusive_group()
    mode.add_argument("--measure", action="store_true")
    mode.add_argument("--plan", action="store_true")
    mode.add_argument("--scheduled", action="store_true")
    args = cli.parse_args()
    os.umask(0o077)
    state = args.state.resolve(strict=True)
    if state.stat().st_mode & 0o077:
        cli.error("Use a private mode-0700 state directory")
    with (state / "daily.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        d1 = D1(ROOT)
        if args.measure:
            measured = measure(d1)
            save(state / "production-rows-read.json", measured)
            print(compact(measured))
            return 0
        return run(state, d1, plan=args.plan, scheduled=args.scheduled)


if __name__ == "__main__":
    raise SystemExit(main())
