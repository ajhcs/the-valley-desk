import json,subprocess,time
from pathlib import Path
base=Path('.discovery-work/pilot-expansion/root');requests=json.loads((base/'requests.json').read_text())['requests'];summary=[]
for request in sorted(requests,key=lambda r:(r['provider']!='github',r['name'])):
 try:
  result=subprocess.run(['python3',str(base/'capture-used.py'),request['provider'],request['name']],capture_output=True,text=True,timeout=25)
  item={'provider':request['provider'],'name':request['name'],'exit_code':result.returncode,'stdout':result.stdout.strip(),'stderr':result.stderr.strip()}
 except subprocess.TimeoutExpired:item={'provider':request['provider'],'name':request['name'],'outer_deadline_exceeded':True}
 summary.append(item);(base/'capture-summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(item),flush=True)
 if item.get('outer_deadline_exceeded') or item.get('exit_code') or (item.get('stdout') and json.loads(item['stdout']).get('status') in [403,429]):break
 time.sleep(3.4)
