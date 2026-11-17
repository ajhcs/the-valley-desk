#!/usr/bin/env python3
"""Offline, private, metadata-only intake; supplied programs are never executed."""
import argparse, csv, hashlib, importlib.util, json, re
from pathlib import Path
from urllib.parse import urlsplit
ROOT=Path(__file__).resolve().parents[1]
SOURCE=Path('/workspace/data/builderbob/research/philadelphia-health-github-20261116-byzY6B')
RETAINED=ROOT/'docs/discovery/go-live/evidence/GL05/regional-additions-20261117/public-health'
THREAD='01a1e757-1efe-79c2-b387-58adc9b5cccc'
spec=importlib.util.spec_from_file_location('drexel_safe',ROOT/'scripts/sanitize-drexel-intake.py'); mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
safe=mod.safe
TABLES={
 'source-linked-inventory.csv':('source-observation','github_url','area type name github_url github_object_type evidence_url evidence_kind evidence_note availability'),
 'curated-seeds.tsv':('source-observation','github_url','area type name github_url evidence_url evidence_note'),
 'unreviewed-profile-leads.csv':('account','github_url','name github_url github_object_type profile_company profile_location evidence_url matched_search_queries review_status'),
 'unavailable-leads.csv':('availability','github_url','area type name github_url evidence_url evidence_note availability_note'),
 'source-link-checks.csv':('availability','url','url http_status resolved_url note'),
}
QUALIFICATIONS=[
 'All source assertions, matches, availability and relationships are reported and unreviewed; no publication is authorized.',
 'PHL-2 self-identifies as the city public health laboratory and lists a city contact; independent city linkage was not found, so official ownership is unconfirmed.',
 'CityOfPhiladelphia is citywide, not the public health laboratory account; Community Health Explorer is a project-specific city health collaboration.',
 'Code for Philly is a community organization, not municipal ownership. Regional company presence and global lab accounts do not establish local code.',
 'Profile names, company and location are self-reported hints, not evidence of current employment, worksite, account identity or lab membership.',
 'The 492 filtered profiles are unreviewed leads. The 5287 raw broad-search hits are not health labs and are not imported; 170 linked GitHub links are not a count of labs.',
 'The 202 queries are finite and incomplete. Two broad searches required creation-date partitions; first-page and saturation limits remain. Unavailable or blocked checks do not prove absence; successful HEAD checks do not prove attribution.',
 'The governing primary geography is the nine-county DVRPC region regardless of source Greater Philadelphia scope; Newark, Delaware is neighboring context.',
 'Source profile biographies, article and README bodies, and contact details are excluded. URL checks and all source assertions reflect the supplied snapshot, not current verification.'
]
def digest(data): return hashlib.sha256(data).hexdigest()
def input_files():
 result={}
 for p in sorted(SOURCE.rglob('*')):
  if p.is_symlink(): raise ValueError('source symlink: '+str(p))
  if p.is_file(): result[p.relative_to(SOURCE).as_posix()]=p
 return result
def clean(v):
 if v is None: return None
 if isinstance(v,bool): v=str(v).lower()
 return safe(str(v))
def urls(v):
 # Isolate each link before applying the upstream length cap.
 result=[]
 for u in re.findall(r'https://[^\s|<>"\']+',str(v or '')):
  u=u.rstrip('.,;)]')
  if safe(u)==u and len(u)<=1000 and u not in result: result.append(u)
 return result
def https(v):
 if not v: return None
 try:
  u=urlsplit(v)
  return v if u.scheme=='https' and u.hostname and not u.username and not u.password and safe(v)==v and not any(c.isspace() for c in v) else None
 except ValueError: return None
def render():
 files=input_files(); records=[]; counts={}; policies={}
 def add(name,ref,kind,url,meta):
  records.append({'id':'public-health:'+ref,'kind':kind,'url':https(url),'nativeId':None,'sourceRef':ref,'metadata':meta,'publicationAuthorized':False,'reviewState':'source_reported_unreviewed'})
 for name,(default,urlkey,columns) in TABLES.items():
  keys=columns.split(); policies[name]=keys+['extracted_urls','metadata_truncated']; count=0
  with files[name].open(encoding='utf-8-sig',newline='') as f:
   reader=csv.DictReader(f,delimiter='\t' if name.endswith('.tsv') else ',')
   if not set(keys)<=set(reader.fieldnames or []): raise ValueError('missing columns '+name)
   while True:
    line=reader.line_num+1
    try: row=next(reader)
    except StopIteration: break
    meta={k:clean(row[k]) for k in keys}; found=[]
    for k in keys:
     for u in urls(row[k]):
      if u not in found: found.append(u)
    meta['extracted_urls']=' | '.join(found) or None
    meta['metadata_truncated']='true' if any(len(row[k] or '')>1000 for k in keys) else 'false'
    kind=default
    if name in ('source-linked-inventory.csv','curated-seeds.tsv'):
     kind='project' if row['type']=='Project' else 'account'
    add(name,f'{name}#row={line}',kind,row[urlkey],meta); count+=1
  counts[name]=count
 name='README.md'; policies[name]=['note']; counts[name]=2
 add(name,f'{name}#L16','source-observation','https://github.com/PHL-2',{'note':'Self-identified public health laboratory; independent city linkage was not identified.'})
 add(name,f'{name}#L22','coverage',None,{'note':'Finite profile search, reported date partitions, and limitations; no search establishes absence.'})
 name='profile-search-raw.json'; raw=json.loads(files[name].read_text()); keys=['query','matches_reported','returned','first_page_only']; policies[name]=keys
 for i,row in enumerate(raw['coverage']):
  add(name,f'{name}#/coverage/{i}','coverage',None,{k:clean(row.get(k)) for k in keys})
 counts[name]=len(raw['coverage'])
 name='counts.json'; data=json.loads(files[name].read_text()); keys=['date_eastern','source_linked_github_links','unreviewed_distinct_profile_leads','github_api_unavailable_seed_links','github_profile_queries','raw_distinct_profile_search_hits','search_queries_first_page_only','broad_queries_supplemented_by_date_partitions','queries_with_unretrieved_pages_not_covered_by_partitions']; policies[name]=['value']
 for key in keys: add(name,f'{name}#/{key}','coverage',None,{'value':clean(data[key])})
 for key,value in data['source_linked_types'].items(): add(name,f'{name}#/source_linked_types/{key.replace("~","~0").replace("/","~1")}','coverage',None,{'value':clean(value)})
 counts[name]=len(keys)+len(data['source_linked_types'])
 name='seed-github-validation.json'; data=json.loads(files[name].read_text()); keys=['__typename','login','name','location','nameWithOwner','isArchived','isPrivate','url']; policies[name]=keys+['reported_key','status']
 for key,row in data.items():
  meta={k:clean(row.get(k)) for k in keys} if isinstance(row,dict) else {k:None for k in keys}
  meta.update({'reported_key':clean(key),'status':'object returned' if isinstance(row,dict) else 'null or unavailable'})
  ref=f'{name}#/{key.replace("~","~0").replace("/","~1")}'
  add(name,ref,'availability',row.get('url') if isinstance(row,dict) else None,meta)
 counts[name]=len(data)
 result={'schemaVersion':'regional-source-intake-v1','batch':'public-health','visibility':'private','publicationAuthorized':False,'sourceThreadId':THREAD,'records':records,'coverage':{'perFileRowCounts':counts},'qualifications':QUALIFICATIONS}
 output=(json.dumps(result,indent=2,ensure_ascii=False)+'\n').encode()
 manifest={'schemaVersion':'regional-source-intake-manifest-v1','batch':'public-health','sourceThreadId':THREAD,'inputs':{n:{'sha256':digest(p.read_bytes()),'bytes':p.stat().st_size} for n,p in files.items()},'outputs':{'source-assertions.json':{'sha256':digest(output),'bytes':len(output)}},'recordCount':len(records),'metadataPolicies':policies,'sourceRequests':0,'suppliedScriptsExecuted':False,'publicationAuthorized':False}
 return {'source-assertions.json':output,'manifest.json':(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n').encode()}
def main():
 parser=argparse.ArgumentParser(); parser.add_argument('--check',action='store_true'); parser.add_argument('--output',type=Path); a=parser.parse_args()
 if a.check and a.output: parser.error('--check and --output are mutually exclusive')
 if a.output:
  out=a.output
  if not out.is_absolute() or '..' in out.parts or not out.is_relative_to(Path('/workspace')) or out==Path('/workspace') or out.is_relative_to(SOURCE) or SOURCE.is_relative_to(out): parser.error('output must be new and under /workspace, outside source')
  if any(p.is_symlink() for p in (out,*out.parents)) or out.exists(): parser.error('existing or symlink output path')
 else: out=RETAINED
 data=render()
 if a.output:
  out.mkdir(parents=True,exist_ok=False)
  for n,b in data.items():
   with (out/n).open('xb') as f: f.write(b)
  print('Wrote',out)
 else:
  for n,b in data.items():
   if (out/n).read_bytes()!=b: raise SystemExit('FAIL: replay differs: '+n)
  print('PASS: deterministic replay')
if __name__=='__main__': main()
