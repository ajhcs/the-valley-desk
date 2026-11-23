import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("daily_directory", Path(__file__).with_name("daily-directory.py"))
daily = importlib.util.module_from_spec(spec)
spec.loader.exec_module(daily)


class DailyDirectoryTests(unittest.TestCase):
    def test_five_percent_is_inclusive_and_removals_count(self):
        before = {str(i): {} for i in range(20)}
        daily.gate("project", before, {"changed": 1, "removed": 0})
        with self.assertRaisesRegex(daily.StopRun, "2 of 20"):
            daily.gate("project", before, {"changed": 1, "removed": 1})

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
                     "migrations/0047_clinical_studies.sql"]
            for name in files:
                db.executescript((root / name).read_text())
            db.execute("CREATE TABLE reader_inbox(id INTEGER PRIMARY KEY, status TEXT, note TEXT)")
            db.execute("INSERT INTO reader_inbox VALUES (1,'new',''),(2,'new','')")
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
            for day, outcome in ((20, "complete"), (21, "failed"), (22, "complete"),
                                 (23, "complete"), (24, "complete"), (25, "complete")):
                daily.report(state, {"day": f"2026-11-{day}", "outcome": outcome, "counts": {},
                                    "rows_read": {"test": day}, "unmeasured": []})
                self.assertEqual((state / "first-three-nights.txt").exists(), day >= 24)
            report = (state / "first-three-nights.txt").read_text().splitlines()
            self.assertEqual([line[:10] for line in report], ["2026-11-22", "2026-11-23", "2026-11-24"])


if __name__ == "__main__":
    unittest.main()
