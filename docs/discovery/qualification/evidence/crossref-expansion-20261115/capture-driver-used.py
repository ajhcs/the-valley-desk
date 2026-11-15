import datetime,json,subprocess,sys,time
from pathlib import Path
ROOT=Path('.discovery-work/source-qualification/crossref-expansion/root')
requests=json.loads((ROOT/'requests.json').read_text())['requests']
stopped=set();attempted=0
for request in requests:
 provider,name=request['provider'],request['name']
 if provider in stopped:continue
 if attempted:time.sleep(3.2)
 start=datetime.datetime.now(datetime.timezone.utc).isoformat()
 try:
  process=subprocess.run([sys.executable,str(ROOT/'capture.py'),provider,name],capture_output=True,text=True,timeout=25)
  if process.stdout:print(process.stdout.strip(),flush=True)
  if process.returncode:raise RuntimeError('capture-process-failed')
 except Exception as exc:
  dest=ROOT/'captures'/(provider+'-'+name);dest.mkdir(parents=True,exist_ok=True)
  path=dest/'observation.json'
  if not path.exists():path.write_text(json.dumps({'provider':provider,'name':name,'url':request['url'],'caller_started_at_utc':start,'caller_ended_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'body_retained':False,'failure_code':type(exc).__name__,'transport_observations':'unknown; caller timeout/process failure, no inferred HTTP status'},indent=2)+'\n')
  print(json.dumps({'provider':provider,'name':name,'caller_failure':type(exc).__name__}),flush=True)
  stopped.add(provider)
 attempted+=1
 path=ROOT/'captures'/(provider+'-'+name)/'observation.json'
 receipt=json.loads(path.read_text())
 if receipt.get('status') in [403,429] or receipt.get('response_headers',{}).get('x-ratelimit-remaining')=='0':stopped.add(provider)
print(json.dumps({'direct_attempts':attempted,'providers_stopped':sorted(stopped),'budget':10}),flush=True)
