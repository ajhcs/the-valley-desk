#!/usr/bin/env python3
"""Offline, metadata-only projection of the supplied incubator/region research."""
import argparse
import csv
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlsplit

SOURCE = Path('/workspace/data/builderbob/thevalleydesk-github-discovery-20261116')
ROOT = Path(__file__).resolve().parents[1]
RETAINED = ROOT / 'docs/discovery/go-live/evidence/GL05/regional-additions-20261117/incubators'
THREAD = '01a1e757-a7ce-7eb3-a4bd-3658661471f6'
FROZEN = ROOT / 'docs/discovery/go-live/evidence/GL05/regional-expansion-20261117'
EXPECTED = {'research-network.snapshot.json': ('research-network.json','6eca9df3495507c77fb3973586fd51f7e386533ec47f970af15337be93357897',1153555), 'qualification-queue.snapshot.json': ('qualification-queue.json','bae3720eeb8aa4a01f4b6d0b35923c4f3fb321c7b87020cfdcf9858f335afc79',13186107)}
EMAIL = re.compile(r'\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b')
PHONE = re.compile(r'(?<!\w)(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\w)')

def digest(data): return hashlib.sha256(data).hexdigest()
def url(value):
 value = (value or '').strip()
 try: u = urlsplit(value)
 except ValueError: return None
 if u.scheme != 'https' or not u.hostname or u.username or u.password or EMAIL.search(unquote(value)) or PHONE.search(unquote(value)) or re.search(r'\s', value): return None
 for segment in (u.query, u.fragment):
  for key, val in parse_qsl(segment.replace(';','&'), keep_blank_values=True):
   for _ in range(3): key=unquote(key)
   key=re.sub(r'[^a-z0-9]', '', key.lower())
   if val and (key == 'key' or any(x in key for x in ('token','password','passwd','secret','session','auth','credential','apikey','ticket','signature'))): return None
 return value

def safe(value):
 value=re.sub(r'[\x00-\x1f\x7f]+',' ',str(value or '')).strip()
 value=re.sub(r'https?://[^\s|]+',lambda m: url(m.group()) or '[url removed]',value)
 value=PHONE.sub('[contact removed]',EMAIL.sub('[contact removed]',value))
 return value[:1000] or None

def rows(name):
 with (SOURCE/name).open(encoding='utf-8-sig',newline='') as f:
  reader=csv.DictReader(f)
  _ = reader.fieldnames  # Consume the header before recording physical row starts.
  while True:
   line=reader.line_num+1
   try: row=next(reader)
   except StopIteration: break
   yield line,row

def verify_lineage():
 for snap,(original,sha,size) in EXPECTED.items():
  for path in (SOURCE/snap,FROZEN/original):
   if path.is_symlink() or not path.is_file(): raise ValueError('missing or symlink snapshot '+str(path))
   data=path.read_bytes()
   if len(data)!=size or digest(data)!=sha: raise ValueError('frozen snapshot mismatch '+str(path))
 network=json.loads((SOURCE/'research-network.snapshot.json').read_bytes())
 queue=json.loads((SOURCE/'qualification-queue.snapshot.json').read_bytes())
 def ids(s): return set(x.strip() for x in s.split(';') if x.strip())
 accounts={x['key'].lower():set(x['observationIds']) for x in network['accounts']}
 repos={x['key'].lower():set(x['observations']) for x in network['repositories']}
 def exported(name):
  out={}
  for _,row in rows(name):
   key=urlsplit(row['github_url']).path.strip('/').lower()
   if key in out: raise ValueError('duplicate export key')
   out[key]=ids(row['observation_ids'])
  return out
 if exported('unreviewed-account-leads.csv') != accounts or exported('unreviewed-repository-leads.csv') != repos: raise ValueError('snapshot export membership mismatch')
 allrepos=defaultdict(set)
 for obs in queue['observations']:
  if obs.get('urlKind')=='repository-url' and obs.get('repositoryKey'): allrepos[obs['repositoryKey'].lower()].add(obs['id'])
 if exported('unreviewed-all-repository-url-leads.csv') != dict(allrepos): raise ValueError('queue export membership mismatch')

def render():
 inputs={}
 for p in sorted(SOURCE.iterdir()):
  if p.is_symlink() or not p.is_file(): raise ValueError('unexpected source entry '+str(p))
  b=p.read_bytes(); inputs[p.name]={'sha256':digest(b),'bytes':len(b)}
 verify_lineage()
 records=[]; policies=defaultdict(set); counts=defaultdict(int)
 def add(ref,kind,link,metadata):
  metadata={k:v for k,v in metadata.items() if v is None or isinstance(v,str)}
  records.append({'id':'incubators:'+ref.replace('#',':',1),'kind':kind,'url':url(link),'nativeId':None,'sourceRef':ref,'metadata':metadata,'publicationAuthorized':False,'reviewState':'source_reported_unreviewed'})
  file=ref.split('#')[0]; counts[file]+=1; policies[file].update(metadata)
 for line,row in rows('supported-links.csv'):
  link=url(row['github_url']); parts=urlsplit(link or '').path.strip('/').split('/')
  metadata={k:safe(row[k]) for k in ('group','entity','entity_type','research_area','evidence_scope','qualification')}
  for k in ('group','entity','entity_type','research_area','evidence_scope','qualification'):
   if len(row[k])>1000: metadata[k+'_truncated']='true'
  for i,linkpart in enumerate(row['evidence_urls'].split(';'),1): metadata['evidence_url_'+str(i)]=url(linkpart)
  add(f'supported-links.csv#row={line}','account' if len(parts)==1 else 'project',link,metadata)
 for file in ('github-link-check.json','evidence-link-check-pre-review.json'):
  obj=json.loads((SOURCE/file).read_bytes())
  for i,item in enumerate(obj['results']):
   add(f'{file}#/results/{i}','availability',item.get('url'),{'reported_status':str(item.get('status')) if item.get('status') is not None else None,'reported_final_url':url(item.get('final_url')),'checked_at_utc':safe(obj.get('checked_at_utc')),'method':safe(obj.get('method')),'limitation':'Redirects are reported results, not alias or ownership assertions; non-200 does not establish source absence.'})
  if file.startswith('github'):
   add(file+'#/csv_sha256_at_check','source-observation',None,{'csv_sha256_at_check':safe(obj.get('csv_sha256_at_check')),'current_csv_sha256':safe(obj.get('current_csv_sha256')),'post_check_change':safe(obj.get('post_check_change'))})
 for file,number in [('unreviewed-account-leads.csv','259'),('unreviewed-repository-leads.csv','3274'),('unreviewed-all-repository-url-leads.csv','5534')]:
  add(file+'#row=1','coverage',None,{'reported_raw_count':number,'lineage':'Derived from frozen research-network.snapshot.json and qualification-queue.snapshot.json; does not constitute fresh coverage or independent observations. Exports overlap and are not additive. Membership and observation IDs checked against frozen snapshots.'})
 add('README.md#L1','coverage',None,{'limitation':'91 source-supported rows mix account and project references and are unreviewed; no completeness or eligibility claim. The governing primary geography remains the nine-county DVRPC region; Delaware is nearby context.'})
 add('source-snapshot-receipt.json#/sources','coverage',None,{'lineage':'Snapshots verified byte-for-byte by SHA-256 and length against frozen originals; no bulk snapshots copied. Existing observation IDs remain in original exports.'})
 add('verification.json#/limits','source-observation',None,{'limitation':safe(json.loads((SOURCE/'verification.json').read_bytes())['limits'])})
 qualifications=['All records are source-reported and unreviewed; none authorizes publication, ownership, current roles, worksite, or health relevance.', 'PABC membership does not establish physical residency; the 2017 ChimericSeq work is not established as performed at PABC. JBS Science is reported currently in Lansdale.', 'BioLabs for Advanced Therapeutics at 601 Walnut Street is distinct from PABC and B+labs. No verified site or CTIBIOTECH USA GitHub was found; not found does not mean none exists.', 'Existing derived exports are not new observations or independent evidence. The nine-county DVRPC region governs primary geography; Delaware is nearby context.', 'HEAD status and redirects do not establish ownership, relevance, alias identity, or absence; current source CSV differs from the checked CSV as reported.']
 envelope={'schemaVersion':'regional-source-intake-v1','batch':'incubators','visibility':'private','publicationAuthorized':False,'sourceThreadId':THREAD,'records':records,'coverage':{'perFileRowCounts':dict(sorted(counts.items()))},'qualifications':qualifications}
 data=(json.dumps(envelope,indent=2,ensure_ascii=False)+'\n').encode()
 manifest={'schemaVersion':'regional-source-intake-manifest-v1','batch':'incubators','sourceThreadId':THREAD,'inputs':inputs,'outputs':{'source-assertions.json':{'sha256':digest(data),'bytes':len(data)}},'recordCount':len(records),'metadataPolicies':{k:sorted(v) for k,v in sorted(policies.items())},'sourceRequests':0,'suppliedScriptsExecuted':False,'publicationAuthorized':False}
 return {'source-assertions.json':data,'manifest.json':(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n').encode()}

def main():
 p=argparse.ArgumentParser(); p.add_argument('--check',action='store_true'); p.add_argument('--output',type=Path); a=p.parse_args()
 if a.check and a.output: p.error('choose --check or --output')
 if a.output:
  raw=a.output.absolute()
  if '..' in a.output.parts or not raw.is_relative_to(Path('/workspace')) or raw==Path('/workspace'): p.error('output must be a new workspace directory')
  for x in (raw,*raw.parents):
   if x.is_symlink(): p.error('symlink output path')
  out=raw.resolve()
  if out.is_relative_to(SOURCE.resolve()) or SOURCE.resolve().is_relative_to(out) or out.exists(): p.error('output overlap or already exists')
 else: out=RETAINED
 files=render()
 if a.output:
  out.mkdir(parents=True,exist_ok=False)
  for name,data in files.items():
   with (out/name).open('xb') as f: f.write(data)
  print('Wrote',out)
 else:
  for name,data in files.items():
   if not (out/name).is_file() or (out/name).read_bytes()!=data: raise SystemExit('FAIL: output differs or missing: '+name)
  print('PASS: deterministic replay matches retained output')
if __name__=='__main__': main()
