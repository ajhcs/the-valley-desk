import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from datacite_rules import generic_junk_decision, generic_supplement_decision, health_decision, is_supplement, nonmedical_recovery_decision


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

    def test_medical_creator_requires_affirmative_measurement(self):
        for record in (
            {'title': 'mEEG recordings'},
            {'title': 'KnowYourCG HM450 data'},
            {'title': 'Measurements', 'descriptions': ['DNA methylation profiles']},
        ):
            self.assertFalse(health_decision(record)[0], record)
            self.assertEqual(health_decision(record, medical_creator=True),
                             (True, 'biomedical measurement with corroborated medical institution creator'))
        for record in (
            {'title': 'Unnamed dataset'},
            {'title': 'Plant ecology', 'descriptions': ['DNA methylation data']},
            {'title': 'Neural network measurements'},
        ):
            self.assertFalse(health_decision(record, medical_creator=True)[0], record)

    def test_generic_junk_requires_no_description(self):
        for title in ('KP RC Reports b12', 'VWM2'):
            self.assertTrue(generic_junk_decision(title, ['Administrative report.'])[0], title)
        self.assertTrue(generic_junk_decision('Short clinical entry', [])[0])
        for title in ('Annual Report 2022', 'Volume 12', 'Issue 3', 'Dataset'):
            self.assertTrue(generic_junk_decision(title, [])[0], title)
            self.assertFalse(generic_junk_decision(title, ['Clinical study data'])[0], title)
        for title in ('Annual report of cancer outcomes', 'Dataset of mEEG recordings', 'Issue 3 clinical data'):
            self.assertFalse(generic_junk_decision(title, [])[0], title)

    def test_nonmedical_recovery_guard(self):
        for title in (
            'Soil microbial dynamics in Pennsylvania grasslands',
            'Quantitative Multi-Omics Atlas of the Model Chordate Ciona',
            'Comparative animal behavior across species',
            'Structure of the Hir histone chaperone complex',
            'Chromatin architecture and gene expression',
        ):
            self.assertTrue(nonmedical_recovery_decision(title, ['This may have implications for human health research.'])[0], title)
        for title, description in (
            ('Chromatin profiles in human patient samples', ''),
            ('Histone changes in cancer research', ''),
            ('Chromatin accessibility', 'We investigated cancer treatment response in patients.'),
            ('Dataset for KnowYourCG HM450', ''),
            ('mEEG recordings', ''),
        ):
            self.assertFalse(nonmedical_recovery_decision(title, [description])[0], title)

    def test_generic_figure_and_additional_file_rejected_with_paper_abstract(self):
        for title in ('Additional file', 'Additional file of Exploring breast cancer',
                      'Figure 2', 'Figure 2 of a clinical paper', 'Fig. 3', 'Table S2.xlsx'):
            self.assertTrue(generic_supplement_decision(title, ['A clinical study of cancer patients.'])[0], title)
        self.assertFalse(generic_supplement_decision('Figure drawing dataset for clinical imaging', ['Study data'])[0])

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
