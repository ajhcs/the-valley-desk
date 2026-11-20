"""Read publication metadata at the precision stated by the provider."""
from datetime import date
import re
from urllib.parse import quote, urlsplit

from review_packets import epmc_authors, epmc_source

MONTH = {name: i for i, name in enumerate(
    ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'), 1
)}


def crossref_source(record):
    return 'https://api.crossref.org/works/' + quote(record['DOI'].lower(), safe='/')


def crossref_authors(record):
    return [
        {
            'name': author.get('name') or ' '.join(
                part for part in (author.get('given'), author.get('family'), author.get('suffix')) if part),
            'orcid': {'type': 'ORCID', 'value': author['ORCID']} if author.get('ORCID') else None,
            'affiliations': [a['name'] for a in author.get('affiliation', [])
                             if isinstance(a.get('name'), str) and a['name'].strip()],
            'affiliation_places': [(a['name'], place) for a in author.get('affiliation', [])
                                   if isinstance(a.get('name'), str)
                                   for place in a.get('place') or [] if isinstance(place, str)],
        }
        for author in record.get('author', [])
    ]


def authorship(provider, record):
    if provider == 'publisher':
        return record['authors']
    return epmc_authors(record) if provider == 'europepmc' else crossref_authors(record)


def source_url(provider, record):
    if provider == 'publisher':
        return record['url']
    return epmc_source(record) if provider == 'europepmc' else crossref_source(record)


def title_of(provider, record):
    title = record.get('title')
    return (title or [None])[0] if provider == 'crossref' else title


def crossref_venue(record):
    container = (record.get('container-title') or [None])[0]
    if container:
        return container
    affiliation = (record.get('institution') or [None])[0]
    if isinstance(affiliation, dict) and affiliation.get('name'):
        return affiliation['name']
    if record.get('type') == 'posted-content':
        url = ((record.get('resource') or {}).get('primary') or {}).get('URL') or ''
        venues = {'chemrxiv.org': 'ChemRxiv', 'biorxiv.org': 'bioRxiv', 'medrxiv.org': 'medRxiv'}
        return venues.get((urlsplit(url).hostname or '').removeprefix('www.'))
    return None


def normalized_date(parts):
    if (not isinstance(parts, list) or not 1 <= len(parts) <= 3
            or any(type(n) is not int for n in parts)):
        return None
    year, month, day = (parts + [1, 1])[:3]
    try:
        date(year, month, day)
    except ValueError:
        return None
    suffix = [f'{month:02d}', f'{day:02d}'][:len(parts)-1]
    return '-'.join([f'{year:04d}', *suffix])


def iso_precision(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}(?:-\d{2}){0,2}', value):
        return None
    return normalized_date([int(part) for part in value.split('-')])


def issue_date(value):
    if not isinstance(value, str):
        return None
    value = value.strip()
    if parsed := iso_precision(value):
        return parsed
    found = re.fullmatch(r'(\d{4})(?: ([A-Za-z]+)(?: (\d{1,2}))?)?', value)
    if not found:
        return None
    year, month, day = found.groups()
    parts = [int(year)]
    if month:
        if month[:3].title() not in MONTH:
            return None
        parts.append(MONTH[month[:3].title()])
    if day:
        parts.append(int(day))
    return normalized_date(parts)


def epmc_dates(record):
    journal = record.get('journalInfo') or {}
    reported = journal.get('dateOfPublication') or ''
    printed = issue_date(reported)
    electronic = iso_precision(record.get('electronicPublicationDate'))
    first = iso_precision(record.get('firstPublicationDate'))
    if printed and first and len(printed) < len(first):
        padding = '-01' * ((len(first) - len(printed)) // 3)
        if first == printed + padding:
            first = printed
    if printed is None and first and re.fullmatch(r'\d{4} [A-Za-z]+[-–][A-Za-z]+', reported.strip()):
        printed = reported[:4]
        first = None
    return [d for d in (printed, electronic, first) if d]


def crossref_dates(record, unassigned_issue_dates=()):
    values = {}
    for name in ('published-online', 'published-print', 'posted', 'issued', 'published'):
        parts = (record.get(name) or {}).get('date-parts') or []
        if parts and (parsed := normalized_date(parts[0])):
            values[name] = parsed
    history = {a['name']: parsed for a in record.get('assertion') or []
               if a.get('name') in {'published', 'received'} and (parsed := iso_precision(a.get('value')))}
    online = values.get('published-online')
    printed = values.get('published-print')
    issue = record.get('issue') or (record.get('journal-issue') or {}).get('issue')
    created_parts = (record.get('created') or {}).get('date-parts') or []
    created = normalized_date(created_parts[0]) if created_parts else None
    if online and not printed and not issue and created and created < online:
        for name in ('issued', 'published'):
            if values.get(name) == created:
                values.pop(name)
    if not issue and printed in unassigned_issue_dates and not online:
        # An indexer's ahead-of-print citation has no assigned print issue.
        values = {key: value for key, value in values.items() if value != printed}
    received = history.get('received')
    confirmed = history.get('published') or online
    if received and confirmed and len(received) == 10 and confirmed >= received:
        # An issue timestamp before the article was received cannot date the article.
        values = {key: value for key, value in values.items() if value >= received[:len(value)]}
    if online and printed in (online[:4] + '-01', online[:4] + '-01-01') and online[5:7] != '01':
        # The first month can be an annual rolling-volume placeholder.
        annual_issue = record.get('volume') == online[:4] and issue == '1'
        if not issue or annual_issue:
            values = {key: value for key, value in values.items() if value != printed}
    return [*values.values(), *([history['published']] if 'published' in history else [])]


def earliest_date(observations):
    """Prefer a precise date when it refines a date without a known month or day."""
    values = set()
    confirmed = []
    unassigned_issue_dates = {
        journal['printPublicationDate']
        for obs in observations if obs['provider'] == 'europepmc'
        and obs['record'].get('publicationStatus') == 'aheadofprint'
        and obs['record'].get('electronicPublicationDate')
        and (journal := obs['record'].get('journalInfo') or {})
        and not journal.get('issue') and journal.get('printPublicationDate')
    }
    for obs in observations:
        if obs['provider'] == 'europepmc':
            values.update(epmc_dates(obs['record']))
        elif obs['provider'] == 'crossref':
            values.update(crossref_dates(obs['record'], unassigned_issue_dates))
        elif obs['provider'] in {'publisher', 'publication-date'}:
            if explicit := iso_precision(obs['record'].get('published')):
                values.add(explicit)
                if obs['record'].get('publisher_confirmed_conflict'):
                    confirmed.append(explicit)
    if confirmed:
        return min(confirmed)
    precise = [value for value in values if not any(other.startswith(value + '-') for other in values)]
    return min(precise, default=None)
