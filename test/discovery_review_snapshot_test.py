import copy
from pathlib import Path
import runpy
import unittest

preview = runpy.run_path(str(
    Path(__file__).resolve().parents[1] / 'scripts/build-discovery-review-snapshot.py'
))
build_preview = preview['build_preview']
evidence_row = preview['REVIEW']['evidence_row']


class AdmissionPreviewTest(unittest.TestCase):
    def setUp(self):
        self.queue_hash = '1' * 64
        url = 'https://github.com/test/work'
        criteria = dict.fromkeys(['usefulPurpose', 'healthRelevance', 'datedRegionalBasis', 'originalLink'], 'supported')
        self.queue = {'ok': True, 'result': {'visibility': 'private', 'publicationAuthorized': False, 'candidates': [
            {'nativeId': '123', 'observations': [{'nativeId': '123', 'fullName': 'test/work', 'originalUrl': url,
                 'description': None, 'fork': False, 'archived': False, 'observedAt': '2026-11-17'}]},
        ]}}
        self.baseline = {'version': 'fixture', 'works': [{'id': 'no-native-id', 'nativeIdentity': None}]}
        evidence = evidence_row('123', url, 'Fixture evidence', '2026-11-17', list(criteria))
        self.row = {
            'nativeId': '123', 'repository': 'test/work', 'originalUrl': url, 'decision': 'eligible',
            'criteria': criteria, 'revision': 1, 'reason': 'Fixture evidence', 'evidenceRefs': [evidence['id']],
            'evidence': [evidence],
            'preparedListing': {
                'nativeId': '123', 'originalUrl': url, 'title': 'Fixture', 'purpose': 'Fixture purpose',
                'healthRelevance': 'Fixture relevance', 'lastCheckedDate': '2026-11-17', 'sources': [url],
                'regionalBasis': {'text': 'Fixture basis', 'date': '2026-11-17', 'dateBasis': 'observation',
                                  'scope': 'Fixture scope'},
            },
        }
        self.export = {
            'schemaVersion': 1, 'visibility': 'private', 'publicationAuthorized': False,
            'queueSha256': self.queue_hash, 'contextSha256': '2' * 64, 'decisions': [self.row],
        }

    def build(self):
        return build_preview(self.queue, self.queue_hash, self.export, '3' * 64, self.baseline, '4' * 64)

    def test_proposes_private_draft_once_without_adding_to_public_baseline(self):
        prior = copy.deepcopy(self.baseline)
        preview = self.build()
        self.assertEqual(preview['counts']['proposed'], 1)
        self.assertEqual(preview['drafts'][0]['nativeId'], '123')
        self.assertEqual(preview['visibility'], 'private')
        self.assertIs(preview['publicationAuthorized'], False)
        self.assertEqual(self.baseline, prior)
        self.baseline['works'].append({'id': 'existing', 'nativeIdentity': {'provider': 'github', 'nativeId': '123'}})
        preview = self.build()
        self.assertEqual(preview['counts']['alreadyListed'], 1)
        self.assertEqual(preview['drafts'], [])

    def test_rejects_an_export_bound_to_different_queue_or_work(self):
        self.export['queueSha256'] = '0' * 64
        with self.assertRaises(ValueError):
            self.build()
        self.export['queueSha256'] = self.queue_hash
        self.row['preparedListing']['originalUrl'] = 'https://github.com/test/different'
        with self.assertRaises(ValueError):
            self.build()

    def test_detects_altered_observation_bytes(self):
        self.row['evidence'][0]['fact'] = 'Altered source fact'
        with self.assertRaisesRegex(ValueError, 'evidence-binding'):
            self.build()

    def test_requires_linked_regional_source_for_eligible(self):
        url = self.row['originalUrl']
        keys = [key for key in self.row['criteria'] if key != 'datedRegionalBasis']
        evidence = [
            evidence_row('123', url, 'Exact work source', '2026-11-17', keys),
            evidence_row('123', None, 'Local regional note', '2026-11-17', ['datedRegionalBasis']),
        ]
        self.row['evidence'] = evidence
        self.row['evidenceRefs'] = [note['id'] for note in evidence]
        with self.assertRaisesRegex(ValueError, 'listing-region-needs-linked-evidence'):
            self.build()


if __name__ == '__main__':
    unittest.main()
