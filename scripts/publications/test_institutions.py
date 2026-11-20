from copy import deepcopy
import unittest

from institutions import load_reference, validate


class InstitutionReferenceTest(unittest.TestCase):
    def test_shipped_reference(self):
        records = load_reference()
        counties = {site['county'] for row in records for site in row['sites']}
        self.assertEqual(len(counties), 9)

    def test_wrong_state_rejected(self):
        records = load_reference()
        site = records[0]['sites'][0]
        site['state'] = 'NJ' if site['state'] == 'PA' else 'PA'
        with self.assertRaisesRegex(ValueError, 'invalid site geography'):
            validate(records)

    def test_duplicate_slug_rejected(self):
        records = load_reference()
        records.insert(0, deepcopy(records[0]))
        with self.assertRaisesRegex(ValueError, 'duplicate institution id'):
            validate(records)

    def test_cycle_rejected(self):
        records = load_reference()
        records[0]['parent'] = records[0]['id']
        with self.assertRaisesRegex(ValueError, 'cyclic parent'):
            validate(records)
