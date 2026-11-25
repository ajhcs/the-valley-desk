"""Collect and deduplicate source metadata into a private review packet."""
import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
import json
from pathlib import Path
import re

from institutions import load_reference
from receipts import Receipts
from sizing import DOMAINS, EPMC_CORPUS, Source, epmc_query, epmc_window

DOI_PATTERN = re.compile(r'10\.\d{4,}/[^\s<>]+', re.IGNORECASE)
PMID_PATTERN = re.compile(r'[1-9]\d*')
ARXIV_PATTERN = re.compile(r'(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?/\d{7})(?:v[1-9]\d*)?')
OPENALEX_FIELDS = ','.join((
    'id', 'doi', 'ids', 'title', 'display_name', 'publication_date', 'type',
    'authorships', 'primary_location', 'primary_topic', 'topics', 'open_access',
    'best_oa_location', 'is_retracted', 'locations',
))


def doi(value):
    if not isinstance(value, str):
        return None
    for prefix in ('https://doi.org/', 'http://doi.org/', 'http://dx.doi.org/', 'doi:'):
        if value.lower().startswith(prefix):
            value = value[len(prefix):]
            break
    return value.lower() if DOI_PATTERN.fullmatch(value) else None


def pmid(value):
    if not isinstance(value, str):
        return None
    value = value.removeprefix('https://pubmed.ncbi.nlm.nih.gov/').rstrip('/')
    return value if PMID_PATTERN.fullmatch(value) else None


def arxiv(value):
    if not isinstance(value, str):
        return None
    value = value.removeprefix('https://arxiv.org/abs/').removeprefix('oai:arXiv.org:')
    if ARXIV_PATTERN.fullmatch(value):
        return re.sub(r'v[1-9]\d*$', '', value)
    return None


def epmc_ids(record):
    values = {
        'doi': doi(record.get('doi')),
        'pmid': pmid(record.get('pmid') or (record.get('id') if record['source'] == 'MED' else None)),
        'arxiv': arxiv(record.get('id')) if record['source'] == 'PPR' else None,
    }
    return tuple(f'{kind}:{value}' for kind, value in values.items() if value is not None)


def oa_ids(record):
    ids = record.get('ids') or {}
    locations = record.get('locations') or []
    values = {
        'doi': doi(record.get('doi')),
        'pmid': pmid(ids.get('pmid')),
        'arxiv': next((found for r in locations if (found := arxiv(r.get('landing_page_url')))), None),
    }
    return tuple(f'{kind}:{value}' for kind, value in values.items() if value is not None)


class EuropePmcCoverageError(RuntimeError):
    """The response sequence did not cover the advertised result set."""


def europepmc_rows(source, expression):
    cursor = '*'
    seen = set()
    cursors = {'*'}
    total = None
    while True:
        data = source.query('/search', query=expression, pageSize=100, resultType='core',
                            format='json', cursorMark=cursor)
        count = data['hitCount']
        if total is None:
            total = count
        if count != total:
            raise EuropePmcCoverageError('Europe PMC hit count changed during paging')
        for row in data['resultList']['result']:
            key = (row['source'], row['id'])
            if key in seen:
                continue
            seen.add(key)
            yield row
        if len(seen) == total:
            return
        following = data.get('nextCursorMark')
        if not following or following in cursors or len(seen) > total:
            raise EuropePmcCoverageError(
                f'Europe PMC cursor stopped with {len(seen)} unique keys for {total} advertised hits')
        cursors.add(following)
        cursor = following


def openalex_rows(source, expression):
    expected = None
    seen = set()
    page = 1
    while True:
        data = source.query('/works', filter=expression, select=OPENALEX_FIELDS,
                            sort='publication_date:asc', per_page=100, page=page)
        count = data['meta']['count']
        if expected is None:
            expected = count
        if count != expected or count > 10000:
            raise RuntimeError(f'OpenAlex basic paging cannot verify this window ({count} results)')
        for row in data['results']:
            key = row['id']
            if key in seen:
                raise RuntimeError('duplicate OpenAlex key during paging')
            seen.add(key)
            yield row
        if len(seen) == expected:
            return
        if not data['results'] or len(seen) > expected:
            raise RuntimeError('OpenAlex result set ended before the advertised count')
        page += 1


def epmc_shard(source, row, start, end):
    expression = f'{EPMC_CORPUS} AND {epmc_query(row)} AND {epmc_window(start, end)}'
    try:
        return [(record, [row['id']]) for record in europepmc_rows(source, expression)]
    except EuropePmcCoverageError:
        first, last = date.fromisoformat(str(start)), date.fromisoformat(str(end))
        if first == last:
            raise
        midpoint = first + (last - first) // 2
        print(f'Retrying {row["id"]} in narrower Europe PMC windows: {first} through {last}', flush=True)
        return [
            *epmc_shard(source, row, first, midpoint),
            *epmc_shard(source, row, midpoint + timedelta(days=1), last),
        ]


def openalex_shard(source, institutions, start, end):
    slug_by_ror = {row['ror']: row['id'] for row in institutions if row['ror']}
    if not slug_by_ror:
        return []
    rors = '|'.join(ror.rsplit('/', 1)[1] for ror in sorted(slug_by_ror))
    expression = ','.join((f'institutions.ror:{rors}', DOMAINS, f'from_publication_date:{start}',
                           f'to_publication_date:{end}'))
    out = []
    for record in openalex_rows(source, expression):
        leads = {slug_by_ror[item['ror']] for a in record['authorships'] for item in a['institutions']
                 if item.get('ror') in slug_by_ror}
        out.append((record, sorted(leads)))
    return out


def record_key(provider, record):
    if provider == 'europepmc':
        return provider, record['source'], record['id']
    return provider, record['id']


def collect_observations(epmc, oa, institutions, start, end):
    by_key = {}
    with ThreadPoolExecutor(max_workers=5) as pool:
        openalex = pool.submit(openalex_shard, oa, institutions, start, end)
        epmc_shards = {row['id']: pool.submit(epmc_shard, epmc, row, start, end) for row in institutions}
        for slug, future in epmc_shards.items():
            matches = future.result()
            for record, leads in matches:
                add_observation(by_key, 'europepmc', record, leads)
            print(f'Collected {len(matches)} Europe PMC hits for {slug}', flush=True)
        for record, leads in openalex.result():
            add_observation(by_key, 'openalex', record, leads)
    return by_key


def add_observation(by_key, provider, record, leads):
    key = record_key(provider, record)
    if key not in by_key:
        by_key[key] = {'provider': provider, 'record': record, 'institutions': set()}
    elif by_key[key]['record'] != record:
        raise RuntimeError(f'conflicting representations during the same run for {key}')
    by_key[key]['institutions'].update(leads)


def deduplicate(by_key, *, identifiers_for=None):
    """Combine exact identifiers, preserving contradictory identifiers for review."""
    index = {}
    groups = {}
    for key, obs in sorted(by_key.items()):
        if identifiers_for is None:
            get_ids = epmc_ids if obs['provider'] == 'europepmc' else oa_ids
            identifiers = get_ids(obs['record'])
        else:
            identifiers = identifiers_for(obs)
        roots = {index[i] for i in identifiers if i in index}
        root = min(roots | {key})
        group = groups.setdefault(root, {'ids': set(), 'keys': set()})
        for other in sorted(roots - {root}):
            merged = groups.pop(other)
            group['ids'].update(merged['ids'])
            group['keys'].update(merged['keys'])
        group['ids'].update(identifiers)
        group['keys'].add(key)
        for identifier in group['ids']:
            index[identifier] = root

    for root, details in sorted(groups.items()):
        ids = sorted(details['ids'], key=lambda identifier: (
            ('doi', 'pmid', 'arxiv', 'pmcid').index(identifier.split(':', 1)[0]), identifier))
        institutions = set()
        observations = []
        for key in sorted(details['keys']):
            obs = by_key[key]
            institutions.update(obs['institutions'])
            observations.append({**obs, 'institutions': sorted(obs['institutions'])})
        conflicts = defaultdict(int)
        for identifier in ids:
            conflicts[identifier.split(':', 1)[0]] += 1
        yield {
            'id': ids[0] if ids else None, 'identifiers': ids, 'provider_key': list(root),
            'identifier_conflict': any(count > 1 for count in conflicts.values()),
            'institutions': sorted(institutions), 'observations': observations,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', type=Path)
    parser.add_argument('start', type=date.fromisoformat)
    parser.add_argument('end', type=date.fromisoformat, help='last included date')
    parser.add_argument('--institutions', type=Path)
    parser.add_argument('--replay', action='store_true', help='reuse saved successful responses')
    args = parser.parse_args()
    if args.end < args.start:
        parser.error('end precedes start')
    receipts = Receipts(args.run)
    institutions = load_reference(args.institutions) if args.institutions else load_reference()
    epmc = Source('europepmc', receipts, args.replay)
    oa = Source('openalex', receipts, args.replay)
    observations = collect_observations(epmc, oa, institutions, args.start, args.end)
    candidates = sorted(deduplicate(observations), key=lambda r: (r['id'] or '', r['provider_key']))
    target = receipts.root / f'candidates-{args.start}-{args.end}.jsonl'
    temporary = target.with_suffix('.tmp')
    with temporary.open('w', encoding='utf-8') as f:
        for candidate in candidates:
            print(json.dumps(candidate, sort_keys=True, ensure_ascii=False, separators=(',', ':')), file=f)
    temporary.replace(target)
    print(f'{len(candidates)} candidates from {len(observations)} provider records')


if __name__ == '__main__':
    main()
