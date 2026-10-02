"""Source-specific pure state machine. No sockets, browsers, timers or credentials."""
import datetime
import hashlib
import json
import re
import math

PAGE = 'https://www.palegis.us/data'
HREF = '/data/file?documentType=BillHistoryData&session=2025_0'
URL = 'https://www.palegis.us' + HREF
LABEL = '2025-2026 Regular Session'
MAX_BYTES = 2_000_000


class BrowserFailure(ValueError):
    """Fixed diagnostic codes only; page/exception text is never the message."""
    def __init__(self, reason, category, exception_type=None, exception_detail=None, protocol_code=None):
        super().__init__(reason)
        self.category = category
        self.exception_type = exception_type
        self.exception_detail = exception_detail
        self.protocol_code = protocol_code


def url_classification(url):
    if url == PAGE:
        return 'expected-page'
    if url == 'about:blank':
        return 'initial-blank'
    if url == URL:
        return 'offered-download'
    if isinstance(url, str) and url.startswith('chrome-error:'):
        return 'browser-interstitial'
    return 'unexpected'


def page_state(snapshot):
    """Bounded allowlisted observations; never persist URLs or DOM/link text."""
    links = snapshot.get('links', [])
    count = sum(isinstance(a, dict) and (a.get('label') == LABEL or a.get('href') == HREF or a.get('resolved') == URL) for a in links) if isinstance(links, list) else None
    return {'readyState': snapshot.get('ready') if snapshot.get('ready') in ('loading', 'interactive', 'complete') else 'unknown',
            'bodyPresent': snapshot.get('bodyPresent') if type(snapshot.get('bodyPresent')) is bool else None,
            'urlClassification': url_classification(snapshot.get('url')),
            'denialIndicator': snapshot.get('denied') if type(snapshot.get('denied')) is bool else None,
            'interstitialIndicator': snapshot.get('interstitial') if type(snapshot.get('interstitial')) is bool else None,
            'expectedLinkCount': min(count, 1000) if count is not None else None}


def instant():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')


def select_link(snapshot):
    if snapshot.get('url') != PAGE:
        raise ValueError('page-url-or-redirect-refused')
    if snapshot.get('denied'):
        raise ValueError('page-denial-or-challenge')
    if snapshot.get('interstitial'):
        raise ValueError('page-interstitial-refused')
    candidates = [a for a in snapshot['links'] if a.get('label') == LABEL or a.get('href') == HREF or a.get('resolved') == URL]
    if len(candidates) != 1:
        raise ValueError('session-link-missing-or-ambiguous')
    selected = candidates[0]
    if (selected.get('label'), selected.get('href'), selected.get('resolved')) != (LABEL, HREF, URL):
        raise ValueError('session-link-label-href-host-refused')
    return selected


class Controller:
    def __init__(self, target, session, frame, browser):
        self.target, self.session, self.frame, self.browser = target, session, frame, browser
        self.selected = None
        self.started = None
        self.completed = None
        self.guid = None
        self.owned_guids = set()
        self.bytes = None
        self.finished = False
        self.failed = None
        self.literal_labels = []
        self.last_page_state = None
        self.document_observation = None
        self.page_committed = False

    def refuse(self, reason):
        self.failed = reason
        raise ValueError(reason)

    def observe_page(self, snapshot):
        self.last_page_state = page_state(snapshot)
        if snapshot.get('url') == PAGE:
            self.page_committed = True
        if self.failed:
            self.refuse(self.failed)
        if snapshot.get('denied'):
            self.refuse('page-denial-or-challenge')
        if snapshot.get('interstitial'):
            self.refuse('page-interstitial-refused')
        if snapshot.get('url') != PAGE:
            self.refuse('page-url-or-redirect-refused')
        if snapshot.get('bodyPresent') is not True or snapshot.get('ready') != 'complete':
            self.refuse('page-state-refused')
        try:
            selected = select_link(snapshot)
        except ValueError as error:
            self.refuse(str(error))
        if self.selected is not None and selected != self.selected:
            self.refuse('session-link-changed')
        self.selected = selected
        self.literal_labels = snapshot.get('literalLabels', [])
        return selected

    def click(self, at):
        if self.started or not self.selected or self.failed:
            self.refuse('one-acquisition-only')
        self.started = at

    def event(self, row, at):
        method, p = row.get('method'), row.get('params', {})
        if row.get('sessionId') == self.session:
            if method == 'Page.frameNavigated' and p['frame'].get('id') == self.frame:
                if p['frame']['url'] == PAGE:
                    self.page_committed = True
                elif p['frame']['url'] == 'about:blank' and not self.page_committed and not self.started:
                    return
                if p['frame']['url'] != PAGE:
                    self.refuse('owned-frame-redirect-refused')
            if method == 'Network.requestWillBeSent' and p.get('frameId') == self.frame and p.get('type') == 'Document':
                if p.get('redirectResponse') or p['request']['url'] not in (PAGE, URL):
                    self.refuse('owned-document-redirect-refused')
            if method == 'Network.responseReceived' and p.get('frameId') == self.frame and p.get('type') == 'Document':
                response = p['response']
                status = response.get('status')
                self.document_observation = {'urlClassification': url_classification(response.get('url')),
                                             'httpStatus': int(status) if type(status) in (int, float) and math.isfinite(status) and status == int(status) and 100 <= status <= 599 else None}
                if response['url'] not in (PAGE, URL) or response['status'] != 200:
                    self.refuse('owned-document-status-or-url-refused')
        if method == 'Browser.downloadWillBegin' and p.get('frameId') == self.frame:
            guid = p.get('guid', '')
            if not re.fullmatch(r'[A-Za-z0-9-]{1,100}', guid):
                self.refuse('download-guid-refused')
            self.owned_guids.add(guid)
            if not self.started or self.guid:
                self.refuse('unexpected-or-second-owned-download')
            if p.get('url') != URL:
                self.refuse('download-url-refused')
            # Publisher filename is metadata only. allowAndName uses the owned GUID.
            filename = p.get('suggestedFilename', '')
            if not isinstance(filename, str) or len(filename) > 200 or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._ -]*', filename) or filename.lower().endswith('.crdownload') or '..' in filename:
                self.refuse('download-filename-refused')
            self.guid = guid
        if method == 'Browser.downloadProgress' and p.get('guid') == self.guid and self.guid:
            received, total = p.get('receivedBytes', 0), p.get('totalBytes', 0)
            if not isinstance(received, (int, float)) or not isinstance(total, (int, float)) or not math.isfinite(received) or not math.isfinite(total) or min(received, total) < 0 or max(received, total) > MAX_BYTES:
                self.refuse('download-byte-limit')
            if p['state'] == 'canceled':
                self.refuse('owned-download-canceled')
            if p['state'] == 'completed':
                if self.finished or received <= 0 or received != total or int(received) != received:
                    self.refuse('download-completion-refused')
                self.finished, self.completed, self.bytes = True, at, int(received)

    def packet(self, raw):
        if self.failed or not self.finished or len(raw) != self.bytes or not 0 < len(raw) <= MAX_BYTES:
            self.refuse('download-not-complete-or-bounded')
        digest = hashlib.sha256(raw).hexdigest()
        receipt = encoded({
            'schema_version': 1, 'result': 'success',
            'source': {'page_url': PAGE, 'offered_href': HREF, 'offered_resolved_url': URL,
                       'observed_session_label': LABEL, 'literal_unzoned_update_labels': self.literal_labels},
            'acquisition': {'click_started_observed_utc': self.started, 'download_completed_observed_utc': self.completed,
                            'attempts': 1, 'denial_or_captcha_observed': False, 'owned_target': self.target, 'owned_frame': self.frame, 'owned_download_guid': self.guid},
            'transport': {'http_status': None, 'response_headers': None, 'response_final_url': None, 'redirect_chain': None,
                          'reason_null': 'Download event URL identifies the offer; no associated HTTP response/redirect observation is asserted.'},
            'original_archive': {'byte_count': len(raw), 'sha256': digest},
            'environment': {'browser': self.browser, 'method': 'Observed ordinary PA data-page DOM anchor click with userGesture; existing loopback CDP, isolated owned context'},
        })
        acquisition = encoded({
            'schemaVersion': 'pa-browser-original-1', 'origin': 'browser-original', 'publisher': 'Pennsylvania General Assembly', 'session': '2025_0',
            'requestedUrl': URL, 'finalResponseUrl': None, 'startedAt': self.started, 'completedAt': self.completed, 'downloadSucceeded': True,
            'tool': 'PA ordinary-page CDP controller', 'toolSession': self.session, 'downloadObservation': self.guid,
            'representationSha256': digest, 'representationBytes': len(raw), 'downloadReceiptSha256': hashlib.sha256(receipt).hexdigest(),
            'downloadReceiptBytes': len(receipt), 'httpStatus': None, 'responseHeaders': None, 'redirectChain': None,
        })
        if max(len(receipt), len(acquisition)) > 64_000:
            self.refuse('receipt-byte-limit')
        return {'original.zip': raw, 'original-receipt.json': receipt, 'acquisition.json': acquisition}
