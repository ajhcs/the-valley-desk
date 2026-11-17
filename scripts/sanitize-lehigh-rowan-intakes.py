#!/usr/bin/env python3
"""Offline metadata-only source intake."""
import argparse, csv, hashlib, importlib.util, json
from pathlib import Path
from urllib.parse import urlsplit
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'docs/discovery/go-live/evidence/GL05/regional-extension-20261117'
SOURCES={'lehigh':{'initial':Path('/workspace/data/builderbob/lehigh-health-lab-github-20261116'),'followup':Path('/workspace/data/builderbob/lehigh-health-github-member-audit-20261116')},'rowan':{'':Path('/workspace/worktrees/builderbob/thevalleydesk/work/rowan-health-github-20261116')}}
THREADS={'lehigh':'01a1e721-5222-7952-8edf-dd4990685a8c','rowan':'01a1e721-f1b1-7e03-b0e1-72c3a035d91f'}
TABLES={
'initial/github-links.csv':('source-observation','github_url','lab lead area link_type github_url evidence_url notes'),
'initial/no-verified-lab-account-found.csv':('coverage',None,'lab_or_center lead source status'),
'initial/unavailable-or-unconfirmed.csv':('availability','published_github_url','project lead published_github_url source observed_status'),
'followup/combined-github-inventory.csv':('source-observation','github_url','lab_or_group person_or_account link_type github_url evidence_url notes'),
'followup/new-since-first-inventory.csv':('source-observation','github_url','lab_or_group person_or_account link_type github_url evidence_url notes'),
'followup/lab-account-repository-census.csv':('repository','github_url','lab account account_association repository github_url fork archived created_at updated_at pushed_at license'),
'followup/member-account-repository-census.csv':('repository','github_url','person lab_or_group account account_attribution account_evidence repository github_url fork archived created_at updated_at pushed_at license research_connection'),
'followup/publication-review-samples.csv':('publication','source_url','lab_or_group paper_or_catalogue source_url level_inspected finding'),
'followup/review-coverage.csv':('coverage','roster_source','lab_or_center roster_source people_checked_or_identified work_checked limitations'),
'followup/unavailable-or-unconfirmed.csv':('availability','published_github_url','project lead published_github_url source observed_status'),
'followup/non-github-code.csv':('external-resource','code_or_data_url','lab_or_group paper_url code_or_data_url'),
'followup/nonlive-manual-leads.csv':('availability','github_url','lab_or_group person_or_account link_type github_url evidence_url notes http_status'),
'matched-repositories.csv':('repository','repository','group_or_researcher repository ownership_relationship is_fork fork_parent archived created_at_utc last_push_at_utc association_evidence qualification checked_at_utc api_status'),
'matched-accounts.csv':('account','account','account login github_account_type public_repository_count matched_repository_count associated_groups repository_relationships association_evidence qualification checked_at_utc'),
'account-repository-snapshot.csv':('repository','repository','account account_relationship repository is_fork archived created_at_utc last_push_at_utc checked_at_utc'),
'unavailable-repositories.csv':('availability','repository','repository paper rowan_association api_status qualification checked_at_utc'),
'epmc-screening-dispositions.csv':('publication','article_url','pmcid article_url title year doi disposition qualification'),
**{f'epmc-remaining-{i}.csv':('publication',None,'pmcid title authorString pubYear doi pmid') for i in range(1,5)},
'snapshots/first-pass-20261116/matched-repositories.csv':('repository','repository','group_or_researcher repository ownership_relationship is_fork fork_parent archived created_at_utc last_push_at_utc association_evidence qualification checked_at_utc api_status'),
'snapshots/first-pass-20261116/account-repository-snapshot.csv':('repository','repository','account account_relationship repository is_fork archived created_at_utc last_push_at_utc checked_at_utc')}
spec=importlib.util.spec_from_file_location('drexel_safe',ROOT/'scripts/sanitize-drexel-intake.py'); mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); safe=mod.safe

def digest(data): return hashlib.sha256(data).hexdigest()
def source_files(batch):
 result={}
 for prefix,root in SOURCES[batch].items():
  for p in sorted(root.rglob('*')):
   if p.is_symlink(): raise ValueError('symlink in source: '+str(p))
   if p.is_file(): result[(prefix+'/' if prefix else '')+p.relative_to(root).as_posix()]=p
 return result

def verify_rowan(files):
 for manifest,base in [('SHA256SUMS-saved-20261116.txt',''),('snapshots/first-pass-20261116/SHA256SUMS.txt','snapshots/first-pass-20261116/')]:
  for line in files[manifest].read_text().splitlines():
   expected,name=line.split('  ',1); name=base+name
   if name not in files or digest(files[name].read_bytes())!=expected: raise ValueError('checksum mismatch: '+name)

def render(batch):
 files=source_files(batch)
 if batch=='rowan': verify_rowan(files)
 inputs={name:{'sha256':digest(p.read_bytes()),'bytes':p.stat().st_size} for name,p in files.items()}
 records=[]; policies={}; counts={}
 for name,(kind,urlfield,fields) in TABLES.items():
  belongs = name.startswith(('initial/','followup/')) if batch=='lehigh' else not name.startswith(('initial/','followup/'))
  if not belongs: continue
  if name not in files: raise ValueError('missing source: '+name)
  keys=fields.split(); policies[name]=keys+(['urlDisposition'] if urlfield else [])
  with files[name].open(newline='',encoding='utf-8-sig') as f:
   reader=csv.DictReader(f)
   if not set(keys).issubset(reader.fieldnames or []): raise ValueError('missing fields: '+name)
   count=0
   while True:
    n=reader.line_num+1
    try: row=next(reader)
    except StopIteration: break
    meta={k:safe(row[k]) for k in keys}; url=None
    if urlfield:
     candidate=meta[urlfield]
     if candidate and candidate.startswith('https://') and not any(c.isspace() for c in candidate):
      try:
       u=urlsplit(candidate)
       if u.hostname and not u.username and not u.password and safe(candidate)==candidate: url=candidate
      except ValueError: pass
     if row[urlfield] and url is None: meta['urlDisposition']='withheld or not an HTTPS URL'
    ref=f'{name}#row={n}'
    records.append({'id':batch+':'+ref,'kind':kind,'url':url,'nativeId':None,'sourceRef':ref,'metadata':meta,'publicationAuthorized':False,'reviewState':'source_reported_unreviewed'}); count+=1
  counts[name]=count
 if batch=='rowan':
  name='europe-pmc-results.json'; data=json.loads(files[name].read_text()); keys=['pmcid','pmid','title','authorString','pubYear','doi','firstPublicationDate']; policies[name]=keys
  for i,row in enumerate(data['records']):
   ref=f'{name}#/records/{i}'; records.append({'id':batch+':'+ref,'kind':'publication','url':None,'nativeId':None,'sourceRef':ref,'metadata':{k:safe(row.get(k)) for k in keys},'publicationAuthorized':False,'reviewState':'source_reported_unreviewed'})
  counts[name]=len(data['records'])
 qualifications=['All matches, roles, availability, research relevance, and ownership relationships are source-reported and unreviewed; matches do not establish ownership or a census.','Overlapping inventories and snapshots are distinct source observations; counts are rows, not unique people or projects.','No individual worksite or county is inferred from an institutional association.','Source bodies, profiles, and contact details are not retained.']
 if batch=='lehigh': qualifications += ['Lehigh is neighboring context outside the nine-county DVRPC primary geography.','Member account contents have mixed scope; website-only and placeholder accounts are not evidence of research software.','LNPDB collaboration does not establish ownership; Taebi code may predate the move from Mississippi; Yaling current affiliation is uncertain.','NaVIP 404 and the inferred access lab account are unconfirmed. Basic biology is not automatically health technology.']
 else: qualifications += ['Rowan, CMSRU, Cooper and Coriell are distinct primary or partner contexts; reported relationships require review.','Zhu current Tulane, historical Rowan and possible dual affiliations require separate review; student PaternaThesis and collaborators are not ownership evidence.','The bounded 100-paper search and selective screening are incomplete; absent matches do not prove absence.']
 result={'schemaVersion':'regional-source-intake-v1','batch':batch,'visibility':'private','publicationAuthorized':False,'sourceThreadId':THREADS[batch],'records':records,'coverage':{'countsPerFile':counts},'qualifications':qualifications}
 output=(json.dumps(result,indent=2,ensure_ascii=False)+'\n').encode()
 manifest={'schemaVersion':'regional-source-intake-manifest-v1','batch':batch,'sourceThreadId':THREADS[batch],'inputs':inputs,'outputs':{'source-assertions.json':{'sha256':digest(output),'bytes':len(output)}},'recordCount':len(records),'metadataPolicies':policies,'sourceRequests':0,'suppliedScriptsExecuted':False,'publicationAuthorized':False}
 return {'source-assertions.json':output,'manifest.json':(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n').encode()}

def main():
 parser=argparse.ArgumentParser(); parser.add_argument('--batch',choices=tuple(SOURCES),required=True); parser.add_argument('--check',action='store_true'); parser.add_argument('--output',type=Path); args=parser.parse_args()
 if args.check and args.output: parser.error('--check and --output are mutually exclusive')
 files=render(args.batch)
 if args.output is None:
  out=BASE/args.batch; manifest=json.loads((out/'manifest.json').read_bytes()); raw=(out/'source-assertions.json').read_bytes(); receipt=manifest['outputs']['source-assertions.json']
  if receipt!={'sha256':digest(raw),'bytes':len(raw)}: raise SystemExit('FAIL: output receipt mismatch')
  for name,data in files.items():
   if (out/name).read_bytes()!=data: raise SystemExit('FAIL: replay mismatch: '+name)
  print('PASS:',args.batch,'deterministic replay and receipt')
 else:
  out=args.output
  if not out.is_absolute() or '..' in out.parts or not out.is_relative_to(Path('/workspace')) or out==Path('/workspace'): parser.error('output must be a new absolute directory below /workspace')
  for p in [out,*out.parents]:
   if p.is_symlink(): parser.error('symlink in output path')
  if out.exists(): parser.error('output exists')
  out.mkdir(parents=True,exist_ok=False)
  for name,data in files.items():
   with (out/name).open('xb') as f: f.write(data)
  print('Wrote',out)
if __name__=='__main__': main()
