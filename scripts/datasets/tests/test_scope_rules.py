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

    def test_ambiguous_scientific_language_does_not_establish_scope(self):
        records = (
            {'title': 'Plant disease resistance', 'descriptions': ['Plants received treatment in the experiment.']},
            {'title': 'Ecosystem health in wetlands', 'descriptions': ['The health of the ecosystem is assessed.']},
            {'title': 'Animal movement patterns', 'descriptions': ['Animals were assigned to treatment groups.']},
            {'title': 'Seismic observations', 'descriptions': ['A diagnostic treatment of sensor data.']},
            {'title': 'Species diversity and ecology', 'descriptions': ['These results have implications for human health research.']},
            {'title': 'Experimental measurements', 'descriptions': ['Disease, health and treatment were assessed.']},
        )
        for record in records:
            self.assertFalse(health_decision(record)[0], record)

    def test_explicit_medical_context_survives(self):
        records = (
            {'title': 'Measurements', 'descriptions': ['Clinical trial outcomes were collected from participants.']},
            {'title': 'Measurements', 'descriptions': ['The data describe patient care in a hospital.']},
            {'title': 'Measurements', 'subjects': ['FOS: Clinical medicine']},
            {'title': 'Ecology of cancer research', 'subjects': ['Cancer research']},
        )
        for record in records:
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
