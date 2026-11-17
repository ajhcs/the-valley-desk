import csv
import hashlib
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'scripts/sanitize-incubator-intake.py'
spec = importlib.util.spec_from_file_location('incubator_intake', SCRIPT)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class IncubatorIntakeTest(unittest.TestCase):
 def test_replay_and_source_bytes(self):
  before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in m.SOURCE.iterdir()}
  output=m.render()
  self.assertEqual(output['source-assertions.json'],(m.RETAINED/'source-assertions.json').read_bytes())
  self.assertEqual(output['manifest.json'],(m.RETAINED/'manifest.json').read_bytes())
  self.assertEqual(before,{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in m.SOURCE.iterdir()})
  manifest=json.loads(output['manifest.json'])
  self.assertEqual(before,{k:v['sha256'] for k,v in manifest['inputs'].items()})
  self.assertEqual(manifest['sourceRequests'],0)
  self.assertFalse(manifest['suppliedScriptsExecuted'])

 def test_lineage_and_tamper(self):
  m.verify_lineage()
  # A changed observation identifier in an otherwise valid export must fail.
  original=m.rows
  def changed(name):
   for line,row in original(name):
    if name=='unreviewed-account-leads.csv' and line==2:
     row['observation_ids']='invented'
    yield line,row
  try:
   m.rows=changed
   with self.assertRaisesRegex(ValueError,'membership mismatch'): m.verify_lineage()
  finally: m.rows=original

 def test_schema_and_semantics(self):
  x=json.loads((m.RETAINED/'source-assertions.json').read_bytes())
  self.assertEqual(set(x),{'schemaVersion','batch','visibility','publicationAuthorized','sourceThreadId','records','coverage','qualifications'})
  self.assertEqual(len(x['records']),309)
  self.assertEqual(len({r['id'] for r in x['records']}),309)
  for r in x['records']:
   self.assertEqual(set(r),{'id','kind','url','nativeId','sourceRef','metadata','publicationAuthorized','reviewState'})
   self.assertEqual(r['id'],'incubators:'+r['sourceRef'].replace('#',':',1))
   self.assertIsNone(r['nativeId']); self.assertFalse(r['publicationAuthorized'])
   self.assertEqual(r['reviewState'],'source_reported_unreviewed')
   self.assertTrue(all(v is None or isinstance(v,str) for v in r['metadata'].values()))
   self.assertNotEqual(r['kind'],'repository')
  coverage=[r for r in x['records'] if r['sourceRef'].startswith('unreviewed-')]
  self.assertEqual(len(coverage),3)
  self.assertTrue(all('does not constitute fresh coverage' in r['metadata']['lineage'] for r in coverage))
  self.assertEqual(sum(r['kind']=='project' for r in x['records']),18)
  self.assertEqual(sum(r['kind']=='account' for r in x['records']),73)

 def test_url_privacy_and_exact_identifiers(self):
  self.assertEqual(m.url('https://example.org/path?record=123#item=abc'), 'https://example.org/path?record=123#item=abc')
  self.assertEqual(m.url('https://example.org/'+('a'*1200)+'?id=1'), 'https://example.org/'+('a'*1200)+'?id=1')
  for value in ['https://user:pass@example.org/a','https://example.org/?token=secret','https://example.org/?q=cole@example.org','http://example.org']:
   self.assertIsNone(m.url(value))
  self.assertNotIn('person@example.org',m.safe('person@example.org'))

 def test_output_guards(self):
  with tempfile.TemporaryDirectory(dir='/workspace/build/builderbob') as tmp:
   target=Path(tmp)/'link'; target.symlink_to(m.SOURCE,target_is_directory=True)
   for path in (Path(tmp),target/'out',m.SOURCE/'out',Path(tmp)/'..'/'out'):
    r=subprocess.run(['python3',str(SCRIPT),'--output',str(path)],capture_output=True)
    self.assertNotEqual(r.returncode,0,str(path))

if __name__=='__main__': unittest.main()
