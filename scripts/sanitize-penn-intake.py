#!/usr/bin/env python3
"""Offline Penn CSV intake. Never executes supplied scripts or contacts sources."""
import argparse
import csv
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

SOURCE = Path('/workspace/worktrees/builderbob/thevalleydesk/work/penn-biomedical-github-inventory-20261117')
OUTPUT = Path(__file__).resolve().parents[1] / 'docs/discovery/go-live/evidence/GL05/regional-import-20261117/penn'
FILES = ['accounts.csv', 'public-repositories.csv', 'researcher-projects.csv', 'project-link-checks.csv', 'snapshot-status.csv', 'excluded-leads.csv', 'round2-accounts-added.csv', 'round2-account-status.csv', 'round2-projects-added.csv', 'round2-project-evidence.csv', 'round2-project-link-checks.csv', 'round2-fork-parent-checks.csv', 'README.md']
EMAIL = re.compile(r'\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b')
PHONE = re.compile(r'(?<!\w)(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\w)')
URL = re.compile(r'https?://\S+', re.I)

def text(value, limit=1000):
    value = re.sub(r'[\x00-\x1f\x7f]+', ' ', value or '').strip()
    value = EMAIL.sub('[contact removed]', value)
    value = PHONE.sub('[contact removed]', value)
    value = URL.sub('[link removed]', value)
    return value[:limit] or None

def link(value):
    if not value:
        return None
    u = urlsplit(value.strip())
    if u.scheme != 'https' or not u.hostname or u.username or u.password or EMAIL.search(value):
        return None
    return value.strip()

def source_kind(value):
    host = (urlsplit(value or '').hostname or '').lower()
    if host == 'github.com' or host.endswith('.github.io'):
        return 'github_or_github_pages'
    if host == 'upenn.edu' or host.endswith('.upenn.edu'):
        return 'upenn_hosted'
    if host in {'pmc.ncbi.nlm.nih.gov', 'pubmed.ncbi.nlm.nih.gov', 'www.ncbi.nlm.nih.gov', 'doi.org'}:
        return 'bibliographic_or_archive'
    return 'other_or_unknown'

def rows(name):
    with (SOURCE / name).open(newline='', encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))

def flag(value):
    return {'True': True, 'False': False}.get(value)

def dump(path, value):
    data = (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf-8')
    if CHECK:
        if not path.is_file() or path.read_bytes() != data:
            raise SystemExit(f'FAIL: output differs or missing: {path}')
    else:
        with path.open('xb') as f:
            f.write(data)

def main():
    global CHECK
    p = argparse.ArgumentParser()
    p.add_argument('--check', action='store_true', help='check retained output (default)')
    p.add_argument('--output', type=Path, help='create a new output directory under /workspace')
    args = p.parse_args()
    if args.check and args.output:
        p.error('--check and --output cannot be combined')
    CHECK = args.output is None
    args.output = OUTPUT if CHECK else args.output.resolve()
    if not CHECK:
        if not args.output.is_relative_to(Path('/workspace')) or args.output == Path('/workspace'):
            p.error('output must be a new directory under /workspace')
        if args.output.exists() or args.output.is_symlink():
            p.error('output directory already exists')
        if args.output.is_relative_to(SOURCE.resolve()):
            p.error('output cannot be inside source')
    archive = SOURCE.parent / 'penn-biomedical-github-inventory-20261117-bundle.zip'
    checksum = SOURCE.parent / (archive.name + '.sha256')
    archive_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
    checksum_hash = hashlib.sha256(checksum.read_bytes()).hexdigest()
    checksum_matches = archive_hash == checksum.read_text().split()[0]
    if not checksum_matches:
        raise ValueError('Supplied archive checksum mismatch')
    hashes = {name: hashlib.sha256((SOURCE / name).read_bytes()).hexdigest() for name in FILES}
    def common(name, n):
        return {'inputFile': name, 'inputRow': n, 'observedDate': '2026-11-17', 'observationDateBasis': 'intake date; source reports mixed-time checks, exact time per row unknown', 'publicationAuthorized': False}
    accounts=[]
    for n,r in enumerate(rows('accounts.csv'), 2):
        accounts.append({**common('accounts.csv',n), 'account':text(r['account'],100), 'accountUrl':link(r['github_url']), 'entity':text(r['entity']), 'reportedAffiliation':text(r['affiliation']), 'sourceUrl':link(r['evidence']), 'sourceKind':source_kind(r['evidence']), 'regionalPolicy':'dvrpc-candidate', 'county':None, 'currentRole':None, 'identityBasis':'source-reported account URL; no native account ID supplied', 'relationQualification':'Source observer assertion; account/person/lab ownership and present affiliation unverified.'})
    repos=[]
    for n,r in enumerate(rows('public-repositories.csv'),2):
        repos.append({**common('public-repositories.csv',n), 'account':text(r['account'],100), 'entity':text(r['entity']), 'reportedAffiliation':text(r['affiliation']), 'repository':text(r['repo'],200), 'url':link(r['github_url']), 'reportedDescription':text(r['description']), 'reportedFork':flag(r['fork']), 'reportedArchived':flag(r['archived']), 'reportedLastPushUtc':text(r['last_push_utc'],50), 'sourceUrl':link(r['account_evidence']), 'sourceKind':source_kind(r['account_evidence']), 'regionalPolicy':'dvrpc-candidate', 'county':None, 'identityBasis':'repository URL only; no native repository ID supplied', 'relationQualification':'Account snapshot does not establish health purpose, local authorship, or development location.'})
    projects=[]
    for n,r in enumerate(rows('researcher-projects.csv'),2):
        projects.append({**common('researcher-projects.csv',n), 'entity':text(r['entity']), 'url':link(r['github_url']), 'sourceUrl':link(r['evidence']), 'sourceKind':source_kind(r['evidence']), 'reportedAttribution':text(r['attribution']), 'urlKind':'path reference; not normalized to repository', 'regionalPolicy':'dvrpc-candidate', 'county':None, 'currentRole':None, 'relationQualification':'Source observer attribution; original source and identity not independently checked.'})
    checks=[]
    for name in ('snapshot-status.csv','round2-account-status.csv'):
        for n,r in enumerate(rows(name),2):
            raw=r['public_repos_returned'].strip(); error=text(r['error'])
            checks.append({**common(name,n),'kind':'account snapshot','account':text(r['account'],100),'entity':text(r['entity']),'reportedCount':int(raw) if raw.isdigit() else None,'reportedError':error,'state':'reported_error' if error else ('reported_success' if raw.isdigit() else 'unknown')})
    for name in ('project-link-checks.csv','round2-project-link-checks.csv'):
        for n,r in enumerate(rows(name),2):
            checks.append({**common(name,n),'kind':'project link','entity':text(r['entity']),'url':link(r['url']),'reportedHttpStatus':int(r['http_status']) if r['http_status'].isdigit() else None,'reportedResolvedUrl':link(r['resolved_url'])})
    for n,r in enumerate(rows('excluded-leads.csv'),2):
        checks.append({**common('excluded-leads.csv',n),'kind':'excluded lead','url':link(r['github_url']),'sourceUrl':link(r['source_url']),'reportedReason':text(r['reason']),'reportedCheckedUtc':text(r['checked_utc'],50),'state':'reported_http_404'})
    for n,r in enumerate(rows('round2-fork-parent-checks.csv'),2):
        checks.append({**common('round2-fork-parent-checks.csv',n),'kind':'fork parent','url':link(r['lab_repo']),'reportedProposedUpstream':link(r['proposed_upstream']),'reportedConfirmedParent':flag(r['confirmed_parent']),'reportedApiParent':text(r['api_parent'],250),'reportedError':text(r['error'])})
    extra=[]
    for name in ('round2-accounts-added.csv','round2-projects-added.csv','round2-project-evidence.csv'):
        for n,r in enumerate(rows(name),2):
            extra.append({**common(name,n),'account':text(r.get('account'),100),'entity':text(r.get('entity')),'reportedAffiliation':text(r.get('affiliation')),'url':link(r.get('github_url')),'sourceUrl':link(r.get('evidence')),'reportedAttribution':text(r.get('attribution'))})
    if not CHECK:
        args.output.mkdir(parents=True, exist_ok=False)
    dump(args.output/'manifest.json',{'sourceThreadId':'01a1e6ca-3fad-7261-a42e-96fb0216e57b','inputSha256':hashes,'sourceArchiveSha256':archive_hash,'archiveChecksumFileSha256':checksum_hash,'sourceArchiveChecksumVerified':checksum_matches,'sourceRoot':str(SOURCE),'publicationAuthorized':False,'identity':'URL only, not native GitHub IDs','networkRequests':0,'sourceScriptsExecuted':False,'counts':{'accounts':len(accounts),'repositoryObservations':len(repos),'projectPathObservations':len(projects),'statusObservations':len(checks),'supplementalEvidenceRows':len(extra)}})
    for name, data in [('accounts.json',accounts),('repositories.json',repos),('projects.json',projects),('status.json',checks),('supplemental-evidence.json',extra)]: dump(args.output/name,data)

    if CHECK:
        print('PASS: deterministic replay matches retained output')

if __name__ == '__main__': main()
