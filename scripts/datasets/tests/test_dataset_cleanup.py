import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build import seq_data_type
from dataset_description import rebuild_summary, thin_summary
from dataset_labels import investigator_ids, match_geo_institution, match_submitter
from s5_repos import ega_pi_affiliations


class DatasetCleanup(unittest.TestCase):
    def test_abbreviations_use_registry_ids(self):
        for alias, expected in [
            ("UPENN", "upenn"), ("U Penn", "upenn"), ("TJU", "thomas-jefferson-university"),
            ("Jefferson", "thomas-jefferson-university"), ("Fox Chase", "fox-chase"),
            ("FCCC", "fox-chase"), ("Wistar", "wistar"), ("CHOP", "chop"),
            ("Penn Medicine", "penn-medicine"),
        ]:
            self.assertEqual(match_geo_institution(alias, "Philadelphia", "PA")["institutions"], [expected])
        self.assertFalse(match_submitter("Jefferson Lab, Newport News")["institutions"])

    def test_only_explicit_investigator_fields_count(self):
        names = "Perelman School of Medicine at the University of Pennsylvania, Philadelphia, PA"
        self.assertEqual(investigator_ids({"pi_affiliations": [names]}),
                         ["perelman-school-of-medicine", "upenn"])
        self.assertEqual(ega_pi_affiliations({"abstract": f"Affiliations include {names}."}), [])
        self.assertEqual(ega_pi_affiliations({"description": f"Principal investigator: {names}"}), [names])

    def test_thin_summary_uses_design_or_producing_title(self):
        title = "Expression after cell differentiation"
        brief = "2 RNAseq experiments were performed."
        design = "Cultured cells were differentiated and subjected to bulk RNA sequencing."
        self.assertTrue(thin_summary(brief))
        self.assertTrue(thin_summary("The repository entries describe 12 experimentally determined molecular structures."))
        self.assertEqual(rebuild_summary(brief, title, f"{brief} Experiment 1: {design}"),
                         f"{title} — {design}")
        self.assertEqual(rebuild_summary(brief, title, brief, paper_title="Expression in cultured cells"),
                         "Data from: Expression in cultured cells.")

    def test_reproductive_bottleneck_is_not_single_cell_measurement(self):
        self.assertEqual(seq_data_type("Single cell bottlenecks. We provide whole genome sequencing."), "sequencing")
        self.assertEqual(seq_data_type("Single cell sequencing"), "single-cell")
