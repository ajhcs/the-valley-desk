#!/usr/bin/env python3
"""Offline, allowlisted Cooper evidence intake. Never executes or modifies inputs."""
import argparse
import csv
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

ROOT = Path('/workspace/data/builderbob')
NETWORK = ROOT / 'cooper-affiliation-network-20261117'
DISCOVERY = ROOT / 'cooper-github-discovery-20261117'
OUT = Path(__file__).resolve().parents[1] / 'docs/discovery/go-live/evidence/GL05/regional-import-20261117/cooper'
EMAIL = re.compile(r'[\w.+-]+@[\w.-]+')

def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def rows(path):
    with path.open(encoding='utf-8', newline='') as f:
        return list(csv.DictReader(f))

def lean(s):
    if EMAIL.search(s):
        raise ValueError('Contact-like value in allowlisted text; review source locally')
    return s

def url(s):
    if not s:
        return None
    p = urlsplit(s)
    if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password:
        raise ValueError('Unsafe source URL')
    # Queries and fragments are not required for provenance and could carry tokens.
    return urlunsplit((p.scheme, p.netloc, p.path, '', ''))

def pointer(name, number):
    return f'{name}#row={number}'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true', help='check retained output (default)')
    parser.add_argument('--output', type=Path, help='create a new output directory under /workspace')
    args = parser.parse_args()
    if args.check and args.output:
        parser.error('--check and --output cannot be combined')
    check = args.output is None
    output = OUT if check else args.output.resolve()
    if not check:
        if not output.is_relative_to(Path('/workspace')) or output == Path('/workspace'):
            parser.error('output must be a new directory under /workspace')
        if output.exists() or output.is_symlink():
            parser.error('output directory already exists')
        if any(output.is_relative_to(p.resolve()) for p in (NETWORK, DISCOVERY)):
            parser.error('output cannot be inside source')
    node_rows = rows(NETWORK / 'nodes.csv')
    edge_rows = rows(NETWORK / 'edges.csv')
    nodes = []
    for i, r in enumerate(node_rows, 2):
        nodes.append({'id':r['id'], 'type':r['type'], 'label':lean(r['label']), 'url':url(r['url']), 'sourcePointer':pointer('nodes.csv',i), 'publicationAuthorized':False})
    ids = {n['id'] for n in nodes}
    if len(ids) != len(nodes):
        raise ValueError('Duplicate source node IDs')
    edges = []
    for i,r in enumerate(edge_rows,2):
        if r['source_id'] not in ids or r['target_id'] not in ids:
            raise ValueError('Source edge refers to absent node')
        edges.append({'id':f'cooper-network:edges.csv:{i}', 'source':r['source_id'], 'target':r['target_id'], 'relationship':lean(r['relationship']), 'evidenceUrl':url(r['evidence_url']), 'reportedConfidence':lean(r['confidence']), 'status':'source_reported_not_independently_verified', 'sourcePointer':pointer('edges.csv',i), 'publicationAuthorized':False})
    inventory = []
    for i,r in enumerate(rows(DISCOVERY / 'inventory.csv'),2):
        inventory.append({'kind':r['kind'], 'name':lean(r['name']), 'githubUrl':url(r['github_url']), 'reportedPerson':lean(r['cooper_affiliated_person']) or None, 'reportedRelationship':lean(r['relationship']), 'evidenceUrl':url(r['evidence_url']), 'reportedLookup':lean(r['github_lookup']), 'sourcePointer':pointer('inventory.csv',i), 'status':'source_reported_not_independently_verified', 'publicationAuthorized':False})
    identity=[]
    for i,r in enumerate(rows(NETWORK / 'identity_review.csv'),2):
        # Similar repository is not an established replacement; do not propagate it as an alias.
        replacement = r['subject']=='Raquel Nahra study code'
        identity.append({'subject':lean(r['subject']), 'candidateUrl':None if replacement else url(r['candidate_url']), 'reportedClassification': 'unverified replacement omitted' if replacement else lean(r['assessment']), 'evidenceUrls':[u for u in ([url(r['evidence_1'])] if replacement else [url(r['evidence_1']),url(r['evidence_2'])]) if u], 'sourcePointer':pointer('identity_review.csv',i), 'status':'source_reported_not_person_authentication', 'publicationAuthorized':False})
    recovery=[]
    for i,r in enumerate(rows(NETWORK / 'fulltext_recovery.csv'),2):
        recovery.append({'pmcid':r['pmcid'], 'reportedStatus':lean(r['recovery_status']), 'evidenceUrl':url(r['evidence_url']), 'githubUrl':url(r['github_url']), 'sourcePointer':pointer('fulltext_recovery.csv',i), 'publicationAuthorized':False})
    excluded=[]
    for i,r in enumerate(rows(NETWORK / 'metadata_screen_excluded.csv'),2):
        excluded.append({'id':r['id'], 'title':lean(r['title']), 'status':'source_excluded_from_automatic_graph', 'sourcePointer':pointer('metadata_screen_excluded.csv',i), 'publicationAuthorized':False})
    coverage=[]
    for i,r in enumerate(rows(DISCOVERY / 'coverage.csv'),2):
        coverage.append({'subject':lean(r['name']), 'sourceUrl':url(r['scope_source']), 'reportedOutcome':lean(r['bounded_result']), 'status':'source_reported_bounded_search', 'sourcePointer':pointer('coverage.csv',i), 'publicationAuthorized':False})
    sources={}
    for directory in (NETWORK, DISCOVERY):
        for p in sorted(directory.iterdir()):
            if p.is_file(): sources[f'{directory.name}/{p.name}']=digest(p)
    for p in (ROOT/'cooper-research-network-20261117.zip',ROOT/'cooper-research-network-20261117.zip.sha256'):
        sources[p.name]=digest(p)
    expected=(ROOT/'cooper-research-network-20261117.zip.sha256').read_text().split()[0]
    if digest(ROOT/'cooper-research-network-20261117.zip') != expected:
        raise ValueError('Original archive checksum mismatch')
    result={'id':'cooper-affiliation-network-20261117:source-scoped','sourceStatus':'reported assertions, not independently verified','publicationAuthorized':False,'notes':['Node IDs and row-level edge identities are scoped to this source; no cross-source identity merge performed.', 'Original source may already consolidate people by ORCID. Author edges are retained individually; source-absent author ordinals cannot be reconstructed.', 'Cooper University Health Care, Cooper Medical School of Rowan University, and Coriell remain distinct. County affiliation does not prove person or project worksite.', 'pwang2019 owner is unresolved; pwang2019/GxE_Model is held for non-health agricultural relevance review.', 'The source reports lillianhaine/GitCode as 404 or inaccessible. No replacement alias is asserted.', 'Prior identity classifications including Sangita-pixel and sterrettJD are source-reported, not native account authentication.'], 'sourceHashesSha256':sources,'nodes':nodes,'edges':edges,'inventory':inventory,'identityReview':identity,'recovery':recovery,'metadataScreenExcluded':excluded,'coverage':coverage,'holds':[{'subject':'https://github.com/pwang2019/GxE_Model','classification':'nonhealth_agricultural_relevance_hold','publicationAuthorized':False},{'subject':'https://github.com/lillianhaine/GitCode','classification':'source_reported_404_or_inaccessible_no_alias','publicationAuthorized':False},{'subject':'https://github.com/pwang2019','classification':'personal_ownership_unresolved','publicationAuthorized':False}]}
    data=(json.dumps(result,indent=2,ensure_ascii=False)+'\n').encode()
    target=output/'cooper-source-assertions.json'
    if check:
        if not target.exists() or target.read_bytes()!=data: raise SystemExit('FAIL: output differs or missing')
        print('PASS: deterministic replay matches retained output')
    else:
        output.mkdir(parents=True,exist_ok=False)
        if target.exists(): raise SystemExit('Refusing to overwrite existing intake; use --check')
        with target.open('xb') as f: f.write(data)
        print('Wrote',target)
    print(f'{len(nodes)} nodes, {len(edges)} edges, {len(inventory)} inventory, {len(identity)} identity, {len(recovery)} recovery, {len(excluded)} exclusions, {len(coverage)} coverage')
if __name__=='__main__': main()
