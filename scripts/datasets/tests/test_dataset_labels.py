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

    def test_county_comes_only_from_home_county(self):
        inst = [{'id': 'example', 'name': 'Example University', 'aliases': [], 'kind': 'university',
                 'homeCounty': 'Bucks', 'sites': [{'place': 'Philadelphia', 'state': 'PA', 'county': 'Philadelphia'}]}]
        r = match_submitter('Example University', city='Philadelphia', state='PA', institutions=inst)
        self.assertEqual(r['counties'], ['Bucks'])
        self.assertEqual(r['matches'][0]['matched_name'], 'Example University')


if __name__ == '__main__':
    unittest.main()
