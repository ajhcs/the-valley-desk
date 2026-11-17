"""Bounded anonymous public-metadata sender. Source bodies remain transient.

A pinned operator approval binds the finite roster, methods and exact limits.
SQLite charges attempts before sending; crashes never silently authorize retries.
"""
import argparse
import base64
import datetime
import hashlib
import http.client
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import signal
import socket
import sqlite3
import ssl
import subprocess
import time
from urllib.parse import urlencode


ROOT = Path(__file__).resolve().parents[1]
BUILD_ROOT = Path('/workspace/build/builderbob')
METHODS = {'scripts/capture-github-enrichment.py', 'scripts/discovery-github-enrichment.mjs',
           'src/ingest/discovery/github-enrichment.ts', 'src/ingest/discovery/metadata-preflight.ts',
           'src/ingest/regional-privacy.ts'}


def sha(value):
    return hashlib.sha256(value).hexdigest()


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def private_directory(path):
    path = Path(path)
    if not path.is_absolute() or path.resolve() != path or not path.is_relative_to(BUILD_ROOT):
        raise ValueError('private-directory')
    stat = path.stat()
    if not path.is_dir() or stat.st_uid != os.getuid() or stat.st_mode & 0o077:
        raise ValueError('private-directory')
    return path


class PinnedConnection(http.client.HTTPSConnection):
    def __init__(self, address, timeout):
        super().__init__('api.github.com', timeout=timeout, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        sock = socket.create_connection((self.address, 443), timeout=self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def atomic_json(path, value):
    # Exclusive immutable receipt; a rerun cannot overwrite evidence.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, ensure_ascii=False, separators=(',', ':'))
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())


def validate_batch(directory):
    directory = private_directory(directory)
    scope_bytes = (directory / 'scope.json').read_bytes()
    scope = json.loads(scope_bytes)
    approval = json.loads((directory / 'approval.json').read_bytes())
    if approval.get('scopeSha256') != sha(scope_bytes) or approval.get('approvedBy') != 'builderbob':
        raise ValueError('scope-approval-binding')
    if set(approval.get('methods', {})) != METHODS:
        raise ValueError('incomplete-method-pins')
    for name, digest in approval['methods'].items():
        if sha((ROOT / name).read_bytes()) != digest:
            raise ValueError('method-drift')
    for source in scope['inputs']:
        if sha((ROOT / source['path']).read_bytes()) != source['sha256']:
            raise ValueError('source-drift')
    for account in scope['roster']:
        if not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?', account['login']):
            raise ValueError('login')
        if not account['sourceObservationIds'] or any(value.split(':')[0] in scope['excludedCollections'] for value in account['sourceObservationIds']):
            raise ValueError('primary-scope')
        for source in account['evidence']:
            if sha((ROOT / source['path']).read_bytes()) != source['sha256']:
                raise ValueError('source-drift')
    if scope['route']['authentication'] != 'anonymous' or scope['route']['origin'] != 'https://api.github.com':
        raise ValueError('unsupported-route')
    if not 1 <= scope['limits']['maxRequests'] <= 55 or {**scope['limits'], 'maxRequests': 55} != {'perPage': 20, 'maxPagesPerAccount': 20, 'maxRequests': 55,
                           'maxBytesPerResponse': 256000, 'timeoutMs': 25000, 'maxElapsedMs': 1800000,
                           'minimumDelayMs': 1000, 'maxSpendUsd': 0}:
        raise ValueError('unqualified-budget')
    if scope['route']['query'] != {'type': 'owner', 'sort': 'full_name', 'direction': 'asc', 'per_page': 20}:
        raise ValueError('unqualified-query')
    node = Path(approval['nodeBinary'])
    if not node.resolve().is_relative_to('/workspace/') or sha(node.read_bytes()) != approval['nodeSha256']:
        raise ValueError('runtime-drift')
    return directory, scope, approval


def acquire_page(directory, scope, approval, db, account, page, previous_owner, batch_deadline=None):
    started = time.monotonic()
    attempt_deadline = min(started + scope['limits']['timeoutMs'] / 1000,
                           batch_deadline if batch_deadline is not None else float('inf'))
    if attempt_deadline <= started:
        return None
    login = account['login']
    # Reconstruct from the frozen route; never request a supplied continuation URL.
    route = f'/users/{login}/repos?' + urlencode({**scope['route']['query'], 'page': page})
    request_url = 'https://api.github.com' + route
    receipt_id = sha((sha((directory / 'scope.json').read_bytes()) + '\n' + login + '\n' + str(page)).encode())
    with db:
        if db.execute('SELECT count(*) FROM attempts').fetchone()[0] >= scope['limits']['maxRequests']:
            return None
        # A durable issued record exists before DNS/TLS/HTTP; uncertain attempts are not resent.
        db.execute('INSERT INTO attempts(login,page,status,receipt) VALUES(?,?,?,NULL)', (login, page, 'issued'))
    issued_at = utc()
    receipt = {'receiptId': receipt_id, 'scopeSha256': sha((directory / 'scope.json').read_bytes()),
               'login': login, 'page': page, 'requestUrl': request_url, 'issuedAt': issued_at,
               'observedAt': issued_at, 'status': 'unknown', 'httpStatus': None,
               'rawBodyRetained': False, 'sourceObservationIds': account['sourceObservationIds'],
               'projection': None, 'responseBytes': 0}
    connection = None

    def deadline(_signum, _frame):
        raise TimeoutError('deadline')

    signal.signal(signal.SIGALRM, deadline)
    try:
        if time.monotonic() >= attempt_deadline:
            raise TimeoutError('deadline')
        signal.setitimer(signal.ITIMER_REAL, attempt_deadline - time.monotonic())
        addresses = sorted({entry[4][0] for entry in socket.getaddrinfo('api.github.com', 443, type=socket.SOCK_STREAM)})
        if not addresses or not all(ipaddress.ip_address(address).is_global for address in addresses):
            raise ValueError('nonpublic-dns')
        address = next((value for value in addresses if ipaddress.ip_address(value).version == 4), addresses[0])
        connection = PinnedConnection(address, max(0.001, attempt_deadline - time.monotonic()))
        connection.request('GET', route, headers={'Accept': scope['route']['accept'], 'Accept-Encoding': 'identity',
                           'User-Agent': 'TheValleyDesk/GL08-metadata (+https://thevalleydesk.org)',
                           'X-GitHub-Api-Version': scope['route']['apiVersion'], 'Connection': 'close'})
        response = connection.getresponse()
        receipt['httpStatus'] = response.status
        for name in ('X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'):
            value = response.getheader(name)
            if value is not None and value.isdecimal() and len(value) < 16:
                receipt.setdefault('rateLimit', {})[name.lower()] = int(value)
        if response.status != 200:
            receipt['status'] = 'rate-limited' if response.status == 429 else 'refused' if response.status in (401, 403) else 'redirect' if 300 <= response.status < 400 else 'unavailable'
            return receipt
        for name in ('content-type', 'content-encoding', 'content-length', 'link'):
            if sum(key.lower() == name for key, _ in response.getheaders()) > 1:
                raise ValueError('duplicate-header')
        if response.getheader('Content-Encoding', 'identity').strip().lower() != 'identity':
            raise ValueError('encoding')
        mime = [part.strip().lower() for part in response.getheader('Content-Type', '').split(';')]
        if mime[0] != 'application/json' or len(mime) > 2 or len(mime) == 2 and mime[1] not in ('charset=utf-8', 'charset="utf-8"'):
            raise ValueError('mime')
        length = response.getheader('Content-Length')
        maximum = scope['limits']['maxBytesPerResponse']
        if length is not None and (not length.isdecimal() or int(length) > maximum):
            raise ValueError('byte-cap')
        body = response.read(maximum + 1)
        receipt['responseBytes'] = len(body)
        if len(body) > maximum or length is not None and int(length) != len(body):
            raise ValueError('body-bound')
        envelope = {'login': login, 'page': page, 'previousOwner': previous_owner,
                    'link': response.getheader('Link'), 'bodyBase64': base64.b64encode(body).decode()}
        remaining = attempt_deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('deadline')
        process = subprocess.run([approval['nodeBinary'], '--import', 'tsx/esm', 'scripts/discovery-github-enrichment.mjs', 'inspect'],
                                 cwd=ROOT, input=json.dumps(envelope).encode(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                 timeout=remaining, check=False)
        if len(process.stdout) > 200000:
            raise ValueError('inspector-output-bound')
        decoded = json.loads(process.stdout)
        if process.returncode or decoded.get('ok') is not True:
            # Only fixed inspector codes may leave the transient payload boundary.
            code = decoded.get('code', '')
            if isinstance(code, str) and code.startswith('github-enrichment:') and len(code) < 100:
                receipt['failureCode'] = code
            raise ValueError('inspection-failed')
        receipt['projection'] = decoded['result']
        receipt['projectionSha256'] = sha(json.dumps(decoded['result'], sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode())
        receipt['status'] = 'received'
        return receipt
    except Exception as error:
        receipt['status'] = 'malformed' if receipt['httpStatus'] == 200 else 'unknown'
        receipt.setdefault('failureCode', str(error) if isinstance(error, ValueError) and str(error) in
                           ('nonpublic-dns', 'duplicate-header', 'encoding', 'mime', 'byte-cap', 'body-bound', 'inspector-output-bound', 'inspection-failed')
                           else 'transport-or-deadline')
        return receipt
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        if connection:
            connection.close()
        receipt['observedAt'] = utc()
        if time.monotonic() > attempt_deadline:
            receipt.update(status='unknown', projection=None, failureCode='deadline')
            receipt.pop('projectionSha256', None)
        atomic_json(directory / 'pages' / f'page-{receipt_id}.json', receipt)
        with db:
            db.execute('UPDATE attempts SET status=?,receipt=? WHERE login=? AND page=?',
                       (receipt['status'], json.dumps(receipt), login, page))


def reconcile_journal(directory, scope, db):
    files = {p.name for p in (directory / 'pages').iterdir()}
    expected = set()
    rows = db.execute('SELECT login,page,status,receipt FROM attempts').fetchall()
    if len(rows) > scope['limits']['maxRequests']:
        raise ValueError('journal-receipt-mismatch')
    scope_sha = sha((directory / 'scope.json').read_bytes())
    for login, page, status, receipt in rows:
        if login not in {account['login'] for account in scope['roster']} or not isinstance(page, int) or not 1 <= page <= scope['limits']['maxPagesPerAccount']:
            raise ValueError('journal-receipt-mismatch')
        if status not in ('issued', 'received', 'malformed', 'unavailable', 'unknown', 'refused', 'rate-limited', 'redirect'):
            raise ValueError('journal-status')
        if status == 'issued' and receipt is None:
            continue  # The durable issued charge holds the batch; it is never resent.
        if not receipt:
            raise ValueError('journal-receipt-mismatch')
        value = json.loads(receipt)
        receipt_id = sha((scope_sha + '\n' + login + '\n' + str(page)).encode())
        name = f'page-{receipt_id}.json'
        path = directory / 'pages' / name
        if (value.get('scopeSha256') != scope_sha or value.get('login') != login or value.get('page') != page or
                value.get('status') != status or value.get('receiptId') != receipt_id or not path.is_file() or path.is_symlink() or
                json.loads(path.read_bytes()) != value):
            raise ValueError('journal-receipt-mismatch')
        expected.add(name)
    if files != expected:
        raise ValueError('journal-receipt-mismatch')


def run(directory):
    directory, scope, approval = validate_batch(directory)
    pages = directory / 'pages'
    pages.mkdir(mode=0o700, exist_ok=True)
    private_directory(pages)
    db_path = directory / 'journal.sqlite'
    if not db_path.exists():
        if any(pages.iterdir()):
            raise ValueError('missing-journal-with-receipts')
        os.close(os.open(db_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600))
    stat = db_path.lstat()
    if db_path.is_symlink() or not db_path.is_file() or stat.st_nlink != 1 or stat.st_uid != os.getuid() or stat.st_mode & 0o077:
        raise ValueError('private-journal')
    db = sqlite3.connect(db_path)
    db.execute('PRAGMA synchronous=FULL')
    db.execute('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS attempts (login TEXT, page INTEGER, status TEXT, receipt TEXT, PRIMARY KEY(login,page))')
    scope_sha = sha((directory / 'scope.json').read_bytes())
    existing = db.execute("SELECT value FROM meta WHERE key='scope'").fetchone()
    if existing and existing[0] != scope_sha:
        raise ValueError('journal-scope-drift')
    if existing is None and (any(pages.iterdir()) or db.execute('SELECT count(*) FROM attempts').fetchone()[0]):
        db.close()
        raise ValueError('journal-scope-missing')
    reconcile_journal(directory, scope, db)
    now = time.time()
    start_row = db.execute("SELECT value FROM meta WHERE key='started'").fetchone()
    if start_row is None and db.execute('SELECT count(*) FROM attempts').fetchone()[0]:
        db.close()
        raise ValueError('journal-start-missing')
    started = float(start_row[0]) if start_row else now
    if not math.isfinite(now) or not math.isfinite(started) or started < 0 or started > now:
        db.close()
        raise ValueError('journal-clock-invalid')
    with db:
        db.execute("INSERT OR IGNORE INTO meta VALUES('scope',?)", (scope_sha,))
        db.execute("INSERT OR IGNORE INTO meta VALUES('started',?)", (str(now),))
    maximum = scope['limits']['maxElapsedMs'] / 1000
    batch_deadline = time.monotonic() + min(maximum, max(0, maximum - (now - started)))
    # Round robin puts one page from each account ahead of a large account's later pages.
    try:
        for page in range(1, scope['limits']['maxPagesPerAccount'] + 1):
            for account in scope['roster']:
                attempts = db.execute('SELECT login,page,status,receipt FROM attempts').fetchall()
                if any(status in ('refused', 'rate-limited', 'redirect', 'issued') for _, _, status, _ in attempts):
                    return {'state': 'held', 'requests': len(attempts)}
                if any(receipt and json.loads(receipt).get('rateLimit', {}).get('x-ratelimit-remaining') == 0 for _, _, _, receipt in attempts):
                    return {'state': 'rate-limit-exhausted', 'requests': len(attempts)}
                if len(attempts) >= scope['limits']['maxRequests'] or time.monotonic() >= batch_deadline:
                    return {'state': 'budget-exhausted', 'requests': len(attempts)}
                if any(login == account['login'] and p == page for login, p, _, _ in attempts):
                    continue
                prior = [json.loads(receipt) for login, p, status, receipt in attempts if login == account['login'] and p == page - 1 and status == 'received']
                if page > 1 and (not prior or prior[0]['projection']['continuation']['state'] != 'more'):
                    continue
                previous_owner = prior[0]['projection']['owner'] if prior else None
                result = acquire_page(directory, scope, approval, db, account, page, previous_owner, batch_deadline)
                if result is None:
                    return {'state': 'budget-exhausted', 'requests': len(attempts)}
                print(json.dumps({'login': account['login'], 'page': page, 'status': result['status'],
                                  'repositories': len(result['projection']['repositories']) if result['projection'] else 0}), flush=True)
                time.sleep(min(scope['limits']['minimumDelayMs'] / 1000, max(0, batch_deadline - time.monotonic())))
        return {'state': 'finished', 'requests': db.execute('SELECT count(*) FROM attempts').fetchone()[0]}
    finally:
        db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory')
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.directory)))
    except Exception:
        print(json.dumps({'state': 'rejected'}))
        raise SystemExit(1)
