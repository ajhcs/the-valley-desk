"""Collect and qualify nightly dataset updates before the guarded directory load."""
from datetime import datetime, timedelta, timezone
import gzip
import json
import os
from pathlib import Path
import re
from urllib.parse import parse_qs, quote, unquote, urlencode, urlsplit


class StopRun(Exception):
    pass


DOI = re.compile(r"10\.[0-9]{4,9}/[a-z0-9._;()/:+-]{1,180}\Z", re.I)
ACCESSION = re.compile(r"(?:GSE[0-9]+|PRJ[END][A-Z]?[0-9]+|EGAS[0-9]+|PXD[0-9]+|E-MTAB-[0-9]+)\Z", re.I)


def suggestion_identifier(entry):
    """Reduce a dataset suggestion to an inert identifier; never retain its URL."""
    if entry.get("kind") != "suggestion" or entry.get("item_type") != "dataset":
        return None
    raw = entry.get("url")
    if not isinstance(raw, str) or len(raw) > 2048:
        return None
    try:
        url = urlsplit(raw)
        if url.scheme != "https" or url.username or url.password or url.port or url.fragment:
            return None
        host = (url.hostname or "").lower()
        path = unquote(url.path).strip("/")
    except ValueError:
        return None
    if host == "www.ncbi.nlm.nih.gov" and path == "geo/query/acc.cgi":
        params = parse_qs(url.query, keep_blank_values=True, strict_parsing=False)
        values = params.get("acc", [])
        if set(params) == {"acc"} and len(values) == 1 and re.fullmatch(r"GSE[0-9]+", values[0], re.I):
            return "geo:" + values[0].upper()
        return None
    if url.query:
        return None
    if host == "www.ncbi.nlm.nih.gov" and re.fullmatch(r"bioproject/PRJ[END][A-Z][0-9]+", path, re.I):
        return "bioproject:" + path.split("/")[-1].upper()
    if host == "doi.org" and DOI.fullmatch(path):
        return "doi:" + path.lower()
    if host == "identifiers.org" and re.fullmatch(r"GSE[0-9]+", path, re.I):
        return "geo:" + path.upper()
    if host == "identifiers.org" and re.fullmatch(r"PRJ[END][A-Z][0-9]+", path, re.I):
        return "bioproject:" + path.upper()
    return None


def guard(previous, candidates, removed=()):
    """Count additions, material changes and confirmed removals against this kind's baseline."""
    prior = {row["id"]: row for row in previous}
    if len(prior) != len(previous):
        raise StopRun("Duplicate baseline identity")
    proposed = {}
    for row in candidates:
        identifier = row["id"]
        if identifier in proposed:
            raise StopRun("Duplicate dataset candidate")
        proposed[identifier] = row
    removed = set(removed)
    if removed & proposed.keys():
        raise StopRun("Dataset candidate also removed")
    # Check time is bookkeeping; every other change is conservatively material.
    def material(row):
        return {k: v for k, v in row.items() if k != "checked"}
    added = sum(k not in prior for k in proposed)
    changed = sum(k in prior and material(v) != material(prior[k]) for k, v in proposed.items())
    deleted = len(removed & prior.keys())
    if deleted > 25 or (added + changed + deleted) * 20 > len(prior):
        raise StopRun("Dataset change limit exceeded")
    return {"added": added, "changed": changed, "removed": deleted}


def parse_time(value):
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if result.tzinfo is None:
            raise ValueError
        return result.astimezone(timezone.utc)
    except (AttributeError, ValueError):
        raise StopRun("Invalid source checkpoint") from None


def datacite_url(ror, checkpoint, upper, overlap=timedelta(days=1)):
    """A bounded updated window; upper bound is fixed before collecting pages."""
    start, end = parse_time(checkpoint), parse_time(upper)
    if end <= start or not re.fullmatch(r"https://ror\.org/0[0-9a-hjkmnp-tv-z]{6}[0-9]{2}", ror):
        raise StopRun("Invalid DataCite collection bounds")
    stamp = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")
    query = f'creators.affiliation.affiliationIdentifier:"{ror}" AND updated:[{stamp(start - overlap)} TO {stamp(end)}]'
    return "https://api.datacite.org/dois?" + urlencode({"query": query, "resource-type-id": "dataset", "page[size]": 500, "page[cursor]": "1", "affiliation": "true"})


def collect_datacite(url, http, cache, *, max_pages=10000):
    """Fetch every cursor page or fail; http is the phase-one polite HTTP helper."""
    cache = Path(cache)
    cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    seen, pages = set(), []
    while url:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.netloc != "api.datacite.org" or parsed.path != "/dois" or url in seen or len(seen) >= max_pages:
            raise StopRun("Invalid DataCite pagination")
        seen.add(url)
        status, body = http(url, timeout=180, accept="application/vnd.api+json")
        if status != 200:
            raise StopRun("DataCite collection incomplete")
        try:
            page = json.loads(body)
            if not isinstance(page.get("data"), list) or not isinstance(page.get("links", {}), dict):
                raise ValueError
        except (ValueError, TypeError, AttributeError):
            raise StopRun("Invalid DataCite response") from None
        target = cache / f"{len(pages):06d}.json.gz"
        temporary = target.with_suffix(".tmp")
        with gzip.open(temporary, "wt", encoding="utf-8") as out:
            json.dump(page, out, ensure_ascii=False)
        temporary.replace(target)
        pages.append(target)
        url = page.get("links", {}).get("next") if page["data"] else None
        if url is not None and not isinstance(url, str):
            raise StopRun("Invalid DataCite pagination")
    return pages


def collect_phase_one(root, run_dir, publications, checkpoint, upper, day, suggestions=()):
    """Collect bounded source deltas using the same phase-one stages and rules."""
    import importlib.util
    import subprocess
    import sys

    root, run_dir = Path(root), Path(run_dir)
    phase = root / "scripts/datasets"
    if not (phase / "run.py").is_file():
        raise StopRun("Phase-one dataset pipeline is unavailable")
    run_dir.mkdir(mode=0o700, parents=True, exist_ok=False)
    papers = []
    for row in publications:
        if row.get("pmcid"):
            papers.append({key: row.get(key) for key in ("id", "pmcid", "pmid", "doi", "title", "published", "topic", "institutions", "counties", "label")})
    (run_dir / "papers.json").write_text(json.dumps(papers), encoding="utf-8")
    env = dict(os.environ, TVD_DATASETS_WORK=str(run_dir))
    # The stage scripts print public metadata and exceptions; capture it privately
    # and report only a fixed stage name on failure.
    def stage(name):
        result = subprocess.run([sys.executable, "-I", "-B", str(phase / name)], cwd=root,
                                env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, timeout=7200)
        if result.returncode:
            raise StopRun("Dataset phase-one stage failed")
    for script in ("s2_annotations.py", "s3_fulltext.py", "s4_classify.py", "s5_repos.py"):
        stage(script)
    stats = json.loads((run_dir / "annotations-stats.json").read_text())
    if stats.get("failed_batches") or stats.get("annotated_fetched") != stats.get("pmcids"):
        raise StopRun("Dataset annotation collection incomplete")
    if (run_dir / "fulltext-missing.txt").read_text().strip():
        raise StopRun("Dataset full text collection incomplete")
    counts = json.loads((run_dir / "requests.json").read_text())
    if any(any(int(n) for n in stage_counts.get("failures", {}).values()) for stage_counts in counts.values()):
        raise StopRun("Dataset repository collection incomplete")
    spec = importlib.util.spec_from_file_location("dataset_phase_common", phase / "common.py")
    common = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(common)
    for inst in common.registry():
        if inst.get("ror") and inst["id"] not in common.SKIP_OUTSIDE:
            collect_datacite(datacite_url(inst["ror"].rstrip("/"), checkpoint, upper), common.http,
                             run_dir / "datacite-inst" / inst["id"])
    collect_suggestion_dois(suggestions, common, run_dir)
    stage("build.py")
    stage("validate.py")
    rows = []
    for line in (run_dir / "datasets.jsonl").read_text().splitlines():
        row = json.loads(line)
        row["added"] = row["checked"] = day
        rows.append(row)
    return rows


def collect_suggestion_dois(suggestions, common, run_dir):
    # The only address fetched for reader suggestions is a constructed DataCite
    # endpoint; the submitted URL and all other reader input remain in memory.
    for index, identifier in enumerate(sorted(set(suggestions))):
        if not identifier or not identifier.startswith("doi:") or not DOI.fullmatch(identifier[4:]):
            continue
        url = "https://api.datacite.org/dois/" + quote(identifier[4:], safe="/") + "?affiliation=true"
        status, body = common.http(url, timeout=180, accept="application/vnd.api+json", ok404=True)
        if status == 404:
            continue
        if status != 200:
            raise StopRun("Dataset suggestion source unavailable")
        try:
            data = json.loads(body)["data"]
            if not isinstance(data, dict) or data.get("id", "").lower() != identifier[4:] or not isinstance(data.get("attributes"), dict):
                raise ValueError
        except (ValueError, TypeError, KeyError, AttributeError):
            raise StopRun("Invalid dataset suggestion response") from None
        common.write_gz_json(run_dir / "datacite-inst" / "suggestions" / f"{index:06d}.json.gz", {"data": [data]})
