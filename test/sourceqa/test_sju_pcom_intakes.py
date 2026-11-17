"""Local source QA: requires the original private source packages."""
import importlib.util, json, re, tempfile, unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('intake',ROOT/'scripts/sanitize-sju-pcom-intakes.py')
intake=importlib.util.module_from_spec(spec); spec.loader.exec_module(intake)

class SourceQA(unittest.TestCase):
 def test_replay_and_inventory(self):
  for batch,expected in [('sju',254),('pcom',853)]:
   actual=intake.render(batch); directory=intake.DEST/batch
   for name,data in actual.items(): self.assertEqual(data,(directory/name).read_bytes())
   manifest=json.loads(actual['manifest.json']); self.assertEqual(manifest['recordCount'],expected)
   self.assertEqual(manifest['inputs'],intake.inventory(batch))
   self.assertFalse(manifest['suppliedScriptsExecuted']); self.assertEqual(manifest['sourceRequests'],0)
 def test_provenance_and_policy(self):
  expected={'sju':{'accounts.csv':36,'repositories.csv':64,'labs-checked.csv':21,'link-checks.csv':133},'pcom':{'connected_account_repositories.csv':582,'connections.csv':30,'corpus_github_candidates.csv':22,'network_edges.csv':65,'people_screened.csv':125,'account_snapshot.json':29}}
  for batch in expected:
   files=intake.render(batch); data=json.loads(files['source-assertions.json']); m=json.loads(files['manifest.json'])
   self.assertEqual(data['coverage']['perFileRowCounts'],expected[batch]); self.assertEqual(len({r['id'] for r in data['records']}),len(data['records']))
   for r in data['records']:
    self.assertEqual(set(r),{'id','kind','url','nativeId','sourceRef','metadata','publicationAuthorized','reviewState'})
    self.assertTrue(r['id'].startswith(batch+':')); self.assertIsNone(r['nativeId']); self.assertFalse(r['publicationAuthorized']); self.assertEqual(r['reviewState'],'source_reported_unreviewed')
    filename=r['sourceRef'].split('#')[0]; self.assertEqual(set(r['metadata']),set(m['metadataPolicies'][filename])); self.assertIn(filename,m['inputs'])
    for value in r['metadata'].values(): self.assertTrue(value is None or isinstance(value,str))
    if r['url']: self.assertEqual(intake.primary(r['url']),r['url'])
   self.assertIn('geography',' '.join(data['qualifications']).lower()); self.assertFalse(data['publicationAuthorized'])
  self.assertIn('not all PCOM projects',' '.join(json.loads(intake.render('pcom')['source-assertions.json'])['qualifications']))
  people=[r for r in json.loads(intake.render('pcom')['source-assertions.json'])['records'] if r['sourceRef'].startswith('people_screened.csv#')]
  self.assertEqual(sum(r['metadata']['search_notes_truncated']=='true' for r in people),51)
  self.assertTrue(all(r['metadata']['search_notes_truncated'] in ('true','false') for r in people))
  self.assertTrue(all(len(r['metadata']['search_notes'] or '')==1000 for r in people if r['metadata']['search_notes_truncated']=='true'))
  row56=next(r for r in people if r['sourceRef']=='people_screened.csv#row=56')
  self.assertIn('id=10.1371/journal.pone.0300252',row56['metadata']['sourceCitationUrls'])
 def test_private_data_and_unsafe_urls(self):
  self.assertIsNone(intake.primary('https://example.org/a?token=abc'))
  self.assertIsNone(intake.primary('https://user:pass@example.org/'))
  self.assertEqual(intake.primary('https://example.org/a?id=123#section'), 'https://example.org/a?id=123#section')
  for batch in ('sju','pcom'):
   for r in json.loads(intake.render(batch)['source-assertions.json'])['records']:
    for value in [r['url'],*r['metadata'].values()]:
     if value:
      self.assertIsNone(intake.mod.EMAIL.search(value)); self.assertIsNone(intake.mod.PHONE.search(value))
      self.assertIsNone(re.search(r'(?i)(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*\S+',value))
 def test_output_guard(self):
  with self.assertRaises(ValueError): intake.output_guard('/workspace/../tmp/escape')
  with self.assertRaises(ValueError): intake.output_guard(str(intake.SOURCES['sju']/'new'))
  with tempfile.TemporaryDirectory(dir=ROOT) as d:
   path=Path(d); (path/'link').symlink_to(path,target_is_directory=True)
   with self.assertRaises(ValueError): intake.output_guard(path/'link'/'new')
   with self.assertRaises(ValueError): intake.output_guard(path)
if __name__=='__main__': unittest.main()
