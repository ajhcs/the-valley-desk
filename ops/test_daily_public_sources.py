import importlib.util
from pathlib import Path
import tempfile
import unittest
import sys
import types
from zipfile import ZipFile
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('daily_public_sources', Path(__file__).with_name('daily_public_sources.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RefreshTests(unittest.TestCase):
    def test_refresh_replaces_changed_values_and_preserves_purpose(self):
        original = {'id': '123', 'code': 'https://github.com/owner/repo', 'purpose': 'Editorial description', 'stars': 1}
        source = {'databaseId': 123, 'isPrivate': False, 'primaryLanguage': None, 'licenseInfo': None, 'pushedAt': '2026-11-23T12:00:00Z',
                  'isArchived': True, 'stargazerCount': 7, 'description': 'Source description'}
        with tempfile.TemporaryDirectory() as directory, patch.dict(sys.modules, {'regional': types.SimpleNamespace(build_regional=lambda *a, **k: {})}), patch.object(module.subprocess, 'run', return_value=type('Result', (), {'returncode': 0, 'stdout': __import__('json').dumps({'data': {'r0': source}})})()):
            records, skipped = module.refresh_projects('.', directory, {'123': original}, set(), '2026-11-23')
        self.assertEqual(skipped, 0)
        self.assertEqual(records['123']['stars'], 7)
        self.assertEqual(records['123']['description'], 'Source description')
        self.assertEqual(records['123']['purpose'], original['purpose'])
        self.assertTrue(records['123']['archived'])
        self.assertNotIn('language', records['123'])

    def test_identity_mismatch_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(sys.modules, {'regional': types.SimpleNamespace(build_regional=lambda *a, **k: {})}), patch.object(module.subprocess, 'run', return_value=type('Result', (), {'returncode': 0, 'stdout': __import__('json').dumps({'data': {'r0': {'databaseId': 999, 'isPrivate': False}}})})()):
            with self.assertRaises(ValueError):
                module.refresh_projects('.', directory, {'123': {'code': 'https://github.com/owner/repo'}}, set(), '2026-11-23')

class PublicationAdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parents[1]
        sys.path.insert(0, str(cls.root / 'scripts/publications'))
        import collect, enrich, weekly_topics, test_mechanical
        cls.collect, cls.enrich, cls.topics, cls.fixtures = collect, enrich, weekly_topics, test_mechanical

    def test_suggestions_accept_only_exact_requested_identifiers(self):
        matching = {'source': 'MED', 'id': '12345678', 'doi': '10.9999/test.publisher'}
        unrelated = {'source': 'MED', 'id': '87654321', 'doi': '10.9999/unrelated'}
        with tempfile.TemporaryDirectory() as directory, patch.object(self.collect, 'europepmc_rows', return_value=[matching, unrelated]):
            result = module.suggested_publications(Path(directory), {'doi:10.9999/test.publisher', 'pmid:12345678'})
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['id'], 'doi:10.9999/test.publisher')

    def test_suggested_publication_runs_mechanical_gates_and_validation(self):
        candidate = self.fixtures.fixture('The Wistar Institute, Philadelphia, PA 19104')
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'state'
            run = Path(directory) / 'run'
            state.mkdir(); run.mkdir(mode=0o700)
            (state / 'hold-ids.txt').write_text('')
            with ZipFile(state / 'US.zip', 'w') as archive:
                archive.writestr('US.txt', 'US\t19104\tPhiladelphia\tPennsylvania\tPA\tPhiladelphia\n')
            with patch.object(module, 'suggested_publications', return_value=[candidate]), \
                 patch.object(self.enrich, 'crossref_lookup', return_value=[]), \
                 patch.object(self.topics, 'model_topics', return_value=iter([('doi:10.9999/test.publisher', 'Clinical care')])):
                rows, skipped = module.collect_publications(self.root, state, run, {}, set(), suggestions={'pmid:12345678'})
            self.assertEqual(skipped, 0)
            self.assertEqual(rows[0]['id'], 'doi:10.9999/test.publisher')
            self.assertEqual(rows[0]['topic'], 'Clinical care')
            self.assertEqual(rows[0]['institutions'], ['wistar'])


if __name__ == '__main__':
    unittest.main()
