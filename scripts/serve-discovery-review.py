"""Serve or export private discovery decisions from the local workstation."""
from argparse import ArgumentParser
from contextlib import closing
from datetime import date
from hashlib import sha256
from hmac import compare_digest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
from secrets import token_urlsafe
import sqlite3
import stat
from tempfile import NamedTemporaryFile
from threading import Lock
from urllib.parse import parse_qsl, urlsplit

PRIVATE_ROOT = Path('/workspace/build/builderbob')
ASSET_ROOT = Path(__file__).resolve().parents[1] / 'ops' / 'discovery-review'
ASSETS = {
    '/': ('index.html', 'text/html; charset=utf-8'),
    '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
    '/styles.css': ('styles.css', 'text/css; charset=utf-8'),
}
CRITERIA = ('usefulPurpose', 'healthRelevance', 'datedRegionalBasis', 'originalLink')
STATUSES = {'supported', 'unsupported', 'unknown'}
REPOSITORY = re.compile(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}')
NATIVE_ID = re.compile(r'[1-9][0-9]{0,19}')
MAX_INPUT_BYTES = 8 * 1024 * 1024
MAX_CANDIDATES = 2000
MAX_DECISION_BYTES = 16 * 1024
DESCRIPTION_CONTROLS = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff]')
ACCESS_TOKEN = re.compile(r'[A-Za-z0-9_-]{43}')


def require(condition, error):
    if not condition:
        raise ValueError(error)


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def object_from_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate-json-key')
        result[key] = value
    return result


def decode_json(raw):
    return json.loads(raw, object_pairs_hook=object_from_pairs)


def digest(raw):
    return sha256(raw).hexdigest()


def fields(value, required, optional=()):
    return isinstance(value, dict) and set(required) <= set(value) <= (set(required) | set(optional))


def nonempty(value, size):
    return isinstance(value, str) and 0 < len(value) <= size and bool(value.strip()) and all(
        ord(char) >= 32 and ord(char) != 127 for char in value
    )


def day(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        return False
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def https(value):
    if not nonempty(value, 2000) or any(c.isspace() or c == '\\' for c in value):
        return False
    try:
        url = urlsplit(value)
        return (
            url.scheme == 'https' and bool(url.hostname)
            and url.username is None and url.password is None
            and url.port in (None, 443)
            and not any(key.casefold() in {'access_token', 'token', 'key', 'password', 'auth', 'signature'}
                        for key, _ in parse_qsl(url.query, keep_blank_values=True, max_num_fields=128))
        )
    except ValueError:
        return False


def private_path(raw_path, *, ledger=False):
    path = Path(raw_path)
    require(path.is_absolute() and path.is_relative_to(PRIVATE_ROOT) and path.resolve() == path,
            'private-workspace-path-required')
    owner = os.getuid()
    require(path.parent.is_dir() and path.parent.stat().st_uid == owner, 'private-workspace-owner')
    if ledger:
        require(path.parent.stat().st_mode & 0o077 == 0, 'ledger-parent-must-be-private')
    if path.exists():
        metadata = path.stat()
        require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == owner, 'private-file-owner')
        if ledger:
            require(metadata.st_mode & 0o077 == 0 and metadata.st_nlink == 1, 'ledger-must-be-private')
    return path


def read_input(path):
    with private_path(path).open('rb') as stream:
        raw = stream.read(MAX_INPUT_BYTES + 1)
    require(len(raw) <= MAX_INPUT_BYTES, 'input-too-large')
    return decode_json(raw), digest(raw)


def private_envelope(value):
    return isinstance(value, dict) and value.get('visibility') == 'private' and value.get('publicationAuthorized') is False


def local_locator(value):
    if not nonempty(value, 2000) or '\\' in value:
        return False
    path = value.split('#', 1)[0]
    for prefix in (str(PRIVATE_ROOT) + '/', 'docs/discovery/'):
        if path.startswith(prefix):
            return all(part not in ('', '.', '..') for part in path[len(prefix):].split('/'))
    return False


def evidence_row(native_id, locator, fact, observed_date, criteria, *, local_ref=None):
    require(locator is None or https(locator), 'evidence-url')
    require(local_ref is None or (locator is None and local_locator(local_ref)), 'evidence-local-locator')
    require(nonempty(fact, 1000) and day(observed_date), 'evidence-fact-or-date')
    require(isinstance(criteria, list) and 0 < len(criteria) <= len(CRITERIA)
            and all(item in CRITERIA for item in criteria) and len(criteria) == len(set(criteria)), 'evidence-criteria')
    row = {'locator': locator, 'fact': fact, 'observedDate': observed_date,
           'criteria': [criterion for criterion in CRITERIA if criterion in criteria]}
    if local_ref is not None:
        row['localLocator'] = local_ref
    return {'id': 'sha256:' + digest(json_bytes([native_id, row])), **row}


def observation_url(observation, native_id):
    require(isinstance(observation, dict), 'queue-observations')
    repository = observation.get('fullName')
    require(isinstance(repository, str) and REPOSITORY.fullmatch(repository)
            and repository.split('/')[1] not in ('.', '..') and observation.get('nativeId') == native_id,
            'queue-identity')
    url = observation.get('originalUrl')
    require(url == f'https://github.com/{repository}', 'queue-original-url')
    return url


def canonical_candidate(candidate):
    require(isinstance(candidate, dict), 'queue-candidate')
    native_id = candidate.get('nativeId')
    require(isinstance(native_id, str) and NATIVE_ID.fullmatch(native_id), 'queue-native-id')
    observations = candidate.get('observations')
    require(isinstance(observations, list) and observations, 'queue-observations')
    aliases = list(dict.fromkeys(observation_url(row, native_id) for row in observations))
    first = observations[0]
    description = first.get('description')
    require(description is None or (isinstance(description, str) and not DESCRIPTION_CONTROLS.search(description)
            and len(description.encode('utf-16-le')) <= 4000), 'queue-description')
    observed_at = first.get('observedAt')
    require(isinstance(observed_at, str) and day(observed_at[:10]), 'queue-observation-date')
    require(type(first.get('fork')) is bool and type(first.get('archived')) is bool, 'queue-flags')
    facts = 'Retained GitHub metadata identifies this repository and its original link.'
    criteria = ['originalLink']
    summary = ' '.join(description.split()) if description else ''
    if summary:
        prefix = facts + ' Repository description: '
        room = 1000 - len(prefix)
        facts = prefix + (summary if len(summary) <= room else summary[:room - 1] + '…')
        criteria.extend(('usefulPurpose', 'healthRelevance'))
    metadata = evidence_row(native_id, aliases[0], facts, observed_at[:10], criteria)
    return {'nativeId': native_id, 'repository': first['fullName'], 'originalUrl': aliases[0],
            'observedAliases': aliases, 'description': description,
            'fork': first['fork'], 'archived': first['archived'], 'evidence': [metadata]}


def decide(criteria):
    require(isinstance(criteria, dict) and set(criteria) == set(CRITERIA)
            and all(isinstance(item, str) and item in STATUSES for item in criteria.values()), 'decision-criteria')
    if all(item == 'supported' for item in criteria.values()):
        return 'eligible'
    return 'rejected' if 'unsupported' in criteria.values() else 'held'


def select_evidence(candidate, criteria, evidence_refs):
    require(isinstance(evidence_refs, list) and 0 < len(evidence_refs) <= 30
            and all(isinstance(item, str) for item in evidence_refs)
            and len(evidence_refs) == len(set(evidence_refs)), 'evidence-refs')
    indexed = {item['id']: item for item in candidate['evidence']}
    require(all(item in indexed for item in evidence_refs), 'evidence-not-bound')
    evidence = [indexed[ref] for ref in evidence_refs]
    covered = {key for item in evidence for key in item['criteria']}
    require(all(value == 'unknown' or key in covered for key, value in criteria.items()), 'criterion-without-evidence')
    return evidence


def make_listing(candidate, listing, evidence, *, prefilled=False):
    require(len(candidate['observedAliases']) == 1, 'listing-identity-needs-review')
    keys = ('title', 'purpose', 'healthRelevance', 'regionalBasis')
    bound = ('nativeId', 'originalUrl', 'lastCheckedDate', 'sources')
    require(fields(listing, keys + bound if prefilled else keys), 'prepared-listing-required')
    require(all(nonempty(listing[key], size) for key, size in
                [('title', 200), ('purpose', 600), ('healthRelevance', 600)]), 'prepared-listing-fields')
    region = listing['regionalBasis']
    require(fields(region, ('text', 'date', 'dateBasis', 'scope'))
            and nonempty(region['text'], 750) and nonempty(region['scope'], 750)
            and isinstance(region['date'], str) and re.fullmatch(r'\d{4}(?:-\d{2}(?:-\d{2})?)?', region['date'])
            and day(region['date'] + {4: '-01-01', 7: '-01', 10: ''}[len(region['date'])])
            and region['dateBasis'] in ('source', 'observation'), 'listing-regional-basis')
    external = list(dict.fromkeys(item['locator'] for item in evidence if item['locator'] is not None))
    require(any(item['locator'] and 'datedRegionalBasis' in item['criteria'] for item in evidence),
            'listing-region-needs-linked-evidence')
    if prefilled:
        require(listing['nativeId'] == candidate['nativeId'] and listing['originalUrl'] == candidate['originalUrl']
                and day(listing['lastCheckedDate']) and isinstance(listing['sources'], list)
                and listing['sources'] and all(source in external for source in listing['sources']), 'listing-source-binding')
        return listing
    return {**listing, 'nativeId': candidate['nativeId'], 'originalUrl': candidate['originalUrl'],
            'lastCheckedDate': max(item['observedDate'] for item in evidence), 'sources': external}


def attach(candidate, row):
    if row['id'] not in {item['id'] for item in candidate['evidence']}:
        candidate['evidence'].append(row)
    return row['id']


class Review:
    def __init__(self, queue, ledger, prefill=None, extra_evidence=None, *, initialize=True):
        envelope, self.queue_hash = read_input(queue)
        payload = envelope.get('result') if isinstance(envelope, dict) and envelope.get('ok') is True else None
        require(private_envelope(payload) and payload.get('schemaVersion') == 'github-owned-metadata-v2', 'queue-scope')
        rows = payload.get('candidates')
        require(isinstance(rows, list) and 0 < len(rows) <= MAX_CANDIDATES, 'queue-size')
        self.candidates = {}
        for row in rows:
            candidate = canonical_candidate(row)
            native_id = candidate['nativeId']
            require(native_id not in self.candidates, 'queue-duplicate-native-id')
            self.candidates[native_id] = candidate
        self.prefill = {}
        prefill_hash = self.load_prefill(prefill) if prefill else None
        evidence_hash = self.load_evidence(extra_evidence) if extra_evidence else None
        self.roster_hash = digest(json_bytes([self.queue_hash, prefill_hash]))
        self.context_hash = digest(json_bytes([self.roster_hash, evidence_hash]))
        self.ledger = private_path(ledger, ledger=True)
        if initialize:
            self.initialize_ledger()
        else:
            require(self.ledger.exists(), 'ledger-missing')
            with closing(self.connect(read_only=True)) as db:
                db.execute('BEGIN')
                self.check_binding(db)

    def load_prefill(self, path):
        packet, packet_hash = read_input(path)
        require(private_envelope(packet) and packet.get('reviewStatus') == 'completed'
                and packet.get('cohortSize') == len(self.candidates) and packet.get('publicAdmissions') == 0,
                'prefill-scope')
        rows = packet.get('decisions')
        require(isinstance(rows, list) and len(rows) == packet.get('sampleSize')
                and 0 < len(rows) <= len(self.candidates), 'prefill-rows')
        for row in rows:
            require(isinstance(row, dict) and isinstance(row.get('nativeId'), str), 'prefill-row')
            native_id = row['nativeId']
            candidate = self.candidates.get(native_id)
            require(candidate is not None and candidate['repository'] == row.get('repository')
                    and native_id not in self.prefill, 'prefill-identity')
            notes = row.get('evidence')
            require(isinstance(notes, list) and 0 < len(notes) <= 30, 'prefill-evidence')
            refs = []
            for note in notes:
                require(fields(note, ('locator', 'fact', 'observedDate', 'criteria')), 'prefill-evidence')
                locator = note['locator']
                external = https(locator)
                require(external or local_locator(locator), 'prefill-evidence-locator')
                refs.append(attach(candidate, evidence_row(native_id, locator if external else None,
                            note['fact'], note['observedDate'], note['criteria'],
                            local_ref=None if external else locator)))
            record = {'criteria': row.get('criteria'), 'reason': row.get('reason'), 'evidenceRefs': refs,
                      'decision': row.get('decision'), 'revision': 0}
            if 'preparedListing' in row:
                record['preparedListing'] = row['preparedListing']
            self.prefill[native_id] = self.validate_record(candidate, record)
        return packet_hash

    def load_evidence(self, path):
        packet, packet_hash = read_input(path)
        require(private_envelope(packet) and packet.get('schemaVersion') == 1
                and packet.get('queueSha256') == self.queue_hash, 'evidence-scope')
        rows = packet.get('candidates')
        require(isinstance(rows, list) and len(rows) <= len(self.candidates), 'evidence-rows')
        seen = set()
        for row in rows:
            require(fields(row, ('nativeId', 'originalUrl', 'evidence'))
                    and isinstance(row['nativeId'], str) and row['nativeId'] not in seen, 'evidence-row')
            native_id = row['nativeId']
            seen.add(native_id)
            candidate = self.candidates.get(native_id)
            require(candidate is not None and candidate['originalUrl'] == row['originalUrl'], 'evidence-identity')
            require(isinstance(row['evidence'], list) and len(row['evidence']) <= 20, 'evidence-notes')
            for note in row['evidence']:
                require(fields(note, ('locator', 'fact', 'observedDate', 'criteria')) and https(note['locator']),
                        'evidence-note')
                attach(candidate, evidence_row(native_id, note['locator'], note['fact'],
                                               note['observedDate'], note['criteria']))
        return packet_hash

    def connect(self, *, read_only=False):
        mode = 'ro' if read_only else 'rw'
        db = sqlite3.connect(self.ledger.as_uri() + '?mode=' + mode, uri=True, timeout=4)
        db.execute('PRAGMA trusted_schema = OFF')
        return db

    def initialize_ledger(self):
        if not self.ledger.exists():
            try:
                os.close(os.open(self.ledger, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600))
            except FileExistsError:
                private_path(self.ledger, ledger=True)
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('PRAGMA user_version').fetchone()[0] == 0:
                require(not db.execute("SELECT 1 FROM sqlite_master WHERE type='table'").fetchone(), 'ledger-schema')
                db.execute('CREATE TABLE context (roster_hash TEXT NOT NULL, context_hash TEXT NOT NULL)')
                db.execute('INSERT INTO context VALUES (?, ?)', (self.roster_hash, self.context_hash))
                db.execute('''CREATE TABLE decisions (
                    native_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision > 0),
                    data TEXT NOT NULL, PRIMARY KEY (native_id, revision))''')
                db.execute('PRAGMA user_version = 2')
            self.check_binding(db)

    def check_binding(self, db):
        require(db.execute('PRAGMA user_version').fetchone() == (2,), 'ledger-context-schema')
        require(db.execute('SELECT roster_hash FROM context').fetchall() == [(self.roster_hash,)],
                'ledger-roster-mismatch')
        require(db.execute('SELECT context_hash FROM context').fetchall() == [(self.context_hash,)],
                'ledger-context-mismatch')

    def validate_record(self, candidate, record):
        require(fields(record, ('criteria', 'reason', 'evidenceRefs', 'decision', 'revision'), ('preparedListing',))
                and nonempty(record['reason'], 1000) and type(record['revision']) is int and record['revision'] >= 0,
                'decision-fields')
        state = decide(record['criteria'])
        require(record['decision'] == state, 'decision-state')
        evidence = select_evidence(candidate, record['criteria'], record['evidenceRefs'])
        if state == 'eligible':
            make_listing(candidate, record.get('preparedListing'), evidence, prefilled=True)
        else:
            require('preparedListing' not in record, 'listing-requires-eligible-decision')
        return record

    def latest(self):
        records = dict(self.prefill)
        with closing(self.connect(read_only=True)) as db:
            db.execute('BEGIN')
            self.check_binding(db)
            rows = db.execute('''SELECT d.native_id, d.revision, d.data FROM decisions d JOIN
                (SELECT native_id, MAX(revision) revision FROM decisions GROUP BY native_id) head
                ON d.native_id = head.native_id AND d.revision = head.revision''')
            for native_id, revision, raw in rows:
                candidate = self.candidates.get(native_id)
                require(candidate is not None, 'ledger-native-id')
                record = self.validate_record(candidate, decode_json(raw))
                require(record['revision'] == revision, 'ledger-revision')
                records[native_id] = record
        return records

    def save(self, payload):
        require(fields(payload, ('nativeId', 'criteria', 'reason', 'evidenceRefs', 'expectedRevision'), ('preparedListing',))
                and isinstance(payload['nativeId'], str) and type(payload['expectedRevision']) is int
                and payload['expectedRevision'] >= 0, 'decision-fields')
        candidate = self.candidates.get(payload['nativeId'])
        require(candidate is not None, 'unknown-native-id')
        native_id = candidate['nativeId']
        state = decide(payload['criteria'])
        record = {name: payload[name] for name in ('criteria', 'reason', 'evidenceRefs')}
        record['revision'] = payload['expectedRevision'] + 1
        record['decision'] = state
        if record['evidenceRefs'] == [] and all(item == 'unknown' for item in record['criteria'].values()):
            record['evidenceRefs'] = [candidate['evidence'][0]['id']]
        if state == 'eligible':
            evidence = select_evidence(candidate, record['criteria'], record['evidenceRefs'])
            record['preparedListing'] = make_listing(candidate, payload.get('preparedListing'), evidence)
        else:
            require('preparedListing' not in payload, 'listing-requires-eligible-decision')
        self.validate_record(candidate, record)
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            self.check_binding(db)
            current, = db.execute('SELECT COALESCE(MAX(revision), 0) FROM decisions WHERE native_id = ?', (native_id,)).fetchone()
            require(current == payload['expectedRevision'], 'revision-conflict')
            db.execute('INSERT INTO decisions VALUES (?, ?, ?)', (native_id, record['revision'], json_bytes(record).decode()))
        return record

    def output(self, *, export=False):
        records = self.latest()
        header = {'schemaVersion': 1, 'visibility': 'private', 'publicationAuthorized': False,
                  'queueSha256': self.queue_hash, 'contextSha256': self.context_hash}
        if not export:
            return {**header, 'candidates': [{**candidate, 'decision': records.get(native_id)}
                                              for native_id, candidate in self.candidates.items()]}
        rows = []
        for native_id, candidate in self.candidates.items():
            if native_id not in records:
                continue
            record = records[native_id]
            evidence = select_evidence(candidate, record['criteria'], record['evidenceRefs'])
            rows.append({**{key: candidate[key] for key in ('nativeId', 'repository', 'originalUrl')},
                         **record, 'evidence': evidence})
        return {**header, 'decisions': rows}


class OperatorAccess:
    def __init__(self):
        self.bootstrap = token_urlsafe(32)
        self.session = None
        self.lock = Lock()

    def redeem(self, access):
        if not isinstance(access, str) or not ACCESS_TOKEN.fullmatch(access):
            return None
        with self.lock:
            if self.bootstrap is None or not compare_digest(self.bootstrap, access):
                return None
            self.session = token_urlsafe(32)
            self.bootstrap = None
            return self.session

    def permits(self, values):
        if values is None or len(values) != 1:
            return False
        scheme, _, token = values[0].partition(' ')
        if scheme != 'Bearer' or not ACCESS_TOKEN.fullmatch(token):
            return False
        with self.lock:
            return self.session is not None and compare_digest(self.session, token)


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        self.request.settimeout(5)
        super().setup()

    def log_message(self, *_args):
        pass

    def send_payload(self, status, payload, content_type='application/json; charset=utf-8'):
        body = payload if isinstance(payload, bytes) else json_bytes(payload)
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; "
                         "connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'")
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def authorized_origin(self, *, write=False):
        host = f'127.0.0.1:{self.server.server_port}'
        origin = f'http://{host}'
        request_origins = self.headers.get_all('Origin') or []
        return (self.headers.get_all('Host') == [host]
                and (request_origins == [origin] if write or request_origins else True)
                and self.headers.get('Sec-Fetch-Site') != 'cross-site')

    def do_GET(self):
        if not self.authorized_origin():
            return self.send_payload(403, {'error': 'disallowed-origin'})
        if self.path == '/api/review':
            if not self.server.access.permits(self.headers.get_all('Authorization')):
                return self.send_payload(401, {'error': 'operator-session-required'})
            try:
                payload = self.server.review.output()
            except (ValueError, sqlite3.Error):
                return self.send_payload(500, {'error': 'review-unavailable'})
            return self.send_payload(200, payload)
        if self.path in self.server.assets:
            body, content_type = self.server.assets[self.path]
            return self.send_payload(200, body, content_type)
        self.send_payload(404, {'error': 'not-found'})

    do_HEAD = do_GET

    def do_POST(self):
        if not self.authorized_origin(write=True):
            return self.send_payload(403, {'error': 'disallowed-origin'})
        if self.path not in ('/api/session', '/api/decisions'):
            return self.send_payload(404, {'error': 'not-found'})
        if self.path == '/api/decisions' and not self.server.access.permits(self.headers.get_all('Authorization')):
            return self.send_payload(401, {'error': 'operator-session-required'})
        lengths = self.headers.get_all('Content-Length') or []
        if self.headers.get_all('Transfer-Encoding') or len(lengths) != 1 or not re.fullmatch(r'[0-9]{1,8}', lengths[0]):
            return self.send_payload(400, {'error': 'invalid-body-length'})
        length = int(lengths[0])
        if not 0 < length <= MAX_DECISION_BYTES:
            return self.send_payload(413, {'error': 'decision-too-large'})
        if self.headers.get_content_type() != 'application/json':
            return self.send_payload(415, {'error': 'json-required'})
        try:
            body = self.rfile.read(length)
            require(len(body) == length, 'invalid-body-length')
            payload = decode_json(body)
            if self.path == '/api/session':
                token = self.server.access.redeem(payload['access']) if fields(payload, ('access',)) else None
                if token is None:
                    return self.send_payload(401, {'error': 'invalid-operator-access'})
                return self.send_payload(200, {'token': token})
            result = self.server.review.save(payload)
        except (json.JSONDecodeError, UnicodeError, RecursionError):
            return self.send_payload(400, {'error': 'invalid-json'})
        except TimeoutError:
            return self.send_payload(408, {'error': 'body-timeout'})
        except ValueError as error:
            return self.send_payload(409 if str(error) == 'revision-conflict' else 400, {'error': str(error)})
        except sqlite3.Error:
            return self.send_payload(500, {'error': 'review-unavailable'})
        self.send_payload(200, {'decision': result})


def local_server(review, port):
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler, bind_and_activate=False)
    try:
        server.assets = {route: ((ASSET_ROOT / name).read_bytes(), mime) for route, (name, mime) in ASSETS.items()}
        server.review = review
        server.access = OperatorAccess()
        server.server_bind()
        server.server_activate()
    except BaseException:
        server.server_close()
        raise
    return server


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('serve', 'export'))
    parser.add_argument('--queue', required=True)
    parser.add_argument('--ledger', required=True)
    parser.add_argument('--prefill')
    parser.add_argument('--evidence')
    parser.add_argument('--port', type=int, default=0)
    args = parser.parse_args()
    try:
        review = Review(args.queue, args.ledger, args.prefill, args.evidence, initialize=args.action == 'serve')
        if args.action == 'export':
            print(json_bytes(review.output(export=True)).decode())
        else:
            review.latest()
            with local_server(review, args.port) as server, NamedTemporaryFile(
                mode='w', encoding='utf-8', prefix='review-access-', suffix='.txt', dir=review.ledger.parent,
            ) as access_file:
                access_file.write(f'http://127.0.0.1:{server.server_port}/#access={server.access.bootstrap}\n')
                access_file.flush()
                print(f'Private review launch URL is in {access_file.name}', flush=True)
                server.serve_forever()
    except (ValueError, OSError, sqlite3.Error) as error:
        parser.exit(1, f'Review unavailable: {error}\n')
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
