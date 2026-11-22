from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

from institutions import REFERENCE, load_reference
from mechanical import MechanicalProjector
from validate import validate_record


def fixture(affiliation):
    europe = {
        "source": "MED",
        "id": "12345678",
        "doi": "10.9999/test.publisher",
        "title": "Recovery after a stroke",
        "firstIndexDate": "2026-10-17",
        "electronicPublicationDate": "2026-10-15",
        "journalInfo": {"journal": {"title": "Fixture Journal"}},
        "authorList": {
            "author": [
                {
                    "fullName": "Example, A",
                    "authorAffiliationDetailsList": {"authorAffiliation": [{"affiliation": affiliation}]},
                }
            ]
        },
    }
    crossref = {"DOI": europe["doi"], "published-online": {"date-parts": [[2026, 10, 12]]}}
    return {
        "id": "doi:10.9999/test.publisher",
        "provider_key": ["europepmc", "MED", "12345678"],
        "identifier_conflict": False,
        "identifiers": ["doi:10.9999/test.publisher", "pmid:12345678"],
        "observations": [
            {"provider": "europepmc", "record": europe},
            {"provider": "crossref", "record": crossref},
        ],
    }


class MechanicalPublicationTest(unittest.TestCase):
    def setUp(self):
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.postal = Path(tmp.name) / "US.zip"
        with ZipFile(self.postal, "w") as archive:
            archive.writestr(
                "US.txt",
                "US\t19104\tPhiladelphia\tPennsylvania\tPA\tPhiladelphia\n"
                "US\t19087\tWayne\tPennsylvania\tPA\tDelaware\n",
            )

    def projector(self, existing=(), excluded_identifiers=()):
        return MechanicalProjector(REFERENCE, self.postal, existing, excluded_identifiers, "2026-11-22")

    def test_literal_byline_and_earliest_explicit_online_date(self):
        result = self.projector().project(fixture("The Wistar Institute, Philadelphia, PA 19104"))
        row = result.record
        self.assertEqual(row["source"], "https://europepmc.org/article/MED/12345678")
        self.assertEqual(row["url"], "https://doi.org/10.9999/test.publisher")
        self.assertEqual(row["published"], "2026-10-12")
        self.assertEqual(row["institutions"], ["wistar"])
        self.assertEqual(row["counties"], ["Philadelphia"])
        self.assertEqual(row["label"], "Verified")
        self.assertIsNone(row["topic"])
        self.assertEqual(result.evidence["index_dates"], ["2026-10-17"])
        validate_record(
            row | {"topic": "Clinical care"},
            {reference["id"]: reference for reference in load_reference()},
            set(),
            {},
        )

    def test_mismatched_postal_code_does_not_support_a_county(self):
        result = self.projector().project(fixture("The Wistar Institute, Philadelphia, PA 19087"))
        self.assertEqual(result.record["label"], "Listed")
        self.assertEqual(result.record["counties"], [])

    def test_existing_identifiers_and_private_holds_win_before_projection(self):
        candidate = fixture("The Wistar Institute, Philadelphia, PA 19104")
        projector = self.projector()
        original = projector.project(candidate).record
        self.assertEqual(projector.project(candidate).reason, "duplicate or already published")
        self.assertEqual(
            self.projector(existing=[original]).project(candidate).reason, "duplicate or already published"
        )
        held = self.projector(excluded_identifiers=["pmid:12345678"]).project(candidate)
        self.assertEqual(held.reason, "prior privacy hold or removal")
        self.assertIsNone(held.evidence)

    def test_does_not_infer_a_regional_site_from_outside_penn_medicine_byline(self):
        candidate = fixture("Penn Medicine Princeton Medical Center, Plainsboro, NJ")
        self.assertEqual(self.projector().project(candidate).reason, "no qualifying literal byline")


if __name__ == "__main__":
    unittest.main()
