#!/usr/bin/env python3
"""Offline, bounded extraction of a PA PDF against a parsed official bill record.

Input record is produced by capture-policy-background.mjs from retained official
HTML. This does not authenticate an arbitrary operator-supplied JSON document.
Output is literal evidence for review, never an interpretation of operative law.
"""
import argparse
import hashlib
import io
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

MAX_BYTES = 5_000_000
MAX_PAGES = 500
MAX_TEXT = 2_000_000


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def extract(raw, manifest, terms):
    import pypdf
    receipt = {
        "schemaVersion": "pa-version-pdf-evidence-v1", "outcome": "failed",
        "artifactSha256": sha(raw), "byteCount": len(raw), "binding": None,
        "extractor": {"name": "pypdf", "version": pypdf.__version__},
        "pages": [], "passages": [], "blockers": [],
        "publicationAuthorized": False, "productionPersistence": False,
        "interpretation": "Literal proposed-bill text; not a finding of operative law.",
    }
    def fail(code):
        receipt["blockers"].append(code)
        return receipt
    if not raw.startswith(b"%PDF-"):
        return fail("invalid-pdf-signature")
    if len(raw) > MAX_BYTES:
        return fail("pdf-byte-limit")
    record = manifest.get("record", {})
    current = record.get("current") or {}
    bill = re.fullmatch(r"(HB|SB) ([1-9][0-9]*)", record.get("bill", ""))
    session = re.fullmatch(r"(20[0-9]{2})-(20[0-9]{2})", record.get("session", ""))
    printer = re.fullmatch(r"PN ([1-9][0-9]*)", current.get("printer", ""))
    if not bill or not session or not printer or int(session[2]) != int(session[1]) + 1:
        return fail("invalid-bill-version-identity")
    url = urlsplit(current.get("url", ""))
    expected = f"/legislation/bills/text/PDF/{session[1]}/0/{bill[1]}{bill[2]}/PN{printer[1]}"
    if (url.scheme != "https" or url.netloc not in ("palegis.us", "www.palegis.us")
            or url.path != expected or url.query or url.fragment
            or manifest.get("pdfUrl") != current.get("url")
            or not re.fullmatch(r"[a-f0-9]{64}", manifest.get("officialPageSha256", ""))):
        return fail("inconsistent-printer-pdf-association")
    receipt["binding"] = {
        "bill": record["bill"], "session": record["session"],
        "printer": current["printer"], "pdfUrl": current["url"],
        "officialPageSha256": manifest["officialPageSha256"],
        "recordSha256": sha(json.dumps(record, sort_keys=True, separators=(",", ":")).encode()),
    }
    try:
        reader = pypdf.PdfReader(io.BytesIO(raw), strict=True)
        if reader.is_encrypted:
            return fail("encrypted-pdf")
        if not 1 <= len(reader.pages) <= MAX_PAGES:
            return fail("pdf-page-limit")
        receipt["pageCount"] = len(reader.pages)
        total = 0
        for number, page in enumerate(reader.pages, 1):
            try:
                text = re.sub(r"\s+", " ", page.extract_text() or "").strip()
                total += len(text)
                if len(text) > 32_000 or total > MAX_TEXT:
                    return fail("pdf-text-limit")
                receipt["pages"].append({"pageNumber": number, "text": text, "textSha256": sha(text.encode()),
                                         "outcome": "extracted" if text else "no-extractable-text"})
            except Exception:
                receipt["pages"].append({"pageNumber": number, "outcome": "page-extraction-failed"})
        first = receipt["pages"][0].get("text", "")
        if all(p.get("outcome") == "no-extractable-text" for p in receipt["pages"]):
            return fail("image-only-pdf")
        # A prior printer is history, not the PDF's selected current printer.
        header = first.split("THE GENERAL ASSEMBLY", 1)[0]
        header = re.sub(r"PRIOR PRINTER(?:'|’)?S?\s+NO[S]?\.?\s*[0-9, ]+", "", header, flags=re.I)
        printers = re.findall(r"PRINTER(?:'|’)?S?\s+NO\.?\s*([0-9]+)", header, flags=re.I)
        chamber = "HOUSE" if bill[1] == "HB" else "SENATE"
        if (printers != [printer[1]] or not re.search(rf"{chamber} BILL\s+No\.\s*{bill[2]}\b", first)
                or not re.search(rf"Session of\s+(?:{session[1]}|{session[2]})\b", first)):
            return fail("pdf-header-version-mismatch-or-unreadable")
        if record.get("blocker"):
            receipt["blockers"].append("official-record-review-blocker")
        try:
            action = record.get("actionAt") or ""
            if not re.fullmatch(r"20[0-9]{2}-[0-9]{2}-[0-9]{2}T00:00:00\.000Z", action):
                raise ValueError("date")
            datetime.fromisoformat(action.replace("Z", "+00:00"))
        except ValueError:
            receipt["blockers"].append("official-action-date-missing-or-invalid")
        if any(p["outcome"] != "extracted" for p in receipt["pages"]):
            receipt["blockers"].append("incomplete-page-extraction")
        for page in receipt["pages"]:
            text = page.get("text", "")
            for term in terms:
                match = re.search(re.escape(term), text, re.I)
                if match:
                    excerpt = text[max(0, match.start() - 200):min(len(text), match.end() + 500)]
                    receipt["passages"].append({"term": term, "pageNumber": page["pageNumber"],
                        "text": excerpt, "sha256": sha(excerpt.encode()),
                        "citationUrl": current["url"] + "#page=" + str(page["pageNumber"])})
                    if len(receipt["passages"]) >= 200:
                        return fail("passage-limit")
        receipt["unmatchedTerms"] = [t for t in terms if not any(p["term"] == t for p in receipt["passages"])]
        if receipt["unmatchedTerms"]:
            receipt["blockers"].append("requested-evidence-not-found")
        receipt["outcome"] = "partial" if receipt["blockers"] else "complete"
        # PDF extraction loses strikeout/underline semantics. Even complete byte
        # extraction is not authority to turn a proposal into a legal requirement.
        receipt["interpretationBlockers"] = ["proposed-text-not-operative-law", "amendment-markup-requires-review"]
        return receipt
    except Exception:
        return fail("malformed-or-unsupported-pdf")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--match", action="append", default=[])
    args = parser.parse_args()
    try:
        if args.pdf.stat().st_size > MAX_BYTES or args.manifest.stat().st_size > 100_000:
            raise ValueError("input-size-limit")
        if len(args.match) > 20 or any(not t.strip() or len(t) > 100 for t in args.match):
            raise ValueError("invalid-search-terms")
        result = extract(args.pdf.read_bytes(), json.loads(args.manifest.read_text()), args.match)
    except Exception as error:
        result = {"schemaVersion": "pa-version-pdf-evidence-v1", "outcome": "failed",
                  "blockers": [str(error) if isinstance(error, ValueError) else "input-unavailable"],
                  "publicationAuthorized": False, "productionPersistence": False}
    print(json.dumps(result, indent=2))
    return 0 if result["outcome"] == "complete" else 2


if __name__ == "__main__":
    sys.exit(main())
