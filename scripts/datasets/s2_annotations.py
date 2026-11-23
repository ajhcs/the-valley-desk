"""Stage 2: Europe PMC accession annotations (8 PMCIDs per request), cached per batch.

Phase 0 batches can be reused as a cache: pass PHASE0=<dir>; every PMCID in its sample.json was queried.
Output: annotations/<batch>.json.gz (raw) and candidate-mentions.jsonl (data-repository IDs and data-host DOIs).
"""
import json
import os
import re
import sys
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from common import http, read_gz_json, save_counts, work_dir, write_gz_json, write_jsonl

API = "https://www.ebi.ac.uk/europepmc/annotations_api/annotationsByArticleIds?"
REPOS = {"GEO", "ENA", "BioProject", "dbGaP", "EGA", "PRIDE", "PDBe", "PDB", "EMDB", "ArrayExpress",
         "BioStudies", "MetaboLights", "GCA", "Gisaid", "GISAID"}
DATA_DOI = {"10.5281": "Zenodo", "10.5061": "Dryad", "10.6084": "figshare", "10.25452": "figshare",
            "10.17605": "OSF", "10.17632": "Mendeley Data", "10.7910": "Dataverse", "10.5683": "Dataverse",
            "10.13026": "PhysioNet", "10.18112": "OpenNeuro", "10.7303": "Synapse", "10.7937": "TCIA",
            "10.15154": "NIMH Data Archive", "10.26300": "NIMH Data Archive", "10.48324": "DANDI", "10.3886": "ICPSR"}


def repo_of(a):
    sub = a.get("subType")
    if sub in REPOS:
        return {"PDB": "PDBe", "GISAID": "Gisaid"}.get(sub, sub)
    if sub == "DOI":
        return DATA_DOI.get((a.get("exact") or "").split("/")[0].lower())
    return None


def main():
    work = work_dir()
    papers = json.loads((work / "papers.json").read_text())
    pmcids = sorted({p["pmcid"] for p in papers if p.get("pmcid")})
    cache = work / "annotations"; cache.mkdir(exist_ok=True)
    have = {}
    phase0 = os.environ.get("PHASE0")
    if phase0:
        p0 = Path(phase0)
        sample = json.loads((p0 / "sample.json").read_text())
        for i in range(0, len(sample), 8):
            f = p0 / "annotations" / f"{i // 8:05d}.json"
            if f.exists() and f.stat().st_size:
                arts = {a.get("pmcid"): a for a in json.loads(f.read_text())}
                for p in sample[i:i + 8]:
                    have[p["pmcid"]] = arts.get(p["pmcid"], {"pmcid": p["pmcid"], "annotations": []})
    for f in cache.glob("*.json.gz"):
        for a in read_gz_json(f):
            have[a["pmcid"]] = a
    todo = [p for p in pmcids if p not in have]
    print(f"pmcids {len(pmcids)} cached {len(pmcids) - len(todo)} to fetch {len(todo)}", flush=True)
    batches = [todo[i:i + 8] for i in range(0, len(todo), 8)]
    stamp = len(list(cache.glob("*.json.gz")))
    failed = []

    def fetch(k):
        ids = batches[k]
        url = API + urllib.parse.urlencode({"articleIds": ",".join("PMC:" + p for p in ids),
                                            "type": "Accession Numbers", "format": "JSON"})
        status, body = http(url, timeout=120)
        if status != 200:
            failed.append(ids); return
        try:
            arts = {a.get("pmcid"): a for a in json.loads(body)}
        except ValueError:
            failed.append(ids); return
        rows = [arts.get(p, {"pmcid": p, "annotations": []}) for p in ids]
        write_gz_json(cache / f"b{stamp + k:06d}.json.gz", rows)
        if k % 200 == 0:
            print("batch", k, "of", len(batches), flush=True)

    with ThreadPoolExecutor(3) as pool:
        list(pool.map(fetch, range(len(batches))))
    save_counts("annotations")
    for f in cache.glob("*.json.gz"):
        for a in read_gz_json(f):
            have[a["pmcid"]] = a
    rows = []
    for p in pmcids:
        art = have.get(p)
        if not art:
            continue
        for a in art.get("annotations") or []:
            repo = repo_of(a)
            if not repo:
                continue
            rows.append({"pmcid": p, "repo": repo, "sub": a.get("subType"), "exact": (a.get("exact") or "").strip(),
                         "section": (a.get("section") or "").split(" (")[0], "prefix": a.get("prefix") or "",
                         "postfix": a.get("postfix") or ""})
    write_jsonl(work / "candidate-mentions.jsonl", rows)
    all_ann = sum(len(have[p].get("annotations") or []) for p in pmcids if p in have)
    stats = {"pmcids": len(pmcids), "annotated_fetched": sum(1 for p in pmcids if p in have),
             "failed_batches": len(failed), "failed_pmcids": [x for b in failed for x in b],
             "annotations": all_ann, "candidate_mentions": len(rows),
             "papers_with_candidates": len({r["pmcid"] for r in rows})}
    (work / "annotations-stats.json").write_text(json.dumps(stats, indent=1))
    print({k: v for k, v in stats.items() if k != "failed_pmcids"})


if __name__ == "__main__":
    main()
