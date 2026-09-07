#!/usr/bin/env python3
"""Render retained exact PDF bytes and retain ordered, unclipped layout lines.

Stroke classifications are review hints. Original PDF and lossless page renders
are the authority for amendment formatting. This does not approve a summary.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import re
import resource
import sys
from pathlib import Path
import pymupdf
sys.dont_write_bytecode = True

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

def render(pdf_path, artifact, output):
    # Linux operator subprocess only: cap decompression/render memory and CPU
    # independently of the parent command's wall-clock timeout.
    resource.setrlimit(resource.RLIMIT_AS, (1_073_741_824, 1_073_741_824))
    resource.setrlimit(resource.RLIMIT_CPU, (90, 90))
    raw = pdf_path.read_bytes()
    if len(raw) > 5_000_000 or digest(raw) != artifact["sha256"]:
        raise ValueError("artifact-checksum-mismatch")
    binding = json.loads(artifact["binding_json"])
    record = binding["officialEvidence"].get("officialBillRecord")
    if not record:
        raise ValueError("official-version-record-missing")
    spec = importlib.util.spec_from_file_location("pdfextract", Path(__file__).with_name("extract-legislative-pdf.py"))
    extractor = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(extractor)
    checked = extractor.extract(raw, {"record": record, "pdfUrl": artifact["source_url"],
        "officialRecordSha256": digest(encode(record).encode())}, [])
    if checked["outcome"] != "complete":
        raise ValueError("version-or-extraction-check-failed:" + ",".join(checked["blockers"]))
    doc = pymupdf.open(stream=raw, filetype="pdf")
    if not 1 <= len(doc) <= 100:
        raise ValueError("page-capacity-limit")
    output.mkdir(mode=0o700)
    for index, page in enumerate(doc):
        if page.rect.width * 96 / 72 > 2000 or page.rect.height * 96 / 72 > 3000:
            raise ValueError("render-dimensions-limit")
        strokes = [d["rect"] for d in page.get_drawings() if d.get("rect") and d["rect"].width > 3 and d["rect"].height < 3]
        lines = []
        for block in page.get_text("dict", sort=True)["blocks"]:
            for line in block.get("lines", []):
                text = "".join(s["text"] for s in line["spans"]).strip()
                if not text:
                    continue
                box = pymupdf.Rect(line["bbox"])
                margin = bool((re.fullmatch(r"\d+", text) and box.x0 < 60)
                    or re.match(r"20\d{3}(?:HB|SB)\d+PN\d+", text)
                    or (box.y0 > 730 and re.fullmatch(r"-\s*\d+\s*-", text))
                    or (box.x0 > 530 and text == "<--"))
                marks = set()
                baseline = max(s["origin"][1] for s in line["spans"])
                for stroke in strokes:
                    if stroke.x1 <= box.x0 or stroke.x0 >= box.x1:
                        continue
                    if box.y0 + 2 < stroke.y0 < baseline - 2:
                        marks.add("strike")
                    elif baseline - 2 <= stroke.y0 <= box.y1 + 2:
                        marks.add("underline")
                coords = [round(v, 2) for v in box]
                lines.append({"text": text, "bbox": [int(v) if v.is_integer() else v for v in coords], "role": "margin" if margin else "body", "marks": sorted(marks)})
        if not lines or not any(l["role"] == "body" for l in lines):
            raise ValueError("image-only-or-layout-empty")
        # 96 dpi retains the complete page; originals remain downloadable for zoom.
        png = page.get_pixmap(dpi=96, alpha=False).tobytes("png")
        if len(png)>500_000:
            raise ValueError("render-byte-limit")
        packet = {"artifactSha256": artifact["sha256"], "pageNumber": index + 1,
            "lines": lines, "textSha256": digest(encode(lines).encode()),
            "renderSha256": digest(png), "renderer": "PyMuPDF/" + pymupdf.VersionBind + "/96dpi",
            "pngBase64": base64.b64encode(png).decode()}
        (output / f"page-{index+1}.json").write_text(encode(packet))
        (output / f"page-{index+1}.png").write_bytes(png)
    complete = {"artifactSha256": artifact["sha256"], "pageCount": len(doc),
        "headerIdentity": {"bill": binding["bill"], "session": binding["session"], "printer": binding["printer"]}}
    (output / "complete.json").write_text(encode(complete))
    return complete

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("artifact", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        print(encode(render(args.pdf, json.loads(args.artifact.read_text()), args.output)))
    except Exception as error:
        reason = str(error)
        code = "capacity-limit" if "limit" in reason or "capacity" in reason else "image-only" if "image-only" in reason else "version-mismatch" if "version" in reason or "checksum" in reason else "render-failed"
        # Bounded machine diagnostics; do not emit PDF text, paths or tracebacks.
        print(encode({"outcome": "failed", "error": code}), file=sys.stderr)
        sys.exit(1)
