"""Lazy opt-in adapter for the existing Chrome loopback CDP; never launches Chrome."""
import argparse
import asyncio
import fcntl
import importlib.metadata
import json
import os
import pathlib
import platform
import re
import tempfile
import time
from .controller import Controller, PAGE, HREF, URL, LABEL, MAX_BYTES, instant
from .storage import private_directory, bounded_file, completed_file, publish, retain_capture, sync_directory

ROOT = pathlib.Path('/mnt/d/tmp/plumbob')
# Observe the actual DOM, including wrong/ambiguous candidates; never create a link.
DOM = r"""const denied = () => /captcha|access denied|request blocked|verify (?:that )?you are human|checking your browser|just a moment|forbidden|unusual traffic/i.test(document.title+'\n'+document.body.innerText) || !!document.querySelector('iframe[src*="captcha"],iframe[src*="challenge"],.g-recaptcha,[data-sitekey]');
const snapshot = () => ({url:location.href,denied:denied(),ready:document.readyState,links:Array.from(document.querySelectorAll('a[href]')).map((a,index)=>({index,label:a.innerText.trim().replace(/\s+/g,' '),href:a.getAttribute('href'),resolved:a.href})),literalLabels:document.body.innerText.split('\n').map(s=>s.trim()).filter(s=>/updated|exported|last update/i.test(s)).slice(0,10).map(s=>s.slice(0,500))});"""
SNAPSHOT = '(()=>{' + DOM + 'return snapshot();})()'
CLICK = '(()=>{' + DOM + 'const s=snapshot();if(s.url!==' + json.dumps(PAGE) + '||s.denied)throw Error("page-refused");const matches=s.links.filter(a=>a.label===' + json.dumps(LABEL) + '||a.href===' + json.dumps(HREF) + '||a.resolved===' + json.dumps(URL) + ');if(matches.length!==1)throw Error("link-count-refused");const a=matches[0];if(a.label!==' + json.dumps(LABEL) + '||a.href!==' + json.dumps(HREF) + '||a.resolved!==' + json.dumps(URL) + ')throw Error("link-binding-refused");document.querySelectorAll("a[href]")[a.index].click();return {clicked:true};})()'


def preflight(path):
    raw = bounded_file(path, 16_000)
    if os.stat(path, follow_symlinks=False).st_mode & 0o777 != 0o600:
        raise ValueError('preflight-not-private')
    p = json.loads(raw)
    required = {'schemaVersion': 'pa-browser-client-preflight-1', 'sshAlias': 'plumbob', 'clientHost': 'plumbobos',
                'storageRoot': str(ROOT), 'cdpVersionUrl': 'http://127.0.0.1:9222/json/version', 'chromeMajor': 154,
                'websocketsVersion': '16.0', 'oneShotApproved': True, 'sourceUrl': PAGE,
                'hardTransferByteCeilingRequired': False, 'schedulingEnabled': False}
    if any(p.get(k) != v for k, v in required.items()) or set(p) != set(required) | {'expiresAt', 'reviewReceipt'}:
        raise ValueError('client-preflight-binding-refused')
    if not isinstance(p['reviewReceipt'], str) or not 1 <= len(p['reviewReceipt']) <= 200:
        raise ValueError('named-preflight-review-required')
    # Exact canonical millisecond UTC instants, limited one-shot validity.
    from datetime import datetime, timezone
    expires = datetime.strptime(p['expiresAt'], '%Y-%m-%dT%H:%M:%S.%fZ')
    if expires.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z' != p['expiresAt']:
        raise ValueError('canonical-preflight-expiry-required')
    if not 0 < (expires.replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)).total_seconds() <= 86400:
        raise ValueError('preflight-expired-or-too-long')
    if platform.node().lower().split('.')[0] != 'plumbobos' or not os.path.ismount('/mnt/d'):
        raise ValueError('existing-plumbob-client-mounted-root-required')
    private_directory(ROOT)
    if importlib.metadata.version('websockets') != '16.0':
        raise ValueError('existing-websockets-version-required')
    return p


class CDP:
    def __init__(self, ws):
        self.ws, self.sequence, self.pending = ws, 0, {}
        self.controller, self.failure = None, None
        self.reader = asyncio.create_task(self.read())

    async def read(self):
        try:
            async for message in self.ws:
                row = json.loads(message)
                if 'id' in row:
                    waiter = self.pending.get(row['id'])
                    if waiter and not waiter.done():
                        waiter.set_result(row)
                elif self.controller:
                    try:
                        self.controller.event(row, instant())
                    except Exception as error:
                        self.failure = error
        except Exception as error:
            self.failure = error
        finally:
            for waiter in self.pending.values():
                if not waiter.done():
                    waiter.set_exception(RuntimeError('CDP-disconnected'))

    def check(self):
        if self.failure:
            raise self.failure

    async def call(self, method, params=None, session=None, cleanup=False):
        if not cleanup:
            self.check()
        self.sequence += 1
        own = self.sequence
        row = {'id': own, 'method': method, 'params': params or {}}
        if session:
            row['sessionId'] = session
        future = asyncio.get_running_loop().create_future()
        self.pending[own] = future
        try:
            await self.ws.send(json.dumps(row))
            result = await asyncio.wait_for(future, 5)
            if 'error' in result:
                raise RuntimeError('CDP-command-refused:' + method)
            if not cleanup:
                self.check()
            return result.get('result', {})
        finally:
            self.pending.pop(own, None)

    async def evaluate(self, expression, session, gesture=False):
        result = await self.call('Runtime.evaluate', {'expression': expression, 'returnByValue': True, 'userGesture': gesture, 'timeout': 4000}, session)
        if result.get('exceptionDetails') or 'value' not in result.get('result', {}):
            raise ValueError('ordinary-page-evaluation-refused')
        return result['result']['value']

    async def stop(self):
        self.reader.cancel()
        await asyncio.gather(self.reader, return_exceptions=True)


async def attempt(cdp, task, browser):
    """All settings and commands target owned resources. Retain before disposal."""
    context = None
    controller = None
    disposed = False
    try:
        context = (await cdp.call('Target.createBrowserContext', {'disposeOnDetach': True}))['browserContextId']
        downloads = task / 'downloads'
        downloads.mkdir(mode=0o700)
        sync_directory(task)
        await cdp.call('Browser.setDownloadBehavior', {'behavior': 'allowAndName', 'browserContextId': context, 'downloadPath': str(downloads), 'eventsEnabled': True})
        target = (await cdp.call('Target.createTarget', {'url': 'about:blank', 'browserContextId': context, 'hidden': True, 'background': True, 'focus': False}))['targetId']
        session = (await cdp.call('Target.attachToTarget', {'targetId': target, 'flatten': True}))['sessionId']
        await cdp.call('Page.enable', {}, session)
        await cdp.call('Network.enable', {}, session)
        frame = (await cdp.call('Page.getFrameTree', {}, session))['frameTree']['frame']['id']
        controller = Controller(target, session, frame, browser)
        cdp.controller = controller
        navigation = await cdp.call('Page.navigate', {'url': PAGE}, session)
        if navigation.get('errorText') or navigation.get('frameId') != frame:
            raise ValueError('page-navigation-refused')
        while True:
            cdp.check()
            snapshot = await cdp.evaluate(SNAPSHOT, session)
            if snapshot['url'] != PAGE or snapshot['denied']:
                raise ValueError('page-redirect-denial-or-challenge')
            if snapshot['ready'] == 'complete':
                controller.observe_page(snapshot)
                break
            await asyncio.sleep(.1)
        controller.click(instant())
        if await cdp.evaluate(CLICK, session, True) != {'clicked': True}:
            raise ValueError('ordinary-click-not-observed')
        while not controller.finished:
            cdp.check()
            controller.observe_page(await cdp.evaluate(SNAPSHOT, session))
            if controller.guid:
                # Progress cannot guarantee an instantaneous wire/storage cap.
                for name in [controller.guid, controller.guid + '.crdownload']:
                    path = downloads / name
                    if path.is_symlink() or (path.exists() and path.lstat().st_size > MAX_BYTES):
                        raise ValueError('download-file-limit-or-symlink')
            await asyncio.sleep(.1)
        cdp.check()
        controller.observe_page(await cdp.evaluate(SNAPSHOT, session))
        raw = completed_file(downloads, controller.guid, controller.bytes)
        parts = controller.packet(raw)
        retain_capture(task, parts)
        return {'outcome': 'retained', 'archiveBytes': len(raw), 'fetchingEnabled': True, 'schedulingEnabled': False}
    finally:
        async def cleanup():
            # Global cancellation is forbidden; these GUIDs came from our root frame.
            if controller and not controller.finished:
                for guid in controller.owned_guids:
                    try:
                        await cdp.call('Browser.cancelDownload', {'guid': guid, 'browserContextId': context}, cleanup=True)
                    except Exception:
                        pass
            if context:
                await cdp.call('Target.disposeBrowserContext', {'browserContextId': context}, cleanup=True)
        try:
            await asyncio.wait_for(cleanup(), 8)
            disposed = True
        finally:
            publish(task / 'cleanup.json', (json.dumps({'ownedContextDisposed': disposed, 'disposeOnDetach': True}) + '\n').encode())


async def discover_version(open_stream=None, budget=3):
    """Fixed loopback HTTP/1.x only; one cancellable aggregate I/O budget.

    Internal stream/budget injection supports socket-free fixtures. Live callers
    use the defaults; there is no configurable address or redirect handler.
    """
    writer = None
    async def read_response():
        nonlocal writer
        reader, writer = await (open_stream or asyncio.open_connection)('127.0.0.1', 9222, limit=8193)
        writer.write(b'GET /json/version HTTP/1.1\r\nHost: 127.0.0.1:9222\r\nConnection: close\r\n\r\n')
        await writer.drain()
        status = await reader.readline()
        match = re.fullmatch(rb'HTTP/1\.[01] ([0-9]{3})[^\r\n]*\r\n', status)
        if not match or len(status) > 1024:
            raise ValueError('CDP-discovery-status-refused')
        code = int(match[1])
        # Refuse before reading/following any Location, on every redirect code.
        if code in (301, 302, 303, 307, 308):
            raise ValueError('CDP-discovery-redirect-refused')
        if code != 200:
            raise ValueError('CDP-discovery-status-refused')
        headers, total = {}, len(status)
        while True:
            line = await reader.readline()
            total += len(line)
            if total > 8192 or not line.endswith(b'\r\n'):
                raise ValueError('CDP-discovery-headers-refused')
            if line == b'\r\n':
                break
            if len(headers) >= 32:
                raise ValueError('CDP-discovery-headers-refused')
            key, separator, value = line[:-2].partition(b':')
            if not separator or not re.fullmatch(rb'[A-Za-z0-9-]+', key) or key.lower() in headers or any(byte < 32 and byte != 9 or byte == 127 for byte in value):
                raise ValueError('CDP-discovery-headers-refused')
            headers[key.lower()] = value.strip()
        if b'transfer-encoding' in headers or b'content-encoding' in headers:
            raise ValueError('CDP-discovery-framing-refused')
        length = headers.get(b'content-length', b'')
        if not re.fullmatch(rb'[0-9]{1,5}', length) or not 0 < int(length) <= 16000:
            raise ValueError('CDP-discovery-body-limit-or-framing')
        content_type = headers.get(b'content-type', b'').lower()
        if content_type.split(b';', 1)[0].strip() != b'application/json':
            raise ValueError('CDP-discovery-content-type-refused')
        body = await reader.readexactly(int(length))
        value = json.loads(body.decode('utf-8', errors='strict'))
        if not isinstance(value, dict):
            raise ValueError('CDP-discovery-metadata-refused')
        return value
    try:
        return await asyncio.wait_for(read_response(), budget)
    finally:
        if writer is not None:
            # Abort synchronously: cancellation cannot leave a close handshake,
            # read worker/thread, or live transport behind after the budget.
            writer.transport.abort()



async def live(task):
    # The websocket module is imported only on the explicit opt-in path.
    import websockets
    started = time.monotonic()
    async def connect():
        meta = await discover_version()
        endpoint = meta.get('webSocketDebuggerUrl', '')
        if not re.fullmatch(r'ws://127\.0\.0\.1:9222/devtools/browser/[A-Za-z0-9-]+', endpoint) or not re.fullmatch(r'Chrome/154\.[0-9.]+', meta.get('Browser', '')):
            raise ValueError('existing-CDP-client-version-or-endpoint-refused')
        async with websockets.connect(endpoint, open_timeout=3, close_timeout=1, max_size=2_000_000, proxy=None) as ws:
            cdp = CDP(ws)
            try:
                # Leave time for owned cleanup and socket detach within 120 s.
                return await asyncio.wait_for(attempt(cdp, task, meta['Browser']), max(1, 108 - (time.monotonic() - started)))
            finally:
                await cdp.stop()
    return await asyncio.wait_for(connect(), 119)


def cli(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument('--enable-one-shot', action='store_true', required=True)
    parser.add_argument('--preflight', required=True)
    args = parser.parse_args(argv)
    preflight(args.preflight)
    lock_fd = os.open(ROOT / '.tvd-pa-browser-one-shot.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(lock_fd)
        import stat
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
            raise ValueError('inflight-lock-refused')
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        task = pathlib.Path(tempfile.mkdtemp(prefix='tvd-pa-one-shot-', dir=ROOT))
        sync_directory(ROOT)
        try:
            result = asyncio.run(live(task))
            print(json.dumps({**result, 'privateCaptureDirectory': str(task)}))
        except BaseException as error:
            publish(task / 'failure.json', (json.dumps({'outcome': 'held', 'errorType': type(error).__name__, 'reason': str(error)[:500], 'liveResumeAuthorized': False}) + '\n').encode())
            raise
    finally:
        os.close(lock_fd)
