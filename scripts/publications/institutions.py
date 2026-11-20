"""Read The Valley Desk's public institution reference."""
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

COUNTIES = {
    'PA': {'Bucks', 'Chester', 'Delaware', 'Montgomery', 'Philadelphia'},
    'NJ': {'Burlington', 'Camden', 'Gloucester', 'Mercer'},
}
KINDS = {'university', 'hospital or health system', 'research institute', 'company', 'government', 'nonprofit'}
FIELDS = {'id', 'name', 'aliases', 'parent', 'kind', 'ror', 'homepage', 'sites', 'outside'}
SITE_FIELDS = {'name', 'place', 'county', 'state', 'source'}
REFERENCE = Path(__file__).resolve().parents[2] / 'src/content/public-directory-institutions.json'


def is_text(value):
    return isinstance(value, str) and bool(value) and value == value.strip() and not any(
        ord(char) < 32 for char in value
    )


def is_https(value):
    if not is_text(value):
        return False
    try:
        url = urlsplit(value)
        return url.scheme == 'https' and bool(url.hostname) and url.username is None and url.port in (None, 443)
    except ValueError:
        return False


def validate(rows):
    if not isinstance(rows, list) or not rows:
        raise ValueError('expected a nonempty array of institutions')

    by_id = {}
    ror_ids = set()
    for row in rows:
        if not isinstance(row, dict) or row.keys() != FIELDS:
            raise ValueError('unexpected institution fields')
        slug = row['id']
        if not is_text(slug) or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', slug) or slug in by_id:
            raise ValueError(f'invalid or duplicate institution id {slug!r}')
        if not is_text(row['name']) or not is_text(row['kind']) or row['kind'] not in KINDS:
            raise ValueError(f'{slug}: invalid name or kind')
        aliases = row['aliases']
        if not isinstance(aliases, list) or not all(map(is_text, aliases)) or len(set(aliases)) != len(aliases):
            raise ValueError(f'{slug}: invalid or duplicate aliases')
        if not is_https(row['homepage']) or type(row['outside']) is not bool:
            raise ValueError(f'{slug}: invalid homepage or outside flag')
        ror = row['ror']
        if ror is not None:
            if not is_text(ror) or not re.fullmatch(r'https://ror\.org/0[0-9a-hj-km-np-tv-z]{6}[0-9]{2}', ror) or ror in ror_ids:
                raise ValueError(f'{slug}: invalid or duplicate ROR')
            ror_ids.add(ror)
        if row['parent'] is not None and not is_text(row['parent']):
            raise ValueError(f'{slug}: invalid parent')
        if not isinstance(row['sites'], list) or not row['sites']:
            raise ValueError(f'{slug}: expected at least one site')
        names = set()
        for site in row['sites']:
            if not isinstance(site, dict) or site.keys() != SITE_FIELDS or not all(map(is_text, site.values())):
                raise ValueError(f'{slug}: invalid site fields')
            if site['county'] not in COUNTIES.get(site['state'], ()) or not is_https(site['source']):
                raise ValueError(f'{slug}: invalid site geography or source')
            if site['name'] in names:
                raise ValueError(f'{slug}: duplicate site name')
            names.add(site['name'])
        by_id[slug] = row

    if list(by_id) != sorted(by_id):
        raise ValueError('institution records must be sorted by id')
    for slug, row in by_id.items():
        visited = {slug}
        parent = row['parent']
        while parent is not None:
            if parent not in by_id or parent in visited:
                raise ValueError(f'{slug}: invalid or cyclic parent chain')
            visited.add(parent)
            parent = by_id[parent]['parent']


def load_reference(path=REFERENCE):
    rows = json.loads(Path(path).read_text(encoding='utf-8'))
    validate(rows)
    return rows


if __name__ == '__main__':
    rows = load_reference()
    print(f'Validated {len(rows)} institutions and {sum(len(row["sites"]) for row in rows)} sites')
