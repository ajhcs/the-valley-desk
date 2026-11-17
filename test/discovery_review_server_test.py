"""Focused private review server checks with synthetic data."""
from contextlib import closing
from hashlib import sha256
from http.client import HTTPConnection
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
from threading import Thread
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'serve-discovery-review.py'
SPEC = importlib.util.spec_from_file_location('discovery_review_server', SCRIPT)
review = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(review)


def candidate(native_id, repository):
    return {'nativeId': native_id, 'observations': [{
        'nativeId': native_id, 'fullName': repository, 'originalUrl': f'https://github.com/{repository}',
        'description': 'MRI quality checks.', 'observedAt': '2026-11-17T00:00:00Z',
        'fork': False, 'archived': False,
    }]}


class ReviewServerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='discovery-review-test-', dir=review.PRIVATE_ROOT)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.queue = self.root / 'queue.json'
        self.ledger = self.root / 'review.sqlite'
        self.evidence_path = self.root / 'evidence.json'
        self.queue_data = {'ok': True, 'result': {
            'schemaVersion': 'github-owned-metadata-v2',
            'visibility': 'private',
            'publicationAuthorized': False,
            'candidates': [candidate('1', 'test-org/scanner'), candidate('2', 'test-org/sim')],
        }}
        self.queue.write_text(json.dumps(self.queue_data))
        self.queue_hash = sha256(self.queue.read_bytes()).hexdigest()
        self.region_url = 'https://example.org/work'
        self.evidence_data = {
            'schemaVersion': 1,
            'visibility': 'private',
            'publicationAuthorized': False,
            'queueSha256': self.queue_hash,
            'candidates': [{'nativeId': '1', 'originalUrl': 'https://github.com/test-org/scanner',
                            'evidence': [{'locator': self.region_url, 'fact': 'Regional software page.',
                                          'observedDate': '2026-11-17', 'criteria': ['datedRegionalBasis']}]}],
        }
        self.evidence_path.write_text(json.dumps(self.evidence_data))
        self.model = review.Review(self.queue, self.ledger, extra_evidence=self.evidence_path)
        self.metadata, self.region = [item['id'] for item in self.model.candidates['1']['evidence']]

    def payload(self, **updates):
        return {'nativeId': '1', 'criteria': dict.fromkeys(review.CRITERIA, 'unknown'), 'reason': 'Needs sources.',
                'expectedRevision': 0, 'evidenceRefs': [], **updates}

    def test_atomic_revisions_and_restart(self):
        self.assertEqual(self.model.save(self.payload())['revision'], 1)
        with self.assertRaisesRegex(ValueError, 'revision-conflict'):
            self.model.save(self.payload())
        self.assertEqual(self.model.save(self.payload(expectedRevision=1, reason='Still uncertain.'))['revision'], 2)
        rebuilt = review.Review(self.queue, self.ledger, extra_evidence=self.evidence_path, initialize=False)
        self.assertEqual(rebuilt.output(export=True)['decisions'][0]['reason'], 'Still uncertain.')
        self.assertEqual(self.ledger.stat().st_mode & 0o777, 0o600)
        with closing(sqlite3.connect(self.ledger)) as db:
            self.assertEqual(db.execute('SELECT revision FROM decisions ORDER BY revision').fetchall(), [(1,), (2,)])
        self.queue.write_text(self.queue.read_text() + '\n')
        with self.assertRaisesRegex(ValueError, 'ledger-roster-mismatch'):
            review.Review(self.queue, self.ledger, initialize=False)

    def test_export_refuses_missing_ledger_without_creating_it(self):
        absent = self.root / 'wrong.sqlite'
        with self.assertRaisesRegex(ValueError, 'ledger-missing'):
            review.Review(self.queue, absent, initialize=False)
        self.assertFalse(absent.exists())

    def test_source_binding_and_eligible_listing(self):
        criteria = dict.fromkeys(review.CRITERIA, 'supported')
        message = self.payload(criteria=criteria, evidenceRefs=[self.metadata, self.region])
        with self.assertRaisesRegex(ValueError, 'prepared-listing-required'):
            self.model.save(message)
        foreign = self.model.candidates['2']['evidence'][0]['id']
        with self.assertRaisesRegex(ValueError, 'evidence-not-bound'):
            self.model.save(self.payload(evidenceRefs=[foreign]))
        with self.assertRaisesRegex(ValueError, 'criterion-without-evidence'):
            self.model.save(self.payload(criteria=criteria, evidenceRefs=[self.metadata]))
        listing = {'title': 'MRI QA', 'purpose': 'Check acquired MR images.', 'healthRelevance': 'Imaging QA.',
                   'regionalBasis': {'text': 'Listed on the regional lab site.', 'date': '2026-11-17',
                                     'dateBasis': 'observation', 'scope': 'Software association.'}}
        with self.assertRaisesRegex(ValueError, 'prepared-listing-required'):
            self.model.save({**message, 'preparedListing': {**listing, 'nativeId': '2'}})
        decision = self.model.save({**message, 'preparedListing': listing})
        exported = self.model.output(export=True)
        self.assertFalse(exported['publicationAuthorized'])
        self.assertEqual(exported['queueSha256'], self.queue_hash)
        self.assertEqual(decision['decision'], 'eligible')
        self.assertEqual(decision['preparedListing']['nativeId'], '1')
        self.assertEqual(decision['preparedListing']['originalUrl'], 'https://github.com/test-org/scanner')
        self.assertIn(self.region_url, decision['preparedListing']['sources'])
        self.assertEqual([note['id'] for note in exported['decisions'][0]['evidence']], [self.metadata, self.region])

    def test_extra_evidence_must_match_exact_candidate(self):
        self.evidence_data['candidates'][0]['originalUrl'] = 'https://github.com/test-org/sim'
        self.evidence_path.write_text(json.dumps(self.evidence_data))
        with self.assertRaisesRegex(ValueError, 'evidence-identity'):
            review.Review(self.queue, self.ledger, extra_evidence=self.evidence_path)

    def test_loopback_http_contract(self):
        static_dir = self.root / 'assets'
        static_dir.mkdir()
        for name, _ in review.ASSETS.values():
            (static_dir / name).write_text('synthetic static data')
        with patch.object(review, 'ASSET_ROOT', static_dir), review.local_server(self.model, 0) as server:
            thread = Thread(target=server.serve_forever)
            thread.start()
            self.addCleanup(thread.join)
            self.addCleanup(server.shutdown)
            with closing(HTTPConnection('127.0.0.1', server.server_port, timeout=5)) as conn:
                def request(method, path, body=None, **headers):
                    conn.request(method, path, body, headers)
                    response = conn.getresponse()
                    return response.status, response.headers, response.read()

                status, headers, _ = request('GET', '/app.js')
                self.assertEqual(status, 200)
                self.assertEqual(headers['Cache-Control'], 'no-store')
                self.assertIn("frame-ancestors 'none'", headers['Content-Security-Policy'])
                self.assertEqual(request('GET', '/queue.json')[0], 404)
                self.assertEqual(request('GET', '/api/review', Host='localhost')[0], 403)
                status, _, body = request('GET', '/api/review')
                self.assertEqual(status, 200)
                self.assertIsNone(json.loads(body)['candidates'][0]['decision'])
                payload = json.dumps(self.payload())
                json_headers = {'Content-Type': 'application/json'}
                origin_headers = {**json_headers, 'Origin': f'http://127.0.0.1:{server.server_port}'}
                self.assertEqual(request('POST', '/api/decisions', payload, **json_headers)[0], 403)
                self.assertEqual(request('POST', '/api/decisions', ' ' * (review.MAX_DECISION_BYTES + 1),
                                         **origin_headers)[0], 413)
                self.assertEqual(request('POST', '/api/decisions', payload, **origin_headers)[0], 200)
                self.assertEqual(request('POST', '/api/decisions', payload, **origin_headers)[0], 409)


if __name__ == '__main__':
    unittest.main()
