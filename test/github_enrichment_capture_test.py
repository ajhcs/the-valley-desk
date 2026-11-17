import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('capture', ROOT / 'scripts/capture-github-enrichment.py')
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='tvd-gl08-test-', dir=capture.BUILD_ROOT)
        self.directory = Path(self.tmp.name)
        (self.directory / 'pages').mkdir(mode=0o700)
        self.scope = json.loads((ROOT / 'docs/discovery/go-live/execution/GL08-github-enrichment-scope.json').read_bytes())
        (self.directory / 'scope.json').write_text(json.dumps(self.scope))
        node = self.directory / 'synthetic-runtime'
        node.write_bytes(b'Synthetic runtime identity; never executed by these no-network tests.\n')
        self.approval = {'approvedBy': 'builderbob', 'scopeSha256': capture.sha((self.directory / 'scope.json').read_bytes()),
                         'nodeBinary': str(node), 'nodeSha256': capture.sha(node.read_bytes()),
                         'methods': {path: capture.sha((ROOT / path).read_bytes()) for path in capture.METHODS}}
        self.write_approval()

    def tearDown(self):
        self.tmp.cleanup()

    def write_approval(self):
        (self.directory / 'approval.json').write_text(json.dumps(self.approval))

    def test_approval_binds_scope_methods_sources_and_runtime(self):
        capture.validate_batch(self.directory)
        self.approval['scopeSha256'] = '0' * 64
        self.write_approval()
        with self.assertRaisesRegex(ValueError, 'scope-approval-binding'):
            capture.validate_batch(self.directory)

    def test_incomplete_method_pins_are_rejected(self):
        self.approval['methods'] = {}
        self.write_approval()
        with self.assertRaisesRegex(ValueError, 'incomplete-method-pins'):
            capture.validate_batch(self.directory)

    def test_method_drift_is_rejected(self):
        self.approval['methods']['scripts/capture-github-enrichment.py'] = '0' * 64
        self.write_approval()
        with self.assertRaisesRegex(ValueError, 'method-drift'):
            capture.validate_batch(self.directory)

    def test_scope_change_cannot_expand_budget_with_same_approval(self):
        self.scope['limits']['maxRequests'] = 500
        (self.directory / 'scope.json').write_text(json.dumps(self.scope))
        with self.assertRaisesRegex(ValueError, 'scope-approval-binding'):
            capture.validate_batch(self.directory)

    def test_private_directory_refuses_symlink(self):
        link = self.directory / 'alias'
        link.symlink_to(self.directory, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'private-directory'):
            capture.private_directory(link)

    def test_issued_or_refused_attempt_holds_batch_without_network(self):
        for status in ['issued', 'refused', 'rate-limited', 'redirect']:
            with self.subTest(status=status):
                db = sqlite3.connect(self.directory / 'journal.sqlite')
                db.execute('CREATE TABLE IF NOT EXISTS attempts (login TEXT,page INTEGER,status TEXT,receipt TEXT,PRIMARY KEY(login,page))')
                db.execute('DELETE FROM attempts')
                db.execute('INSERT INTO attempts VALUES(?,?,?,NULL)', ('maker', 1, status))
                db.commit()
                db.close()
                os.chmod(self.directory / 'journal.sqlite', 0o600)
                with patch.object(capture, 'PinnedConnection', side_effect=AssertionError('network must not run')):
                    self.assertEqual(capture.run(self.directory)['state'], 'held')

    def test_refusal_is_charged_and_receipt_retained_without_body_or_retry(self):
        class Response:
            status = 403
            def getheader(self, name):
                return None
        class Connection:
            def request(self, *args, **kwargs):
                self.headers = kwargs['headers']
                assert 'Authorization' not in self.headers
            def getresponse(self):
                return Response()
            def close(self):
                pass
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE attempts (login TEXT,page INTEGER,status TEXT,receipt TEXT,PRIMARY KEY(login,page))')
        dns = [(None, None, None, None, ('140.82.114.5', 443))]
        with patch.object(capture.socket, 'getaddrinfo', return_value=dns), patch.object(capture, 'PinnedConnection', return_value=Connection()):
            receipt = capture.acquire_page(self.directory, self.scope, self.approval, db, self.scope['roster'][0], 1, None)
            self.assertEqual(receipt['status'], 'refused')
            self.assertFalse(receipt['rawBodyRetained'])
            self.assertIsNone(receipt['projection'])
            with self.assertRaises(sqlite3.IntegrityError):
                capture.acquire_page(self.directory, self.scope, self.approval, db, self.scope['roster'][0], 1, None)
        self.assertEqual(len(list((self.directory / 'pages').glob('*.json'))), 1)

    def test_nonpublic_dns_is_charged_and_never_connected(self):
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE attempts (login TEXT,page INTEGER,status TEXT,receipt TEXT,PRIMARY KEY(login,page))')
        dns = [(None, None, None, None, ('127.0.0.1', 443))]
        with patch.object(capture.socket, 'getaddrinfo', return_value=dns), patch.object(capture, 'PinnedConnection', side_effect=AssertionError('network')):
            receipt = capture.acquire_page(self.directory, self.scope, self.approval, db, self.scope['roster'][0], 1, None)
        self.assertEqual(receipt['failureCode'], 'nonpublic-dns')
        self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()
