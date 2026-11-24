"""Bounded, opt-in checks for reviewed regional data sources."""
from datetime import date, datetime, timezone, timedelta
import json
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

from daily_d1 import quote

ID = re.compile(r"regional:[a-z0-9]+(?:-[a-z0-9]+)*\Z")
MAX_BYTES = 2_000_000

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def pointer(value, path):
    if not isinstance(path, str) or not path.startswith('/') or len(path) > 256:
        raise ValueError('invalid pointer')
    for part in path[1:].split('/'):
        if re.search(r'~(?![01])', part):
            raise ValueError('invalid pointer')
        key = part.replace('~1', '/').replace('~0', '~')
        value = value[int(key)] if isinstance(value, list) and key.isdigit() else value[key]
    return value


def publisher_date(value, today):
    if isinstance(value, bool):
        raise ValueError('invalid date')
    if isinstance(value, (int, float)):
        result = datetime.fromtimestamp(value, timezone.utc).date()
    elif isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}(?:T[^\s]+)?', value):
        result = date.fromisoformat(value[:10])
    else:
        raise ValueError('invalid date')
    if result > today or result.year < 1900:
        raise ValueError('invalid date')
    return result.isoformat()


APPROVED_HOSTS = {'data.cdc.gov', 'data.nj.gov', 'gisdata-njdep.opendata.arcgis.com',
                  'mapsdep.nj.gov', 'www.arcgis.com', 'gis.dep.pa.gov',
                  'opendataphilly.org', 'www2.census.gov', 'www.census.gov', 'api.census.gov'}


def valid_url(url):
    from urllib.parse import urlsplit
    try:
        parsed = urlsplit(url)
        return (parsed.scheme == 'https' and parsed.hostname in APPROVED_HOSTS
                and parsed.netloc == parsed.hostname and not parsed.fragment
                and len(url) <= 2048 and not any(c in url for c in '\r\n'))
    except (TypeError, ValueError):
        return False


def request(url, *, metadata=False):
    """Bounded requests with same-host redirects; no response bodies retained."""
    import socket
    import ipaddress
    from urllib.parse import urljoin
    if not valid_url(url):
        raise ValueError('unapproved URL')
    original_host = urlsplit(url).hostname
    opener = build_opener(NoRedirect())
    for redirects in range(6):
        host = urlsplit(url).hostname
        try:
            addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
            if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
                raise ValueError('nonpublic endpoint')
        except OSError:
            raise ValueError('DNS failure') from None
        for attempt in range(3):
            method = 'GET' if metadata else 'HEAD'
            headers = {'User-Agent': 'valley-desk-research/1.0', 'Accept': 'application/json' if metadata else '*/*'}
            try:
                try:
                    response = opener.open(Request(url, headers=headers, method=method), timeout=20)
                except HTTPError as error:
                    if not metadata and error.code in (403, 405, 501):
                        headers['Range'] = 'bytes=0-0'
                        response = opener.open(Request(url, headers=headers, method='GET'), timeout=20)
                    else:
                        raise
                with response:
                    if response.status not in (200, 206):
                        raise ValueError('HTTP failure')
                    if not metadata:
                        return dict(response.headers)
                    body = response.read(MAX_BYTES + 1)
                    if len(body) > MAX_BYTES:
                        raise ValueError('oversize')
                    return json.loads(body)
            except HTTPError as error:
                if error.code in (301, 302, 303, 307, 308):
                    target = urljoin(url, error.headers.get('Location', ''))
                    if not valid_url(target) or urlsplit(target).hostname != original_host or target == url:
                        raise ValueError('unsafe redirect') from None
                    url = target
                    break
                if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                    raise ValueError('HTTP failure') from None
                retry = error.headers.get('Retry-After', '') if error.code == 429 else ''
            except (URLError, TimeoutError, OSError):
                if attempt == 2:
                    raise ValueError('network failure') from None
            delay = 2 ** attempt
            if locals().get('retry', '').isdigit():
                delay = min(30, max(delay, int(retry)))
            retry = ''
            time.sleep(delay)
        else:
            raise ValueError('network failure')
        # The only break above is a reviewed same-host redirect.
    raise ValueError('redirect limit')


def approved_landing(identifier, record, entry):
    url = record.get('url')
    if not valid_url(url):
        return False
    urls = entry.get('fields', {}).get('url', [])
    if url in urls:
        return True
    # CDC evidence identifies the same view via its reviewed API endpoint.
    match = re.fullmatch(r'https://data\.cdc\.gov/d/([a-z0-9]{4}-[a-z0-9]{4})', url)
    return bool(match and f'https://data.cdc.gov/api/views/{match[1]}.json' in urls
                and identifier == 'regional:cdc-' + match[1])


def metadata_value(locator, fetcher):
    url = locator.get('url')
    if not valid_url(url):
        raise ValueError('invalid locator')
    fmt = locator.get('format')
    if fmt == 'json':
        value = pointer(fetcher(url, metadata=True), locator.get('path'))
        if locator.get('units') == 'milliseconds':
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError('invalid milliseconds')
            value /= 1000
        elif locator.get('units') not in (None, 'seconds'):
            raise ValueError('invalid units')
        return value
    if fmt == 'http-last-modified':
        from email.utils import parsedate_to_datetime
        value = next((v for k, v in fetcher(url, metadata=False).items() if k.lower() == 'last-modified'), None)
        if not value:
            raise ValueError('missing Last-Modified')
        return parsedate_to_datetime(value).date().isoformat()
    raise ValueError('invalid locator')


def stage(d1, evidence, today, fetcher=request):
    """Return SQL only. Read all loaded listings, including hidden ones."""
    required = {'regional_data_checks', 'regional_data_removals'}
    present = {r['name'] for r in d1.rows("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('regional_data_checks','regional_data_removals')", 'regional data schema')}
    if not required <= present:
        return ''
    rows = d1.rows("SELECT id,record FROM research_listings WHERE kind='regional-data' ORDER BY id LIMIT 10001", 'regional data inventory')
    if len(rows) > 10000 or any(not ID.fullmatch(r['id']) for r in rows):
        raise ValueError('regional inventory invalid')
    previous = {r['id']: r for r in d1.rows('SELECT id,attempted,checked,publisher_updated,review_reason FROM regional_data_checks', 'regional data checks')}
    removed = {r['id'] for r in d1.rows('SELECT id FROM regional_data_removals', 'regional data removals')}
    sql = []
    cadence_days = {'daily': 1, 'weekly': 7, 'monthly': 31, 'quarterly': 92, 'annually': 366, 'annual': 366, 'yearly': 366}
    for row in rows:
        identifier = row['id']
        if identifier in removed:
            continue
        prior = previous.get(identifier, {})
        if (prior.get('attempted') or '') >= today.isoformat():
            continue
        record = json.loads(row['record'])
        if record.get('id') != identifier:
            raise ValueError('regional inventory identity mismatch')
        entry = evidence.get(identifier, {})
        cadence = record.get('update_cadence')
        threshold = cadence_days.get(cadence.lower().strip()) if isinstance(cadence, str) else None
        reason, updated, checked = None, prior.get('publisher_updated'), prior.get('checked')
        try:
            if not approved_landing(identifier, record, entry):
                raise ValueError('unreviewed landing')
            fetcher(record['url'], metadata=False)
            locator = entry.get('freshness')
            if locator is not None:
                if not isinstance(locator, dict):
                    raise ValueError('invalid locator')
                updated = publisher_date(metadata_value(locator, fetcher), today)
            elif cadence:
                reason = 'publisher update unavailable for stated cadence; review'
            else:
                updated = None
            checked = today.isoformat()
            if cadence and threshold is None:
                reason = 'unrecognized stated cadence; review'
            elif updated and threshold is not None and date.fromisoformat(updated) < today - timedelta(days=threshold):
                reason = 'publisher update overdue for stated cadence; review'
        except (ValueError, KeyError, IndexError, TypeError, OverflowError, OSError):
            reason = 'source check failed; review'
            updated, checked = prior.get('publisher_updated'), prior.get('checked')
        values = [identifier, today.isoformat(), checked, updated, reason]
        literals = ','.join('NULL' if value is None else quote(value) for value in values)
        sql.append('INSERT INTO regional_data_checks(id,attempted,checked,publisher_updated,review_reason) VALUES(' + literals + ') ON CONFLICT(id) DO UPDATE SET attempted=excluded.attempted,checked=excluded.checked,publisher_updated=excluded.publisher_updated,review_reason=excluded.review_reason WHERE excluded.attempted > regional_data_checks.attempted;')
    return '\n'.join(sql) + ('\n' if sql else '')

def publication_sql(manifest, dataset_ids, paper_ids):
    """Stage only explicit, individually reviewed exact-name evidence."""
    statements, seen = [], set()
    if not isinstance(manifest, list):
        raise ValueError('invalid publication manifest')
    for item in manifest:
        if set(item) != {'dataset_id', 'paper_id', 'source', 'evidence', 'reviewed'} or item['reviewed'] is not True:
            raise ValueError('unreviewed publication link')
        dataset, paper = item['dataset_id'], item['paper_id']
        source, evidence = item['source'], item['evidence']
        if not isinstance(source, str) or not isinstance(paper, str):
            raise ValueError('invalid publication link')
        url = urlsplit(source)
        if (dataset not in dataset_ids or paper not in paper_ids or not isinstance(dataset, str) or not ID.fullmatch(dataset)
                or not re.fullmatch(r'(?:pmid:[0-9]{1,12}|doi:10\.[0-9]{4,9}/[^\s]{1,180})', paper)
                or url.scheme != 'https' or not url.hostname or url.username or url.password
                or not isinstance(evidence, str) or not evidence.strip() or len(evidence) > 2000
                or (dataset, paper) in seen):
            raise ValueError('invalid publication link')
        seen.add((dataset, paper))
        values = ','.join(quote(v) for v in (dataset, paper, source, evidence))
        statements.append('INSERT INTO regional_data_publications(dataset_id,paper_id,source,evidence) VALUES(' + values + ') ON CONFLICT(dataset_id,paper_id) DO NOTHING;')
    return '\n'.join(statements) + ('\n' if statements else '')


def main():
    import argparse
    from pathlib import Path
    parser = argparse.ArgumentParser(description='Stage reviewed regional publication links; never connects to D1')
    parser.add_argument('--reviewed', type=Path, required=True, help='Private reviewed JSON array')
    parser.add_argument('--datasets', type=Path, required=True, help='JSON array of loaded regional listings')
    parser.add_argument('--papers', type=Path, required=True, help='JSON array of loaded publication listings')
    args = parser.parse_args()
    reviewed = json.loads(args.reviewed.read_text())
    datasets = json.loads(args.datasets.read_text())
    papers = json.loads(args.papers.read_text())
    print(publication_sql(reviewed, {row['id'] for row in datasets}, {row['id'] for row in papers}), end='')


if __name__ == '__main__':
    main()
