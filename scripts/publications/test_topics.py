import unittest

from topics import OTHER_SCIENCE, publication_topic


class PublicationTopicTests(unittest.TestCase):
    def test_empty_and_nondescriptive_terms_use_other_science(self):
        self.assertEqual(publication_topic([]), OTHER_SCIENCE)
        self.assertEqual(publication_topic(['Humans', 'United States']), OTHER_SCIENCE)
        self.assertEqual(publication_topic(['Lithium Batteries']), OTHER_SCIENCE)
        self.assertEqual(publication_topic(['Solar Cells', 'Wastewater Treatment']), OTHER_SCIENCE)

    def test_explicit_terms_place_all_eight_topics(self):
        examples = {
            'Biochemistry': 'Biomedical and life sciences',
            'Clinical Trial': 'Clinical care',
            'Lung Cancer': 'Disease research',
            'Magnetic Resonance Imaging': 'Medical imaging',
            'Neuroscience': 'Neuroscience',
            'Public Health': 'Public health',
            'Speech Therapy': 'Rehabilitation and accessibility',
            'Data Set': 'Research data',
        }
        for term, expected in examples.items():
            with self.subTest(term=term):
                self.assertEqual(publication_topic([term]), expected)

    def test_specific_rule_precedes_broad_discipline(self):
        self.assertEqual(publication_topic(['Biochemistry', 'Data Set']), 'Research data')
