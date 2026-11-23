import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dataset_labels import match_submitter


class SubmitterLabels(unittest.TestCase):
    def test_registry_names_and_aliases(self):
        for text in ('University of Pennsylvania', 'Blumberg Institute'):
            self.assertTrue(match_submitter(text)['institutions'], text)

    def test_merck_seattle_is_not_regional(self):
        self.assertEqual(match_submitter('Rosetta Inpharmatics, Merck, Seattle')['institutions'], [])
        self.assertEqual(match_submitter('Merck', city='Seattle', state='WA')['institutions'], [])
        self.assertEqual(match_submitter('Merck')['institutions'], [])

    def test_company_requires_its_regional_site(self):
        r = match_submitter('Merck', city='West Point', state='PA')
        self.assertIn('merck', r['institutions'])
        self.assertEqual(r['matches'][0]['submitter'], 'Merck')
        self.assertEqual(r['matches'][0]['matched_site'], 'West Point')
        self.assertNotIn('merck', match_submitter('Merck', city='West Point', state='NY')['institutions'])

    def test_city_alone_and_substrings_do_not_match(self):
        self.assertEqual(match_submitter('Philadelphia')['institutions'], [])
        self.assertNotIn('merck', match_submitter('Supermerck West Point')['institutions'])

    def test_observed_chop_typo_requires_independent_location(self):
        typo = "Children's Hospital of Phildelphia"
        r = match_submitter(typo, city='Philadelphia', state='PA')
        self.assertIn('chop', r['institutions'])
        self.assertEqual(r['matches'][0]['matched_name'], typo)
        self.assertEqual(r['matches'][0]['submitter'], typo)
        self.assertNotIn('chop', match_submitter(typo)['institutions'])
        self.assertNotIn('chop', match_submitter(typo, 'Seattle', 'WA')['institutions'])
        self.assertNotIn('upenn', match_submitter('University of Pennslvania')['institutions'])

    def test_region_cities_and_full_state_names(self):
        cases = [
            ("Children’s Hospital of Philadelphia", "Philadelphia", "Pennsylvania", "chop"),
            ("University of Pennsylvania", "", "", "upenn"),
            ("Princeton University", "Plainsboro", "New Jersey", "princeton-university"),
            ("Thomas Jefferson University", "Philadelphia", "Pennsylvania", "thomas-jefferson-university"),
        ]
        for name, city, state, expected in cases:
            with self.subTest(name=name):
                self.assertIn(expected, match_submitter(name, city, state)['institutions'])
        self.assertNotIn('upenn', match_submitter('University of Pennsylvania', 'Seattle', 'WA')['institutions'])
        self.assertNotIn('upenn', match_submitter('University of Pennsylvania', state='WA')['institutions'])
        self.assertNotIn('merck', match_submitter('Merck', 'Plainsboro', 'NJ')['institutions'])

    def test_county_comes_only_from_home_county(self):
        inst = [{'id': 'example', 'name': 'Example University', 'aliases': [], 'kind': 'university',
                 'homeCounty': 'Bucks', 'sites': [{'place': 'Philadelphia', 'state': 'PA', 'county': 'Philadelphia'}]}]
        r = match_submitter('Example University', city='Philadelphia', state='PA', institutions=inst)
        self.assertEqual(r['counties'], ['Bucks'])
        self.assertEqual(r['matches'][0]['matched_name'], 'Example University')


if __name__ == '__main__':
    unittest.main()


class LiteralAffiliationLabels(unittest.TestCase):
    def test_geo_explicit_institution_preserves_anomalous_address(self):
        from dataset_labels import match_geo_institution
        for value, expected in [('University of Pennsylvania', 'upenn'),
                                ('Fox Chase Cancer Center', 'fox-chase')]:
            result = match_geo_institution(value, 'Boston', 'MA')
            self.assertIn(expected, result['institutions'])
            self.assertEqual(result['matches'][0]['city'], 'Boston')
        self.assertEqual(match_geo_institution('Merck', 'Boston', 'MA')['institutions'], [])
        self.assertEqual(match_geo_institution('University of Pennsylvania, Boston')['institutions'], [])

    def test_paper_evidence_is_literal_and_does_not_roll_up_parent(self):
        from dataset_labels import match_paper_affiliation
        result = match_paper_affiliation('Nuclear Dynamics, Fox Chase Cancer Center, Philadelphia, PA')
        self.assertIn('fox-chase', result['institutions'])
        self.assertNotIn('temple-health', result['institutions'])
        self.assertIn('fox-chase', match_paper_affiliation('Fox-Chase Cancer Center, Philadelphia')['institutions'])
        self.assertEqual(match_paper_affiliation('Merck, Seattle')['institutions'], [])
        self.assertNotIn('upenn', match_paper_affiliation('University of Pennslvania, Philadelphia')['institutions'])
