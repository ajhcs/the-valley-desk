#!/usr/bin/env python3
"""Drexel metadata-only offline source intake, version 1; never executes input."""
import argparse
import csv
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit, unquote

SOURCE = Path('/workspace/worktrees/builderbob/thevalleydesk/work/drexel-github-census-20261116')
RETAINED = Path(__file__).resolve().parents[1] / 'docs/discovery/go-live/evidence/GL05/regional-expansion-20261117/drexel-v3'
EMAIL = re.compile(r'\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b')
PHONE = re.compile(r'(?<!\w)(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\w)')
# Explicit source-column allowlists. Raw review records and article/README bodies are excluded.
TABLES = {
 'repositories': ('account-repositories.csv', ['lab','account','repository','url','description','fork','archived','license','created_at','updated_at','pushed_at','health_relevance','fetched_at_utc']),
 'projects': ('project-evidence-candidates.csv', ['repository_mentioned','canonical_repository','repository_root_url','root_availability','is_fork','is_archived','root_checked_at_utc','record_type','project_or_paper_title','source_id','evidence_urls','affiliation_evidence_or_grade','source_file','project_health_relevance','institutional_ownership','independent_audit_report']),
 'studentAssociations': ('student-inclusive-evidence.csv', ['repository_mentioned','canonical_repository','repository_url','root_availability','is_fork_at_check','root_checked_at_utc','project_or_topic','evidence_grade_as_reported','evidence_urls','source_file','companion_or_copy_note','student_identity_and_project_scope']),
 'statuses': ('repository-mentions-availability.csv', ['requested_repository','requested_root_url','availability','canonical_name','canonical_url','is_fork','is_archived','license_spdx','created_at','updated_at','pushed_at','article_ids','source_files','health_relevance','project_attribution','checked_at_utc','reviewed_correction_url','resolution_note','resolution_report']),
 'publicationSearch': ('publication-github-candidates.csv', ['pmcid','doi','title','authors','journal','year','article_url','status','github_urls']),
 'studentVerified': ('student-verified-projects.csv', ['repository','project_url','topic','project_evidence_urls','affiliation_evidence_urls','evidence_grade','historical_public_access','availability_ledger_status','availability_ledger_matching_names','hosting','latest_root_status','latest_root_checked_at_utc','latest_is_fork']),
 'studentReview': ('student-search-review-index.csv', ['repository','url','github_public_at_search','review_report','independent_attribution','readme_status']),
 'publicationReview': ('publication-review-index.csv', ['pmcid','article_url','title','authors','year','source_mentions','review_report','attribution_and_availability']),
 'expandedPublicationReview': ('expanded-publication-review-index.csv', ['source','id','pmcid','doi','title','authors','year','review_report','attribution_and_availability']),
 'forkReview': ('fork-parent-review-index.csv', ['parent_repository','parent_url','fork_count','identical_default_head_count','different_default_head_count','review_report']),
}

def digest(data): return hashlib.sha256(data).hexdigest()
def safe(value):
 value = re.sub(r'[\x00-\x1f\x7f]+', ' ', value or '').strip()
 # Preserve exact URLs only when their credentials and parameters are safe.
 def clean(m):
  raw=m.group(0); u=urlsplit(raw)
  if not u.hostname or u.username or u.password or EMAIL.search(unquote(raw)) or PHONE.search(unquote(raw)):
   return '[url removed]'
  for segment in (u.query, u.fragment):
   for key, val in parse_qsl(segment.replace(';', '&'),keep_blank_values=True):
    for _ in range(3): key = unquote(key)
    normalized=re.sub(r'[^a-z0-9]', '', key.lower())
    if val and (normalized == 'key' or any(secret in normalized for secret in ('token','password','passwd','secret','session','auth','credential','apikey','ticket','signature'))):
     return '[url removed]'
  return raw
 value = re.sub(r'https?://[^\s|]+',clean,value)
 value = EMAIL.sub('[contact removed]', value)
 value = PHONE.sub('[contact removed]', value)
 return value[:1000] or None

def verify_sources():
 manifest_path = SOURCE/'SHA256SUMS.json'
 if manifest_path.is_symlink(): raise ValueError('symlink manifest')
 raw=manifest_path.read_bytes(); supplied=json.loads(raw)
 if supplied.get('algorithm') != 'sha256': raise ValueError('unsupported digest')
 hashes={}
 for name, expected in supplied['files'].items():
  rel=Path(name)
  if rel.is_absolute() or '..' in rel.parts or not rel.parts: raise ValueError('unsafe source path')
  p=SOURCE
  for part in rel.parts:
   p=p/part
   if p.is_symlink(): raise ValueError('symlink in source path')
  if not p.is_file() or digest(p.read_bytes()) != expected: raise ValueError('source checksum mismatch: '+name)
  hashes[name]=expected
 return hashes,digest(raw)

def render():
 hashes, manifest_hash=verify_sources()
 result={'version':1,'sourceThreadId':'01a1e6ca-7172-72d3-9b71-7e5d4c483019','institution':'Drexel University (source-reported context)','publicationAuthorized':False,
 'qualifications':['All associations, roles, availability, health relevance, ownership, audit grades and review outcomes are source-reported and unreviewed.','Source has no retained native GitHub IDs; repository names and URLs are not stable identities. Corrections are reported relationships, not canonical identity assertions.','Root availability does not establish branch or file availability. IMPACC workflow 404 remains unavailable.','Broad root checks include external and unrelated names and are not a count of Drexel projects.','Student, course, copy, external collaboration and historical role associations require individual review; inclusion does not establish people counts, enrollment, worksite or ownership.','DVRPC nine-county primary geography is unchanged; institutional affiliation does not establish a person or project county.','Original source bodies, abstracts, contact details and profiles are not retained.'], 'sourceStatus':'source_reported_unreviewed','accounts':[], 'coverage':{'broadRootChecksAreProjects':False,'publicationAuthorized':False}}
 for group,(filename,fields) in TABLES.items():
  with (SOURCE/filename).open(newline='',encoding='utf-8-sig') as f:
   reader=csv.DictReader(f)
   if any(field not in reader.fieldnames for field in fields): raise ValueError('missing expected column '+filename)
   records=[]
   for n,row in enumerate(reader,2):
    record={'sourceRef':{'file':filename,'row':n},'publicationAuthorized':False,'reviewState':'source_reported_unreviewed'}
    record.update({field:safe(row[field]) for field in fields})
    # A bounded label, not the prose review record, retains classifications when explicitly marked.
    if group in ('studentReview','publicationReview'):
     match=re.search(r'\*\*([^*\n]{1,100})\*\*',row['review_record'])
     record['reportedReviewLabel']=safe(match.group(1)) if match else None
     if group == 'publicationReview':
      links=re.findall(r'https://github\.com/[^\s)\]>]+', row['review_record'])
      record['reportedReviewGithubLinks']=[safe(link.rstrip('.,;')) for link in links]
    records.append(record)
   result[group]=records
 # Account labels are source-scoped associations, not distinct people.
 seen=set()
 for r in result['repositories']:
  key=(r['account'],r['lab'])
  if key not in seen:
   seen.add(key); result['accounts'].append({'account':key[0],'reportedContext':key[1],'sourceRef':r['sourceRef'],'publicationAuthorized':False,'reviewState':'source_reported_unreviewed'})
 result['coverage'].update({'counts':{k:len(result[k]) for k in TABLES},'accountContextAssociations':len(result['accounts'])})
 data=(json.dumps(result,indent=2,ensure_ascii=False)+'\n').encode()
 manifest={'version':1,'intake':'drexel','sourceThreadId':result['sourceThreadId'],'sourceChecksumManifestSha256':manifest_hash,'sourceFilesSha256':hashes,'sourceFileCount':len(hashes),'sourceChecksumVerification':'all supplied manifest entries matched actual bytes; manifest itself separately hashed','networkRequests':0,'sourceScriptsExecuted':False,'publicationAuthorized':False,'files':{'source-assertions.json':{'sha256':digest(data),'bytes':len(data)}},'counts':result['coverage']['counts']}
 return {'source-assertions.json':data,'manifest.json':(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n').encode()}

def main():
 parser=argparse.ArgumentParser(); parser.add_argument('--check',action='store_true'); parser.add_argument('--output',type=Path)
 args=parser.parse_args()
 if args.check and args.output: parser.error('--check and --output cannot be combined')
 check=args.output is None; out=RETAINED if check else args.output.resolve()
 if not check:
  if not out.is_relative_to(Path('/workspace')) or out==Path('/workspace') or out.is_relative_to(SOURCE.resolve()): parser.error('output must be outside source and under /workspace')
  if out.exists() or out.is_symlink(): parser.error('output directory already exists')
 files=render()
 if check:
  for name,data in files.items():
   if not (out/name).is_file() or (out/name).read_bytes()!=data: raise SystemExit('FAIL: output differs or missing: '+name)
  print('PASS: deterministic replay matches retained output')
 else:
  out.mkdir(parents=True,exist_ok=False)
  for name,data in files.items():
   with (out/name).open('xb') as f: f.write(data)
  print('Wrote',out)
if __name__=='__main__': main()
