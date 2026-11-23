"""Stage 7: build datasets.jsonl, code-candidates.jsonl, spot-check-50.jsonl and the drop tallies.

Combines paper-derived units (mentions-classified.jsonl + repo-cache) with DataCite-by-institution records.
"""
import collections
import functools
import glob
import json
import os
import random
import re
import sys
from urllib.parse import urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import COUNTIES, TODAY, read_gz_json, read_jsonl, registry, ror_index, strip_markup, work_dir, write_json, write_jsonl
from reuse import adjudicate, identifiers, more_than_year_before, replay_date_decisions
from paper_provenance import paper_provenance
from datacite_rules import datacite_access, datacite_license, datacite_released, \
    generic_junk_decision, generic_supplement_decision, health_decision, is_supplement, \
    topic_for_text
from dataset_description import data_type_for_record, pick_summary, rebuild_summary
from dataset_labels import investigator_ids, match_geo_institution, match_paper_affiliation, match_submitter
from dataset_files import api_url, cache_path, fetch, file_decision

WORK = work_dir()
REG = {i["id"]: i for i in registry()}
RORS = ror_index()
DROPS = collections.Counter()
RULES = collections.Counter()
JUNK_IDS = set()
EVIDENCE = {}
NODESC = collections.Counter()
FILE_POOL = set()
SCOPE = {}
AFFILIATIONS = {}
EXISTING = set()
FILE_CACHE = os.environ.get("TVD_DATASET_FILE_CACHE") or WORK / "doi-files"
RATE_LIMITED = set()
CODE_DESC = re.compile(r"\b(the code|this code|source code|code (?:for|to|used|that|simulates)|scripts? (?:for|to|used)|"
                       r"replication (?:package|code)|software|matlab code|python code|r code|r package|"
                       r"python package|jupyter|github)\b", re.I)
DATA_DESC = re.compile(r"\b(data|dataset|datasets|images|recordings|measurements|sequenc\w*|reads|files)\b", re.I)
PATHOGEN = re.compile(r"\b(?:virus|viruses|viral|pathogen|bacteriophage)\b", re.I)
SENSITIVE_STUDY = re.compile(
    r"\b(?:engineering|infectivity|virulence|host range|escape mutant|reverse genetics|infectious clone)\b", re.I)
GEO_LAB_ASSAYS = re.compile(r"\b(?:expression profiling|genome binding|genome occupancy|methylation profiling|"
                          r"transcription profiling|single cell|protein profiling)\b", re.I)
NO_INCLUDED_DATA = re.compile(
    r"\b(?:does not|do not) (?:contain|include|provide) (?:any |the )?(?:underlying |source |raw )?data\b|"
    r"\b(?:data|datasets?) (?:are|is) not included\b",
    re.I,
)


def inst_names(ids, limit=3):
    names = [REG[i]["name"] for i in ids if i in REG]
    # drop a parent when a child of it is present is not needed; keep literal order, cap the list
    if len(names) > limit:
        return ", ".join(names[:limit]) + f" and {len(names) - limit} more"
    if len(names) > 1:
        return ", ".join(names[:-1]) + " and " + names[-1]
    return names[0] if names else "regional"


def counties_for(ids):
    return {REG[i]["homeCounty"] for i in ids if i in REG and REG[i].get("homeCounty") in COUNTIES}


def submitter_ids(affiliations, city="", state=""):
    return sorted({i for affiliation in affiliations
                   for i in match_submitter(affiliation, city, state, REG.values())["institutions"]})


def datacite_creator_ids(d):
    ids = set()
    for aff in d.get("affiliations", []):
        ror = (aff.get("id") or "").rstrip("/").rsplit("/", 1)[-1].lower()
        matches = submitter_ids([aff.get("name")])
        if ror in RORS and RORS[ror]["id"] in matches:
            ids.add(RORS[ror]["id"])
        else:
            ids.update(matches)
    return sorted(ids)


MEDICAL_CREATORS = {
    "cooper-medical-school", "drexel-dornsife-school-of-public-health", "drexel-medicine",
    "lewis-katz-school-of-medicine", "pcom", "perelman-school-of-medicine",
    "rowan-virtua-college", "rowan-virtua-som", "salus", "sidney-kimmel-medical-college",
    "thomas-jefferson-university", "blumberg-institute", "camden-cancer-research-center",
    "childhood-cancer-data-lab", "coriell", "limr", "monell", "princeton-neuroscience-institute", "wistar",
} | {i for i, record in REG.items() if record["kind"] == "hospital or health system"}


def summary_title(title, prefix="Research dataset: "):
    title = strip_markup(title).strip().rstrip(".")
    if not title:
        return ""
    available = 239 - len(prefix)
    if len(title) > available:
        title = title[:available - 1].rsplit(" ", 1)[0] + "…"
    return prefix + title + ("" if title.endswith(("?", "!", "…")) else ".")


def missing_paper_summary(title, paper_rows, mentions, provenance):
    producing = {edge["paper"] for edge in provenance if edge["relation"] == "produced"}
    for m in mentions:
        if m["paper"] not in producing or not re.search(r"data.{0,8}(?:availability|sharing|access)", m.get("section") or "", re.I):
            continue
        sentence = pick_summary(m.get("clause") or m.get("sentence") or "")
        combined = f"{title.rstrip('.')}. {sentence}"
        if sentence and title and len(combined) <= 240:
            return combined
    for paper in paper_rows:
        if paper["id"] in producing:
            return summary_title(paper.get("title"), "Data from: ") or summary_title(title)
    return summary_title(title)


def datacite_scope(d, source, ids):
    title = clean_title(d.get("title", ""))
    drop, rule = generic_supplement_decision(title, d.get("descriptions"))
    if drop or is_supplement(title, d):
        DROPS[f"{source}: {rule or 'journal supplement file'}"] += 1
        JUNK_IDS.add("doi:" + d["doi"].lower())
        return None
    junk, junk_rule = generic_junk_decision(title, d.get("descriptions"))
    if junk:
        DROPS[f"{source}: {junk_rule}"] += 1
        JUNK_IDS.add("doi:" + d["doi"].lower())
        return None
    description = strip_markup(" ".join(d.get("descriptions") or []))
    if CODE_DESC.search(f"{title} {description}") and NO_INCLUDED_DATA.search(description):
        DROPS[f"{source}: code package without included data"] += 1
        return None
    return scope_decision("doi:" + d["doi"].lower(), d, source, ids)


def scope_decision(lid, metadata, source, ids=()):
    keep, rule = health_decision(metadata, medical_creator=bool(MEDICAL_CREATORS.intersection(ids)))
    SCOPE.setdefault(lid, {})[source] = {"keep": keep, "rule": rule}
    if not keep:
        DROPS[f"{source}: {rule}"] += 1
        return None
    return rule


def doi_has_files(d):
    doi = d["doi"].lower()
    FILE_POOL.add(doi)
    if os.environ.get("TVD_DATASET_FILE_POOL_ONLY"):
        return True
    if os.environ.get("TVD_DATASET_FETCH_FILES") and (url := api_url(doi)):
        host = urlsplit(url).hostname
        manifest = cache_path(FILE_CACHE, doi)
        if host not in RATE_LIMITED and not manifest.exists():
            manifest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            evidence = fetch(doi)
            write_json(manifest, evidence)
            if evidence.get("http") == 429:
                RATE_LIMITED.add(host)
    result = file_decision(doi, d, FILE_CACHE)
    EVIDENCE.setdefault("doi:" + doi, {})["file_check"] = result
    if result["status"] != "keep":
        DROPS["file check: " + result["reason"]] += 1
        return False
    RULES["file check: " + result["reason"]] += 1
    return True


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
    # Reproductive bottlenecks describe the organism rather than the assay.
    text = re.sub(r"\bsingle[- ]cell bottlenecks?\b", "", text or "", flags=re.I)
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
    legacy = os.environ.get("TVD_DATASETS_REPLAY")
    decisions = (replay_date_decisions(read_jsonl(legacy), rows, papers, read_cache)
                 if legacy else adjudicate(rows, papers, read_cache))
    for decision in decisions:
        if decision.get("date_replay"):
            RULES["date replay: " + decision["date_replay"]] += 1
    write_jsonl(WORK / "reuse-decisions.jsonl", decisions)
    overrides = {(d["paper"], d["unit_type"], d["unit"]): d for d in decisions if d["decision"] == "reused"}
    ambiguous = set()
    for d in decisions:
        if d["original_decision"] != "produced" or not d["citation_match"] or not any(
                more_than_year_before(value["date"], d["paper_published"])
                for value in d["repository_dates"]):
            continue
        own = identifiers(papers[d["paper"]])
        # Another identifier of the same type is evidence of another paper,
        # whereas the paper can have more than one kind of identifier.
        same_type = {identifier.split(":", 1)[0] for identifier in own}
        for value in d["repository_citations"]:
            citation = value["citation"]
            others = identifiers(citation if isinstance(citation, dict) else {"id": citation}) - own
            if any(identifier.split(":", 1)[0] in same_type for identifier in others):
                ambiguous.add((d["paper"], d["unit_type"], d["unit"]))
                break
    rows = [dict(r, decision=overrides[(r["paper"], r["unit_type"], r["unit"])]["decision"],
                 reason=overrides[(r["paper"], r["unit_type"], r["unit"])]["reason"])
            if r["decision"] == "produced" and (r["paper"], r.get("unit_type"), r.get("unit")) in overrides
            else r for r in rows]
    for r in rows:
        if r["decision"] in ("drop", "unclear", "reused"):
            key = r["reason"] if r["decision"] == "drop" else ("reused (not listed)" if r["decision"] == "reused" else "no deposit cue / unclear")
            if r["decision"] == "unclear" and r["reason"] != "no deposit cue":
                key = r["reason"]
            DROPS["mention: " + key] += 1
    produced = []
    for r in rows:
        if r["decision"] != "produced":
            continue
        if (r["paper"], r["unit_type"], r["unit"]) in ambiguous:
            DROPS["mention: old accession with multiple repository citations and ambiguous origin"] += 1
        else:
            produced.append(r)
    code = [r for r in rows if r["decision"] == "code"]
    units = {}  # listing id -> dict(kind, accs, papers, mentions)

    def add(lid, kind, acc, r):
        u = units.setdefault(lid, {"kind": kind, "accs": [], "papers": [], "mentions": []})
        if acc not in u["accs"]:
            u["accs"].append(acc)
        if r["paper"] not in u["papers"]:
            u["papers"].append(r["paper"])
        u["mentions"].append(r)

    named_geo = {(r["paper"], r["unit"]) for r in produced
                 if r["unit_type"] == "geo" and r.get("exact", "").upper() == r["unit"]}
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
            paper = r["paper"]
            if not geo_series_supported(series, srec, papers[paper], named_geo):
                DROPS["unit: GEO SuperSeries without paper or component support"] += 1
                continue
            target = series
            for parent in srec.get("subseries_of") or []:
                prec = read_cache("geo", parent) or {}
                if prec.get("ok") and prec.get("public") and geo_series_supported(
                        parent, prec, papers[paper], named_geo, known_aggregate=True):
                    target = parent
                    break
            add("geo:" + target, "geo", target, r)
            add("geo:" + target, "geo", series, r)
            if t != "geo":
                add("geo:" + target, "geo", k, r)
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
            if not (health_rule := datacite_scope(rec, "paper-derived DataCite", datacite_creator_ids(rec))):
                continue
            desc = " ".join([rec.get("title", "")] + rec.get("descriptions", [])[:1])
            if CODE_DESC.search(desc) and not DATA_DESC.search(rec.get("title", "")):
                code.append(dict(r, reason="repository text describes code")); continue
            if not doi_has_files(rec):
                continue
            add("doi:" + k, "doi", k, r)
            EVIDENCE.setdefault("doi:" + k, {})["health_rule"] = health_rule
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
    return units, code, {(d["paper"], d["unit_type"], d["unit"]): d for d in decisions}


_cache = {}


def read_cache(kind, key):
    k = (kind, key)
    if k not in _cache:
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", key or "")
        p = WORK / "repo-cache" / kind / f"{safe}.json.gz"
        _cache[k] = read_gz_json(p) if key and p.exists() else None
    return _cache[k]


def geo_series_supported(series, rec, paper, named_geo, known_aggregate=False):
    components = rec.get("superseries_of") or []
    if not known_aggregate and not components and not re.search(r"\bsuperseries\b", rec.get("title") or "", re.I):
        return True
    if (paper["id"], series) in named_geo:
        return True
    paper_ids = identifiers(paper)
    return bool(components) and all(
        any(paper_ids & identifiers(citation)
            for citation in (read_cache("geo", component) or {}).get("citations", []))
        for component in components
    )


@functools.lru_cache(maxsize=None)
def literal_institutions(paper_id, pmcid):
    affiliations = AFFILIATIONS.get(paper_id)
    if affiliations is None:
        path = WORK / "fulltext" / (f"{pmcid}.json.gz")
        affiliations = read_gz_json(path).get("affiliations", []) if pmcid and path.is_file() else []
    return {i for aff in affiliations
            for i in match_paper_affiliation(aff, REG.values())["institutions"]}


def listed_fields(paper_rows, repo_note, provenance, existing):
    producing = {edge["paper"] for edge in provenance if edge["relation"] == "produced"}
    regional = [(p, literal_institutions(p["id"], p.get("pmcid")))
                for p in paper_rows if existing or p["id"] in producing]
    regional = [(p, ids) for p, ids in regional if ids]
    if not regional:
        return [], [], "", ""
    explicit = [(p, ids) for p, ids in regional if p["id"] in producing]
    regional = explicit or regional
    first = regional[0][0]
    insts = sorted({i for _, ids in regional for i in ids})
    counties = sorted(counties_for(insts))
    relation = "producing" if explicit else "linked"
    conn = f"A {relation} paper lists a regional affiliation. {repo_note[0].upper()}{repo_note[1:]}"
    return insts, counties, conn, europepmc(first["pmcid"])


def build_paper_listing(lid, u, papers, decisions):
    prow = sorted((papers[p] for p in u["papers"]), key=lambda p: (p["published"] or "", p["id"]))
    topic = collections.Counter(p["topic"] for p in prow).most_common(1)[0][0]
    unit_decisions = [decisions[key] for m in u["mentions"]
                      if (key := (m["paper"], m["unit_type"], m["unit"])) in decisions]
    date_recovered = any(d.get("date_replay") == "evaluated" and d["decision"] == "produced"
                         for d in unit_decisions)
    provenance = paper_provenance(u["mentions"], unit_decisions)
    rec = {"id": lid, "papers": [p["id"] for p in prow], "topic": topic, "added": TODAY, "checked": TODAY,
           "size": None, "format": None, "license": None, "paper_provenance": provenance}
    kind, accs = u["kind"], u["accs"]
    verified_ids, verified_note, verified_source = [], None, None
    other_submitter = False
    repository_details = ()
    if kind == "geo":
        main = read_cache("geo", accs[0])
        repository_details = (main.get("design"), main.get("summary"))
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
        for acc in accs:
            g = read_cache("geo", acc) if acc.startswith("GSE") else None
            if not g or not g.get("ok") or not g.get("institute"):
                continue
            inst = g["institute"]
            city, state = g.get("city") or "", g.get("state") or ""
            evidence = {"institute": inst, "city": city, "state": state}
            ids = match_geo_institution(inst, city, state, REG.values())["institutions"]
            if not ids:
                ids = submitter_ids([inst], city, state)
            if ids:
                verified_ids = ids
                verified_note = f"The GEO record for {acc} lists {inst} as the submitting institution."
                verified_source = f"https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={acc}"
                EVIDENCE[lid] = {"repository": evidence}
                break
            other_submitter = True
            EVIDENCE.setdefault(lid, {"repository": evidence})
    elif kind in ("bioproject", "sra"):
        if kind == "bioproject":
            b = read_cache("bioproject", accs[0])
            title, desc = b["title"], b.get("description", "")
            submitters = [b["submitter"]] if b.get("submitter") else b.get("submitters", [])
            released = b.get("released")
            url = f"https://www.ncbi.nlm.nih.gov/bioproject/{accs[0]}"
            repo = "SRA" if u.get("via_sra") and not any(a.startswith("PRJ") and a == accs[0] for a in [r["unit"] for r in u["mentions"]]) else "BioProject"
            dt = seq_data_type(title + " " + desc) if re.search(r"sequenc|reads|seq\b|genom|transcriptom|amplicon|metagenom", b.get("data_type", "") + title + desc, re.I) or u.get("via_sra") else "other"
        else:
            s = read_cache("sra", accs[1] if len(accs) > 1 else accs[0]) or {}
            title = s.get("study_title", "")
            desc = s.get("description") or title
            submitters = [s["center"]] if s.get("center") else []
            released, url, repo = s.get("released"), f"https://www.ncbi.nlm.nih.gov/sra/?term={accs[0]}", "SRA"
            dt = seq_data_type(title)
        repository_details = (desc,)
        rec.update(title=clean_title(title), summary=pick_summary(desc) or "", data_type=dt, access="open",
                   repository=repo, accessions=accs, url=url, released=released)
        ids = submitter_ids(submitters)
        EVIDENCE[lid] = {"repository": {"submitters": submitters}}
        if ids:
            verified_ids = ids
            verified_note = f"The {'BioProject' if kind == 'bioproject' else 'SRA'} record identifies a submitting organization at {inst_names(ids)}."
            verified_source = url
        elif submitters:
            other_submitter = True
    elif kind == "dbgap":
        d = read_cache("dbgap", accs[0])
        rec.update(title=clean_title(d["title"]), summary=pick_summary(d.get("description", "")),
                   data_type="sequencing" if re.search(r"sequenc|exome|genom|genotyp|gwas|snp array|wgs|wes", d["title"] + d.get("description", "")[:2000], re.I) else "clinical and survey",
                   access="controlled", repository="dbGaP", accessions=accs,
                   url=f"https://www.ncbi.nlm.nih.gov/projects/gap/cgi-bin/study.cgi?study_id={accs[0]}",
                   released=d.get("released"))
        repository_details = (d.get("description"),)
        verified_ids = investigator_ids(d, REG.values())
        EVIDENCE[lid] = {"repository": {"principal_investigator_block": d.get("pi_block", "")[:400]}}
    elif kind == "ega":
        e = read_cache("ega", accs[0])
        rec.update(title=clean_title(e["title"]), summary=pick_summary(e.get("description") or ""),
                   data_type=seq_data_type(e["title"] + " " + (e.get("description") or "") + " " + str(e.get("study_type"))),
                   access="controlled", repository="EGA", accessions=accs,
                   url=f"https://ega-archive.org/{'studies' if accs[0].startswith('EGAS') else 'datasets'}/{accs[0]}",
                   released=e.get("released"))
        repository_details = (e.get("description"),)
        verified_ids = investigator_ids(e, REG.values())
    elif kind == "pride":
        p = read_cache("pride", accs[0])
        rec.update(title=clean_title(p["title"]), summary=pick_summary(p.get("description", "")), data_type="proteomics",
                   access="open", repository="PRIDE", accessions=accs,
                   url=f"https://www.ebi.ac.uk/pride/archive/projects/{accs[0]}", released=p.get("released"),
                   license=p.get("license"))
        repository_details = (p.get("description"),)
        affiliations = p.get("submitter_affiliations", [])
        ids = submitter_ids(affiliations)
        EVIDENCE[lid] = {"repository": {"submitter_affiliations": affiliations}}
        if ids:
            verified_ids = ids
            verified_note = f"The PRIDE record lists a submitter at {inst_names(ids)}."
            verified_source = f"https://www.ebi.ac.uk/pride/ws/archive/v3/projects/{accs[0]}"
        elif any(affiliations):
            other_submitter = True
    elif kind == "arrayexpress":
        a = read_cache("arrayexpress", accs[0])
        repository_details = (a.get("description"),)
        st = (a.get("study_type") or "").lower()
        rec.update(title=clean_title(a["title"]), summary=pick_summary(a.get("description", "")),
                   data_type="single-cell" if "single" in st else "gene expression" if "transcription" in st or "expression" in st else "sequencing" if "seq" in st else "other",
                   access="open", repository="ArrayExpress", accessions=accs,
                   url=f"https://www.ebi.ac.uk/biostudies/arrayexpress/studies/{accs[0]}", released=a.get("released"))
        # The cached BioStudies organization field does not identify a submission role.
        EVIDENCE[lid] = {"repository": {"organizations": a.get("organizations", [])}}
    elif kind == "pdb-set":
        recs = []
        for acc in accs:
            r = read_cache("pdb", acc) if not acc.startswith("EMD-") else read_cache("emdb", acc)
            recs.append((acc, r))
        titles = [clean_title(r["title"]) for _, r in recs if r.get("title")]
        first = titles[0] if titles else accs[0]
        n = len(accs)
        title = first if n == 1 else f"{first} and {n - 1} related structure{'s' if n > 2 else ''}"
        summary = ("The repository entry describes one experimentally determined molecular structure."
                   if n == 1 else f"The repository entries describe {n} experimentally determined molecular structures.")
        dates = sorted(r["released"] for _, r in recs if r.get("released"))
        a0 = accs[0]
        rec.update(title=title, summary=summary, data_type="structure", access="open",
                   repository="PDB" if any(not a.startswith("EMD-") for a in accs) else "EMDB", accessions=accs,
                   url=f"https://www.rcsb.org/structure/{a0}" if not a0.startswith("EMD-") else f"https://www.ebi.ac.uk/emdb/{a0}",
                   released=dates[0] if dates else None)
    elif kind == "doi":
        d = read_cache("doi", accs[0])
        repository_details = tuple(d.get("descriptions", []))
        rec.update(**doi_fields(d))
        rec["accessions"] = accs
        ids = datacite_creator_ids(d)
        EVIDENCE.setdefault(lid, {})["repository"] = {"creator_affiliations": sorted({x["name"] for x in d.get("affiliations", [])})[:8]}
        if ids:
            verified_ids = ids
            verified_note = f"The DataCite record lists creators affiliated with {inst_names(ids)}."
            verified_source = "https://api.datacite.org/dois/" + accs[0]
        elif d.get("affiliations"):
            other_submitter = True
    if kind in ("dbgap", "ega") and verified_ids:
        verified_note = (f"The {rec['repository']} record names a principal investigator affiliated with "
                         f"{inst_names(verified_ids)}.")
        verified_source = rec["url"]
    producing = {edge["paper"] for edge in provenance if edge["relation"] == "produced"}
    paper_title = next((p.get("title") for p in prow if p["id"] in producing), None)
    rec["summary"] = rebuild_summary(rec["summary"], rec["title"], *repository_details, paper_title=paper_title)
    if generic_supplement_decision(rec["title"], [rec.get("summary")])[0]:
        DROPS["listing: generic supplement title"] += 1
        return None
    if not rec.get("summary"):
        rec["summary"] = missing_paper_summary(rec["title"], prow, u["mentions"], provenance)
        if not rec["summary"] or not rec["title"]:
            DROPS["listing: missing descriptive title"] += 1
            return None
        NODESC[kind] += 1
        EVIDENCE.setdefault(lid, {})["summary_fallback"] = True
    if kind != "doi":
        source = read_cache(kind, accs[0]) or {}
        laboratory_method = {
            "pdb-set": "Structural biology",
            "pride": "Laboratory proteomics",
            "arrayexpress": "Gene expression",
            "dbgap": "Clinical study",
        }.get(kind)
        if kind == "geo" and any(GEO_LAB_ASSAYS.search(t) for t in source.get("types", [])):
            laboratory_method = "Gene expression or genomic profiling"
        metadata = {
            "title": rec["title"],
            "descriptions": [source.get(field) or "" for field in ("summary", "design", "description")]
                            + [p.get("title") or "" for p in prow],
            "repository_method": laboratory_method,
        }
        if not scope_decision(lid, metadata, "paper-derived"):
            return None
    if kind in ("dbgap", "ega") and not (lid in EXISTING and verified_ids) and not any(
            re.search(r"\b(deposit\w*|submitted|uploaded)\b", m.get("clause") or m.get("sentence") or "", re.I) for m in u["mentions"]):
        # Controlled-access studies are often large consortia reused by many papers; list only with a deposition verb.
        DROPS[f"listing: {kind} study without explicit deposition evidence"] += 1
        return None
    if verified_note:
        insts = verified_ids
        counties = sorted(counties_for(insts))
        rec.update(institutions=insts, counties=counties, label="Verified", connection=verified_note, source=verified_source)
    else:
        if kind == "pdb-set":
            note = "the structure records do not name an institution."
        elif other_submitter:
            note = "the repository supplies submitter details at the source."
        else:
            note = "the repository record does not name a submitter."
        insts, counties, conn, src = listed_fields(prow, note, provenance, lid in EXISTING)
        if not insts:
            DROPS["listing: no producing paper with a literal regional affiliation"] += 1
            return None
        rec.update(institutions=insts, counties=counties, label="Listed", connection=conn, source=src)
    evidence = EVIDENCE.setdefault(lid, {})
    if date_recovered:
        evidence["public_date_recovered"] = True
    evidence["mentions"] = [
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
    return {"title": title, "summary": pick_summary(*descs),
            "data_type": data_type_for_record(text, prefix, formats), "access": datacite_access(d, prefix),
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
        ids = datacite_creator_ids(d)
        rule = datacite_scope(d, "datacite", ids)
        if not rule:
            continue
        if any(r["type"] == "IsVersionOf" for r in d["related"]):
            DROPS["datacite: version copy (IsVersionOf)"] += 1; continue
        key = re.sub(r"\W+", " ", title.lower()).strip()
        if key in seen_titles:
            DROPS["datacite: duplicate title"] += 1; continue
        if not ids:
            DROPS["datacite: no regional affiliation on creators"] += 1; continue
        if (d.get("types") or {}).get("resourceTypeGeneral") not in (None, "Dataset"):
            DROPS["datacite: not typed Dataset"] += 1; continue
        if not doi_has_files(d):
            continue
        seen_titles[key] = doi
        f = doi_fields(d)
        f["summary"] = rebuild_summary(f["summary"], title, *d["descriptions"])
        fallback = not f["summary"]
        if fallback:
            if not title or (d.get("types") or {}).get("resourceTypeGeneral") != "Dataset":
                DROPS["datacite: no repository description or descriptive dataset title"] += 1
                continue
            f["summary"] = summary_title(title)
            NODESC["datacite"] += 1
        text = " ".join([title] + d["descriptions"][:1] + d["subjects"])
        rec = {"id": "doi:" + doi, **{k: f[k] for k in ("title", "summary", "data_type", "access", "repository")},
               "accessions": [doi], "url": f["url"], "institutions": ids, "counties": sorted(counties_for(ids)),
               "label": "Verified",
               "connection": f"The DataCite record lists creators affiliated with {inst_names(ids)}.",
               "source": "https://api.datacite.org/dois/" + doi, "papers": [], "topic": topic_for_text(text, title),
               "released": f["released"], "added": TODAY, "checked": TODAY,
               "size": f["size"], "format": f["format"], "license": f["license"]}
        evidence = EVIDENCE.setdefault(rec["id"], {})
        evidence.update(health_rule=rule, summary_fallback=fallback or evidence.get("summary_fallback", False))
        evidence["repository"] = {"creator_affiliations": sorted({a["name"] for a in d["affiliations"]})[:8],
                                  "health_rule": rule, "subjects": d["subjects"][:6]}
        out[rec["id"]] = rec
    return out


ORDER = ["id", "title", "summary", "data_type", "access", "repository", "accessions", "url", "institutions", "counties",
         "label", "connection", "source", "papers", "topic", "released", "added", "checked", "size", "format", "license", "paper_provenance"]


def main():
    existing_path = os.environ.get("TVD_DATASET_EXISTING")
    if existing_path:
        EXISTING.update(record["id"] for record in read_jsonl(existing_path))
    affiliation_path = os.environ.get("TVD_DATASET_AFFILIATIONS")
    if affiliation_path:
        with open(affiliation_path) as f:
            AFFILIATIONS.update(json.load(f))
    papers = {p["id"]: p for p in json.loads((WORK / "papers.json").read_text())}
    units, code, decisions = paper_units(papers)
    listings = {}
    for lid, u in sorted(units.items()):
        rec = build_paper_listing(lid, u, papers, decisions)
        if rec:
            rec["_source"] = "papers"
            listings[lid] = rec
    dc = datacite_institution()
    if RATE_LIMITED:
        raise SystemExit("Dataset file manifest rate limit")
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
    out, sources, source_by_id = [], collections.Counter(), {}
    for lid in sorted(listings):
        r = listings[lid]
        text = " ".join((r["title"], r["summary"]))
        if PATHOGEN.search(text) and SENSITIVE_STUDY.search(text):
            DROPS["listing: publication safety hold"] += 1
            continue
        source_by_id[lid] = r.pop("_source")
        sources[source_by_id[lid]] += 1
        out.append({k: r[k] for k in ORDER if k in r})
    if os.environ.get("TVD_DATASET_FILE_POOL_ONLY"):
        (WORK / "doi-file-pool.txt").write_text("\n".join(sorted(FILE_POOL)) + "\n")
    write_jsonl(WORK / "datasets.jsonl", out)
    (WORK / "dataset-sources.json").write_text(json.dumps(source_by_id, sort_keys=True))
    if os.environ.get("TVD_DATASETS_REPLAY"):
        (WORK / "recall-evidence.json").write_text(json.dumps(EVIDENCE, ensure_ascii=False))
        (WORK / "junk-ids.json").write_text(json.dumps(sorted(JUNK_IDS)))
        (WORK / "scope-decisions.json").write_text(json.dumps(SCOPE, sort_keys=True))
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
    stats = {"sources": dict(sources), "drops": dict(DROPS.most_common()), "listings": len(out), "code_candidates": len(crow),
             "rule_counts": dict(RULES), "summary_fallbacks": dict(NODESC)}
    (WORK / "build-stats.json").write_text(json.dumps(stats, indent=1, ensure_ascii=False))
    print(json.dumps(stats, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
