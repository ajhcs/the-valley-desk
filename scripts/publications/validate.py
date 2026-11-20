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
REMOVALS = CONTENT / 'public-directory-publications-removals.json'
REMOVALS_SCHEMA = CONTENT / 'public-directory-publications-removals.schema.json'
PROJECTS = CONTENT / 'public-directory-projects.json'
EMAIL = re.compile(r"(?i)[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}")
PATTERNS = (
    re.compile(r'^(?:An author affiliation on the (?:PubMed|Europe PMC|Crossref|publisher|preprint) record names|Author affiliations on the (?:PubMed|Europe PMC|Crossref|publisher|preprint) record name) [^\n]+\.$'),
)


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def validate_records(dataset=DATASET):
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
    ids = []
    claimed_identifiers = {}
    pairs = {}
    for number, line in enumerate(dataset.read_text(encoding='utf-8').splitlines(), 1):
        try:
            row = json.loads(line)
            validator.validate(row)
            validate_record(row, institutions, projects, claimed_identifiers)
        except Exception as exc:
            raise ValueError(f'publication line {number}: {exc}') from exc
        pid = row['id']
        ids.append(pid)
        pairs[pid] = (row['type'], row['preprint_of'], row['published_as'])
    if ids != sorted(set(ids)):
        raise ValueError('publication IDs must be unique and sorted')
    for pid, (kind, preprint_of, published_as) in pairs.items():
        for target in (preprint_of, published_as):
            if target is None:
                continue
            if target == pid or target not in pairs:
                raise ValueError(f'{pid}: unresolved preprint/publication link')
            if (kind == 'preprint') == (pairs[target][0] == 'preprint'):
                raise ValueError(f'{pid}: link must connect a preprint and a journal version')
    return len(ids)


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
    if row['doi'] and unquote(row['url']) != 'https://doi.org/' + row['doi']:
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
    parser.add_argument('dataset', nargs='?', type=Path, default=DATASET)
    args = parser.parse_args()
    print(f'Validated {validate_records(args.dataset)} publication records')
