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
from pa_browser.controller import Controller, PAGE, HREF, URL, LABEL, select_link
from pa_browser import storage
from pa_browser.storage import completed_file, retain_capture, private_directory
from pa_browser.live import attempt, CLICK, SNAPSHOT, preflight, discover_version

BUILD = pathlib.Path(tempfile.gettempdir())  # Self-contained private children on Builder and clean CI.
START, END = '2026-09-30T20:00:00.000Z', '2026-09-30T20:00:01.123Z'
LINK = {'index': 7, 'label': LABEL, 'href': HREF, 'resolved': URL}
PAGE_STATE = {'url': PAGE, 'denied': False, 'ready': 'complete', 'links': [LINK], 'literalLabels': ['Last Updated: September 30, 2026 3:30 PM']}


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



if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--emit-fixture':
        folder=private_directory(sys.argv[2]);raw=(folder/'input.zip').read_bytes();c=controller();c.observe_page(PAGE_STATE);c.click(START);begin(c);complete(c,raw);retain_capture(folder,c.packet(raw))
    else:unittest.main()
