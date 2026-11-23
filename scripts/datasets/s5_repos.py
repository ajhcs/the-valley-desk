"""Stage 5: repository records for every produced unit (and for code-candidate DOIs).

Only the fields needed for listings are cached (no contact names, emails or phone numbers):
repo-cache/<kind>/<key>.json.gz = {"ok": bool, "status": int, ...fields}.
"""
import json
import os
import re
import sys
import urllib.parse
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import http, read_gz_json, read_jsonl, save_counts, strip_markup, work_dir, write_gz_json

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
TOOL = {"tool": "valley-desk-research", "retmode": "json"}
WORK = work_dir()
CACHE = WORK / "repo-cache"


def cpath(kind, key):
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", key)
    return CACHE / kind / f"{safe}.json.gz"


def cached(kind, key):
    p = cpath(kind, key)
    return read_gz_json(p) if p.exists() else None


def store(kind, key, rec):
    write_gz_json(cpath(kind, key), rec)
    return rec


def bioproject_publications(body):
    """Extract only project accessions and their explicit PubMed citations."""
    root = ET.fromstring(body)
    if root.tag != 'RecordSet':
        raise ValueError('unexpected BioProject XML root')
    found = {}
    for project in root.findall('.//DocumentSummary/Project'):
        node = project.find('./ProjectID/ArchiveID')
        accession = (node.get('accession') or '').upper() if node is not None else ''
        if not accession:
            continue
        citations = []
        for pub in project.findall('./ProjectDescr/Publication'):
            pmid = (pub.get('id') or '').strip()
            if (pub.findtext('DbType') or '').lower() == 'epubmed' and pmid.isdigit():
                citations.append({'pmid': pmid})
        found[accession] = citations
    return found


def sra_publications(body, requested):
    """Map requested accessions to citations attached to their SRA study."""
    root = ET.fromstring(body)
    if root.tag != 'EXPERIMENT_PACKAGE_SET':
        raise ValueError('unexpected SRA XML root')
    requested = {a.upper() for a in requested}
    found = {}
    for package in root.findall('./EXPERIMENT_PACKAGE'):
        studies = package.findall('./STUDY')
        if len(studies) != 1:
            continue
        citations = []
        for link in studies[0].findall('./STUDY_LINKS/STUDY_LINK/XREF_LINK'):
            db = (link.findtext('DB') or '').strip().lower()
            value = (link.findtext('ID') or '').strip()
            if db in ('pubmed', 'pmid') and value.isdigit():
                citations.append({'pmid': value})
            elif db == 'doi' and re.fullmatch(r'10\.\d{4,9}/\S+', value, re.I):
                citations.append({'doi': value})
        # Only accession attributes identify the package; ignore unrelated links.
        accessions = {e.get('accession', '').upper() for tag in ('STUDY', 'EXPERIMENT', 'SAMPLE', 'SUBMISSION', 'RUN')
                      for e in package.findall('.//' + tag)}
        accessions.update((e.text or '').strip().upper() for e in package.findall('./SAMPLE/IDENTIFIERS/EXTERNAL_ID')
                          if (e.get('namespace') or '').lower() == 'biosample')
        for accession in requested & accessions:
            existing = found.setdefault(accession, [])
            for citation in citations:
                if citation not in existing:
                    existing.append(citation)
    return found


def enrich_publication_metadata():
    """Enrich existing cache records in batches, without persisting raw XML."""
    for kind, db, parser in (('bioproject', 'bioproject', bioproject_publications),
                             ('sra', 'sra', sra_publications)):
        directory = CACHE / kind
        accessions = sorted(p.name[:-8] for p in directory.glob('*.json.gz')
                            if (read_gz_json(p) or {}).get('ok') and 'citations' not in read_gz_json(p))
        completed = failed = 0
        for i in range(0, len(accessions), 20):
            batch = accessions[i:i + 20]
            status, body = http(EUTILS + 'efetch.fcgi', data={'db': db, 'id': ','.join(batch),
                                'retmode': 'xml', 'tool': TOOL['tool']})
            try:
                found = parser(body, batch) if kind == 'sra' else parser(body)
                if status != 200:
                    found = {}
            except (ET.ParseError, ValueError):
                found = {}
            missing = [a for a in batch if a not in found]
            # Some external accessions resolve through Entrez search but not efetch directly.
            if missing and kind == 'bioproject':
                status2, data = http(EUTILS + 'esearch.fcgi', data={'db': db, 'term': ' OR '.join(a + '[PRJA]' for a in missing),
                                     'retmax': 20, **TOOL})
                try:
                    ids = json.loads(data)['esearchresult']['idlist'] if status2 == 200 else []
                    if ids:
                        status2, data = http(EUTILS + 'efetch.fcgi', data={'db': db, 'id': ','.join(ids),
                                             'retmode': 'xml', 'tool': TOOL['tool']})
                        if status2 == 200:
                            found.update(bioproject_publications(data))
                except (KeyError, ValueError, ET.ParseError):
                    pass
            elif missing and kind == 'sra':
                for acc in missing:
                    status2, data = http(EUTILS + 'esearch.fcgi', data={'db': db, 'term': acc + '[ACCN]',
                                         'retmax': 1, **TOOL})
                    try:
                        ids = json.loads(data)['esearchresult']['idlist'] if status2 == 200 else []
                        if ids:
                            status2, data = http(EUTILS + 'efetch.fcgi', data={'db': db, 'id': ids[0],
                                                 'retmode': 'xml', 'tool': TOOL['tool']})
                            if status2 == 200:
                                found.update(sra_publications(data, [acc]))
                    except (KeyError, ValueError, ET.ParseError):
                        pass
            for acc in batch:
                if acc not in found:
                    failed += 1
                    continue  # Keep prior record and distinguish missing metadata from an empty citation list.
                rec = cached(kind, acc)
                rec['citations'] = found[acc]
                rec['citation_source'] = {'database': db, 'method': 'efetch', 'status': status}
                store(kind, acc, rec)
                completed += 1
        print(kind, 'citation metadata', completed, 'unresolved', failed, flush=True)
    save_counts('publication-metadata')


def gdate(s):
    for fmt in ("%b %d %Y", "%Y/%m/%d %H:%M", "%Y/%m/%d", "%Y-%m-%d"):
        try:
            return datetime.strptime(s.strip(), fmt).strftime("%Y-%m-%d")
        except (ValueError, AttributeError):
            pass
    return None


# ---------------- GEO ----------------
def geo_text(acc):
    url = f"https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={acc}&targ=self&form=text&view=brief"
    status, body = http(url)
    return status, body.decode("utf-8", "replace")


def geo_series(acc):
    rec = cached("geo", acc)
    if rec is not None and 'citations' in rec:
        return rec
    status, text = geo_text(acc)
    if status != 200 or "!Series_title" not in text:
        if rec is not None:
            return rec
        return store("geo", acc, {"ok": False, "status": status, "note": "no public series record"})
    f = {}
    for line in text.splitlines():
        m = re.match(r"!Series_(\w+(?:/\w+)?) = (.*)", line)
        if m:
            f.setdefault(m.group(1), []).append(m.group(2).strip())
    one = lambda k: (f.get(k) or [""])[0]
    rel = f.get("relation", [])
    status_line = one("status")
    rec = {"ok": True, "acc": acc, "title": one("title"), "summary": " ".join(f.get("summary", [])),
           "design": " ".join(f.get("overall_design", [])), "types": f.get("type", []),
           "status_line": status_line, "public": status_line.startswith("Public on"),
           "released": gdate(status_line.replace("Public on", "")) if status_line.startswith("Public on") else None,
           "submitted": gdate(one("submission_date")), "institute": one("contact_institute"),
           "department": one("contact_department"), "city": one("contact_city"), "state": one("contact_state"),
           "country": one("contact_country"), "n_samples": len(f.get("sample_id", [])),
           "superseries_of": [r.split(":", 1)[1].strip() for r in rel if r.startswith("SuperSeries of")],
           "subseries_of": [r.split(":", 1)[1].strip() for r in rel if r.startswith("SubSeries of")],
           "bioproject": [r.rsplit("/", 1)[-1] for r in rel if r.startswith("BioProject")],
           "sra": [r.rsplit("=", 1)[-1] for r in rel if r.startswith("SRA")],
           "organisms": sorted(set(f.get("sample_organism", []) or f.get("platform_organism", []))),
           "citations": [{"pmid": x} for x in f.get("pubmed_id", []) if x.isdigit()]}
    return store("geo", acc, rec)


def geo_sample(acc):
    rec = cached("geo-sample", acc)
    if rec is not None:
        return rec
    status, text = geo_text(acc)
    series = re.findall(r"^!Sample_series_id = (GSE\d+)", text, re.M)
    return store("geo-sample", acc, {"ok": bool(series), "status": status, "series": series})


def geo_gds(acc):
    rec = cached("geo-gds", acc)
    if rec is not None:
        return rec
    status, body = http(EUTILS + "esearch.fcgi?" + urllib.parse.urlencode({"db": "gds", "term": f"{acc}[ACCN]", **TOOL}))
    ids = json.loads(body)["esearchresult"]["idlist"] if status == 200 else []
    series = []
    if ids:
        status, body = http(EUTILS + "esummary.fcgi?" + urllib.parse.urlencode({"db": "gds", "id": ids[0], **TOOL}))
        if status == 200:
            d = json.loads(body)["result"].get(ids[0], {})
            series = ["GSE" + x for x in re.split(r"[;, ]+", d.get("gse", "")) if x]
    return store("geo-gds", acc, {"ok": bool(series), "series": series})


# ENA returnFields identifies first_public as "date when made public". The
# partner's public date is evidence of public availability, not registration.
def ena_public_dates(kind, accessions):
    result, field = ('study', 'study_accession') if kind == 'bioproject' else ('read_run', 'run_accession')
    pattern = r'PRJ(?:NA|EB|DB)\d+' if kind == 'bioproject' else r'[SED]RR\d+'
    todo = [a for a in accessions if re.fullmatch(pattern, a) and
            (cached(kind, a) or {}).get('ok') and not (cached(kind, a) or {}).get('released')]
    for i in range(0, len(todo), 40):
        batch = todo[i:i + 40]
        query = ' OR '.join(f'{field}="{a}"' for a in batch)
        url = 'https://www.ebi.ac.uk/ena/portal/api/search?' + urllib.parse.urlencode({
            'result': result, 'query': query, 'fields': f'{field},first_public',
            'format': 'json', 'limit': len(batch)})
        status, body = http(url)
        if status != 200:
            continue
        try:
            records = json.loads(body)
        except (ValueError, TypeError):
            continue
        for record in records if isinstance(records, list) else []:
            if not isinstance(record, dict):
                continue
            acc = record.get(field, '').upper()
            value = gdate(record.get('first_public', ''))
            if acc in batch and value:
                rec = cached(kind, acc)
                if rec and rec.get('ok') and not rec.get('released'):
                    store(kind, acc, {**rec, 'released': value,
                                      'release_source': 'ENA Portal API first_public'})


# ---------------- BioProject / SRA / assembly ----------------
def bioprojects(accs):
    todo = [a for a in accs if cached("bioproject", a) is None]
    for i in range(0, len(todo), 50):
        batch = todo[i:i + 50]
        term = " OR ".join(f"{a}[PRJA]" for a in batch)
        status, body = http(EUTILS + "esearch.fcgi", data={"db": "bioproject", "term": term, "retmax": 200, **TOOL})
        ids = json.loads(body)["esearchresult"]["idlist"] if status == 200 else []
        found = {}
        if ids:
            status, body = http(EUTILS + "esummary.fcgi", data={"db": "bioproject", "id": ",".join(ids), **TOOL})
            if status == 200:
                res = json.loads(body)["result"]
                for uid in res.get("uids", []):
                    d = res[uid]
                    found[d.get("project_acc", "").upper()] = {
                        "ok": True, "acc": d.get("project_acc"), "title": d.get("project_title") or d.get("project_name"),
                        "description": d.get("project_description", ""), "data_type": d.get("project_data_type", ""),
                        "method": d.get("project_methodtype", ""), "registered": gdate(d.get("registration_date", "")),
                        "submitter": d.get("submitter_organization", ""),
                        "submitters": d.get("submitter_organization_list", []), "organism": d.get("organism_name", ""),
                        "project_type": d.get("project_type", "")}
        for a in batch:
            store("bioproject", a, found.get(a, {"ok": False, "note": "not found in BioProject"}))
    return {a: cached("bioproject", a) for a in accs}


def sra_resolve(accs):
    """Map SRA run/experiment/sample/study accessions to their study and BioProject."""
    todo = [a for a in accs if cached("sra", a) is None]
    studies = [a for a in todo if re.fullmatch(r"[SED]R[PA]\d+", a)]
    others = [a for a in todo if a not in studies]
    groups = [[a] for a in studies] + [others[i:i + 40] for i in range(0, len(others), 40)]
    for batch in groups:
        term = " OR ".join(f"{a}[ACCN]" if not a.startswith("SAM") else f"{a}" for a in batch)
        status, body = http(EUTILS + "esearch.fcgi", data={"db": "sra", "term": term, "retmax": 1 if len(batch) == 1 else 500, **TOOL})
        ids = json.loads(body)["esearchresult"]["idlist"] if status == 200 else []
        hits = {}
        for j in range(0, len(ids), 200):
            status, body = http(EUTILS + "esummary.fcgi", data={"db": "sra", "id": ",".join(ids[j:j + 200]), **TOOL})
            if status != 200:
                continue
            res = json.loads(body)["result"]
            for uid in res.get("uids", []):
                d = res[uid]; x = d.get("expxml", "") + d.get("runs", "")
                study = re.search(r'<Study acc="([^"]+)"(?: name="([^"]*)")?', x)
                bp = re.search(r"<Bioproject>([^<]+)</Bioproject>", x)
                center = re.search(r'center_name="([^"]*)"', x)
                info = {"ok": True, "study": study.group(1) if study else None,
                        "study_title": strip_markup(study.group(2)) if study and study.group(2) else "",
                        "bioproject": bp.group(1) if bp else None, "center": center.group(1) if center else "",
                        "strategy": (re.search(r"<LIBRARY_STRATEGY>([^<]+)", x) or [None, ""])[1],
                        "created": gdate(d.get("createdate", ""))}
                for a in batch:
                    if re.search(r'"%s"|>%s<' % (re.escape(a), re.escape(a)), x):
                        hits[a] = info
        for a in batch:
            store("sra", a, hits.get(a, {"ok": False, "note": "not found in SRA"}))
    return {a: cached("sra", a) for a in accs}


def assemblies(accs):
    for a in accs:
        if cached("assembly", a) is not None:
            continue
        status, body = http(EUTILS + "esearch.fcgi?" + urllib.parse.urlencode({"db": "assembly", "term": f"{a}[Assembly Accession]", **TOOL}))
        ids = json.loads(body)["esearchresult"]["idlist"] if status == 200 else []
        rec = {"ok": False, "note": "assembly not found"}
        if ids:
            status, body = http(EUTILS + "esummary.fcgi?" + urllib.parse.urlencode({"db": "assembly", "id": ids[0], **TOOL}))
            if status == 200:
                d = json.loads(body)["result"].get(ids[0], {})
                bps = [g.get("bioprojectaccn") for g in d.get("gb_bioprojects", []) if g.get("bioprojectaccn")]
                rec = {"ok": True, "bioprojects": bps, "name": d.get("assemblyname"), "organism": d.get("organism"),
                       "submitter": d.get("submitterorganization", ""), "released": gdate(d.get("seqreleasedate", "") or "")}
        store("assembly", a, rec)


# ---------------- dbGaP ----------------
def dbgap(phs):
    rec = cached("dbgap", phs)
    if rec is not None:
        return rec
    rec = {"ok": False}
    status, body = http(f"https://dbgap-api.ncbi.nlm.nih.gov/fhir/x1/ResearchStudy?_id={phs}&_format=json", timeout=120)
    if status == 200:
        d = json.loads(body)
        if d.get("entry"):
            r = d["entry"][0]["resource"]
            ext = {e.get("url", "").rsplit("-", 1)[-1]: e for e in r.get("extension", [])}
            rec = {"ok": True, "title": r.get("title", ""), "description": r.get("description", ""),
                   "released": (ext.get("ReleaseDate") or {}).get("valueDate"),
                   "sponsor": (r.get("sponsor") or {}).get("display", "")}
    status, body = http(f"https://www.ncbi.nlm.nih.gov/projects/gap/cgi-bin/study.cgi?study_id={phs}")
    if status == 200:
        s = body.decode("utf-8", "replace")
        i = s.find("Principal Investigator")
        if i >= 0:
            block = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s[i:i + 4000]))
            block = re.split(r"Co-Investigator|Other Investigator|Lead Scientific|Funding Source|Supporting Organization|Collaborator|Sub-Study|Study Accession|Release Date", block)[0]
            # Keep the institution clauses only: "Name, degree. Institution, City, ST, Country."
            rec["pi_affiliations"] = [p.strip() for p in re.split(r"(?<=USA)\.|(?<=Canada)\.|(?<=UK)\.", block) if p.strip()][:8]
            rec["pi_block"] = block[:1500]
        if not rec.get("title"):
            m = re.search(r"<title>([^<]+)</title>", s)
            rec["title"] = strip_markup(m.group(1)) if m else ""
            rec["ok"] = bool(rec["title"])
    return store("dbgap", phs, rec)


# ---------------- EGA ----------------

def ega_pi_affiliations(metadata):
    result = []
    for key in ('principal_investigator', 'principal_investigators'):
        value = metadata.get(key)
        for investigator in value if isinstance(value, list) else [value]:
            if isinstance(investigator, str):
                result.append(investigator)
            elif isinstance(investigator, dict):
                affiliation = investigator.get('affiliation') or investigator.get('institution')
                if isinstance(affiliation, str):
                    result.append(affiliation)
    for field in ('description', 'abstract'):
        text = metadata.get(field) or ''
        # Free text qualifies only where EGA explicitly labels an investigator.
        result.extend(re.findall(r'(?im)^\s*principal investigators?\s*:\s*([^\n]{1,350})', text))
    return list(dict.fromkeys(result))


def ega(acc):
    rec = cached("ega", acc)
    if rec is not None:
        return rec
    kind = "studies" if acc.startswith("EGAS") else "datasets"
    status, body = http(f"https://metadata.ega-archive.org/{kind}/{acc}")
    if status != 200:
        return store("ega", acc, {"ok": False, "status": status})
    d = json.loads(body)
    return store("ega", acc, {"ok": True, "title": d.get("title", ""), "description": d.get("description") or d.get("abstract") or "",
                              "released": (d.get("released_date") or "")[:10] or None, "study_type": d.get("study_type") or d.get("dataset_types"),
                              "kind": kind, "pi_affiliations": ega_pi_affiliations(d)})


# ---------------- PRIDE ----------------
def pride(acc):
    rec = cached("pride", acc)
    if rec is not None:
        return rec
    status, body = http(f"https://www.ebi.ac.uk/pride/ws/archive/v3/projects/{acc}")
    if status != 200:
        return store("pride", acc, {"ok": False, "status": status})
    d = json.loads(body)
    affs = [p.get("affiliation", "") for p in (d.get("submitters") or []) + (d.get("labPIs") or [])]
    return store("pride", acc, {"ok": True, "title": d.get("title", ""), "description": d.get("projectDescription", ""),
                                "released": d.get("publicationDate"), "submitted": d.get("submissionDate"),
                                "affiliations": [a for a in affs if a], "license": d.get("license"),
                                "submitter_affiliations": [p.get("affiliation", "") for p in d.get("submitters") or []],
                                "pi_affiliations": [p.get("affiliation", "") for p in d.get("labPIs") or []]})


# ---------------- PDB / EMDB ----------------
def pdb_entries(ids):
    todo = [i for i in ids if cached("pdb", i) is None or 'citations' not in cached("pdb", i)]
    for k in range(0, len(todo), 50):
        batch = todo[k:k + 50]
        q = '{entries(entry_ids:%s){rcsb_id struct{title} rcsb_accession_info{initial_release_date} exptl{method} rcsb_primary_citation{pdbx_database_id_PubMed pdbx_database_id_DOI}}}' % json.dumps(batch)
        status, body = http("https://data.rcsb.org/graphql", data=json.dumps({"query": q}).encode(), accept="application/json",
                            content_type="application/json")
        got = {}
        if status == 200:
            for e in (json.loads(body).get("data") or {}).get("entries") or []:
                if e:
                    got[e["rcsb_id"].upper()] = {"ok": True, "title": (e.get("struct") or {}).get("title", ""),
                                                 "released": ((e.get("rcsb_accession_info") or {}).get("initial_release_date") or "")[:10] or None,
                                                 "method": [x.get("method") for x in e.get("exptl") or []],
                                                 "citations": [{"pmid": (e.get("rcsb_primary_citation") or {}).get("pdbx_database_id_PubMed"),
                                                                "doi": (e.get("rcsb_primary_citation") or {}).get("pdbx_database_id_DOI")} ] if e.get("rcsb_primary_citation") else []}
        for i in batch:
            store("pdb", i, got.get(i) or cached("pdb", i) or {"ok": False, "note": "not released in PDB"})


def emdb(acc):
    rec = cached("emdb", acc)
    if rec is not None:
        return rec
    status, body = http(f"https://www.ebi.ac.uk/emdb/api/entry/{acc}")
    if status != 200:
        return store("emdb", acc, {"ok": False, "status": status})
    d = json.loads(body); adm = d.get("admin", {})
    kd = adm.get("key_dates", {})
    return store("emdb", acc, {"ok": True, "title": adm.get("title", ""), "released": (kd.get("map_release") or kd.get("header_release") or "")[:10] or None})


# ---------------- ArrayExpress (BioStudies) ----------------
def arrayexpress(acc):
    rec = cached("arrayexpress", acc)
    if rec is not None:
        return rec
    status, body = http(f"https://www.ebi.ac.uk/biostudies/api/v1/studies/{acc}")
    if status != 200:
        return store("arrayexpress", acc, {"ok": False, "status": status})
    d = json.loads(body)
    attrs = {a.get("name"): a.get("value") for a in d.get("attributes", [])}
    sec = d.get("section", {})
    sattrs = {a.get("name"): a.get("value") for a in sec.get("attributes", [])}
    orgs = []

    def walk(s):
        if isinstance(s, list):
            for x in s: walk(x)
        elif isinstance(s, dict):
            if (s.get("type") or "").lower() in ("organization", "organisation"):
                orgs.extend(a.get("value") for a in s.get("attributes", []) if a.get("name") == "Name")
            for x in s.get("subsections", []) or []: walk(x)
    walk(sec)
    return store("arrayexpress", acc, {"ok": True, "title": sattrs.get("Title") or attrs.get("Title", ""),
                                       "description": sattrs.get("Description", ""), "released": attrs.get("ReleaseDate"),
                                       "study_type": sattrs.get("Study type", ""), "organizations": orgs})


# ---------------- DataCite DOI ----------------
def datacite_record(attrs):
    a = attrs
    creators = a.get("creators") or []
    return {"ok": True, "doi": a.get("doi", "").lower(), "title": ((a.get("titles") or [{}])[0] or {}).get("title", ""),
            "descriptions": [d.get("description", "") for d in a.get("descriptions") or [] if d.get("description")],
            "description_types": [d.get("descriptionType") for d in a.get("descriptions") or [] if d.get("description")],
            "year": a.get("publicationYear"), "dates": a.get("dates") or [], "published": a.get("published"),
            "rights": a.get("rightsList") or [], "sizes": a.get("sizes") or [], "formats": a.get("formats") or [],
            "types": a.get("types") or {}, "publisher": a.get("publisher") if isinstance(a.get("publisher"), str) else (a.get("publisher") or {}).get("name"),
            "affiliations": [{"name": f.get("name", ""), "id": f.get("affiliationIdentifier", "")}
                             for c in creators for f in (c.get("affiliation") or []) if isinstance(f, dict)],
            "related": [{"type": r.get("relationType"), "id": r.get("relatedIdentifier")} for r in a.get("relatedIdentifiers") or []],
            "subjects": [s.get("subject", "") for s in a.get("subjects") or []], "url": a.get("url"),
            "version_of_count": a.get("versionOfCount")}


def doi(d):
    rec = cached("doi", d)
    if rec is not None:
        return rec
    status, body = http("https://api.datacite.org/dois/" + urllib.parse.quote(d, safe="/") + "?affiliation=true",
                        accept="application/vnd.api+json")
    if status != 200:
        return store("doi", d, {"ok": False, "status": status, "note": "not found in DataCite"})
    return store("doi", d, datacite_record(json.loads(body)["data"]["attributes"]))


def main():
    rows = read_jsonl(WORK / "mentions-classified.jsonl")
    want = [r for r in rows if r["decision"] in ("produced", "code")]
    by = {}
    for r in want:
        by.setdefault(r["unit_type"], set()).add(r["unit"])
    print({k: len(v) for k, v in by.items()}, flush=True)
    pool = ThreadPoolExecutor(3)
    # GEO samples / GDS -> series first
    for acc in sorted(by.get("geo-sample", [])):
        geo_sample(acc)
    for acc in sorted(by.get("geo-gds", [])):
        geo_gds(acc)
    series = set(by.get("geo", set()))
    series |= {s for a in by.get("geo-sample", []) for s in (cached("geo-sample", a) or {}).get("series", [])[:1]}
    series |= {s for a in by.get("geo-gds", []) for s in (cached("geo-gds", a) or {}).get("series", [])[:1]}
    list(pool.map(geo_series, sorted(series)))
    parents = {p for s in series for p in (cached("geo", s) or {}).get("subseries_of", [])}
    list(pool.map(geo_series, sorted(parents - series)))
    # Component citations can establish the link between a paper and a SuperSeries.
    supers = [cached("geo", s) for s in series | parents]
    kids = {child for r in supers if r and r.get("ok") for child in r.get("superseries_of", [])}
    list(pool.map(geo_series, sorted(kids)))
    print("geo done", len(series), "parents", len(parents), flush=True)
    sra_resolve(sorted(by.get("sra-run", set()) | by.get("sra-study", set())))
    assemblies(sorted(by.get("assembly", [])))
    bps = set(by.get("bioproject", set()))
    bps |= {b for s in series | parents | kids for b in (cached("geo", s) or {}).get("bioproject", [])}
    bps |= {(cached("sra", a) or {}).get("bioproject") for a in by.get("sra-run", set()) | by.get("sra-study", set())}
    bps |= {b for a in by.get("assembly", []) for b in (cached("assembly", a) or {}).get("bioprojects", [])[:1]}
    bioprojects(sorted(b for b in bps if b))
    ena_public_dates("bioproject", sorted(b for b in bps if b))
    ena_public_dates("sra", sorted(by.get("sra-run", set())))
    print("ncbi sequence records done", flush=True)
    list(pool.map(dbgap, sorted(by.get("dbgap", []))))
    list(pool.map(ega, sorted(by.get("ega", []))))
    list(pool.map(pride, sorted(by.get("pride", []))))
    pdb_entries(sorted(by.get("pdb", [])))
    list(pool.map(emdb, sorted(by.get("emdb", []))))
    list(pool.map(arrayexpress, sorted(by.get("arrayexpress", []))))
    list(pool.map(doi, sorted(by.get("doi", []))))
    save_counts("repositories")
    enrich_publication_metadata()
    print("done", flush=True)


if __name__ == "__main__":
    if sys.argv[1:] == ['--publication-metadata']:
        enrich_publication_metadata()
    elif sys.argv[1:]:
        raise SystemExit('usage: s5_repos.py [--publication-metadata]')
    else:
        main()
