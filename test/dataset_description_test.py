import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "datasets"))
from dataset_description import data_type_for_record, pick_summary


class DatasetDescriptionTests(unittest.TestCase):
    def test_selects_recorded_data_over_background(self):
        self.assertEqual(
            pick_summary("Cancer affects many people. We collected RNA sequencing data from 20 tumor samples."),
            "We collected RNA sequencing data from 20 tumor samples.",
        )

    def test_does_not_invent_data_from_findings(self):
        self.assertEqual(pick_summary("The treatment significantly improved survival in our study."), "")

    def test_does_not_publish_incomplete_long_sentence(self):
        self.assertEqual(pick_summary("The dataset contains " + "measurements of specimens " * 20), "")

    def test_uses_format_only_when_modality_is_supported(self):
        self.assertEqual(data_type_for_record("experimental data", "10.5061", ["FASTQ.gz"]), "sequencing")
        self.assertEqual(data_type_for_record("experimental data", "10.5281", ["application/dicom"]), "imaging")
        self.assertEqual(data_type_for_record("experimental data", "10.6084", ["CSV", "mzML"]), "other")

    def test_text_classification_precedes_format(self):
        self.assertEqual(data_type_for_record("single-cell RNA-seq data", "10.6084", ["FASTQ"]), "single-cell")


if __name__ == "__main__":
    unittest.main()
