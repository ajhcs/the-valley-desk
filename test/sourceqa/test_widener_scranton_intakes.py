"""Source-dependent checks for the private offline intake snapshots."""
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT/'scripts/sanitize-widener-scranton-intakes.py'
spec = importlib.util.spec_from_file_location('regional_intakes', SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class IntakeTest(unittest.TestCase):
 def test_replay_schema_sources_and_counts(self):
  for batch, counts in [('widener',{'repositories.csv':14}),('scranton',{'repositories.csv':41,'labs-and-people.csv':38,'research-trails.csv':16})]:
   rendered=mod.render(batch)
   for name, data in rendered.items(): self.assertEqual(data,(mod.RETAINED/batch/name).read_bytes())
   payload=json.loads(rendered['source-assertions.json']); manifest=json.loads(rendered['manifest.json'])
   self.assertEqual(payload['coverage']['fileRowCounts'],counts)
   self.assertEqual(manifest['recordCount'],len(payload['records']))
   self.assertEqual(manifest['outputs']['source-assertions.json']['sha256'],mod.sha(rendered['source-assertions.json']))
   self.assertEqual(manifest['outputs']['source-assertions.json']['bytes'],len(rendered['source-assertions.json']))
   self.assertEqual(set(manifest['metadataPolicies']),set(manifest['inputs']))
   seen=set()
   for record in payload['records']:
    self.assertEqual(set(record),{'id','kind','url','nativeId','sourceRef','metadata','publicationAuthorized','reviewState'})
    self.assertNotIn(record['id'],seen); seen.add(record['id'])
    self.assertIsNone(record['nativeId']); self.assertFalse(record['publicationAuthorized'])
    source, pointer=record['sourceRef'].split('#'); path=mod.WORK/mod.CONFIG[batch]['directory']/source
    lines=path.read_text().splitlines()
    line=int(pointer.split('=')[1]) if pointer.startswith('row=') else int(pointer[1:])
    self.assertTrue(1 <= line <= len(lines))
    self.assertTrue(set(record['metadata']).issubset(manifest['metadataPolicies'][source]))
    for value in record['metadata'].values(): self.assertTrue(value is None or isinstance(value,str))
    if record['url']: self.assertTrue(record['url'].startswith('https://'))
   text=rendered['source-assertions.json'].decode()
   self.assertIsNone(re.search(r'\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b',text))
   self.assertFalse(manifest['suppliedScriptsExecuted']); self.assertEqual(manifest['sourceRequests'],0)
 def test_critical_reported_qualifications(self):
  w=mod.render('widener')['source-assertions.json'].decode(); s=mod.render('scranton')['source-assertions.json'].decode()
  for phrase in ['DanielvdSpoel','ownership unconfirmed','Six Java files','no wheelchair-control','crdandre','present address']:
   self.assertIn(phrase,w)
  for phrase in ['Outside nine-county DVRPC','automated safety restriction','OSF access failed','poster image','Empty when checked','not automatically health technology','not an absence claim']:
   self.assertIn(phrase,s)
 def test_url_sanitizing(self):
  self.assertEqual(mod.url_value('https://example.org/a?version=12#part')[0],'https://example.org/a?version=12#part')
  for value in ['https://user:pass@example.org/','https://example.org/?token=secret','https://example.org/a?email=person%40example.org','http://example.org/']:
   self.assertIsNone(mod.url_value(value)[0])
 def test_source_checksum_guard_and_output_guards(self):
  with patch.dict(mod.CONFIG['widener']['hashes'],{'README.md':'0'*64}):
   with self.assertRaisesRegex(ValueError,'checksum mismatch'): mod.render('widener')
  with tempfile.TemporaryDirectory(dir=ROOT) as temp:
   p=Path(temp)
   with self.assertRaises(ValueError): mod.output_path(p)
   (p/'link').symlink_to(p,target_is_directory=True)
   with self.assertRaises(ValueError): mod.output_path(p/'link'/'new')
   with self.assertRaises(ValueError): mod.output_path(p/'x'/'..'/'new')
 def test_cli_default(self):
  result=subprocess.run([sys.executable,str(SCRIPT)],capture_output=True,text=True,check=True)
  self.assertIn('byte-exact replay',result.stdout)

if __name__=='__main__': unittest.main()
