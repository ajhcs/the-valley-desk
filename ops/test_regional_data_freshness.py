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

class IndependentLaneTests(unittest.TestCase):
    def test_lane_commits_before_failed_collection_and_plan_never_writes_d1(self):
        import importlib.util
        import tempfile
        from pathlib import Path
        from collections import defaultdict
        from datetime import timedelta
        spec = importlib.util.spec_from_file_location('daily_independent', Path(__file__).with_name('daily-directory.py'))
        daily = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(daily)
        class Fake:
            reads = defaultdict(int)
            unmeasured = set()
            def __init__(self): self.writes = []
            def execute(self, flag, path, label): self.writes.append((label, Path(path).read_text()))
            def probe(self): return '123'
            def rows(self, sql, label): return [{'enabled': 1}]
            def revision(self): return 'old'
        for plan in (False, True):
            with self.subTest(plan=plan), tempfile.TemporaryDirectory() as tmp:
                state = Path(tmp)
                (state / 'regional-data-config.json').write_text('{"enabled":true}')
                (state / 'cursor.json').write_text(json.dumps({'loaded_through': (daily.datetime.now(daily.NY).date() - timedelta(days=1)).isoformat()}))
                (state / 'production-rows-read.json').write_text('{"inbox_available":true}')
                d1 = Fake()
                with patch.object(daily.regional_data_freshness, 'stage', return_value='SELECT 1;'), patch.object(daily, 'live_checks', return_value={}), patch.object(daily, 'collect', side_effect=daily.StopRun('dataset gate')), patch.object(daily, 'report'):
                    result = daily.run(state, d1, plan=plan, scheduled=False)
                self.assertEqual(result, 1)
                self.assertEqual(len(d1.writes), 0 if plan else 1)
                receipt = json.loads(next((state / 'runs').glob('*/receipt.json')).read_text())
                self.assertEqual(receipt['regional_data_freshness'], 'staged' if plan else 'complete')
                self.assertEqual(receipt['error'], 'dataset gate')
    def test_write_failure_is_visible_in_receipt(self):
        import importlib.util, tempfile
        from pathlib import Path
        spec = importlib.util.spec_from_file_location('daily_failure', Path(__file__).with_name('daily-directory.py'))
        daily = importlib.util.module_from_spec(spec); spec.loader.exec_module(daily)
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp); (state / 'regional-data-config.json').write_text('{"enabled":true}')
            class Fake:
                def execute(self, *args): raise RuntimeError('private stderr')
            receipt = {}
            with patch.object(daily.regional_data_freshness, 'stage', return_value='SELECT 1;'):
                daily.regional_freshness(state, Fake(), state, TODAY, plan=False, receipt=receipt)
            self.assertEqual(receipt['regional_data_freshness'], 'failed')
            self.assertEqual(receipt['attempt_errors'], ['Regional data freshness failed'])

if __name__ == '__main__': unittest.main()
