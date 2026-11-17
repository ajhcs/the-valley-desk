#!/usr/bin/env python3
"""Version 1: deterministic offline ChristianaCare source metadata intake."""
import argparse, csv, hashlib, io, json, os, re
from pathlib import Path
from urllib.parse import urlsplit

SOURCE = Path('/workspace/worktrees/builderbob/thevalleydesk/work/christianacare-github-research-20261117')
OUT = Path(__file__).resolve().parents[1] / 'docs/discovery/go-live/evidence/GL05/regional-import-20261117/christiana'
FILES = ('README.md','research-network.md','research-census-and-method.md','github-accounts.csv')
GITHUB = re.compile(r'https://github\.com/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)?')
LINK = re.compile(r'\]\((https?://[^)]+)\)')
KINDS = {'healthylaife/fhir':'multi_institution_study_code','jlywebster/cdiff_ccmlm':'coauthored_study_code','goldsteinepi/sepsis':'former_staff_study_code','Binod-Acharya/Nepal-Suicide':'coauthored_study_code','avisrilab/bagpiper':'institutional_partnership_second_degree_lead','paulhager/MIMIC-Clinical-Decision-Making-Dataset':'coauthored_study_dataset','paulhager/MIMIC-Clinical-Decision-Making-Framework':'coauthored_study_code','paulhager/MIMIC-Clinical-Decision-Making-Analysis':'coauthored_study_code','Shenhav-Lab/Visionary-AI-HDP':'coauthored_study_code','CBICA/AI-guided-radiation-dose-escalation':'coauthored_study_code','CBICA/BrainMaGe':'coauthored_study_code','hrmoradi/Therapeutics':'coauthored_study_code','kernco/functional-annotation':'former_staff_unrelated_pipeline','Clinical3PO/Platform':'external_site_pilot','PugtgYosuky/AI4Birth':'prior_data_consortium_membership_only'}

def receipt(b): return {'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
def encoded(x): return (json.dumps(x,indent=2,ensure_ascii=False)+'\n').encode()
def safeurl(s):
    p=urlsplit(s)
    if p.scheme != 'https' or not p.hostname or p.username or p.password or p.fragment: raise ValueError('unsafe URL')
    return s

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--check',action='store_true'); ap.add_argument('--output',type=Path); a=ap.parse_args()
    if a.check and a.output: ap.error('choose check or output')
    check=a.output is None
    if check: out=OUT
    else:
        supplied=a.output
        if not supplied.is_absolute() or '..' in supplied.parts: ap.error('absolute output path without traversal required')
        if any(p.is_symlink() for p in (supplied,*supplied.parents)): ap.error('symlink output path forbidden')
        out=supplied.resolve()
        if not out.is_relative_to(Path('/workspace')) or out == Path('/workspace') or out.is_relative_to(SOURCE.resolve()) or out.exists(): ap.error('output must be a new directory under /workspace outside source')
    if SOURCE.is_symlink() or any((SOURCE/f).is_symlink() for f in FILES): raise ValueError('symlink input forbidden')
    inputs={f:(SOURCE/f).read_bytes() for f in FILES}
    rows=list(csv.DictReader(io.StringIO(inputs['github-accounts.csv'].decode('utf-8'),newline='')))
    if len(rows)!=18 or any(set(r)!= {'name','relationship','github_url','evidence_summary','evidence_url'} for r in rows): raise ValueError('unexpected CSV schema or count')
    allowed_relationships={'institution','former researcher','former researcher and collaborator','partner lab','research collaborator','partner institution lab','research collaborator lab','research collaborator center','research initiative','external research platform','data consortium project','unverified institutional lead'}
    accounts=[]
    for i,r in enumerate(rows,2):
        if r['relationship'] not in allowed_relationships or not re.fullmatch(r"[A-Za-z0-9 .&'-]+",r['name']): raise ValueError('unexpected account metadata')
        url=safeurl(r['github_url']); handle=url.removeprefix('https://github.com/')
        if not re.fullmatch(r'[A-Za-z0-9_.-]+',handle): raise ValueError('invalid account')
        scope='historical-2009-2011' if handle=='kernco' else 'snapshot-2026-11-17'
        accounts.append({'id':handle.lower(),'handle':handle,'url':url,'reportedLabel':r['name'],'relationship':r['relationship'],'timeScope':scope,'regionPolicy':'neighbor-context' if handle in ('ChristianaCare','ChristianaCareTest','kernco') else 'collaborator-lead-assess-independently','evidenceUrls':[safeurl(r['evidence_url'])],'sourceRefs':[f'github-accounts.csv#L{i}'],'currentAffiliationVerified':False,'ownershipVerified':False,'publicationAuthorized':False})
    if len({x['id'] for x in accounts})!=18: raise ValueError('duplicate account')
    network=inputs['research-network.md'].decode('utf-8').splitlines(); projects=[]; seen=set()
    github_links={m.group(0) for line in network for m in GITHUB.finditer(line)}
    if len(github_links)!=28 or sum(u.removeprefix('https://github.com/').count('/')==0 for u in github_links)!=13: raise ValueError('network GitHub link coverage changed')
    for line_no,line in enumerate(network,1):
        links=LINK.findall(line)
        repos={m.group(0).removeprefix('https://github.com/') for m in GITHUB.finditer(line) if m.group(0).removeprefix('https://github.com/').count('/')==1}
        for repo in sorted(repos):
            if repo not in KINDS or repo in seen: raise ValueError('unexpected or duplicate project')
            seen.add(repo)
            evidence=list(dict.fromkeys(safeurl(u) for u in links if not u.startswith('https://github.com/')))
            projects.append({'id':repo.lower(),'url':'https://github.com/'+repo,'reportedConnectionType':KINDS[repo],'timeScope':'historical-2009-2011-former-role' if repo.startswith('kernco/') else 'snapshot-2026-11-17','regionPolicy':'collaborator-lead-assess-independently','evidenceUrls':evidence,'sourceRefs':[f'research-network.md#L{line_no}'],'currentAffiliationVerified':False,'ownershipVerified':False,'publicationAuthorized':False})
    if seen!=set(KINDS): raise ValueError('network repository set changed')
    result={'schemaVersion':'christiana-source-assertions-v1','sourceId':'christianacare-github-research-20261117','snapshotDate':'2026-11-17','publicationAuthorized':False,'coverage':{'networkUniqueGithubLinks':28,'networkRepositoryLinks':15,'networkAccountLinks':13,'csvAccounts':18,'status':'source-reported bounded research; no current people count'},'qualifications':['Nine-county DVRPC is primary; Delaware ChristianaCare is neighboring context. Collaborators require independent regional assessment.','Institutional account reported zero public repositories at snapshot; private repositories were not surveyed.','No personal GitHub for a current ChristianaCare researcher was independently verified in the source search.','Kern former research assistant role was September 2009 to August 2011; his present work is not attributed to ChristianaCare.','AI4Birth link reflects prior data-consortium membership, not established authorship of the later paper.','External project participation does not establish ChristianaCare account or code ownership.','All records are source-reported, without fresh verification; source references preserve claim context.'],'accounts':accounts,'projects':projects}
    data=encoded(result); manifest=encoded({'schemaVersion':'christiana-intake-manifest-v1','date':'2026-11-17','status':'offline source-reported intake; publication unauthorized','inputs':{f:receipt(inputs[f]) for f in FILES},'outputs':{'source-assertions.json':receipt(data)}})
    expected={'source-assertions.json':data,'manifest.json':manifest}
    if check:
        for f,b in expected.items():
            if (out/f).is_symlink() or not (out/f).is_file() or (out/f).read_bytes()!=b: raise SystemExit('FAIL: retained output differs: '+f)
        if set(p.name for p in out.iterdir())!=set(expected): raise SystemExit('FAIL: unexpected retained output')
        print('PASS: byte-identical ChristianaCare intake and manifest')
    else:
        out.mkdir(mode=0o700,parents=True)
        for f,b in expected.items():
            with (out/f).open('xb') as h: h.write(b)
        print('Created',out)
    if any((SOURCE/f).read_bytes()!=inputs[f] for f in FILES): raise SystemExit('FAIL: source changed during intake')
if __name__=='__main__': main()
