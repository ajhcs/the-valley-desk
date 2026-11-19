#!/usr/bin/env python3
"""Apply the directory rule to the frozen inventory and project public fields."""
import csv
from collections import Counter
from collections.abc import Mapping
from datetime import date
from hashlib import sha256
import json
import re
import sqlite3
from urllib.parse import unquote, urlsplit, urlunsplit

from qualification import classify, compact_text

TITLE_NOISE = re.compile(r'^\s*(?:read\s*me|overview|introduction|contents?|documentation|about|installation|usage|table of contents|project overview)\s*$', re.I)
GITHUB = re.compile(r'^https://github\.com/[A-Za-z0-9-]+/[A-Za-z0-9_.-]+$')
SCHOLARLY = re.compile(r'(?i)(https://doi\.org/10\.|/articles?/|/journals?/|/paperpdfs/|/pubmed/|/pmc/articles/PMC|/fullTextXML|/abstract/|://biorxiv\.org|://medrxiv\.org|://arxiv\.org)')


def json_load(path, default=None):
    try:
        return json.loads(path.read_bytes())
    except FileNotFoundError:
        if default is not None:
            return default
        raise


def parse(value, fallback=None):
    return json.loads(value) if value else fallback


def write_json(path, data):
    tmp = path.with_name('.' + path.name + '.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    tmp.replace(path)


def timestamp(value):
    if isinstance(value, str) and len(value) >= 10:
        try:
            return date.fromisoformat(value[:10]).isoformat()
        except ValueError:
            pass
    return None


def native_rows(inputs):
    cache = {}
    for key in ('native-cached.json', 'native-first.json', 'native-rest.json'):
        for identity, detail in json_load(inputs / 'native' / key, {}).items():
            if isinstance(detail, Mapping) and str(detail.get('databaseId', identity)) == identity:
                cache[identity] = {**cache.get(identity, {}), **detail}
    return cache


def field_name(value):
    if isinstance(value, str):
        return compact_text(value)
    if isinstance(value, Mapping):
        return compact_text(value.get('name'))
    return None


def license_name(value):
    if not isinstance(value, Mapping):
        return field_name(value)
    short = value.get('spdxId', value.get('spdx_id'))
    if short and short != 'NOASSERTION':
        return short
    full = field_name(value)
    return full if full and full.casefold() != 'other' else None


def visible_title(title, name, purpose):
    slug = name.split('/', 1)[-1]
    label = compact_text(title)
    if (not label or len(label) > 90 or TITLE_NOISE.fullmatch(label) or
            label.casefold() == name.casefold() or label.casefold() == (purpose or '').casefold() or
            label.startswith(('===', '---', '%', 'npm ', 'pip ')) or
            len(label.split()) > 9):
        return slug
    native_tokens = set(re.findall(r'[a-z0-9]+', slug.casefold()))
    label_tokens = set(re.findall(r'[a-z0-9]+', label.casefold()))
    return label if native_tokens & label_tokens else slug


def clean_link(value):
    if not isinstance(value, str) or not value.startswith('https://'):
        return None
    try:
        parsed = urlsplit(value)
        if not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443):
            return None
    except ValueError:
        return None
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, '', ''))


def known_papers(catalog):
    # Explicit paper-to-repository relations in the last locally built catalog.
    snapshot = json_load(catalog)
    works = {x['id']: x for x in snapshot.get('works', []) if isinstance(x, dict) and 'id' in x}
    links = {}
    for item in works.values():
        for edge in item.get('relations', []):
            source = works.get(edge.get('fromId'))
            target = works.get(edge.get('toId'))
            if not source or not target:
                continue
            if edge['predicate'] == 'work-links-repository':
                source, target = target, source
            if source.get('kind') == 'repository' and target.get('kind') in {'publication','preprint'}:
                identity = (source.get('nativeIdentity') or {}).get('nativeId')
                url = clean_link((target.get('url') or {}).get('value'))
                if identity and url:
                    links[str(identity)] = url
    return links


def own_paper(row, regional, known):
    identity = row['id']
    if identity in known:
        return known[identity]
    source = clean_link(regional.get('sourceUrl'))
    if regional['label'] == 'Verified' and source and isinstance(regional.get('connection'), str):
        affiliation = regional['connection']
        if re.search(r'\b(?:study|paper|article|validation study)\b', affiliation, re.I) and SCHOLARLY.search(source):
            return source
    follow = row.get('followup') or {}
    excerpt = follow.get('excerpt') or ''
    match = re.search(r'(?i)github\.com/' + re.escape(row['name']) + r'(?:\.git)?(?![\w.-])', excerpt)
    url = clean_link(follow.get('resolved_url') or follow.get('locator'))
    # Indexed search results can aggregate several papers. Use only an
    # individual document with an explicit code-release statement and exact link.
    if match and url and SCHOLARLY.search(url) and ('/search' not in url and '/references' not in url):
        before = excerpt[max(0, match.start() - 95):match.start()]
        if re.search(r'(?i)(?:our (?:source )?code|code availability|we release|this work|code (?:for this study )?is available|source code (?:can be|is))', before):
            if '/fullTextXML' in url:
                pmc = re.search(r'/((?:PMC)\d+)/fullTextXML', url, re.I)
                return f'https://pmc.ncbi.nlm.nih.gov/articles/{pmc.group(1).upper()}/' if pmc else url
            return url
    return None


def format_recheck(recheck, original):
    if not recheck or not recheck.get('exactRepositoryLink'):
        return original
    if not original or not original.get('exact_repository_link'):
        return {
            **(original or {}), **recheck, 'exact_repository_link': True,
            'health_clues': recheck.get('healthClues', []),
            'regional_clues': recheck.get('regionalClues', []),
        }
    return original


def sampled(records, n, key):
    ranked = sorted(records, key=lambda x: sha256(f'directory-reset-20261118/{key}/{x["id"]}'.encode()).digest())
    return ranked[:n]


def count_by(rows, key, unknown):
    return dict(sorted(Counter(x.get(key) or unknown for x in rows).items(), key=lambda x: (-x[1], x[0])))


def decide(inputs, regional, added):
    natives = native_rows(inputs)
    comparisons = {**json_load(inputs / 'native' / 'fork-first.json', {}), **json_load(inputs / 'native' / 'fork-rest.json', {})}
    papers = known_papers(inputs / 'catalog.json')
    readmes = json_load(inputs / 'native' / 'native-readme.json', {})
    unavailable = json_load(inputs / 'native' / 'native-first-unavailable-check.json', {})
    conn = sqlite3.connect((inputs / 'inventory.sqlite').resolve().as_uri() + '?mode=ro&immutable=1', uri=True)
    conn.row_factory = sqlite3.Row
    followups = {str(row['repo_id']): dict(row) for row in conn.execute('SELECT * FROM followups')}
    for row in followups.values():
        row['health_clues'] = parse(row['health_clues']) or []
    rechecks = {}
    prior_rechecks = inputs / 'prior/recheck.sqlite'
    if prior_rechecks.exists():
        with sqlite3.connect(prior_rechecks.resolve().as_uri() + '?mode=ro&immutable=1',uri=True) as db:
            for ident, locator, result in db.execute("SELECT repo_id,resolved,result FROM checks WHERE status IN ('exact_link_and_context','exact_link_partial_context')"):
                if result:
                    rechecks[str(ident)] = {**json.loads(result), 'resolved_url': locator}
    input_rows = list(conn.execute('''
        SELECT r.id, r.name, r.metadata, d.purpose_excerpt, d.title, d.readme_path,
               d.health_signals, d.metadata_evidence, d.status AS read_status
        FROM repos r JOIN reads d ON r.id = d.repo_id
        LEFT JOIN followups f ON r.id = f.repo_id
        ORDER BY f.repo_id IS NULL, r.id
    '''))
    conn.close()
    public, dispositions, fork_candidates = [], [], []
    for raw in input_rows:
        row = dict(raw)
        row['id'] = identity = str(row['id'])
        base_name = row['name']
        metadata = parse(row['metadata'], {})
        more = parse(row['metadata_evidence'], {})
        row['metadata'] = {**(metadata or {}), **(more or {})}
        row['health_signals'] = parse(row['health_signals'], {}) or {}
        row['native'] = natives.get(identity) or {}
        row['readme'] = readmes.get(identity)
        row['comparison'] = comparisons.get(identity) or {}
        row['followup'] = format_recheck(rechecks.get(identity), followups.get(identity))
        anchor = regional.get(identity)
        outcome = classify(row)
        status = 'listed'
        reason_code, reason = outcome['reasonCode'], outcome['reason']
        if unavailable.get('databaseId') == identity and unavailable.get('public') is False:
            reason_code = 'unavailable repository'
            reason = f'GitHub returned no public repository for {base_name} by either its ID or its exact name.'
        native_name = row['native'].get('nameWithOwner') or base_name
        code = 'https://github.com/' + native_name
        if not GITHUB.fullmatch(code):
            native_name = base_name
            code = 'https://github.com/' + native_name
        if not GITHUB.fullmatch(code):
            reason_code = 'invalid repository link'
            reason = f'The recorded name for {base_name} cannot form a public GitHub repository link.'
        if not reason_code and not anchor:
            reason_code = 'no regional connection'
            reason = f'The account for {base_name} is absent from the regional roster, and the retained sources do not tie this repository to the region.'
        if reason_code:
            status = 'declined'
            if reason_code == 'fork lacks distinct work' and anchor and identity not in comparisons:
                projected = classify({**row, 'own_work':True})
                if not projected['reasonCode']:
                    fork_candidates.append(identity)
        else:
            native = row['native']
            meta = row['metadata']
            source = clean_link(anchor['sourceUrl'])
            purpose = outcome['purpose']
            assert outcome['topic'] and purpose and anchor['label'] in {'Verified','Listed'}
            public.append(dict(
                id=identity, code=code, name=visible_title(row['title'], native_name, purpose),
                purpose=purpose, topic=outcome['topic'],
                institution=anchor['institution'], county=anchor['county'], label=anchor['label'],
                connection=anchor['connection'], source=source, paper=own_paper(row, anchor, papers),
                language=field_name(native.get('primaryLanguage') or native.get('language') or meta.get('language')),
                license=license_name(native.get('licenseInfo') or native.get('license') or meta.get('license')),
                updated=timestamp(native.get('updatedAt') or native.get('updated_at') or meta.get('updatedAt') or meta.get('updated_at')),
                added=added,
            ))
            reason = anchor['connection']
        dispositions.append(dict(
            id=identity, repository=base_name, code=code,
            cohort='followup' if identity in followups else 'inventory',
            status=status, reasonCode=reason_code, reason=reason,
            purpose=outcome['purpose'], topic=outcome['topic'],
            institution=anchor['institution'] if anchor else None,
            county=anchor['county'] if anchor else None, label=anchor['label'] if anchor else None,
            source=clean_link(anchor['sourceUrl']) if anchor else None,
        ))
    assert len({x['id'] for x in dispositions}) == len(dispositions)
    declined = [x for x in dispositions if x['status'] == 'declined']
    if any(not x['reason'] or not x['reasonCode'] for x in declined):
        raise ValueError('missing decline explanation')
    resolved = [d for d in dispositions if d['status'] == 'listed']
    public_ids = {x['id'] for x in public}
    assert public_ids == {x['id'] for x in resolved}
    reasons = count_by(declined, 'reasonCode', 'Other')
    summary = {
        'scope':len(dispositions),'followups':len(followups),'additional':len(dispositions)-len(followups),
        'listed':len(public),'declined':len(declined),'held':0,
        'listedFirstCohort':sum(x['cohort']=='followup' for x in resolved),
        'listedSecondCohort':sum(x['cohort']!='followup' for x in resolved),
        'listedByInstitution':count_by(public,'institution','Unspecified'),
        'listedByCounty':count_by(public,'county','Unspecified'),
        'listedByLabel':count_by(public,'label','Unspecified'),
        'declinedByReason':reasons,
        'examplesFromLargestDecline':sampled([r for r in declined if r['reasonCode'] == next(iter(reasons), None)], 10, 'largest decline'),
        'missingMetadata':{key:sum(not x[key] for x in public) for key in ('language','license','updated')},
        'possibleForkChecks':len(fork_candidates),
    }

    sample = {'policy':'stable SHA-256 sample of each outcome', 'listed':sampled(public,50,'listed'),
              'declined':sampled(declined,50,'declined')}
    return public, dispositions, summary, sample, fork_candidates


def write_review(directory, public, dispositions, summary, sample, fork_candidates):
    for path, data in [('decisions.json', dispositions),('listed.json',public),('summary.json',summary),
                       ('sample.json',sample),('fork-candidates.json',fork_candidates)]:
        write_json(directory / path, data)
    csv_path = directory / 'dispositions.csv'
    tmp = csv_path.with_suffix('.csv.tmp')
    with tmp.open('w',newline='') as stream:
        writer = csv.DictWriter(stream,fieldnames=list(dispositions[0]))
        writer.writeheader()
        for row in dispositions:
            writer.writerow({k:"'" + v if isinstance(v,str) and v.startswith(('=','+','-','@','\t','\r')) else v
                             for k,v in row.items()})
    tmp.replace(csv_path)
