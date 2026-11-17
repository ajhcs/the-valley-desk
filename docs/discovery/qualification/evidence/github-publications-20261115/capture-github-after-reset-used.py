import datetime, hashlib, http.client, ipaddress, json, os, re, socket, ssl, subprocess, sys, time
from pathlib import Path
from urllib.parse import urlsplit, parse_qsl

ROOT = Path('.discovery-work/source-qualification/github-publications/root/github-after-reset')
TARGETS = {
 'qsiprep-native': ('PennLINC/qsiprep', 156589095, 'PennLINC', 61955309),
 'qsiprep-native-retry': ('PennLINC/qsiprep', 156589095, 'PennLINC', 61955309),
 'captk-native': ('CBICA/CaPTk', 128938343, 'CBICA', 35823615),
}
CAP = 48000
SENSITIVE_KEYS = {'email','emails','phone','telephone','password','passwd','secret','token','access_token','refresh_token','client_secret','private_key','authorization','cookie','set-cookie','credentials'}
CONTACT = re.compile(r'[A-Z0-9.!#$%&\'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+', re.I)
SECRET = re.compile(r'(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|sk-proj-[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)')
def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
class Pinned(http.client.HTTPSConnection):
 def __init__(self, host, address):
  super().__init__(host, 443, timeout=10, context=ssl.create_default_context()); self.address = address
 def connect(self):
  raw = socket.create_connection((self.address, 443), timeout=10)
  self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
def audit(v, expected_alias, path=()):
 if isinstance(v, dict):
  for k,w in v.items():
   if k.lower() in SENSITIVE_KEYS: raise ValueError('sensitive-field')
   audit(k, expected_alias, path+('<key>',)); audit(w, expected_alias, path+(k,))
 elif isinstance(v, list):
  for i,w in enumerate(v): audit(w, expected_alias, path+(str(i),))
 elif isinstance(v, str):
  safe_repository_ssh = path == ('ssh_url',) and v == 'git@github.com:'+expected_alias+'.git'
  if CONTACT.search(v) and not safe_repository_ssh: raise ValueError('contact-address')
  if SECRET.search(v): raise ValueError('credential-pattern')
  if v.startswith(('https://','http://')):
   u=urlsplit(v)
   if u.username or u.password: raise ValueError('url-credentials')
   if any(re.search(r'(?:token|password|secret|signature|api.?key|auth|credential)', k,re.I) for k,_ in parse_qsl(u.query)): raise ValueError('url-secret-query')
def run(name):
 alias, rid, owner, oid=TARGETS[name]; url='https://api.github.com/repos/'+alias; dest=ROOT/name
 dest.mkdir(mode=0o700,exist_ok=False)
 receipt={'schema_version':'github-public-repository-native-observation-v1','url':url,'method':'GET','started_at_utc':utc(),'transport':'standalone-public-IP-pinned-HTTPS','wp06_transport':False,'anonymous':True,'authentication_sent':False,'proxy_used':False,'redirects_followed':0,'byte_cap':CAP,'outer_total_deadline_seconds':25,'request_headers':{'Accept':'application/vnd.github+json','Accept-Encoding':'identity','X-GitHub-Api-Version':'2022-11-28','User-Agent':'TheValleyDesk-SourceQualification/0.1 (+https://thevalleydesk.org)'},'body_retained':False,'rights_scope':'Root-authorized two final fixed public nonpersonal repository metadata GETs after observed reset at2026-11-15T21:16:57Z; four direct GitHub GETs maximum across this investigation for bounded factual research assessment; no commercial redisplay or software/article body permission inferred.'}
 started=time.monotonic()
 try:
  addresses=sorted({r[4][0] for r in socket.getaddrinfo('api.github.com',443,type=socket.SOCK_STREAM)})
  if not addresses or not all(ipaddress.ip_address(a).is_global for a in addresses): raise ValueError('nonpublic-or-empty-dns')
  address=next((a for a in addresses if ipaddress.ip_address(a).version==4),addresses[0]); receipt.update(dns_public_addresses=addresses,selected_public_ip=address)
  conn=Pinned('api.github.com',address); conn.request('GET','/repos/'+alias,headers={**receipt['request_headers'],'Connection':'close'})
  response=conn.getresponse(); receipt['status']=response.status
  safe_names={'content-type','content-length','content-encoding','date','last-modified','etag','x-github-api-version-selected','x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-reset','x-ratelimit-resource','retry-after'}
  receipt['response_headers']={k.lower():v for k,v in response.getheaders() if k.lower() in safe_names}
  if conn.sock: receipt['tls_version']=conn.sock.version()
  body=response.read(CAP+1); receipt.update(received_bytes=len(body),body_sha256=hashlib.sha256(body).hexdigest(),response_complete=len(body)<=CAP); conn.close()
  if response.status!=200: raise ValueError('non-200-no-body-retained')
  if len(body)>CAP: raise ValueError('body-cap')
  if receipt['response_headers'].get('content-encoding','identity') not in ('identity',''): raise ValueError('encoding')
  if receipt['response_headers'].get('content-type','').split(';')[0].strip().lower()!='application/json': raise ValueError('mime')
  # Additional strict whole-payload gate runs on the unchanged bytes in memory.
  check = subprocess.run(['.discovery-work/wp12/run.sh','node','--import','tsx/esm','--input-type=module','-e',
   'import fs from "node:fs"; import {decodeDiscoveryMetadataJson} from "./src/ingest/discovery/metadata-preflight.ts"; decodeDiscoveryMetadataJson(fs.readFileSync(0), "github", () => {throw Error("metadata-preflight-rejected")}, "repository");'],input=body,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
  if check.returncode: raise ValueError('strict-metadata-preflight-rejected')
  obj=json.loads(body.decode('utf-8')); audit(obj, alias)
  if not isinstance(obj,dict) or obj.get('id')!=rid or obj.get('full_name')!=alias or obj.get('private') is not False: raise ValueError('repository-identity')
  org=obj.get('owner')
  if not isinstance(org,dict) or org.get('login')!=owner or org.get('id')!=oid or org.get('type')!='Organization': raise ValueError('owner-identity')
  if obj.get('url')!=url or obj.get('html_url')!='https://github.com/'+alias: raise ValueError('canonical-url')
  if obj.get('visibility')!='public': raise ValueError('visibility')
  if 'organization' in obj and (obj['organization'].get('id')!=oid or obj['organization'].get('type')!='Organization'): raise ValueError('organization-identity')
  target=dest/'body.json'; target.write_bytes(body); target.chmod(0o600)
  receipt.update(body_retained=True,body_path=str(target),top_level_shape='object',top_level_keys=sorted(obj),preflight='Decoded entire JSON recursively checked for contact-address patterns including JSON escapes, sensitive field names, credential patterns and URL credentials/query-secret keys; exact public repository and organization-owner identity matched. Only top-level ssh_url equal exact git@github.com:{expected_alias}.git exempted as canonical repository transport syntax; no general at-sign bypass. No private/user-profile/contributor/commit request made.',native_identity={'repository_id':rid,'full_name':alias,'owner_id':oid,'owner_type':'Organization'},method_revision='v3-after-observed-reset-with-strict-runtime-preflight',preflight_source_sha256=hashlib.sha256(Path('src/ingest/discovery/metadata-preflight.ts').read_bytes()).hexdigest(),root_scope_adjustment='At most4 direct GETs total: first QSIPrep discarded after method false-positive, second CaPTk rate-limited; final two fixed GETs only after reported reset with no authentication/proxy or deliberate IP change. No retries after renewed rate limit.')
 except Exception as exc:
  receipt['failure_code']=type(exc).__name__+':'+str(exc)[:180]
 receipt.update(ended_at_utc=utc(),elapsed_seconds=round(time.monotonic()-started,3))
 out=dest/'observation.json';out.write_text(json.dumps(receipt,indent=2)+'\n');out.chmod(0o600)
 print(json.dumps({k:receipt.get(k) for k in ['url','status','received_bytes','body_sha256','body_retained','body_path','failure_code','started_at_utc','ended_at_utc']}))
if __name__=='__main__': run(sys.argv[1])
