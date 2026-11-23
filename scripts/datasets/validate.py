"""Validate datasets.jsonl against the phase 1 record contract. Exit 1 on any error.

Usage: python3 -I -B scripts/datasets/validate.py [path/to/datasets.jsonl] [papers.json]
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import COUNTIES, registry, work_dir

KEYS = ["id", "title", "summary", "data_type", "access", "repository", "accessions", "url", "institutions", "counties",
        "label", "connection", "source", "papers", "topic", "released", "added", "checked", "size", "format", "license"]
DATA_TYPES = {"gene expression", "sequencing", "single-cell", "structure", "proteomics", "metabolomics", "imaging",
              "clinical and survey", "other"}
TOPICS = {"Research data", "Medical imaging", "Rehabilitation and accessibility", "Neuroscience", "Public health",
          "Clinical care", "Disease research", "Biomedical and life sciences", "Other science"}
ID = re.compile(r"^(geo:GSE\d+|bioproject:PRJ[NED][A-Z]\d+|sra:[SED]RP\d+|dbgap:phs\d{6}|ega:EGA[SD]\d{11}|"
                r"pride:PXD\d{6}|arrayexpress:E-[A-Z]{4}-\d+|pdb-set:(?:doi|pmid|pmcid|arxiv):\S+|doi:10\.\d{4,9}/\S+)$")
DATE = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$")


def check(rec, inst_ids, paper_ids):
    errs = []
    unexpected = (set(rec) - {"paper_provenance"}) ^ set(KEYS)
    if unexpected:
        errs.append(f"keys {sorted(unexpected)}")
    s = lambda k: isinstance(rec.get(k), str) and rec[k].strip() != ""
    for k in ("id", "title", "summary", "repository", "url", "connection", "source", "label", "access", "data_type", "topic"):
        if not s(k):
            errs.append(f"{k} missing")
    if s("id") and not ID.match(rec["id"]):
        errs.append("id pattern")
    if s("id") and rec["id"].startswith("doi:") and rec["id"] != rec["id"].lower():
        errs.append("doi id not lowercase")
    if s("summary") and (len(rec["summary"]) > 240 or re.search(r"</?[A-Za-z][^>]*>", rec["summary"]) or "\n" in rec["summary"]):
        errs.append("summary length/markup")
    if rec.get("data_type") not in DATA_TYPES: errs.append("data_type")
    if rec.get("access") not in ("open", "registration", "controlled"): errs.append("access")
    if rec.get("label") not in ("Verified", "Listed"): errs.append("label")
    if rec.get("topic") not in TOPICS: errs.append("topic")
    for k in ("url", "source"):
        if s(k) and not rec[k].startswith("https://"): errs.append(f"{k} not https")
    for k in ("accessions", "institutions", "counties", "papers"):
        if not isinstance(rec.get(k), list) or not all(isinstance(x, str) and x for x in rec[k]):
            errs.append(f"{k} not a list of strings")
    if isinstance(rec.get("accessions"), list) and not rec["accessions"]: errs.append("accessions empty")
    if isinstance(rec.get("institutions"), list):
        bad = [i for i in rec["institutions"] if i not in inst_ids]
        if bad: errs.append(f"unknown institutions {bad}")
    if isinstance(rec.get("counties"), list):
        bad = [c for c in rec["counties"] if c not in COUNTIES]
        if bad: errs.append(f"unknown counties {bad}")
    if isinstance(rec.get("papers"), list) and paper_ids is not None:
        bad = [p for p in rec["papers"] if p not in paper_ids]
        if bad: errs.append(f"unknown papers {bad[:2]}")
    if rec.get("label") == "Listed" and not rec.get("papers"): errs.append("Listed without a paper")
    if "paper_provenance" in rec:
        edges = rec["paper_provenance"]
        paper_refs = rec["papers"] if isinstance(rec.get("papers"), list) else []
        if not isinstance(edges, list) or any(
            not isinstance(edge, dict) or set(edge) != {"paper", "relation"}
            or not isinstance(edge["paper"], str) or edge["paper"] not in paper_refs
            or edge["relation"] not in ("produced", "linked")
            for edge in edges
        ) or len({edge["paper"] for edge in edges}) != len(edges):
            errs.append("paper_provenance")
    if rec.get("released") is not None and not (isinstance(rec["released"], str) and DATE.match(rec["released"])):
        errs.append("released format")
    for k in ("added", "checked"):
        if not (isinstance(rec.get(k), str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", rec[k])): errs.append(k)
    for k in ("size", "format", "license"):
        if rec.get(k) is not None and not (isinstance(rec[k], str) and rec[k].strip()): errs.append(k)
    if s("id") and rec["id"].startswith("pdb-set:") and rec["id"][8:] not in (rec.get("papers") or []):
        errs.append("pdb-set id does not match its paper")
    return errs


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else str(work_dir() / "datasets.jsonl")
    ppath = sys.argv[2] if len(sys.argv) > 2 else str(work_dir() / "papers.json")
    paper_ids = {p["id"] for p in json.load(open(ppath))} if os.path.exists(ppath) else None
    inst_ids = {i["id"] for i in registry()}
    seen, bad, n = set(), 0, 0
    with open(path, encoding="utf-8") as f:
        for ln, line in enumerate(f, 1):
            n += 1
            try:
                rec = json.loads(line)
            except ValueError:
                print(f"line {ln}: not JSON"); bad += 1; continue
            errs = check(rec, inst_ids, paper_ids)
            if rec.get("id") in seen: errs.append("duplicate id")
            seen.add(rec.get("id"))
            if errs:
                bad += 1
                if bad <= 30: print(f"line {ln} {rec.get('id')}: {'; '.join(errs)}")
    print(f"{n} records, {bad} invalid")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
