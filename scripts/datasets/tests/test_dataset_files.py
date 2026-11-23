import json
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dataset_files import api_url, cache_path, concrete, file_decision, fetch

class FileEvidenceTests(unittest.TestCase):
    def test_data_and_documents(self):
        self.assertEqual(concrete(['paper.pdf', 'proof.docx', 'readme.txt', 'table.xlsx', 'images.tar.gz']), ['table.xlsx', 'images.tar.gz'])
    def test_cache_is_required_and_missing_never_overridden(self):
        with tempfile.TemporaryDirectory() as t:
            doi = '10.5281/zenodo.123'
            self.assertEqual(file_decision(doi, {'formats': ['csv']}, t)['status'], 'hold')
            path = cache_path(t, doi)
            for state in ('missing', 'complete', 'error'):
                path.write_text(json.dumps({'state': state, 'files': []}))
                self.assertEqual(file_decision(doi, {'formats': ['csv']}, t)['status'], 'hold')
            path.write_text(json.dumps({'state': 'denied', 'files': []}))
            self.assertEqual(file_decision(doi, {'formats': ['csv']}, t)['status'], 'hold')
            self.assertEqual(file_decision(doi, {'title': 'RNA sequencing reads from patient samples'}, t)['status'], 'keep')
            self.assertEqual(file_decision(doi, {'formats': ['pdf']}, t)['status'], 'hold')
            path.write_text(json.dumps({'state': 'forbidden', 'files': []}))
            self.assertEqual(file_decision(doi, {'title': 'RNA sequencing reads from patient samples'}, t)['status'], 'keep')
            self.assertEqual(file_decision(doi, {'title': 'A dataset', 'formats': ['csv']}, t)['status'], 'hold')
            path.write_text(json.dumps({'state': 'complete', 'files': ['data.csv']}))
            self.assertEqual(file_decision(doi, {}, t)['status'], 'keep')
    def test_known_malformed_doi_does_not_bypass(self):
        self.assertEqual(file_decision('10.5281/nope')['status'], 'hold')
        self.assertEqual(file_decision('10.1111/other')['status'], 'not_applicable')
    def test_host_urls(self):
        for doi in ('10.5281/zenodo.12', '10.5061/dryad.abc', '10.6084/m9.figshare.123.v2', '10.17632/abc.1'):
            self.assertTrue(api_url(doi))

    def test_zenodo_concept_resolves_only_matching_record(self):
        with patch('dataset_files.get', side_effect=[(404, None), (200, {'hits': {'hits': [{'conceptrecid': '123', 'files': [{'key': 'table.csv'}]}]}})]):
            self.assertEqual(fetch('10.5281/zenodo.123')['files'], ['table.csv'])
        with patch('dataset_files.get', side_effect=[(404, None), (200, {'hits': {'hits': [{'conceptrecid': '456', 'files': [{'key': 'table.csv'}]}]}})]):
            self.assertEqual(fetch('10.5281/zenodo.123')['state'], 'missing')
    def test_rate_limit_and_pagination_hold(self):
        with patch('dataset_files.get', return_value=(429, None)):
            self.assertEqual(fetch('10.5281/zenodo.123')['state'], 'error')
        with patch('dataset_files.get', side_effect=[(200, {'_links': {'stash:version': {'href': '/api/v2/versions/1'}}}), (200, {'total': 2, '_embedded': {'stash:files': [{'path': 'x.csv'}]}})]):
            self.assertEqual(fetch('10.5061/dryad.test')['state'], 'incomplete')
