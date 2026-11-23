import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from reuse import adjudicate, more_than_year_before
from s4_classify import classify_occurrence


class ReuseTest(unittest.TestCase):
    def test_gse103322_utilized_is_reuse(self):
        occurrence = {'sentence': 'We utilized GSE103322, a published dataset.',
                      'clause': 'We utilized GSE103322, a published dataset.',
                      'section': 'Methods', 'ctx': 'body', 'prefix': 'We utilized '}
        self.assertEqual(classify_occurrence({'repo': 'GEO', 'unit': 'geo'}, occurrence, None)[0], 'reused')

    def test_dates_and_accessions(self):
        cases = [('geo', 'GSE103322', '2017-11-30', '2024-02-01'),
                 ('assembly', 'GCA_003118495.1', '2018-04-04', '2023-01-01'),
                 ('bioproject', 'PRJNA178602', '2012-10-26', '2023-01-01'),
                 ('geo', 'GSE2018', '2018-01-01', '2023-01-01'),
                 ('pdb', '5J17', '2016-10-05', '2023-01-01')]
        for kind, acc, released, published in cases:
            with self.subTest(acc=acc):
                rows = [dict(paper='doi:10.1234/paper', unit_type=kind, unit=acc, decision='produced')]
                papers = {'doi:10.1234/paper': dict(doi='10.1234/paper', published=published)}
                cache = {(kind, acc): dict(ok=True, released=released)}
                out = adjudicate(rows, papers, lambda k, a: cache.get((k, a)))
                self.assertEqual(out[0]['decision'], 'reused')
                self.assertEqual(rows[0]['decision'], 'produced')

    def test_aliases_citations_and_multiple_claims(self):
        papers = {'doi:10.1234/a': dict(doi='10.1234/a', pmid='123', published='2023-01-01'),
                  'pmid:123': dict(doi='10.1234/a', pmid='123', published='2023-01-01'),
                  'doi:10.1234/b': dict(doi='10.1234/b', published='2023-01-01')}
        rows = [dict(paper=p, unit_type='pdb', unit='5J17', decision='produced') for p in papers]
        cache = dict(ok=True, released='2016-10-05', citations=[dict(pmid='123')])
        decisions = adjudicate(rows, papers, lambda k, a: cache)
        self.assertEqual([d['decision'] for d in decisions], ['produced', 'produced', 'reused'])
        self.assertTrue(all(d['multiple_papers'] for d in decisions))
        self.assertTrue(decisions[0]['citation_match'])
        self.assertFalse(decisions[2]['citation_match'])
        self.assertEqual(adjudicate(rows[:2], papers, lambda k,a: {})[0]['multiple_papers'], False)

    def test_boundary_and_no_invented_production(self):
        self.assertFalse(more_than_year_before('2020-02-29', '2021-02-28'))
        self.assertTrue(more_than_year_before('2020-02-29', '2021-03-01'))
        rows = [dict(paper='doi:10.1234/a', unit_type='geo', unit='GSE1', decision='reused')]
        self.assertEqual(adjudicate(rows, {}, lambda k,a: {'citations': [{'doi': '10.1234/a'}]})[0]['decision'], 'reused')

if __name__ == '__main__':
    unittest.main()
