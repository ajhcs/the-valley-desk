"""Collect one completed Europe PMC index window and prepare a spot-checkable public delta."""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
import hashlib
import heapq
import json
import os
from pathlib import Path
import re

from collect import EuropePmcCoverageError, add_observation, deduplicate, doi, epmc_ids, europepmc_rows
from enrich import crossref_lookup
from institutions import load_reference, REFERENCE
from mechanical import MechanicalProjector, identity_tokens
from receipts import Receipts
from sizing import EPMC_CORPUS, Source, epmc_query
from validate import CONTENT, DATASET, REMOVALS, validate_records
from weekly_topics import model_topics, source_topic


def read(path):
    with path.open(encoding="utf-8") as stream:
        yield from (json.loads(line) for line in stream if line.strip())


def write(path, records):
    temp = path.with_suffix(".pending")
    with temp.open("w", encoding="utf-8") as stream:
        for row in records:
            stream.write(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
    os.replace(temp, path)


def add_to_year(target, previous, additions):
    def lines(path):
        if path.exists():
            with path.open(encoding="utf-8") as stream:
                for line in stream:
                    yield json.loads(line)["id"], line

    with target.open("w", encoding="utf-8") as output:
        for _, line in heapq.merge(lines(previous), lines(additions)):
            output.write(line)


def epmc_window(source, institution, start, stop):
    query = f"{EPMC_CORPUS} AND {epmc_query(institution)} AND FIRST_IDATE:[{start} TO {stop}]"
    try:
        return list(europepmc_rows(source, query))
    except EuropePmcCoverageError:
        if start == stop:
            raise
        midpoint = start + (stop - start) // 2
        return [*epmc_window(source, institution, start, midpoint),
                *epmc_window(source, institution, midpoint + timedelta(days=1), stop)]


def collect(private, start, stop):
    receipts = Receipts(private)
    source = Source("europepmc", receipts, True, shared_backoff=True)
    institutions = load_reference(REFERENCE)
    shards = {}
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = [(ref, pool.submit(epmc_window, source, ref, start, stop)) for ref in institutions]
        for ref, future in futures:
            shards[ref["id"]] = future.result()

    overlaps = {}
    for ref in institutions:
        for record in shards[ref["id"]]:
            overlaps.setdefault((record["source"], record["id"]), []).append((ref["id"], record))
    observations = {}
    for (origin, accession), hits in overlaps.items():
        record = hits[0][1]
        if any(other != record for _, other in hits[1:]):
            record = reconcile_epmc_overlap(source, origin, accession, hits)
        add_observation(observations, "europepmc", record, [slug for slug, _ in hits])
    return list(deduplicate(observations))


def reconcile_epmc_overlap(source, origin, accession, hits):
    """Check the current source record when overlapping searches return different metadata."""
    if origin not in {"MED", "PMC", "PPR"} or not re.fullmatch(r"[A-Za-z0-9._-]{1,100}", accession):
        raise EuropePmcCoverageError("Invalid Europe PMC accession for overlap reconciliation")

    def identity(row):
        return epmc_ids(row), row.get("title"), row.get("firstIndexDate")

    observed = identity(hits[0][1])
    if any(identity(record) != observed for _, record in hits[1:]):
        raise EuropePmcCoverageError("Overlapping Europe PMC hits disagree on identity or index date")
    records = list(europepmc_rows(source, f"EXT_ID:{accession} AND SRC:{origin}"))
    if len(records) != 1 or (records[0]["source"], records[0]["id"]) != (origin, accession):
        raise EuropePmcCoverageError("Exact Europe PMC lookup did not confirm the overlap")
    if identity(records[0]) != observed:
        raise EuropePmcCoverageError("Exact Europe PMC lookup changed the identity or index date")
    return records[0]


def files():
    return [DATASET, *sorted(CONTENT.glob("public-directory-publications-[0-9][0-9][0-9][0-9].jsonl"))]


def link_versions(records, crossref, *, existing=(), excluded=frozenset()):
    all_records = [*existing, *records]
    indexed = {row["doi"]: row for row in all_records if row.get("doi") and row["id"] not in excluded}
    partners = defaultdict(set)
    for row in all_records:
        if partner := row.get("published_as") or row.get("preprint_of"):
            partners[row["id"]].add(partner)
            partners[partner].add(row["id"])
    candidates = {}
    for source, record in crossref.items():
        if source not in indexed:
            continue
        relations = record.get("relation", {})
        for field in ("is-preprint-of", "has-preprint"):
            for relation in relations.get(field, []):
                if relation.get("id-type") != "doi" or (related := doi(relation.get("id"))) not in indexed:
                    continue
                pair = (source, related) if field == "is-preprint-of" else (related, source)
                if indexed[pair[0]]["type"] == "preprint" and indexed[pair[1]]["type"] != "preprint":
                    preprint, journal = (indexed[key]["id"] for key in pair)
                    candidates[(preprint, journal)] = tuple(indexed[key] for key in pair)
                    partners[preprint].add(journal)
                    partners[journal].add(preprint)
    added = {row["id"] for row in records}
    updates = {}
    for (preprint, journal), (draft, article) in candidates.items():
        if partners[preprint] == {journal} and partners[journal] == {preprint}:
            for row, field, target in ((draft, "published_as", journal), (article, "preprint_of", preprint)):
                if row.get(field) == target:
                    continue
                changed = row if row["id"] in added else updates.setdefault(row["id"], dict(row))
                changed[field] = target
    return list(updates.values())


def prepare(args):
    if not args.private.is_dir() or args.private.stat().st_mode & 0o077:
        raise ValueError("Set up a mode-0700 directory for retained evidence.")
    private = args.private.resolve()
    candidates = private / "candidates.jsonl"
    if not candidates.exists():
        write(candidates, collect(private, args.start, args.stop))

    baseline = files()
    previous = [row for path in baseline for row in read(path)]
    blocked = set(json.loads(REMOVALS.read_text()))
    with args.hold_ids.open() as stream:
        blocked.update(value.strip() for value in stream if value.strip())
    def projector():
        return MechanicalProjector(REFERENCE, args.postal, previous, blocked, args.added.isoformat(),
                                   country_codes=args.countries)

    initial = projector()
    counters = Counter()
    provisional = []
    for candidate in read(candidates):
        indexes = [obs["record"] for obs in candidate["observations"] if obs["provider"] == "europepmc"]
        if not any(str(args.start) <= (record.get("firstIndexDate") or "") <= str(args.stop) for record in indexes):
            counters["index-date conflict"] += 1
            continue
        trial = initial.project(candidate)
        if trial.record is not None or trial.reason == "publication date unsupported":
            provisional.append(candidate)
        else:
            counters[trial.reason] += 1
    keys = sorted({key[4:] for c in provisional for key in c["identifiers"] if key.startswith("doi:")})
    crossref = {row["doi"]: row["record"] for row in crossref_lookup(Receipts(private), keys) if row["record"]}
    final = projector()
    eligible = []
    ambiguity = []
    cases = []
    for candidate in provisional:
        extra = [crossref[key[4:]] for key in candidate["identifiers"] if key.startswith("doi:") and key[4:] in crossref]
        observations = [*candidate["observations"], *({"provider": "crossref", "record": entry} for entry in extra)]
        projection = final.project({**candidate, "observations": observations})
        if projection.record is None:
            counters[projection.reason] += 1
            continue
        row = projection.record
        if blocked.intersection(identity_tokens(row)):
            counters["removal or privacy hold"] += 1
            continue
        row["topic"] = source_topic(row)
        cases.append(projection.evidence)
        if row["topic"] is None:
            ambiguity.append(row)
        eligible.append(row)
    write(private / "evidence.jsonl", cases)
    write(private / "before-topics.jsonl", eligible)
    if args.project_only:
        return {"eligible": len(eligible), "needs_model": len(ambiguity), "excluded": sum(counters.values())}
    topics = dict(model_topics(ambiguity, private))
    accepted = []
    for row in eligible:
        row["topic"] = topics.get(row["id"], row["topic"])
        if row["topic"] is None:
            counters["topic held privately"] += 1
        else:
            accepted.append(row)
    accepted.sort(key=lambda row: row["id"])
    link_versions(accepted, crossref)
    other = sum(r["topic"] == "Other science" for r in accepted)
    if accepted and other * 100 > len(accepted) * 12:
        raise ValueError(f"Other science exceeds 12%: {other} of {len(accepted)}.")
    year_file = CONTENT / f"public-directory-publications-{args.stop.year}.jsonl"
    cumulative = private / year_file.name
    delta = private / "delta.jsonl"
    write(delta, accepted)
    add_to_year(cumulative, year_file, delta)
    total = validate_records(*[p for p in baseline if p != year_file], cumulative)
    # All notices and hold reasons remain private. The PR can link a small sample of accepted public records.
    buckets = sorted(accepted, key=lambda row: hashlib.sha256((str(args.stop) + row["id"]).encode()).hexdigest())
    priorities = [r for r in buckets if r["id"] in topics or r["label"] == "Listed"]
    sample = list(dict.fromkeys([row["id"] for row in priorities[:6]] + [row["id"] for row in buckets]))[:12]
    manifest = {
        "start": str(args.start), "stop": str(args.stop), "output": year_file.name,
        "delta_sha256": hashlib.sha256(delta.read_bytes()).hexdigest(),
        "file_sha256": hashlib.sha256(cumulative.read_bytes()).hexdigest(), "additions": len(accepted),
        "integrated_records": total, "other_science": other, "model_assignments": len(ambiguity),
        "excluded": sum(counters.values()), "spot_check": sample,
    }
    (private / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("private", type=Path)
    parser.add_argument("start", type=date.fromisoformat)
    parser.add_argument("stop", type=date.fromisoformat)
    parser.add_argument("--added", type=date.fromisoformat, required=True)
    parser.add_argument("--postal", type=Path, required=True)
    parser.add_argument("--hold-ids", type=Path, required=True)
    parser.add_argument("--countries", type=Path)
    parser.add_argument("--project-only", action="store_true")
    args = parser.parse_args()
    if not 0 <= (args.stop - args.start).days <= 13 or args.stop >= args.added:
        parser.error("A window has at most fourteen completed provider-date days.")
    print(json.dumps(prepare(args), sort_keys=True))


if __name__ == "__main__":
    main()
