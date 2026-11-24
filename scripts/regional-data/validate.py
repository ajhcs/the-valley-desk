#!/usr/bin/env python3
"""Validate the public regional dataset contract without network access."""
import datetime
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

FIELDS = set('id title summary publisher portal url topic counties granularity time_span update_cadence access license formats api how_to_use added checked'.split())
COUNTIES = {'Bucks', 'Chester', 'Delaware', 'Montgomery', 'Philadelphia', 'Burlington', 'Camden', 'Gloucester', 'Mercer'}
TOPICS = {'Biomedical and life sciences', 'Clinical care', 'Disease research', 'Medical imaging', 'Neuroscience', 'Other science', 'Public health', 'Rehabilitation and accessibility', 'Research data'}


def string(value):
    return isinstance(value, str) and bool(value.strip()) and '\0' not in value


def url(value):
    if not string(value):
        return False
    parts = urlsplit(value)
    return parts.scheme == 'https' and bool(parts.hostname) and not parts.username and not parts.password


def validate_records(records):
    if not isinstance(records, list) or not records:
        raise ValueError('Expected nonempty regional data array')
    ids = set()
    for index, record in enumerate(records):
        if not isinstance(record, dict) or set(record) != FIELDS:
            raise ValueError(f'Record {index}: invalid fields')
        identifier = record['id']
        def require(condition, field):
            if not condition:
                raise ValueError(f'Record {identifier!r}: invalid {field}')
        require(string(identifier) and re.fullmatch(r'regional:[a-z0-9]+(?:-[a-z0-9]+)*', identifier) and identifier not in ids, 'id')
        ids.add(identifier)
        for field in ('title', 'summary', 'publisher', 'portal'):
            require(string(record[field]), field)
        require(url(record['url']), 'url')
        require(record['topic'] in TOPICS, 'topic')
        require(record['access'] in {'open', 'registration', 'controlled'}, 'access')
        counties = record['counties']
        require(isinstance(counties, list) and bool(counties) and all(isinstance(x, str) and x in COUNTIES for x in counties) and len(counties) == len(set(counties)), 'counties')
        for field in ('granularity', 'time_span', 'update_cadence', 'license'):
            require(record[field] is None or string(record[field]), field)
        formats = record['formats']
        require(formats is None or (isinstance(formats, list) and bool(formats) and all(string(x) for x in formats) and len(formats) == len(set(formats))), 'formats')
        api = record['api']
        require(api is None or (isinstance(api, dict) and set(api) == {'url', 'type'} and url(api['url']) and string(api['type'])), 'api')
        how = record['how_to_use']
        require(isinstance(how, dict) and set(how) == {'step', 'url', 'caveats', 'citation'}, 'how_to_use')
        require(string(how['step']) and url(how['url']) and string(how['citation']), 'how_to_use text or url')
        caveats = how['caveats']
        require(isinstance(caveats, list) and all(string(x) for x in caveats) and len(caveats) == len(set(caveats)), 'how_to_use.caveats')
        for field in ('added', 'checked'):
            try:
                valid = isinstance(record[field], str) and datetime.date.fromisoformat(record[field]).isoformat() == record[field]
            except ValueError:
                valid = False
            require(valid, field)


if __name__ == '__main__':
    try:
        for path in sys.argv[1:] or [str(Path(__file__).with_name('seed.json'))]:
            records = json.loads(Path(path).read_text())
            validate_records(records)
            print(f'{path}: {len(records)} valid records')
    except (ValueError, OSError, KeyError, TypeError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
