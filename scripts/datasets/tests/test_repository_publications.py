import sys
import unittest
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from s5_repos import bioproject_publications, sra_publications, ena_public_dates


class PublicationMetadataTest(unittest.TestCase):
    def test_ena_public_dates_match_exact_accessions_and_keep_existing(self):
        records = {'PRJNA1': {'ok': True, 'registered': '2019-01-01'},
                   'PRJNA2': {'ok': True, 'released': '2020-01-01'}}
        def read(kind, acc): return records.get(acc)
        def save(kind, acc, rec): records[acc] = rec
        with patch('s5_repos.cached', side_effect=read), patch('s5_repos.store', side_effect=save), \
             patch('s5_repos.http', return_value=(200, b'[{"study_accession":"PRJNA1","first_public":"2022-04-05"},{"study_accession":"PRJNA99","first_public":"2000-01-01"}]')):
            ena_public_dates('bioproject', ['PRJNA1', 'PRJNA2'])
        self.assertEqual(records['PRJNA1']['released'], '2022-04-05')
        self.assertEqual(records['PRJNA1']['release_source'], 'ENA Portal API first_public')
        self.assertEqual(records['PRJNA2']['released'], '2020-01-01')
        self.assertNotIn('PRJNA99', records)

    def test_bioproject_only_explicit_pubmed_publication(self):
        xml = b'''<RecordSet><DocumentSummary><Project><ProjectID><ArchiveID accession="PRJNA1"/></ProjectID><ProjectDescr><Publication id="123"><DbType>ePubmed</DbType></Publication><Publication id="456"><DbType>Other</DbType></Publication></ProjectDescr></Project></DocumentSummary><DocumentSummary><Project><ProjectID><ArchiveID accession="PRJNA2"/></ProjectID><ProjectDescr/></Project></DocumentSummary></RecordSet>'''
        self.assertEqual(bioproject_publications(xml), {'PRJNA1': [{'pmid': '123'}], 'PRJNA2': []})
        with self.assertRaises(ValueError): bioproject_publications(b'<error/>')

    def test_sra_only_study_links_and_package_accessions(self):
        xml = b'''<EXPERIMENT_PACKAGE_SET><EXPERIMENT_PACKAGE><STUDY accession="SRP1"><STUDY_LINKS><STUDY_LINK><XREF_LINK><DB>pubmed</DB><ID>123</ID></XREF_LINK></STUDY_LINK></STUDY_LINKS></STUDY><EXPERIMENT accession="SRX1"/><SAMPLE accession="SRS1"><IDENTIFIERS><EXTERNAL_ID namespace="BioSample">SAMN1</EXTERNAL_ID></IDENTIFIERS><SAMPLE_LINKS><SAMPLE_LINK><XREF_LINK><DB>pubmed</DB><ID>999</ID></XREF_LINK></SAMPLE_LINK></SAMPLE_LINKS></SAMPLE><RUN_SET><RUN accession="SRR1"/></RUN_SET></EXPERIMENT_PACKAGE></EXPERIMENT_PACKAGE_SET>'''
        expected = {x: [{'pmid': '123'}] for x in ('SRP1', 'SRX1', 'SAMN1', 'SRR1')}
        self.assertEqual(sra_publications(xml, list(expected) + ['SRR2']), expected)
        with self.assertRaises(ValueError): sra_publications(b'<error/>', [])

if __name__ == '__main__': unittest.main()
