"""Prepare private, institution-sharded review packets from collected observations."""
import argparse
from datetime import datetime
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
from urllib.parse import quote, parse_qs, urlsplit
from zoneinfo import ZoneInfo

from institutions import load_reference
from receipts import Receipts


def epmc_source(record):
    return 'https://europepmc.org/article/{}/{}'.format(
        quote(record['source'], safe=''), quote(record['id'], safe=''))


def epmc_authors(record):
    rows = (record.get('authorList') or {}).get('author') or []
    return [
        {
            'name': a.get('fullName') or a.get('collectiveName'),
            'orcid': a.get('authorId'),
            'affiliations': [
                item['affiliation'] for item in
                (a.get('authorAffiliationDetailsList') or {}).get('authorAffiliation', [])
                if isinstance(item.get('affiliation'), str)
            ],
        }
        for a in rows
    ]


def receipt_index(root, start, end):
    """Use the current receipt from each matching first-publication query."""
    index = {}
    window = f'FIRST_PDATE:[{start} TO {end}]'
    for path in sorted((root / 'europepmc').glob('*/current.json')):
        receipt = json.loads(path.read_bytes())
        params = parse_qs(urlsplit(receipt['url']).query)
        if (receipt['status'] != 200 or params.get('resultType') != ['core']
                or window not in params.get('query', [''])[0]):
            continue
        date = datetime.fromisoformat(receipt['fetched']).astimezone(ZoneInfo('America/New_York')).date().isoformat()
        bodyfile = path.parent / receipt['body']
        data = bodyfile.read_bytes()
        if hashlib.sha256(data).hexdigest() != receipt['sha256']:
            raise ValueError(f'body digest differs from receipt in {path.parent.name}')
        for row in json.loads(data)['resultList']['result']:
            key = (row['source'], row['id'])
            indexed = (date, str(bodyfile))
            if key not in index or indexed < index[key]:
                index[key] = indexed
    return index


def packet_record(candidate, receipts):
    sources = []
    leads = []
    for obs in candidate['observations']:
        data = obs['record']
        if obs['provider'] == 'europepmc':
            fetched, receipt = receipts[(data['source'], data['id'])]
            sources.append({
                'url': epmc_source(data), 'fetched': fetched, 'receipt': receipt,
                'title': data.get('title'), 'abstract': data.get('abstractText'),
                'type': (data.get('pubTypeList') or {}).get('pubType', []),
                'published': data.get('firstPublicationDate'),
                'electronic': data.get('electronicPublicationDate'),
                'print': (data.get('journalInfo') or {}).get('printPublicationDate'),
                'indexed': data.get('firstIndexDate'),
                'venue': ((data.get('journalInfo') or {}).get('journal') or {}).get('title')
                         or data.get('bookOrReportDetails'),
                'authors': epmc_authors(data),
                'pmid': data.get('pmid'), 'doi': data.get('doi'), 'pmcid': data.get('pmcid'),
            })
        else:
            leads.append({
                'id': data['id'], 'title': data.get('title'), 'type': data.get('type'),
                'published': data.get('publication_date'),
                'source': (data.get('primary_location') or {}).get('landing_page_url'),
                'primary_topic': data.get('primary_topic'),
                'raw_affiliations': [text for a in data.get('authorships', [])
                                     for text in a.get('raw_affiliation_strings', [])],
            })
    return {
        'id': candidate['id'], 'provider_key': candidate['provider_key'],
        'institutions': candidate['institutions'], 'identifiers': candidate['identifiers'],
        'identifier_conflict': candidate['identifier_conflict'],
        'sources': sources, 'openalex_leads': leads,
    }


def split(root, start, end, batch_size):
    candidates = root / f'candidates-{start}-{end}.jsonl'
    index = receipt_index(root, start, end)
    rows = [packet_record(json.loads(line), index) for line in candidates.read_text(encoding='utf-8').splitlines()]
    volume = Counter(slug for row in rows for slug in row['institutions'])
    shards = defaultdict(list)
    for row in rows:
        home = min(row['institutions'], key=lambda slug: (volume[slug], slug), default='unassigned')
        shards[home].append(row)
    path = root / 'packets'
    path.mkdir(mode=0o700, exist_ok=True)
    ledger = []
    for slug, members in sorted(shards.items()):
        def ordering(row):
            source = (row['sources'] or row['openalex_leads'] or [{}])[0]
            return source.get('published') or '', str(source.get('venue') or ''), row['provider_key']
        members.sort(key=ordering)
        weeks = defaultdict(list)
        for row in members:
            publication_day = ordering(row)[0]
            week = (int(publication_day[8:10]) - 1) // 7 + 1 if len(publication_day) == 10 else 0
            weeks[week].append(row)
        groups = [members] if len(members) <= batch_size else [
            week[offset:offset + batch_size] for week in weeks.values()
            for offset in range(0, len(week), batch_size)
        ]
        for number, group in enumerate(groups, 1):
            out = path / f'{slug}-{number:03d}.jsonl'
            with out.open('w', encoding='utf-8') as stream:
                for row in group:
                    print(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(',', ':')), file=stream)
            ledger.append({'shard': str(out), 'institution': slug, 'records': len(group)})
    (root / 'review-manifest.json').write_text(json.dumps(ledger, indent=2) + '\n', encoding='utf-8')
    return ledger


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', type=Path)
    parser.add_argument('start')
    parser.add_argument('end')
    parser.add_argument('--batch-size', type=int, default=100)
    args = parser.parse_args()
    if args.batch_size < 1:
        parser.error('batch size must be positive')
    root = Receipts(args.run).root
    load_reference()
    ledger = split(root, args.start, args.end, args.batch_size)
    print(f'{len(ledger)} review shards; {sum(row["records"] for row in ledger)} candidates')
