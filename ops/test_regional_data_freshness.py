import json
import unittest
from datetime import date
from unittest.mock import patch
import regional_data_freshness as freshness

TODAY = date(2026, 11, 24)
ID = 'regional:cdc-abcd-1234'
EVIDENCE = {ID: {'freshness': {'url': 'https://data.cdc.gov/api/views/abcd-1234.json', 'format': 'json', 'path': '/rowsUpdatedAt'}}}

class D1:
    def __init__(self, old=(), schema=True):
        self.old, self.schema = old, schema
    def rows(self, sql, label):
        if label == 'regional data schema':
            return [{'name': x} for x in ('regional_data_checks', 'regional_data_removals')] if self.schema else []
        if label == 'regional data inventory':
            return [{'id': ID}]
        if label == 'regional data checks':
            return self.old
        return []

class Tests(unittest.TestCase):
    def test_absent_schema_and_success(self):
        self.assertEqual(freshness.stage(D1(schema=False), EVIDENCE, TODAY), '')
        sql = freshness.stage(D1(), EVIDENCE, TODAY, lambda _: {'rowsUpdatedAt': 1763942400})
        self.assertIn("'2025-11-24'", sql)
        self.assertIn("'2026-11-24'", sql)
    def test_failure_preserves_success_and_daily_cadence(self):
        old = [{'id': ID, 'attempted': '2026-11-23', 'checked': '2026-11-22', 'publisher_updated': '2024-01-01'}]
        def fail(_): raise ValueError()
        sql = freshness.stage(D1(old), EVIDENCE, TODAY, fail)
        self.assertIn("'2026-11-22','2024-01-01','source check failed; review'", sql)
        old[0]['attempted'] = TODAY.isoformat()
        self.assertEqual(freshness.stage(D1(old), EVIDENCE, TODAY, fail), '')
    def test_stale_and_unreviewed_source(self):
        sql = freshness.stage(D1(), EVIDENCE, TODAY, lambda _: {'rowsUpdatedAt': 1600000000})
        self.assertIn('older than two years', sql)
        self.assertIn('missing reviewed', freshness.stage(D1(), {}, TODAY))
        with self.assertRaises(ValueError): freshness.publisher_date(True, TODAY)
        with self.assertRaises(ValueError): freshness.publisher_date('2099-01-01', TODAY)
    def test_publication_links_require_review_and_matching_ids(self):
        item = {'dataset_id': ID, 'paper_id': 'pmid:123', 'source': 'https://example.org/fulltext', 'evidence': 'Explicit dataset name and use.', 'reviewed': True}
        self.assertIn('regional_data_publications', freshness.publication_sql([item], {ID}, {'pmid:123'}))
        for change in ({'reviewed': False}, {'paper_id': 'bad'}, {'source': 'http://example.org'}, {'evidence': ''}):
            with self.assertRaises(ValueError): freshness.publication_sql([{**item, **change}], {ID}, {'pmid:123'})

if __name__ == '__main__': unittest.main()
