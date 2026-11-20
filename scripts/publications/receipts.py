"""Retain successful and failed metadata responses in a private run directory."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

SERVICES = {
    'crossref': 'https://api.crossref.org',
    'openalex': 'https://api.openalex.org',
    'europepmc': 'https://www.ebi.ac.uk/europepmc/webservices/rest',
}
MAX_RESPONSE_BYTES = 32 * 1024 * 1024
USER_AGENT = 'Regional-Scholarly-Metadata/1.0'


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class MetadataError(RuntimeError):
    def __init__(self, service, receipt, status, retry_after=None):
        super().__init__(f'{service}: HTTP {status}, receipt {receipt}')
        self.status = status
        self.retry_after = retry_after


class Receipts:
    def __init__(self, directory):
        root = Path(directory).resolve(strict=True)
        if not root.is_dir() or root.stat().st_mode & 0o077:
            raise ValueError('run directory must be private (mode 0700)')
        self.root = root
        self.opener = build_opener(NoRedirect())

    def request_target(self, service, endpoint, params):
        if not endpoint.startswith('/') or endpoint.startswith('//') or '?' in endpoint:
            raise ValueError('expected a service-relative endpoint')
        url = SERVICES[service] + endpoint
        if params:
            url += '?' + urlencode(sorted(params.items()))
        directory = self.root / service / hashlib.sha256(url.encode()).hexdigest()
        return url, directory

    def replay(self, service, endpoint, params):
        _, directory = self.request_target(service, endpoint, params)
        current = directory / 'current.json'
        if current.exists():
            receipt = json.loads(current.read_bytes())
            if receipt['status'] == 200 and not receipt['error']:
                data = (directory / receipt['body']).read_bytes()
                if hashlib.sha256(data).hexdigest() != receipt['sha256']:
                    raise ValueError(f'body digest differs from receipt in {directory.name}')
                return json.loads(data)
        return None

    def get(self, service, endpoint, params, *, replay=False):
        if replay and (cached := self.replay(service, endpoint, params)) is not None:
            return cached
        url, directory = self.request_target(service, endpoint, params)
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        for attempt in range(3):
            result, receipt = self._request(directory, url)
            if receipt['status'] == 200 and not receipt['error']:
                return json.loads(result)
            status = receipt['status']
            if status in (401, 403, 429) or (status is not None and status < 500) or attempt == 2:
                raise MetadataError(service, directory.name, status, receipt['retry_after'])
            time.sleep(2 ** attempt)

    def _request(self, directory, url):
        requested = datetime.now(timezone.utc)
        stamp = requested.strftime('%Y%m%dT%H%M%S%f')
        request = Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'})
        status = None
        headers = {}
        data = b''
        error = None
        try:
            try:
                response = self.opener.open(request, timeout=45)
            except HTTPError as exc:
                response = exc
            with response:
                status = response.code
                headers = dict(response.headers.items())
                data = response.read(MAX_RESPONSE_BYTES + 1)
                if len(data) > MAX_RESPONSE_BYTES:
                    error = 'response exceeded byte limit'
        except (URLError, TimeoutError, OSError) as exc:
            error = str(exc)
        body_name = stamp + '.body'
        (directory / body_name).write_bytes(data)
        receipt = {
            'url': url, 'fetched': requested.isoformat(), 'status': status, 'error': error,
            'body': body_name, 'sha256': hashlib.sha256(data).hexdigest(),
            'retry_after': next((v for k, v in headers.items() if k.lower() == 'retry-after'), None),
            'headers': headers,
        }
        record = json.dumps(receipt, sort_keys=True) + '\n'
        (directory / (stamp + '.json')).write_text(record)
        temporary = directory / (stamp + '.current')
        temporary.write_text(record)
        os.replace(temporary, directory / 'current.json')
        return data, receipt
