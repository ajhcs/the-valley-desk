"""Write report.md from the pipeline outputs (datasets.jsonl, build-stats.json, requests.json, runtimes.json)."""
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import read_jsonl, work_dir


def table(title, counter, total=None):
    lines = [f"### {title}", "", "| Value | Count |", "|---|---:|"]
    for k, v in counter.most_common():
        lines.append(f"| {k} | {v:,} |")
    if total is not None:
        lines.append(f"| **Total** | **{total:,}** |")
    return "\n".join(lines) + "\n"


def main():
    w = work_dir()
    rows = read_jsonl(w / "datasets.jsonl")
    stats = json.loads((w / "build-stats.json").read_text())
    req = json.loads((w / "requests.json").read_text()) if (w / "requests.json").exists() else {}
    rt = json.loads((w / "runtimes.json").read_text()) if (w / "runtimes.json").exists() else {}
    ann = json.loads((w / "annotations-stats.json").read_text())
    mentions = read_jsonl(w / "mentions-classified.jsonl")
    code = read_jsonl(w / "code-candidates.jsonl")
    src = collections.Counter(stats["sources"])
    out = ["# Datasets phase 1: pipeline report (2026-11-23)", "",
           f"- Papers exported (visible publications with a PMCID): {ann['pmcids']:,}",
           f"- Europe PMC accession annotations: {ann['annotations']:,}; candidate repository/data-host mentions: {ann['candidate_mentions']:,} in {ann['papers_with_candidates']:,} papers",
           f"- Paper x accession rows classified (rules {mentions[0]['rules'] if mentions else '?'}): {len(mentions):,} "
           f"({', '.join(f'{k} {v:,}' for k, v in collections.Counter(m['decision'] for m in mentions).most_common())})",
           f"- Listings in datasets.jsonl: **{len(rows):,}**; code candidates: {len(code):,}",
           "- DataCite topic rule: keyword-v1 (scripts/datasets/datacite_rules.py). The publication topic rules in "
           "scripts/publications/ need indexed terms and a model step, so they were not applicable to DataCite text.",
           ""]
    out.append(table("By source", collections.Counter({"papers only": src.get("papers", 0), "DataCite institution search only": src.get("datacite", 0), "both": src.get("both", 0)}), len(rows)))
    for key, title in (("repository", "By repository"), ("access", "By access"), ("label", "By label"),
                       ("data_type", "By data type"), ("topic", "By topic")):
        out.append(table(title, collections.Counter(r[key] for r in rows), len(rows)))
    out.append(table("Label by source", collections.Counter(
        ("papers" if r["papers"] else "DataCite only") + " / " + r["label"] for r in rows)))
    out.append(table("Rows dropped or not listed, by reason", collections.Counter(stats["drops"])))
    lines = ["### API requests", "", "| Stage | Host | Requests | Failures |", "|---|---|---:|---:|"]
    for stage, d in sorted(req.items()):
        for host, n in sorted(d["requests"].items()):
            lines.append(f"| {stage} | {host} | {n:,} | {d['failures'].get(host, 0):,} |")
    out.append("\n".join(lines) + "\n")
    lines = ["### Runtime", "", "| Stage | Minutes |", "|---|---:|"]
    for stage, sec in rt.items():
        lines.append(f"| {stage} | {sec / 60:.1f} |")
    out.append("\n".join(lines) + "\n")
    notes = (w / "report-notes.md")
    if notes.exists():
        out.append(notes.read_text())
    (w / "report.md").write_text("\n".join(out))
    print("wrote", w / "report.md")


if __name__ == "__main__":
    main()
