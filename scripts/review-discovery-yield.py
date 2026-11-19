"""Frozen sample decisions and observed batch time; no public admission authority."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import time
from urllib.parse import urlsplit, parse_qs


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n').encode()


def stamp():
    return {'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
            'monotonicNs': time.monotonic_ns(), 'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip()}


def load_events(directory):
    path = directory / 'events.jsonl'
    events = [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
    previous, last_clock = None, None
    for event in events:
        clock = event['clock']
        if event['previousSha256'] != previous or last_clock and (clock['bootId'] != last_clock['bootId'] or clock['monotonicNs'] < last_clock['monotonicNs']):
            raise ValueError('event-chain-or-clock')
        previous, last_clock = digest(encoded(event)), clock
    return events


def append(directory, events, event):
    event['previousSha256'] = digest(encoded(events[-1])) if events else None
    fd = os.open(directory / 'events.jsonl', os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    with os.fdopen(fd, 'ab') as stream:
        stream.write(encoded(event))
        stream.flush()
        os.fsync(stream.fileno())


def nonempty(value, maximum=1000):
    return isinstance(value, str) and bool(value.strip()) and len(value) <= maximum and not re.search(r'[\x00-\x1f\x7f]', value)


def locator(value):
    if not nonempty(value, 2000):
        return False
    if value.startswith(('/workspace/', 'docs/discovery/')):
        return True
    url = urlsplit(value)
    return url.scheme == 'https' and bool(url.hostname) and not url.username and not url.password and not any(
        key.lower() in ('token', 'key', 'password', 'auth', 'signature') for key in parse_qs(url.query))


def valid_date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}(?:-\d\d(?:-\d\d)?)?', value):
        return False
    try:
        datetime.date.fromisoformat(value + {4: '-01-01', 7: '-01', 10: ''}[len(value)])
        return True
    except ValueError:
        return False


def validate_decisions(rows, ids, originals=None):
    if len(rows) != len(ids) or {r['nativeId'] for r in rows} != set(ids):
        raise ValueError('decision-roster')
    fields = ['usefulPurpose', 'healthRelevance', 'datedRegionalBasis', 'originalLink']
    for row in rows:
        if row['decision'] not in ('eligible', 'rejected', 'held') or any(row['criteria'].get(f) not in ('supported', 'unsupported', 'unknown') for f in fields):
            raise ValueError('decision-fields')
        statuses = list(row['criteria'][field] for field in fields)
        expected = 'rejected' if 'unsupported' in statuses else 'held' if 'unknown' in statuses else 'eligible'
        if row['decision'] != expected:
            raise ValueError('decision-disposition')
        evidence = row.get('evidence')
        if not nonempty(row.get('reason')) or not isinstance(evidence, list) or not evidence:
            raise ValueError('decision-evidence')
        covered = set()
        for item in evidence:
            if not isinstance(item, dict) or not isinstance(item.get('criteria'), list) or not item['criteria'] or any(f not in fields for f in item['criteria']) or not locator(item.get('locator')) or not nonempty(item.get('fact')) or not valid_date(item.get('observedDate')) or len(item['observedDate']) != 10:
                raise ValueError('decision-evidence')
            covered.update(item['criteria'])
        if any(row['criteria'][field] != 'unknown' and field not in covered for field in fields):
            raise ValueError('unreferenced-criterion')
        if row['decision'] == 'eligible':
            listing = row.get('preparedListing')
            if not isinstance(listing, dict) or any(not nonempty(listing.get(f)) for f in ['title', 'purpose', 'healthRelevance']):
                raise ValueError('unsupported-positive')
            if listing.get('nativeId') != row['nativeId'] or not originals or listing.get('originalUrl') != originals.get(row['nativeId']):
                raise ValueError('listing-identity')
            region = listing.get('regionalBasis')
            if not isinstance(region, dict) or not nonempty(region.get('text')) or not valid_date(region.get('date')) or region.get('dateBasis') not in ('source', 'observation') or not nonempty(region.get('scope')) or not valid_date(listing.get('lastCheckedDate')) or len(listing['lastCheckedDate']) != 10:
                raise ValueError('listing-regional-basis')
            if not isinstance(listing.get('sources'), list) or not listing['sources'] or any(source not in [item['locator'] for item in evidence] for source in listing['sources']):
                raise ValueError('listing-source')


def review_report(sample, events, directory):
    if events[-1]['kind'] == 'begin':
        raise ValueError('review-session-active')
    decisions, elapsed = {}, 0
    for index, event in enumerate(events):
        if event['kind'] != 'finish':
            continue
        start = events[index - 1]
        if start['kind'] != 'begin' or start['session'] != event['session']:
            raise ValueError('session-binding')
        duration = event['clock']['monotonicNs'] - start['clock']['monotonicNs']
        if duration <= 0:
            raise ValueError('clock-order')
        data = (directory / event['decisionsFile']).read_bytes()
        if digest(data) != event['decisionsSha256']:
            raise ValueError('decision-drift')
        rows = json.loads(data)
        validate_decisions(rows, start['nativeIds'], {r['nativeId']: r['observations'][0]['originalUrl'] for r in sample['rows']})
        for row in rows:
            decisions[row['nativeId']] = {**row, 'timingSession': event['session'], 'activeReviewMinutes': None}
        elapsed += duration
    ids = [row['nativeId'] for row in sample['rows']]
    if set(decisions) != set(ids):
        raise ValueError('sample-review-incomplete')
    counts = {state: sum(row['decision'] == state for row in decisions.values()) for state in ['eligible', 'rejected', 'held']}
    minutes = elapsed / 60000000000
    return {'id': sample['id'], 'visibility': 'private', 'publicationAuthorized': False,
            'reviewStatus': 'completed', 'sampleSize': len(ids), 'cohortSize': sample['denominator'], 'counts': counts,
            'eligibleFraction': counts['eligible'] / len(ids), 'agentReviewNanoseconds': elapsed,
            'agentReviewMinutes': minutes, 'minutesPerAdmissionReady': minutes / counts['eligible'] if counts['eligible'] else None,
            'minutesPerReviewedLead': minutes / len(ids), 'publicAdmissions': 0, 'actualPublicMinutesPerAdmission': None,
            'timeMeaning': 'Observed agent elapsed in review sessions including evidence-read latency and negative/held cases. Setup, independent review, code fixes/tests/CI excluded. Per-lead durations unmeasured; not a human workload estimate.',
            'decisions': [decisions[native_id] for native_id in ids]}


def main(args):
    directory = Path(args.directory)
    if not directory.is_absolute() or directory.resolve() != directory or not directory.is_relative_to('/workspace/build/builderbob'):
        raise ValueError('private-directory')
    directory.mkdir(mode=0o700, exist_ok=True)
    if directory.stat().st_uid != os.getuid() or directory.stat().st_mode & 0o077:
        raise ValueError('private-directory')
    sample_bytes, protocol_bytes = Path(args.sample).read_bytes(), Path(args.protocol).read_bytes()
    sample, protocol = json.loads(sample_bytes)['result'], json.loads(protocol_bytes)
    if digest(sample_bytes) != protocol['frozenSampleSha256'] or len(sample['rows']) != 100 or len({r['nativeId'] for r in sample['rows']}) != 100:
        raise ValueError('frozen-sample')
    events = load_events(directory)
    pins = {'sampleSha256': digest(sample_bytes), 'protocolSha256': digest(protocol_bytes), 'scriptSha256': digest(Path(__file__).read_bytes())}
    if events and events[0]['pins'] != pins:
        raise ValueError('review-input-drift')
    if not events:
        append(directory, events, {'kind': 'init', 'pins': pins, 'clock': stamp()})
        events = load_events(directory)
    if args.action == 'begin':
        if events[-1]['kind'] == 'begin' or not 1 <= args.first <= args.last <= 100:
            raise ValueError('review-session')
        session = str(len(events))
        ids = [row['nativeId'] for row in sample['rows'][args.first - 1:args.last]]
        append(directory, events, {'kind': 'begin', 'session': session, 'nativeIds': ids, 'clock': stamp()})
        return {'session': session, 'rows': [{'index': index + 1, 'nativeId': row['nativeId'],
                'repository': row['observations'][0]['fullName'], 'description': row['observations'][0]['description'],
                'fork': row['observations'][0]['fork']} for index, row in enumerate(sample['rows']) if args.first <= index + 1 <= args.last]}
    if args.action == 'finish':
        if events[-1]['kind'] != 'begin':
            raise ValueError('review-session')
        rows, start = json.loads(Path(args.decisions).read_bytes()), events[-1]
        validate_decisions(rows, start['nativeIds'], {r['nativeId']: r['observations'][0]['originalUrl'] for r in sample['rows']})
        name, data = f'decisions-{start["session"]}.json', encoded(rows)
        with (directory / name).open('xb') as stream:
            stream.write(data)
        append(directory, events, {'kind': 'finish', 'session': start['session'], 'decisionsFile': name,
                                  'decisionsSha256': digest(data), 'clock': stamp()})
        return {'session': start['session'], 'reviewed': len(rows)}
    return review_report(sample, events, directory)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['begin', 'finish', 'report'])
    parser.add_argument('--directory', required=True)
    parser.add_argument('--sample', required=True)
    parser.add_argument('--protocol', required=True)
    parser.add_argument('--first', type=int)
    parser.add_argument('--last', type=int)
    parser.add_argument('--decisions')
    print(json.dumps(main(parser.parse_args()), ensure_ascii=False))
