import csv, importlib.util, json, subprocess, sys, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('public_health',ROOT/'scripts/sanitize-public-health-intake.py'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
class PublicHealthIntakeTest(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.files=m.render(); cls.data=json.loads(cls.files['source-assertions.json']); cls.manifest=json.loads(cls.files['manifest.json'])
 def test_receipt_contract_and_replay(self):
  self.assertEqual(set(self.data),{'schemaVersion','batch','visibility','publicationAuthorized','sourceThreadId','records','coverage','qualifications'})
  for n,b in self.files.items(): self.assertEqual(b,(m.RETAINED/n).read_bytes())
  self.assertEqual(self.manifest['outputs']['source-assertions.json'],{'sha256':m.digest(self.files['source-assertions.json']),'bytes':len(self.files['source-assertions.json'])})
  self.assertEqual(len(self.data['records']),self.manifest['recordCount']); self.assertEqual(len({r['id'] for r in self.data['records']}),self.manifest['recordCount'])
  for r in self.data['records']:
   self.assertEqual(set(r),{'id','kind','url','nativeId','sourceRef','metadata','publicationAuthorized','reviewState'})
   self.assertEqual(r['id'],'public-health:'+r['sourceRef']); self.assertIsNone(r['nativeId']); self.assertFalse(r['publicationAuthorized']); self.assertEqual(r['reviewState'],'source_reported_unreviewed')
   self.assertLessEqual(set(r['metadata']),set(self.manifest['metadataPolicies'][r['sourceRef'].split('#')[0]]))
   self.assertTrue(all(v is None or isinstance(v,str) for v in r['metadata'].values()))
 def test_source_hashes_and_counts(self):
  files=m.input_files(); self.assertEqual(set(files),set(self.manifest['inputs']))
  for n,p in files.items(): self.assertEqual(self.manifest['inputs'][n],{'sha256':m.digest(p.read_bytes()),'bytes':p.stat().st_size})
  counts=self.data['coverage']['perFileRowCounts']; self.assertEqual(counts['source-linked-inventory.csv'],170); self.assertEqual(counts['unreviewed-profile-leads.csv'],492); self.assertEqual(counts['profile-search-raw.json'],202); self.assertEqual(counts['source-link-checks.csv'],164); self.assertEqual(counts['unavailable-leads.csv'],1)
  actual={}
  for r in self.data['records']:
   n=r['sourceRef'].split('#')[0]; actual[n]=actual.get(n,0)+1
  self.assertEqual(counts,actual)
 def test_urls_source_rows_and_privacy(self):
  records={r['sourceRef']:r for r in self.data['records']}
  for name,(_,urlkey,fields) in m.TABLES.items():
   with (m.SOURCE/name).open(newline='',encoding='utf-8-sig') as f:
    reader=csv.DictReader(f,delimiter='\t' if name.endswith('.tsv') else ','); _=reader.fieldnames
    while True:
     n=reader.line_num+1
     try: row=next(reader)
     except StopIteration: break
     rec=records[f'{name}#row={n}']; self.assertEqual(rec['url'],m.https(row[urlkey]))
     for field in fields.split():
      for url in m.urls(row[field]): self.assertIn(url,rec['metadata']['extracted_urls'])
     if name=='unreviewed-profile-leads.csv':
      self.assertNotIn('profile_description_excerpt',rec['metadata'])
      bio=row['profile_description_excerpt']
      if bio and len(bio)>45: self.assertNotIn(bio,json.dumps(rec))
  self.assertTrue(all(not r['sourceRef'].startswith('profile-search-raw.json#/profiles/') for r in self.data['records']))
  q=' '.join(self.data['qualifications']); self.assertIn('ownership is unconfirmed',q); self.assertIn('nine-county DVRPC',q); self.assertIn('not health labs',q); self.assertIn('blocked checks do not prove absence',q)
 def test_reject_existing_and_traversal(self):
  for dest in ['/workspace','/workspace/../tmp/intake-test',str(m.SOURCE/'new')]:
   p=subprocess.run([sys.executable,str(ROOT/'scripts/sanitize-public-health-intake.py'),'--output',dest],capture_output=True)
   self.assertNotEqual(p.returncode,0)
if __name__=='__main__': unittest.main()
