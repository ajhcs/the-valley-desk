"""Stage 7: build datasets.jsonl, code-candidates.jsonl, spot-check-50.jsonl and the drop tallies.

Combines paper-derived units (mentions-classified.jsonl + repo-cache) with DataCite-by-institution records.
"""
import collections
import glob
import json
import os
import random
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (COUNTIES, MULTISITE, REGION_CITIES, TODAY, inst_counties, one_sentence, read_gz_json, read_jsonl,
                    regional_ids, registry, ror_index, strip_markup, work_dir, write_jsonl)
from datacite_rules import data_type_for_text, datacite_access, datacite_license, datacite_released, \
    health_decision, is_supplement, topic_for_text

WORK = work_dir()
REG = {i["id"]: i for i in registry()}
RORS = ror_index()
DROPS = collections.Counter()
EVIDENCE = {}
NODESC = collections.Counter()
CODE_DESC = re.compile(r"\b(the code|this code|source code|code (?:for|to|used|that|simulates)|scripts? (?:for|to|used)|"
                       r"software|matlab code|python code|r code|r package|python package|jupyter|github)\b", re.I)
DATA_DESC = re.compile(r"\b(data|dataset|datasets|images|recordings|measurements|sequenc\w*|reads|files)\b", re.I)
CITY_COUNTY = {"philadelphia": "Philadelphia", "camden": "Camden", "trenton": "Mercer", "princeton": "Mercer",
               "lawrenceville": "Mercer", "ewing": "Mercer", "pennington": "Mercer", "plainsboro": "Mercer",
               "cherry hill": "Camden", "stratford": "Camden", "voorhees": "Camden", "glassboro": "Gloucester",
               "sewell": "Gloucester", "doylestown": "Bucks", "langhorne": "Bucks", "newtown": "Bucks",
               "wynnewood": "Montgomery", "bala cynwyd": "Montgomery", "glenside": "Montgomery", "blue bell": "Montgomery",
               "king of prussia": "Montgomery", "norristown": "Montgomery", "plymouth meeting": "Montgomery",
               "horsham": "Montgomery", "ambler": "Montgomery", "conshohocken": "Montgomery", "fort washington": "Montgomery",
               "lansdale": "Montgomery", "spring house": "Montgomery", "abington": "Montgomery", "elkins park": "Montgomery",
               "villanova": "Delaware", "radnor": "Delaware", "swarthmore": "Delaware", "haverford": "Delaware",
               "media": "Delaware", "upper darby": "Delaware", "bryn mawr": "Montgomery", "west chester": "Chester",
               "exton": "Chester", "malvern": "Chester", "chesterbrook": "Chester", "mount laurel": "Burlington",
               "moorestown": "Burlington", "marlton": "Burlington", "willingboro": "Burlington", "browns mills": "Burlington"}
NOT_REGIONAL = re.compile(r"(indiana|california|slippery rock|edinboro|clarion|kutztown|bloomsburg|east stroudsburg|"
                          r"millersville|shippensburg|lock haven|mansfield|cheyney|west chester) university of pennsylvania", re.I)


def reg_ids(text):
    return regional_ids(NOT_REGIONAL.sub(" ", text or ""))


def inst_names(ids, limit=3):
    names = [REG[i]["name"] for i in ids if i in REG]
    # drop a parent when a child of it is present is not needed; keep literal order, cap the list
    if len(names) > limit:
        return ", ".join(names[:limit]) + f" and {len(names) - limit} more"
    if len(names) > 1:
        return ", ".join(names[:-1]) + " and " + names[-1]
    return names[0] if names else "regional"


def counties_for(ids):
    out = set()
    for i in ids:
        inst = REG.get(i)
        if inst and not inst.get("outside") and i not in MULTISITE and inst.get("homeCounty") in COUNTIES:
            out.add(inst["homeCounty"])
    return out


def pick_summary(*texts):
    """Prefer the first sentence that describes data; otherwise the first meaningful sentence."""
    DATAY = re.compile(r"\b(we (?:performed|profiled|sequenced|generated|measured|collected|analy[sz]ed|used)|"
                       r"(?:rna|chip|atac|cut&run|scrna|snrna|whole[- ]genome|exome|single[- ]cell)[- ]?seq|"
                       r"sequencing|profil\w+|this dataset|these data|the data|data (?:set|were)|dataset contains|"
                       r"contains|includes|recordings|images|measurements|samples)\b", re.I)
    sentences = []
    for t in texts:
        t = strip_markup(t)
        if not t:
            continue
        t = re.sub(r"https?://\S+|doi:\s?\S+", "", t)
        for s in re.split(r"(?<=[a-z0-9\)\]%])[.!?]\s+(?=[A-Z])", t):
            s = LABEL.sub("", s.strip()).strip()
            if len(s) >= 25 and not re.match(r"(?i)(this (?:sub)?series|this superseries|refer to individual|keywords?:)", s) \
                    and not SKIP_SENT.search(s):
                sentences.append(s)
    if not sentences:
        return ""
    sentences = [s.rstrip(":;, ") for s in sentences
                 if not re.search(r"(?i)^(?:all )?samples were|in (?:duplicate|triplicate)|\bhere\W*$", s)] or sentences
    chosen = next((s for s in sentences[:6] if DATAY.search(s) and len(s) >= 50), sentences[0])
    return one_sentence(chosen)


LABEL = re.compile(r"^(?:abstract|summary|description|overview|background|aims?|objectives?|introduction|purpose|"
                   r"context|motivation|rationale|methods?)\s*[:.\-]\s*", re.I)
SKIP_SENT = re.compile(r"@|\b(please|contact|correspond\w*|requests? for|cite|citation|copyright|licen[cs]e|readme|"
                       r"funded by|grant|e-?mail)\b", re.I)


def geo_data_type(rec):
    text = " ".join([rec.get("title", ""), rec.get("summary", ""), rec.get("design", "")])
    types = " ".join(rec.get("types", [])).lower()
    if re.search(r"single[- ]cell|scrna|snrna|sc-?rna|single[- ]nucle|10x genomics|spatial transcriptom", text, re.I):
        return "single-cell"
    if "expression profiling" in types:
        return "gene expression"
    if "high throughput sequencing" in types:
        return "sequencing"
    if "methylation" in types or "genome variation" in types or "snp" in types:
        return "sequencing" if "sequencing" in types else "other"
    return "other"


def seq_data_type(text):
    if re.search(r"single[- ]cell|scrna|snrna|single[- ]nucle|10x genomics", text or "", re.I):
        return "single-cell"
    return "sequencing"


def clean_title(t):
    t = strip_markup(t).strip()
    return t[:-1] if t.endswith(".") and not t.endswith("..") else t


def europepmc(pmcid):
    return f"https://europepmc.org/article/PMC/{pmcid}"


# ------------------------------------------------------------------ paper-derived units
def paper_units(papers):
    rows = read_jsonl(WORK / "mentions-classified.jsonl")
    for r in rows:
        if r["decision"] in ("drop", "unclear", "reused"):
            key = r["reason"] if r["decision"] == "drop" else ("reused (not listed)" if r["decision"] == "reused" else "no deposit cue / unclear")
            if r["decision"] == "unclear" and r["reason"] != "no deposit cue":
                key = r["reason"]
            DROPS["mention: " + key] += 1
    produced = [r for r in rows if r["decision"] == "produced"]
    code = [r for r in rows if r["decision"] == "code"]
    units = {}  # listing id -> dict(kind, accs, papers, mentions)

    def add(lid, kind, acc, r):
        u = units.setdefault(lid, {"kind": kind, "accs": [], "papers": [], "mentions": []})
        if acc not in u["accs"]:
            u["accs"].append(acc)
        if r["paper"] not in u["papers"]:
            u["papers"].append(r["paper"])
        u["mentions"].append(r)

    for r in produced:
        t, k = r["unit_type"], r["unit"]
        if t in ("geo", "geo-sample", "geo-gds"):
            if t == "geo":
                series = k
            else:
                rec = read_cache(t, k) or {}
                series = (rec.get("series") or [None])[0]
                if not series:
                    DROPS["unit: GEO sample/dataset without a public series"] += 1; continue
            srec = read_cache("geo", series)
            if not srec or not srec.get("ok") or not srec.get("public"):
                DROPS["unit: GEO series not public or not found"] += 1; continue
            parent = (srec.get("subseries_of") or [None])[0]
            prec = read_cache("geo", parent) if parent else None
            if prec and prec.get("ok") and prec.get("public"):
                add("geo:" + parent, "geo", parent, r)
                add("geo:" + parent, "geo", series, r)
            else:
                add("geo:" + series, "geo", series, r)
            if t != "geo":
                add("geo:" + (parent if prec and prec.get("ok") and prec.get("public") else series), "geo", k, r)
        elif t in ("sra-run", "sra-study"):
            rec = read_cache("sra", k) or {}
            if not rec.get("ok"):
                DROPS["unit: SRA accession not found"] += 1; continue
            bp = rec.get("bioproject")
            if bp and (read_cache("bioproject", bp) or {}).get("ok"):
                add("bioproject:" + bp, "bioproject", bp, r)
                add("bioproject:" + bp, "bioproject", k, r)
                units["bioproject:" + bp]["via_sra"] = True
            elif rec.get("study"):
                add("sra:" + rec["study"], "sra", rec["study"], r)
                add("sra:" + rec["study"], "sra", k, r)
            else:
                DROPS["unit: SRA accession without study"] += 1
        elif t == "assembly":
            rec = read_cache("assembly", k) or {}
            bps = [b for b in rec.get("bioprojects", []) if (read_cache("bioproject", b) or {}).get("ok")]
            if not bps:
                DROPS["unit: assembly without BioProject"] += 1; continue
            add("bioproject:" + bps[0], "bioproject", bps[0], r)
            add("bioproject:" + bps[0], "bioproject", k, r)
        elif t == "bioproject":
            if not (read_cache("bioproject", k) or {}).get("ok"):
                DROPS["unit: BioProject not found"] += 1; continue
            add("bioproject:" + k, "bioproject", k, r)
        elif t in ("pdb", "emdb"):
            rec = read_cache(t, k) or {}
            if not rec.get("ok"):
                DROPS["unit: structure not released"] += 1; continue
            add("pdb-set:" + r["paper"], "pdb-set", k if t == "pdb" else k, r)
        elif t in ("dbgap", "ega", "pride", "arrayexpress"):
            if not (read_cache(t, k) or {}).get("ok"):
                DROPS[f"unit: {t} record not found"] += 1; continue
            add(f"{t}:{k}", t, k, r)
        elif t == "doi":
            rec = read_cache("doi", k) or {}
            if not rec.get("ok"):
                DROPS["unit: DOI not found in DataCite"] += 1; continue
            rtg = (rec.get("types") or {}).get("resourceTypeGeneral") or ""
            if rtg == "Software":
                code.append(dict(r, reason="DataCite resource type Software")); continue
            if rtg in ("Text", "JournalArticle", "Preprint", "ConferencePaper", "Report", "Book", "BookChapter",
                       "Dissertation", "Event", "Service", "Workflow", "OutputManagementPlan", "Standard", "Award"):
                DROPS[f"unit: DOI is not a dataset ({rtg})"] += 1; continue
            desc = " ".join([rec.get("title", "")] + rec.get("descriptions", [])[:1])
            if CODE_DESC.search(desc) and not DATA_DESC.search(rec.get("title", "")):
                code.append(dict(r, reason="repository text describes code")); continue
            add("doi:" + k, "doi", k, r)
    # A GEO series and the BioProject it links to are one dataset.
    for lid in [l for l in units if l.startswith("geo:")]:
        u = units[lid]
        for acc in list(u["accs"]):
            for bp in (read_cache("geo", acc) or {}).get("bioproject", []):
                other = units.pop("bioproject:" + bp, None)
                if other:
                    DROPS["merge: BioProject rolled into its GEO series"] += 1
                    for a in [bp] + other["accs"]:
                        if a not in u["accs"]:
                            u["accs"].append(a)
                    u["papers"] += [p for p in other["papers"] if p not in u["papers"]]
                    u["mentions"] += other["mentions"]
    # SRA study listings whose study belongs to a listed BioProject
    return units, code


_cache = {}


def read_cache(kind, key):
    k = (kind, key)
    if k not in _cache:
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", key or "")
        p = WORK / "repo-cache" / kind / f"{safe}.json.gz"
        _cache[k] = read_gz_json(p) if key and p.exists() else None
    return _cache[k]


def listed_fields(paper_rows, repo_note):
    first = paper_rows[0]
    insts = sorted({i for p in paper_rows for i in p["institutions"]})
    counties = sorted({c for p in paper_rows for c in p["counties"]})
    conn = f"Produced by a paper with {inst_names(first['institutions'])} authors; {repo_note}"
    return insts, counties, conn, europepmc(first["pmcid"])


def build_paper_listing(lid, u, papers):
    prow = sorted((papers[p] for p in u["papers"]), key=lambda p: (p["published"] or "", p["id"]))
    topic = collections.Counter(p["topic"] for p in prow).most_common(1)[0][0]
    rec = {"id": lid, "papers": [p["id"] for p in prow], "topic": topic, "added": TODAY, "checked": TODAY,
           "size": None, "format": None, "license": None}
    kind, accs = u["kind"], u["accs"]
    verified_ids, verified_note, verified_source, verified_counties = None, None, None, set()
    other_submitter = False
    if kind == "geo":
        main = read_cache("geo", accs[0])
        rec.update(title=clean_title(main["title"]), summary=pick_summary(main["summary"], main["design"]),
                   data_type=geo_data_type(main), access="open", repository="GEO", accessions=accs,
                   url=f"https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={accs[0]}",
                   released=main.get("released"), size=f"{main['n_samples']} samples" if main.get("n_samples") else None)
        if not rec["summary"]:
            # A SuperSeries has no summary of its own; use its first SubSeries that has one.
            for sub in [a for a in accs[1:] if a.startswith("GSE")] + main.get("superseries_of", []):
                g = read_cache("geo", sub)
                if g and g.get("ok") and pick_summary(g["summary"], g["design"]):
                    rec["summary"] = pick_summary(g["summary"], g["design"]); break
        # Any series in the listing with a regional contact verifies it.
        for acc in accs:
            g = read_cache("geo", acc) if acc.startswith("GSE") else None
            if not g or not g.get("ok"):
                continue
            ids = reg_ids(g.get("institute", "") + " ; " + g.get("department", ""))
            state_ok = (g.get("state") or "").strip().upper() in ("PA", "NJ", "PENNSYLVANIA", "NEW JERSEY")
            city = (g.get("city") or "").strip()
            city_ok = state_ok and REGION_CITIES.fullmatch(city.lower()) is not None if city else False
            city_ok = city_ok or (state_ok and city.lower() in CITY_COUNTY)
            if ids or city_ok:
                where = f" in {city}" if city else ""
                inst = g.get("institute") or "an institution"
                verified_ids = ids
                verified_counties = {CITY_COUNTY[city.lower()]} if city_ok and city.lower() in CITY_COUNTY else set()
                verified_note = f"The GEO record for {acc} lists {inst}{where} as submitter."
                verified_source = f"https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={acc}"
                EVIDENCE[lid] = {"repository": {"institute": inst, "city": city, "state": g.get("state")}}
                break
            elif g.get("institute"):
                other_submitter = True
                EVIDENCE.setdefault(lid, {"repository": {"institute": g.get("institute"), "city": city, "state": g.get("state")}})
    elif kind in ("bioproject", "sra"):
        if kind == "bioproject":
            b = read_cache("bioproject", accs[0])
            title, desc = b["title"], b.get("description", "")
            sub = b.get("submitter", "") or "; ".join(b.get("submitters", []))
            released = b.get("registered")
            url = f"https://www.ncbi.nlm.nih.gov/bioproject/{accs[0]}"
            repo = "SRA" if u.get("via_sra") and not any(a.startswith("PRJ") and a == accs[0] for a in [r["unit"] for r in u["mentions"]]) else "BioProject"
            dt = seq_data_type(title + " " + desc) if re.search(r"sequenc|reads|seq\b|genom|transcriptom|amplicon|metagenom", b.get("data_type", "") + title + desc, re.I) or u.get("via_sra") else "other"
        else:
            s = read_cache("sra", accs[1] if len(accs) > 1 else accs[0]) or {}
            title, desc, sub = s.get("study_title", ""), s.get("study_title", ""), s.get("center", "")
            released, url, repo = s.get("created"), f"https://www.ncbi.nlm.nih.gov/sra/?term={accs[0]}", "SRA"
            dt = seq_data_type(title)
        rec.update(title=clean_title(title), summary=pick_summary(desc) or "", data_type=dt, access="open",
                   repository=repo, accessions=accs, url=url, released=released)
        ids = reg_ids(sub)
        EVIDENCE[lid] = {"repository": {"submitter": sub}}
        if ids:
            verified_ids = ids
            verified_note = f"The {'BioProject' if kind == 'bioproject' else 'SRA'} record lists {sub} as submitter."
            verified_source = url
        elif sub:
            other_submitter = True
    elif kind == "dbgap":
        d = read_cache("dbgap", accs[0])
        rec.update(title=clean_title(d["title"]), summary=pick_summary(d.get("description", "")),
                   data_type="sequencing" if re.search(r"sequenc|exome|genom|genotyp|gwas|snp array|wgs|wes", d["title"] + d.get("description", "")[:2000], re.I) else "clinical and survey",
                   access="controlled", repository="dbGaP", accessions=accs,
                   url=f"https://www.ncbi.nlm.nih.gov/projects/gap/cgi-bin/study.cgi?study_id={accs[0]}",
                   released=d.get("released"))
        block = d.get("pi_block", "")
        ids = reg_ids(block)
        EVIDENCE[lid] = {"repository": {"principal_investigator_block": block[:400]}}
        if ids:
            verified_ids = ids
            verified_note = f"The dbGaP study page lists a principal investigator at {inst_names(ids)}."
            verified_source = rec["url"]
        elif block:
            other_submitter = True
    elif kind == "ega":
        e = read_cache("ega", accs[0])
        rec.update(title=clean_title(e["title"]), summary=pick_summary(e.get("description") or ""),
                   data_type=seq_data_type(e["title"] + " " + (e.get("description") or "") + " " + str(e.get("study_type"))),
                   access="controlled", repository="EGA", accessions=accs,
                   url=f"https://ega-archive.org/{'studies' if accs[0].startswith('EGAS') else 'datasets'}/{accs[0]}",
                   released=e.get("released"))
    elif kind == "pride":
        p = read_cache("pride", accs[0])
        rec.update(title=clean_title(p["title"]), summary=pick_summary(p.get("description", "")), data_type="proteomics",
                   access="open", repository="PRIDE", accessions=accs,
                   url=f"https://www.ebi.ac.uk/pride/archive/projects/{accs[0]}", released=p.get("released"),
                   license=p.get("license"))
        affs = " ; ".join(p.get("affiliations", []))
        ids = reg_ids(affs)
        EVIDENCE[lid] = {"repository": {"affiliations": p.get("affiliations", [])}}
        if ids:
            verified_ids = ids
            verified_note = f"The PRIDE record lists a submitter or lab head at {inst_names(ids)}."
            verified_source = f"https://www.ebi.ac.uk/pride/ws/archive/v3/projects/{accs[0]}"
        elif affs:
            other_submitter = True
    elif kind == "arrayexpress":
        a = read_cache("arrayexpress", accs[0])
        st = (a.get("study_type") or "").lower()
        rec.update(title=clean_title(a["title"]), summary=pick_summary(a.get("description", "")),
                   data_type="single-cell" if "single" in st else "gene expression" if "transcription" in st or "expression" in st else "sequencing" if "seq" in st else "other",
                   access="open", repository="ArrayExpress", accessions=accs,
                   url=f"https://www.ebi.ac.uk/biostudies/arrayexpress/studies/{accs[0]}", released=a.get("released"))
        orgs = " ; ".join(a.get("organizations", []))
        ids = reg_ids(orgs)
        EVIDENCE[lid] = {"repository": {"organizations": a.get("organizations", [])}}
        if ids:
            verified_ids = ids
            verified_note = f"The ArrayExpress record lists {inst_names(ids)} as a submitting organization."
            verified_source = f"https://www.ebi.ac.uk/biostudies/api/v1/studies/{accs[0]}"
        elif orgs:
            other_submitter = True
    elif kind == "pdb-set":
        recs = []
        for acc in accs:
            r = read_cache("pdb", acc) if not acc.startswith("EMD-") else read_cache("emdb", acc)
            recs.append((acc, r))
        titles = [clean_title(r["title"]) for _, r in recs if r.get("title")]
        first = titles[0] if titles else accs[0]
        n = len(accs)
        title = first if n == 1 else f"{first} and {n - 1} related structure{'s' if n > 2 else ''}"
        uniq = list(dict.fromkeys(titles))
        summary = one_sentence(("Structure entry: " if n == 1 else f"{n} structure entries, including: ") + "; ".join(uniq[:4]))
        dates = sorted(r["released"] for _, r in recs if r.get("released"))
        a0 = accs[0]
        rec.update(title=title, summary=summary, data_type="structure", access="open",
                   repository="PDB" if any(not a.startswith("EMD-") for a in accs) else "EMDB", accessions=accs,
                   url=f"https://www.rcsb.org/structure/{a0}" if not a0.startswith("EMD-") else f"https://www.ebi.ac.uk/emdb/{a0}",
                   released=dates[0] if dates else None)
    elif kind == "doi":
        d = read_cache("doi", accs[0])
        rec.update(**doi_fields(d))
        rec["accessions"] = accs
        ids = sorted({RORS[x["id"].rstrip("/").rsplit("/", 1)[-1].lower()]["id"] for x in d.get("affiliations", [])
                      if x.get("id") and x["id"].rstrip("/").rsplit("/", 1)[-1].lower() in RORS})
        EVIDENCE[lid] = {"repository": {"creator_affiliations": sorted({x["name"] for x in d.get("affiliations", [])})[:8]}}
        if ids:
            verified_ids = ids
            verified_note = f"The DataCite record lists creators affiliated with {inst_names(ids)} (ROR)."
            verified_source = "https://api.datacite.org/dois/" + accs[0]
        elif d.get("affiliations"):
            other_submitter = True
    if not rec.get("summary"):
        DROPS["listing: no repository description"] += 1
        NODESC[kind] += 1
        return None
    if kind in ("dbgap", "ega") and not verified_note and not any(
            re.search(r"\b(deposit\w*|submitted|uploaded)\b", m.get("clause") or m.get("sentence") or "", re.I) for m in u["mentions"]):
        # Controlled-access studies are often large consortia reused by many papers; list only with a deposition verb.
        DROPS[f"listing: {kind} study without deposition verb or regional investigator"] += 1
        return None
    if verified_note:
        insts = sorted(set(verified_ids)) or sorted({i for p in prow for i in p["institutions"]})
        counties = sorted(verified_counties | counties_for(verified_ids))
        rec.update(institutions=insts, counties=counties, label="Verified", connection=verified_note, source=verified_source)
    else:
        if kind == "pdb-set":
            note = "the structure records do not name an institution."
        elif other_submitter:
            note = "the repository names another submitter."
        else:
            note = "the repository record does not name a submitter."
        insts, counties, conn, src = listed_fields(prow, note)
        rec.update(institutions=insts, counties=counties, label="Listed", connection=conn, source=src)
    EVIDENCE.setdefault(lid, {})["mentions"] = [
        {"paper": m["paper"], "accession": m["exact"], "decision": m["decision"], "reason": m["reason"],
         "section": m.get("section"), "sentence": m.get("sentence")} for m in u["mentions"][:3]]
    return rec


def doi_fields(d):
    title = clean_title(d.get("title", ""))
    descs = [x for x, t in zip(d.get("descriptions", []), d.get("description_types", [])) if t in ("Abstract", None, "Other", "TechnicalInfo")] or d.get("descriptions", [])
    text = " ".join([title] + descs[:1] + d.get("subjects", []))
    host = d.get("publisher") or ""
    prefix = d["doi"].split("/")[0]
    hosts = {"10.5281": "Zenodo", "10.5061": "Dryad", "10.6084": "figshare", "10.25452": "figshare", "10.17605": "OSF",
             "10.17632": "Mendeley Data", "10.7910": "Harvard Dataverse", "10.5683": "Dataverse", "10.13026": "PhysioNet",
             "10.18112": "OpenNeuro", "10.7303": "Synapse", "10.7937": "TCIA", "10.15154": "NIMH Data Archive",
             "10.26300": "NIMH Data Archive", "10.48324": "DANDI", "10.3886": "ICPSR"}
    sizes = [s for s in d.get("sizes", []) if s and len(s) < 60]
    formats = [f for f in d.get("formats", []) if f and len(f) < 60]
    return {"title": title, "summary": pick_summary(*descs[:1]),
            "data_type": data_type_for_text(text, prefix), "access": datacite_access(d, prefix),
            "repository": hosts.get(prefix) or (host[:60] if host else "DataCite"),
            "url": "https://doi.org/" + d["doi"], "released": datacite_released(d),
            "size": "; ".join(sizes[:3]) or None, "format": "; ".join(dict.fromkeys(formats[:5])) or None,
            "license": datacite_license(d)}


# ------------------------------------------------------------------ DataCite by institution
def datacite_institution():
    recs = {}
    for f in sorted(glob.glob(str(WORK / "datacite-inst" / "*" / "*.json.gz"))):
        for x in read_gz_json(f).get("data", []):
            recs.setdefault(x["id"].lower(), x["attributes"])
    from s5_repos import datacite_record
    out, seen_titles = {}, {}
    order = sorted(recs.items(), key=lambda kv: (str(kv[1].get("publicationYear") or ""), kv[0]), reverse=True)
    for doi, attrs in order:
        d = datacite_record(attrs); d["doi"] = doi
        title = clean_title(d["title"])
        if re.search(r"fairsharing", d.get("publisher") or "", re.I):
            DROPS["datacite: registry record describing a resource (FAIRsharing)"] += 1; continue
        if is_supplement(title, d):
            DROPS["datacite: journal supplement file"] += 1; continue
        if any(r["type"] == "IsVersionOf" for r in d["related"]):
            DROPS["datacite: version copy (IsVersionOf)"] += 1; continue
        key = re.sub(r"\W+", " ", title.lower()).strip()
        if key in seen_titles:
            DROPS["datacite: duplicate title"] += 1; continue
        seen_titles[key] = doi
        keep, rule = health_decision(d)
        if not keep:
            DROPS["datacite: not health or life science (" + rule + ")"] += 1; continue
        ids = sorted({RORS[a["id"].rstrip("/").rsplit("/", 1)[-1].lower()]["id"] for a in d["affiliations"]
                      if a.get("id") and a["id"].rstrip("/").rsplit("/", 1)[-1].lower() in RORS})
        if not ids:
            DROPS["datacite: no registry ROR on creators"] += 1; continue
        if (d.get("types") or {}).get("resourceTypeGeneral") not in (None, "Dataset"):
            DROPS["datacite: not typed Dataset"] += 1; continue
        f = doi_fields(d)
        if not f["summary"]:
            DROPS["datacite: no description"] += 1; continue
        text = " ".join([title] + d["descriptions"][:1] + d["subjects"])
        rec = {"id": "doi:" + doi, **{k: f[k] for k in ("title", "summary", "data_type", "access", "repository")},
               "accessions": [doi], "url": f["url"], "institutions": ids, "counties": sorted(counties_for(ids)),
               "label": "Verified",
               "connection": f"The DataCite record lists creators affiliated with {inst_names(ids)} (ROR).",
               "source": "https://api.datacite.org/dois/" + doi, "papers": [], "topic": topic_for_text(text, title),
               "released": f["released"], "added": TODAY, "checked": TODAY,
               "size": f["size"], "format": f["format"], "license": f["license"]}
        EVIDENCE[rec["id"]] = {"repository": {"creator_affiliations": sorted({a["name"] for a in d["affiliations"]})[:8],
                                              "health_rule": rule, "subjects": d["subjects"][:6]}}
        out[rec["id"]] = rec
    return out


ORDER = ["id", "title", "summary", "data_type", "access", "repository", "accessions", "url", "institutions", "counties",
         "label", "connection", "source", "papers", "topic", "released", "added", "checked", "size", "format", "license"]


def main():
    papers = {p["id"]: p for p in json.loads((WORK / "papers.json").read_text())}
    units, code = paper_units(papers)
    listings = {}
    for lid, u in sorted(units.items()):
        rec = build_paper_listing(lid, u, papers)
        if rec:
            rec["_source"] = "papers"
            listings[lid] = rec
    dc = datacite_institution()
    merged = 0
    for lid, rec in dc.items():
        if lid in listings:
            merged += 1
            p = listings[lid]
            if p["label"] != "Verified":
                for k in ("institutions", "counties", "label", "connection", "source"):
                    p[k] = rec[k]
            p["_source"] = "both"
        else:
            rec["_source"] = "datacite"
            listings[lid] = rec
    DROPS["merge: paper DOI also found by institution search"] += merged
    out, sources = [], collections.Counter()
    for lid in sorted(listings):
        r = listings[lid]
        sources[r.pop("_source")] += 1
        out.append({k: r.get(k) for k in ORDER})
    write_jsonl(WORK / "datasets.jsonl", out)
    # code candidates
    crow = []
    for r in code:
        d = read_cache("doi", r["unit"]) if r["unit_type"] == "doi" else None
        crow.append({"id": "doi:" + r["unit"] if r["unit_type"] == "doi" else r["unit"], "paper": r["paper"],
                     "repository": r["repo"], "title": (d or {}).get("title"), "url": "https://doi.org/" + r["unit"] if r["unit_type"] == "doi" else None,
                     "resource_type": ((d or {}).get("types") or {}).get("resourceTypeGeneral"), "reason": r["reason"],
                     "section": r.get("section"), "sentence": r.get("sentence")})
    seen = set(); crow = [c for c in crow if not (c["id"] in seen or seen.add(c["id"]))]
    write_jsonl(WORK / "code-candidates.jsonl", crow)
    random.seed(20261123)
    sample = random.sample(out, min(50, len(out)))
    write_jsonl(WORK / "spot-check-50.jsonl", [{"listing": s, "evidence": EVIDENCE.get(s["id"], {})} for s in sample])
    print("no description by kind:", dict(NODESC))
    stats = {"sources": dict(sources), "drops": dict(DROPS.most_common()), "listings": len(out), "code_candidates": len(crow)}
    (WORK / "build-stats.json").write_text(json.dumps(stats, indent=1, ensure_ascii=False))
    print(json.dumps(stats, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
