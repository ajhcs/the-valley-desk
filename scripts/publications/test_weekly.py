import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from weekly import add_to_year, link_versions
from weekly_topics import model_topics, read_decisions, source_topic


class WeeklyPublicationTests(unittest.TestCase):
    def test_annual_merge_preserves_earlier_row_bytes(self):
        with TemporaryDirectory(dir=Path.cwd()) as shared:
            root = Path(shared)
            prior, delta, output = (root / name for name in ("prior", "delta", "all"))
            prior.write_text('{"id": "b", "title": "Retained"}\n')
            delta.write_text('{"id":"a"}\n{"id":"c"}\n')
            add_to_year(output, prior, delta)
            self.assertEqual(output.read_text(), '{"id":"a"}\n{"id": "b", "title": "Retained"}\n{"id":"c"}\n')

    def test_capped_model_response_replays_and_unknown_keys_fail(self):
        row = {"id": "pmid:1", "title": "Unclear topic", "venue": None, "terms": []}
        with TemporaryDirectory(dir=Path.cwd()) as shared:
            root = Path(shared)
            with self.assertRaises(ValueError):
                list(model_topics([row] * 801, root, transport=lambda _: self.fail("budget must block")))
            self.assertIsNone(source_topic(row))
            def respond(body):
                self.assertNotIn("pmid:1", body.decode())
                payload = {"decisions": [{"key": 0, "topic": "Clinical care"}]}
                self.assertEqual(json.loads(body)["response_format"]["json_schema"]["required"], ["decisions"])
                return {"success": True, "result": {"response": payload}}
            self.assertEqual(list(model_topics([row], root, transport=respond)), [("pmid:1", "Clinical care")])
            self.assertEqual(list(model_topics([row], root, transport=lambda _: self.fail("must replay"))), [("pmid:1", "Clinical care")])
            incomplete = lambda _: {"success": True, "result": {"response": '{"decisions":[]}'}}
            with self.assertRaises(ValueError):
                list(model_topics([{**row, "title": "New title"}], root, transport=incomplete))

    def test_workers_ai_accepts_json_text_and_rejects_invalid_decisions(self):
        response = {"success": True, "result": {"response": '{"decisions":[{"key":0,"topic":null}]}'}}
        self.assertEqual(read_decisions(response, 1), [{"key": 0, "topic": None}])
        for decision in [{"key": False, "topic": None}, {"key": 2, "topic": None},
                         {"key": 0, "topic": "Unrecognized"}, {"key": 0, "topic": None, "extra": True}]:
            with self.subTest(decision=decision), self.assertRaises(ValueError):
                read_decisions({"success": True, "result": {"response": {"decisions": [decision]}}}, 1)

    def test_only_exact_typed_unambiguous_version_edges(self):
        a, b = "10.1000/preprint", "10.1000/journal"
        preprint = {"id": "doi:" + a, "doi": a, "type": "preprint"}
        article = {"id": "doi:" + b, "doi": b, "type": "article"}
        link_versions([preprint, article], {a: {"relation": {"is-preprint-of": [{"id-type": "doi", "id": b}]}}})
        self.assertEqual(preprint["published_as"], article["id"])
        self.assertEqual(article["preprint_of"], preprint["id"])
