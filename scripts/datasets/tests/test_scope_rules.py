import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from datacite_rules import generic_supplement_decision, health_decision, is_supplement


class ScopeRulesTest(unittest.TestCase):
    def test_scope_requires_health_or_biomedical_evidence(self):
        for record in (
            {'title': 'Plant genome sequencing', 'subjects': ['FOS: Biological sciences']},
            {'title': 'Species diversity and ecology', 'descriptions': ['Biology of plants and organisms']},
            {'title': 'Unnamed dataset', 'subjects': ['FOS: Biological sciences']},
        ):
            self.assertFalse(health_decision(record)[0], record)
        for record in (
            {'title': 'Clinical outcomes dataset'},
            {'title': 'Measurements', 'descriptions': ['Data from a study of patient care.']},
            {'title': 'Measurements', 'subjects': ['FOS: Medical and health sciences']},
            {'title': 'Measurements', 'subjects': ['Cancer research']},
        ):
            self.assertTrue(health_decision(record)[0], record)

    def test_supplement_labels(self):
        for title in ('Table S2.xlsx', 'Figure S3', 'Fig. S3', 'Supplementary data', 'Code and data'):
            self.assertTrue(generic_supplement_decision(title, [])[0], title)
        self.assertTrue(generic_supplement_decision('Table S2.xlsx', ['A description'])[0])
        self.assertFalse(generic_supplement_decision('Code and data', ['Dataset of clinical outcomes'])[0])
        self.assertFalse(generic_supplement_decision('Clinical data and code for cohort outcomes', [])[0])
        self.assertTrue(is_supplement('Supplementary data', {'descriptions': ['A described dataset']}))
        self.assertTrue(is_supplement('Additional file 1 of a paper', {}))


if __name__ == '__main__':
    unittest.main()
