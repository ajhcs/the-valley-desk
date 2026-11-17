import datetime,hashlib,http.client,ipaddress,json,os,socket,ssl,sys,time
from pathlib import Path
from urllib.parse import urlsplit
ROOT=Path('.discovery-work/source-qualification/root')
UA='TheValleyDesk-SourceQualification/0.1 (+https://thevalleydesk.org)'
ALLOWED={
 'openmrs-robots':('https://talk.openmrs.org/robots.txt','policy',65536),
 'openmrs-tos':('https://talk.openmrs.org/tos','policy',262144),
 'openmrs-privacy':('https://talk.openmrs.org/privacy','policy',262144),
 'openmrs-basic':('https://talk.openmrs.org/site/basic-info.json','inspect',65536),
 'openmrs-about':('https://talk.openmrs.org/about.json','inspect',65536),
 'ror-robots':('https://api.ror.org/robots.txt','policy',65536),
 'ror-penn':('https://api.ror.org/v2/organizations/00b30xv10','cc0',65536),
 'ror-chop':('https://api.ror.org/v2/organizations/01z7r7q48','cc0',65536),
}
def sha(data):return hashlib.sha256(data).hexdigest()
class Pinned(http.client.HTTPSConnection):
 def __init__(self,host,address):super().__init__(host,443,timeout=12,context=ssl.create_default_context());self.address=address
 def connect(self):
  raw=socket.create_connection((self.address,443),timeout=12)
  self.sock=self._context.wrap_socket(raw,server_hostname=self.host)
def main(name):
 url,mode,limit=ALLOWED[name];u=urlsplit(url);assert u.scheme=='https' and not(u.username or u.password or u.fragment or u.query)
 dest=ROOT/name;dest.mkdir(mode=0o700);start=datetime.datetime.now(datetime.timezone.utc).isoformat();began=time.monotonic()
 record={'id':name,'url':url,'started_at_utc':start,'method':'GET','user_agent':UA,'anonymous':True,'redirects_followed':0,'byte_cap':limit,'body_retained':False,'mode':mode,'transport':'standalone-pinned-native-HTTPS','wp06_transport':False,'proxy_used':False}
 try:
  addresses=sorted({x[4][0] for x in socket.getaddrinfo(u.hostname,443,type=socket.SOCK_STREAM)})
  if not addresses or not all(ipaddress.ip_address(x).is_global for x in addresses):raise ValueError('nonpublic-or-empty-dns')
  ipv4=[x for x in addresses if ipaddress.ip_address(x).version==4];address=(ipv4 or addresses)[0]
  record.update(dns_public_addresses=addresses,selected_public_ip=address)
  conn=Pinned(u.hostname,address);conn.request('GET',u.path,headers={'User-Agent':UA,'Accept':'application/json,text/plain,text/html;q=0.8','Accept-Encoding':'identity','Connection':'close'})
  response=conn.getresponse();record.update(status=response.status,tls_version=conn.sock.version() if conn.sock else None)
  safe={k.lower():v for k,v in response.getheaders() if k.lower() in ['content-type','content-length','content-encoding','date','last-modified','etag','discourse-version','retry-after','x-ratelimit-limit','x-ratelimit-remaining']};record['response_headers']=safe
  location=response.getheader('Location')
  if location:record['redirect_location_without_query']=location.split('?')[0].split('#')[0]
  body=response.read(limit+1);record.update(received_bytes=len(body),body_sha256=sha(body),response_complete=len(body)<=limit)
  conn.close()
  if len(body)>limit:raise ValueError('body-cap')
  if safe.get('content-encoding','identity') not in ['identity','']:raise ValueError('unsupported-content-encoding')
  if response.status==200 and mode in ['policy','cc0']:
   if mode=='cc0':
    expected_id,expected_name={'ror-penn':('00b30xv10','University of Pennsylvania'),'ror-chop':('01z7r7q48',"Children's Hospital of Philadelphia")}[name]
    obj=json.loads(body);assert obj.get('id')=='https://ror.org/'+expected_id and obj.get('status')=='active'
    assert isinstance(obj.get('names'),list) and any(n.get('value')==expected_name for n in obj['names'])
    assert set(obj)<=set(['admin','domains','established','external_ids','id','links','locations','names','relationships','status','types'])
    def private_fields(value):
     if isinstance(value,dict):
      for k,v in value.items():
       assert not any(term in k.lower() for term in ['email','phone','password','secret','token','private','cookie'])
       private_fields(v)
     elif isinstance(value,list):
      for v in value:private_fields(v)
    private_fields(obj)
    record['rights_basis']='ROR official terms: all IDs and metadata CC0; no linked-page/body rights inferred.'
    record['preflight']='Exact organization identity and bounded top-level key/private-key checks; full schema and native WP13 parser qualification pending. No person labels or authority inferred.'
   target=dest/('body.json' if mode=='cc0' else 'body.txt');target.write_bytes(body);target.chmod(0o600);record['body_retained']=True;record['body_path']=str(target)
  elif response.status==200 and mode=='inspect':
   obj=json.loads(body);record['top_level_keys']=sorted(obj) if isinstance(obj,dict) else []
   record['safe_schema']={k:type(v).__name__ for k,v in obj.items()} if isinstance(obj,dict) else {}
   if name=='openmrs-basic':record['public_title']=obj.get('title') if obj.get('title')=='OpenMRS Talk' else None
   record['preflight']='In-memory anonymous metadata inspection only; raw bytes discarded, no raw sample retained.'
 except Exception as exc:record['failure']=type(exc).__name__+':'+str(exc)[:240]
 record['ended_at_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();record['elapsed_seconds']=round(time.monotonic()-began,3)
 path=dest/'receipt.json';path.write_text(json.dumps(record,indent=2)+'\n');path.chmod(0o600)
 print(json.dumps({k:record.get(k) for k in ['id','status','received_bytes','body_retained','failure','elapsed_seconds']}))
if __name__=='__main__':main(sys.argv[1])
