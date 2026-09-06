#!/usr/bin/env python3
"""Extract page-addressable evidence directly from a bounded policy PDF.

The script accepts a PDF path and search terms only. It never accepts page text,
which keeps the extraction receipt tied to the bytes identified by sha256.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

import pypdf


MAX_PDF_BYTES = 5_000_000
MAX_PAGES = 500


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def evidence_excerpt(text: str, start: int, end: int) -> str:
    left = max(0, start - 220)
    right = min(len(text), end + 320)
    excerpt = text[left:right]
    sentence_start = max(excerpt.rfind(". ", 0, start - left), excerpt.rfind("; ", 0, start - left))
    if sentence_start >= 0:
        excerpt = excerpt[sentence_start + 2 :]
    return excerpt[:700].strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--match", action="append", default=[], help="literal term required in extracted text")
    parser.add_argument("--attachment-id", help="stored attachment id for a manual persistence request")
    parser.add_argument(
        "--persistence-payload",
        action="store_true",
        help="include a bounded request body for the authenticated review API",
    )
    args = parser.parse_args()
    if args.persistence_payload and not args.attachment_id:
        raise ValueError("--persistence-payload requires --attachment-id")

    raw = args.pdf.read_bytes()
    if len(raw) > MAX_PDF_BYTES:
        raise ValueError(f"PDF exceeds {MAX_PDF_BYTES} bytes")
    if not raw.startswith(b"%PDF-"):
        raise ValueError("input does not have a PDF signature")

    digest = hashlib.sha256(raw).hexdigest()
    reader = pypdf.PdfReader(args.pdf, strict=True)
    if not 1 <= len(reader.pages) <= MAX_PAGES:
        raise ValueError(f"PDF page count must be 1-{MAX_PAGES}")

    page_receipts: list[dict[str, object]] = []
    matches: list[dict[str, object]] = []
    persistence_pages: list[dict[str, object]] = []
    non_empty_pages = 0
    remaining = {term.casefold(): term for term in args.match}
    for index, page in enumerate(reader.pages, start=1):
        text = normalize_text(page.extract_text() or "")
        if len(text) > 32_000:
            raise ValueError(f"page {index} exceeds the 32000-character persistence limit")
        if text:
            non_empty_pages += 1
        page_receipts.append(
            {
                "pageNumber": index,
                "characterCount": len(text),
                "textSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            }
        )
        folded = text.casefold()
        for folded_term, original_term in list(remaining.items()):
            offset = folded.find(folded_term)
            if offset < 0:
                continue
            excerpt = evidence_excerpt(text, offset, offset + len(original_term))
            matches.append(
                {
                    "term": original_term,
                    "pageNumber": index,
                    "evidenceExcerpt": excerpt,
                    "evidenceSha256": hashlib.sha256(excerpt.encode("utf-8")).hexdigest(),
                }
            )
            del remaining[folded_term]
        if text:
            persistence_pages.append(
                {
                    "pageNumber": index,
                    "text": text,
                    "evidenceSpans": [
                        item["term"]
                        for item in matches
                        if item["pageNumber"] == index and item["term"] in text
                    ],
                }
            )

    outcome = "complete" if non_empty_pages else "image-only"
    if remaining and outcome == "complete":
        outcome = "evidence-not-found"
    receipt = {
        "schemaVersion": "policy-pdf-extraction-receipt-v1",
        "outcome": outcome,
        "artifact": args.pdf.name,
        "byteCount": len(raw),
        "sha256": digest,
        "extractor": {"library": "pypdf", "version": pypdf.__version__},
        "pageCount": len(reader.pages),
        "textPageCount": non_empty_pages,
        "pages": page_receipts,
        "matches": matches,
        "allTermsMatched": not remaining,
        "unmatchedTerms": list(remaining.values()),
        "reviewCandidate": {
            "status": "review",
            "artifactSha256": digest,
            "artifactByteCount": len(raw),
            "pageEvidence": matches,
            "automaticPublication": False,
        } if matches else None,
        "persistenceRequest": (
            {
                "attachmentId": args.attachment_id,
                "artifactSha256": digest,
                "extractor": "pypdf-manual-v1",
                "outcome": "complete",
                "pages": persistence_pages,
            }
            if args.persistence_payload and non_empty_pages == len(reader.pages)
            else {
                "attachmentId": args.attachment_id,
                "artifactSha256": digest,
                "extractor": "pypdf-manual-v1",
                "outcome": "failed",
                "errorCode": "image-only" if non_empty_pages == 0 else "malformed-or-unsupported-pdf",
            }
            if args.persistence_payload
            else None
        ),
    }
    json.dump(receipt, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    if outcome == "image-only":
        return 3
    return 0 if not remaining else 2


def entrypoint() -> int:
    try:
        return main()
    except Exception as error:  # produce a machine-visible failure receipt
        json.dump(
            {
                "schemaVersion": "policy-pdf-extraction-receipt-v1",
                "outcome": "failed",
                "errorCode": "malformed-or-unsupported-pdf",
                "error": str(error)[:500],
            },
            sys.stdout,
            indent=2,
        )
        sys.stdout.write("\n")
        return 4


if __name__ == "__main__":
    raise SystemExit(entrypoint())
