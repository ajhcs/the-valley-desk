#!/usr/bin/env python3
"""Deterministic, offline, metadata-only SJU and PCOM source intake."""
import argparse, csv, hashlib, importlib.util, json, re
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {'sju': Path('/workspace/worktrees/builderbob/thevalleydesk/work/sju-healthcare-github-inventory-20261117'), 'pcom': Path('/workspace/data/builderbob/pcom-github-network-20261116-6UMUyY')}
THREADS = {'sju':'01a1e6fd-d1df-70d0-82ac-d13f41472461','pcom':'01a1e6fd-918f-7ea0-ba48-6199dea9b1b6'}
DEST = ROOT/'docs/discovery/go-live/evidence/GL05/regional-extension-20261117'
spec = importlib.util.spec_from_file_location('drexel_safe', ROOT/'scripts/sanitize-drexel-intake.py')
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
safe = mod.safe
# Explicitly selected source-reported metadata, never article, README or biography bodies.
TABLES = {
'sju': {
 'accounts.csv':('account','github_url',['account','account_type','identified_as','connection','evidence_urls','limits','snapshot_utc']),
 'repositories.csv':('repository','github_url',['relationship','group','repository','people','description','evidence_urls','limits','snapshot_utc']),
 'labs-checked.csv':('coverage',None,['group','finding','evidence_urls','limits','snapshot_utc']),
 'link-checks.csv':('availability','requested_url',['status','disposition','final_url','checked_at_utc'])},
'pcom': {
 'connected_account_repositories.csv':('repository','url',['account','account_relationship','repository','description','language','fork','archived','pushed_at','license','pcom_research_attribution']),
 'connections.csv':('relationship','github_url',['person_or_entity','relationship','year','area','primary_evidence','notes']),
 'corpus_github_candidates.csv':('publication','paper_url',['pmcid','paper_title','authors','github_url','classification','notes']),
 'network_edges.csv':('relationship','evidence_url',['source','relationship','target','qualification']),
 'people_screened.csv':('source-observation',None,['name','campuses','official_urls','search_notes','statuses','source_files'])}}
QUALIFICATIONS = {
'sju':['All metadata is source-reported and unreviewed; labels do not establish identity, ownership, current role, health relevance or availability.','The inventory is a best-effort public snapshot, not a census; repository records include external collaborators, teaching, historical work and unconfirmed leads.','University of the Sciences is a historical predecessor in Philadelphia; Lancaster is a separate campus context. Institution names do not establish individual or project geography.','Lab labels and accounts do not establish institutional ownership; historical affiliation does not establish a current role. Source link checks are time-specific and do not establish evidentiary support.'],
'pcom':['All metadata is source-reported and unreviewed; labels do not establish identity, ownership, current role, health relevance or availability.','The 582 account-level repository leads are not a count of PCOM projects. Corpus GitHub mentions require contextual verification and are not all PCOM projects.','Philadelphia and Georgia are distinct campus contexts; Wistar is a partner, not a PCOM campus. Institution names do not establish individual or project geography.','Curated connections and edges supersede tentative raw investigation notes. Account identity and institutional administrative ownership remain qualified as reported.','The source search is incomplete; its corpus query and access limitations exclude some publications and repositories.','Screened-person search notes are bounded prefixes, not complete or adjudicated findings; the original file and row remain referenced.']}
def digest(data): return hashlib.sha256(data).hexdigest()
def js(obj): return (json.dumps(obj,ensure_ascii=False,indent=2)+'\n').encode()
def primary(value):
 value=(value or '').strip()
 if not value: return None
 try:
  u=urlsplit(value)
  if u.scheme != 'https' or not u.hostname or re.search(r'\s',value) or safe(value)!=value: return None
  return value
 except ValueError: return None

def inventory(batch):
 base=SOURCES[batch]; files={}
 if base.is_symlink(): raise ValueError('source root symlink')
 for path in sorted(base.rglob('*')):
  if path.is_symlink(): raise ValueError('source symlink: '+str(path))
  if path.is_file():
   raw=path.read_bytes(); files[path.relative_to(base).as_posix()]={'sha256':digest(raw),'bytes':len(raw)}
 if batch=='pcom':
  seen=set()
  for line in (base/'SHA256SUMS').read_text().splitlines():
   match=re.fullmatch(r'([0-9a-f]{64})  (.+)',line)
   if not match: raise ValueError('invalid checksum entry')
   h,name=match.groups(); p=Path(name)
   if p.is_absolute() or '..' in p.parts or name in seen or name not in files or files[name]['sha256']!=h: raise ValueError('invalid checksum: '+name)
   seen.add(name)
  if seen != set(files)-{'SHA256SUMS'}: raise ValueError('checksum inventory mismatch')
 return files

def render(batch):
 inputs=inventory(batch); base=SOURCES[batch]; records=[]; counts={}; policies={}
 for name,(kind,urlfield,fields) in TABLES[batch].items():
  policies[name]=fields+(['search_notes_truncated','sourceCitationUrls'] if batch=='pcom' and name=='people_screened.csv' else [])+(['primaryUrlDisposition'] if urlfield else [])
  count=0
  with (base/name).open(newline='',encoding='utf-8-sig') as f:
   reader=csv.DictReader(f)
   if not set(fields+([urlfield] if urlfield else [])).issubset(reader.fieldnames or []): raise ValueError('missing columns '+name)
   while True:
    rownum=reader.line_num+1
    try: row=next(reader)
    except StopIteration: break
    meta={field:safe(row[field]) for field in fields}
    if batch=='pcom' and name=='people_screened.csv':
     # Match safe() control-character cleanup and trimming before the 1000-character bound.
     normalized=re.sub(r'[\x00-\x1f\x7f]+', ' ', row['search_notes'] or '').strip()
     # This snapshot's flagged sanitized notes all reach the clipping boundary.
     meta['search_notes_truncated']='true' if len(normalized)>1000 and len(meta['search_notes'] or '')==1000 else 'false'
     citations=[primary(u) for u in re.findall(r'https?://[^\s|]+',row['search_notes'] or '')]
     meta['sourceCitationUrls']=' '.join(u for u in citations if u) or None
    url=primary(row[urlfield]) if urlfield else None
    if urlfield: meta['primaryUrlDisposition']='retained' if url else ('withheld_invalid_or_unsafe' if row[urlfield].strip() else 'not_supplied')
    records.append({'id':f'{batch}:{name}:row={rownum}','kind':kind,'url':url,'nativeId':None,'sourceRef':f'{name}#row={rownum}','metadata':meta,'publicationAuthorized':False,'reviewState':'source_reported_unreviewed'}); count+=1
  counts[name]=count
 if batch=='pcom':
  obj=json.loads((base/'account_snapshot.json').read_text()); fields=['requested_account','relationship','login','account_type','public_repos','listed_public_repos','retrieved_at_utc','primaryUrlDisposition']; policies['account_snapshot.json']=fields
  for i,account in enumerate(obj['accounts']):
   profile=account.get('profile') or {}; url=primary(profile.get('html_url'))
   vals=[account.get('requested_account'),account.get('relationship'),profile.get('login'),profile.get('type'),profile.get('public_repos'),account.get('listed_public_repos'),obj.get('retrieved_at_utc'),'retained' if url else ('withheld_invalid_or_unsafe' if profile.get('html_url') else 'not_supplied')]
   meta={k:safe(str(v)) if v is not None else None for k,v in zip(fields,vals)}
   records.append({'id':f'pcom:account_snapshot.json:/accounts/{i}','kind':'account','url':url,'nativeId':None,'sourceRef':f'account_snapshot.json#/accounts/{i}','metadata':meta,'publicationAuthorized':False,'reviewState':'source_reported_unreviewed'})
  counts['account_snapshot.json']=len(obj['accounts'])
 result={'schemaVersion':'regional-source-intake-v1','batch':batch,'visibility':'private','publicationAuthorized':False,'sourceThreadId':THREADS[batch],'records':records,'coverage':{'perFileRowCounts':counts},'qualifications':QUALIFICATIONS[batch]}
 data=js(result)
 manifest={'schemaVersion':'regional-source-intake-manifest-v1','batch':batch,'sourceThreadId':THREADS[batch],'inputs':inputs,'outputs':{'source-assertions.json':{'sha256':digest(data),'bytes':len(data)}},'recordCount':len(records),'metadataPolicies':policies,'sourceRequests':0,'suppliedScriptsExecuted':False,'publicationAuthorized':False}
 return {'source-assertions.json':data,'manifest.json':js(manifest)}
def output_guard(path):
 p=Path(path)
 if not p.is_absolute() or '..' in p.parts or not p.is_relative_to('/workspace') or p==Path('/workspace'): raise ValueError('output must be a new absolute directory under /workspace')
 for parent in [p,*p.parents]:
  if parent.is_symlink(): raise ValueError('output path contains symlink')
 if p.exists(): raise ValueError('output exists')
 for src in SOURCES.values():
  if p.is_relative_to(src) or src.is_relative_to(p): raise ValueError('output overlaps source')
 return p

def main():
 parser=argparse.ArgumentParser(); parser.add_argument('--batch',choices=SOURCES,required=True); group=parser.add_mutually_exclusive_group(); group.add_argument('--check',action='store_true'); group.add_argument('--output',type=Path); args=parser.parse_args()
 files=render(args.batch)
 if args.output:
  out=output_guard(args.output); out.mkdir(parents=True,exist_ok=False)
  for name,data in files.items():
   with (out/name).open('xb') as f: f.write(data)
  print('Wrote',out)
 else:
  for name,data in files.items():
   path=DEST/args.batch/name
   if path.is_symlink() or not path.is_file() or path.read_bytes()!=data: raise SystemExit('FAIL replay: '+str(path))
  print('PASS deterministic replay:',args.batch)
if __name__=='__main__': main()
