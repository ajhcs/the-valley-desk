import gzip
import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import parse_qs, urlsplit

from daily_datasets import StopRun, collect_datacite, commit_checkpoint, datacite_url, guard, paper_delta, suggestion_identifier


class NightlyDatasetsTests(unittest.TestCase):
    def test_reader_suggestion_reduces_to_identifier(self):
        base = {"kind": "suggestion", "item_type": "dataset"}
        self.assertEqual(suggestion_identifier({**base, "url": "https://doi.org/10.5281/zenodo.12"}), "doi:10.5281/zenodo.12")
        for url in ("https://doi.org/10.5281/zenodo.12?email=private", "https://doi.org@evil.test/10.5281/zenodo.12", "https://doi.org/10.5281/zenodo.12#note", "http://doi.org/10.5281/zenodo.12"):
            self.assertIsNone(suggestion_identifier({**base, "url": url}))
        self.assertIsNone(suggestion_identifier({**base, "item_type": "publication", "url": "https://doi.org/10.5281/zenodo.12"}))

    def test_paper_delta_reports_missing_without_deleting(self):
        changed, missing = paper_delta([{"id": "a", "title": "old"}, {"id": "b"}], [{"id": "a", "title": "new"}])
        self.assertEqual(changed, [{"id": "a", "title": "new"}])
        self.assertEqual(missing, ["b"])
        with self.assertRaises(StopRun):
            paper_delta([], [{"id": "a"}, {"id": "a"}])

    def test_guard_independent_baseline_and_material_changes(self):
        baseline = [{"id": str(i), "name": "x", "checked": "old"} for i in range(20)]
        self.assertEqual(guard(baseline, [{"id": "0", "name": "x", "checked": "new"}, {"id": "new"}])["added"], 1)
        with self.assertRaises(StopRun):
            guard(baseline, [{"id": "0", "name": "changed"}, {"id": "new"}])
        with self.assertRaises(StopRun):
            guard([], [{"id": "new"}])

    def test_datacite_window_and_complete_pages(self):
        url = datacite_url("https://ror.org/00hj54h04", "2026-11-20T00:00:00Z", "2026-11-23T00:00:00Z")
        query = parse_qs(urlsplit(url).query)["query"][0]
        self.assertIn("2026-11-19T00:00:00Z TO 2026-11-23T00:00:00Z", query)
        next_url = "https://api.datacite.org/dois?page%5Bcursor%5D=next"
        def http(request, **kwargs):
            return 200, json.dumps({"data": [{"id": "x"}], "links": {"next": next_url if request == url else None}}).encode()
        with tempfile.TemporaryDirectory() as directory:
            pages = collect_datacite(url, http, directory)
            self.assertEqual(len(pages), 2)
            with gzip.open(pages[0], "rt") as stream:
                self.assertEqual(json.load(stream)["data"][0]["id"], "x")
            with self.assertRaises(StopRun):
                collect_datacite(url, lambda *a, **k: (429, b""), directory)
            with self.assertRaises(StopRun):
                collect_datacite(url, lambda *a, **k: (200, b'{"data":[{}],"links":{"next":"https://evil.test/"}}'), directory)

    def test_checkpoint_requires_matching_successful_receipt(self):
        pending = {"artifact_sha256": "a" * 64, "datacite_through": "2026-11-23T00:00:00Z", "paper_snapshot_sha256": "b" * 64, "revision": "r"}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cursor.json"
            with self.assertRaises(StopRun):
                commit_checkpoint(path, pending, {"outcome": "failed", "revision": "r", "artifact_sha256": "a" * 64})
            self.assertFalse(path.exists())
            commit_checkpoint(path, pending, {"outcome": "complete", "revision": "r", "artifact_sha256": "a" * 64})
            self.assertEqual(json.loads(path.read_text())["revision"], "r")


if __name__ == "__main__":
    unittest.main()

class LocalPreparationTests(unittest.TestCase):
    def test_disabled_and_evidence_preservation(self):
        from daily_datasets import prepare_local
        baseline = [{"id": f"doi:10.1234/{i}", "papers": ["p"], "label": "Verified", "added": "old"} for i in range(20)]
        with tempfile.TemporaryDirectory() as directory:
            args = dict(baseline=baseline, candidates=[], removed=[], papers=[], suggestions=[], run_dir=directory, validate=lambda *_: None, loader=lambda _: "SELECT 1;")
            with self.assertRaises(StopRun):
                prepare_local({}, **args)
            args["candidates"] = [{**baseline[0], "papers": []}]
            with self.assertRaises(StopRun):
                prepare_local({"enabled": True, "first_public_load_confirmed": True}, **args)

    def test_preparation_keeps_reader_text_out(self):
        from daily_datasets import prepare_local
        baseline = [{"id": f"doi:10.1234/{i}", "papers": ["p"], "label": "Verified", "added": "old"} for i in range(20)]
        suggestion = {"id": 4, "kind": "suggestion", "item_type": "dataset", "url": "https://doi.org/10.1234/0", "message": "secret text", "email": "private@example.test"}
        with tempfile.TemporaryDirectory() as directory:
            def validate(rows, papers):
                self.assertEqual(rows[0]["added"], "old")
            def loader(path):
                self.assertEqual(json.loads(path.read_text())["id"], baseline[0]["id"])
                return "SELECT 1;"
            result = prepare_local({"enabled": True, "first_public_load_confirmed": True}, baseline=baseline, candidates=[{**baseline[0], "added": "new", "checked": "today"}], removed=[], papers=["p"], suggestions=[suggestion], run_dir=directory, validate=validate, loader=loader)
            self.assertEqual(result["matched_suggestion_ids"], [4])
            self.assertTrue(all("secret text" not in p.read_text() and "private@example.test" not in p.read_text() for p in Path(directory).iterdir()))

class SuggestedDatasetTests(unittest.TestCase):
    def test_canonical_accessions_and_private_query_rejection(self):
        base = {"kind": "suggestion", "item_type": "dataset"}
        for url, expected in (("https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE123", "geo:GSE123"), ("https://www.ncbi.nlm.nih.gov/bioproject/PRJNA123", "bioproject:PRJNA123"), ("https://identifiers.org/GSE123", "geo:GSE123")):
            self.assertEqual(suggestion_identifier({**base, "url": url}), expected)
        self.assertIsNone(suggestion_identifier({**base, "url": "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE123&email=private"}))

    def test_suggestion_metadata_is_qualified_by_real_phase_one_rules(self):
        import os
        import subprocess
        import sys
        from types import SimpleNamespace
        from daily_datasets import collect_suggestion_dois
        attrs = {"doi": "10.5281/zenodo.123", "titles": [{"title": "Human cancer gene expression dataset"}], "descriptions": [{"description": "This dataset contains human cancer gene expression measurements collected from patient tissue samples.", "descriptionType": "Abstract"}], "publicationYear": 2025, "types": {"resourceTypeGeneral": "Dataset"}, "publisher": "Zenodo", "creators": [{"affiliation": [{"name": "University of Pennsylvania", "affiliationIdentifier": "https://ror.org/00b30xv10"}]}]}
        urls = []
        def http(url, **kwargs):
            urls.append(url)
            if url.endswith("zenodo.404?affiliation=true"):
                return 404, b""
            return 200, json.dumps({"data": {"id": "10.5281/zenodo.123", "attributes": attrs}}).encode()
        def write_gz(path, data):
            path.parent.mkdir(parents=True, exist_ok=True)
            with gzip.open(path, "wt") as out: json.dump(data, out)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            collect_suggestion_dois(["doi:10.5281/zenodo.123", "doi:10.5281/zenodo.404"], SimpleNamespace(http=http, write_gz_json=write_gz), root)
            self.assertTrue(all(url.startswith("https://api.datacite.org/dois/") for url in urls))
            (root / "papers.json").write_text("[]")
            (root / "mentions-classified.jsonl").write_text("")
            checkout = Path(__file__).resolve().parents[1]
            env = dict(os.environ, TVD_DATASETS_WORK=str(root))
            subprocess.run([sys.executable, "-I", "-B", str(checkout / "scripts/datasets/build.py")], cwd=checkout, env=env, check=True, capture_output=True)
            rows = [json.loads(line) for line in (root / "datasets.jsonl").read_text().splitlines()]
            self.assertEqual([r["id"] for r in rows], ["doi:10.5281/zenodo.123"])
            self.assertEqual(rows[0]["label"], "Verified")
            attrs["creators"] = []
            collect_suggestion_dois(["doi:10.5281/zenodo.123"], SimpleNamespace(http=http, write_gz_json=write_gz), root)
            subprocess.run([sys.executable, "-I", "-B", str(checkout / "scripts/datasets/build.py")], cwd=checkout, env=env, check=True, capture_output=True)
            self.assertEqual((root / "datasets.jsonl").read_text(), "")

    def test_expected_not_found_is_not_source_failure(self):
        import importlib.util
        import urllib.error
        from unittest.mock import patch
        path = Path(__file__).resolve().parents[1] / "scripts/datasets/common.py"
        spec = importlib.util.spec_from_file_location("test_dataset_common", path)
        common = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(common)
        for code in (404, 500):
            error = urllib.error.HTTPError("https://example.test", code, "error", {}, None)
            with patch.object(common.urllib.request, "urlopen", side_effect=error), patch.object(common.time, "sleep"):
                status, _ = common.http("https://example.test", attempts=1)
            self.assertEqual(status, code)
            self.assertEqual(common.FAILS["example.test"], 0 if code == 404 else 1)
