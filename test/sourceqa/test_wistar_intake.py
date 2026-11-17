"""Source-dependent, offline checks for the private Wistar intake."""
import csv
import hashlib
import importlib.util
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'scripts/sanitize-wistar-intake.py'
spec = importlib.util.spec_from_file_location('wistar_intake', SCRIPT)
intake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(intake)

class WistarIntakeTests(unittest.TestCase):
 def test_replay_and_source_integrity(self):
  before = {name: hashlib.sha256((intake.SOURCE / name).read_bytes()).hexdigest() for name in intake.FILES}
  files = intake.render()
  after = {name: hashlib.sha256((intake.SOURCE / name).read_bytes()).hexdigest() for name in intake.FILES}
  self.assertEqual(before, after)
  manifest = json.loads(files['manifest.json'])
  for name, digest in before.items():
   self.assertEqual(manifest['inputs'][name], {'sha256': digest, 'bytes': (intake.SOURCE / name).stat().st_size})
  self.assertEqual(manifest['outputs']['source-assertions.json'], {'sha256': hashlib.sha256(files['source-assertions.json']).hexdigest(), 'bytes': len(files['source-assertions.json'])})
  self.assertEqual(manifest['recordCount'], 91)
  self.assertEqual(manifest['sourceRequests'], 0)
  self.assertFalse(manifest['suppliedScriptsExecuted'])
  subprocess.run([sys.executable, str(SCRIPT), '--check'], check=True, capture_output=True)

 def test_rows_and_qualifications(self):
  output = json.loads(intake.render()['source-assertions.json'])
  self.assertEqual(output['coverage']['perFileRowCounts'], {'github-accounts.csv': 28, 'labs-and-people.csv': 43, 'organization-repositories.csv': 20})
  self.assertEqual(len(output['records']), 91)
  self.assertFalse(output['publicationAuthorized'])
  self.assertEqual(output['visibility'], 'private')
  q = ' '.join(output['qualifications'])
  for term in ('33 entries', 'not all owned', 'governance', 'pre-Wistar', 'historical', 'worksite', 'RNAPolymerase12', 'jmalnak', 'Yeqing95', 'Schiffner'):
   self.assertIn(term, q)
  for filename, (kind, _, fields) in intake.TABLES.items():
   records = [r for r in output['records'] if r['sourceRef'].startswith(filename + '#')]
   with (intake.SOURCE / filename).open(newline='', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    self.assertEqual(reader.fieldnames, fields)
    for record in records:
     line = reader.line_num + 1
     row = next(reader)
     self.assertEqual(record['sourceRef'], f'{filename}#row={line}')
     self.assertEqual(record['id'], f'wistar:{filename}:row={line}')
     self.assertEqual(record['kind'], kind)
     self.assertIsNone(record['nativeId'])
     self.assertFalse(record['publicationAuthorized'])
     self.assertEqual(record['reviewState'], 'source_reported_unreviewed')
     self.assertEqual(set(record['metadata']), set(fields + ['sourceUrls', 'proseTruncated']))
     for field in fields: self.assertEqual(record['metadata'][field], intake.drexel.safe(row[field]))
     for url in json.loads(record['metadata']['sourceUrls']):
      self.assertTrue(any(url in value for value in row.values()))
      self.assertEqual(intake.safe_url(url), url)
    self.assertEqual(list(reader), [])

 def test_url_and_output_boundaries(self):
  url = 'https://example.org/item?record=Ab%2F12#section=Hi%20There'
  self.assertEqual(intake.extract_urls(['x' * 1100 + ' ' + url]), [url])
  self.assertEqual(intake.safe_url(url), url)
  for url in ('http://example.org/a', 'https://user:pass@example.org/', 'https://example.org/?token=abc', 'https://example.org/a?email=a%40b.com'):
   self.assertIsNone(intake.safe_url(url))
  for path in (Path('/tmp/out'), intake.SOURCE / 'new', intake.SOURCE.parent, Path('/workspace/a/../b'), intake.RETAINED):
   with self.assertRaises(ValueError): intake.output_path(path)

if __name__ == '__main__': unittest.main()
