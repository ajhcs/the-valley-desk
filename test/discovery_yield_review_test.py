import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('yield_review', ROOT / 'scripts/review-discovery-yield.py')
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class YieldReviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='tvd-yield-test-', dir='/workspace/build/builderbob')
        self.directory = Path(self.tmp.name)
        self.ids = [str(i + 1) for i in range(100)]
        self.sample = {'id': 'synthetic', 'denominator': 549, 'rows': [{'nativeId': i, 'observations': [{'originalUrl': f'https://example.org/work/{i}'}]} for i in self.ids]}
        self.rows = [{'nativeId': i, 'decision': 'held', 'criteria': {field: 'unknown' for field in
                     ['usefulPurpose', 'healthRelevance', 'datedRegionalBasis', 'originalLink']},
                     'reason': 'Synthetic evidence gap', 'evidence': [{'criteria': ['originalLink'], 'locator': f'https://example.org/work/{i}', 'observedDate': '2026-11-17', 'fact': 'Synthetic source fixture, not a real review.'}]} for i in self.ids]

    def tearDown(self):
        self.tmp.cleanup()

    def events(self, duration):
        data = review.encoded(self.rows)
        (self.directory / 'batch.json').write_bytes(data)
        return [{'kind': 'begin', 'session': '1', 'nativeIds': self.ids, 'clock': {'monotonicNs': 1}},
                {'kind': 'finish', 'session': '1', 'decisionsFile': 'batch.json',
                 'decisionsSha256': review.digest(data), 'clock': {'monotonicNs': 1 + duration}}]

    def test_zero_yield_has_undefined_minutes_per_admission(self):
        result = review.review_report(self.sample, self.events(60000000000), self.directory)
        self.assertEqual(result['eligibleFraction'], 0)
        self.assertEqual(result['agentReviewMinutes'], 1)
        self.assertIsNone(result['minutesPerAdmissionReady'])
        self.assertEqual(result['counts']['held'], 100)

    def test_total_review_time_is_amortized_over_eligible_without_dropping_negative_cases(self):
        for row in self.rows[:2]:
            row.update(decision='eligible', preparedListing={'nativeId': row['nativeId'], 'title': 'Synthetic listing',
                       'originalUrl': f'https://example.org/work/{row["nativeId"]}', 'purpose': 'Synthetic purpose',
                       'healthRelevance': 'Synthetic health purpose', 'regionalBasis': {'text': 'Synthetic region',
                       'date': '2026-11-17', 'dateBasis': 'observation', 'scope': 'Synthetic association only'},
                       'lastCheckedDate': '2026-11-17', 'sources': [f'https://example.org/work/{row["nativeId"]}']})
            row['criteria'] = {key: 'supported' for key in row['criteria']}
            row['evidence'][0]['criteria'] = list(row['criteria'])
        result = review.review_report(self.sample, self.events(120000000000), self.directory)
        self.assertEqual(result['eligibleFraction'], 0.02)
        self.assertEqual(result['minutesPerAdmissionReady'], 1)
        self.assertTrue(all(row['activeReviewMinutes'] is None for row in result['decisions']))

    def test_missing_duplicate_or_unsupported_positive_cases_fail(self):
        with self.assertRaisesRegex(ValueError, 'decision-roster'):
            review.validate_decisions(self.rows[:-1], self.ids)
        with self.assertRaisesRegex(ValueError, 'decision-roster'):
            review.validate_decisions([self.rows[0]] * 100, self.ids)
        self.rows[0]['decision'] = 'eligible'
        with self.assertRaisesRegex(ValueError, 'decision-disposition'):
            review.validate_decisions(self.rows, self.ids)

    def test_boolean_listing_or_evidence_and_unfounded_rejections_fail(self):
        self.rows[0]['decision'] = 'rejected'
        with self.assertRaisesRegex(ValueError, 'decision-disposition'):
            review.validate_decisions(self.rows, self.ids)
        self.rows[0]['decision'] = 'eligible'
        self.rows[0]['criteria'] = {key: 'supported' for key in self.rows[0]['criteria']}
        self.rows[0]['evidence'] = True
        with self.assertRaisesRegex(ValueError, 'decision-evidence'):
            review.validate_decisions(self.rows, self.ids)
        self.rows[0]['evidence'] = [{'criteria': list(self.rows[0]['criteria']), 'locator': 'https://example.org/work/1', 'fact': 'Synthetic fixture', 'observedDate': '2026-11-17'}]
        self.rows[0]['preparedListing'] = True
        with self.assertRaisesRegex(ValueError, 'unsupported-positive'):
            review.validate_decisions(self.rows, self.ids)

    def test_changed_decisions_cannot_silently_reuse_original_timing(self):
        events = self.events(60000000000)
        (self.directory / 'batch.json').write_text('[]')
        with self.assertRaisesRegex(ValueError, 'decision-drift'):
            review.review_report(self.sample, events, self.directory)

    def test_clock_boot_change_is_rejected(self):
        events = []
        first = {'kind': 'init', 'clock': {'bootId': 'one', 'monotonicNs': 1}}
        review.append(self.directory, events, first)
        events = review.load_events(self.directory)
        review.append(self.directory, events, {'kind': 'begin', 'clock': {'bootId': 'two', 'monotonicNs': 2}})
        with self.assertRaisesRegex(ValueError, 'event-chain-or-clock'):
            review.load_events(self.directory)


if __name__ == '__main__':
    unittest.main()
