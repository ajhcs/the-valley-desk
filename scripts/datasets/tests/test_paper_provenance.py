import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from paper_provenance import paper_provenance


class ProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.row = dict(paper='doi:example', unit_type='dbgap', unit='phs001539', exact='phs001539',
                        decision='produced', section='Methods > Data availability',
                        clause='Raw sequence data have been deposited at dbGaP (accession phs001539.v4.p1).')

    def relation(self, row=None, decisions=()):
        return paper_provenance([row or self.row], decisions)[0]['relation']

    def test_magnet_deposit_without_origin_is_linked(self):
        self.assertEqual(self.relation(), 'linked')

    def test_bioproject_article_deposition_is_produced(self):
        row = dict(self.row, unit_type='bioproject', unit='PRJNA123', exact='PRJNA123',
                   clause='The datasets presented in this study are deposited under accession PRJNA123.')
        self.assertEqual(self.relation(row), 'produced')
        reused = dict(row, clause='Previously published data were deposited under accession PRJNA123.')
        self.assertEqual(self.relation(reused), 'linked')

    def test_explicit_original_and_repository_citation(self):
        row = dict(self.row, clause='Data generated in this study are available as phs001539.')
        self.assertEqual(self.relation(row), 'produced')
        self.assertEqual(self.relation(decisions=[dict(paper='doi:example', unit_type='dbgap', unit='phs001539', citation_match=True)]), 'produced')

    def test_reuse_or_unrelated_context_does_not_establish_origin(self):
        row = dict(self.row, clause='Previously generated data from this study are phs001539.')
        self.assertEqual(self.relation(row), 'linked')
        row = dict(self.row, section='Introduction', clause='Data generated in this study are phs001539.')
        self.assertEqual(self.relation(row), 'linked')
        row = dict(self.row, clause='Data generated in this study are GSE123.')
        self.assertEqual(self.relation(row), 'linked')
        row = dict(self.row, clause='Data generated in this study are phs001539.')
        self.assertEqual(self.relation(row, [dict(paper='doi:example', unit_type='dbgap', unit='phs001539', decision='reused', citation_match=True)]), 'linked')


if __name__ == '__main__':
    unittest.main()
