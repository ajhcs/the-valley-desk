from pathlib import Path
import copy
import hashlib
import json
import os
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
RUNTIME=Path('/home/builderbob/.codex/plugins/cache/cse-local/computable-systems-engineering/0.2.0-alpha.8')
sys.path.insert(0,str(RUNTIME))
from verifier.core import digest
mathematics=json.loads((ROOT/'validation/mathematics.json').read_text())
assert mathematics['status']=='pass'
assert mathematics['model_sha256']==hashlib.sha256((ROOT/'model/tvd-discovery.sysml').read_bytes()).hexdigest()
results=[]
for case in mathematics['cases']:
 path=ROOT/'proofs/smt'/(case['family']+'_'+case['case']+'.smt2')
 run=subprocess.run([str(ROOT/'.venv/bin/z3'),'-T:10','-smt2',str(path)],capture_output=True,text=True,timeout=15)
 results.append({'family':case['family'],'case':case['case'],'exit':run.returncode,
  'status':'pass' if run.returncode==0 and run.stdout.lstrip().startswith('unsat\n') else 'fail',
  'replayed_output_sha256':hashlib.sha256(run.stdout.encode()).hexdigest()})
 if results[-1]['status']!='pass': results[-1]['output']=run.stdout[:2000];results[-1]['stderr']=run.stderr[:1000]

env=os.environ.copy();env['CSE_SYSML_CACHE']=str(ROOT/'.cache/sysml')
launch=RUNTIME/'skills/develop-system-concept/scripts/cse.py'
controls=[]
finite=json.loads((ROOT/'proofs/finite-model.json').read_text())
missing=copy.deepcopy(finite);del missing['scenarios']['IndependentPaper']
missing_path=ROOT/'proofs/negative-omitted-independent-paper.json';missing_path.write_text(json.dumps(missing,indent=2)+'\n')
commands=[('omitted_independent_channel',['finite',str(missing_path),'--manifest',str(ROOT/'proofs/finite-manifest.json'),'--review','--json'])]
flow=json.loads((ROOT/'proofs/function-flow.json').read_text());broken=copy.deepcopy(flow)
broken['finite_model']['scenarios']['IndependentPaper']['steps']['IndependentPaper_Capture']['produces']=[]
broken['finite_model_sha256']=digest(broken['finite_model'])
broken_path=ROOT/'proofs/negative-missing-captured-data.json';broken_path.write_text(json.dumps(broken,indent=2)+'\n')
commands.append(('missing_captured_data',['analyze','functional-graph',str(broken_path)]))
for name,args in commands:
 run=subprocess.run(['python3',str(launch),*args],env=env,capture_output=True,text=True)
 try: outcome=json.loads(run.stdout)
 except ValueError: outcome={'status':'error','output':run.stdout[:1000]}
 (ROOT/'validation'/('negative-'+name+'.json')).write_text(json.dumps(outcome,indent=2)+'\n')
 controls.append({'case':name,'status':'detected' if run.returncode!=0 and outcome.get('status')=='fail' else 'missed','findings':outcome.get('findings',[])})
status='pass' if all(r['status']=='pass' for r in results) and all(c['status']=='detected' for c in controls) else 'fail'
report={'status':status,'model_sha256':mathematics['model_sha256'],'replay_engine':'Separate Z3 command-line invocation; the same solver implementation is trusted.',
 'smt_replays':results,'finite_negative_controls':controls}
(ROOT/'validation/proof-replay.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'status':status,'smt_replays':len(results),'finite_negative_controls':[{'case':c['case'],'status':c['status']} for c in controls],
 'failed_replays':[r for r in results if r['status']!='pass']}))
raise SystemExit(0 if status=='pass' else 1)
