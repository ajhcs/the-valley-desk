"""One anonymous, exact planned GET; no native body or send permit is persisted.

Run from the repository with its qualified Node wrapper. A crash after issue is
charged and uncertain. Rerunning cannot obtain another permit for that page.
The trusted operator, frozen code and host clock remain explicit assumptions.
"""
import base64, datetime, hashlib, http.client, ipaddress, json, signal, socket, ssl, subprocess, sys, time
from pathlib import Path
from urllib.parse import urlsplit

def sha(data): return hashlib.sha256(data).hexdigest()
def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
def canonical(value): return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)
class Withheld(Exception): pass
class Pinned(http.client.HTTPSConnection):
    def __init__(self,host,address,timeout):
        super().__init__(host,443,timeout=timeout,context=ssl.create_default_context());self.address=address
    def connect(self):
        sock=socket.create_connection((self.address,443),timeout=self.timeout)
        self.sock=self._context.wrap_socket(sock,server_hostname=self.host)

def node(script,envelope,timeout=8):
    result=subprocess.run(['node','--import','tsx/esm',script],input=canonical(envelope).encode(),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=timeout,check=False)
    if len(result.stdout)>1000000: raise Withheld('inspector-output-cap')
    decoded=json.loads(result.stdout)
    if result.returncode or decoded.get('ok') is not True:
        code=decoded.get('code')
        allowed={'byte-cap','field-census','whole-payload-preflight','cardinality','identity','owner-identity','repository-identity','repository-shape','publication-identity','unpermitted-material','link','date','integer','array','text','url','score','search-shape','crossref-envelope','duplicate-native-identity','unplanned-request','projection-validation','journal-operation-rejected'}
        raise Withheld(code if code in allowed else 'method-rejected')
    return decoded

def capture(batch,request_id):
    batch=Path(batch).resolve(strict=True)
    if not batch.is_relative_to('/workspace/build/builderbob/') or batch.stat().st_mode & 0o077: raise Withheld('private-batch-required')
    methods=json.loads((batch/'methods.json').read_text())
    for name,digest in methods.items():
        if sha(Path(name).read_bytes())!=digest: raise Withheld('method-drift')
    plan=json.loads((batch/'plan.json').read_text())
    manifest=json.loads((batch/'request-manifest.json').read_text())
    source_paths={
        'GL03-request-manifest-v1':('docs/discovery/go-live/execution/GL03-request-manifest.json','docs/discovery/go-live/execution/GL03-source-preflight.md'),
        'GL03-supplemental-request-v2':('docs/discovery/go-live/execution/GL03-supplemental-request-manifest.json','docs/discovery/go-live/execution/GL03-supplemental-preflight.md')}
    if manifest.get('id') not in source_paths: raise Withheld('unknown-manifest')
    manifest_source,preflight_source=source_paths[manifest['id']]
    if sha((batch/'request-manifest.json').read_bytes())!=methods.get(manifest_source) or sha((batch/'preflight.md').read_bytes())!=methods.get(preflight_source): raise Withheld('copied-scope-drift')
    if sha(canonical(methods).encode())!=plan['approvedScopeSha256']: raise Withheld('scope-drift')
    pages=[p for p in plan['pages'] if p['id']==request_id]
    definitions=[p for p in manifest['requests'] if p['id']==request_id]
    if len(pages)!=1 or len(definitions)!=1: raise Withheld('unplanned-request')
    page=pages[0];definition=definitions[0]
    # Supplemental qualification carries the closed original batch's charges and holds.
    # These exact files are included in the frozen scope; no provider refusal bypass.
    for prior in manifest.get('prior_receipts',[]):
        native=Path(prior['path']).read_bytes()
        if sha(native)!=prior['sha256']: raise Withheld('prior-receipt-drift')
        previous=json.loads(native)['receipt']
        if prior['provider']==page['provider'] and previous['status'] in ('refused','rate-limited'): raise Withheld('prior-provider-held')
    if page['url']!=definition['url']: raise Withheld('request-drift')
    parsed=urlsplit(page['url'])
    if parsed.scheme!='https' or parsed.hostname not in ('api.github.com','api.crossref.org') or parsed.port not in (None,443) or parsed.username or parsed.password or parsed.fragment: raise Withheld('request-drift')
    # This call is part of the sender, not a reusable permit-file interface.
    permit=node('scripts/discovery-directory-journal.mjs',{'action':'issue','directory':str(batch/'journal'),'plan':plan,'pageId':request_id})['result']
    if permit['requestSha256']!=page['requestSha256'] or sha(canonical(permit['request']).encode())!=page['requestSha256']: raise Withheld('permit-drift')
    remaining=lambda:max(0.001,page['timeoutMs']/1000-(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(permit['issuedAt'].replace('Z','+00:00'))).total_seconds())
    def alarm(_signum,_frame): raise Withheld('deadline')
    signal.signal(signal.SIGALRM,alarm);signal.setitimer(signal.ITIMER_REAL,remaining())
    receipt={'schemaVersion':'directory-native-receipt-v1','id':'GL03:receipt:'+request_id,'pageId':request_id,'manifestSha256':permit['manifestSha256'],'sourceId':page['sourceId'],'scopeId':page['scopeId'],'installation':page['installation'],'qualificationSha256':page['qualificationSha256'],'requestSha256':page['requestSha256'],'issuedAt':permit['issuedAt'],'completedAt':permit['issuedAt'],'status':'unknown','httpStatus':None,'responseBytes':0,'contentEncoding':'unknown','contentType':'unknown','utf8':'unknown','redirects':0,'nativeBodySha256':None,'projectionSha256':None,'packetSha256':None,'parserRevision':None,'parserSha256':None}
    audit={'requestId':request_id,'anonymous':True,'redirectsFollowed':0,'retries':0,'rawBodyRetained':False,'wp06TransportExercised':False,'parserSourceSha256':page['parserSha256']}
    conn=None;packet=None
    try:
        addresses=sorted({item[4][0] for item in socket.getaddrinfo(parsed.hostname,443,type=socket.SOCK_STREAM)})
        if not addresses or not all(ipaddress.ip_address(a).is_global for a in addresses): raise Withheld('nonpublic-dns')
        address=next((a for a in addresses if ipaddress.ip_address(a).version==4),addresses[0])
        conn=Pinned(parsed.hostname,address,min(10,remaining()));conn.connect()
        audit.update(selectedPublicIp=address,tlsVersion=conn.sock.version())
        headers={'Accept':page['accept'],'Accept-Encoding':page['encoding'],'User-Agent':page['userAgent'],'Connection':'close'}
        if page['githubApiVersion'] is not None: headers['X-GitHub-Api-Version']=page['githubApiVersion']
        conn.request('GET',parsed.path+('?' + parsed.query if parsed.query else ''),headers=headers)
        response=conn.getresponse();receipt['httpStatus']=response.status
        if response.status!=200:
            receipt['status']='rate-limited' if response.status==429 else 'refused' if response.status in (401,403) or 300<=response.status<400 else 'unavailable'
            raise Withheld('http-'+str(response.status))
        for name in ('content-type','content-encoding','content-length') + (() if definition.get('continuation_policy')=='opaque_unknown' else ('link',)):
            if sum(k.lower()==name for k,_ in response.getheaders())>1: raise Withheld('duplicate-header')
        encoding=response.getheader('Content-Encoding','identity').strip().lower()
        mime=response.getheader('Content-Type','').strip().lower()
        if encoding!='identity': raise Withheld('encoding')
        receipt['contentEncoding']='identity'
        parts=[part.strip() for part in mime.split(';')]
        if parts[0]!='application/json' or len(parts)>2 or len(parts)==2 and parts[1] not in ('charset=utf-8','charset="utf-8"'): raise Withheld('mime')
        receipt['contentType']='application/json'
        length=response.getheader('Content-Length')
        if length is not None and (not length.isdecimal() or int(length)>page['maxBytes']): raise Withheld('byte-cap')
        body=response.read(page['maxBytes']+1)
        receipt['responseBytes']=min(len(body),page['maxBytes'])
        if len(body)>page['maxBytes']: raise Withheld('byte-cap')
        if length is not None and int(length)!=len(body): raise Withheld('incomplete-body')
        try: body.decode('utf-8',errors='strict');receipt['utf8']='valid'
        except UnicodeDecodeError: receipt['utf8']='invalid';raise Withheld('utf8')
        result=node('scripts/discovery-directory-inspect.mjs',{'bodyBase64':base64.b64encode(body).decode(),'requestManifest':manifest,'requestId':request_id,'page':page,'permit':permit,'manifestSha256':permit['manifestSha256'],'linkHeader':None if definition.get('continuation_policy')=='opaque_unknown' else response.getheader('Link'),'observedDate':utc()[:10],'parserSha256':page['parserSha256']},timeout=remaining())
        packet=result['packet'];audit.update(result['summary'])
        receipt.update(status='received',nativeBodySha256=packet['nativeBodySha256'],projectionSha256=packet['projectionSha256'],packetSha256=sha(canonical(packet).encode()),parserRevision=page['parserRevision'],parserSha256=page['parserSha256'])
    except Exception as error:
        packet=None
        if receipt['status']=='unknown': receipt['status']='unknown' if isinstance(error,Withheld) and str(error)=='deadline' else 'malformed' if receipt['httpStatus']==200 else 'unknown'
        audit['failureCode']=str(error) if isinstance(error,Withheld) else 'transport-or-method-failure'
    finally:
        signal.setitimer(signal.ITIMER_REAL,0)
        if conn: conn.close()
        receipt['completedAt']=utc()
    # Inspector finish time is part of the 25s bound. An overrun cannot be received.
    if remaining()<=0.001 and receipt['status']=='received':
        packet=None;receipt.update(status='unknown',nativeBodySha256=None,projectionSha256=None,packetSha256=None,parserRevision=None,parserSha256=None);audit['failureCode']='deadline'
    if packet is None: receipt.update(nativeBodySha256=None,projectionSha256=None,packetSha256=None,parserRevision=None,parserSha256=None)
    # Validate and atomically journal FIRST. No body/permit is written to disk.
    settled=node('scripts/discovery-directory-journal.mjs',{'action':'finish','directory':str(batch/'journal'),'plan':plan,'receipt':receipt,'packet':packet})['result']
    destination=batch/(request_id+'.json')
    with destination.open('x',encoding='utf-8') as file:
        file.write(json.dumps({'receipt':receipt,'packet':packet,'audit':audit,'settled':settled},indent=2,ensure_ascii=False)+'\n')
    destination.chmod(0o600)
    return {'id':request_id,'status':receipt['status'],'httpStatus':receipt['httpStatus'],'bytes':receipt['responseBytes'],'items':len(packet['facts']) if packet else 0,'outcome':settled['outcome'],'failureCode':audit.get('failureCode')}

if __name__=='__main__':
    try: print(json.dumps(capture(sys.argv[1],sys.argv[2])))
    except Exception: print(json.dumps({'status':'not-completed','code':'capture-stopped-no-resend'}));sys.exit(1)
