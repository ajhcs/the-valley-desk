from datetime import date
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import daily_discovery as discovery
import supplemental

DAY = date(2026, 11, 24)


def observation(provider, identifier, *keys, kind="citation", version=0):
    return {"provider": provider, "source_id": identifier, "identifiers": list(keys),
            "institutions": ["wistar"], "affiliations": ["The Wistar Institute, Philadelphia, PA"],
            "kind": kind, "version": version}


class SupplementalDiscoveryTests(unittest.TestCase):
    def test_pubmed_binds_every_requested_id_and_separates_index_and_published_dates(self):
        xml = supplemental.parse_xml(b"""
            <PubmedArticleSet><PubmedArticle>
              <MedlineCitation><PMID>123</PMID><Article>
                <ArticleTitle>A <i>study</i></ArticleTitle>
                <Journal><JournalIssue><PubDate><Year>2027</Year><Month>Feb</Month></PubDate></JournalIssue></Journal>
                <AuthorList><Author><AffiliationInfo><Affiliation>The Wistar Institute, Philadelphia, PA</Affiliation></AffiliationInfo></Author></AuthorList>
                <ArticleDate DateType="Electronic"><Year>2026</Year><Month>11</Month><Day>2</Day></ArticleDate>
              </Article></MedlineCitation><PubmedData>
                <History><PubMedPubDate PubStatus="entrez"><Year>2026</Year><Month>11</Month><Day>24</Day></PubMedPubDate></History>
                <ArticleIdList><ArticleId IdType="doi">10.1234/Example</ArticleId></ArticleIdList>
              </PubmedData></PubmedArticle></PubmedArticleSet>
        """)
        row = supplemental.pubmed_records(xml, ["123"])["123"]
        self.assertEqual(row["identifiers"], ["doi:10.1234/example", "pmid:123"])
        self.assertEqual((row["published_online"], row["created_in_pubmed"], row["issue_date"]),
                         ("2026-11-02", "2026-11-24", "2027-02"))
        self.assertEqual(row["title"], "A study")
        with self.assertRaisesRegex(supplemental.CoverageError, "not return all"):
            supplemental.pubmed_records(xml, ["123", "124"])

    def test_pubmed_refuses_truncated_search(self):
        get = Mock(return_value={"esearchresult": {"count": "2", "retstart": "0", "idlist": ["123"]}})
        with self.assertRaisesRegex(supplemental.CoverageError, "every unique result"):
            list(supplemental.collect_pubmed(get, [{"name": "Wistar Institute", "aliases": []}], DAY, DAY))
        self.assertIn("[crdt]", get.call_args.args[2]["term"])

    def test_preprint_feed_binds_repository_versions_and_refuses_partial_results(self):
        row = {"doi": "10.1101/preprint", "date": str(DAY), "version": "3", "server": "bioRxiv",
               "published": "10.1234/journal", "title": "A study", "abstract": "Code is available at https://github.com/owner/repo.",
               "author_corresponding_institution": "The Wistar Institute"}
        def get(*_):
            return {"messages": [{"status": "ok", "interval": f"{DAY}:{DAY}", "cursor": 0, "total": "1",
                                  "count": 1}], "collection": [row]}
        version, = supplemental.collect_preprints(get, "biorxiv", DAY, DAY)
        self.assertEqual((version["version"], version["first_posted"], version["version_posted"]), (3, None, str(DAY)))
        self.assertEqual(version["published_as_doi"], "10.1234/journal")
        self.assertEqual(version["code_links"], ["https://github.com/owner/repo"])

        partial = get()
        partial["messages"][0]["total"] = "2"
        with self.assertRaisesRegex(supplemental.CoverageError, "did not cover"):
            list(supplemental.collect_preprints(lambda *_: partial, "biorxiv", DAY, DAY))
        replayed = get()
        replayed["messages"][0].update(total="2", count=2)
        replayed["collection"] = [row, dict(row)]
        self.assertEqual(len(list(supplemental.collect_preprints(lambda *_: replayed, "biorxiv", DAY, DAY))), 1)
        replayed["collection"][1]["title"] = "A contradictory title"
        with self.assertRaisesRegex(supplemental.CoverageError, "Conflicting observations"):
            list(supplemental.collect_preprints(lambda *_: replayed, "biorxiv", DAY, DAY))

    def test_exact_aliases_merge_observations_without_merging_the_journal_version(self):
        preprint = observation("biorxiv", "10.1101/a", "doi:10.1101/a", kind="preprint", version=1)
        revision = {**preprint, "version": 2, "published_as_doi": "10.1234/journal"}
        article = observation("pubmed", "123", "pmid:123", "doi:10.1234/journal", "pmcid:PMC777")
        baseline = [{"id": "doi:10.1234/journal", "doi": "10.1234/journal", "pmid": "123", "type": "article"}]
        groups = list(supplemental.reconcile([preprint, article, revision], baseline, set()))
        self.assertEqual(len(groups), 2)
        by_status = {row["status"]: row for row in groups}
        self.assertEqual(len(by_status["candidate"]["observations"]), 2)
        self.assertEqual(by_status["candidate"]["published_as_dois"], ["10.1234/journal"])
        self.assertEqual(by_status["existing"]["catalog_ids"], ["doi:10.1234/journal"])
        dispute = {**article, "identifiers": ["pmid:123", "doi:10.1234/wrong"]}
        self.assertEqual(next(supplemental.reconcile([dispute], baseline, set()))["status"], "identity_conflict")
        self.assertEqual(next(supplemental.reconcile([article], baseline, {"doi:10.1234/journal"}))["status"], "held")

    def test_github_code_link_requires_exact_paper_and_code_statement(self):
        xml = supplemental.parse_xml(b"""
          <article xmlns:xlink="http://www.w3.org/1999/xlink">
            <front><article-meta><article-id pub-id-type="pmcid">PMC777</article-id></article-meta></front>
            <body>
              <p>We used https://github.com/third-party/tools and its examples.</p>
              <sec><title>Code availability</title>
                <p><ext-link xlink:href="https://github.com/TheLab/Repo/tree/main">code</ext-link></p>
              </sec>
            </body>
            <back>
              <fn-group><fn><p><bold>Code availability</bold></p>
              <p>Available at github.com/AnotherLab/Repo.</p>
              </fn></fn-group>
            </back>
          </article>
        """)
        self.assertEqual(supplemental.jats_repositories(xml, "PMC777"),
                         ["https://github.com/anotherlab/repo", "https://github.com/thelab/repo"])
        with self.assertRaisesRegex(supplemental.CoverageError, "requested PMCID"):
            supplemental.jats_repositories(xml, "PMC888")

    def test_source_failure_does_not_advance_its_checkpoint_or_emit_partial_rows(self):
        def partial(*args):
            yield observation("medrxiv", "bad", "doi:10.1000/partial", kind="preprint")
            raise supplemental.CoverageError("missing page")

        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            output = state / "private-review"
            with patch.object(discovery, "MechanicalProjector"), patch.object(discovery, "affiliations", return_value=["wistar"]), \
                    patch.object(discovery, "collect_pubmed", return_value=[observation("pubmed", "123", "pmid:123")]), \
                    patch.object(discovery, "collect_preprints", side_effect=partial):
                summary = discovery.stage(state, output, DAY, DAY, [], set(), ["pubmed", "medrxiv"], checkpoints=True)
            self.assertEqual(summary["sources"]["medrxiv"]["status"], "failed")
            self.assertEqual(summary["works"], {"candidate": 1})
            self.assertTrue((state / "discovery-checkpoints/pubmed.json").is_file())
            self.assertFalse((state / "discovery-checkpoints/medrxiv.json").exists())
            review = json.loads((output / "review.json").read_text())
            self.assertEqual(review["works"][0]["identifiers"], ["pmid:123"])

    def test_first_failed_window_is_replayed_when_the_publication_cursor_moves(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            (state / "hold-ids.txt").touch()
            (state / "discovery-sources.json").write_text(json.dumps({"start": str(DAY), "review_sources": ["pubmed"]}))
            with patch.object(discovery, "MechanicalProjector"), \
                    patch.object(discovery, "collect_pubmed", side_effect=[supplemental.CoverageError("error"), []]) as fetch:
                discovery.run_scheduled(state, state, DAY, {}, set(), str(DAY))
                self.assertFalse((state / "discovery-checkpoints/pubmed.json").exists())
                discovery.run_scheduled(state, state, date(2026, 11, 25), {}, set(), "2026-11-26")
            self.assertEqual(fetch.call_args.args[-2:], (DAY, date(2026, 11, 25)))
            cursor = json.loads((state / "discovery-checkpoints/pubmed.json").read_text())
            self.assertEqual(cursor["through"], "2026-11-25")
            self.assertTrue(Path(cursor["review"]).is_file())
