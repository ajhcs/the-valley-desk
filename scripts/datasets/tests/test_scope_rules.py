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

    def test_laboratory_life_science_without_medical_objective(self):
        for title in (
            'Chromatin architecture and gene expression',
            'Structure of the Hir histone chaperone complex',
            'Drosophila embryo development', 'Zebrafish neuron imaging',
            'Mouse gene expression', 'Yeast protein structure',
            'Bacterial cell cultures', 'Single-cell RNA-seq',
            'mEEG recordings', 'DNA methylation profiles',
        ):
            self.assertTrue(health_decision({'title': title})[0], title)
            self.assertFalse(nonmedical_recovery_decision(title)[0], title)

    def test_excluded_context_precedes_laboratory_terms(self):
        for title in (
            'Soil microbial gene expression', 'Wild population genetics of mice',
            'Field study of zebrafish behavior', 'Plant cell cultures',
            'Agricultural crop transcriptomics', 'Drosophila ecology and genome',
        ):
            self.assertFalse(health_decision({'title': title})[0], title)
            self.assertTrue(nonmedical_recovery_decision(title)[0], title)
        record = {'title': 'Soil exposure and clinical trial outcomes',
                  'descriptions': ['Clinical trial outcomes in patients.']}
        self.assertTrue(health_decision(record)[0])
        self.assertFalse(nonmedical_recovery_decision(record['title'], record['descriptions'])[0])

    def test_previously_excluded_real_scope_patterns(self):
        records = (
            {'title': 'Drosophila factor localizes to satellite DNA foci'},
            {'title': 'Human DNA polymerase theta in complex with inhibitor', 'repository_method': 'Structural biology'},
            {'title': 'Respiratory virus polymerase with inhibitor', 'repository_method': 'Structural biology'},
            {'title': 'Infant nasal swab raw sequence reads'},
            {'title': 'Breath volatilome shaped by gut microbiota'},
            {'title': 'An mRNA vaccine protects against infection'},
            {'title': 'Treatment for fibrosis with an inhibitor'},
            {'title': 'Fetal germline in a mouse model'},
            {'title': 'Analysis of clinical isolates', 'descriptions': ['The organism is also found in soil.']},
        )
        for record in records:
            self.assertTrue(health_decision(record)[0], record)
        for title in ('Soil microbial gene expression', 'Plant cell cultures',
                      'Field study of zebrafish behavior', 'Agricultural crop transcriptomics'):
            self.assertFalse(health_decision({'title': title})[0], title)

    def test_repository_experiment_descriptors_and_study_context(self):
        for record in (
            {'title': 'Transcription factor binding in mammalian cells'},
            {'title': 'Patient tumors and adenocarcinoma'},
            {'title': 'Cardiac tissue measurements'},
            {'title': 'Neurodegeneration in a mouse model'},
            {'title': 'Whole-genome sequencing of mouse cells'},
            {'title': 'Satellite measurements', 'repository_method': 'Structural biology'},
            {'title': 'Molecular experiments', 'repository_method': 'Gene expression or genomic profiling'},
        ):
            self.assertTrue(health_decision(record)[0], record)
        for record in (
            {'title': 'Monte Carlo sampling algorithms'},
            {'title': 'Image simulations and usage'},
            {'title': 'Maize transcriptome sequencing'},
            {'title': 'Zea mays gene expression'},
            {'title': 'Catfish phylogenomics', 'repository_method': 'Structural biology'},
            {'title': 'Wild fruit-fly host preference', 'repository_method': 'Gene expression'},
            {'title': 'Field study of mouse gene expression', 'repository_method': 'Structural biology'},
            {'title': 'Untitled', 'repository_method': 'Other'},
        ):
            self.assertFalse(health_decision(record)[0], record)

    def test_generic_junk_requires_no_description(self):
        for title in ('KP RC Reports b12', 'VWM2'):
            self.assertTrue(generic_junk_decision(title, ['Administrative report.'])[0], title)
        self.assertTrue(generic_junk_decision('Short clinical entry', [])[0])
        for title in ('Annual Report 2022', 'Volume 12', 'Issue 3', 'Dataset'):
            self.assertTrue(generic_junk_decision(title, [])[0], title)
            self.assertFalse(generic_junk_decision(title, ['Clinical study data'])[0], title)

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
