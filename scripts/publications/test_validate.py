import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from validate import validate_records


def publication(suffix, **changes):
    doi = f'10.99999/{suffix}'
    row = {
        'id': f'doi:{doi}', 'title': 'A synthetic publication', 'type': 'article',
        'published': '2025-10', 'venue': None, 'doi': doi, 'pmid': None,
        'pmcid': None, 'arxiv': None, 'url': 'https://doi.org/' + doi,
        'authors': [{'name': 'Example Author', 'orcid': None, 'regional': True}],
        'author_count': 1, 'institutions': ['chop'], 'counties': ['Philadelphia'],
        'topic': 'Clinical care', 'terms': [], 'label': 'Verified',
        'connection': 'An author affiliation on the publisher record names CHOP in Philadelphia.',
        'source': 'https://example.org/publication', 'open_access': None, 'projects': [],
        'preprint_of': None, 'published_as': None, 'retracted': False,
        'added': '2026-11-20', 'checked': '2026-11-20',
    }
    return row | changes


class PublicationValidationTest(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.pilot = root / 'pilot.jsonl'
        self.backfill = root / '2025.jsonl'

    def write(self, path, *rows):
        path.write_text(''.join(json.dumps(row) + '\n' for row in rows), encoding='utf-8')

    def test_default_backfill_is_optional_and_cross_file_pairs_resolve(self):
        article = publication('journal')
        self.write(self.pilot, article)
        with patch('validate.DATASET', self.pilot), patch('validate.BACKFILL_DATASET', self.backfill):
            self.assertEqual(validate_records(), 1)
            preprint = publication('first', type='preprint', published_as=article['id'])
            self.write(self.backfill, preprint)
            self.assertEqual(validate_records(), 2)
            self.assertEqual(validate_records(self.pilot), 1)
            self.assertEqual(validate_records(self.backfill, self.pilot), 2)

    def test_rejects_duplicate_publication_ids_across_files(self):
        row = publication('same')
        self.write(self.pilot, row)
        self.write(self.backfill, row)
        with self.assertRaisesRegex(ValueError, 'duplicate publication ID'):
            validate_records(self.pilot, self.backfill)

    def test_rejects_duplicate_alternate_identifier_across_files(self):
        self.write(self.pilot, publication('one', pmid='99990001'))
        self.write(self.backfill, publication('two', pmid='99990001'))
        with self.assertRaisesRegex(ValueError, 'identifier shared by different records'):
            validate_records(self.pilot, self.backfill)

    def test_rejects_missing_and_wrong_direction_version_links(self):
        article = publication('one')
        preprint = publication('two', type='preprint', published_as=article['id'])
        self.write(self.backfill, preprint)
        with self.assertRaisesRegex(ValueError, 'published_as must refer to an existing journal version'):
            validate_records(self.backfill)
        self.write(self.pilot, article | {'published_as': preprint['id']})
        with self.assertRaisesRegex(ValueError, 'published_as belongs on the preprint'):
            validate_records(self.pilot, self.backfill)

    def test_rejects_counties_on_listed_rows(self):
        self.write(self.backfill, publication('one', label='Listed'))
        with self.assertRaisesRegex(ValueError, 'Listed records must have empty counties'):
            validate_records(self.backfill)

    def test_rejects_conflicting_version_links_across_files(self):
        first = publication('first')
        preprint = publication('preprint', type='preprint', published_as=first['id'])
        second = publication('second', preprint_of=preprint['id'])
        self.write(self.pilot, first, second)
        self.write(self.backfill, preprint)
        with self.assertRaisesRegex(ValueError, 'conflicting journal version links'):
            validate_records(self.pilot, self.backfill)

    def test_rejects_two_preprints_pointing_to_the_same_journal(self):
        journal = publication('journal')
        first = publication('preprint-a', type='preprint', published_as=journal['id'])
        second = publication('preprint-b', type='preprint', published_as=journal['id'])
        self.write(self.pilot, journal, first)
        self.write(self.backfill, second)
        with self.assertRaisesRegex(ValueError, 'conflicting preprint version links'):
            validate_records(self.pilot, self.backfill)
