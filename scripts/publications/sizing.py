"""Count source-specific publication leads without treating them as reviewed works."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import date
import json
from pathlib import Path
from threading import Lock
import time

from institutions import load_reference
from receipts import MetadataError, Receipts

YEARS = range(2020, 2027)
DOMAINS = 'primary_topic.domain.id:1|4'
EPMC_CORPUS = '(SRC:MED OR SRC:PMC OR SRC:PPR)'
HEADERS = ('id', 'name', 'counties', 'provider', 'scope', *map(str, YEARS),
           'preprints', 'pmids', 'open_access', 'types', 'failure')


class Source:
    def __init__(self, service, receipts, replay):
        self.service = service
        self.receipts = receipts
        self.replay = replay
        self.lock = Lock()
        self.next_request = 0

    def query(self, endpoint, **params):
        if self.replay and (cached := self.receipts.replay(self.service, endpoint, params)) is not None:
            return cached
        with self.lock:
            time.sleep(max(0, self.next_request - time.monotonic()))
            self.next_request = time.monotonic() + (1.05 if self.service == 'openalex' else 0.75)
        return self.receipts.get(self.service, endpoint, params)


def epmc_query(row):
    names = [row['name'], *row['aliases']]
    names = list(dict.fromkeys(n.replace('’', "'").replace('–', '-') for n in names))
    parts = [f'AFF:"{n}"' for n in names if len(n) > 3]
    if not parts:
        parts = [f'AFF:"{row["name"]}"']
    result = '(' + ' OR '.join(parts) + ')'
    if row['kind'] == 'company' or row['id'] in {'saint-mary-langhorne', 'penn-state'}:
        places = sorted({s['place'] for s in row['sites']})
        cities = ' OR '.join(f'AFF:"{place}"' for place in places)
        result += f' AND ({cities})'
    return result


def epmc_count(source, query):
    data = source.query('/search', query=f'{EPMC_CORPUS} AND {query}',
                        pageSize=1, resultType='idlist', format='json')
    return int(data['hitCount'])


def epmc_window(start, end):
    return f'FIRST_PDATE:[{start} TO {end}]'


def measure_epmc(source, row, result):
    aff = epmc_query(row)
    result['scope'] = 'affiliation phrases; MED/PMC/PPR; company also indexed place'
    for year in YEARS:
        result[str(year)] = epmc_count(source, f'{aff} AND {epmc_window(f"{year}-01-01", f"{year}-12-31")}')
    corpus = f'{aff} AND {epmc_window("2020-01-01", "2026-12-31")}'
    for field, condition in [('preprints', 'SRC:PPR'), ('pmids', 'SRC:MED'), ('open_access', 'OPEN_ACCESS:y')]:
        result[field] = epmc_count(source, f'{corpus} AND {condition}')


def oa_affiliation(row):
    if row['ror']:
        return 'institutions.ror:' + row['ror'].rsplit('/', 1)[1], 'institution assignment'
    name = row['name'].replace('’', "'").replace('–', '-')
    return f'raw_affiliation_strings.search:"{name}"', 'raw affiliation phrase search'


def oa_group(source, filters, group):
    data = source.query('/works', filter=','.join(filters), group_by=group)
    return {item['key_display_name']: item['count'] for item in data['group_by']}


def measure_openalex(source, row, result):
    aff, result['scope'] = oa_affiliation(row)
    filters = [aff, DOMAINS, 'from_publication_date:2020-01-01', 'to_publication_date:2026-12-31']
    counts = oa_group(source, filters, 'publication_year')
    for year in YEARS:
        result[str(year)] = counts.get(str(year), 0)
    types = oa_group(source, filters, 'type')
    result['preprints'] = types.get('preprint', 0)
    result['types'] = json.dumps(types, sort_keys=True, separators=(',', ':'))
    oa = oa_group(source, filters, 'is_oa')
    result['open_access'] = oa.get('true', 0)
    try:
        data = source.query('/works', filter=','.join([*filters, 'has_pmid:true']), per_page=1, select='id')
        result['pmids'] = data['meta']['count']
    except MetadataError as exc:
        if exc.status != 400:
            raise
        result['failure'] = 'PMID coverage filter unavailable; other counts retained'


def measure(source, row):
    result = {'id': row['id'], 'name': row['name'], 'provider': source.service,
              'counties': '|'.join(sorted({s['county'] for s in row['sites']}))}
    try:
        if source.service == 'openalex':
            measure_openalex(source, row, result)
        else:
            measure_epmc(source, row, result)
    except (MetadataError, ValueError, KeyError) as exc:
        if isinstance(exc, MetadataError) and exc.status in (401, 403, 429):
            raise
        result['failure'] = str(exc)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', type=Path)
    parser.add_argument('provider', choices=('openalex', 'europepmc'))
    parser.add_argument('--resume', action='store_true', help='keep prior rows and size missing institutions')
    parser.add_argument('--replay', action='store_true', help='reuse saved successful responses')
    args = parser.parse_args()
    institutions = load_reference()
    source = Source(args.provider, Receipts(args.run), args.replay)
    outfile = args.run / f'sizing-{args.provider}.csv'
    existing = set()
    if args.resume and outfile.exists() and outfile.stat().st_size:
        with outfile.open(encoding='utf-8') as stream:
            existing = {row['id'] for row in csv.DictReader(stream)}
    institutions = [row for row in institutions if row['id'] not in existing]
    with outfile.open('a' if existing else 'w', encoding='utf-8', newline='') as stream, ThreadPoolExecutor(max_workers=5) as pool:
        writer = csv.DictWriter(stream, fieldnames=HEADERS)
        if not existing:
            writer.writeheader()
        for result in pool.map(lambda row: measure(source, row), institutions):
            writer.writerow(result)
            stream.flush()
            reports = sum(str(year) in result for year in YEARS)
            print(f'{result["id"]}: {reports} years' + (' (partial)' if result.get('failure') else ''), flush=True)


if __name__ == '__main__':
    main()
