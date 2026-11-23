"""Stage 4: classify each candidate mention as produced, reused, code or drop (rules v3, from phase 0 v2).

Input: candidate-mentions.jsonl, fulltext/*.json.gz, papers.json.
Output: mentions-classified.jsonl (one row per paper x accession, with the evidence used).
"""
import collections
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import read_gz_json, read_jsonl, work_dir, write_jsonl

RULES = "v3"
# --- cues (v2 base, v3 changes noted) ---
CAT = re.compile(r"cat(?:alog(?:ue)?)?\s?(?:#|no\b|number)|\bthermo ?fisher|invitrogen|sigma|biolegend|origene|worthington|"
                 r"\brrid\b|abcam|cell signaling|santa cruz|bd biosciences|millipore|qiagen|addgene|jackson immuno|"
                 r"r&d systems|promega|bio-?rad|new england biolabs|takara|vector lab|atcc|dharmacon|ipa\b", re.I)
GRANT = re.compile(r"\b(grant|award|funded|funding|supported by|contract (?:no|number)|fellowship)\b", re.I)
REU = re.compile(r"\b(download\w*|obtained from|retrieved|previously|reanaly\w*|re-analy\w*|reused|re-used|"
                 r"is from|were from|was from|data from|used in this study|were used|was used|we used|using (?:the )?(?:publicly|public|published)|"
                 r"from the (?:study|dataset)|as (?:a )?template|homology model|reference (?:genome|sequence|structure)|"
                 r"et al\b|leucegene|encode\b|"
                 # v3 additions
                 r"based on (?:the )?(?:\w+[- ])?(?:structures?|coordinates|cryo-?em|crystal)|(?:were|was) (?:taken|adapted|acquired|collected) from|"
                 r"publicly available (?:data(?:sets?)?|cohorts?|resources?|databases?)|from (?:a |the )?(?:public|published|previous) (?:data|study|studies|dataset)|"
                 r"accessed (?:on|via|through|at)|was compared|were compared|compared (?:to|with) (?:the )?(?:published|public|previous)|"
                 r"docked|superimpos\w*|overlay|aligned (?:to|with)|tcga\b|gtex\b|cptac\b|ukb|uk biobank|"
                 r"mined|data mining|portal|sourced from|starting (?:structures?|models?)|initial models?|search models?|molecular replacement|"
                 r"derived from|(?:a|the|our) previous (?:study|work|report|publication)|previous(?:ly)? published|"
                 r"refs?\. ?\d+|based on the available|data ?sets? (?:were |are )?available from|analy[sz]ed (?:\w+ ){0,3}data ?sets)\b|\(\d{1,3}(?:[,\u2013-]\s?\d{1,3})*\)", re.I)
CODE = re.compile(r"\b(code|codes|scripts?|software|github|pipeline|package|notebooks?|source code|algorithm|tool)\b", re.I)
DATAWORD = re.compile(r"\b(data|dataset|datasets|files|measurements|trajectories|predictions|results|images|recordings|raw)\b", re.I)
DEP = re.compile(r"\b(deposit\w*|submitted|uploaded|available|accession|can be (?:accessed|found)|generated|"
                 r"this (?:paper|manuscript|study|work|article)|posted|released|archived)\b", re.I)
STRONG = re.compile(r"\b(deposit\w*|submitted to|uploaded to|this (?:paper|study|work|manuscript|article)|"
                    r"(?:generated|produced|collected|acquired|obtained|created) (?:in|during|for|by|from) (?:this|the present|the current|our) (?:study|work|paper)|"
                    r"present study|current study|our data|newly generated|accession (?:codes?|numbers?)|have been released)\b", re.I)
DATASECT = re.compile(r"data[ -](?:availability|access|sharing|deposition)|availability of data|accession|deposition|"
                      r"data and (?:code|software|materials) availability|key resources|deposited data|resource availability", re.I)
REFINE = re.compile(r"refinement statistics|data collection and refinement|crystallographic data|cryo-?em data collection", re.I)
BADSECT = re.compile(r"^(references?|bibliography|acknowledg\w*|funding|financial|disclosure|conflicts? of interest|competing interests?|"
                     r"declaration of (?:interests?|competing)|author contributions?|fn:financial|fn:coi|fn:con|fn:conflict)", re.I)
PLACEHOLDER = re.compile(r"x{3,}|0{5,}|_{3}|\?{2,}", re.I)
GEN_LEADIN = re.compile(r"(following|these) (?:new )?(?:data ?sets?|data) (?:was|were|have been) (?:generated|deposited|produced)|"
                        r"datasets? generated", re.I)
REU_LEADIN = re.compile(r"(following|these) (?:previously published )?(?:data ?sets?|data) (?:was|were) used|previously published (?:data ?sets?|data)", re.I)
STRUCT_DEP = re.compile(r"\b((?:have|has) been deposited|were deposited|was deposited|we deposited|deposited by us|"
                        r"submitted to|have been assigned|been released under|deposition (?:codes?|numbers?|ids?))\b", re.I)
MEDIA = re.compile(r"digital features|graphical abstract|video abstract|plain language summary|enhanced features", re.I)
PROTOCOL = re.compile(r"\b(protocols?|preregist\w*|pre-regist\w*|analysis plan|codebook|questionnaire template)\b", re.I)
REGISTRATION = re.compile(r"\b(registered|pre-?regist\w*|protocol|prospero)\b", re.I)


def unit_of(repo, exact):
    """(unit type, key) or (None, drop reason)."""
    a = exact.strip().rstrip(".,;)")
    up = a.upper()
    if PLACEHOLDER.search(a):
        return None, "placeholder accession"
    if repo == "GEO":
        if re.fullmatch(r"GSE\d+", up): return "geo", up
        if re.fullmatch(r"GSM\d+", up): return "geo-sample", up
        if re.fullmatch(r"GDS\d+", up): return "geo-gds", up
        if re.fullmatch(r"GPL\d+", up): return None, "GEO platform record"
        return None, "unrecognised GEO accession"
    if repo in ("ENA", "BioProject"):
        if re.fullmatch(r"PRJ[NED][A-Z]\d+", up): return "bioproject", up
        if re.fullmatch(r"[SED]RP\d+", up): return "sra-study", up
        if re.fullmatch(r"[SED]R[RXS]\d+|SAM[NED][A-Z]?\d+", up): return "sra-run", up
        if re.fullmatch(r"[SED]RA\d+", up): return "sra-run", up
        return None, "raw GenBank/ENA sequence accession"
    if repo == "GCA":
        if re.fullmatch(r"GC[AF]_\d+(\.\d+)?", up): return "assembly", up
        return None, "unrecognised assembly accession"
    if repo == "dbGaP":
        m = re.match(r"PHS\d{6}", up)
        return ("dbgap", m.group(0).lower()) if m else (None, "unrecognised dbGaP accession")
    if repo == "EGA":
        m = re.match(r"EGA[SD]\d{11}", up)
        return ("ega", m.group(0)) if m else (None, "unrecognised EGA accession")
    if repo == "PRIDE":
        m = re.match(r"PXD\d{6}", up)
        return ("pride", m.group(0)) if m else (None, "unrecognised PRIDE accession")
    if repo == "PDBe":
        if re.fullmatch(r"[1-9][A-Z0-9]{3}", up): return "pdb", up
        return None, "unrecognised PDB accession"
    if repo == "EMDB":
        m = re.match(r"EMD-?(\d{4,5})", up)
        return ("emdb", "EMD-" + m.group(1)) if m else (None, "unrecognised EMDB accession")
    if repo in ("ArrayExpress", "BioStudies"):
        if re.fullmatch(r"E-[A-Z]{4}-\d+", up): return "arrayexpress", up
        return None, "BioStudies record outside the record contract"
    if repo == "MetaboLights": return None, "MetaboLights outside the record contract"
    if repo == "Gisaid": return None, "individual GISAID sequence"
    if a.lower().startswith("10."):
        doi = a.lower().rstrip(".")
        doi = re.sub(r"[\]\)>,;]+$", "", doi)
        return "doi", doi
    return None, "unrecognised accession"


ABBR = re.compile(r"(?:\b(?:e\.g|i\.e|et al|Fig|Figs|Ref|Refs|No|no|vs|approx|ca|Dr|Inc|Ltd|Co|Corp|Suppl|Tab|Eq|Ext|Supplementary Fig)\.)$")


def sentences(text):
    out, start = [], 0
    for m in re.finditer(r"[.!?](?:\d{1,3}(?:[,\u2013-]\d{1,3})*)?(?=\s+[A-Z(\[])", text):
        if ABBR.search(text[max(0, m.start() - 25):m.end()]):
            continue
        out.append((start, m.end())); start = m.end()
    out.append((start, len(text)))
    return out


def find(text, exact):
    k = text.find(exact)
    if k < 0 and exact.lower().startswith("10."):
        k = text.lower().find(exact.lower())
    if k < 0:
        k = text.upper().find(exact.upper()) if len(exact) >= 4 else -1
    return k


def context(block, exact):
    ctx, section, text = block
    k = find(text, exact)
    if k < 0:
        return None
    for s, e in sentences(text):
        if s <= k < e:
            sent = text[s:e].strip()
            break
    else:
        sent = text[max(0, k - 250):k + 250]
    rel = find(sent, exact)
    # clause containing the mention
    cs = sent.rfind("; ", 0, rel); ce = sent.find("; ", rel)
    clause = sent[cs + 2 if cs >= 0 else 0: ce if ce >= 0 else len(sent)]
    prefix = text[max(0, k - 60):k]
    return {"ctx": ctx, "section": section, "sentence": sent[:600], "clause": clause[:600], "prefix": prefix}


def classify_occurrence(m, c, leadin):
    """Return (decision, reason) for one occurrence."""
    repo, unit = m["repo"], m["unit"]
    s, cl, sec, ctx = c["sentence"], c["clause"], c["section"], c["ctx"]
    last = sec.split(" > ")[-1] if sec else ""
    datasect = bool(DATASECT.search(sec)) or bool(re.match(r"\s*data (?:availability|access|sharing)", s, re.I))
    if ctx == "ref":
        return "drop", "references section"
    if (ctx in ("ack", "fn") or BADSECT.search(last) or any(BADSECT.search(p) for p in sec.split(" > "))) and not datasect:
        return "drop", "acknowledgement/funding/disclosure section"
    if CAT.search(c["prefix"][-40:]) or (ctx == "table" and CAT.search(s) and not re.search(r"this (?:paper|study)", s, re.I)):
        return "drop", "catalog number"
    if GRANT.search(c["prefix"][-40:]):
        return "drop", "grant number"
    if m["unit"] == "doi" and MEDIA.search(s):
        return "drop", "article media, not data"
    if repo == "OSF" and (re.search(r"regist", c["prefix"][-60:], re.I) or (REGISTRATION.search(s) and not DATAWORD.search(s))):
        return "drop", "study registration, not data"
    if m["unit"] == "doi" and PROTOCOL.search(s) and not DATAWORD.search(s):
        return "drop", "protocol document, not data"
    text = cl if (REU.search(cl) or DEP.search(cl) or STRONG.search(cl)) else s
    table_this = ctx == "table" and re.search(r"\bthis (?:paper|study|work|manuscript)\b", s, re.I)
    nodata = lambda t: re.sub(r"(?i)code availability|data (?:analysis|processing|visuali[sz]ation)|analy[sz]e (?:the )?data", "", t)
    if table_this and not re.search(r"et al\b|\b(19|20)\d\d\b", s):
        if repo in ("Zenodo", "figshare", "OSF") and CODE.search(s) and not DATAWORD.search(nodata(s)):
            return "code", "key resources row: code"
        return "produced", "key resources row: this paper"
    if REU.search(text):
        return "reused", "reuse cue: " + REU.search(text).group(0)
    if leadin == "reused" and not STRONG.search(text):
        return "reused", "listed under previously published datasets"
    if repo in ("Zenodo", "figshare", "OSF", "Mendeley Data", "Dryad", "Dataverse") and CODE.search(text) \
            and not DATAWORD.search(nodata(text)):
        return "code", "code cue: " + CODE.search(text).group(0)
    if unit in ("pdb", "emdb"):
        # v3: structures need a deposition cue, a data section, or a refinement-statistics table.
        if STRUCT_DEP.search(text) or (REFINE.search(sec + " " + s) and not REU.search(s)):
            return "produced", "structure deposition cue"
        return "unclear", "structure mentioned without deposition cue"
    if ctx == "table" and re.search(r"key resources", sec, re.I):
        return "unclear", "key resources row without this-paper source"
    if leadin == "produced":
        return "produced", "listed under generated datasets"
    if datasect:
        return "produced", "data availability section"
    if DEP.search(text):
        return "produced", "deposit cue: " + DEP.search(text).group(0)
    return "unclear", "no deposit cue"


def leadins(blocks):
    """Per block index, the lead-in state ('produced'/'reused') from the nearest preceding lead-in in the same section."""
    state, sec, out = None, None, []
    for b in blocks:
        if b[1] != sec:
            state, sec = None, b[1]
        t = b[2]
        if REU_LEADIN.search(t) and len(t) < 300:
            state = "reused"
        elif GEN_LEADIN.search(t) and len(t) < 300:
            state = "produced"
        out.append(state)
    return out


def main():
    work = work_dir()
    papers = {p["pmcid"]: p for p in json.loads((work / "papers.json").read_text())}
    rows = read_jsonl(work / "candidate-mentions.jsonl")
    # one row per paper x accession; keep a non-References section if any annotation had one
    merged = {}
    for r in rows:
        key = (r["pmcid"], r["exact"].strip().lower())
        prev = merged.get(key)
        if not prev or (prev["section"] == "References" and r["section"] != "References"):
            merged[key] = r
    out = []
    cache = {}
    for (pmcid, _), m in sorted(merged.items()):
        unit_type, key = unit_of(m["repo"], m["exact"])
        paper = papers[pmcid]
        row = {"paper": paper["id"], "pmcid": pmcid, "repo": m["repo"], "exact": m["exact"], "unit_type": unit_type,
               "unit": key if unit_type else None, "annotation_section": m["section"], "rules": RULES}
        if not unit_type:
            row.update(decision="drop", reason=key); out.append(row); continue
        m = dict(m, unit=unit_type)
        if m["section"] == "References":
            row.update(decision="drop", reason="references section"); out.append(row); continue
        if pmcid not in cache:
            f = work / "fulltext" / f"{pmcid}.json.gz"
            blocks = read_gz_json(f)["blocks"] if f.exists() else None
            cache = {pmcid: (blocks or None, leadins(blocks) if blocks else None)}
        blocks, leads = cache[pmcid]
        if blocks is None:
            row.update(decision="drop", reason="full text unavailable"); out.append(row); continue
        occ = []
        for b, lead in zip(blocks, leads):
            c = context(b, m["exact"])
            if c:
                d, why = classify_occurrence(m, c, lead)
                occ.append((d, why, c))
        if not occ:
            row.update(decision="drop", reason="not found in full text"); out.append(row); continue
        decisions = [o[0] for o in occ]
        # Strict: any reuse occurrence wins; then produced; then code; then unclear; then drop.
        for want in ("reused", "produced", "code", "unclear", "drop"):
            if want in decisions:
                d, why, c = next(o for o in occ if o[0] == want); break
        if d == "unclear":
            why = "no deposit cue" if why == "no deposit cue" else why
        row.update(decision=d, reason=why, sentence=c["sentence"], clause=c["clause"], section=c["section"],
                   ctx=c["ctx"], occurrences=len(occ))
        out.append(row)
    write_jsonl(work / "mentions-classified.jsonl", out)
    print("rows", len(out))
    print(collections.Counter(r["decision"] for r in out))
    print(collections.Counter((r["unit_type"], r["decision"]) for r in out if r["decision"] == "produced").most_common())
    print(collections.Counter(r["reason"] for r in out if r["decision"] != "produced").most_common(15))


if __name__ == "__main__":
    main()
