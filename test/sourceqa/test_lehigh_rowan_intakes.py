import importlib.util
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('intake',ROOT/'scripts/sanitize-lehigh-rowan-intakes.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

class IntakeTest(unittest.TestCase):
 def test_receipts_replay_and_contract(self):
  for batch in m.SOURCES:
   with self.subTest(batch=batch):
    actual=m.render(batch); retained=m.BASE/batch
    self.assertEqual(actual['manifest.json'],(retained/'manifest.json').read_bytes())
    data=actual['source-assertions.json']; manifest=json.loads(actual['manifest.json'])
    self.assertEqual(manifest['outputs']['source-assertions.json'],{'sha256':m.digest(data),'bytes':len(data)})
    obj=json.loads(data); self.assertEqual(len(obj['records']),manifest['recordCount'])
    self.assertEqual(len({r['id'] for r in obj['records']}),len(obj['records']))
    for r in obj['records']:
     self.assertEqual(set(r),{'id','kind','url','nativeId','sourceRef','metadata','publicationAuthorized','reviewState'})
     self.assertIsNone(r['nativeId']); self.assertFalse(r['publicationAuthorized'])
     name=r['sourceRef'].split('#')[0]; self.assertLessEqual(set(r['metadata']),set(manifest['metadataPolicies'][name]))
     self.assertTrue(all(v is None or isinstance(v,str) for v in r['metadata'].values()))
     self.assertTrue(r['url'] is None or r['url'].startswith('https://'))
 def test_counts_and_qualifications(self):
  lehigh=json.loads(m.render('lehigh')['source-assertions.json']); rowan=json.loads(m.render('rowan')['source-assertions.json'])
  self.assertEqual(lehigh['coverage']['countsPerFile']['followup/member-account-repository-census.csv'],679)
  self.assertEqual(lehigh['coverage']['countsPerFile']['initial/github-links.csv'],62)
  self.assertEqual(rowan['coverage']['countsPerFile']['matched-repositories.csv'],99)
  self.assertEqual(rowan['coverage']['countsPerFile']['snapshots/first-pass-20261116/matched-repositories.csv'],61)
  self.assertIn('Tulane',' '.join(rowan['qualifications'])); self.assertIn('neighboring',' '.join(lehigh['qualifications']))
 def test_privacy(self):
  self.assertEqual(m.safe('contact person@example.com'),'contact [contact removed]')
  self.assertEqual(m.safe('https://example.org/?token=secret'),'[url removed]')
  self.assertEqual(m.safe('https://example.org/?q=plain#part'),'https://example.org/?q=plain#part')
 def test_output_rejects_existing_and_traversal(self):
  for dest in ['/workspace','/workspace/../tmp/invalid']:
   result=subprocess.run([sys.executable,str(ROOT/'scripts/sanitize-lehigh-rowan-intakes.py'),'--batch','rowan','--output',dest],capture_output=True)
   self.assertNotEqual(result.returncode,0)
if __name__=='__main__': unittest.main()
