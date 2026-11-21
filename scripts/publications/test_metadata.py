import unittest

from metadata import crossref_authors, crossref_venue, earliest_date, epmc_dates, normalized_date
from project import open_access, plain, publisher_open_access


class PublicationMetadataTest(unittest.TestCase):
    def test_month_only_issue_is_not_a_synthesized_day(self):
        record = {'firstPublicationDate': '2026-10-01',
                  'journalInfo': {'dateOfPublication': '2026 Oct'}}
        self.assertEqual(set(epmc_dates(record)), {'2026-10'})

    def test_earlier_online_date_keeps_original_precision(self):
        observations = [
            {'provider': 'europepmc', 'record': {'firstPublicationDate': '2026-10-12'}},
            {'provider': 'crossref', 'record': {'published-online': {'date-parts': [[2026, 5]]}}},
        ]
        self.assertEqual(earliest_date(observations), '2026-05')

    def test_earliest_explicit_online_date_wins_across_sources(self):
        observations = [
            {'provider': 'europepmc', 'record': {
                'electronicPublicationDate': '2026-04-12',
                'firstPublicationDate': '2026-01-01',
                'journalInfo': {'dateOfPublication': '2026 Jan'}}},
            {'provider': 'crossref', 'record': {
                'published-online': {'date-parts': [[2026, 3, 17]]},
                'published-print': {'date-parts': [[2026, 2, 3]]}}},
            {'provider': 'publication-date', 'record': {
                'published': '2026-01-01', 'publisher_confirmed_conflict': True}},
        ]
        self.assertEqual(earliest_date(iter(observations)), '2026-03-17')

    def test_online_precision_comes_from_online_evidence(self):
        observations = [
            {'provider': 'crossref', 'record': {
                'published-online': {'date-parts': [[2026, 3]]},
                'published-print': {'date-parts': [[2026, 3, 2]]}}},
        ]
        self.assertEqual(earliest_date(observations), '2026-03')
        observations[0]['record']['assertion'] = [
            {'name': 'published_online', 'label': 'Published online', 'value': '2026-03-07'},
        ]
        self.assertEqual(earliest_date(observations), '2026-03-07')

    def test_issue_date_keeps_stated_day_without_online_evidence(self):
        observations = [{'provider': 'europepmc', 'record': {
            'journalInfo': {'dateOfPublication': '2026 Mar 7'},
        }}]
        self.assertEqual(earliest_date(observations), '2026-03-07')

    def test_issue_range_does_not_invent_october_date(self):
        observations = [
            {'provider': 'europepmc', 'record': {'firstPublicationDate': '2026-10-01',
                                                'journalInfo': {'dateOfPublication': '2026 Oct-Dec'}}},
            {'provider': 'publication-date', 'record': {'published': '2026-11-06'}},
        ]
        self.assertEqual(earliest_date(observations), '2026-11-06')
        self.assertIsNone(normalized_date([2026, 2, 30]))

    def test_book_fallback_preserves_year_only_precision(self):
        observations = [{'provider': 'europepmc', 'record': {
            'firstPublicationDate': '2024-01-01',
            'bookOrReportDetails': {'yearOfPublication': 2024},
        }}]
        self.assertEqual(earliest_date(observations), '2024')

    def test_display_title_removes_encoded_markup(self):
        self.assertEqual(plain('A &lt;i&gt;species&lt;/i&gt; effect at p < 0.1'),
                         'A species effect at p < 0.1')

    def test_annual_cover_date_cannot_precede_receipt(self):
        record = {'published-print': {'date-parts': [[2026, 1, 1]]},
                  'issued': {'date-parts': [[2026, 1]]},
                  'published-online': {'date-parts': [[2026, 10, 17]]},
                  'assertion': [{'name': 'received', 'value': '2026-05-07'},
                                {'name': 'published', 'value': '2026-10-17'}]}
        self.assertEqual(earliest_date([{'provider': 'crossref', 'record': record}]), '2026-10-17')

    def test_publisher_metadata_preserves_suffix_and_preprint_server(self):
        record = {'author': [{'given': 'Author', 'family': 'Example', 'suffix': 'Jr.'}],
                  'type': 'posted-content',
                  'resource': {'primary': {'URL': 'https://chemrxiv.org/doi/example'}}}
        self.assertEqual(crossref_authors(record)[0]['name'], 'Author Example Jr.')
        self.assertEqual(crossref_venue(record), 'ChemRxiv')

    def test_publisher_place_remains_attached_to_its_affiliation(self):
        record = {'author': [{'given': 'Author', 'family': 'Example',
                              'affiliation': [{'name': 'First institution', 'place': ['First city']},
                                              {'name': 'Second institution', 'place': ['Second city']}]}]}
        author, = crossref_authors(record)
        self.assertEqual(author['affiliation_places'], [
            ('First institution', 'First city'), ('Second institution', 'Second city'),
        ])

    def test_annual_volume_issue_one_can_be_a_cover_placeholder(self):
        record = {'volume': '2026', 'journal-issue': {'issue': '1'},
                  'published-print': {'date-parts': [[2026, 1]]},
                  'issued': {'date-parts': [[2026, 1]]},
                  'published-online': {'date-parts': [[2026, 10, 1]]}}
        self.assertEqual(earliest_date([{'provider': 'crossref', 'record': record}]), '2026-10-01')

    def test_ahead_of_print_uses_article_date_over_unassigned_issue_date(self):
        observations = [
            {'provider': 'europepmc', 'record': {'publicationStatus': 'aheadofprint',
                'electronicPublicationDate': '2026-10-16',
                'journalInfo': {'dateOfPublication': '2026 Oct', 'printPublicationDate': '2026-10-01'}}},
            {'provider': 'crossref', 'record': {'published-print': {'date-parts': [[2026, 10, 1]]}}},
        ]
        self.assertEqual(earliest_date(observations), '2026-10-16')

    def test_registration_date_does_not_override_explicit_online_publication(self):
        record = {'published-online': {'date-parts': [[2026, 10, 23]]},
                  'issued': {'date-parts': [[2026, 10, 7]]},
                  'created': {'date-parts': [[2026, 10, 7]]}}
        self.assertEqual(earliest_date([{'provider': 'crossref', 'record': record}]), '2026-10-23')

    def test_open_access_uses_effective_version_of_record_license(self):
        license = {'URL': 'https://creativecommons.org/licenses/by/4.0/',
                   'start': {'date-parts': [[2026, 11, 10]]}}
        record = {'license': [dict(license, **{'content-version': 'tdm'}),
                              dict(license, **{'content-version': 'vor'})]}
        self.assertIsNone(publisher_open_access(record, '2026-11-09'))
        self.assertEqual(publisher_open_access(record, '2026-11-11')['status'], 'open')

    def test_free_full_text_link_does_not_invent_open_license(self):
        link = {'availabilityCode': 'F', 'documentStyle': 'html',
                'url': 'https://europepmc.org/articles/PMC123'}
        record = {'isOpenAccess': 'N', 'fullTextUrlList': {'fullTextUrl': [link]}}
        self.assertEqual(open_access(record), {'status': 'free to read', 'license': None,
                                              'url': link['url']})
        record['authMan'] = 'Y'
        link['site'] = 'Europe_PMC'
        self.assertEqual(open_access(record)['status'], 'accepted manuscript')
