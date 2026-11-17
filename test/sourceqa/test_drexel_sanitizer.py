"""Offline Drexel intake regression and source preservation probes."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('drexel_intake',ROOT/'scripts/sanitize-drexel-intake.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

def call(*args):
 with patch.object(sys,'argv',[str(m.__file__),*map(str,args)]),contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()): m.main()

def snapshot():
 return {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in m.SOURCE.iterdir() if p.is_file() and not p.is_symlink()}

class DrexelQA(unittest.TestCase):
 def test_replay_and_guards(self):
  before=snapshot(); call(); call('--check')
  with self.assertRaises(SystemExit): call('--output','/tmp/not-allowed')
  with self.assertRaises(SystemExit): call('--output',m.RETAINED)
  with tempfile.TemporaryDirectory(prefix='drexel-qa-',dir='/workspace/worktrees/builderbob/thevalleydesk/work') as tmp:
   out=Path(tmp)/'new'; call('--output',out)
   with self.assertRaises(SystemExit): call('--output',out)
   raw=(m.SOURCE/'SHA256SUMS.json').read_bytes(); actual=Path.read_bytes
   def corrupted(p):
    if p == m.SOURCE/'SHA256SUMS.json':
     obj=json.loads(raw); obj['files']['README.md']='0'*64; return json.dumps(obj).encode()
    return actual(p)
   with patch.object(Path,'read_bytes',corrupted):
    with self.assertRaises(ValueError): call('--output',Path(tmp)/'bad')
   self.assertFalse((Path(tmp)/'bad').exists())
   def traversal(p):
    if p == m.SOURCE/'SHA256SUMS.json':
     obj=json.loads(raw); obj['files']['../escape']='0'*64; return json.dumps(obj).encode()
    return actual(p)
   with patch.object(Path,'read_bytes',traversal):
    with self.assertRaises(ValueError): call('--output',Path(tmp)/'escape')
  self.assertEqual(before,snapshot())
 def test_url_identifiers_and_secrets(self):
  urls=['https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1006721#sec001', 'https://example.org/proj/?__route=%2Fdownload&cat=advbcomp&details=1&id=270&ticket=&type=report']
  for url in urls: self.assertEqual(m.safe(url),url)
  for url in ['https://user:password@example.org/p', 'https://example.org/p?token=secret', 'https://example.org/p?ticket=secret', 'https://example.org/p#access_token=secret', 'https://example.org/p?email=person%40example.org', 'https://example.org/?id=1;token=SECRET', 'https://example.org/?signature=SECRET', 'https://example.org/?X-Amz-Signature=SECRET', 'https://example.org/?api%255Fkey=SECRET', 'https://example.org/?key=SECRET']:
   self.assertEqual(m.safe(url),'[url removed]')
  records=json.loads((m.RETAINED/'source-assertions.json').read_bytes())['projects']
  self.assertTrue(any('article?id=10.1371/journal.pcbi.1006721' in str(r) for r in records))
  self.assertTrue(any('__route=%2Fdownload&cat=advbcomp&details=1&id=270&ticket=&type=report' in str(r) for r in records))
 def test_output_receipt_and_privacy(self):
  manifest=json.loads((m.RETAINED/'manifest.json').read_bytes()); payload=(m.RETAINED/'source-assertions.json').read_bytes()
  self.assertEqual(manifest['files']['source-assertions.json'],{'sha256':hashlib.sha256(payload).hexdigest(),'bytes':len(payload)})
  self.assertEqual(manifest['sourceFileCount'],274)
  obj=json.loads(payload); self.assertEqual(len(obj['statuses']),2197); self.assertEqual(len(obj['projects']),336)
  forbidden={'abstract','articlebody','body','email','contactemail','phone','signedcommitemail','review_record'}
  def visit(v):
   if isinstance(v,dict):
    for k,x in v.items():
     self.assertNotIn(k.lower().replace('_',''),forbidden)
     if k=='publicationAuthorized': self.assertIs(x,False)
     visit(x)
   elif isinstance(v,list):
    for x in v: visit(x)
   elif isinstance(v,str): self.assertNotRegex(v,r'\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|(?<!\w)(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\w)')
  visit(obj)
if __name__=='__main__': unittest.main()
