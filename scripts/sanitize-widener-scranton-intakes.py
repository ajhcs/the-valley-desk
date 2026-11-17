#!/usr/bin/env python3
"""Offline, private metadata intake of two fixed research snapshots."""
import argparse
import csv
import hashlib
import importlib.util
import json
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
WORK = Path('/workspace/worktrees/builderbob/thevalleydesk/work')
RETAINED = ROOT / 'docs/discovery/go-live/evidence/GL05/regional-extension-20261117'
spec = importlib.util.spec_from_file_location('drexel_sanitizer', ROOT / 'scripts/sanitize-drexel-intake.py')
drexel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(drexel)
safe = drexel.safe
CONFIG = {
 'widener': {'directory':'widener-healthcare-github-research-20261116', 'thread':'01a1e720-cc2d-7980-9585-3722406659a0', 'hashes': {'README.md':'1cc26a3abbe11a551da1c3a1a867ebdeb95cba9c10b070258d912c0aad2a02c5','repositories.csv':'c89f565d7a63432666cf079476b3f1385adec83b941892a8c8c05ababc85deae'}, 'tables': {'repositories.csv': ('repository','github_url',['repository','github_url','relationship','project','account_owner','public_content','source_1','source_2','attribution_notes'])}},
 'scranton': {'directory':'university-of-scranton-healthcare-github-research-20261116','thread':'01a1e721-bf8d-7f02-a268-da73e3fbdd9a','hashes':{'README.md':'bf5ccb2794e85d3abc80d7fb5667cd9be6c0ca36c947eb4c12d78829ae2d0880','build-inventory.py':'0e46cfab6c6b3cdc663d2b9655111425010471715968337a6334e20ed7259ba1','findings.md':'0ef6751502c6e4d65167c67f024e8c45ac4ebfeb46a59c2ef30814e5b684f5ae','labs-and-people.csv':'7a9893b874c4f0a7f816eb917aba393f1f0bf14904b0f19b3b7c84496ae018b5','repositories.csv':'5cf19df7fe10c176fcf67cebe451c0b06b147e231ee8134c446cb412d1d96bad','research-trails.csv':'7b67a3c703bc25c5f89a1fbdd93b621a1cb4392f67f1979f23106b6510e73441','search-notes.md':'3f911e18aec0a51c8766ea77c4251bb3d533c34b62468f4e1dfa4975ddc131ad'},'tables':{'repositories.csv':('repository','url',['id','repository','url','connection_class','scranton_connection','subject','public_content_status','evidence_urls','qualification','researched_date']),'labs-and-people.csv':('source-observation','evidence_url',['name','type','relationship_to_scranton','research_area','github_status','evidence_url','qualification']),'research-trails.csv':('relationship',None,['id','trail','evidence_urls','result','attribution_limit'])}}}
# Small factual labels are authored summaries of the indicated report lines, not bodies.
NOTES = {
 'widener': [
 ('README.md#L15','account','https://github.com/widener-nanobio-lab','Possible NanoBio organization; ownership unconfirmed; zero public repositories and members observed.'),
 ('README.md#L17','account','https://github.com/DanielvdSpoel','Former exchange student; NanoBio software repository not found; other repositories are not automatically lab output.'),
 ('README.md#L27','relationship',None,'Six Java files reportedly matched across Covidapp and Covid19app; same project reported, distinct repository identities retained; not clinically evaluated.'),
 ('README.md#L38','coverage',None,'Four wheelchair repositories describe one effort; checked trees had documentation and portfolio materials, no wheelchair-control or ROS implementation; lab ownership not established.'),
 ('README.md#L51','repository','https://github.com/mahdiaarabi/On-the-fly-Crystal','Adjacent general chemistry; paper predates Widener appointment and identifies Texas Tech.'),
 ('README.md#L65','source-observation',None,'Toneff affiliations are historical publication-time context; current Widener affiliation is not asserted; collaborator repositories are externally hosted.'),
 ('README.md#L82','account','https://github.com/crdandre','Drexel biomechanics account; related Widener collaboration does not establish identified repositories as Widener work.')],
 'scranton': [
 ('search-notes.md#L53','coverage',None,'Outside nine-county DVRPC; neighboring context only, no primary regional admission.'),
 ('search-notes.md#L16','coverage',None,'Chemistry subagent returned an automated safety restriction and no final report; other tracks contributed findings.'),
 ('search-notes.md#L28','availability','https://osf.io/24gfu/','Publisher reports data and R code; OSF access failed, files not inspected.'),
 ('findings.md#L58','availability','https://github.com/prichtsmeier/phonfarmlab','Empty when checked; not the Warker study OSF archive.'),
 ('findings.md#L70','relationship',None,'Shedlock later Florida collaborations are not Scranton lab repositories.'),
 ('findings.md#L74','availability','https://zenodo.org/records/17063383','Project GitHub not found; Zenodo API listed a poster image, not source code.'),
 ('findings.md#L50','source-observation',None,'Avian disease ecology is not automatically health technology.'),
 ('findings.md#L87','coverage',None,'Targeted searches did not establish public GitHub for listed labs and people; not an absence claim.'),
 ('README.md#L20','coverage',None,'Availability may change; some OSF records could not be opened; reported code was not independently inspected.')]
}
def sha(data): return hashlib.sha256(data).hexdigest()
def encoded(obj): return (json.dumps(obj,indent=2,ensure_ascii=False)+'\n').encode()
def url_value(value):
 if not value: return None, 'not supplied'
 cleaned = safe(value)
 try: parsed=urlsplit(cleaned or '')
 except ValueError: return None, 'withheld unsafe URL'
 if cleaned != value.strip() or parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password: return None, 'withheld unsafe URL'
 return cleaned, 'retained'
def render(batch):
 cfg=CONFIG[batch]; src=WORK/cfg['directory']; inputs={}
 for name,expected in cfg['hashes'].items():
  path=src/name
  if path.is_symlink() or not path.is_file(): raise ValueError('missing or symlink source: '+name)
  data=path.read_bytes()
  if sha(data)!=expected: raise ValueError('source checksum mismatch: '+name)
  inputs[name]={'sha256':sha(data),'bytes':len(data)}
 policies={name:[] for name in cfg['hashes']}; records=[]; counts={}
 def add(ref,kind,url,metadata):
  records.append({'id':batch+':'+ref,'kind':kind,'url':url,'nativeId':None,'sourceRef':ref,'metadata':metadata,'publicationAuthorized':False,'reviewState':'source_reported_unreviewed'})
 for filename,(kind,urlkey,fields) in cfg['tables'].items():
  policies[filename]=fields+(['urlDisposition'] if urlkey else [])
  with (src/filename).open(encoding='utf-8-sig',newline='') as f:
   reader=csv.DictReader(f)
   if not reader.fieldnames or any(field not in reader.fieldnames for field in fields): raise ValueError('missing columns: '+filename)
   count=0
   while True:
    start=reader.line_num+1
    try: row=next(reader)
    except StopIteration: break
    metadata={key:safe(row[key]) for key in fields}
    url=None
    if urlkey:
     url,disposition=url_value(row[urlkey]); metadata['urlDisposition']=disposition
    add(filename+'#row='+str(start),kind,url,metadata); count+=1
   counts[filename]=count
 for ref,kind,url,label in NOTES[batch]:
  filename=ref.split('#')[0]
  if 'reportedQualification' not in policies[filename]: policies[filename].append('reportedQualification')
  add(ref,kind,url,{'reportedQualification':label})
 qualifications=['Source-reported, unreviewed snapshot; identities, affiliations, ownership, availability and relevance require independent review.','Native identifiers are unavailable; reported matching copies and redirects are unverified and do not merge identities.','No clinical validation or publication authorization is established.']
 if batch=='scranton': qualifications += ['Scranton is outside the DVRPC nine-county primary geography; neighboring context only.','Student, personal and paperless leads may be retained; biological or avian research is not automatically health technology.','Automated safety restriction blocked the chemistry subagent; this intake did not retry that research.']
 else: qualifications += ['Four wheelchair repositories and two COVID app repositories are not six independent projects.','Historical affiliations and external collaborator hosting do not establish Widener ownership.']
 result={'schemaVersion':'regional-source-intake-v1','batch':batch,'visibility':'private','publicationAuthorized':False,'sourceThreadId':cfg['thread'],'records':records,'coverage':{'fileRowCounts':counts,'scope':'neighboring context; no primary admission' if batch=='scranton' else 'source-reported Widener relationships; no ownership inference','reportObservationCount':len(NOTES[batch])},'qualifications':qualifications}
 data=encoded(result)
 manifest={'schemaVersion':'regional-source-intake-manifest-v1','batch':batch,'sourceThreadId':cfg['thread'],'inputs':inputs,'outputs':{'source-assertions.json':{'sha256':sha(data),'bytes':len(data)}},'recordCount':len(records),'metadataPolicies':policies,'sourceRequests':0,'suppliedScriptsExecuted':False,'publicationAuthorized':False}
 return {'source-assertions.json':data,'manifest.json':encoded(manifest)}
def output_path(raw):
 if not raw.is_absolute() or '..' in raw.parts or not raw.is_relative_to('/workspace') or raw==Path('/workspace'): raise ValueError('output must be a new absolute path under /workspace without traversal')
 p=Path('/')
 for part in raw.parts[1:]:
  p=p/part
  if p.is_symlink(): raise ValueError('symlink in output path')
 if raw.exists(): raise ValueError('output already exists')
 if raw.is_relative_to(WORK): raise ValueError('output must be outside source tree')
 return raw
def main():
 parser=argparse.ArgumentParser(); parser.add_argument('--check',action='store_true'); parser.add_argument('--output',type=Path); args=parser.parse_args()
 if args.check and args.output: parser.error('choose --check or --output')
 try:
  out=output_path(args.output) if args.output else RETAINED
  files={batch:render(batch) for batch in CONFIG}
  if args.output:
   out.mkdir(parents=True,exist_ok=False)
   for batch,items in files.items():
    directory=out/batch; directory.mkdir()
    for name,data in items.items():
     with (directory/name).open('xb') as f: f.write(data)
  else:
   for batch,items in files.items():
    for name,data in items.items():
     if (out/batch/name).read_bytes()!=data: raise ValueError('retained output differs: '+batch+'/'+name)
  print('PASS: '+('wrote outputs' if args.output else 'byte-exact replay'))
 except (ValueError,OSError) as e: parser.exit(1,'FAIL: '+str(e)+'\n')
if __name__=='__main__': main()
