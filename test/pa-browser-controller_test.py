"""Builder-only synthetic CDP/controller tests. Never import a live transport."""
import asyncio
import copy
import hashlib
import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
import stat
import time
from unittest import mock
import zipfile
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
from pa_browser.controller import BrowserFailure, Controller, PAGE, HREF, URL, LABEL, select_link
from pa_browser import storage
from pa_browser.storage import completed_file, retain_capture, private_directory
from pa_browser.live import attempt, CLICK, SNAPSHOT, preflight, discover_version, CDP, wait_for_page, evaluate_exception, retain_failure

BUILD = pathlib.Path(tempfile.gettempdir())  # Self-contained private children on Builder and clean CI.
START, END = '2026-09-30T20:00:00.000Z', '2026-09-30T20:00:01.123Z'
LINK = {'index': 7, 'label': LABEL, 'href': HREF, 'resolved': URL}
PAGE_STATE = {'url': PAGE, 'denied': False, 'interstitial': False, 'bodyPresent': True, 'ready': 'complete', 'links': [LINK], 'literalLabels': ['Last Updated: September 30, 2026 3:30 PM']}


def controller():
    return Controller('synthetic-target', 'synthetic-session', 'synthetic-frame', 'SYNTHETIC Chrome/154.0')


def begin(c, **changes):
    c.event({'method': 'Browser.downloadWillBegin', 'params': {'frameId': c.frame, 'guid': 'synthetic-guid', 'url': URL, 'suggestedFilename': 'history.zip', **changes}}, START)


def complete(c, raw):
    c.event({'method': 'Browser.downloadProgress', 'params': {'guid': c.guid, 'state': 'completed', 'receivedBytes': len(raw), 'totalBytes': len(raw)}}, END)


def zip_bytes():
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        archive.writestr(zipfile.ZipInfo('synthetic.xml', (2026, 9, 30, 20, 0, 0)), '<synthetic/>')
    return output.getvalue()


class PureTests(unittest.TestCase):
    def test_exact_selection_refusals(self):
        self.assertEqual(select_link(PAGE_STATE), LINK)
        for change in [{'links': []}, {'links': [LINK, LINK]}, {'url': PAGE + '/'}, {'url': 'https://evil.invalid/data'}, {'denied': True}]:
            with self.assertRaises(ValueError): select_link({**PAGE_STATE, **change})
        for key, value in [('label', '2023-2024 Regular Session'), ('href', URL), ('resolved', 'http://www.palegis.us'+HREF), ('resolved', 'https://evil.invalid'+HREF), ('href', HREF+'&extra=1')]:
            with self.assertRaises(ValueError): select_link({**PAGE_STATE, 'links': [{**LINK, key: value}]})

    def test_owned_events_and_exact_unchanged_bytes(self):
        raw = zip_bytes(); c = controller(); c.observe_page(PAGE_STATE); c.click(START)
        for event in [{'method': 'Browser.downloadWillBegin', 'params': {'frameId': 'foreign-frame', 'guid': 'foreign-guid', 'url': 'https://evil.invalid'}}, {'method': 'Browser.downloadProgress', 'params': {'guid': 'foreign-guid', 'state': 'canceled'}}, {'sessionId': 'foreign-session', 'method': 'Network.responseReceived', 'params': {'frameId': c.frame, 'type': 'Document', 'response': {'status': 403, 'url': URL}}}]: c.event(event, START)
        self.assertIsNone(c.guid); begin(c); complete(c, raw); parts = c.packet(raw)
        self.assertEqual(parts['original.zip'], raw)
        receipt = json.loads(parts['original-receipt.json']); envelope = json.loads(parts['acquisition.json'])
        self.assertEqual(envelope['representationSha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual(envelope['downloadReceiptSha256'], hashlib.sha256(parts['original-receipt.json']).hexdigest())
        self.assertEqual(envelope['completedAt'], END)
        self.assertEqual(receipt['source']['literal_unzoned_update_labels'], PAGE_STATE['literalLabels'])
        self.assertNotIn('exportAt', receipt); self.assertIsNone(envelope['httpStatus']); self.assertIsNone(envelope['finalResponseUrl']); self.assertIsNone(envelope['redirectChain'])
        with self.assertRaises(ValueError): c.click(END)

    def test_download_refusals(self):
        for change in [{'url': URL+'&redirect=1'}, {'url': 'https://evil.invalid/file'}, {'guid': '../outside'}, {'suggestedFilename': '../evil.zip'}, {'suggestedFilename': 'file.crdownload'}, {'suggestedFilename': '/tmp/evil.zip'}]:
            c=controller();c.observe_page(PAGE_STATE);c.click(START)
            with self.assertRaises(ValueError): begin(c, **change)
        c=controller();c.observe_page(PAGE_STATE);c.click(START);begin(c)
        with self.assertRaises(ValueError): begin(c, guid='second-guid')
        for state, received, total in [('canceled',0,0), ('inProgress',2_000_001,2_000_001), ('completed',10,11), ('completed',0,0), ('completed',float('nan'),0)]:
            c=controller();c.observe_page(PAGE_STATE);c.click(START);begin(c)
            with self.assertRaises(ValueError): c.event({'method':'Browser.downloadProgress','params':{'guid':c.guid,'state':state,'receivedBytes':received,'totalBytes':total}}, END)

    def test_fail_closed_before_and_after_click(self):
        for clicked in [False,True]:
            for row in [{'method':'Network.requestWillBeSent','params':{'frameId':'synthetic-frame','type':'Document','request':{'url':URL},'redirectResponse':{'status':302}}}, {'method':'Network.responseReceived','params':{'frameId':'synthetic-frame','type':'Document','response':{'url':URL,'status':403}}}, {'method':'Page.frameNavigated','params':{'frame':{'id':'synthetic-frame','url':'https://evil.invalid'}}}]:
                c=controller();c.observe_page(PAGE_STATE)
                if clicked:c.click(START)
                with self.assertRaises(ValueError):c.event({**row,'sessionId':c.session},END)
                with self.assertRaises(ValueError):c.packet(zip_bytes())
            c=controller();c.observe_page(PAGE_STATE)
            if clicked:c.click(START)
            with self.assertRaises(ValueError):c.observe_page({**PAGE_STATE,'denied':True})
            with self.assertRaises(ValueError):c.packet(zip_bytes())

    def test_completion_nofollow_partial_oversize_and_immutable(self):
        with tempfile.TemporaryDirectory(dir=BUILD) as name:
            folder=pathlib.Path(name);file=folder/'synthetic-guid';file.write_bytes(zip_bytes())
            self.assertEqual(completed_file(folder,'synthetic-guid',len(zip_bytes())),zip_bytes())
            partial=folder/'synthetic-guid.crdownload';partial.write_bytes(b'x')
            with self.assertRaises(ValueError):completed_file(folder,'synthetic-guid',len(zip_bytes()))
            partial.unlink();file.unlink();file.symlink_to(folder/'missing')
            with self.assertRaises(OSError):completed_file(folder,'synthetic-guid',1)
            file.unlink();file.write_bytes(b'x'*2_000_001)
            with self.assertRaises(ValueError):completed_file(folder,'synthetic-guid',2_000_001)
            file.unlink();file.mkdir()
            with self.assertRaises(ValueError):completed_file(folder,'synthetic-guid',1)
            file.rmdir();file.write_bytes(b'x')
            with self.assertRaises(ValueError):completed_file(folder,'synthetic-guid',2)
            c=controller();c.observe_page(PAGE_STATE);c.click(START);begin(c);complete(c,zip_bytes());parts=c.packet(zip_bytes())
            retain_capture(folder,parts);retain_capture(folder,parts)
            with self.assertRaises(ValueError):retain_capture(folder,{**parts,'original.zip':b'conflict'})
            self.assertEqual((folder/'original.zip').read_bytes(),zip_bytes())
            self.assertTrue((folder/'capture-complete.json').exists())

    def test_disabled_has_no_network_imports_or_external_actions(self):
        source="""import builtins,runpy,sys
original=builtins.__import__
def guarded(name,*a,**kw):
 if name.split('.')[0] in ['socket','asyncio','urllib','websockets','subprocess','pa_browser','pathlib']:raise AssertionError('disabled import '+name)
 return original(name,*a,**kw)
builtins.__import__=guarded
sys.argv=['scripts/acquire-pa-browser.py','--preflight','/must-not-read']
runpy.run_path('scripts/acquire-pa-browser.py',run_name='__main__')
"""
        result=subprocess.run([sys.executable,'-c',source],check=True,capture_output=True,text=True,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        self.assertEqual(json.loads(result.stdout)['outcome'],'disabled')
        with self.assertRaises(Exception):preflight(BUILD/'missing-preflight')

    def test_production_preflight_rejects_wrong_root_before_live_modules(self):
        from datetime import datetime,timezone,timedelta
        with tempfile.TemporaryDirectory(dir=BUILD) as name:
            path=pathlib.Path(name)/'preflight.json'
            path.write_text(json.dumps({'schemaVersion':'pa-browser-client-preflight-1','sshAlias':'plumbob','clientHost':'plumbobos','storageRoot':name,'cdpVersionUrl':'http://127.0.0.1:9222/json/version','chromeMajor':154,'websocketsVersion':'16.0','oneShotApproved':True,'sourceUrl':PAGE,'hardTransferByteCeilingRequired':False,'schedulingEnabled':False,'reviewReceipt':'synthetic-only','expiresAt':(datetime.now(timezone.utc)+timedelta(minutes=1)).isoformat(timespec='milliseconds').replace('+00:00','Z')}));path.chmod(0o600)
            with self.assertRaisesRegex(ValueError,'client-preflight-binding-refused'):preflight(path)
            self.assertNotIn('websockets',sys.modules)

    def test_preflight_distinguishes_ssh_alias_from_existing_hostname(self):
        from datetime import datetime, timezone, timedelta
        with tempfile.TemporaryDirectory(dir=BUILD) as name:
            path = pathlib.Path(name) / 'preflight.json'
            declared = {'schemaVersion': 'pa-browser-client-preflight-1',
                        'sshAlias': 'plumbob', 'clientHost': 'plumbobos',
                        'storageRoot': '/mnt/d/tmp/plumbob',
                        'cdpVersionUrl': 'http://127.0.0.1:9222/json/version',
                        'chromeMajor': 154, 'websocketsVersion': '16.0',
                        'oneShotApproved': True, 'sourceUrl': PAGE,
                        'hardTransferByteCeilingRequired': False, 'schedulingEnabled': False,
                        'reviewReceipt': 'synthetic-host-identity-only',
                        'expiresAt': (datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')}
            for hostname, changes, error in [
                ('plumbobos', {}, None),
                ('plumbob', {}, 'existing-plumbob-client-mounted-root-required'),
                ('plumbobos', {'clientHost': 'plumbob'}, 'client-preflight-binding-refused'),
                ('plumbobos', {'sshAlias': 'plumbobos'}, 'client-preflight-binding-refused'),
            ]:
                with self.subTest(hostname=hostname, changes=changes):
                    value = {**declared, **changes}
                    path.write_text(json.dumps(value)); path.chmod(0o600)
                    # Existing mount/root/module checks are simulated only here;
                    # host rejection must precede root or installed-module access.
                    with mock.patch('pa_browser.live.platform.node', return_value=hostname), \
                         mock.patch('pa_browser.live.os.path.ismount', return_value=True) as mounted, \
                         mock.patch('pa_browser.live.private_directory') as root, \
                         mock.patch('pa_browser.live.importlib.metadata.version', return_value='16.0') as version:
                        if error:
                            with self.assertRaisesRegex(ValueError, error): preflight(path)
                            mounted.assert_not_called(); root.assert_not_called(); version.assert_not_called()
                        else:
                            self.assertEqual(preflight(path), value)
                            mounted.assert_called_once_with('/mnt/d')
                            root.assert_called_once_with(pathlib.Path('/mnt/d/tmp/plumbob'))
                            version.assert_called_once_with('websockets')
                    self.assertNotIn('websockets', sys.modules)


class FakeCDP:
    def __init__(self, task, mode='success'):
        self.task, self.mode, self.calls = task, mode, []
        self.controller=None;self.failure=None;self.clicked=False
    def check(self):
        if self.failure:raise self.failure
    async def call(self, method, params=None, session=None, cleanup=False):
        self.calls.append((method,params,session,cleanup))
        if method=='Target.createBrowserContext':return {'browserContextId':'synthetic-context'}
        if method=='Target.createTarget':return {'targetId':'synthetic-target'}
        if method=='Target.attachToTarget':return {'sessionId':'synthetic-session'}
        if method=='Page.getFrameTree':return {'frameTree':{'frame':{'id':'synthetic-frame'}}}
        if method=='Page.navigate':return {'frameId':'synthetic-frame'}
        if method=='Target.disposeBrowserContext' and self.mode=='success':
            assert (self.task/'capture-complete.json').exists(), 'retain before close'
        return {}
    async def evaluate(self, expression, session, gesture=False):
        self.calls.append(('evaluate',expression,session,gesture))
        if expression==CLICK:
            assert gesture;self.clicked=True;begin(self.controller)
            if self.mode=='success':
                raw=zip_bytes();(self.task/'downloads'/'synthetic-guid').write_bytes(raw);complete(self.controller,raw)
            return {'clicked':True}
        assert expression==SNAPSHOT
        if self.mode=='before' or self.mode=='after' and self.clicked:return {**PAGE_STATE,'denied':True}
        return copy.deepcopy(PAGE_STATE)


class AdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_attempt_cleanup_and_no_foreign_settings(self):
        for mode in ['success','before','after','timeout']:
            with tempfile.TemporaryDirectory(dir=BUILD) as name:
                task=pathlib.Path(name);cdp=FakeCDP(task,mode)
                if mode=='success':self.assertEqual((await attempt(cdp,task,'SYNTHETIC Chrome'))['outcome'],'retained')
                else:
                    with self.assertRaises((ValueError,TimeoutError)):await asyncio.wait_for(attempt(cdp,task,'SYNTHETIC Chrome'),.15)
                    self.assertFalse((task/'capture-complete.json').exists())
                commands=[c[0] for c in cdp.calls]
                self.assertEqual(commands.count('Target.createBrowserContext'),1);self.assertEqual(commands.count('Target.disposeBrowserContext'),1)
                self.assertEqual(commands.count('Page.navigate'),1);self.assertNotIn('Browser.close',commands)
                self.assertFalse(any('cookie' in c.lower() or 'header' in c.lower() or 'useragent' in c.lower() or 'getTargets' in c for c in commands))
                cancel=[c for c in cdp.calls if c[0]=='Browser.cancelDownload']
                if cancel:self.assertEqual(cancel[0][1],{'guid':'synthetic-guid','browserContextId':'synthetic-context'})
                behavior=next(c[1] for c in cdp.calls if c[0]=='Browser.setDownloadBehavior');self.assertEqual(behavior['browserContextId'],'synthetic-context')
                self.assertEqual(json.loads((task/'cleanup.json').read_bytes())['ownedContextDisposed'],True)


class MemoryWriter:
    def __init__(self):
        self.transport = self
        self.aborted = False
        self.requests = []
    def write(self, raw): self.requests.append(raw)
    async def drain(self): pass
    def abort(self): self.aborted = True


def version_response(body=b'{"Browser":"Chrome/154.0","webSocketDebuggerUrl":"ws://127.0.0.1:9222/devtools/browser/synthetic"}', headers=b''):
    return b'HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=UTF-8\r\nContent-Length: '+str(len(body)).encode()+b'\r\n'+headers+b'\r\n'+body


class DiscoveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_fixed_loopback_success_and_redirects_never_followed(self):
        for response in [version_response(), *[b'HTTP/1.1 '+str(code).encode()+b' Found\r\nLocation: https://evil.invalid:9443/json/version\r\n\r\n' for code in [301,302,303,307,308]]]:
            reader=asyncio.StreamReader();reader.feed_data(response);reader.feed_eof();writer=MemoryWriter();contacts=[]
            async def connect(host,port,**kwargs): contacts.append((host,port));return reader,writer
            if response.startswith(b'HTTP/1.1 200'):
                self.assertEqual((await discover_version(connect))['Browser'],'Chrome/154.0')
            else:
                with self.assertRaisesRegex(ValueError,'redirect-refused'):await discover_version(connect)
            self.assertEqual(contacts,[('127.0.0.1',9222)]);self.assertTrue(writer.aborted)
            self.assertEqual(writer.requests,[b'GET /json/version HTTP/1.1\r\nHost: 127.0.0.1:9222\r\nConnection: close\r\n\r\n'])

    async def test_bounded_headers_body_and_unsupported_framing(self):
        responses=[b'HTTP/1.1 403 Forbidden\r\n\r\n',version_response(headers=b'Transfer-Encoding: chunked\r\n'),version_response(headers=b'Content-Encoding: gzip\r\n'),version_response(headers=b'Content-Length: 5\r\n'),version_response(headers=b'BadHeader\r\n'),version_response(headers=b'X-Huge: '+b'a'*8200+b'\r\n'),b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{}',version_response(b'no json'),version_response(b'[]'),version_response(b'{}')[:-1]]
        # Explicit overlimit length independently of the normal response length.
        responses.append(b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 16001\r\n\r\n')
        for response in responses:
            reader=asyncio.StreamReader(limit=8193);reader.feed_data(response);reader.feed_eof();writer=MemoryWriter()
            async def connect(*args,**kwargs):return reader,writer
            with self.assertRaises((ValueError,asyncio.IncompleteReadError)):await discover_version(connect)
            self.assertTrue(writer.aborted)

    async def test_aggregate_timeout_and_cancellation_abort_without_worker_or_socket(self):
        import threading
        for phase in ['header','body','trickle','cancel']:
            writer=MemoryWriter();baseline_threads=set(threading.enumerate());baseline_tasks=set(asyncio.all_tasks())
            class DelayedReader:
                def __init__(self):self.lines=iter([b'HTTP/1.1 200 OK\r\n',b'Content-Type: application/json\r\n',b'Content-Length: 100\r\n',b'\r\n']);self.cancelled=False
                async def pause(self):
                    try:await asyncio.sleep(10)
                    except asyncio.CancelledError:self.cancelled=True;raise
                async def readline(self):
                    if phase in ['header','cancel']:await self.pause()
                    return next(self.lines)
                async def readexactly(self,count):
                    if phase=='trickle':
                        try:
                            for _ in range(count):await asyncio.sleep(.015)
                        except asyncio.CancelledError:self.cancelled=True;raise
                    else:await self.pause()
            reader=DelayedReader();contacts=[]
            async def connect(host,port,**kwargs):contacts.append((host,port));return reader,writer
            started=time.monotonic()
            if phase=='cancel':
                task=asyncio.create_task(discover_version(connect));await asyncio.sleep(.01);task.cancel()
                with self.assertRaises(asyncio.CancelledError):await task
            else:
                with self.assertRaises(TimeoutError):await discover_version(connect,budget=.05)
            self.assertLess(time.monotonic()-started,.2);self.assertTrue(writer.aborted);self.assertTrue(reader.cancelled)
            self.assertEqual(contacts,[('127.0.0.1',9222)]);self.assertEqual(set(threading.enumerate()),baseline_threads)
            self.assertEqual(set(asyncio.all_tasks()),baseline_tasks)


class DurabilityTests(unittest.TestCase):
    def test_capture_parent_barrier_failure_preserves_raw_files_without_marker(self):
        with tempfile.TemporaryDirectory(dir=BUILD) as name:
            parent=pathlib.Path(name);folder=parent/'capture';folder.mkdir(mode=0o700)
            c=controller();c.observe_page(PAGE_STATE);c.click(START);begin(c);raw=zip_bytes();complete(c,raw);parts=c.packet(raw)
            parent_inode=parent.stat().st_ino;real_fsync=os.fsync;real_link=os.link;parent_synced=False
            def fail_parent(fd):
                if stat.S_ISDIR(os.fstat(fd).st_mode) and os.fstat(fd).st_ino==parent_inode:raise OSError('synthetic parent fsync failure')
                real_fsync(fd)
            with mock.patch.object(storage.os,'fsync',side_effect=fail_parent):
                with self.assertRaisesRegex(OSError,'parent fsync failure'):retain_capture(folder,parts)
            self.assertFalse((folder/'capture-complete.json').exists());self.assertEqual((folder/'original.zip').read_bytes(),raw)
            def sync_parent(fd):
                nonlocal parent_synced
                if stat.S_ISDIR(os.fstat(fd).st_mode) and os.fstat(fd).st_ino==parent_inode:parent_synced=True
                real_fsync(fd)
            def link_after_barrier(source,destination,**kwargs):
                if pathlib.Path(destination).name=='capture-complete.json':self.assertTrue(parent_synced)
                return real_link(source,destination,**kwargs)
            with mock.patch.object(storage.os,'fsync',side_effect=sync_parent),mock.patch.object(storage.os,'link',side_effect=link_after_barrier):retain_capture(folder,parts)
            self.assertTrue((folder/'capture-complete.json').exists());self.assertEqual((folder/'original.zip').read_bytes(),raw)



VM_LINK = {'label': LABEL, 'href': HREF, 'resolved': URL}
VM_READY = {'url': PAGE, 'body': 'ordinary data page', 'ready': 'complete', 'links': [VM_LINK]}


def actual_dom(expression, state):
    raw = subprocess.run(['node', 'test/fixtures/pa-browser-dom-vm.mjs'],
                         input=json.dumps({'expression': expression, 'state': state}),
                         capture_output=True, text=True, check=True)
    return json.loads(raw.stdout)


class VMCDP(FakeCDP):
    def __init__(self, task, states, download=True, status=None):
        super().__init__(task, 'vm')
        self.states = list(states)
        self.current = None
        self.download = download
        self.status = status
        self.snapshots = 0
        self.clicks = 0
    async def call(self, method, params=None, session=None, cleanup=False):
        if method == 'Runtime.evaluate':
            expression = params['expression']
            if expression == SNAPSHOT:
                self.snapshots += 1
                self.current = self.states.pop(0) if self.states else self.current
            result = actual_dom(expression, self.current)
            self.clicks += len(result.pop('clicks'))
            if expression == CLICK and 'exceptionDetails' not in result:
                self.assert_gesture = params['userGesture']
                begin(self.controller)
                if self.download:
                    raw = zip_bytes(); (self.task/'downloads'/'synthetic-guid').write_bytes(raw)
                    complete(self.controller, raw)
            return result
        result = await super().call(method, params, session, cleanup)
        if method == 'Page.navigate' and self.status is not None:
            self.controller.event({'sessionId': self.controller.session, 'method': 'Network.responseReceived',
                                   'params': {'frameId': self.controller.frame, 'type': 'Document',
                                              'response': {'url': PAGE, 'status': self.status}}}, START)
        return result
    async def evaluate(self, expression, session, gesture=False):
        return await CDP.evaluate(self, expression, session, gesture)


class ReadinessIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_js_initial_blank_delayed_body_and_readystate_then_single_click(self):
        with tempfile.TemporaryDirectory(dir=BUILD) as name:
            task=pathlib.Path(name)
            cdp=VMCDP(task,[{'url':'about:blank','body':None,'ready':'complete'},
                            {'url':PAGE,'body':None,'ready':'loading'},
                            {'url':PAGE,'body':'construction','ready':'interactive'},VM_READY])
            result=await attempt(cdp,task,'SYNTHETIC Chrome')
            self.assertEqual(result['outcome'],'retained');self.assertEqual(cdp.clicks,1)
            self.assertTrue(cdp.assert_gesture);self.assertEqual(cdp.snapshots,5)
            self.assertFalse((task/'failure.json').exists())
            self.assertTrue((task/'capture-complete.json').exists())
            self.assertEqual([c[0] for c in cdp.calls].count('Target.disposeBrowserContext'),1)

    async def test_actual_js_denial_redirect_interstitial_and_missing_link_stop_with_sanitized_receipt(self):
        secret='SYNTHETIC_PRIVATE_QUERY_DO_NOT_RETAIN'
        cases=[({'url':PAGE,'body':None,'ready':'loading','title':'Just a moment'},'denial-or-challenge'),
               ({'url':PAGE,'body':None,'ready':'loading','challengeWidget':True},'denial-or-challenge'),
               ({'url':PAGE,'body':'Access denied '+secret},'denial-or-challenge'),
               ({'url':PAGE,'body':None,'interstitial':True},'interstitial'),
               ({'url':'https://other.invalid/data?credential='+secret,'body':secret},'redirect-or-unexpected-url'),
               ({'url':'chrome-error://chromewebdata/','body':None},'interstitial'),
               ({'url':PAGE,'body':'complete without anchor'},'missing-or-ambiguous-exact-link')]
        for state,category in cases:
            with self.subTest(category=category),tempfile.TemporaryDirectory(dir=BUILD) as name:
                task=pathlib.Path(name);cdp=VMCDP(task,[state])
                with self.assertRaises(ValueError):await attempt(cdp,task,'SYNTHETIC Chrome')
                self.assertEqual(cdp.snapshots,1);self.assertEqual(cdp.clicks,0)
                text=(task/'failure.json').read_text();receipt=json.loads(text)
                self.assertEqual(receipt['category'],category);self.assertNotIn(secret,text)
                self.assertEqual(receipt['documentObservation'],None)
                self.assertFalse((task/'capture-complete.json').exists())
                self.assertTrue(json.loads((task/'cleanup.json').read_text())['ownedContextDisposed'])

    async def test_challenge_after_click_halts_and_cancels_only_owned_download(self):
        with tempfile.TemporaryDirectory(dir=BUILD) as name:
            task=pathlib.Path(name);cdp=VMCDP(task,[VM_READY,{'url':PAGE,'body':None,'title':'Access denied'}],download=False)
            with self.assertRaises(ValueError):await attempt(cdp,task,'SYNTHETIC Chrome')
            self.assertEqual(cdp.clicks,1);self.assertEqual(cdp.snapshots,2)
            self.assertEqual(json.loads((task/'failure.json').read_text())['category'],'denial-or-challenge')
            cancellations=[c[1] for c in cdp.calls if c[0]=='Browser.cancelDownload']
            self.assertEqual(cancellations,[{'guid':'synthetic-guid','browserContextId':'synthetic-context'}])
            self.assertFalse((task/'capture-complete.json').exists())

    async def test_real_js_exception_sanitization_and_no_retry(self):
        secret='SYNTHETIC_PRIVATE_EXCEPTION_TOKEN https://host.invalid/?key=do-not-retain'
        with tempfile.TemporaryDirectory(dir=BUILD) as name:
            task=pathlib.Path(name);cdp=VMCDP(task,[{'url':PAGE,'body':None,'exception':secret}])
            with self.assertRaises(BrowserFailure):await attempt(cdp,task,'SYNTHETIC Chrome')
            text=(task/'failure.json').read_text();receipt=json.loads(text)
            self.assertEqual(receipt['category'],'evaluate-exception')
            self.assertEqual(receipt['exceptionType'],'TypeError')
            self.assertEqual(receipt['exceptionDetail'],'unclassified-exception')
            self.assertEqual(receipt['pageState'],None);self.assertNotIn(secret,text)
            self.assertEqual(cdp.snapshots,1);self.assertEqual(cdp.clicks,0)
            self.assertFalse((task/'capture-complete.json').exists())
            old=(task/'failure.json').read_bytes();retain_failure(task,TimeoutError(secret))
            self.assertEqual((task/'failure.json').read_bytes(),old)
        observed=actual_dom('document.body.innerText',{'body':None})
        error=evaluate_exception(observed['exceptionDetails'])
        self.assertEqual(error.exception_type,'TypeError');self.assertEqual(error.exception_detail,'null-property-access')

    async def test_readiness_timeout_persists_last_state_and_cleanup_without_click(self):
        from pa_browser import live as live_module
        original=wait_for_page
        async def short_wait(cdp,session,controller):return await original(cdp,session,controller,budget=.15)
        with tempfile.TemporaryDirectory(dir=BUILD) as name,mock.patch.object(live_module,'wait_for_page',side_effect=short_wait):
            task=pathlib.Path(name);cdp=VMCDP(task,[{'url':PAGE,'body':None,'ready':'loading'}])
            with self.assertRaisesRegex(BrowserFailure,'page-readiness-timeout'):await attempt(cdp,task,'SYNTHETIC Chrome')
            receipt=json.loads((task/'failure.json').read_text())
            self.assertEqual(receipt['category'],'readiness-timeout')
            self.assertEqual(receipt['pageState']['readyState'],'loading')
            self.assertFalse(receipt['pageState']['bodyPresent']);self.assertEqual(cdp.clicks,0)
            self.assertEqual(receipt['documentObservation'],None)
            self.assertTrue(json.loads((task/'cleanup.json').read_text())['ownedContextDisposed'])
            self.assertFalse((task/'capture-complete.json').exists())

    async def test_about_blank_after_expected_page_commit_is_redirect_and_does_not_wait(self):
        with tempfile.TemporaryDirectory(dir=BUILD) as name:
            task=pathlib.Path(name);cdp=VMCDP(task,[{'url':PAGE,'body':None,'ready':'loading'},{'url':'about:blank','body':None}])
            with self.assertRaisesRegex(ValueError,'redirect'):await attempt(cdp,task,'SYNTHETIC Chrome')
            self.assertEqual(cdp.snapshots,2);self.assertEqual(cdp.clicks,0)
            self.assertEqual(json.loads((task/'failure.json').read_text())['category'],'redirect-or-unexpected-url')

    async def test_owned_document_protocol_status_is_observed_without_guessing_download_metadata(self):
        with tempfile.TemporaryDirectory(dir=BUILD) as name:
            task=pathlib.Path(name);cdp=VMCDP(task,[VM_READY],status=403)
            with self.assertRaises(ValueError):await attempt(cdp,task,'SYNTHETIC Chrome')
            receipt=json.loads((task/'failure.json').read_text())
            self.assertEqual(receipt['category'],'protocol-status-refusal')
            self.assertEqual(receipt['documentObservation'],{'httpStatus':403,'urlClassification':'expected-page'})
            self.assertEqual(cdp.clicks,0);self.assertEqual(cdp.snapshots,0)

    async def test_cdp_protocol_error_detail_is_not_page_or_exception_text(self):
        class Wire:
            def __init__(self):self.rows=asyncio.Queue()
            def __aiter__(self):return self
            async def __anext__(self):return await self.rows.get()
            async def send(self,text):
                row=json.loads(text)
                await self.rows.put(json.dumps({'id':row['id'],'error':{'code':-32000,'message':'SYNTHETIC_SECRET_COOKIE query credential'}}))
        cdp=CDP(Wire())
        try:
            with self.assertRaises(BrowserFailure) as failure:await cdp.evaluate(SNAPSHOT,'synthetic-session')
            with tempfile.TemporaryDirectory(dir=BUILD) as name:
                task=pathlib.Path(name);retain_failure(task,failure.exception)
                text=(task/'failure.json').read_text();receipt=json.loads(text)
                self.assertEqual(receipt['category'],'protocol-error');self.assertEqual(receipt['protocolCode'],-32000)
                self.assertNotIn('SYNTHETIC_SECRET',text)
        finally:await cdp.stop()



if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--emit-fixture':
        folder=private_directory(sys.argv[2]);raw=(folder/'input.zip').read_bytes();c=controller();c.observe_page(PAGE_STATE);c.click(START);begin(c);complete(c,raw);retain_capture(folder,c.packet(raw))
    else:unittest.main()
