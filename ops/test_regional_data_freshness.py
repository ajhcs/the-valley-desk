import json
import unittest
from datetime import date
from unittest.mock import patch
from urllib.error import HTTPError
import regional_data_freshness as f

TODAY = date(2026, 11, 24)
ID = 'regional:cdc-abcd-1234'
LANDING = 'https://data.cdc.gov/d/abcd-1234'
META = 'https://data.cdc.gov/api/views/abcd-1234.json'
EVIDENCE = {ID: {'fields': {'url': [META]}, 'freshness': {'url': META, 'format': 'json', 'path': '/rowsUpdatedAt'}}}

class D1:
    def __init__(self, old=(), schema=True, cadence=None):
        self.old, self.schema, self.cadence = old, schema, cadence
    def rows(self, sql, label):
        if label == 'regional data schema':
            return [{'name': x} for x in ('regional_data_checks', 'regional_data_removals')] if self.schema else []
        if label == 'regional data inventory':
            return [{'id': ID, 'record': json.dumps({'id': ID, 'url': LANDING, 'update_cadence': self.cadence})}]
        if label == 'regional data checks': return self.old
        return []

def source(url, *, metadata=False):
    return {'rowsUpdatedAt': 1763942400} if metadata else {}

class Tests(unittest.TestCase):
    def test_absent_schema_and_success_unknown_cadence(self):
        self.assertEqual(f.stage(D1(schema=False), EVIDENCE, TODAY), '')
        sql = f.stage(D1(), EVIDENCE, TODAY, source)
        self.assertIn("'2025-11-24'", sql)
        self.assertNotIn('overdue', sql)
        self.assertIn('WHERE excluded.attempted > regional_data_checks.attempted', sql)
    def test_daily_stale_and_missing_metadata(self):
        self.assertIn('overdue', f.stage(D1(cadence='Daily'), EVIDENCE, TODAY, source))
        ev = {ID: {'fields': {'url': [META]}}}
        self.assertIn('unavailable for stated cadence', f.stage(D1(cadence='Daily'), ev, TODAY, source))
        self.assertNotIn('unavailable', f.stage(D1(), ev, TODAY, source))
    def test_failure_preserves_success_and_retry_guard(self):
        old = [{'id': ID, 'attempted': '2026-11-23', 'checked': '2026-11-22', 'publisher_updated': '2024-01-01'}]
        def fail(url, *, metadata=False): raise ValueError()
        sql = f.stage(D1(old), EVIDENCE, TODAY, fail)
        self.assertIn("'2026-11-22','2024-01-01','source check failed; review'", sql)
        old[0]['attempted'] = '2026-11-25'
        self.assertEqual(f.stage(D1(old), EVIDENCE, TODAY, fail), '')
    def test_locator_milliseconds_invalid_and_unreviewed_landing(self):
        self.assertEqual(f.metadata_value({'url': META, 'format': 'json', 'path': '/x', 'units': 'milliseconds'}, lambda *a, **k: {'x': 1000}), 1)
        with self.assertRaises(ValueError): f.publisher_date(True, TODAY)
        with self.assertRaises(ValueError): f.publisher_date('2099-01-01', TODAY)
        self.assertIn('source check failed', f.stage(D1(), {}, TODAY, source))
        self.assertFalse(f.valid_url('https://127.0.0.1/test'))
        self.assertFalse(f.valid_url('https://data.cdc.gov@localhost/test'))
    def test_reviewed_last_modified_header_is_case_insensitive(self):
        value = f.metadata_value({'url': META, 'format': 'http-last-modified'},
                                 lambda *a, **k: {'last-modified': 'Thu, 29 Jan 2026 13:19:53 GMT'})
        self.assertEqual(value, '2026-01-29')
        with self.assertRaises(ValueError):
            f.metadata_value({'url': META, 'format': 'last-modified'}, lambda *a, **k: {})

    def test_retry_after_is_capped(self):
        class Response:
            status = 200
            headers = {}
            def __enter__(self): return self
            def __exit__(self, *args): return False
        class Opener:
            calls = 0
            def open(self, req, timeout):
                self.calls += 1
                if self.calls == 1:
                    raise HTTPError(req.full_url, 429, '', {'Retry-After': '300'}, None)
                return Response()
        with patch.object(f, 'build_opener', return_value=Opener()), patch('socket.getaddrinfo', return_value=[(2,1,6,'',('1.1.1.1',443))]), patch.object(f.time, 'sleep') as sleep:
            f.request(LANDING)
            sleep.assert_called_once_with(30)

    def test_redirect_failure(self):
        class Opener:
            def open(self, req, timeout):
                raise HTTPError(req.full_url, 302, '', {'Location': 'https://127.0.0.1/x'}, None)
        with patch.object(f, 'build_opener', return_value=Opener()), patch('socket.getaddrinfo', return_value=[(2,1,6,'',('1.1.1.1',443))]):
            with self.assertRaises(ValueError): f.request(LANDING)
    def test_publication_validation(self):
        item = {'dataset_id': ID, 'paper_id': 'pmid:123', 'source': 'https://example.org/fulltext', 'evidence': 'Explicit dataset name and use.', 'reviewed': True}
        self.assertIn('regional_data_publications', f.publication_sql([item], {ID}, {'pmid:123'}))
        for change in ({'reviewed': False}, {'paper_id': 'bad'}, {'source': 'http://example.org'}, {'evidence': ''}):
            with self.assertRaises(ValueError): f.publication_sql([{**item, **change}], {ID}, {'pmid:123'})

if __name__ == '__main__': unittest.main()
