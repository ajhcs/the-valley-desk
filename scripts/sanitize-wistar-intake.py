#!/usr/bin/env python3
"""Reproduce a private, offline Wistar metadata intake without executing inputs."""
import argparse
import csv
import hashlib
import importlib.util
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('/workspace/worktrees/builderbob/thevalleydesk/work/wistar-github-census-20261116')
RETAINED = ROOT / 'docs/discovery/go-live/evidence/GL05/regional-additions-20261117/wistar'
THREAD = '01a1e754-f637-7141-a610-dd146aab4937'
FILES = ('README.md', 'build_inventory.py', 'render_report.py', 'github-accounts.csv', 'labs-and-people.csv', 'organization-repositories.csv')
TABLES = {
 'github-accounts.csv': ('account', 'github_url', ['name_or_identity', 'github_login', 'account_type', 'related_investigator', 'github_url', 'public_repositories', 'evidence_summary', 'evidence_url_1', 'evidence_url_2', 'checked_utc']),
 'labs-and-people.csv': ('coverage', 'wistar_profile_url', ['investigator', 'wistar_profile_url', 'lab_organization_accounts', 'investigator_accounts', 'team_or_project_accounts', 'collaboration_or_shared_links', 'status', 'notes']),
 'organization-repositories.csv': ('repository', 'github_url', ['github_organization', 'repository_name', 'github_url', 'fork', 'archived', 'created_utc', 'last_push_utc', 'checked_utc']),
}
QUALIFICATIONS = [
 'All metadata, dates, counts, classifications, and associations are source-reported and unreviewed; publication is not authorized.',
 'The 43 directory entries are coverage observations, not a count of 43 labs; 33 entries report no established investigator or lab account.',
 'The 28 account profiles include 3 lab organizations, 2 shared Wistar-branded accounts, and 23 personal or project accounts; they are not all owned by Wistar.',
 'Formal governance of Wistar-bioinfo is unconfirmed. The AuslanderNoam and noamaus identities are inferred and their reported work includes pre-Wistar context; do not merge handles as native identities.',
 'Tian members are historical. McGinnis UCSF, Wu Penn, and Zhou UW profiles do not establish current projects or worksite.',
 'RNAPolymerase12, jmalnak, and Yeqing95 remain unresolved; external Schiffner collaborators do not establish current Wistar jobs.',
 'Source dates, case, distinct handles, and reported qualifiers are retained as supplied; no native identity is established.',
 'Original article, README, biography, and contact bodies are not retained; source scripts are hashed only and never executed.',
]
spec = importlib.util.spec_from_file_location('drexel_sanitizer', ROOT / 'scripts/sanitize-drexel-intake.py')
drexel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(drexel)

def digest(data):
 return hashlib.sha256(data).hexdigest()

def safe_url(value):
 value = value.strip()
 if not value.startswith('https://') or drexel.safe(value) != value:
  return None
 try:
  u = urlsplit(value)
  return value if u.hostname and not u.username and not u.password and not re.search(r'\s', value) else None
 except ValueError:
  return None

def extract_urls(values):
 urls = []
 for value in values:
  for raw in re.findall(r'https://[^\s|]+', value or ''):
   # Semicolons in this source separate links; keep URL query and fragment bytes.
   candidate = raw if '?' in raw or '#' in raw else raw.rstrip('.,;)]}>')
   link = safe_url(candidate)
   if link and link not in urls: urls.append(link)
 return urls

def render():
 inputs = {}
 for name in FILES:
  p = SOURCE / name
  if p.is_symlink() or not p.is_file():
   raise ValueError('missing or symlink source: ' + name)
  data = p.read_bytes()
  inputs[name] = {'sha256': digest(data), 'bytes': len(data)}
 records = []
 counts = {}
 for filename, (kind, urlfield, fields) in TABLES.items():
  count = 0
  with (SOURCE / filename).open(newline='', encoding='utf-8-sig') as stream:
   reader = csv.DictReader(stream)
   if reader.fieldnames != fields:
    raise ValueError('unexpected columns: ' + filename)
   while True:
    line = reader.line_num + 1
    try: row = next(reader)
    except StopIteration: break
    if None in row: raise ValueError('extra CSV field: ' + filename)
    ref = f'{filename}#row={line}'
    metadata = {field: drexel.safe(row[field]) for field in fields}
    # Preserve safe links even if a future source cell exceeds safe()'s limit.
    urls = extract_urls(row[field] for field in fields)
    metadata['sourceUrls'] = json.dumps(urls, ensure_ascii=False, separators=(',', ':'))
    metadata['proseTruncated'] = 'true' if any(len(re.sub(r'[\x00-\x1f\x7f]+', ' ', row[f] or '').strip()) > 1000 for f in fields) else 'false'
    records.append({'id': 'wistar:' + ref.replace('#', ':', 1), 'kind': kind,
                    'url': safe_url(row[urlfield]), 'nativeId': None, 'sourceRef': ref,
                    'metadata': metadata, 'publicationAuthorized': False, 'reviewState': 'source_reported_unreviewed'})
    count += 1
  counts[filename] = count
 result = {'schemaVersion': 'regional-source-intake-v1', 'batch': 'wistar', 'visibility': 'private', 'publicationAuthorized': False,
           'sourceThreadId': THREAD, 'records': records, 'coverage': {'perFileRowCounts': counts}, 'qualifications': QUALIFICATIONS}
 data = (json.dumps(result, indent=2, ensure_ascii=False) + '\n').encode()
 manifest = {'schemaVersion': 'regional-source-intake-manifest-v1', 'batch': 'wistar', 'sourceThreadId': THREAD, 'inputs': inputs,
             'outputs': {'source-assertions.json': {'sha256': digest(data), 'bytes': len(data)}}, 'recordCount': len(records),
             'metadataPolicies': {name: fields + ['sourceUrls', 'proseTruncated'] for name, (_, _, fields) in TABLES.items()},
             'sourceRequests': 0, 'suppliedScriptsExecuted': False, 'publicationAuthorized': False}
 return {'source-assertions.json': data, 'manifest.json': (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode()}

def output_path(raw):
 if not raw.is_absolute() or '..' in raw.parts or not raw.is_relative_to('/workspace') or raw == Path('/workspace'):
  raise ValueError('output must be an absolute new directory below /workspace, without traversal')
 current = Path('/')
 for part in raw.parts[1:]:
  current /= part
  if current.is_symlink(): raise ValueError('output path contains symlink')
 if raw.exists(): raise ValueError('output already exists')
 resolved = raw.resolve()
 if resolved.is_relative_to(SOURCE.resolve()) or SOURCE.resolve().is_relative_to(resolved):
  raise ValueError('output overlaps source')
 return raw

def main():
 parser = argparse.ArgumentParser()
 parser.add_argument('--check', action='store_true')
 parser.add_argument('--output', type=Path)
 args = parser.parse_args()
 if args.check and args.output: parser.error('--check and --output cannot be combined')
 try:
  out = output_path(args.output) if args.output else RETAINED
  files = render()
  if not args.output:
   for name, data in files.items():
    if not (out / name).is_file() or (out / name).read_bytes() != data:
     raise ValueError('output differs or missing: ' + name)
   print('PASS: deterministic replay matches retained output')
  else:
   out.mkdir(parents=True, exist_ok=False)
   for name, data in files.items():
    with (out / name).open('xb') as f: f.write(data)
   print('Wrote', out)
 except (ValueError, OSError) as exc:
  parser.exit(1, f'FAIL: {exc}\n')
if __name__ == '__main__': main()
