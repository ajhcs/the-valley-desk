#!/usr/bin/env python3
"""Determine where the private repository inventory has a regional anchor.

The public shape intentionally contains only the observed relationship and a
public URL, without the private roster context or any claims of current roles.
"""
import csv
import json
import re
import sqlite3
from urllib.parse import urlsplit, urlunsplit

PENN = 'University of Pennsylvania'
CHOP = 'Children’s Hospital of Philadelphia'
JEFFERSON = 'Thomas Jefferson University'
SJU = 'Saint Joseph’s University'
PCOM = 'Philadelphia College of Osteopathic Medicine'
CITY = 'City of Philadelphia'
DREXEL = 'Drexel University'
WISTAR = 'The Wistar Institute'
COOPER = 'Cooper University Health Care'
ROWAN = 'Rowan University'
VILLANOVA = 'Villanova University'
PRINCETON = 'Princeton University'
CAMPUS = {
    'temple.edu': ('Temple University', None),
    'drexel.edu': (DREXEL, None),
    'upenn.edu': (PENN, None),
    'pennmedicine.org': (PENN, None),
    'chop.edu': (CHOP, None),
    'jefferson.edu': (JEFFERSON, None),
    'wistar.org': (WISTAR, 'Philadelphia'),
    'monell.org': ('Monell Chemical Senses Center', 'Philadelphia'),
    'phila.gov': (CITY, 'Philadelphia'),
    'pcom.edu': (PCOM, None),
    'foxchase.org': ('Fox Chase Cancer Center', 'Philadelphia'),
    'cooperhealth.org': (COOPER, None),
    'cmsru.rowan.edu': ('Cooper Medical School of Rowan University', 'Camden'),
    'rowan.edu': (ROWAN, None),
    'coriell.org': ('Coriell Institute for Medical Research', 'Camden'),
    'camden.rutgers.edu': ('Rutgers University–Camden', 'Camden'),
    'sju.edu': (SJU, None),
    'villanova.edu': (VILLANOVA, 'Delaware'),
    'swarthmore.edu': ('Swarthmore College', 'Delaware'),
    'haverford.edu': ('Haverford College', 'Delaware'),
    'brynmawr.edu': ('Bryn Mawr College', 'Montgomery'),
    'chc.edu': ('Chestnut Hill College', 'Philadelphia'),
    'widener.edu': ('Widener University', None),
    'wcupa.edu': ('West Chester University', 'Chester'),
    'princeton.edu': (PRINCETON, 'Mercer'),
}
NAMES = [(r'cooper medical school|cmsru', 'Cooper Medical School of Rowan University', 'Camden'),
         (r'coriell', 'Coriell Institute for Medical Research', 'Camden'),
         (r'cooper health|cooper university', COOPER, None),
         (r'philadelphia college of osteopathic|\bpcom\b', PCOM, None),
         (r'fox chase', 'Fox Chase Cancer Center', 'Philadelphia'),
         (r'\bchop\b|children.s hospital of philadelphia', CHOP, None),
         (r'penn state abington', 'Penn State Abington', 'Montgomery'),
         (r'penn state great valley', 'Penn State Great Valley', 'Chester'),
         (r'\bpenn\b(?!\s+state)|upenn|university of pennsylvania|perelman', PENN, None),
         (r'princeton', PRINCETON, 'Mercer'),
         (r'rowan', ROWAN, None),
         (r'drexel', DREXEL, None),
         (r'jefferson', JEFFERSON, None),
         (r'wistar', WISTAR, 'Philadelphia'),
         (r'monell', 'Monell Chemical Senses Center', 'Philadelphia'),
         (r'temple', 'Temple University', None),
         (r'saint joseph|st joseph|\bsju\b|usciences|university of the sciences', SJU, None),
         (r'villanova', VILLANOVA, 'Delaware'),
         (r'widener', 'Widener University', None),
         (r'west chester', 'West Chester University', 'Chester'),
         (r'haverford', 'Haverford College', 'Delaware'),
         (r'swarthmore', 'Swarthmore College', 'Delaware'),
         (r'bryn mawr', 'Bryn Mawr College', 'Montgomery'),
         (r'rutgers.*camden', 'Rutgers University–Camden', 'Camden')]
NONLOCAL = re.compile(r'outside region|adjacent delaware|neighboring metro|external[- ]collaborat|identity unresolved', re.I)
LOCAL_PROFILE = re.compile(r'philadelphia|princeton|(?:^|[;,])\s*camden', re.I)
SIMPLE_CITY = re.compile(r'^(Philadelphia|Princeton|Camden)(?:,?\s+(?:PA|Pennsylvania|NJ|New Jersey))?(?:\s*[,\.]?\s*(?:USA|United States))?$', re.I)
COUNTIES = {'Bucks', 'Chester', 'Delaware', 'Montgomery', 'Philadelphia', 'Burlington', 'Camden', 'Gloucester', 'Mercer'}

def safe_url(value):
    if not isinstance(value, str) or not value.startswith('https://'):
        return None
    try:
        p = urlsplit(value)
        if p.username or p.password or p.port not in (None, 443) or not p.hostname:
            return None
    except ValueError:
        return None
    return urlunsplit((p.scheme, p.netloc, p.path, '', ''))

def domain(value):
    url = safe_url(value)
    if url:
        host = urlsplit(url).hostname
        for suffix, anchor in CAMPUS.items():
            if host == suffix or host.endswith('.' + suffix):
                return anchor
    return None, None

def affiliation(value):
    value = value or ''
    for rx, name, county in NAMES:
        if re.search(rx, value, flags=re.I):
            return name, county
    return None, None

def account_url(login):
    return 'https://github.com/' + login

def records(path):
    with path.open(newline='', encoding='utf-8') as stream:
        return list(csv.DictReader(stream))

def sorted_rows(conn, table):
    return conn.execute('SELECT * FROM ' + table)

def build_regional(inputs, *, accounts_only=False):
    network = json.loads((inputs / 'research-network.json').read_text())
    queue = json.loads((inputs / 'qualification-queue.json').read_text())
    inventory = inputs / 'inventory.sqlite'
    conn = sqlite3.connect(inventory.resolve().as_uri() + '?mode=ro&immutable=1', uri=True) if accounts_only else sqlite3.connect(inventory)
    conn.row_factory = sqlite3.Row
    accounts = {row['key']: row for row in sorted_rows(conn, 'accounts')}
    repos = {row['id']: row for row in sorted_rows(conn, 'repos')}
    repo_names = {row['lower_name']: row['id'] for row in repos.values()}
    for lead in sorted_rows(conn, 'leads'):
        if lead['repo_id']:
            repo_names.setdefault(lead['key'], lead['repo_id'])
    regional = {}
    ranked_accounts = {}

    def anchor(login, institution, county=None, source=None, rank=20, description=None):
        key = (login or '').casefold()
        if not key or (key in ranked_accounts and ranked_accounts[key][0] >= rank):
            return
        current = accounts.get(key)
        display_login = current['login'] if current and current['login'] else login
        wording = description or (
            f'Listed under @{display_login} in the {institution} roster.' if institution else
            f'Listed under @{display_login} in the regional account roster.'
        )
        ranked_accounts[key] = (rank, dict(institution=institution, county=county, label='Listed',
                                             connection=wording, sourceUrl=safe_url(source) or account_url(display_login)))

    def assign(identity, values, rank):
        if identity and (identity not in regional or regional[identity][0] < rank):
            regional[identity] = (rank, values)

    def exact(identity, institution, county, source, wording=None, rank=90):
        if not identity:
            return
        url = safe_url(source)
        if url and institution:
            assign(identity, dict(institution=institution, county=county, label='Verified',
                                  connection=wording or f'Linked from a page on the {institution} website.',
                                  sourceUrl=url), rank)

    # Strong public account self-links supplement the retained regional roster.
    for key, row in accounts.items():
        n, county = domain(row['website'])
        if row['login'] and n:
            login = row['login']
            anchor(login, n, county, row['website'], 30,
                   f'Listed under @{login}, whose GitHub profile links to {n}.')

    for o in queue['observations']:
        batch, kind = o['batch'], o['kind']
        if kind not in ('account', 'supplemental-evidence') or o.get('urlKind') != 'account-url':
            continue
        login = o['accountKey']
        f = o['fields']
        url = safe_url(f.get('sourceUrl'))
        official, county = domain(url)
        if batch == 'penn' and (kind == 'account' or f.get('reportedAffiliation')):
            name, hinted_county = affiliation(f.get('reportedAffiliation'))
            anchor(login, official or name or PENN, county if official else hinted_county, url, 60 if official else 40)
        elif batch == 'jefferson':
            context = f.get('reportedContext') or {}
            origin = context.get('associationKind')
            if origin in {'lab-branded', 'personal-project', 'self-reported', 'broad-institution', 'historical'}:
                urls = context.get('evidenceUrls') or []
                source = next((x for x in urls if domain(x)[0]), None)
                anchor(login, JEFFERSON, None, source, 36,
                       f'Listed under @{login} in the Jefferson account roster.')
        elif batch in {'villanova', 'widener'}:
            name = VILLANOVA if batch == 'villanova' else 'Widener University'
            anchor(login, name, 'Delaware' if batch == 'villanova' else None, rank=33)
        elif batch == 'pcom' and login in {'pcom-library','pcomlib','metageeky','rovingdice','sarahluna123','andrea-morinigo'}:
            anchor(login, PCOM, None, rank=32)

    for record in queue['sourceRecords']:
        row_id = record['id']
        if record.get('kind') != 'account':
            continue
        key = urlsplit(record.get('url') or '').path.strip('/').casefold()
        f = record['metadata']
        if row_id.startswith('incubators:supported-links'):
            group = f.get('group') or ''
            if NONLOCAL.search(group):
                continue
            url = f.get('evidence_url_1')
            official, county = domain(url)
            name, named_county = affiliation(group)
            if group == 'Philadelphia healthtech':
                name = f.get('entity')
                named_county = None
            anchor(key, official or name, county if official else named_county, url,
                   67 if official else 42)
        elif row_id.startswith(('public-health:curated-seeds','public-health:source-linked-inventory')):
            group = f.get('area') or ''
            if NONLOCAL.search(group):
                continue
            url = f.get('evidence_url')
            official, county = domain(url)
            name, named_county = affiliation(group)
            if not official and not name and group in {'Philadelphia public health','Philadelphia health technology','Regional company, global account'}:
                name = f.get('name') if (f.get('type') or '').casefold() in {'institution','organization','company','lab','project'} else None
                named_county = 'Philadelphia' if name == CITY else None
            anchor(key, official or name, county if official else named_county, url,
                   69 if official else 43)
        elif row_id.startswith('public-health:unreviewed-profile-leads') and not accounts_only:
            location = f.get('profile_location') or ''
            company = f.get('profile_company') or ''
            name, county = affiliation(company)
            if not name and not LOCAL_PROFILE.search(location):
                continue
            city = SIMPLE_CITY.fullmatch(location.strip())
            exact_county = {'philadelphia':'Philadelphia','princeton':'Mercer','camden':'Camden'}.get(city[1].casefold()) if city else None
            wording = (f'Listed under @{key} in the regional profile roster. The GitHub profile named {name}.' if name else
                       f'Listed under @{key} in the regional profile roster based on its GitHub location.')
            # The account's city may differ from the institution named in
            # the same profile. A county cannot stand in for their association.
            if name and county != exact_county:
                exact_county = None
            anchor(key, name, exact_county, rank=22, description=wording)
        elif row_id.startswith('wistar:github-accounts'):
            relation = f.get('account_type') or ''
            if NONLOCAL.search(relation) or 'collaborator' in relation.casefold() or 'inferred' in relation.casefold():
                continue
            url = next((v for v in [f.get('evidence_url_1'),f.get('evidence_url_2')] if domain(v)[0] == WISTAR), None)
            anchor(key, WISTAR, 'Philadelphia', url, 40)

    for row in records(inputs / 'rosters/rowan-health-github-20261116/matched-accounts.csv'):
        relation = row['repository_relationships'] or ''
        key = row['login']
        if re.search(r'\bexternal\b',relation,re.I):
            continue
        if re.search(r'\bfaculty\b|lab[- ]used|lab member|rowan|student',relation,re.I) or key.casefold() in {'beemd','rowanmavrc','polikar'}:
            anchor(key, ROWAN, None, rank=38)
        elif 'Coriell' in relation:
            anchor(key, 'Coriell Institute for Medical Research', 'Camden', rank=38)
    sju_roster = {'zhijunlilab','rrchaudhari','asaghafi','kr0401','mooreprestonb','artemisdiscovery',
                  'jruhym','liyuanliu1989','andy-ring','chvtk','usciences-biology'}
    for row in records(inputs / 'rosters/sju-healthcare-github-inventory-20261117/accounts.csv'):
        if row['account'].casefold() in sju_roster:
            anchor(row['account'], SJU, None, rank=38)

    for e in network['edges']:
        target = e['target']
        relation = e['relationship']
        if not target.startswith('cooper:github:') or 'associated with:' not in relation or NONLOCAL.search(relation):
            continue
        source = e.get('evidenceUrl')
        name, county = domain(source)
        if name:
            anchor(target.rsplit(':', 1)[1], name, county, source, 35)

    if accounts_only:
        result = {}
        for key, (_, values) in ranked_accounts.items():
            account = accounts.get(key)
            if not account or not account['login']:
                continue
            result[key] = {'login': account['login'], 'owner': {'login': account['login'], 'name': None,
                           'kind': 'organization' if account['kind'] == 'Organization' else 'user'},
                           'institution': values['institution'], 'connection': values['connection'],
                           'source': values['sourceUrl'], 'county': values['county'],
                           'countyBasis': 'institution' if values['county'] else None}
        conn.close()
        return result

    # Account-owned census memberships and direct repository leads on the
    # same named roster account are equivalent under the Listed rule.
    for identity, value in repos.items():
        key = value['name'].split('/',1)[0].casefold()
        if key in ranked_accounts:
            rank, anchor_values = ranked_accounts[key]
            assign(identity, anchor_values, rank)
    for row in sorted_rows(conn, 'account_repos'):
        a = ranked_accounts.get(row['account_key'])
        if a:
            assign(row['repo_id'], a[1], a[0])

    # Direct exact links previously read from a regional institutional page.
    for row in sorted_rows(conn, 'followups'):
        if row['exact_repository_link']:
            n, county = domain(row['resolved_url'])
            if n:
                exact(row['repo_id'], n, county, row['resolved_url'])
    rechecks = (inputs / 'prior') / 'recheck.sqlite'
    if rechecks.exists():
        ro = sqlite3.connect(rechecks.resolve().as_uri() + '?mode=ro&immutable=1',uri=True)
        for identity, url, result in ro.execute("SELECT repo_id,resolved,result FROM checks WHERE status IN ('exact_link_and_context','exact_link_partial_context')"):
            n, county = domain(url)
            if n and result and json.loads(result).get('exactRepositoryLink'):
                exact(identity,n,county,url)
        ro.close()

    # Independently observed release projects and exact original sources from
    # the earlier round. This is a positive provenance input, not a gate.
    snapshot = json.loads((inputs / 'catalog.json').read_text())
    for w in snapshot['works']:
        claims = w['claims']
        if w['kind'] != 'repository' or not w.get('nativeIdentity') or w['nativeIdentity']['provider'] != 'github':
            continue
        regional_claim = next((c for c in claims if c['kind']=='regional-connection'),None)
        if regional_claim is None:
            continue
        binding = set(regional_claim['affiliationEvidenceIds'])
        evidence = next((v for v in w['evidence'] if v['id'] in binding and not (v['sourceUrl'].startswith('https://api.github.com/'))),None)
        if evidence:
            qualification = regional_claim['qualification']
            if not qualification or qualification.startswith('Regional research project association;'):
                qualification = f'An exact project source connects this repository to {regional_claim["institution"]}.'
            exact(int(w['nativeIdentity']['nativeId']), regional_claim['institution'], regional_claim['county'],
                  evidence['sourceUrl'], qualification, 100)
    notes = (inputs / 'prior') / 'verified-notes.json'
    if notes.exists():
        for identity, n in json.loads(notes.read_text()).items():
            if not n.get('regionalBasis') or 'supported' != n['criteria'].get('datedRegionalBasis'):
                continue
            location = n['location']
            exact(int(identity),location['institution'],location['county'],n['evidence'][0]['locator'],n['regionalBasis']['text'], 99)

    # Institutional project references on the retained project roster. The
    # saved follow-up or byte read above upgrades an exact-match case only.
    for o in queue['observations']:
        if o['batch'] != 'penn' or o['kind'] not in ('projects','supplemental-evidence') or not o['repositoryKey']:
            continue
        f = o['fields']
        institution, county = domain(f.get('sourceUrl'))
        identity = repo_names.get(o['repositoryKey'])
        if institution and identity and f.get('entity'):
            # Descriptions reflect what the source roster observed, without
            # inferring where the project was developed.
            assign(identity, dict(institution=institution, county=county,label='Listed',
               connection=f'Listed in the {institution} lab and researcher project roster.',sourceUrl=safe_url(f['sourceUrl'])), 71)

    # The exact link was checked on the public toolkit page for this pass.
    exact(546753597, PENN, 'Philadelphia', 'https://paralkarlab.med.upenn.edu/toolkit/',
          'Linked from the Paralkar Lab toolkit page at Penn.', 120)
    conn.close()
    return {str(i): entry[1] for i, entry in regional.items() if i in repos}
