"""Project locally approved author-affiliation evidence into publication records."""
import argparse
from datetime import datetime
from html import unescape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import quote, urlsplit
from zoneinfo import ZoneInfo

from collect import pmid
from institutions import is_https, load_reference
from receipts import Receipts
from metadata import authorship, crossref_venue, earliest_date, normalized_date, source_url, title_of
from validate import CONTENT, DATASET, has_email, validate_records

EASTERN = ZoneInfo('America/New_York')
PROJECTS = CONTENT / 'public-directory-projects.json'


class TitleText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def plain(value):
    if not isinstance(value, str):
        return None
    parser = TitleText()
    parser.feed(unescape(unescape(value)))
    parser.close()
    text = ' '.join(unescape(''.join(parser.parts)).split())
    return text if text and not has_email(text) else None


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()]


def orcid(author):
    ident = author['orcid'] or {}
    if not isinstance(ident, dict) or ident.get('type', '').upper() != 'ORCID':
        return None
    value = ident.get('value', '').removeprefix('https://orcid.org/')
    return value if re.fullmatch(r'\d{4}-\d{4}-\d{4}-\d{3}[\dX]', value) else None


def journal(record):
    info = (record.get('journalInfo') or {}).get('journal') or {}
    book = record.get('bookOrReportDetails') or {}
    return plain(info.get('title') or book.get('publisher'))


def selected_terms(record):
    mesh = [r.get('descriptorName') for r in (record.get('meshHeadingList') or {}).get('meshHeading', [])]
    keywords = (record.get('keywordList') or {}).get('keyword') or record.get('subject') or []
    return list(dict.fromkeys(term for text in [*mesh, *keywords] if (term := plain(text))))[:12]


def open_access(record):
    links = (record.get('fullTextUrlList') or {}).get('fullTextUrl', [])
    url = next((link['url'] for link in links
                if link.get('availabilityCode') == 'OA' and is_https(link.get('url'))), None)
    if url or record.get('isOpenAccess') == 'Y':
        return {'status': 'open', 'license': plain(record.get('license')), 'url': url}
    free = next((link for link in links if link.get('availabilityCode') in {'F', 'U'}
                 and link.get('documentStyle', '').lower() in {'html', 'pdf'}
                 and is_https(link.get('url'))), None)
    if not free:
        return None
    status = ('accepted manuscript' if record.get('authMan') == 'Y'
              and free.get('site') in {'Europe_PMC', 'PMC'} else 'free to read')
    return {'status': status, 'license': None, 'url': free['url']}


def publisher_open_access(record, today):
    primary = ((record.get('resource') or {}).get('primary') or {}).get('URL')
    manuscript = None
    for license in record.get('license') or []:
        url = license.get('URL') or ''
        if not is_https(url) and not url.startswith('http://creativecommons.org/'):
            continue
        parts = urlsplit(url)
        if (parts.hostname != 'creativecommons.org'
                or not parts.path.startswith(('/licenses/', '/publicdomain/'))
                or license.get('content-version') not in {'vor', 'unspecified', 'am'}):
            continue
        start = (license.get('start') or {}).get('date-parts') or []
        if start and ((effective := normalized_date(start[0])) is None or effective > today):
            continue
        license_url = 'https://creativecommons.org' + parts.path
        if license['content-version'] == 'am':
            manuscript = {'status': 'accepted manuscript', 'license': license_url, 'url': None}
        else:
            return {'status': 'open', 'license': license_url, 'url': primary if is_https(primary) else None}
    return manuscript


def project_links(record, claimed_projects, projects):
    raw = [record.get('abstractText') or record.get('abstract') or '']
    for item in (record.get('fullTextUrlList') or {}).get('fullTextUrl', []):
        raw.append(item.get('url', ''))
    hits = set()
    for value in raw:
        for url in re.findall(r'https://github\.com/[\w.-]+/[\w.-]+', value or '', re.I):
            hits.add(url.casefold().rstrip('.').removesuffix('.git'))
    for pid in claimed_projects:
        if projects[pid]['code'].casefold() not in hits:
            raise ValueError('project link lacks exact repository in cited metadata')
    return sorted(set(claimed_projects))


def build_record(candidate, review, institutions, projects, previous, today):
    pid = candidate['id']
    if candidate['identifier_conflict'] or not pid or not review['evidence']:
        raise ValueError('approved record needs stable identifiers and literal evidence')
    matching = [item for item in candidate['observations']
                if item['provider'] in {'europepmc', 'crossref', 'publisher'}
                and source_url(item['provider'], item['record']) == review['source']]
    if len(matching) != 1:
        raise ValueError('approved source must match one retained provider observation')
    selected, = matching
    provider, source = selected['provider'], selected['record']
    source_name = {'europepmc': 'Europe PMC', 'crossref': 'Crossref', 'publisher': 'publisher'}[provider]
    id_values = dict((identifier.split(':', 1) for identifier in candidate['identifiers']))
    authors = authorship(provider, source)
    byline_sizes = {o['record']['author_count'] for o in candidate['observations']
                    if o['provider'] == 'publisher-byline'
                    and o['record'].get('doi') == id_values.get('doi')}
    if byline_sizes:
        if len(byline_sizes) != 1:
            raise ValueError('conflicting publisher byline counts')
        size, = byline_sizes
        if type(size) is not int or not 0 < size <= len(authors):
            raise ValueError('publisher byline count differs from source author range')
        authors = authors[:size]
    if not authors:
        raise ValueError('missing byline')
    regional = set()
    site_counties = set()
    matched = set()
    for evidence in review['evidence']:
        index = evidence['author_index']
        if type(index) is not int or not 0 <= index < len(authors):
            raise ValueError('evidence refers to absent author')
        if evidence['affiliation'] not in authors[index]['affiliations']:
            raise ValueError('no literal author affiliation in cited record')
        if evidence.get('place') is not None and (evidence['affiliation'], evidence['place']) not in (
                authors[index].get('affiliation_places') or []):
            raise ValueError('no literal place on the same author affiliation in cited record')
        slug = evidence['institution']
        inst = institutions[slug]
        county = evidence['county']
        if county is not None and county not in {site['county'] for site in inst['sites']}:
            raise ValueError('county is not a site of cited institution')
        if county:
            site_counties.add(county)
        matched.add(slug)
        regional.add(index)
    if review['decision'] != ('Verified' if site_counties else 'Listed'):
        raise ValueError('review label conflicts with placed affiliations')

    total = len(authors)
    visible = range(total) if total <= 30 else sorted(set(range(10)) | {total - 1} | regional)
    byline = [{'name': plain(authors[i]['name']), 'orcid': orcid(authors[i]), 'regional': i in regional}
              for i in visible]
    # OpenAlex can suggest a PubMed link. Carry it only when Europe PMC
    # or the National Library of Medicine's DOI crosswalk confirms it.
    pubmed_ids = set()
    pmc_ids = []
    available_access = open_access(source)
    free_access = None
    if available_access and available_access['status'] != 'open':
        free_access, available_access = available_access, None
    accepted_access = None
    access_policy = None
    published_licenses = set()
    terms = selected_terms(source)
    for observation in candidate['observations']:
        kind, item = observation['provider'], observation['record']
        if kind == 'publisher-keywords':
            if item.get('doi') != id_values.get('doi'):
                raise ValueError('publisher keywords must match the exact DOI')
            terms = terms or selected_terms(item)
            continue
        if kind == 'publisher-access':
            if item.get('doi') != id_values.get('doi'):
                raise ValueError('publisher access evidence must match the exact DOI')
            if item.get('fallback'):
                access_policy = item['access']
            else:
                available_access = item['access']
            continue
        if kind == 'crossref':
            if not available_access and (evidence := publisher_open_access(item, today)):
                if evidence['status'] == 'open':
                    available_access = evidence
                else:
                    accepted_access = evidence
            continue
        if kind not in {'europepmc', 'identifier-crosswalk'}:
            continue
        if kind == 'identifier-crosswalk' and item.get('doi') != id_values.get('doi'):
            raise ValueError('literature identifier crosswalk must match the exact DOI')
        if kind == 'europepmc':
            if not terms and provider == 'publisher':
                terms = selected_terms(item)
            if evidence := open_access(item):
                if evidence['status'] == 'open':
                    available_access = available_access or evidence
                else:
                    free_access = free_access or evidence
            if (item.get('source') == 'MED' and item.get('publicationStatus') in {'epublish', 'ppublish'}
                    and (license := plain(item.get('license'))) and license.lower().startswith('cc ')):
                published_licenses.add(license)
        value = pmid(item.get('pmid') or (item.get('id') if item.get('source') == 'MED' else None))
        if value:
            pubmed_ids.add(value)
        if item.get('pmcid'):
            pmc_ids.append(item['pmcid'])
    if len(pubmed_ids) > 1:
        raise ValueError('conflicting PubMed identifiers in the literature source')
    if access_policy and access_policy['status'] == 'open' and len(published_licenses) == 1:
        access_policy = {**access_policy, 'license': next(iter(published_licenses))}
    if available_access and not available_access['url'] and access_policy:
        available_access = {**available_access, 'url': access_policy['url']}
    identifier_type, native = pid.split(':', 1)
    resolvers = {'doi': 'https://doi.org/', 'pmid': 'https://pubmed.ncbi.nlm.nih.gov/',
                 'arxiv': 'https://arxiv.org/abs/'}
    names = ', '.join(institutions[slug]['name'] for slug in sorted(matched))
    connection = f'An author affiliation on the {source_name} record names {names}'
    if len(matched) > 1:
        connection = f'Author affiliations on the {source_name} record name ' + names
    hierarchy = sorted({institutions[slug]['parent'] for slug in matched
                        if institutions[slug]['parent']} - matched)
    if hierarchy:
        parents = ', '.join(institutions[slug]['name'] for slug in hierarchy)
        connection += f', with {parents} linked by the institution reference'
    if not connection.endswith('.'):
        connection += '.'
    matched.update(hierarchy)
    resolved = resolvers['doi'] + quote(id_values['doi'], safe='/') if id_values.get('doi') else (
        resolvers[identifier_type] + quote(native, safe='/')
    )
    types = (source.get('pubTypeList') or {}).get('pubType') or []
    retracted = ('retracted publication' in {term.casefold() for term in types}
                 or any(item['record'].get('is_retracted') is True for item in candidate['observations']))
    return {
        'id': pid, 'title': plain(title_of(provider, source)), 'type': review['type'],
        'published': earliest_date(candidate['observations'], through=today),
        'venue': plain(source.get('venue') if provider == 'publisher' else
                       journal(source) if provider == 'europepmc' else crossref_venue(source)),
        'doi': id_values.get('doi'), 'pmid': next(iter(pubmed_ids), None),
        'pmcid': next(iter(pmc_ids), None),
        'arxiv': id_values.get('arxiv') if identifier_type == 'arxiv' or
        (review['type'] == 'preprint' and (id_values.get('doi') or '').startswith('10.48550/arxiv.')) else None,
        'url': resolved, 'authors': byline, 'author_count': total,
        'institutions': sorted(matched), 'counties': sorted(site_counties), 'topic': review['topic'],
        'terms': terms, 'label': review['decision'], 'connection': connection,
        'source': review['source'], 'open_access': available_access or access_policy or free_access or accepted_access,
        'projects': project_links(source, review.get('projects', []), projects),
        'preprint_of': review.get('preprint_of'), 'published_as': review.get('published_as'),
        'retracted': retracted, 'added': previous.get(pid, {}).get('added', today), 'checked': today,
    }


def existing_id_index(records):
    return {f'{kind}:{row[kind]}': row['id'] for row in records
            for kind in ('doi', 'pmid', 'arxiv') if row[kind]}


def project(root, start, end, decisions, output, today, candidate_path=None):
    candidate_path = candidate_path or root / f'candidates-{start}-{end}.jsonl'
    by_key = {tuple(row['provider_key']): row for row in read_jsonl(candidate_path)}
    institutions = {row['id']: row for row in load_reference()}
    projects = {row['id']: row for row in json.loads(PROJECTS.read_bytes())}
    previous = {record['id']: record for record in read_jsonl(output)} if output.exists() else {}
    records = dict(previous)
    aliases = {}
    prior_ids = existing_id_index(previous.values())
    for review in read_jsonl(decisions):
        if review['decision'] not in ('Verified', 'Listed'):
            continue
        key = tuple(review['provider_key'])
        candidate = by_key[key]
        if candidate['id'] != review['id']:
            raise ValueError('review id differs from candidate')
        record = build_record(candidate, review, institutions, projects, previous, today)
        previous_ids = {prior_ids[i] for i in candidate['identifiers'] if i in prior_ids}
        if len(previous_ids) > 1:
            raise ValueError('candidate links multiple existing public IDs')
        if previous_ids:
            established_id, = previous_ids
            aliases[record['id']] = established_id
            record['id'] = established_id
            record['added'] = previous[established_id]['added']
        records[record['id']] = record
    for record in records.values():
        for field in ('preprint_of', 'published_as'):
            record[field] = aliases.get(record[field], record[field])
    temporary = root / 'publications-projection.tmp.jsonl'
    with temporary.open('w', encoding='utf-8') as stream:
        for pid in sorted(records):
            print(json.dumps(records[pid], ensure_ascii=False, separators=(',', ':')), file=stream)
    validate_records(temporary)
    temporary.replace(output)
    return len(records)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', type=Path)
    parser.add_argument('start')
    parser.add_argument('end')
    parser.add_argument('decisions', type=Path, help='orchestrator-approved private JSONL')
    parser.add_argument('--candidates', type=Path,
                        help='private candidate JSONL with retained supplemental observations')
    args = parser.parse_args()
    root = Receipts(args.run).root
    if not args.decisions.resolve(strict=True).is_relative_to(root):
        parser.error('decision file must be inside the private run directory')
    if args.candidates and not args.candidates.resolve(strict=True).is_relative_to(root):
        parser.error('candidate file must be inside the private run directory')
    n = project(root, args.start, args.end, args.decisions, DATASET,
                datetime.now(EASTERN).date().isoformat(), args.candidates)
    print(f'Projected {n} reviewed publications')
