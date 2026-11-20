import unittest

from collect import add_observation, deduplicate, openalex_rows, europepmc_rows


class FixtureSource:
    def __init__(self, pages):
        self.pages = iter(pages)

    def query(self, *args, **kwargs):
        return next(self.pages)


class CollectionTest(unittest.TestCase):
    def test_deduplicates_cross_source_transitive_ids(self):
        observations = {}
        add_observation(observations, 'europepmc', {'source': 'MED', 'id': '123'}, ['local'])
        add_observation(observations, 'openalex', {
            'id': 'https://openalex.org/W1', 'doi': 'https://doi.org/10.1234/TEST',
            'ids': {'pmid': 'https://pubmed.ncbi.nlm.nih.gov/123'},
        }, ['neighbor'])
        add_observation(observations, 'europepmc', {
            'source': 'PMC', 'id': 'PMC123', 'doi': '10.1234/test',
        }, ['other'])
        records = list(deduplicate(observations))
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['id'], 'doi:10.1234/test')
        self.assertEqual(records[0]['institutions'], ['local', 'neighbor', 'other'])
        self.assertEqual(len(records[0]['observations']), 3)

    def test_preprint_and_journal_with_distinct_dois_are_not_collapsed(self):
        observations = {}
        add_observation(observations, 'europepmc', {
            'source': 'PPR', 'id': 'PPR123', 'doi': '10.1234/preprint',
        }, ['local'])
        add_observation(observations, 'europepmc', {
            'source': 'MED', 'id': '123', 'doi': '10.1234/journal',
        }, ['local'])
        self.assertEqual(len(list(deduplicate(observations))), 2)

    def test_openalex_incomplete_result_is_an_error(self):
        pages = [{'meta': {'count': 2}, 'results': [{'id': 'W1'}]},
                 {'meta': {'count': 2}, 'results': []}]
        with self.assertRaisesRegex(RuntimeError, 'ended before'):
            list(openalex_rows(FixtureSource(pages), 'filter'))

    def test_europe_pmc_stalled_cursor_is_an_error(self):
        pages = [{'hitCount': 2, 'resultList': {'result': [{'source': 'MED', 'id': '1'}]},
                  'nextCursorMark': '*'}]
        with self.assertRaisesRegex(RuntimeError, 'cursor stopped'):
            list(europepmc_rows(FixtureSource(pages), 'query'))


    def test_europe_pmc_repeats_key_without_losing_next_cursor(self):
        first = {'source': 'MED', 'id': '123'}
        second = {'source': 'PMC', 'id': '123'}
        third = {'source': 'MED', 'id': '456'}
        pages = [
            {'hitCount': 3, 'resultList': {'result': [first]}, 'nextCursorMark': 'next'},
            {'hitCount': 3, 'resultList': {'result': [first, second]}, 'nextCursorMark': 'last'},
            {'hitCount': 3, 'resultList': {'result': [third]}},
        ]
        self.assertEqual(list(europepmc_rows(FixtureSource(pages), 'query')), [first, second, third])
