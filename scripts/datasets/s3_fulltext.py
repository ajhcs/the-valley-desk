"""Stage 3: PMC full text from NCBI efetch (db=pmc, 20 ids per POST) for papers with candidate mentions.

Only the text blocks are kept, as gzip JSON: fulltext/<PMCID>.json.gz = {"blocks": [[ctx, section, text], ...]}.
ctx is one of body, front, table, ack, fn, notes, ref, back. Phase 0 XML (PHASE0=<dir>) is reused as cache.
"""
import os
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import read_gz_json, http, read_jsonl, save_counts, work_dir, write_gz_json

VERSION = 3
EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"


def text_of(el):
    return re.sub(r"\s+", " ", "".join(el.itertext())).strip()


def blocks_of(article):
    out = []

    def title_of(el):
        t = el.find("title")
        return text_of(t) if t is not None else ""

    def walk(el, path, ctx):
        tag = el.tag if isinstance(el.tag, str) else ""
        if tag in ("ref-list",):
            out.append(["ref", " > ".join(path), text_of(el)[:20000]]); return
        if tag == "ack":
            ctx = "ack"; path = path + [title_of(el) or "Acknowledgements"]
        elif tag in ("fn-group", "fn"):
            ftype = el.get("fn-type") or ""
            ctx = "fn" if ctx in ("body", "back", "front") else ctx
            if ftype:
                path = path + ["fn:" + ftype]
        elif tag == "notes":
            ctx = "notes"; path = path + [title_of(el) or ("notes:" + (el.get("notes-type") or ""))]
        elif tag in ("sec", "app", "boxed-text"):
            t = title_of(el) or (el.get("sec-type") or "")
            path = path + [t]
        elif tag == "table-wrap":
            label = text_of(el.find("label")) if el.find("label") is not None else ""
            cap = text_of(el.find("caption")) if el.find("caption") is not None else ""
            tpath = path + [(label + " " + cap[:120]).strip() or "table"]
            if cap:
                out.append(["table", " > ".join(tpath), cap])
            for tr in el.iter("tr"):
                out.append(["table", " > ".join(tpath), " | ".join(text_of(c) for c in tr)])
            return
        if tag == "p":
            out.append([ctx, " > ".join(path), text_of(el)]); return
        if tag in ("fig",):
            cap = el.find("caption")
            if cap is not None:
                out.append([ctx, " > ".join(path + ["figure"]), text_of(cap)])
            return
        for child in el:
            walk(child, path, ctx)

    front = article.find("front")
    if front is not None:
        for el in front.iter():
            if el.tag in ("notes", "fn-group", "custom-meta-group"):
                walk(el, ["front"], "front")
        abstract = front.find(".//abstract")
        if abstract is not None:
            out.append(["front", "Abstract", text_of(abstract)])
    body = article.find("body")
    if body is not None:
        walk(body, [], "body")
    back = article.find("back")
    if back is not None:
        walk(back, [], "back")
    floats = article.find("floats-group")
    if floats is not None:
        walk(floats, ["floats"], "body")
    return out


def parse_article(xml):
    xml = re.sub(r"<!DOCTYPE[^>]*>", "", xml)
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        # Drop undeclared entities and namespace-less prefixes that break the parser.
        xml2 = re.sub(r"&(?!amp;|lt;|gt;|quot;|apos;|#)\w+;", " ", xml)
        xml2 = re.sub(r"<(/?)[a-zA-Z]+:", r"<\1", xml2)
        xml2 = re.sub(r"\s[a-zA-Z]+:([a-zA-Z]+)=", r" \1=", xml2)
        try:
            root = ET.fromstring(xml2)
        except ET.ParseError:
            plain = re.sub(r"<ref-list.*?</ref-list>", " ", xml, flags=re.S)
            return {"blocks": [["body", "", re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", plain))]],
                    "affiliations": []}
    for el in root.iter():  # strip namespaces
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    affiliations = [" ".join(" ".join(aff.itertext()).split())
                    for aff in root.findall("./front/article-meta//aff")]
    return {"blocks": blocks_of(root),
            "affiliations": list(dict.fromkeys(aff for aff in affiliations if aff))}


def pmcid_of(art):
    m = re.search(r'<article-id pub-id-type="(?:pmc|pmcid|pmcaid)">(?:PMC)?(\d+)</article-id>', art)
    return "PMC" + m.group(1) if m else None


def main():
    work = work_dir(); out = work / "fulltext"; out.mkdir(exist_ok=True)
    rows = read_jsonl(work / "candidate-mentions.jsonl")
    want = sorted({r["pmcid"] for r in rows if r["section"] != "References"})
    phase0 = Path(os.environ["PHASE0"]) / "fulltext" if os.environ.get("PHASE0") else None
    todo = []
    for p in want:
        f = out / f"{p}.json.gz"
        if f.exists() and read_gz_json(f).get("version") == VERSION:
            continue
        f0 = phase0 / f"{p}.xml" if phase0 else None
        if f0 and f0.exists() and f0.stat().st_size:
            write_gz_json(out / f"{p}.json.gz", {**parse_article(f0.read_text(errors="replace")), "via": "phase0", "version": VERSION})
            continue
        todo.append(p)
    print("papers", len(want), "to fetch", len(todo), flush=True)
    missing = []
    for i in range(0, len(todo), 20):
        batch = todo[i:i + 20]
        status, body = http(EFETCH, data={"db": "pmc", "id": ",".join(p[3:] for p in batch), "retmode": "xml",
                                          "tool": "valley-desk-research"}, timeout=180)
        xml = body.decode("utf-8", "replace") if status == 200 else ""
        got = set()
        for art in re.findall(r"<article[ >].*?</article>", xml, re.S):
            p = pmcid_of(art)
            if p in batch:
                write_gz_json(out / f"{p}.json.gz", {**parse_article(art), "via": "efetch", "version": VERSION})
                got.add(p)
        missing += [p for p in batch if p not in got]
        if (i // 20) % 25 == 0:
            print("batch", i // 20, "of", (len(todo) + 19) // 20, "missing so far", len(missing), flush=True)
    save_counts("fulltext")
    (work / "fulltext-missing.txt").write_text("\n".join(missing))
    have = sum(1 for p in want if (out / f"{p}.json.gz").exists())
    print("have", have, "of", len(want), "missing", len(missing))


if __name__ == "__main__":
    main()
