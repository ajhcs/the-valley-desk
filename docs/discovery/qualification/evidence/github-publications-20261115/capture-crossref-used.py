import datetime, hashlib, http.client, ipaddress, json, os, re, socket, ssl, sys, urllib.parse
from pathlib import Path

DOIS={'qsiprep':'10.1038/s41592-021-01185-5','captk-main':'10.1117/1.JMI.5.1.011018','captk-technical':'10.1007/978-3-030-46643-5_38'}
name=sys.argv[1]; doi=DOIS[name]; host='api.crossref.org'; cap=48000
fields=['DOI','title','type','author','published','URL','publisher','relation','license']
params=urllib.parse.urlencode({'filter':'doi:'+doi,'select':','.join(fields),'rows':'1'})
path='/v1/works?'+params
start=datetime.datetime.now(datetime.timezone.utc).isoformat()
ips=sorted({x[4][0] for x in socket.getaddrinfo(host,443,type=socket.SOCK_STREAM) if ipaddress.ip_address(x[4][0]).is_global})
if not ips: raise ValueError('no public IP')
ip=ips[0]
class Pinned(http.client.HTTPSConnection):
 def connect(self):
  sock=socket.create_connection((ip,443),timeout=12)
  self.sock=self._context.wrap_socket(sock,server_hostname=host)
c=Pinned(host,timeout=12,context=ssl.create_default_context())
c.request('GET',path,headers={'Accept':'application/json','Accept-Encoding':'identity','User-Agent':'ValleyDesk source qualification'})
r=c.getresponse(); status=r.status; content_type=r.getheader('Content-Type'); encoding=r.getheader('Content-Encoding'); b=r.read(cap+1); c.close()
if status!=200 or len(b)>cap or encoding not in (None,'identity'): raise ValueError(f'response withheld status={status} bytes={len(b)} encoding={encoding}')
j=json.loads(b.decode('utf-8')); message=j.get('message',{}); items=message.get('items',[])
if j.get('status')!='ok' or j.get('message-type')!='work-list' or len(items)!=1 or items[0].get('DOI','').casefold()!=doi.casefold(): raise ValueError('response shape or DOI mismatch; body withheld')
if any(k not in fields for k in items[0]):raise ValueError('unexpected item field; body withheld')
def inspect(x):
 if isinstance(x,dict):
  for k,v in x.items():
   if re.search(r'(?i)abstract|e.?mail|phone|contact',k):raise ValueError('disallowed key; body withheld')
   inspect(v)
 elif isinstance(x,list):
  for v in x: inspect(v)
 elif isinstance(x,str):
  if re.search(r'(?i)mailto:|[\w.+-]+@[\w.-]+\.[a-z]{2,}',x): raise ValueError('contact-like value; body withheld')
inspect(j)
end=datetime.datetime.now(datetime.timezone.utc).isoformat(); h=hashlib.sha256(b).hexdigest(); out=Path(__file__).parent
(out/(name+'-work-list.json')).write_bytes(b)
receipt={'start_utc':start,'end_utc':end,'url':'https://'+host+path,'ip':ip,'ip_global':True,'status':status,'content_type':content_type,'content_encoding':encoding,'bytes':len(b),'sha256':h,'doi':doi,'message_type':j['message-type'],'item_keys':sorted(items[0]),'abstract_or_contact_key_and_email_scan':'pass','preflight':'decoded full payload, exact DOI, allowed item keys, no redirects','transport':'standalone pinned HTTPS, no proxy or authentication'}
(out/(name+'-work-list.receipt.json')).write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
