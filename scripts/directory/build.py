#!/usr/bin/env python3
"""Build the public directory from a frozen private input bundle and reviewed changes."""
import argparse
from contextlib import closing
from datetime import date
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

sys.dont_write_bytecode = True

from decide import decide, json_load, license_name, native_rows, timestamp, write_json, write_review
from qualification import SECRET
from regional import build_regional

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent.parent / 'src/content/public-directory-projects.json'
ID = re.compile(r'[1-9][0-9]{0,19}')


def https_url(value):
    if not isinstance(value, str) or not value.startswith('https://') or re.search(r'[\s\\]', value):
        return None
    try:
        url = urlsplit(value)
        if url.hostname and '@' not in url.netloc and url.port in (None, 443):
            return value
    except ValueError:
        pass
    return None


def native_language(value):
    if isinstance(value, dict):
        value = value.get('name')
    # Language names are native metadata, not prose. In particular R, C and C++
    # must survive without requiring two consecutive letters.
    if isinstance(value, str):
        name = value.strip()
        if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 .+#_()/-]{0,59}', name) and not SECRET.search(name):
            return name
    return None


def enrich(rows, inputs):
    uri = (inputs / 'inventory.sqlite').resolve().as_uri() + '?mode=ro&immutable=1'
    with closing(sqlite3.connect(uri, uri=True)) as db:
        accounts = {key: (login, kind) for key, login, kind in db.execute('SELECT key, login, kind FROM accounts')}
        metadata = {
            str(identity): (json.loads(repo), json.loads(read or '{}') or {})
            for identity, repo, read in db.execute('''
                SELECT r.id, r.metadata, d.metadata_evidence
                FROM repos r LEFT JOIN reads d ON r.id = d.repo_id
            ''')
        }
    natives = native_rows(inputs)
    led = json_load(inputs / 'prior/release-sources/led.json')
    if str(led['id']) != '528629935' or led['private'] or led['fork']:
        raise ValueError('The frozen LED_PVAE source must identify the public original repository')
    metadata['528629935'] = ({
        'homepageUrl': led.get('homepage'), 'createdAt': led['created_at'],
        'pushedAt': led['pushed_at'], 'archived': led['archived'],
    }, {})
    accounts.setdefault(led['owner']['login'].lower(), (led['owner']['login'], led['owner']['type']))
    for identity, row in rows.items():
        row['connection'] = row['connection'].replace('in the The ', 'in the ')
        # A few frozen roster cells concatenate sources. Keep the first cited
        # institutional URL without treating the entire cell as a single URL.
        if row.get('source') and ' ; ' in row['source']:
            row['source'] = row['source'].split(' ; ', 1)[0]
        owner = urlsplit(row['code']).path.split('/')[1]
        if account := accounts.get(owner.lower()):
            login, kind = account
            if login and kind in {'Organization', 'User'}:
                row['owner'] = {'login': login, 'name': None, 'kind': kind.lower()}
        if identity not in metadata:
            continue
        meta, read = metadata[identity]
        native = natives.get(identity, {})
        row.update(
            homepage=https_url(meta.get('homepageUrl')),
            created=timestamp(meta.get('createdAt')),
            pushed=timestamp(meta.get('pushedAt')),
        )
        if isinstance(meta.get('archived'), bool):
            row['archived'] = meta['archived']
        if not row.get('language'):
            for value in (native.get('primaryLanguage'), native.get('language'), read.get('language'), meta.get('language')):
                if language := native_language(value):
                    row['language'] = language
                    break
        if not row.get('license'):
            for value in (native.get('licenseInfo'), native.get('license'), read.get('license'), meta.get('license')):
                if license_value := license_name(value):
                    row['license'] = license_value
                    break


def changes_at(path, private):
    raw = json_load(path)
    if not isinstance(raw, dict):
        raise ValueError(f'{path.name}: expected overrides keyed by repository ID')
    for identity, changes in raw.items():
        if not ID.fullmatch(identity) or not isinstance(changes, list) or not changes:
            raise ValueError(f'{path.name}: invalid overrides for {identity}')
        fields = set()
        for change in changes:
            required = {'field', 'value', 'source', 'date', 'author'}
            allowed = required | ({'quote'} if private else set())
            if not isinstance(change, dict) or not required <= change.keys() <= allowed:
                raise ValueError(f'{identity}: malformed override')
            field = change['field']
            if not isinstance(field, str) or field in fields or field == 'id':
                raise ValueError(f'{identity}: invalid or duplicate override field')
            fields.add(field)
            if not https_url(change['source']) or date.fromisoformat(change['date']).isoformat() != change['date']:
                raise ValueError(f'{identity}.{field}: invalid source or date')
            if not isinstance(change['author'], str) or not change['author'].strip():
                raise ValueError(f'{identity}.{field}: missing author')
            if 'quote' in change and (not isinstance(change['quote'], str) or not 0 < len(change['quote']) <= 300):
                raise ValueError(f'{identity}.{field}: invalid evidence quote')
            yield identity, field, change['value']


def projection(public, dispositions, inputs, public_changes, private_changes, legacy_format=False):
    rows = {row['id']: row for row in public}
    if len(rows) != len(public):
        raise ValueError('Duplicate ID in decisions')
    declined = {row['id'] for row in dispositions if row['status'] == 'declined'}
    pending = []
    for path, private in [(public_changes, False), *((path, True) for path in private_changes)]:
        for identity, field, value in changes_at(path, private):
            if field == 'record':
                if identity in rows or not isinstance(value, dict) or value.get('id') != identity:
                    raise ValueError(f'{identity}: invalid or duplicate override addition')
                rows[identity] = dict(value)
                declined.discard(identity)
            else:
                if field == 'delist' and not private:
                    raise ValueError(f'{identity}: write delists to the private override file')
                pending.append((identity, field, value))

    if not legacy_format:
        enrich(rows, inputs)
    for identity, field, value in pending:
        if identity not in rows:
            raise ValueError(f'{identity}.{field}: override has no project')
        if field == 'delist':
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f'{identity}: missing delist reason')
            declined.add(identity)
        else:
            rows[identity][field] = value
    if legacy_format:
        for row in rows.values():
            row['connection'] = row['connection'].replace('in the The ', 'in the ')

    result = [row for id_, row in rows.items() if id_ not in declined]
    return sorted(result, key=lambda row: int(row['id'])), sorted(declined, key=int)


def atomic_write(target, content):
    with tempfile.NamedTemporaryFile(mode='wb', dir=target.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(content)
            stream.close()
            temporary.chmod(0o644)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inputs', type=Path, required=True, help='Frozen private input bundle')
    parser.add_argument('--review-dir', type=Path, required=True, help='Existing mode-0700 review directory')
    parser.add_argument('--output', type=Path, default=PUBLIC)
    parser.add_argument('--overrides', type=Path, default=HERE / 'overrides.json')
    parser.add_argument('--private-overrides', action='append', type=Path, default=[])
    parser.add_argument('--removals', action='append', type=Path, default=[])
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--added', default='2026-11-18')
    parser.add_argument('--acknowledge-drop', action='store_true')
    parser.add_argument('--launch-format', action='store_true', help='Reproduce the historical launch in the review directory')
    args = parser.parse_args()
    if args.review_dir.resolve().is_relative_to(HERE.parent.parent.resolve()) or args.review_dir.stat().st_mode & 0o077:
        parser.error('--review-dir must be private and outside the checkout')
    if args.launch_format and not args.output.resolve().is_relative_to(args.review_dir.resolve()):
        parser.error('--launch-format can only write inside --review-dir')
    for path in args.private_overrides:
        if not path.resolve().is_relative_to(args.review_dir.resolve()):
            parser.error('--private-overrides must be inside --review-dir')

    parts = decide(args.inputs, build_regional(args.inputs), date.fromisoformat(args.added).isoformat())
    rows, declined = projection(*parts[:2], args.inputs, args.overrides, args.private_overrides, args.launch_format)
    write_review(args.review_dir, *parts)
    blocked = args.review_dir / 'effective-decline-ids.json'
    write_json(blocked, declined)
    text = '[\n' + ',\n'.join('  ' + json.dumps(row, ensure_ascii=False) for row in rows) + '\n]\n'
    content = text.encode('utf-8')
    if not args.launch_format:
        candidate = args.review_dir / 'public-candidate.json'
        write_json(candidate, rows)
        command = ['node', str(HERE / 'validate.mjs'), '--file', str(candidate), '--decline', str(blocked)]
        baseline = args.baseline or (args.output if args.output.is_file() else PUBLIC)
        command.extend(['--baseline', str(baseline)])
        for path in args.removals:
            command.extend(['--removals', str(path)])
        if args.acknowledge_drop:
            command.append('--acknowledge-drop')
        subprocess.run(command, check=True)
    atomic_write(args.output, content)
    print(f'Wrote {len(rows)} public directory projects to {args.output}')


if __name__ == '__main__':
    main()
