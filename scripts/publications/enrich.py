"""Look up unconfirmed OpenAlex DOI leads in Europe PMC and Crossref."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
import time
from urllib.parse import quote

from collect import EuropePmcCoverageError, doi, europepmc_rows
from receipts import MetadataError, Receipts
from sizing import Source

BATCH = 30


def lead_dois(path):
    with path.open(encoding='utf-8') as stream:
        for row in map(json.loads, stream):
            if all(obs['provider'] == 'openalex' for obs in row['observations']):
                yield from (value[4:] for value in row['identifiers'] if value.startswith('doi:'))


def epmc_lookup(source, keys):
    # Reject query delimiters instead of passing untrusted identifier text through.
    if any(re.search(r'["\\\r\n]', key) for key in keys):
        raise ValueError('unexpected DOI query delimiter')
    results = []
    for offset in range(0, len(keys), BATCH):
        group = keys[offset:offset + BATCH]
        expression = ' OR '.join('DOI:"' + key + '"' for key in group)
        try:
            found = list(europepmc_rows(source, expression))
        except EuropePmcCoverageError:
            if len(group) == 1:
                raise
            half = len(group) // 2
            found = [*epmc_lookup(source, group[:half]), *epmc_lookup(source, group[half:])]
        results.extend(item for item in found if doi(item.get('doi')) in group)
    return results


def crossref_lookup(receipts, keys):
    for i, value in enumerate(keys, 1):
        endpoint = '/works/' + quote(value, safe='/')
        record = receipts.replay('crossref', endpoint, {})
        if record is None:
            for attempt in range(4):
                time.sleep(0.24)  # Public pool, one request in flight.
                try:
                    record = receipts.get('crossref', endpoint, {})
                    break
                except MetadataError as exc:
                    if exc.status == 404:
                        break
                    if exc.status != 429 or attempt == 3:
                        raise
                    delay = int(exc.retry_after) if str(exc.retry_after).isdigit() else 15
                    time.sleep(max(15, delay))
        if record and doi(record['message'].get('DOI')) != value:
            raise ValueError('Crossref returned a different DOI')
        yield {'doi': value, 'record': record['message'] if record else None}
        if i % 100 == 0:
            print(f'Crossref has checked {i} of {len(keys)} DOI leads', flush=True)


def write_rows(path, rows):
    temporary = path.with_suffix('.tmp')
    with temporary.open('w', encoding='utf-8') as stream:
        for row in rows:
            print(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(',', ':')), file=stream)
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', type=Path)
    parser.add_argument('candidates', type=Path)
    args = parser.parse_args()
    receipts = Receipts(args.run)
    keys = sorted(set(lead_dois(args.candidates)))
    print(f'{len(keys)} DOI leads for both providers', flush=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        epmc = pool.submit(write_rows, receipts.root/'europepmc-enriched.jsonl',
                           epmc_stream(Source('europepmc', receipts, True), keys))
        write_rows(receipts.root/'crossref-enriched.jsonl', crossref_lookup(receipts, keys))
        epmc.result()


def epmc_stream(source, keys):
    yield from epmc_lookup(source, keys)


if __name__ == '__main__':
    main()
