import datetime,hashlib,http.client,ipaddress,json,socket,ssl,subprocess,sys,time
from pathlib import Path
from urllib.parse import urlsplit

ROOT=Path('.discovery-work/county-expansion/root')
REQUESTS=json.loads((ROOT/'requests.json').read_text())['requests']
def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(b): return hashlib.sha256(b).hexdigest()
class Withheld(Exception): pass
class Pinned(http.client.HTTPSConnection):
 def __init__(self,host,address):
  super().__init__(host,443,timeout=10,context=ssl.create_default_context());self.address=address
 def connect(self):
  sock=socket.create_connection((self.address,443),timeout=10)
  self.sock=self._context.wrap_socket(sock,server_hostname=self.host)

def capture(provider,name):
 selected=[x for x in REQUESTS if x['provider']==provider and x['name']==name]
 if len(selected)!=1: raise ValueError('not-an-allowlisted-request')
 request=selected[0];url=request['url'];parsed=urlsplit(url)
 assert parsed.scheme=='https' and not(parsed.username or parsed.password or parsed.fragment)
 dest=ROOT/'captures'/(provider+'-'+name);dest.mkdir(mode=0o700,parents=True,exist_ok=False)
 start=time.monotonic()
 headers={'User-Agent':'TheValleyDesk-SourceQualification/0.1 (+https://thevalleydesk.org)','Accept-Encoding':'identity','Accept':'application/json','Connection':'close'}
 if provider=='github':headers.update({'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'})
 receipt={'provider':provider,'name':name,'url':url,'method':'GET','started_at_utc':utc(),'transport':'standalone-public-IP-pinned-HTTPS','wp06_transport':False,'anonymous':True,'authentication_sent':False,'proxy_used':False,'redirects_followed':0,'byte_cap':request['maxBytes'],'outer_deadline_seconds':25,'request_headers':headers,'body_retained':False,'rights_scope':'User-authorized bounded public factual source qualification; no article/code/contact-body redistribution or production enrollment.'}
 conn=None
 try:
  addresses=sorted({x[4][0] for x in socket.getaddrinfo(parsed.hostname,443,type=socket.SOCK_STREAM)})
  if not addresses or not all(ipaddress.ip_address(x).is_global for x in addresses):raise Withheld('nonpublic-or-empty-DNS')
  address=next((x for x in addresses if ipaddress.ip_address(x).version==4),addresses[0])
  receipt.update(dns_public_addresses=addresses,selected_public_ip=address)
  conn=Pinned(parsed.hostname,address);conn.connect();receipt['tls_version']=conn.sock.version()
  conn.request('GET',parsed.path+('?' + parsed.query if parsed.query else ''),headers=headers)
  response=conn.getresponse();receipt['status']=response.status
  safe={'date','content-type','content-length','content-encoding','last-modified','etag','retry-after','link','x-rate-limit-limit','x-rate-limit-interval','x-concurrency-limit','x-api-pool','x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-reset','x-ratelimit-resource','x-github-api-version-selected'}
  # Link can carry provider-controlled URLs; record only its presence until separate URI review.
  receipt['link_header_present']=response.getheader('Link') is not None
  receipt['response_headers']={k.lower():v for k,v in response.getheaders() if k.lower() in safe and k.lower()!='link'}
  body=response.read(request['maxBytes']+1);receipt.update(received_bytes=len(body),body_sha256=sha(body),response_complete=len(body)<=request['maxBytes'])
  if response.status!=200:raise Withheld('non-200-body-discarded')
  if len(body)>request['maxBytes']:raise Withheld('body-cap')
  if receipt['response_headers'].get('content-encoding','identity') not in ('','identity'):raise Withheld('unsupported-encoding')
  if receipt['response_headers'].get('content-type','').split(';')[0].strip().lower()!='application/json':raise Withheld('unsupported-MIME')
  code='import fs from "node:fs"; import {decodeDiscoveryMetadataJson} from "./src/ingest/discovery/metadata-preflight.ts"; decodeDiscoveryMetadataJson(fs.readFileSync(0), '+json.dumps(provider)+', () => {throw Error("source-material-withheld")}, '+('"repository"' if provider=='github' else 'undefined')+');'
  result=subprocess.run(['.discovery-work/wp12/run.sh','node','--import','tsx/esm','--input-type=module','-e',code],input=body,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=8)
  if result.returncode:raise Withheld('whole-payload-preflight')
  decoded=json.loads(body)
  if provider=='crossref':
   message=decoded.get('message',{});items=message.get('items',[])
   if decoded.get('status')!='ok' or decoded.get('message-type')!='work-list' or message.get('total-results')!=1 or len(items)!=1:raise Withheld('fixed-DOI-cardinality')
   if 'next-cursor' in message or items[0].get('DOI','').lower()!=request['doiCanonical']:raise Withheld('fixed-DOI-membership')
   if any(k not in request['template']['fixed']['select'].split(',') for k in items[0]):raise Withheld('unexpected-selected-field')
   receipt['native_identity']={'doi':items[0]['DOI'],'canonical_doi':request['doiCanonical']}
  else:
   owner=decoded.get('owner',{})
   if decoded.get('id')!=request['id'] or decoded.get('full_name')!=request['alias'] or decoded.get('private') is not False:raise Withheld('repository-identity')
   if request['ownerType'] not in ('Organization','User') or owner.get('id')!=request['ownerId'] or owner.get('type')!=request['ownerType']:raise Withheld('repository-owner-identity')
   receipt['native_identity']={'repository_id':request['id'],'alias':request['alias'],'owner_id':request['ownerId'],'owner_type':request['ownerType']}
  receipt['preflight_source_sha256']=sha(Path('src/ingest/discovery/metadata-preflight.ts').read_bytes())
  receipt['preflight']='Strict entire-payload JSON/material gate before persistence, plus exact requested DOI/cardinality/selected fields or public repository and explicit requested account-owner identity. No projection or body rewriting.'
  (dest/'body.json').write_bytes(body);(dest/'body.json').chmod(0o600)
  receipt.update(body_retained=True,body_path=str(dest/'body.json'))
 except Exception as exc:
  receipt['failure_code']=str(exc) if isinstance(exc,Withheld) else type(exc).__name__
 finally:
  if conn:conn.close()
  receipt.update(ended_at_utc=utc(),elapsed_seconds=round(time.monotonic()-start,3))
  (dest/'observation.json').write_text(json.dumps(receipt,indent=2)+'\n');(dest/'observation.json').chmod(0o600)
 print(json.dumps({k:receipt.get(k) for k in ['provider','name','status','received_bytes','body_sha256','body_retained','failure_code','elapsed_seconds']}),flush=True)

if __name__=='__main__':capture(sys.argv[1],sys.argv[2])
