from pathlib import Path
import hashlib
import json
import re

ROOT=Path(__file__).resolve().parents[1]
model=ROOT/'model/tvd-discovery.sysml'
scope_path=ROOT/'model-contract-scope.json'
assert hashlib.sha256(scope_path.read_bytes()).hexdigest()==(ROOT/'model-contract-scope.sha256').read_text().strip()
scope=json.loads(scope_path.read_text())
text=model.read_text().split('    package Future {')[0]
types={}
for match in re.finditer(r'item def (\w+)(?:\s*:>\s*(\w+))?\s*([;{])',text):
 body=''
 if match.group(3)=='{':
  start=match.end();depth=1;end=start
  while depth:
   if text[end]=='{':depth+=1
   if text[end]=='}':depth-=1
   end+=1
  body=text[start:end-1]
 types[match.group(1)]={'parent':match.group(2),'fields':dict(re.findall(r'(?:attribute|ref item|item)\s+(\w+)\s*:\s*(\w+)',body))}
findings=[]
for name,parent in scope['inheritance'].items():
 if types.get(name,{}).get('parent')!=parent:findings.append({'type':name,'expected_parent':parent})
for name,fields in scope['fields'].items():
 for field,kind in fields.items():
  if types.get(name,{}).get('fields',{}).get(field)!=kind:findings.append({'type':name,'field':field,'expected_type':kind})
report={'status':'pass' if not findings else 'fail','claim':'Selected source-record structure after native parser validation; not a replacement parser or behavioral proof.',
 'model_sha256':hashlib.sha256(model.read_bytes()).hexdigest(),'scope_sha256':hashlib.sha256(scope_path.read_bytes()).hexdigest(),
 'inheritance_checks':len(scope['inheritance']),'field_checks':sum(len(fields) for fields in scope['fields'].values()),'findings':findings}
(ROOT/'validation/record-scope.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
raise SystemExit(0 if not findings else 1)
