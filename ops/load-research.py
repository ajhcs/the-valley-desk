"""Emit a replayable D1 SQL import. Each listing and its index changes are atomic."""
import argparse
import json
import re
import unicodedata
from pathlib import Path


def slug(value):
    return "-".join(re.findall(r"[^\W_]+", unicodedata.normalize("NFKC", value).lower()))


def quote(value):
    if "\0" in value:
        raise ValueError("NUL in SQL input")
    return "'" + value.replace("'", "''") + "'"


def compact(record):
    return json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def load(args):
    aliases = {}
    if args.institutions:
        content = args.institutions.read_text().strip()
        refs = json.loads(content) if content.startswith("[") else [json.loads(line) for line in content.splitlines()]
        for ref in refs:
            for name in [ref["id"], ref["name"], *ref["aliases"]]:
                aliases[slug(name)] = ref["id"]
            print("INSERT INTO research_institutions VALUES(" + quote(ref["id"]) + "," + quote(compact(ref)) +
                  ") ON CONFLICT(id) DO UPDATE SET record=excluded.record WHERE record<>excluded.record;")
    projects = json.loads(args.projects.read_text()) if args.projects else []
    for record in projects:
        emit(record, "project", aliases)
    if args.projects:
        ids = compact([r["id"] for r in projects])
        prune = ("DELETE FROM research_listings WHERE kind='project' AND id NOT IN "
                 "(SELECT value FROM json_each(" + quote(ids) + "));")
        if len(prune.encode()) > 100000:
            raise ValueError("Project roster exceeds the single-statement synchronization limit")
        print(prune)
    if args.publications:
        with args.publications.open() as source:
            for line in source:
                if line.strip():
                    emit(json.loads(line), "publication", aliases)


def emit(r, kind, aliases):
    pub = kind == "publication"
    if pub:
        allowed = set("id title type published venue doi pmid pmcid arxiv url authors author_count institutions counties topic terms label connection source open_access projects preprint_of published_as retracted added checked".split())
        if set(r) - allowed or any(set(a) - {"name", "orcid", "regional"} for a in r["authors"]):
            raise ValueError("Unexpected fields for " + r["id"])
        if r.get("open_access") and set(r["open_access"]) - {"status", "license", "url"}:
            raise ValueError("Unexpected open access fields")
        if not re.match(r"^(doi:10\.\d{4,9}/.+|pmid:\d+|arxiv:.+)$", r["id"]):
            raise ValueError("Unsupported publication identifier")
        if not r["authors"] or not r["institutions"] or r["label"] not in ("Verified", "Listed"):
            raise ValueError("Missing byline or regional evidence for " + r["id"])
    title = r["title" if pub else "name"]
    institutions = r["institutions"] if pub else [r.get("institution")]
    counties = r["counties"] if pub else [r.get("county")]
    facets = {"institution": [aliases.get(slug(v), slug(v)) for v in institutions if v],
              "county": [slug(v) for v in counties if v], "topic": [slug(r["topic"])],
              "project": r.get("projects", []), "label": [slug(r["label"])]}
    if not pub:
        identifiers = set()
        for paper in [*r.get("papers", []), {"url": r.get("paper")}]:
            url = paper.get("url") or ""
            doi = paper.get("doi") or (url[16:] if url.lower().startswith("https://doi.org/") else None)
            if doi:
                identifiers.add("doi:" + doi.lower())
            pmid = re.fullmatch(r"https://pubmed.ncbi.nlm.nih.gov/(\d+)/?", url)
            if pmid:
                identifiers.add("pmid:" + pmid[1])
        facets["paper"] = sorted(identifiers)
    keys = [r["id"], r["topic"], *filter(None, institutions + counties),
            *r.get("terms", []), *r.get("topics", []), r.get("purpose"), r.get("language"), r.get("venue")]
    # Store facet keys with the row so a single upsert updates all index projections.
    payload = compact(r)
    fields = [r["id"], kind, title, r.get("added") or "", r.get("published") or r.get("pushed") or r.get("updated") or "",
              r["topic"], (r.get("published_as") or r.get("preprint_of") or r["id"]) if r.get("type") == "preprint" else r["id"],
              " ".join(filter(None, keys)), payload, compact(facets)]
    sql = ("INSERT INTO research_listings(id,kind,title,added,activity,topic,work_id,keywords,record,facets) VALUES(" +
           ",".join(map(quote, fields)) + ") ON CONFLICT(id) DO UPDATE SET " +
           ",".join(k+"=excluded."+k for k in ("title","activity","topic","work_id","keywords","facets")) +
           ",record=json_set(excluded.record,'$.added',research_listings.added) " +
           "WHERE (record<>json_set(excluded.record,'$.added',research_listings.added) OR facets<>excluded.facets) AND " +
           "(excluded.kind='project' OR json_extract(excluded.record,'$.checked') >= json_extract(research_listings.record,'$.checked'));")
    if len(sql.encode()) > 100000:
        raise ValueError("D1 statement too large for " + r["id"])
    print(sql)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("projects", "publications", "institutions"):
        parser.add_argument("--" + flag, type=Path)
    load(parser.parse_args())
