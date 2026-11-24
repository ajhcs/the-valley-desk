"""Emit a replayable D1 SQL import. Each listing and its index changes are atomic."""
import argparse
import contextlib
import io
import sys
from hashlib import sha256
import json
import re
import unicodedata
from pathlib import Path
from urllib.parse import unquote, urlsplit

DATASET_ID = re.compile(
    r"^(geo:GSE[0-9]+|bioproject:PRJ[A-Z]{2}[0-9]+|sra:[SED]RP[0-9]+|dbgap:phs[0-9]{6}|ega:EGA[SD][0-9]{11}"
    r"|pride:PXD[0-9]{6}|arrayexpress:E-[A-Z]{4}-[0-9]+|pdb-set:(doi:10\.[0-9]{4,}/\S+|pmid:[0-9]+|arxiv:\S+)"
    r"|doi:10\.[0-9]{4,}/[^A-Z\s]+)$")
DATA_TYPES = {"gene expression", "sequencing", "single-cell", "structure", "proteomics", "metabolomics",
              "imaging", "clinical and survey", "other"}
DATASET_FIELDS = set("id title summary data_type access repository accessions url institutions counties label "
                     "connection source papers topic released added checked size format license".split())


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
    if args.removals:
        removed = json.loads(args.removals.read_text())
        if not isinstance(removed, list) or not all(isinstance(i, str) and re.match(r"^(doi|pmid|arxiv):", i) for i in removed):
            raise ValueError("Expected an array of publication IDs")
        for identifier in removed:
            print("INSERT OR IGNORE INTO publication_removals(id) VALUES(" + quote(identifier) + ");")
    if args.study_removals:
        removed = json.loads(args.study_removals.read_text())
        if not isinstance(removed, list) or not all(isinstance(i, str) and re.fullmatch(r"NCT[0-9]{8}", i) for i in removed):
            raise ValueError("Expected an array of study IDs")
        for identifier in removed:
            print("INSERT OR IGNORE INTO study_removals(id) VALUES(" + quote(identifier) + ");")
    if args.dataset_removals:
        removed = json.loads(args.dataset_removals.read_text())
        if not isinstance(removed, list) or not all(isinstance(i, str) and DATASET_ID.match(i) for i in removed):
            raise ValueError("Expected an array of dataset IDs")
        for identifier in removed:
            print("INSERT OR IGNORE INTO dataset_removals(id) VALUES(" + quote(identifier) + ");")
    if args.regional_data_removals:
        removed = json.loads(args.regional_data_removals.read_text())
        if not isinstance(removed, list) or not all(isinstance(i, str) and re.fullmatch(r"regional:[a-z0-9]+(?:-[a-z0-9]+)*", i) for i in removed):
            raise ValueError("Expected an array of regional data IDs")
        for identifier in removed:
            print("INSERT OR IGNORE INTO regional_data_removals(id) VALUES(" + quote(identifier) + ");")
    if args.regional_data:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts" / "regional-data"))
        from validate import validate_records
        regional_records = json.loads(args.regional_data.read_text())
        validate_records(regional_records)
        for record in regional_records:
            emit(record, "regional-data", {}, args.respect_removals)
    institution_file = args.institutions or args.alias_reference
    if institution_file:
        content = institution_file.read_text().strip()
        refs = json.loads(content) if content.startswith("[") else [json.loads(line) for line in content.splitlines()]
        for ref in refs:
            for name in [ref["id"], ref["name"], *ref["aliases"]]:
                key = slug(name)
                if key in aliases and aliases[key] != ref["id"]:
                    raise ValueError("Ambiguous institution alias " + name)
                aliases[key] = ref["id"]
            if args.institutions:
                print("INSERT INTO research_institutions VALUES(" + quote(ref["id"]) + "," + quote(compact(ref)) +
                      ") ON CONFLICT(id) DO UPDATE SET record=excluded.record WHERE record<>excluded.record;")
    project_file = args.projects or args.project_upserts
    projects = json.loads(project_file.read_text()) if project_file else []
    if args.projects and not projects:
        raise ValueError("Expected the full nonempty project projection")
    for record in projects:
        emit(record, "project", aliases, args.respect_removals)
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
                    emit(json.loads(line), "publication", aliases, args.respect_removals)
    if args.studies:
        with args.studies.open() as source:
            for line in source:
                if line.strip():
                    emit(json.loads(line), "study", aliases, args.respect_removals)
    if args.datasets:
        with args.datasets.open() as source:
            for line in source:
                if line.strip():
                    emit(json.loads(line), "dataset", aliases, args.respect_removals)


def citation_key(url):
    if not url:
        return None
    parts = urlsplit(url)
    path = unquote(parts.path).strip("/")
    if parts.hostname == "doi.org":
        return "doi:" + path.lower()
    if parts.hostname == "pubmed.ncbi.nlm.nih.gov" and path.isdigit():
        return "pmid:" + path
    if parts.hostname == "pmc.ncbi.nlm.nih.gov" and re.fullmatch(r"articles/PMC[0-9]+", path):
        return "pmcid:" + path.split("/")[-1]
    if parts.hostname == "arxiv.org" and path.startswith("abs/"):
        return "arxiv:" + path[4:]
    return url.rstrip("/")


def check_dataset(r):
    """The dataset record contract. Every field is present; optional values are null."""
    https = lambda v: isinstance(v, str) and urlsplit(v).scheme == "https" and bool(urlsplit(v).hostname)
    day = lambda v: isinstance(v, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", v)
    strings = lambda v: isinstance(v, list) and all(isinstance(i, str) and i for i in v)
    if set(r) - {"paper_provenance"} != DATASET_FIELDS or not isinstance(r["id"], str) or not DATASET_ID.match(r["id"]):
        raise ValueError("Unexpected dataset fields or identity")
    problems = [
        not all(isinstance(r[k], str) and r[k].strip() for k in ("title", "summary", "repository", "connection", "topic")),
        r["data_type"] not in DATA_TYPES, r["access"] not in ("open", "registration", "controlled"),
        r["label"] not in ("Verified", "Listed"), not https(r["url"]), not https(r["source"]),
        not strings(r["accessions"]) or not r["accessions"], not strings(r["institutions"]) or not r["institutions"],
        not strings(r["counties"]), not strings(r["papers"]),
        r["released"] is not None and not re.fullmatch(r"[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?", str(r["released"])),
        not day(r["added"]), not day(r["checked"]),
        any(r[k] is not None and not (isinstance(r[k], str) and r[k].strip()) for k in ("size", "format", "license")),
    ]
    if any(problems):
        raise ValueError("Invalid dataset record " + r["id"])
    if "paper_provenance" in r:
        edges = r["paper_provenance"]
        if not isinstance(edges, list) or any(
            not isinstance(edge, dict) or set(edge) != {"paper", "relation"}
            or edge["paper"] not in r["papers"] or edge["relation"] not in ("produced", "linked")
            for edge in edges
        ) or len({edge["paper"] for edge in edges}) != len(edges):
            raise ValueError("Invalid dataset paper provenance " + r["id"])


def emit(r, kind, aliases, respect_removals=False):
    pub = kind == "publication"
    study = kind == "study"
    dataset = kind == "dataset"
    if dataset:
        check_dataset(r)
    if pub:
        allowed = set("id title type published venue doi pmid pmcid arxiv url authors author_count institutions counties topic terms label connection source open_access projects preprint_of published_as retracted added checked".split())
        if set(r) - allowed or any(set(a) - {"name", "orcid", "regional"} for a in r["authors"]):
            raise ValueError("Unexpected fields for " + r["id"])
        if r.get("open_access") and set(r["open_access"]) - {"status", "license", "url"}:
            raise ValueError("Unexpected open access fields")
        if not re.match(r"^(doi:10\.\d{4,}/.+|pmid:\d+|arxiv:.+)$", r["id"]):
            raise ValueError("Unsupported publication identifier")
        if not r["authors"] or not r["institutions"] or r["label"] not in ("Verified", "Listed"):
            raise ValueError("Missing byline or regional evidence for " + r["id"])
    if study:
        allowed = set("id title type status phases first_posted last_updated conditions sites institutions counties source url label connection added checked".split())
        sites = set("facility city state zip county status".split())
        if set(r) != allowed or not re.fullmatch(r"NCT[0-9]{8}", r["id"]) or not r["sites"]:
            raise ValueError("Unexpected study fields or identity")
        if any(set(site) != sites for site in r["sites"]) or r["source"] != "https://clinicaltrials.gov/study/" + r["id"] or r["url"] != r["source"]:
            raise ValueError("Invalid registry evidence for " + r["id"])
    regional = kind == "regional-data"
    listed = pub or study or dataset or regional
    title = r["title" if listed else "name"]
    institutions = [] if regional else (r["institutions"] if listed else [r.get("institution")])
    counties = r["counties"] if listed else [r.get("county")]
    topic = r.get("topic", "")
    facets = {"institution": [aliases.get(slug(v), slug(v)) for v in institutions if v],
              "county": [slug(v) for v in counties if v], "topic": [slug(topic)] if topic else [],
              "project": r.get("projects", []), "label": [slug(r["label"])] if not regional else []}
    if pub:
        facets["version"] = [v for v in [r["published_as"], r["preprint_of"]] if v]
        alternate = {citation_key(r["url"]), citation_key(r["source"])}
        alternate.update(key + ":" + r[key] for key in ("pmid", "pmcid", "arxiv", "doi") if r.get(key))
        facets["alternate"] = sorted(alternate - {r["id"], None})
    elif dataset:
        # Publication pages find the datasets they produced through the paper facet.
        facets.update(access=[r["access"]], datatype=[slug(r["data_type"])],
                      repository=[slug(r["repository"])], paper=sorted(set(r["papers"])))
    elif not study and not regional:
        identifiers = {citation_key(r.get("paper"))}
        for paper in r.get("papers") or []:
            identifiers.add(citation_key(paper.get("url")))
            if paper.get("doi"):
                identifiers.add("doi:" + paper["doi"].lower())
        facets["paper"] = sorted(identifiers - {None})
    keys = [r["id"], topic, *filter(None, institutions + counties),
            *r.get("terms", []), *r.get("topics", []), r.get("purpose"), r.get("language"), r.get("venue")]
    if study:
        keys.extend([*r["conditions"], *(site["facility"] for site in r["sites"])])
    if regional:
        keys.extend([r["summary"], r["publisher"], r["portal"]])
        facets.update(access=[r["access"]], publisher=[slug(r["publisher"])])
    if dataset:
        keys.extend([r["summary"], *r["accessions"], r["repository"], r["data_type"]])
    # Store facet keys with the row so a single upsert updates all index projections.
    payload = compact(r)
    activity = r.get("published") or r.get("pushed") or r.get("last_updated") or r.get("updated") or r.get("released") or ""
    fields = [r["id"], kind, title, r.get("added") or "", activity,
              topic, (r.get("published_as") or r.get("preprint_of") or "?" + r["id"]) if r.get("type") == "preprint" else r["id"],
              " ".join(filter(None, keys)), payload, compact(facets)]
    insert = "INSERT INTO research_listings(id,kind,title,added,activity,topic,work_id,keywords,record,facets) "
    update = (" ON CONFLICT(id) DO UPDATE SET " +
              ",".join(k+"=excluded."+k for k in ("title","activity","topic","work_id","keywords","facets")) +
              ",record=json_set(excluded.record,'$.added',research_listings.added) " +
              "WHERE (record<>json_set(excluded.record,'$.added',research_listings.added) OR facets<>excluded.facets) AND " +
              "(excluded.kind='project' OR json_extract(excluded.record,'$.checked') >= json_extract(research_listings.record,'$.checked'));")
    guard = "true"
    if respect_removals:
        tables = {"project": ("public_directory_removals", "github_id"),
                  "publication": ("publication_removals", "id"), "study": ("study_removals", "id"),
                  "dataset": ("dataset_removals", "id"), "regional-data": ("regional_data_removals", "id")}
        table, key = tables[kind]
        identities = [r["id"], *(facets["alternate"] if pub else [])]
        guard = f"NOT EXISTS(SELECT 1 FROM {table} WHERE {key} IN ({','.join(map(quote, identities))}))"
    values = ",".join(map(quote, fields))
    sql = insert + (f"SELECT {values} WHERE {guard}" if respect_removals else f"VALUES({values})") + update
    if len(sql.encode()) <= 100000:
        print(sql)
        return

    serialized = compact(fields)
    digest = quote(sha256(serialized.encode()).hexdigest())
    chunks = [serialized[i:i+16000] for i in range(0, len(serialized), 16000)]
    for number, chunk in enumerate(chunks):
        print(f"INSERT OR IGNORE INTO research_import_chunks VALUES({digest},{number},{quote(chunk)});")
    # An incomplete assembly produces NULL required fields and fails before publication.
    assembly = (f"SELECT CASE WHEN count(*)={len(chunks)} THEN group_concat(piece,'') ELSE '[]' END AS data "
                f"FROM (SELECT piece FROM research_import_chunks WHERE digest={digest} ORDER BY part)")
    select = ",".join(f"json_extract(data,'$[{i}]')" for i in range(len(fields)))
    print(insert + f"SELECT {select} FROM ({assembly}) WHERE {guard}" + update)
    print(f"DELETE FROM research_import_chunks WHERE digest={digest};")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("projects", "publications", "institutions", "removals", "studies", "study-removals", "datasets", "dataset-removals", "regional-data", "regional-data-removals"):
        parser.add_argument("--" + flag, type=Path)
    parser.add_argument("--project-upserts", type=Path, help="Apply project additions and edits without pruning the catalog")
    parser.add_argument("--alias-reference", type=Path, help="Canonicalize institution facets without loading the reference")
    parser.add_argument("--respect-removals", action="store_true",
                        help="Exclude recorded removals, including publication alternate IDs, at write time")
    args = parser.parse_args()
    if args.projects and args.project_upserts:
        parser.error("Choose a full project projection or project upserts")
    if args.projects and args.respect_removals:
        parser.error("Use project upserts when retaining the current catalog")
    if args.institutions and args.alias_reference:
        parser.error("Choose one institution reference input")
    # Buffer every statement so invalid inputs cannot emit a partial import.
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        load(args)
    sys.stdout.write(output.getvalue())
