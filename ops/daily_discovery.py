"""Run supplemental directory discovery against the live inventory without publishing."""
import argparse
from collections import Counter
from datetime import date, datetime, timedelta
import json
from pathlib import Path
import re
import sys
from tempfile import mkdtemp
from zoneinfo import ZoneInfo

from daily_d1 import D1, REMOVALS, save

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/publications"))

from institutions import REFERENCE, load_reference
from mechanical import MechanicalProjector, identity_tokens
from receipts import MetadataError, Receipts
from supplemental import (
    CoverageError, PROVIDERS, collect_preprints, collect_published_preprints, collect_pubmed,
    jats_repositories, paced_requests, parse_xml, reconcile,
)

COUNTRIES = Path("/usr/share/iso-codes/json/iso_3166-1.json")
NY = ZoneInfo("America/New_York")


def affiliations(row, projector):
    return sorted({slug for literal in row["affiliations"]
                   if not projector.postal_conflict(literal)
                   for slug, _ in projector.rules.claims(literal)[0]})


def stage(state, output, first, last, baseline, holds, providers, *, checkpoints=False, sources=()):
    if first > last:
        return {}
    if not providers or len(set(providers)) != len(providers) or any(name not in PROVIDERS for name in providers):
        raise ValueError("Choose one or more supported supplemental sources")
    output.mkdir(mode=0o700, exist_ok=True)
    receipts = Receipts(output)
    get = paced_requests(receipts)
    roster = load_reference(REFERENCE)
    projector = MechanicalProjector(REFERENCE, state / "US.zip", (), (), date.today().isoformat(),
                                   country_codes=COUNTRIES)
    checkpoint_root = state / "discovery-checkpoints"
    if checkpoints:
        checkpoint_root.mkdir(mode=0o700, exist_ok=True)

    baseline = list(baseline)
    known_works = {token for row in baseline for token in identity_tokens(row)}
    summary, covered, records, version_links = {}, {}, [], []
    for provider in providers:
        cursor = checkpoint_root / f"{provider}.json"
        start = first
        if checkpoints and cursor.is_file():
            start = date.fromisoformat(json.loads(cursor.read_text())["through"]) + timedelta(days=1)
            if start > last:
                summary[provider] = {"status": "current"}
                continue
        end = min(last, start + timedelta(days=6))
        summary[provider] = result = {"from": str(start), "through": str(end)}
        try:
            feed = (collect_pubmed(get, roster, start, end) if provider == "pubmed"
                    else collect_preprints(get, provider, start, end))
            observations = list(feed)
            additions = []
            for row in observations:
                institutions = affiliations(row, projector)
                if institutions:
                    additions.append({**row, "institutions": institutions, "provider": provider})
            if provider != "pubmed":
                links = list(collect_published_preprints(get, provider, min(start, end - timedelta(days=13)), end))
                for row in links:
                    keys = {row["preprint"], row["journal"]}
                    if not keys & holds and (keys & known_works or affiliations(row, projector)):
                        version_links.append(row)
                result["version_relations_seen"] = len(links)
            records.extend(additions)
            covered[provider] = (cursor, end)
            result.update(status="complete", seen=len(observations), regional_leads=len(additions))
        except Exception as error:
            result.update(status="failed", error=type(error).__name__)
            if isinstance(error, CoverageError):
                result["detail"] = str(error)
            elif isinstance(error, MetadataError):
                result["http"] = error.status

    groups = list(reconcile(records, baseline, holds))
    relationships = [{"publication": group["catalog_ids"] or group["identifiers"], "repo": url, "source": row["source"]}
                     for group in groups if group["status"] in {"existing", "candidate"}
                     for row in group["observations"] for url in row.get("code_links", [])]
    summary["pmc_code"] = scan_papers(get, sources, holds, relationships)
    relationships = list({(tuple(row["publication"]), row["repo"], row["source"]): row
                          for row in relationships}.values())
    counts = dict(Counter(group["status"] for group in groups))
    save(output / "review.json", {"sources": summary, "counts": counts, "works": groups,
                                  "repository_leads": relationships, "version_links": version_links})
    if checkpoints:
        for provider, (cursor, end) in covered.items():
            save(cursor, {"through": str(end), "review": str(output / "review.json")})
    return {"sources": summary, "works": counts, "repository_leads": len(relationships),
            "version_links": len(version_links)}


def scan_papers(get, papers, holds, leads):
    checked, unavailable, failed = 0, 0, 0
    eligible = {}
    for paper in papers:
        pmcid = paper.get("pmcid") or ""
        if re.fullmatch(r"PMC[1-9][0-9]*", pmcid) and not identity_tokens(paper) & holds:
            eligible.setdefault(pmcid, paper["id"])
    for pmcid, identity in list(eligible.items())[:60]:
        try:
            document = get("europepmc", f"/{pmcid}/fullTextXML", {}, decode=parse_xml, accept="application/xml")
            urls = jats_repositories(document, pmcid)
        except MetadataError as error:
            if error.status in (404, 410):
                unavailable += 1
            else:
                failed += 1
                if error.status in (None, 429, 500, 502, 503, 504):
                    break
        except (ValueError, RuntimeError, SyntaxError):
            failed += 1
        else:
            checked += 1
            leads.extend({"publication": [identity], "repo": url,
                          "source": f"https://europepmc.org/articles/{pmcid}"} for url in urls)
    return {"checked": checked, "unavailable": unavailable, "failed": failed, "eligible": len(eligible)}


def run_scheduled(state, run_dir, last, catalog, removed, added_day):
    config = json.loads((state / "discovery-sources.json").read_text())
    first = date.fromisoformat(config["start"])
    holds = set((state / "hold-ids.txt").read_text().split()) | removed
    output = Path(mkdtemp(prefix="supplemental-discovery-", dir=run_dir))
    return stage(state, output, first, last, catalog.values(),
                 holds, config["review_sources"], checkpoints=True,
                 sources=(row for row in catalog.values() if row["added"] == added_day))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("state", type=Path)
    parser.add_argument("output", type=Path, help="new private directory with an existing parent")
    parser.add_argument("start", type=date.fromisoformat)
    parser.add_argument("end", type=date.fromisoformat)
    parser.add_argument("--source", action="append", choices=PROVIDERS)
    args = parser.parse_args()
    if not args.start <= args.end < datetime.now(NY).date() or (args.end - args.start).days > 6:
        parser.error("Choose up to seven consecutive completed dates")
    if not args.state.is_dir() or args.state.stat().st_mode & 0o077 or args.output.exists():
        parser.error("Use an existing private state directory and a new output directory")
    d1 = D1(args.state / "checkout")
    catalog = d1.listings("publication")
    if not catalog:
        raise ValueError("Production publication inventory unavailable")
    holds = {row["id"] for row in d1.rows(REMOVALS["publication"], "publication removals")}
    holds.update((args.state / "hold-ids.txt").read_text().split())
    window = [row for row in catalog.values() if str(args.start) <= row["added"] <= str(args.end)]
    summary = stage(args.state, args.output, args.start, args.end, catalog.values(), holds,
                    args.source or PROVIDERS, sources=window)
    print(json.dumps(summary, sort_keys=True))
    return int(any(row.get("status") == "failed" for row in summary["sources"].values()))


if __name__ == "__main__":
    raise SystemExit(main())
