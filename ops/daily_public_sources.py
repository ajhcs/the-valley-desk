"""Public-source adapters for staged daily updates. No publication or deployment."""
from datetime import datetime
import json
from pathlib import Path
import re
import sys
import subprocess
from urllib.error import HTTPError
from zoneinfo import ZoneInfo
from urllib.parse import quote

GITHUB_RE = re.compile(r'^https://github\.com/([A-Za-z0-9-]+)/([A-Za-z0-9_.-]+)$')


def _github(path):
    response = subprocess.run(['gh', 'api', path], capture_output=True, text=True, timeout=120)
    if response.returncode:
        if 'HTTP 404' in response.stderr:
            raise HTTPError(path, 404, 'not found', {}, None)
        raise RuntimeError('GitHub request failed: ' + response.stderr[:500])
    return json.loads(response.stdout)


def github_license(value):
    """Normalize GitHub's unspecified-license sentinel to a null license."""
    if not isinstance(value, dict):
        return None
    name = value.get('spdxId', value.get('spdx_id'))
    return None if not name or name == 'NOASSERTION' else name


def refresh_projects(root, run_dir, existing, removed, day):
    """Return refreshed records keyed by ID; failed observations retain prior records.

    Rate limiting and other incomplete runs raise: caller must not advance cursor.
    """
    root, run_dir = Path(root), Path(run_dir)
    result = {str(k): dict(v) for k, v in existing.items() if str(k) not in removed}
    skipped = 0
    entries = list(result.items())
    for start in range(0, len(entries), 40):
        chunk = entries[start:start + 40]
        queries = []
        for i, (identity, previous) in enumerate(chunk):
            match = GITHUB_RE.fullmatch(previous['code'])
            if not match:
                raise ValueError(f'Invalid repository URL for {identity}')
            owner, repo = map(json.dumps, match.groups())
            queries.append(f'r{i}: repository(owner:{owner}, name:{repo}) {{ databaseId isPrivate primaryLanguage {{ name }} licenseInfo {{ spdxId }} pushedAt isArchived stargazerCount description defaultBranchRef {{ target {{ ... on Commit {{ oid tree {{ entries {{ name type }} }} }} }} }} }}')
        query = 'query {' + ' '.join(queries) + '}'
        response = subprocess.run(['gh', 'api', 'graphql', '-f', 'query=' + query], capture_output=True, text=True, timeout=120)
        try:
            payload = json.loads(response.stdout)
        except (ValueError, TypeError) as error:
            raise RuntimeError('GitHub GraphQL request failed: ' + response.stderr[:500]) from error
        errors = payload.get('errors') or []
        if (response.returncode and not errors) or any(error.get('type') != 'NOT_FOUND' or len(error.get('path', [])) != 1 for error in errors):
            raise RuntimeError('GitHub GraphQL returned an incomplete batch')
        if not isinstance(payload.get('data'), dict):
            raise RuntimeError('GitHub GraphQL returned no data')
        for i, (identity, previous) in enumerate(chunk):
            source = payload['data'][f'r{i}']
            if source is None:
                skipped += 1
                continue
            if str(source.get('databaseId')) != identity or source.get('isPrivate') is not False:
                raise ValueError(f'GitHub identity or visibility mismatch for {identity}')
            row = result[identity]
            values = dict(language=(source['primaryLanguage'] or {}).get('name'),
                          license=github_license(source['licenseInfo']),
                          pushed=(source['pushedAt'] or '')[:10] or None, archived=source['isArchived'],
                          stars=source['stargazerCount'], description=source['description'])
            branch = source.get('defaultBranchRef')
            if branch is not None:
                commit = branch.get('target') or {}
                oid = commit.get('oid', '')
                entries = (commit.get('tree') or {}).get('entries')
                if not re.fullmatch(r'[0-9a-f]{40}', oid) or not isinstance(entries, list):
                    raise RuntimeError('GitHub returned incomplete default branch tree')
                files = {e['name'] for e in entries if e.get('type') == 'blob' and isinstance(e.get('name'), str)}
                # Restrict to recognized root README names; don't infer absent files or branches.
                readmes = sorted((n for n in files if re.fullmatch(r'README(?:\.(?:md|markdown|rst|txt))?', n, re.I)), key=lambda n: (n.lower() != 'readme.md', n.lower(), n))
                base = previous['code'] + '/blob/' + oid + '/'
                values['readmeUrl'] = base + quote(readmes[0], safe='') if readmes else None
                values['citationUrl'] = base + 'CITATION.cff' if 'CITATION.cff' in files else None
            for field, value in values.items():
                if value is not None or field in row:
                    row[field] = value
    return result, skipped


def discover_projects(root, existing, removed, day, since):
    """Enumerate newly created public repositories on the existing regional account rosters."""
    result, skipped = {}, 0
    for association in roster_from_public(existing, root).values():
        for page in range(1, 101):
            try:
                repositories = _github('/users/' + association['login'] +
                                       '/repos?type=owner&sort=created&direction=desc&per_page=100&page=' + str(page))
            except HTTPError as error:
                if error.code != 404:
                    raise
                skipped += 1
                break
            for candidate in repositories:
                identity = str(candidate['id'])
                if candidate['created_at'][:10] < since or identity in existing or identity in result or identity in removed:
                    continue
                row, _ = qualify_repository(candidate['html_url'], root, day, association, source=candidate)
                if row:
                    result[identity] = row
                else:
                    skipped += 1
            if len(repositories) < 100 or repositories[-1]['created_at'][:10] < since:
                break
        else:
            raise RuntimeError('GitHub roster pagination exceeded limit')
    return result, skipped


def suggested_publications(run_dir, identifiers):
    from collect import add_observation, deduplicate, epmc_ids, europepmc_rows
    from receipts import Receipts
    from sizing import Source

    source = Source("europepmc", Receipts(run_dir), True)
    observations = {}
    identifiers = sorted(identifiers)
    for start in range(0, len(identifiers), 25):
        group = identifiers[start:start + 25]
        expressions = []
        for key in group:
            kind, value = key.split(":", 1)
            if kind == "doi" and re.fullmatch(r"10\.\d{4,9}/[a-z0-9._;()/:%-]{1,180}", value):
                expressions.append(f'DOI:"{value}"')
            elif kind == "pmid" and re.fullmatch(r"[0-9]{1,12}", value):
                expressions.append(f'(EXT_ID:{value} AND SRC:MED)')
        if expressions:
            for record in europepmc_rows(source, " OR ".join(expressions)):
                if set(epmc_ids(record)).intersection(group):
                    add_observation(observations, "europepmc", record, [])
    return list(deduplicate(observations))


def collect_publications(root, state, run_dir, existing, removed, first=None, last=None, *, suggestions=()):
    """Stage mechanically eligible Europe PMC records; unresolved topics remain held."""
    root, state, run_dir = Path(root), Path(state), Path(run_dir)
    sys.path.insert(0, str(root / 'scripts/publications'))
    from weekly import collect, link_versions
    from enrich import crossref_lookup
    from receipts import Receipts
    from validate import validate_records
    from mechanical import MechanicalProjector, identity_tokens
    from institutions import REFERENCE
    import weekly_topics
    from weekly_topics import source_topic, model_topics
    holds = set((state / 'hold-ids.txt').read_text().split()) | set(removed)
    day = datetime.now(ZoneInfo('America/New_York')).date().isoformat()
    countries = Path('/usr/share/iso-codes/json/iso_3166-1.json')
    def projector():
        return MechanicalProjector(REFERENCE, state / 'US.zip', existing.values(), holds, day, country_codes=countries)

    accepted, skipped = [], 0
    candidates = suggested_publications(run_dir, suggestions) if suggestions else collect(run_dir, first, last)
    preliminary = projector()
    provisional = []
    for candidate in candidates:
        indexes = [o["record"] for o in candidate["observations"] if o["provider"] == "europepmc"]
        if first is not None and not any(str(first) <= (row.get("firstIndexDate") or "") <= str(last) for row in indexes):
            skipped += 1
            continue
        trial = preliminary.project(candidate)
        if trial.record is not None or trial.reason == 'publication date unsupported':
            provisional.append(candidate)
        else:
            skipped += 1
    candidates = provisional
    doi_keys = sorted({key[4:] for c in candidates for key in c["identifiers"] if key.startswith("doi:")})
    crossref = {r["doi"]: r["record"] for r in crossref_lookup(Receipts(run_dir), doi_keys) if r["record"]}
    final = projector()
    for candidate in candidates:
        extra = [crossref[k[4:]] for k in candidate["identifiers"] if k.startswith("doi:") and k[4:] in crossref]
        candidate = {**candidate, "observations": [*candidate["observations"], *({"provider": "crossref", "record": r} for r in extra)]}
        projected = final.project(candidate)
        row = projected.record
        if row is None or holds.intersection(identity_tokens(row)):
            skipped += 1
            continue
        row['topic'] = source_topic(row)
        accepted.append(row)
    ambiguous = [row for row in accepted if row['topic'] is None]
    weekly_topics.MODEL = 'gpt-6.1-terra'
    topics = dict(model_topics(ambiguous, run_dir)) if ambiguous else {}
    for row in ambiguous:
        row['topic'] = topics.get(row['id'])
    skipped += sum(row['topic'] is None for row in accepted)
    accepted = [row for row in accepted if row['topic'] is not None]
    if suggestions:
        skipped += sum(row["topic"] == "Other science" for row in accepted)
        accepted = [row for row in accepted if row["topic"] != "Other science"]
    link_versions(accepted, crossref)
    if accepted and sum(row['topic'] == 'Other science' for row in accepted) * 100 > len(accepted) * 12:
        raise ValueError('Other science exceeds 12%')
    validation_file = run_dir / 'publications-validation.jsonl'
    rows = sorted([*existing.values(), *accepted], key=lambda row: row['id'])
    validation_file.write_text(''.join(json.dumps(row, ensure_ascii=False, sort_keys=True) + '\n' for row in rows))
    validate_records(validation_file)
    return accepted, skipped


def roster_from_public(existing, root=None):
    """Derive only accounts whose public record cites that exact GitHub account."""
    roster = {}
    for row in existing.values():
        owner = row.get('owner') or {}
        login = owner.get('login')
        source = row.get('source') or ''
        if not login or source.rstrip('/').casefold() != ('https://github.com/' + login).casefold():
            continue
        key = login.casefold()
        roster.setdefault(key, {'login': login, 'owner': owner, 'institution': row.get('institution'),
                                'connection': row.get('connection'), 'source': source,
                                'county': row.get('county'), 'countyBasis': row.get('countyBasis')})
    if root:
        roster_inputs = Path('/workspace/build/builderbob/tvd-directory-data-20261118/inputs')
        if not roster_inputs.is_dir():
            raise ValueError('Retained directory roster inputs are unavailable')
        sys.path.insert(0, str(Path(root) / 'scripts/directory'))
        from regional import build_regional
        roster.update(build_regional(roster_inputs, accounts_only=True))
    return roster


def qualify_repository(project_url, root, day, association=None, *, source=None):
    """Qualify a public repo using an already established regional account association."""
    match = GITHUB_RE.fullmatch(project_url)
    if not match:
        return None, 'invalid repository URL'
    owner, repo = match.groups()
    if not association or association['login'].casefold() != owner.casefold():
        return None, 'regional account association not established'
    if source is None:
        try:
            source = _github('/repos/' + owner + '/' + repo)
        except HTTPError as error:
            if error.code == 404:
                return None, 'public repository unavailable'
            raise
    if source.get('full_name', '').casefold() != (owner + '/' + repo).casefold() or source.get('private') is not False:
        return None, 'repository identity or visibility mismatch'
    try:
        readme = _github('/repos/' + owner + '/' + repo + '/readme')
        import base64
        content = base64.b64decode(readme['content']).decode('utf-8', errors='replace')
    except HTTPError as error:
        if error.code != 404:
            raise
        content = ''
    sys.path.insert(0, str(Path(root) / 'scripts/directory'))
    from qualification import classify
    assessment = classify({'name': owner + '/' + repo, 'native': {**source, 'readme': content,
                           'isEmpty': source.get('size') == 0, 'isMirror': bool(source.get('mirror_url'))}})
    if assessment['reasonCode']:
        return None, assessment['reasonCode']
    if re.search(r'(?:…|\.{2,}|:)\s*$', assessment['purpose']):
        return None, 'incomplete purpose statement'
    row = {'id': str(source['id']), 'code': 'https://github.com/' + owner + '/' + repo,
           'name': source['name'], 'purpose': assessment['purpose'], 'topic': assessment['topic'],
           'label': 'Listed', 'added': day, 'owner': association['owner'],
           'institution': association['institution'], 'connection': association['connection'],
           'source': association['source'], 'language': source.get('language'),
           'license': github_license(source.get('license')), 'pushed': (source.get('pushed_at') or '')[:10] or None,
           'archived': source['archived'], 'stars': source['stargazers_count'], 'description': source.get('description')}
    # The REST README endpoint returns the actual preferred file URL.
    if content and isinstance(readme.get('html_url'), str) and readme['html_url'].startswith(row['code'] + '/blob/'):
        row['readmeUrl'] = readme['html_url']
    try:
        citation = _github('/repos/' + owner + '/' + repo + '/contents/CITATION.cff')
        if citation.get('type') == 'file' and isinstance(citation.get('html_url'), str) and citation['html_url'].startswith(row['code'] + '/blob/'):
            row['citationUrl'] = citation['html_url']
    except HTTPError as error:
        if error.code != 404:
            raise
    if association.get('county'):
        row.update(county=association['county'], countyBasis=association['countyBasis'])
    return row, None
