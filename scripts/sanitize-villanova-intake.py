#!/usr/bin/env python3
"""Offline, source-pinned Villanova report extraction; version 1."""
import argparse, hashlib, json, re
from pathlib import Path
from urllib.parse import urlsplit

SOURCE=Path('/workspace/worktrees/builderbob/thevalleydesk/work/villanova-health-github-research-20261116/README.md')
OUT=Path(__file__).resolve().parents[1]/'docs/discovery/go-live/evidence/GL05/regional-expansion-20261117/villanova'
SHA='a2f7be3d83f180a020de88498a6bca0fcaa7d0537c2bde15ca0aa454c13c1b80'
GH=re.compile(r'https://github\.com/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)?')
LINK=re.compile(r'\]\((https?://[^)]+)\)')
LABS={'Optical-Brain-Imaging-Lab','computingx-lab','VU-DETAIL','villanova-transportation','LUV-Lab'}
PERSONS={'Meltem Izzetoglu':'BEACONS director reported','Ruiyang Qin':'ComputingX director reported','Xun Jiao':'DETAIL director reported','Chenfeng Xiong':'NovaMobility director reported','Grant Berry':'LUV director reported','Zuyi Huang':'Biological and Environmental Systems Engineering director reported','Ziyu Song':'graduate researcher reported','Peter Chi':'historical Villanova researcher; subsequent UC San Diego move reported','Dana Opulente':'Villanova biology affiliation reported','Nathaniel Greene':'MIND association reported','Stephen Slovensky':'Villanova association reported by Jefferson roster','Andrew Chen':'earlier Villanova work reported','Peleg Kremer':'Kremer Lab association reported','Weiyu Luo':'NovaMobility research association reported'}
SPECIAL={'Optical-Brain-Imaging-Lab/fNIRS':'reported fork of Jgigantino31/fNIRS','Jgigantino31/fNIRS':'reported source project for lab fork','Optical-Brain-Imaging-Lab/.github':'profile configuration, not research project','VU-DETAIL/MoleHD':'MoleHD lab-hosted version; same reported project as author-hosted versions','dongning-ma/MoleHD':'MoleHD author-hosted version; same reported project, no account identity merge','ThapaRahul/MoleHD':'MoleHD author-hosted version; same reported project, no account identity merge','nathanielrgreene/cognitive-aging-modeling':'fork of tutorial project predating Greene Villanova appointment','stephenrho/cognitive-aging-modeling':'tutorial project predating Greene Villanova appointment','andChen2026/NIRS-Processing':'Huppert Lab research; Villanova connection not established','Climate-CAFE/NIEHS-EHLC_Data_Harmonization':'public copy; original NIEHS URL reported 404; official move and byte identity unverified','KyleTDavid/YeastConvergence2025':'older YeastConvergence2024 URL reported redirect; native equivalence unverified','DanaO523/TraitAssociations':'2018 study predates reported Villanova affiliation','VU-AACD/KeyboardSecondDisplay':'student capstone; no verified lab status','sarahjhamilton/open3D_EIT_data':'data and supporting files; complete reconstruction software unverified'}
QUAL=['Inventory is a bounded historical search, not a current census; missing findings do not establish absence.','The five lab-branded accounts are distinct from personal, collaborator, consortium and capstone accounts.','No current employment, account ownership, repository authorship, project worksite, or county is independently verified by this intake.','General yeast biology, neuroscience and quantitative methods require separate healthcare-purpose review.','An author acknowledgement, third-party tool citation, or intended release does not establish project authorship or public code.','A researcher affiliation does not attribute every personal account repository to Villanova.','No source network access, fresh account lookup, native redirect validation, or article-body extraction occurred.']

def rec(b): return {'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
def enc(x): return (json.dumps(x,indent=2,ensure_ascii=False)+'\n').encode()
def safe(u):
    p=urlsplit(u)
    if p.scheme!='https' or not p.hostname or p.username or p.password: raise ValueError('unsafe link')
    return u

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--check',action='store_true');ap.add_argument('--output',type=Path);a=ap.parse_args()
    if a.check and a.output: ap.error('choose check or output')
    if a.output:
        p=a.output
        if not p.is_absolute() or '..' in p.parts or any(x.is_symlink() for x in (p,*p.parents)): ap.error('absolute non-symlink path without traversal required')
        out=p.resolve()
        if not out.is_relative_to(Path('/workspace')) or out==Path('/workspace') or out.is_relative_to(SOURCE.parent) or out.exists(): ap.error('new output directory under workspace required')
    else: out=OUT
    if SOURCE.is_symlink() or any(x.is_symlink() for x in SOURCE.parents): raise ValueError('symlink source')
    raw=SOURCE.read_bytes()
    if rec(raw)['sha256']!=SHA: raise ValueError('source changed; review required')
    lines=raw.decode('utf-8').splitlines(); records={}; section=''; subsection=''
    for n,line in enumerate(lines,1):
        if line.startswith('## '): section=line[3:];subsection=''
        elif line.startswith('### '): subsection=line[4:]
        urls=list(dict.fromkeys(safe(u) for u in LINK.findall(line) if not u.startswith('https://github.com/')))
        for match in GH.finditer(line):
            u=match.group(); key=u.removeprefix('https://github.com/'); v=records.setdefault(key,{'url':u,'sourceRefs':[],'evidenceUrls':[],'reportedSections':[]})
            ref=f'README.md#L{n}'
            if ref not in v['sourceRefs']: v['sourceRefs'].append(ref)
            for x in urls:
                if x not in v['evidenceUrls']:v['evidenceUrls'].append(x)
            context=subsection or section
            if context not in v['reportedSections']:v['reportedSections'].append(context)
    if len(records)!=83 or sum('/' not in k for k in records)!=17: raise ValueError('unexpected source inventory')
    accounts=[]; projects=[]
    for key,v in sorted(records.items(),key=lambda x:x[0].lower()):
        common={'id':key.lower(),**v,'nativeId':None,'currentAffiliationVerified':False,'ownershipVerified':False,'publicationAuthorized':False}
        if '/' not in key:
            common.update({'handle':key,'reportedAccountType':'lab-branded' if key in LABS else 'capstone' if key=='VU-AACD' else 'person-or-other-source-reported','reportedContext':'No public repositories observed at snapshot' if key=='slovenskys' else None})
            accounts.append(common)
        else:
            common.update({'reportedRelationship':SPECIAL.get(key,'source-reported repository association; inspect source references'), 'healthPurposeStatus':'not independently reviewed','currentInstitutionalOwnership':None})
            projects.append(common)
    people=[]
    for name,role in PERSONS.items():
        refs=[f'README.md#L{i}' for i,line in enumerate(lines,1) if name in line]
        if not refs: raise ValueError('missing person occurrence')
        people.append({'name':name,'reportedProfessionalContext':role,'sourceRefs':refs,'nativeId':None,'currentAffiliation':None,'accountOwnershipEstablished':False,'publicationAuthorized':False})
    external=[]
    for needle,purpose in [('https://gitlab.com/openconnectedmed/clasim/clasim_software_only','medical-device and virtual-patient simulation'),('https://www.frontiersin.org/journals/pharmacology/articles/10.3389/fphar.2021.686201/full#supplementary-material','drug-combination analysis R scripts in supplementary material')]:
        matches=[(i,line) for i,line in enumerate(lines,1) if needle in line]
        if len(matches)!=1: raise ValueError('external resource missing or duplicated')
        n,line=matches[0]
        external.append({'url':safe(needle),'purpose':purpose,'resourceType':'external-code-resource','sourceRefs':[f'README.md#L{n}'],'evidenceUrls':[safe(u) for u in LINK.findall(line) if u!=needle and not u.startswith('https://github.com/')],'nativeId':None,'publicationAuthorized':False})
    citations=[]
    for i,line in enumerate(lines,1):
        for u in dict.fromkeys(LINK.findall(line)):
            if not u.startswith('https://github.com/'):
                citations.append({'url':safe(u),'sourceRef':f'README.md#L{i}'})
    obs=[{'subject':'slovenskys','statement':'Source observed zero public repositories during search; later state unverified.','sourceRefs':records['slovenskys']['sourceRefs']},{'subject':'YeastConvergence2024','statement':'Source reports redirect to YeastConvergence2025; not independently verified or treated as native equivalence.','sourceRefs':records['KyleTDavid/YeastConvergence2025']['sourceRefs']},{'subject':'NIEHS original environmental-health URL','statement':'Source reports original URL returned 404; Climate-CAFE copy not verified as official move.','sourceRefs':records['Climate-CAFE/NIEHS-EHLC_Data_Harmonization']['sourceRefs']}]
    result={'schemaVersion':'villanova-source-assertions-v1','sourceId':'villanova-health-github-research-20261116','snapshotDate':'2026-11-16','publicationAuthorized':False,'coverage':{'reportedGithubUrls':len(records),'accounts':len(accounts),'repositoryPaths':len(projects),'externalCodeResources':len(external),'labBrandedAccounts':5,'status':'bounded source report'},'qualifications':QUAL,'accounts':accounts,'projects':projects,'externalResources':external,'professionalOccurrences':people,'sourceObservations':obs,'citations':citations}
    data=enc(result);manifest=enc({'schemaVersion':'villanova-intake-manifest-v1','date':'2026-11-16','status':'offline historical source report; publication unauthorized','inputs':{'README.md':rec(raw)},'outputs':{'source-assertions.json':rec(data)}})
    expected={'source-assertions.json':data,'manifest.json':manifest}
    if a.output:
        out.mkdir(mode=0o700,parents=True)
        for f,b in expected.items():
            with (out/f).open('xb') as h:h.write(b)
        print('Created',out)
    else:
        if out.is_symlink() or not out.is_dir() or set(x.name for x in out.iterdir())!=set(expected): raise SystemExit('FAIL unexpected or missing output')
        for f,b in expected.items():
            if (out/f).is_symlink() or not (out/f).is_file() or (out/f).read_bytes()!=b: raise SystemExit('FAIL output differs: '+f)
        print('PASS byte-identical Villanova intake')
    if SOURCE.read_bytes()!=raw: raise SystemExit('FAIL source changed during intake')
if __name__=='__main__':main()
