import importlib.util
import json
from datetime import date
from pathlib import Path
import tempfile
import unittest
import sys
import types
from zipfile import ZipFile
from unittest.mock import Mock, call, patch

spec = importlib.util.spec_from_file_location('daily_public_sources', Path(__file__).with_name('daily_public_sources.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RefreshTests(unittest.TestCase):
    def test_discovery_rechecks_older_pushed_repositories_and_deduplicates_both_searches(self):
        def candidate(identity, created, pushed):
            return {"id": identity, "created_at": created, "pushed_at": pushed,
                    "html_url": f"https://github.com/owner/repo-{identity}"}

        new = candidate(1, "2026-11-23", "2026-11-23")
        active = candidate(2, "2026-08-01", "2026-11-23")
        removed = candidate(3, "2026-11-23", "2026-11-23")
        old = candidate(4, "2026-08-01", "2026-08-01")
        rejected = candidate(5, "2026-11-23", "2026-11-23")
        pages = [[new, removed, rejected, old], [new, removed, rejected, active, old]]
        with patch.object(module, "roster_from_public", return_value={"owner": {"login": "owner"}}), \
                patch.object(module, "_github", side_effect=pages) as github, \
                patch.object(module, "qualify_repository", side_effect=[({"id": "1"}, None), (None, "ineligible"),
                                                                      (None, "ineligible"),
                                                                      ({"id": "2"}, None)]) as qualify:
            created, _ = module.discover_projects(".", {}, {"3"}, "2026-11-25", "2026-11-22")
            pushed, skipped = module.discover_projects(".", created, {"3"}, "2026-11-25", "2026-11-22", sort="pushed")
        self.assertEqual((set(created), set(pushed), skipped), ({"1"}, {"2"}, 1))
        self.assertEqual([call.kwargs["source"]["id"] for call in qualify.call_args_list], [1, 5, 5, 2])
        self.assertEqual([url.args[0].split("sort=")[1].split("&")[0] for url in github.call_args_list],
                         ["created", "pushed"])

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

class BackoffClock:
    now = 1000

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def wait(self, delay):
        self.now += delay

    def notify_all(self):
        pass


class PublicationAdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parents[1]
        sys.path.insert(0, str(cls.root / 'scripts/publications'))
        import collect, enrich, weekly, weekly_topics, test_mechanical, receipts, sizing
        cls.collect, cls.enrich, cls.topics, cls.fixtures = collect, enrich, weekly_topics, test_mechanical
        cls.weekly, cls.receipts, cls.sizing = weekly, receipts, sizing

    def test_europe_pmc_paces_retries_over_both_cooldowns(self):
        clock = BackoffClock()
        outcomes = iter([self.receipts.MetadataError("europepmc", "receipt", None),
                         self.receipts.MetadataError("europepmc", "receipt", 503), {"ok": True}, {}])
        starts = []

        def request(*_, **kwargs):
            starts.append(clock.now)
            result = next(outcomes)
            if isinstance(result, Exception):
                raise result
            return result

        receipts = Mock()
        receipts.get.side_effect = request
        source = self.sizing.Source("europepmc", receipts, False, shared_backoff=True)
        source.backoff.condition = clock
        with patch.object(self.sizing.time, "monotonic", side_effect=lambda: clock.now):
            self.assertEqual(source.query("/search", query="one"), {"ok": True})
            self.assertEqual(source.query("/search", query="two"), {})
        self.assertEqual(starts, [1000, 1180, 1540, 1540.75])
        first = call("europepmc", "/search", {"query": "one"}, attempts=1)
        self.assertEqual(receipts.get.call_args_list, [first, first, first,
                         call("europepmc", "/search", {"query": "two"}, attempts=1)])

    def test_europe_pmc_shares_cooldown_and_stops_after_failed_probes(self):
        clock = BackoffClock()
        backoff = self.sizing.EuropePmcBackoff()
        backoff.condition = clock
        error = self.receipts.MetadataError("europepmc", "receipt", 503)
        with patch.object(self.sizing.time, "monotonic", side_effect=lambda: clock.now):
            first = backoff.acquire()
            second = backoff.acquire()
            self.assertEqual(first, second)
            self.assertEqual(clock.now, 1000.75)
            self.assertTrue(backoff.finish(first, error))
            clock.now += 10
            self.assertTrue(backoff.finish(second, error))
            probe = backoff.acquire()
            self.assertEqual(clock.now, 1180.75)
            self.assertTrue(backoff.probing)
            backoff.finish(second)
            self.assertTrue(backoff.probing)
            self.assertTrue(backoff.finish(probe, error))
            probe = backoff.acquire()
            self.assertEqual(clock.now, 1540.75)
            self.assertFalse(backoff.finish(probe, error))
            with self.assertRaises(self.receipts.MetadataError):
                backoff.acquire()

    def test_europe_pmc_holds_other_workers_while_the_probe_is_in_flight(self):
        clock = BackoffClock()
        backoff = self.sizing.EuropePmcBackoff()
        backoff.condition = clock
        error = self.receipts.MetadataError("europepmc", "receipt", 503)
        with patch.object(self.sizing.time, "monotonic", side_effect=lambda: clock.now):
            backoff.finish(backoff.acquire(), error)
            probe = backoff.acquire()
            def release_probe(delay=None):
                if delay is None:
                    backoff.finish(probe)
                else:
                    clock.now += delay

            with patch.object(clock, "wait", side_effect=release_probe) as wait:
                self.assertEqual(backoff.acquire(), probe)
                self.assertEqual(wait.call_args_list, [call(), call(0.75)])

    def test_europe_pmc_honors_retry_after_within_the_cooldown_budget(self):
        clock = BackoffClock()
        backoff = self.sizing.EuropePmcBackoff()
        backoff.condition = clock

        def busy(delay):
            return self.receipts.MetadataError("europepmc", "receipt", 429, delay)

        with patch.object(self.sizing.time, "monotonic", side_effect=lambda: clock.now):
            self.assertTrue(backoff.finish(backoff.acquire(), busy("240")))
            probe = backoff.acquire()
            self.assertEqual(clock.now, 1240)
            self.assertFalse(backoff.finish(probe, busy("600")))

    def test_conflicting_shard_hits_resolve_once(self):
        day = date(2026, 11, 25)
        original = {"source": "MED", "id": "123", "title": "Sample", "firstIndexDate": day.isoformat()}
        current = {**original, "pmcid": "PMC123"}

        def search(source, ref, start, stop):
            return [original if ref["id"] == "a" else current]

        with tempfile.TemporaryDirectory() as directory, \
                patch.object(self.weekly, "load_reference", return_value=[{"id": "a"}, {"id": "b"}]), \
                patch.object(self.weekly, "epmc_window", side_effect=search), \
                patch.object(self.weekly, "europepmc_rows", return_value=[current]) as lookup:
            candidate, = self.weekly.collect(Path(directory), day, day)
        lookup.assert_called_once()
        self.assertEqual(lookup.call_args.args[1], "EXT_ID:123 AND SRC:MED")
        self.assertEqual(candidate["observations"][0]["record"], current)
        self.assertEqual(candidate["institutions"], ["a", "b"])

    def test_preprint_link_can_join_a_later_journal_batch_without_mutating_catalog(self):
        a, b = "10.1000/preprint", "10.1000/journal"
        preprint = {"id": "doi:" + a, "doi": a, "type": "preprint", "added": "2026-01-01"}
        journal = {"id": "doi:" + b, "doi": b, "type": "article"}
        relation = {b: {"relation": {"has-preprint": [{"id-type": "doi", "id": a}]}}}
        updates = self.weekly.link_versions([journal], relation, existing=[preprint])
        self.assertNotIn("published_as", preprint)
        self.assertEqual(updates, [{**preprint, "published_as": journal["id"]}])
        self.assertEqual(journal["preprint_of"], preprint["id"])

    def test_preprint_link_keeps_an_existing_conflicting_version_link(self):
        a, b, c = "10.1000/preprint", "10.1000/journal", "10.1000/new-journal"
        arow = {"id": "doi:" + a, "doi": a, "type": "preprint"}
        brow = {"id": "doi:" + b, "doi": b, "type": "article", "preprint_of": arow["id"]}
        crow = {"id": "doi:" + c, "doi": c, "type": "article"}
        relation = {c: {"relation": {"has-preprint": [{"id-type": "doi", "id": a}]}}}
        self.assertEqual(self.weekly.link_versions([crow], relation, existing=[arow, brow]), [])
        self.assertNotIn("preprint_of", crow)

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
