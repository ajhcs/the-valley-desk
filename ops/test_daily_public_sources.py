import importlib.util
import json
from collections import Counter
from datetime import date
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
    def test_repositories_with_commit_trees_do_not_truncate_later_batches(self):
        previous = {str(i): {'id': str(i), 'code': f'https://github.com/owner/repo-{i}'} for i in range(1, 42)}
        source = {'isPrivate': False, 'primaryLanguage': None, 'licenseInfo': None,
                  'pushedAt': None, 'isArchived': False, 'stargazerCount': 5, 'description': None,
                  'defaultBranchRef': {'target': {'oid': 'a' * 40, 'tree': {'entries': [
                      {'name': 'README.md', 'type': 'blob'}]}}}}
        first = {f'r{i}': {**source, 'databaseId': i + 1} for i in range(40)}
        second = {'r0': {**source, 'databaseId': 41}}
        responses = [types.SimpleNamespace(returncode=0, stdout=json.dumps({'data': batch}))
                     for batch in (first, second)]
        with tempfile.TemporaryDirectory() as directory, patch.object(module.subprocess, 'run', side_effect=responses) as gh:
            records, skipped = module.refresh_projects('.', directory, previous, set(), '2026-11-25')
        self.assertEqual(len(gh.call_args_list), 2)
        self.assertIn('name:"repo-41"', gh.call_args_list[1].args[0][-1])
        self.assertEqual(skipped, 0)
        self.assertTrue(all(row['stars'] == 5 and row['readmeUrl'].endswith('/README.md') for row in records.values()))

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

    def test_noassertion_license_is_null_for_graphql_and_rest(self):
        self.assertIsNone(module.github_license({'spdxId': 'NOASSERTION'}))
        self.assertIsNone(module.github_license({'spdx_id': 'NOASSERTION'}))
        self.assertIsNone(module.github_license(None))
        self.assertEqual(module.github_license({'spdx_id': 'MIT'}), 'MIT')
        previous = {'id': '123', 'code': 'https://github.com/owner/repo', 'license': 'MIT'}
        source = {'databaseId': 123, 'isPrivate': False, 'primaryLanguage': None,
                  'licenseInfo': {'spdxId': 'NOASSERTION'}, 'pushedAt': None,
                  'isArchived': False, 'stargazerCount': 0, 'description': None}
        response = types.SimpleNamespace(returncode=0, stdout=__import__('json').dumps({'data': {'r0': source}}))
        with tempfile.TemporaryDirectory() as directory, patch.object(module.subprocess, 'run', return_value=response):
            records, _ = module.refresh_projects('.', directory, {'123': previous}, set(), '2026-11-23')
        self.assertIsNone(records['123']['license'])

    def test_refresh_uses_observed_commit_tree_and_removes_missing_files(self):
        previous = {'id': '123', 'code': 'https://github.com/owner/repo', 'citationUrl': 'https://github.com/owner/repo/blob/old/CITATION.cff'}
        source = {'databaseId': 123, 'isPrivate': False, 'primaryLanguage': None, 'licenseInfo': None,
                  'pushedAt': None, 'isArchived': False, 'stargazerCount': 0, 'description': None,
                  'defaultBranchRef': {'target': {'oid': 'a' * 40, 'tree': {'entries': [
                      {'name': 'README.md', 'type': 'blob'}, {'name': 'CITATION.cff', 'type': 'tree'}]}}}}
        response = types.SimpleNamespace(returncode=0, stdout=__import__('json').dumps({'data': {'r0': source}}))
        with tempfile.TemporaryDirectory() as directory, patch.object(module.subprocess, 'run', return_value=response):
            records, _ = module.refresh_projects('.', directory, {'123': previous}, set(), '2026-11-23')
        self.assertEqual(records['123']['readmeUrl'], 'https://github.com/owner/repo/blob/' + 'a' * 40 + '/README.md')
        self.assertIsNone(records['123']['citationUrl'])

    def test_identity_mismatch_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(sys.modules, {'regional': types.SimpleNamespace(build_regional=lambda *a, **k: {})}), patch.object(module.subprocess, 'run', return_value=type('Result', (), {'returncode': 0, 'stdout': __import__('json').dumps({'data': {'r0': {'databaseId': 999, 'isPrivate': False}}})})()):
            with self.assertRaises(ValueError):
                module.refresh_projects('.', directory, {'123': {'code': 'https://github.com/owner/repo'}}, set(), '2026-11-23')

class PublicationAdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parents[1]
        sys.path.insert(0, str(cls.root / 'scripts/publications'))
        import collect, enrich, weekly, weekly_topics, test_mechanical, receipts
        cls.collect, cls.enrich, cls.topics, cls.fixtures = collect, enrich, weekly_topics, test_mechanical
        cls.weekly, cls.receipts = weekly, receipts

    def test_transient_shard_retries_then_conflicting_hits_resolve_once(self):
        day = date(2026, 11, 25)
        original = {"source": "MED", "id": "123", "title": "Sample", "firstIndexDate": day.isoformat()}
        current = {**original, "pmcid": "PMC123"}
        attempts = Counter()

        def search(source, ref, start, stop):
            key = ref["id"]
            attempts[key] += 1
            if key == "b" and attempts[key] == 1:
                raise self.receipts.MetadataError("europepmc", "receipt", 503)
            return [original if key == "a" else current]

        with tempfile.TemporaryDirectory() as directory, \
                patch.object(self.weekly, "load_reference", return_value=[{"id": "a"}, {"id": "b"}]), \
                patch.object(self.weekly, "epmc_window", side_effect=search), \
                patch.object(self.weekly.time, "sleep") as sleep, \
                patch.object(self.weekly, "europepmc_rows", return_value=[current]) as lookup:
            candidate, = self.weekly.collect(Path(directory), day, day)
        self.assertEqual(attempts, {"a": 1, "b": 2})
        sleep.assert_called_once_with(20)
        lookup.assert_called_once()
        self.assertEqual(lookup.call_args.args[1], 'EXT_ID:"123" AND SRC:MED')
        self.assertEqual(candidate["observations"][0]["record"], current)
        self.assertEqual(candidate["institutions"], ["a", "b"])

    def test_overlap_rejects_changed_publication_identity(self):
        old = {"source": "MED", "id": "123", "doi": "10.9999/old", "firstIndexDate": "2026-11-25"}
        new = {**old, "doi": "10.9999/new"}
        with patch.object(self.weekly, "europepmc_rows") as lookup, \
                self.assertRaisesRegex(self.collect.EuropePmcCoverageError, "disagree on identity"):
            self.weekly.reconcile_epmc_overlap(None, "MED", "123", [("a", old), ("b", new)])
        lookup.assert_not_called()

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
