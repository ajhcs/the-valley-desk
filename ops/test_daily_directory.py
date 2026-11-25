import importlib.util
from datetime import date, datetime
import json
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.parse import unquote

import daily_d1

spec = importlib.util.spec_from_file_location("daily_directory", Path(__file__).with_name("daily-directory.py"))
daily = importlib.util.module_from_spec(spec)
spec.loader.exec_module(daily)


class DailyDirectoryTests(unittest.TestCase):
    def test_next_scheduled_window_stops_before_load_on_future_date(self):
        day = datetime(2026, 11, 26, 3, 10, tzinfo=daily.NY)
        bad = {"publication": {"sample": {"published": "2027-01"}}}
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            cursor = state / "cursor.json"
            cursor.write_text('{"loaded_through":"2026-11-24"}')
            (state / "production-rows-read.json").write_text('{"inbox_available":true}')
            d1 = SimpleNamespace(reads={}, unmeasured=set(), probe=lambda: "123",
                                 rows=lambda *_: [{"enabled": 1}], revision=lambda: "live")
            with patch.object(daily, "datetime") as clock, patch.object(daily, "live_checks"), \
                    patch.object(daily, "collect", return_value=(bad, [], set())) as collect, \
                    patch.object(daily, "prepare_load") as load, patch.object(daily, "report"):
                clock.now.return_value = day
                self.assertEqual(daily.run(state, d1, plan=False, scheduled=True), 1)
            self.assertEqual(collect.call_args.args[4:6], (date(2026, 11, 25), date(2026, 11, 25)))
            load.assert_not_called()
            self.assertFalse((state / "pending.json").exists())
            self.assertEqual(json.loads(cursor.read_text())["loaded_through"], "2026-11-24")
            receipt = json.loads(next((state / "runs").glob("*/receipt.json")).read_text())
            self.assertEqual((receipt["outcome"], receipt["error"]), ("stopped", "Future publication published date"))

    def test_staged_dates_preserve_partial_precision_and_reject_invalid_days(self):
        daily.check_staged_dates({
            "publication": {"one": {"published": "2026-11"}, "two": {"published": None}},
            "dataset": {"data": {"released": "2025"}},
            "project": {"repo": {"created": "2026-11-24", "pushed": "2026-11-23"}},
        }, "2026-11-26")
        with self.assertRaisesRegex(daily.StopRun, "Invalid study last_updated date"):
            daily.check_staged_dates({"study": {"trial": {"last_updated": "2026-02-30"}}}, "2026-11-26")

    def test_live_checks_verify_detail_ids_for_every_public_kind(self):
        records = {
            "publication": {"doi:10.1234/paper": {"id": "doi:10.1234/paper"}},
            "study": {"NCT12345678": {"id": "NCT12345678"}},
            "dataset": {"doi:10.1234/data": {"id": "doi:10.1234/data"}},
            "regional-data": {"regional:example": {"id": "regional:example"}},
        }
        keys = {"publications": "publication", "studies": "study", "datasets": "dataset",
                "regional-data": "regional_data"}

        def read(_, *args, **kwargs):
            if "--dump-header" in args:
                return "HTTP/2 200\nx-directory-project-source: d1\n"
            endpoint, identifier = args[-1].split("?")[0].rsplit("/", 2)[-2:]
            return json.dumps({keys[endpoint]: {"id": unquote(identifier)}})

        with patch.object(daily_d1, "command", side_effect=read):
            statuses = daily_d1.live_checks(Path("."), "123", records=records)
        self.assertEqual(len(statuses), 8)
        self.assertTrue(all(status == 200 for status in statuses.values()))

    def test_missing_import_result_is_recovered_only_by_the_exact_d1_revision(self):
        def execute(*_):
            raise RuntimeError("Import polling returned no final result")

        d1 = SimpleNamespace(execute=execute, revision=lambda: "committed", unmeasured=set())
        self.assertTrue(daily.apply_load(d1, Path("load.sql"), "committed"))
        self.assertEqual(d1.unmeasured, {"directory load and summary"})

        d1.revision = lambda: "previous"
        with self.assertRaisesRegex(RuntimeError, "no final result"):
            daily.apply_load(d1, Path("load.sql"), "committed")

    def test_five_percent_is_inclusive_and_removals_count(self):
        before = {str(i): {} for i in range(20)}
        daily.gate("project", before, {"added": 0, "semantic_changed": 1, "removed": 0})
        with self.assertRaisesRegex(daily.StopRun, "2 of 20"):
            daily.gate("project", before, {"added": 0, "semantic_changed": 1, "removed": 1})

    def test_metadata_is_applied_but_excluded_from_guard(self):
        before = {str(i): {"id": str(i), "name": "A", "stars": 1, "license": "MIT"} for i in range(20)}
        rows = [{**row, "stars": 2, "description": "new"} for row in before.values()]
        rows[0]["license"] = "BSD-3-Clause"
        delta, count = daily.changes(before, rows, set(), 0)
        self.assertEqual(len(delta), 20)
        self.assertEqual(count["semantic_changed"], 1)
        self.assertEqual(count["metadata_only"], 19)
        self.assertEqual(count["semantic_fields"], {"license": 1})
        self.assertEqual(count["metadata_fields"]["stars"], 20)
        daily.gate("project", before, count)
        count["added"] = 1
        with self.assertRaises(daily.StopRun):
            daily.gate("project", before, count)

    def test_title_plural_affiliations_and_removal_cap(self):
        changed = daily.semantic_changes({"title": "A", "institutions": [], "counties": []},
                                         {"title": "B", "institutions": ["wistar"], "counties": ["Philadelphia"]})
        self.assertEqual(changed, {"name", "institution", "county"})
        with self.assertRaisesRegex(daily.StopRun, "limit 25"):
            daily.gate("study", {str(i): {} for i in range(1000)},
                       {"added": 0, "semantic_changed": 0, "removed": 26})

    def test_clinical_suppression_requires_a_matching_record_and_unambiguous_sites(self):
        source = daily.ROOT / "scripts/trials/collect.py"
        registry_spec = importlib.util.spec_from_file_location("trial_collector", source)
        registry = importlib.util.module_from_spec(registry_spec)
        registry_spec.loader.exec_module(registry)
        identity = "NCT99999999"
        site = {"country": "United States", "state": "Pennsylvania", "city": "Pittsburgh", "zip": "15213"}
        study = {"protocolSection": {"identificationModule": {"nctId": identity},
                                     "contactsLocationsModule": {"locations": [site]}}}
        self.assertTrue(registry.confirmed_outside(study, identity, {"15213": {"42003"}}))
        self.assertFalse(registry.confirmed_outside(study, identity, {"15213": {"42003", "42101"}}))
        self.assertFalse(registry.confirmed_outside(study, identity, {}))
        with self.assertRaises(ValueError):
            registry.confirmed_outside(study, "NCT00000001", {})

    def test_rechecks_removals_when_loading_without_pruning(self):
        root = daily.ROOT
        with tempfile.TemporaryDirectory() as directory, sqlite3.connect(":memory:") as db:
            stage = Path(directory)
            files = ["ops/directory-removals.sql", "migrations/0046_research_directory.sql",
                     "migrations/0047_clinical_studies.sql", "migrations/0049_reader_inbox.sql"]
            for name in files:
                db.executescript((root / name).read_text())
            db.execute("INSERT INTO reader_inbox(id,kind,received_at) VALUES (1,'suggestion','2026-11-23'),"
                       "(2,'suggestion','2026-11-23')")
            one, two, three = json.loads((root / "src/content/public-directory-projects.json").read_text())[:3]
            baseline = {one["id"]: one, two["id"]: two}
            start = {"project": baseline, "publication": {}, "study": {}}
            daily.prepare_load(stage, start, [], "first")
            db.executescript((stage / "load.sql").read_text())

            db.execute("INSERT OR IGNORE INTO public_directory_removals(github_id) VALUES (?)", (three["id"],))
            update = {**one, "stars": 42, "added": "2030-01-01"}
            delta = {"project": {one["id"]: update, three["id"]: three}, "publication": {}, "study": {}}
            decisions = [(1, "added", "", ("project", one["id"])), (2, "added", "", ("project", three["id"]))]
            daily.prepare_load(stage, delta, decisions, "second")
            sql = (stage / "load.sql").read_text()
            db.executescript(sql)
            db.executescript(sql)
            records = [json.loads(row[0]) for row in db.execute("SELECT record FROM research_listings ORDER BY id")]
            self.assertEqual({row["id"] for row in records}, set(baseline))
            revised = next(row for row in records if row["id"] == one["id"])
            self.assertEqual(revised["added"], one.get("added") or "")
            self.assertEqual(revised["stars"], 42)
            self.assertEqual(db.execute("SELECT status FROM reader_inbox ORDER BY id").fetchall(),
                             [("added",), ("declined",)])
            self.assertEqual(db.execute(
                             "SELECT first FROM research_summary_kinds WHERE scope_field='data'").fetchone(), ("second",))

    def test_inbox_checks_canonical_source_and_emits_no_reader_text(self):
        reader = "reader-input sentinel"
        input_rows = [
            {"id": 1, "kind": "feedback", "item_type": None, "url": None, "message": reader},
            {"id": 2, "kind": "suggestion", "item_type": "software", "url": "https://github.com@external.example/owner/repo"},
            {"id": 3, "kind": "suggestion", "item_type": "software", "url": "https://github.com/owner/repo?email=private"},
        ]
        d1 = SimpleNamespace(inbox=lambda: iter(input_rows))
        expected = {"project": {}, "publication": {}, "study": {}}
        with tempfile.TemporaryDirectory() as directory, patch.object(daily, "roster_from_public", return_value={}), \
                patch.object(daily, "qualify_repository", return_value=({"id": "1"}, None)) as qualify:
            additions, papers, decisions = daily.inbox(d1, Path(directory), Path(directory), "2026-11-23",
                                                      expected, {k: set() for k in expected})
        self.assertEqual(set(additions), {"1"})
        self.assertFalse(papers)
        self.assertEqual([row[1] for row in decisions], ["reviewed", "declined", "added"])
        self.assertEqual(qualify.call_count, 1)
        self.assertEqual(qualify.call_args.args[0], "https://github.com/owner/repo")
        self.assertNotIn(reader, str(decisions))

    def test_report_after_three_consecutive_completed_dates_only(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            for day, outcome in ((19, "complete"), (20, "manual-complete"), (21, "failed"), (22, "complete"),
                                 (23, "complete"), (24, "complete"), (25, "complete")):
                daily.report(state, {"day": f"2026-11-{day}", "outcome": outcome, "counts": {},
                                    "rows_read": {"test": day}, "unmeasured": []})
                self.assertEqual((state / "first-three-nights.txt").exists(), day >= 24)
            report = (state / "first-three-nights.txt").read_text().splitlines()
            self.assertEqual([line[:10] for line in report], ["2026-11-22", "2026-11-23", "2026-11-24"])
            kinds = [json.loads(note.read_text())["kind"] for note in (state / "notices").glob("*.json")]
            self.assertCountEqual(kinds, ["failed", "three-nights"])

    def test_retirement_requires_a_fresh_publications_load_and_runs_once(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(daily, "command") as call:
            state = Path(directory)
            receipt = {"day": "2026-11-23", "loaded_through": "2026-11-22",
                       "publication_window": True, "counts": {"publication": {"added": 0}}}
            daily.retire_weekly(state, receipt)
            call.assert_not_called()
            receipt["counts"]["publication"]["added"] = 1
            daily.retire_weekly(state, receipt)
            daily.retire_weekly(state, receipt)
            self.assertEqual(call.call_count, 1)
            self.assertIn("valley-desk-publications.timer", call.call_args.args)


if __name__ == "__main__":
    unittest.main()

class DatasetDailyIntegrationTests(unittest.TestCase):
    def test_dataset_suggestion_never_enters_publication_handler(self):
        entry = {"id": 8, "kind": "suggestion", "item_type": "dataset", "url": "https://doi.org/10.1234/example?email=private"}
        d1 = SimpleNamespace(inbox=lambda: iter([entry]))
        records = {"project": {}, "publication": {}, "study": {}}
        suggestions = []
        with tempfile.TemporaryDirectory() as directory, patch.object(daily, "roster_from_public", return_value={}), patch.object(daily, "collect_publications") as collect:
            _, _, decisions = daily.inbox(d1, Path(directory), Path(directory), "2026-11-23", records, {k: set() for k in records}, suggestions)
        collect.assert_not_called()
        self.assertEqual(suggestions, [(8, None)])
        self.assertEqual(decisions, [])

    def test_dataset_collection_stages_in_same_loader_and_revision(self):
        from datetime import date
        dataset = {"id": "doi:10.1234/new", "title": "A dataset", "summary": "A public dataset.", "data_type": "other", "access": "open", "repository": "Example", "accessions": ["10.1234/new"], "url": "https://doi.org/10.1234/new", "institutions": ["upenn"], "counties": [], "label": "Verified", "connection": "A source lists a regional creator.", "source": "https://api.datacite.org/dois/10.1234/new", "papers": [], "topic": "Research data", "released": "2026", "added": "2026-11-23", "checked": "2026-11-23", "size": None, "format": None, "license": None}
        baseline = {f"doi:10.1234/{i}": {**dataset, "id": f"doi:10.1234/{i}", "accessions": [f"10.1234/{i}"]} for i in range(20)}
        conflicting = {**dataset, "id": "doi:10.1234/conflict", "accessions": ["10.1234/0"]}
        publication = {"id": "pmid:123", "pmcid": "PMC123"}
        class FakeD1:
            def rows(self, sql, label):
                return [{"enabled": 1}] if label == "dataset visibility" else []
            def listings(self, kind):
                return baseline if kind == "dataset" else {}
            def inbox(self):
                return iter([{"id": 9, "kind": "suggestion", "item_type": "dataset", "url": "https://doi.org/10.1234/new"}])
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            (state / "datasets-config.json").write_text(json.dumps({"enabled": True, "first_public_load_confirmed": True}))
            (state / "datasets-cursor.json").write_text(json.dumps({"datacite_through": "2026-11-20T00:00:00Z"}))
            receipt = {"counts": {}}
            with patch.object(daily, "refresh_projects", return_value=({}, 0)), patch.object(daily, "discover_projects", return_value=({}, 0)), patch.object(daily, "collect_publications", return_value=([publication], 0)), patch.object(daily, "studies", return_value=([], 0, set(), 0)), patch.object(daily, "roster_from_public", return_value={}), patch.object(daily, "command", return_value="SELECT 1;"), patch.object(daily.daily_datasets, "collect_phase_one", return_value=[dataset, conflicting]) as source:
                # Give the ordinary publication gate enough baseline for one new paper.
                fake = FakeD1()
                fake.listings = lambda kind: baseline if kind == "dataset" else ({f"pmid:{i}": {"id": f"pmid:{i}"} for i in range(20)} if kind == "publication" else {})
                deltas, decisions, outside = daily.collect(fake, state, state, "2026-11-23", date(2026, 11, 22), date(2026, 11, 23), receipt)
                daily.prepare_load(state, deltas, decisions, "new-revision", outside)
            self.assertEqual([p["id"] for p in source.call_args.args[2]], [publication["id"]])
            self.assertEqual(receipt["counts"]["dataset"]["added"], 1)
            self.assertEqual(receipt["counts"]["dataset"]["skipped"], 1)
            self.assertNotIn(conflicting["id"], deltas["dataset"])
            self.assertIn(("dataset", "doi:10.1234/new"), [d[3] for d in decisions])
            self.assertIn("new-revision", (state / "load.sql").read_text())
            self.assertIn("doi:10.1234/new", (state / "datasets.jsonl").read_text())
            self.assertEqual(json.loads((state / "datasets-cursor.json").read_text())["datacite_through"], "2026-11-20T00:00:00Z")

    def test_nightly_dataset_update_keeps_listed_papers(self):
        old = {"papers": ["doi:10.1/a"], "paper_provenance": [{"paper": "doi:10.1/a", "relation": "linked"}]}
        # A DataCite-only rebuild knows no papers; the listed link and its relation stay.
        candidate = {"papers": [], "paper_provenance": None}
        daily.keep_listed_papers(old, candidate)
        self.assertEqual(candidate, old)
        # New papers are added after the listed ones, and a listed relation is not relabelled.
        candidate = {"papers": ["doi:10.1/b", "doi:10.1/a"], "paper_provenance": [
            {"paper": "doi:10.1/b", "relation": "produced"}, {"paper": "doi:10.1/a", "relation": "produced"}]}
        daily.keep_listed_papers(old, candidate)
        self.assertEqual(candidate["papers"], ["doi:10.1/a", "doi:10.1/b"])
        self.assertEqual(candidate["paper_provenance"], [
            {"paper": "doi:10.1/a", "relation": "linked"}, {"paper": "doi:10.1/b", "relation": "produced"}])
        # A listing without papers leaves the candidate as built.
        candidate = {"papers": ["doi:10.1/b"]}
        daily.keep_listed_papers({"papers": []}, candidate)
        self.assertEqual(candidate, {"papers": ["doi:10.1/b"]})

    def test_real_loader_dataset_sql_replays_and_respects_removal(self):
        dataset = {"id": "doi:10.1234/new", "title": "A dataset", "summary": "A public dataset.", "data_type": "other", "access": "open", "repository": "Example", "accessions": ["10.1234/new"], "url": "https://doi.org/10.1234/new", "institutions": ["upenn"], "counties": [], "label": "Verified", "connection": "A source lists a regional creator.", "source": "https://api.datacite.org/dois/10.1234/new", "papers": [], "topic": "Research data", "released": "2026", "added": "2026-11-23", "checked": "2026-11-23", "size": None, "format": None, "license": None}
        with tempfile.TemporaryDirectory() as directory, sqlite3.connect(":memory:") as db:
            for name in ("ops/directory-removals.sql", "migrations/0046_research_directory.sql", "migrations/0047_clinical_studies.sql", "migrations/0049_reader_inbox.sql", "migrations/0050_datasets.sql"):
                db.executescript((daily.ROOT / name).read_text())
            db.execute("UPDATE dataset_visibility SET enabled=1 WHERE id=1")
            stage = Path(directory)
            daily.prepare_load(stage, {"project": {}, "publication": {}, "study": {}, "dataset": {dataset["id"]: dataset}}, [], "dataset-revision")
            sql = (stage / "load.sql").read_text()
            db.executescript(sql)
            db.executescript(sql)
            self.assertEqual(db.execute("SELECT count(*) FROM research_visible WHERE kind='dataset'").fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT first FROM research_summary_kinds WHERE scope_field='data' AND kind='directory'").fetchone()[0], "dataset-revision")
            db.execute("INSERT INTO dataset_removals(id) VALUES (?)", (dataset["id"],))
            db.executescript(sql)
            self.assertEqual(db.execute("SELECT count(*) FROM research_visible WHERE kind='dataset'").fetchone()[0], 0)

    def test_checkpoint_waits_for_confirmed_revision_and_recovers_lost_response(self):
        import re
        from collections import defaultdict
        from datetime import datetime, timedelta
        class FakeD1:
            def __init__(self, commit):
                self.current = "old-revision"
                self.commit = commit
                self.reads = defaultdict(int)
                self.unmeasured = set()
            def probe(self): return "123"
            def revision(self): return self.current
            def bookmark(self): return "bookmark"
            def rows(self, sql, label): return [{"enabled": 1}] if label == "study visibility" else [{"name": "reader_inbox"}]
            def listings(self, kind): return {}
            def execute(self, flag, path, label):
                if self.commit:
                    self.current = re.findall(r"UPDATE research_summary_kinds SET first='([^']+)'", Path(path).read_text())[-1]
                raise RuntimeError("Lost response")
        def fake_collect(d1, state, run_dir, day, first, last, receipt):
            receipt["dataset_through"] = "2026-11-23T00:00:00Z"
            return {"project": {}, "publication": {}, "study": {}, "dataset": {}}, [], set()
        for committed in (False, True):
            with self.subTest(committed=committed), tempfile.TemporaryDirectory() as directory:
                state = Path(directory)
                yesterday = (datetime.now(daily.NY).date() - timedelta(days=1)).isoformat()
                (state / "cursor.json").write_text(json.dumps({"loaded_through": yesterday}))
                (state / "datasets-cursor.json").write_text(json.dumps({"datacite_through": "2026-11-20T00:00:00Z"}))
                (state / "production-rows-read.json").write_text('{"inbox_available": true}')
                with patch.object(daily, "collect", side_effect=fake_collect), patch.object(daily, "live_checks", return_value={}), patch.object(daily, "snapshot", return_value={}), patch.object(daily, "report"):
                    code = daily.run(state, FakeD1(committed), plan=False, scheduled=False)
                self.assertEqual(code, 0 if committed else 1)
                cursor = json.loads((state / "datasets-cursor.json").read_text())["datacite_through"]
                self.assertEqual(cursor, "2026-11-23T00:00:00Z" if committed else "2026-11-20T00:00:00Z")
