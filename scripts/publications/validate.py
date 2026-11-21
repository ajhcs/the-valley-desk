"""Validate the public publication projection and its cross-file references."""
import argparse
from datetime import date
import json
from pathlib import Path
import re
from urllib.parse import unquote

from jsonschema import Draft202012Validator, FormatChecker

from collect import arxiv, doi, pmid
from institutions import REFERENCE, is_https, load_reference

CONTENT = REFERENCE.parent
SCHEMA = CONTENT / 'public-directory-publications.schema.json'
DATASET = CONTENT / 'public-directory-publications.jsonl'
BACKFILL_DATASET = CONTENT / 'public-directory-publications-2025.jsonl'
REMOVALS = CONTENT / 'public-directory-publications-removals.json'
REMOVALS_SCHEMA = CONTENT / 'public-directory-publications-removals.schema.json'
PROJECTS = CONTENT / 'public-directory-projects.json'
EMAIL = re.compile(r"(?i)[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}")
CONNECTION_SOURCE = r'(?:PubMed|Europe PMC|Crossref|publisher|preprint) record'
PATTERNS = (
    re.compile(rf'^An author affiliation on the {CONNECTION_SOURCE} names [^\n]+\.$'),
    re.compile(rf'^Author affiliations on the {CONNECTION_SOURCE} name [^\n]+\.$'),
    re.compile(r'^An author affiliation in the PubMed Central (?:article|author manuscript) names [^\n]+\.$'),
)


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def validate_records(dataset=None, *additional_datasets):
    if dataset is None:
        publications = {p for p in BACKFILL_DATASET.parent.glob('public-directory-publications-*.jsonl')
                        if re.fullmatch(r'public-directory-publications-[0-9]{4}\.jsonl', p.name)}
        if BACKFILL_DATASET.exists():
            publications.add(BACKFILL_DATASET)
        datasets = (DATASET, *sorted(publications))
    else:
        datasets = (dataset, *additional_datasets)
    institutions = {r['id']: r for r in load_reference()}
    projects = {r['id'] for r in read_json(PROJECTS)}
    schema = read_json(SCHEMA)
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    removals = read_json(REMOVALS)
    removal_validator = Draft202012Validator(read_json(REMOVALS_SCHEMA), format_checker=FormatChecker())
    removal_validator.validate(removals)
    if sorted(removals) != removals:
        raise ValueError('removal IDs must be sorted')
    claimed_identifiers = {}
    pairs = {}
    for path in datasets:
        previous_id = None
        with path.open(encoding='utf-8') as stream:
            for number, line in enumerate(stream, 1):
                try:
                    row = json.loads(line)
                    validator.validate(row)
                    pid = row['id']
                    if pid in pairs:
                        raise ValueError(f'duplicate publication ID: {pid}')
                    if previous_id is not None and pid < previous_id:
                        raise ValueError('publication IDs must be sorted within each file')
                    validate_record(row, institutions, projects, claimed_identifiers)
                except Exception as exc:
                    raise ValueError(f'{path}:{number}: {exc}') from exc
                previous_id = pid
                pairs[pid] = (row['type'], row['preprint_of'], row['published_as'])
    journals_by_preprint = {}
    preprints_by_journal = {}
    for pid, (kind, preprint_of, published_as) in pairs.items():
        if preprint_of is not None:
            if kind == 'preprint':
                raise ValueError(f'{pid}: preprint_of belongs on the journal version')
            if preprint_of not in pairs or pairs[preprint_of][0] != 'preprint':
                raise ValueError(f'{pid}: preprint_of must refer to an existing preprint')
            if journals_by_preprint.setdefault(preprint_of, pid) != pid:
                raise ValueError(f'{preprint_of}: conflicting journal version links')
            if preprints_by_journal.setdefault(pid, preprint_of) != preprint_of:
                raise ValueError(f'{pid}: conflicting preprint version links')
        if published_as is not None:
            if kind != 'preprint':
                raise ValueError(f'{pid}: published_as belongs on the preprint')
            if published_as not in pairs or pairs[published_as][0] == 'preprint':
                raise ValueError(f'{pid}: published_as must refer to an existing journal version')
            if journals_by_preprint.setdefault(pid, published_as) != published_as:
                raise ValueError(f'{pid}: conflicting journal version links')
            if preprints_by_journal.setdefault(published_as, pid) != pid:
                raise ValueError(f'{published_as}: conflicting preprint version links')
    return len(pairs)


def validate_record(row, institutions, projects, claimed_identifiers):
    if has_email(row):
        raise ValueError('email address in public record')
    for url in [row['url'], row['source'], (row.get('open_access') or {}).get('url')]:
        if url is not None and not is_https(url):
            raise ValueError('invalid HTTPS URL')
    ids = {'doi': doi(row['doi']), 'pmid': pmid(row['pmid']), 'arxiv': arxiv(row['arxiv'])}
    for key, value in ids.items():
        if row[key] != value:
            raise ValueError(f'noncanonical {key}')
        if value:
            identifier = f'{key}:{value}'
            claimed = claimed_identifiers.setdefault(identifier, row['id'])
            if claimed != row['id']:
                raise ValueError('identifier shared by different records')
    legal_ids = {f'{key}:{value}' for key, value in ids.items() if value}
    if row['id'] not in legal_ids:
        raise ValueError('id must refer to an identifier on the record')
    if row['doi']:
        if row['id'] != 'doi:' + row['doi']:
            raise ValueError('DOI must be the record ID when available')
        if unquote(row['url']) != 'https://doi.org/' + row['doi']:
            raise ValueError('DOI resolver disagrees with DOI')
    published = row['published']
    if len(published) == 10:
        date.fromisoformat(published)
    elif int(published[:4]) < 1:
        raise ValueError('invalid publication year')
    if row['checked'] < row['added']:
        raise ValueError('checked date precedes added date')
    visible = len(row['authors'])
    total = row['author_count']
    if total <= 30 and visible != total or total > 30 and not 11 <= visible <= total:
        raise ValueError('inconsistent byline and total author count')
    if not any(author['regional'] for author in row['authors']):
        raise ValueError('at least one visible regional author required')
    if not set(row['institutions']) <= institutions.keys() or not set(row['projects']) <= projects:
        raise ValueError('unknown institution or project reference')
    allowed_counties = {s['county'] for slug in row['institutions'] for s in institutions[slug]['sites']}
    if not set(row['counties']) <= allowed_counties:
        raise ValueError('county outside listed institutions')
    if row['label'] == 'Verified' and not row['counties']:
        raise ValueError('Verified requires a supported county')
    if row['label'] == 'Listed' and row['counties']:
        raise ValueError('Listed records must have empty counties')
    if not any(pattern.fullmatch(row['connection']) for pattern in PATTERNS):
        raise ValueError('unexpected connection wording')


def has_email(value):
    if isinstance(value, str):
        return bool(EMAIL.search(unquote(value))) or value.casefold().startswith('mailto:')
    if isinstance(value, list):
        return any(map(has_email, value))
    if isinstance(value, dict):
        return any(map(has_email, value.values()))
    return False


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('datasets', nargs='*', type=Path, metavar='dataset',
                        help='JSON Lines files to validate together (defaults to pilot and optional 2025 backfill)')
    args = parser.parse_args()
    print(f'Validated {validate_records(*args.datasets)} publication records')
