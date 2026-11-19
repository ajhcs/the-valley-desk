import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import time
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
                for path in (self.directory / 'pages').iterdir():
                    path.unlink()
                db = sqlite3.connect(self.directory / 'journal.sqlite')
                db.execute('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)')
                db.execute("INSERT OR REPLACE INTO meta VALUES('scope',?)", (self.approval['scopeSha256'],))
                db.execute("INSERT OR REPLACE INTO meta VALUES('started',?)", (str(time.time()),))
                db.execute('CREATE TABLE IF NOT EXISTS attempts (login TEXT,page INTEGER,status TEXT,receipt TEXT,PRIMARY KEY(login,page))')
                db.execute('DELETE FROM attempts')
                login = self.scope['roster'][0]['login']
                receipt = None
                if status != 'issued':
                    receipt_id = capture.sha((self.approval['scopeSha256'] + '\n' + login + '\n1').encode())
                    value = {'scopeSha256': self.approval['scopeSha256'], 'login': login, 'page': 1, 'status': status, 'receiptId': receipt_id}
                    receipt = json.dumps(value)
                    (self.directory / 'pages' / f'page-{receipt_id}.json').write_text(receipt)
                db.execute('INSERT INTO attempts VALUES(?,?,?,?)', (login, 1, status, receipt))
                db.commit()
                db.close()
                os.chmod(self.directory / 'journal.sqlite', 0o600)
                with patch.object(capture, 'PinnedConnection', side_effect=AssertionError('network must not run')):
                    self.assertEqual(capture.run(self.directory)['state'], 'held')

    def test_missing_or_inconsistent_journal_refuses_before_network(self):
        page = self.directory / 'pages' / ('page-' + 'a' * 64 + '.json')
        page.write_text('{}')
        with patch.object(capture, 'PinnedConnection', side_effect=AssertionError('network must not run')):
            with self.assertRaisesRegex(ValueError, 'missing-journal-with-receipts'):
                capture.run(self.directory)
            self.assertFalse((self.directory / 'journal.sqlite').exists())
            db = sqlite3.connect(self.directory / 'journal.sqlite')
            db.execute('CREATE TABLE meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)')
            db.execute("INSERT INTO meta VALUES('scope',?)", (self.approval['scopeSha256'],))
            db.commit()
            db.close()
            os.chmod(self.directory / 'journal.sqlite', 0o600)
            with self.assertRaisesRegex(ValueError, 'journal-receipt-mismatch'):
                capture.run(self.directory)
        self.assertEqual(page.read_text(), '{}')

    def test_unknown_journal_status_is_rejected(self):
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE attempts (login TEXT,page INTEGER,status TEXT,receipt TEXT)')
        db.execute('INSERT INTO attempts VALUES(?,?,?,NULL)', (self.scope['roster'][0]['login'], 1, 'unexpected'))
        with self.assertRaisesRegex(ValueError, 'journal-status'):
            capture.reconcile_journal(self.directory, self.scope, db)

    def test_persisted_start_cannot_expand_or_reset_elapsed_budget(self):
        db = sqlite3.connect(self.directory / 'journal.sqlite')
        os.chmod(self.directory / 'journal.sqlite', 0o600)
        db.execute('CREATE TABLE meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)')
        db.execute("INSERT INTO meta VALUES('scope',?)", (self.approval['scopeSha256'],))
        db.execute('CREATE TABLE attempts (login TEXT,page INTEGER,status TEXT,receipt TEXT,PRIMARY KEY(login,page))')
        for value in ['inf', 'nan', str(time.time() + 3600)]:
            db.execute("INSERT OR REPLACE INTO meta VALUES('started',?)", (value,))
            db.commit()
            with patch.object(capture, 'PinnedConnection', side_effect=AssertionError('network must not run')):
                with self.assertRaisesRegex(ValueError, 'journal-clock-invalid'):
                    capture.run(self.directory)
        db.execute("DELETE FROM meta WHERE key='started'")
        db.execute('INSERT INTO attempts VALUES(?,?,?,NULL)', (self.scope['roster'][0]['login'], 1, 'issued'))
        db.commit()
        with self.assertRaisesRegex(ValueError, 'journal-start-missing'):
            capture.run(self.directory)
        db.close()
        os.chmod(self.directory / 'journal.sqlite', 0o600)

    def test_remaining_batch_deadline_bounds_attempt_and_expired_budget_sends_nothing(self):
        class Connection:
            def request(self, *args, **kwargs):
                pass
            def getresponse(self):
                time.sleep(0.25)
                raise AssertionError('deadline should interrupt this wait')
            def close(self):
                pass
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE attempts (login TEXT,page INTEGER,status TEXT,receipt TEXT,PRIMARY KEY(login,page))')
        dns = [(None, None, None, None, ('140.82.114.5', 443))]
        with patch.object(capture, 'PinnedConnection', side_effect=AssertionError('expired budget must not send')):
            self.assertIsNone(capture.acquire_page(self.directory, self.scope, self.approval, db, self.scope['roster'][0], 1, None, time.monotonic() - 1))
        self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0], 0)
        with patch.object(capture.socket, 'getaddrinfo', return_value=dns), patch.object(capture, 'PinnedConnection', return_value=Connection()) as connection:
            receipt = capture.acquire_page(self.directory, self.scope, self.approval, db, self.scope['roster'][0], 1, None, time.monotonic() + 0.05)
        self.assertEqual(receipt['status'], 'unknown')
        self.assertEqual(receipt['failureCode'], 'deadline')
        self.assertLessEqual(connection.call_args.args[1], 0.05)

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
