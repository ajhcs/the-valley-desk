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

    def test_ledger_requires_exact_evidence_for_serve_and_export(self):
        self.model.save(self.payload(evidenceRefs=[self.region]))
        self.evidence_path.write_text(self.evidence_path.read_text() + '\n')
        for initialize in (True, False):
            for evidence in (self.evidence_path, None):
                with self.subTest(initialize=initialize, evidence=evidence):
                    with self.assertRaisesRegex(ValueError, 'ledger-context-mismatch'):
                        review.Review(self.queue, self.ledger, extra_evidence=evidence, initialize=initialize)
        with closing(sqlite3.connect(self.ledger)) as db, db:
            db.execute('UPDATE context SET context_hash = ?', ('0' * 64,))
        with self.assertRaisesRegex(ValueError, 'ledger-context-mismatch'):
            self.model.output()
        with self.assertRaisesRegex(ValueError, 'ledger-context-mismatch'):
            self.model.save(self.payload(expectedRevision=1))

    def test_legacy_schema_cannot_supply_exact_context(self):
        with closing(sqlite3.connect(self.ledger)) as db, db:
            db.execute('PRAGMA user_version = 1')
        for initialize in (True, False):
            with self.assertRaisesRegex(ValueError, 'ledger-context-schema'):
                review.Review(self.queue, self.ledger, extra_evidence=self.evidence_path, initialize=initialize)
        with closing(sqlite3.connect(self.ledger)) as db:
            self.assertEqual(db.execute('PRAGMA user_version').fetchone(), (1,))

    def test_provider_descriptions_keep_raw_value_and_bounded_display(self):
        row = self.queue_data['result']['candidates'][0]
        for description in ('', ' \t\r\n', 'MRI\tquality\nchecks.', 'x' * 2000, '🧪' * 1000):
            with self.subTest(length=len(description)):
                row['observations'][0]['description'] = description
                result = review.canonical_candidate(row)
                self.assertEqual(result['description'], description)
                fact = result['evidence'][0]
                self.assertLessEqual(len(fact['fact']), 1000)
                self.assertNotRegex(fact['fact'], r'[\r\n\t]')
                if not description.strip():
                    self.assertEqual(fact['criteria'], ['originalLink'])
                elif len(description) >= 1000:
                    self.assertTrue(fact['fact'].endswith('…'))
        for description in ('x' * 2001, '🧪' * 1001, 'invalid\x00control', 1):
            row['observations'][0]['description'] = description
            with self.assertRaisesRegex(ValueError, 'queue-description'):
                review.canonical_candidate(row)

    def test_prefill_keeps_local_locator_in_evidence_identity(self):
        prefill = self.root / 'prefill.json'
        local_ref = 'docs/discovery/retained-review.md#lines-10-12'
        note = {'locator': local_ref, 'fact': 'Retained source fact.', 'observedDate': '2026-11-17',
                'criteria': ['usefulPurpose']}
        packet = {'visibility': 'private', 'publicationAuthorized': False, 'reviewStatus': 'completed',
                  'cohortSize': 2, 'sampleSize': 1, 'publicAdmissions': 0, 'decisions': [{
                      'nativeId': '1', 'repository': 'test-org/scanner', 'reason': 'Needs sources.',
                      'decision': 'held', 'criteria': dict.fromkeys(review.CRITERIA, 'unknown'),
                      'evidence': [note],
                  }]}
        prefill.write_text(json.dumps(packet))
        ledger = self.root / 'prefilled.sqlite'
        model = review.Review(self.queue, ledger, prefill=prefill)
        evidence = model.output(export=True)['decisions'][0]['evidence'][0]
        self.assertIsNone(evidence['locator'])
        self.assertEqual(evidence['localLocator'], local_ref)
        alternate = review.evidence_row('1', None, note['fact'], note['observedDate'], note['criteria'],
                                        local_ref='docs/discovery/another.md#L10')
        self.assertNotEqual(evidence['id'], alternate['id'])
        note['locator'] = 'docs/discovery/../../private.txt'
        prefill.write_text(json.dumps(packet))
        with self.assertRaisesRegex(ValueError, 'prefill-evidence-locator'):
            review.Review(self.queue, self.root / 'other.sqlite', prefill=prefill)

    def test_conflicting_observed_repository_urls_hold_eligibility(self):
        rows = self.queue_data['result']['candidates'][0]['observations']
        old = rows[0]
        renamed = {**old, 'fullName': 'test-org/renamed', 'originalUrl': 'https://github.com/test-org/renamed'}
        rows.extend([old.copy(), renamed])
        self.queue.write_text(json.dumps(self.queue_data))
        self.evidence_data['queueSha256'] = sha256(self.queue.read_bytes()).hexdigest()
        self.evidence_path.write_text(json.dumps(self.evidence_data))
        model = review.Review(self.queue, self.root / 'renamed.sqlite', extra_evidence=self.evidence_path)
        candidate = model.output()['candidates'][0]
        self.assertEqual(candidate['originalUrl'], old['originalUrl'])
        self.assertEqual(candidate['observedAliases'], [old['originalUrl'], renamed['originalUrl']])
        with self.assertRaisesRegex(ValueError, 'listing-identity-needs-review'):
            model.save(self.payload(criteria=dict.fromkeys(review.CRITERIA, 'supported'),
                                    evidenceRefs=[self.metadata, self.region]))
        self.assertEqual(model.save(self.payload())['decision'], 'held')
        renamed['nativeId'] = '2'
        with self.assertRaisesRegex(ValueError, 'queue-identity'):
            review.canonical_candidate(self.queue_data['result']['candidates'][0])

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
                payload = json.dumps(self.payload())
                json_headers = {'Content-Type': 'application/json'}
                origin_headers = {**json_headers, 'Origin': f'http://127.0.0.1:{server.server_port}'}
                self.assertEqual(request('GET', '/api/review')[0], 401)
                self.assertEqual(request('HEAD', '/api/review')[0], 401)
                self.assertEqual(request('POST', '/api/decisions', payload, **origin_headers)[0], 401)
                self.assertEqual(self.model.output(export=True)['decisions'], [])
                access = server.access.bootstrap
                bootstrap = json.dumps({'access': access})
                self.assertEqual(request('POST', '/api/session', bootstrap, **json_headers)[0], 403)
                self.assertEqual(request('POST', '/api/session', json.dumps({'access': 'X' * 43}),
                                         **origin_headers)[0], 401)
                self.assertEqual(request('GET', '/api/review', Authorization=f'Bearer {access}')[0], 401)
                status, headers, body = request('POST', '/api/session', bootstrap, **origin_headers)
                self.assertEqual(status, 200)
                self.assertEqual(headers['Cache-Control'], 'no-store')
                token = json.loads(body)['token']
                self.assertNotEqual(access, token)
                self.assertEqual(request('POST', '/api/session', bootstrap, **origin_headers)[0], 401)
                auth = {'Authorization': f'Bearer {token}'}
                status, _, body = request('GET', '/api/review', **auth)
                self.assertEqual(status, 200)
                self.assertIsNone(json.loads(body)['candidates'][0]['decision'])
                self.assertEqual(request('GET', '/api/review', **auth, Origin='http://foreign.test')[0], 403)
                self.assertEqual(request('GET', '/api/review', **auth, **{'Sec-Fetch-Site': 'cross-site'})[0], 403)
                self.assertEqual(request('POST', '/api/decisions', payload, **json_headers, **auth)[0], 403)
                self.assertEqual(request('POST', '/api/decisions', payload, **json_headers)[0], 403)
                self.assertEqual(request('POST', '/api/decisions', ' ' * (review.MAX_DECISION_BYTES + 1),
                                         **origin_headers, **auth)[0], 413)
                self.assertEqual(request('POST', '/api/decisions', payload, **origin_headers, **auth)[0], 200)
                self.assertEqual(request('POST', '/api/decisions', payload, **origin_headers, **auth)[0], 409)


if __name__ == '__main__':
    unittest.main()
