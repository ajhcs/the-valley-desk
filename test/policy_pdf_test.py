"""Synthetic PDF-byte regressions; these are not official production evidence."""
import importlib.util
import io
import unittest
from pathlib import Path
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

spec = importlib.util.spec_from_file_location("legislative_pdf", Path(__file__).resolve().parents[1] / "scripts/extract-legislative-pdf.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def pdf(pages):
    writer = PdfWriter()
    for text in pages:
        page = writer.add_blank_page(width=612, height=792)
        font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(("BT /F1 12 Tf 10 700 Td (" + text + ") Tj ET").encode())
        page[NameObject("/Contents")] = writer._add_object(stream)
    result = io.BytesIO()
    writer.write(result)
    return result.getvalue()


HEADER = "PRIOR PRINTER'S NO. 2403 PRINTER'S NO. 3349 THE GENERAL ASSEMBLY OF PENNSYLVANIA HOUSE BILL No. 1925 Session of 2025 "


def manifest():
    url = "https://palegis.us/legislation/bills/text/PDF/2025/0/HB1925/PN3349"
    return {"record": {"bill": "HB 1925", "session": "2025-2026", "current": {"printer": "PN 3349", "url": url}, "actionAt": "2026-06-25T00:00:00.000Z", "blocker": None}, "pdfUrl": url, "officialPageSha256": "a" * 64}


class PdfEvidenceTest(unittest.TestCase):
    def test_captured_official_pdf_bytes_are_mandatory(self):
        fixtures = Path(__file__).resolve().parent / "fixtures/pa-legislation"
        for bill, pn, pages, digest in [
            ("HB1925", "3349", 43, "120fbf987f734d1ca437a30d582455853d7f68221c701b9eb99a68de2d329971"),
            ("SB1113", "1376", 29, "caaceef30b7adda3c38b83411bc412b5bb0403869ae3048890c4b81748808779"),
            ("HB1993", "2515", 7, "058e1a7f3e8f436af3f205be22e86cddd3e88cb946541fa53a0e0b996bca9f69"),
        ]:
            with self.subTest(bill=bill):
                raw = (fixtures / f"captured-{bill.lower()}-pn{pn}-20260907.pdf").read_bytes()
                self.assertEqual(module.sha(raw), digest)
                m = manifest()
                url = f"https://palegis.us/legislation/bills/text/PDF/2025/0/{bill}/PN{pn}"
                m["record"]["bill"] = bill[:2] + " " + bill[2:]
                m["record"]["current"] = {"printer": "PN " + pn, "url": url}
                m["pdfUrl"] = url
                m["officialPageSha256"] = module.sha((fixtures / f"captured-{bill.lower()}-20260906.html").read_bytes())
                result = module.extract(raw, m, ["artificial intelligence"])
                self.assertEqual(result["outcome"], "complete")
                self.assertEqual(result["pageCount"], pages)
                self.assertEqual(len(result["pages"]), pages)
                self.assertTrue(result["passages"])
                self.assertEqual(result["artifactSha256"], digest)

    def test_version_bound_literal_page_evidence_and_idempotency(self):
        raw = pdf([HEADER + "Artificial intelligence disclosure.", "Artificial intelligence review requirements."])
        result = module.extract(raw, manifest(), ["artificial intelligence"])
        self.assertEqual(result["outcome"], "complete")
        self.assertEqual(result["binding"]["printer"], "PN 3349")
        self.assertEqual([p["pageNumber"] for p in result["passages"]], [1, 2])
        for passage in result["passages"]:
            self.assertIn(passage["text"], result["pages"][passage["pageNumber"] - 1]["text"])
            self.assertTrue(passage["citationUrl"].endswith("#page=" + str(passage["pageNumber"])))
        self.assertEqual(result, module.extract(raw, manifest(), ["artificial intelligence"]))
        self.assertFalse(result["publicationAuthorized"])
        self.assertIn("amendment-markup-requires-review", result["interpretationBlockers"])

    def test_rejects_wrong_printer_bill_and_session_in_actual_pdf_header(self):
        for text in [HEADER.replace("NO. 3349", "NO. 2403"), HEADER.replace("No. 1925", "No. 1993"), HEADER.replace("Session of 2025", "Session of 2023")]:
            result = module.extract(pdf([text]), manifest(), [])
            self.assertEqual(result["outcome"], "failed")
            self.assertIn("pdf-header-version-mismatch-or-unreadable", result["blockers"])
            self.assertEqual(result["passages"], [])

    def test_rejects_inconsistent_url(self):
        m = manifest()
        m["record"]["current"]["url"] = m["pdfUrl"].replace("3349", "2403")
        self.assertIn("inconsistent-printer-pdf-association", module.extract(pdf([HEADER]), m, [])["blockers"])

    def test_second_year_of_biennial_session_is_valid(self):
        result = module.extract(pdf([HEADER.replace("Session of 2025", "Session of 2026")]), manifest(), [])
        self.assertEqual(result["outcome"], "complete")
        self.assertEqual(result["binding"]["session"], "2025-2026")

    def test_explicit_malformed_image_only_and_partial_outcomes(self):
        self.assertEqual(module.extract(b"not pdf", manifest(), [])["blockers"], ["invalid-pdf-signature"])
        self.assertIn("malformed-or-unsupported-pdf", module.extract(b"%PDF-1.7 broken", manifest(), [])["blockers"])
        self.assertIn("image-only-pdf", module.extract(pdf([""]), manifest(), [])["blockers"])
        result = module.extract(pdf([HEADER, ""]), manifest(), [])
        self.assertEqual(result["outcome"], "partial")
        self.assertIn("incomplete-page-extraction", result["blockers"])

    def test_missing_action_and_missing_evidence_remain_blocked(self):
        m = manifest()
        m["record"]["actionAt"] = None
        result = module.extract(pdf([HEADER]), m, ["absent provision"])
        self.assertEqual(result["outcome"], "partial")
        self.assertIn("official-action-date-missing-or-invalid", result["blockers"])
        self.assertIn("requested-evidence-not-found", result["blockers"])


if __name__ == "__main__":
    unittest.main()
