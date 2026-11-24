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


def fetch(url):
    opener = build_opener(NoRedirect())
    for attempt in range(3):
        try:
            with opener.open(Request(url, headers={'User-Agent': 'The Valley Desk regional data checker', 'Accept': 'application/json'}), timeout=20) as response:
                if response.status != 200:
                    raise ValueError('http')
                body = response.read(MAX_BYTES + 1)
                if len(body) > MAX_BYTES:
                    raise ValueError('oversize')
                return json.loads(body)
        except HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise ValueError('http') from None
        except (URLError, TimeoutError, OSError):
            if attempt == 2:
                raise ValueError('network') from None
        time.sleep(2 ** attempt)
    raise ValueError('network')


def stage(d1, evidence, today, fetcher=fetch):
    """Return SQL only. Read all loaded listings, including hidden ones."""
    required = {'regional_data_checks', 'regional_data_removals'}
    present = {r['name'] for r in d1.rows("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('regional_data_checks','regional_data_removals')", 'regional data schema')}
    if not required <= present:
        return ''
    rows = d1.rows("SELECT id FROM research_listings WHERE kind='regional-data' ORDER BY id LIMIT 10001", 'regional data inventory')
    if len(rows) > 10000 or any(not ID.fullmatch(r['id']) for r in rows):
        raise ValueError('regional inventory invalid')
    previous = {r['id']: r for r in d1.rows('SELECT id,attempted,checked,publisher_updated,review_reason FROM regional_data_checks', 'regional data checks')}
    removed = {r['id'] for r in d1.rows('SELECT id FROM regional_data_removals', 'regional data removals')}
    due = []
    for row in rows:
        identifier = row['id']
        if identifier in removed:
            continue
        prior = previous.get(identifier, {})
        attempted = prior.get('attempted') or ''
        if attempted == today.isoformat():
            continue
        due.append((attempted, identifier, prior))
    per_host, sql = {}, []
    for _, identifier, prior in sorted(due):
        entry = evidence.get(identifier, {}).get('freshness')
        reason, updated, checked = None, prior.get('publisher_updated'), prior.get('checked')
        if not isinstance(entry, dict):
            reason = 'missing reviewed freshness locator'
        else:
            url = entry.get('url', '')
            parsed = urlsplit(url)
            # The seed evidence is the reviewed source configuration. Limit the
            # endpoint family until additional publishers are expressly reviewed.
            if (parsed.scheme != 'https' or parsed.netloc != 'data.cdc.gov' or parsed.query or parsed.fragment
                    or not re.fullmatch(r'/api/views/[a-z0-9]{4}-[a-z0-9]{4}\.json', parsed.path)
                    or entry.get('format') != 'json' or entry.get('path') != '/rowsUpdatedAt'):
                reason = 'unsupported reviewed freshness locator'
            else:
                # Requests are sequential, including retries: concurrency is one.
                try:
                    updated = publisher_date(pointer(fetcher(url), entry['path']), today)
                    checked = today.isoformat()
                    if date.fromisoformat(updated) < today - timedelta(days=730):
                        reason = 'publisher update older than two years; review'
                except (ValueError, KeyError, IndexError, TypeError, OverflowError, OSError):
                    reason = 'source check failed; review'
        values = [identifier, today.isoformat(), checked, updated, reason]
        literals = ','.join('NULL' if value is None else quote(value) for value in values)
        sql.append('INSERT INTO regional_data_checks(id,attempted,checked,publisher_updated,review_reason) VALUES(' + literals + ') ON CONFLICT(id) DO UPDATE SET attempted=excluded.attempted,checked=excluded.checked,publisher_updated=excluded.publisher_updated,review_reason=excluded.review_reason;')
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
        url = urlsplit(source)
        if (dataset not in dataset_ids or paper not in paper_ids or not ID.fullmatch(dataset)
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
