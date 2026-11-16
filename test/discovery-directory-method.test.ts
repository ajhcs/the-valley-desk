import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inspect} from '../scripts/discovery-directory-inspect.mjs';
import {canonical} from '../src/ingest/discovery/directory-acquisition';
import {DirectoryAcquisitionStore} from '../scripts/discovery-directory-acquire.mjs';
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const manifest=JSON.parse(readFileSync('docs/discovery/go-live/execution/GL03-request-manifest.json','utf8'));
const definition=manifest.requests.find((r:{id:string})=>r.id==='G01');
const request={method:'GET',url:definition.url,accept:'application/vnd.github+json',encoding:'identity',userAgent:'The-Valley-Desk-Discovery-GL03',githubApiVersion:'2022-11-28',maxBytes:48000,timeoutMs:25000,redirects:0};
const page={id:'G01',chainId:'GL03:G01',page:1,parentPageId:null,provider:'github',route:'account',county:'Camden',sourceId:'GL03:github',scopeId:'GL03:G01',installation:'github-public',qualificationSha256:'a'.repeat(64),parserRevision:'GL03:parser:1',parserSha256:hash(readFileSync('scripts/discovery-directory-inspect.mjs')),reason:'Synthetic method test',...request,requestSha256:hash(canonical(request))};
const row={id:123456,owner:{id:55422467,type:'User',login:'akibzaman'},name:'quiet',full_name:'akibzaman/quiet',html_url:'https://github.com/akibzaman/quiet',private:false,archived:true,fork:true,disabled:false,created_at:'2020-01-01T00:00:00Z',description:'Health informatics software'};
const run=(value:unknown,def=definition,p=page,link:string|null=null)=>inspect(Buffer.from(JSON.stringify(value)),def,p,{requestSha256:p.requestSha256},'d'.repeat(64),link,'2026-11-16',p.parserSha256,manifest.github_preflight_key_census);

test('factual inspector preserves quiet User/fork/archive without a paper and distinguishes body/projection/packet',()=>{
 const result=run([row]);assert.equal(result.packet.facts[0].ownerType,'User');assert.equal(result.packet.facts[0].fork,true);
 assert.equal(result.packet.facts[0].archived,true);assert.equal(result.packet.publicationAuthorized,false);
 assert.deepEqual(result.packet.facts[0].frontier.source.lead.relatedAccounts,[]);
 assert.equal(result.packet.facts[0].pointers.nativeId,'/0/id');assert.equal(result.summary.rawBodyRetained,false);
 assert.notEqual(result.packet.nativeBodySha256,result.packet.projectionSha256);
 assert.equal(result.packet.projectionSha256,hash(canonical(result.packet.facts)));
});
test('whole payload privacy and field census run before projection, including discarded nested fields',()=>{
 for(const value of [{...row,description:'Write team@example.org'},{...row,homepage:{nested:'hidden body'}},{...row,license:{name:{nested:'hidden'}}},{...row,unknown_field:'extra'},{...row,owner:{...row.owner,email:'hidden@example.org'}}])assert.throws(()=>run([value]));
 assert.throws(()=>run([{...row,id:1.01}]));assert.throws(()=>run([row,row]));
 assert.throws(()=>run([{...row,owner:{...row.owner,id:99}}]));
});
test('continuation is exact, capped and never sends the reported next URL',()=>{
 const u=new URL(definition.url);u.searchParams.set('page','2');
 const result=run([row],definition,page,`<${u.href}>; rel="next"`);
 assert.equal(result.packet.continuation,'more');assert.equal(result.packet.nextRequestSha256,hash(canonical({...request,url:u.href})));
 assert.throws(()=>run([row],definition,page,'<https://evil.example/x>; rel="next"'));
 assert.throws(()=>run([row],definition,page,`<${u.href}&access_token=synthetic>; rel="next"`));
 const d=manifest.requests.find((r:{id:string})=>r.id==='G03');
 const result2=run({total_count:100,incomplete_results:true,items:[row]},d,{...page,url:d.url});
 assert.equal(result2.packet.continuation,'unknown');assert.equal(result2.packet.providerIncomplete,true);
});
test('separately qualified opaque continuation never retains or follows header values',()=>{
 const def={...definition,continuation_policy:'opaque_unknown',maximum_items:1,parameters:{...definition.parameters,per_page:'1'}};
 for(const header of [null,'<https://unexpected.example/path?access_token=synthetic>; rel=next','arbitrary malformed header']){
  const result=run([row],def,page,header);
  assert.equal(result.packet.continuation,'unknown');assert.equal(result.packet.nextRequestSha256,null);
  assert.ok(!JSON.stringify(result).includes('unexpected.example'));assert.ok(!JSON.stringify(result).includes('synthetic'));
 }
});
test('independent publication carries a year without asserting local affiliation or repository relation',()=>{
 const d=manifest.requests.find((r:{id:string})=>r.id==='C01');
 const value={status:'ok','message-type':'work-list','message-version':'1.0.0',message:{facets:{},'total-results':50,'items-per-page':5,query:{'start-index':0,'search-terms':'Rutgers Camden sleep'},items:[{DOI:'10.1234/example',title:['Sleep research'],type:'journal-article',URL:'https://doi.org/10.1234/example',published:{'date-parts':[[2020]]}}]}};
 const result=run(value,d,{...page,provider:'crossref',url:d.url,accept:'application/json',githubApiVersion:null});
 assert.equal(result.packet.facts[0].ownerType,null);assert.equal(result.packet.facts[0].frontier.source.lead.sourceDates[0].date.precision,'year');
 assert.equal(result.packet.facts[0].frontier.publicationAuthorized,false);
 assert.equal(result.packet.continuation,'more');assert.ok(result.packet.nextRequestSha256);
 assert.throws(()=>run({...value,message:{...value.message,items:[{...value.message.items[0],abstract:'Unpermitted body'}]}},d,{...page,provider:'crossref'}));
 for(const message of [{...value.message,query:{...value.message.query,'search-terms':'unrelated'}},{...value.message,query:{...value.message.query,'start-index':50}},{...value.message,'total-results':0},{...value.message,'items-per-page':100},{...value.message,items:[{...value.message.items[0],type:'dataset'}]}])assert.throws(()=>run({...value,message},d,{...page,provider:'crossref',url:d.url}));

});
for(const opaque of [false,true])test(`actual sender retains approved facts and rejects replay (${opaque?'opaque duplicate Link':'strict Link'})`,()=>{
 const base='/workspace/build/builderbob/tvd-gl03-method-tests';mkdirSync(base,{recursive:true,mode:0o700});
 const folder=mkdtempSync(base+'/batch-');mkdirSync(folder+'/journal',{mode:0o700});
 try {
  const fixtureManifest=structuredClone(manifest);if(opaque)fixtureManifest.requests[0].continuation_policy='opaque_unknown';
  const manifestBytes=opaque?Buffer.from(JSON.stringify(fixtureManifest)):readFileSync('docs/discovery/go-live/execution/GL03-request-manifest.json');
  const methods=Object.fromEntries(['scripts/discovery-directory-capture.py','scripts/discovery-directory-journal.mjs','scripts/discovery-directory-inspect.mjs','docs/discovery/go-live/execution/GL03-request-manifest.json','docs/discovery/go-live/execution/GL03-source-preflight.md'].map(p=>[p,hash(readFileSync(p))]));
  methods['docs/discovery/go-live/execution/GL03-request-manifest.json']=hash(manifestBytes);
  const plan={schemaVersion:'directory-acquisition-plan-v1',id:'GL03:test',gl02ManifestSha256:hash(readFileSync('docs/discovery/go-live/execution/GL02-exploration-manifest.json')),approvedScopeSha256:hash(canonical(methods)),limits:{totalRequests:5,perProviderRequests:5,queue:20,perCountyLeads:10,totalLeads:20,concurrentAttempts:1,resultsPerPage:5,activeMsTotal:16200000,activeMsPerCounty:1800000},pages:[page]};
  for(const [name,data] of Object.entries({'methods.json':methods,'plan.json':plan,'request-manifest.json':manifest}))writeFileSync(folder+'/'+name,JSON.stringify(data),{mode:0o600});
  writeFileSync(folder+'/request-manifest.json',manifestBytes,{mode:0o600});writeFileSync(folder+'/preflight.md',readFileSync('docs/discovery/go-live/execution/GL03-source-preflight.md'),{mode:0o600});
  const code=`import importlib.util,json,sys\nsys.dont_write_bytecode=True\ns=importlib.util.spec_from_file_location('capture','scripts/discovery-directory-capture.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nopaque=sys.argv[2]=='opaque'\nif opaque:\n original_reader=m.Path.read_bytes\n frozen_manifest=original_reader(m.Path(sys.argv[1])/'request-manifest.json')\n m.Path.read_bytes=lambda p:frozen_manifest if str(p)=='docs/discovery/go-live/execution/GL03-request-manifest.json' else original_reader(p)\nbody=json.dumps(${JSON.stringify(row)}).encode()\nbody=b'['+body+b']'\ncount=0\nclass Response:\n status=200\n def getheaders(self):return [('Content-Type','application/json;charset=utf-8'),('Content-Length',str(len(body)))]+([('Link','unsafe value one'),('Link','unsafe value two')] if opaque else [])\n def getheader(self,k,d=None):\n  if opaque and k.lower()=='link':raise AssertionError('opaque Link read')\n  return dict((a.lower(),b) for a,b in self.getheaders()).get(k.lower(),d)\n def read(self,n):return body[:n]\nclass Socket:\n def version(self):return 'TLSv1.3'\nclass Fake:\n def __init__(self,*a):self.sock=Socket()\n def connect(self):pass\n def request(self,*a,**kw):\n  global count\n  count+=1\n def getresponse(self):return Response()\n def close(self):pass\nm.Pinned=Fake\nm.socket.getaddrinfo=lambda *a,**kw:[(0,0,0,'',('1.1.1.1',443))]\nfirst=m.capture(sys.argv[1],'G01')\ntry:m.capture(sys.argv[1],'G01');raise AssertionError('replay sent')\nexcept m.Withheld:pass\nassert first['status']=='received',first\nassert count==1,count\nfrom pathlib import Path\nroot=Path(sys.argv[1]);original_manifest=(root/'request-manifest.json').read_bytes();changed=json.loads(original_manifest);changed['requests'][0]['continuation_policy']='opaque_unknown';(root/'request-manifest.json').write_text(json.dumps(changed))\ntry:m.capture(sys.argv[1],'G01');raise AssertionError('copied manifest drift')\nexcept m.Withheld as e:assert str(e)=='copied-scope-drift',str(e)\n(root/'request-manifest.json').write_bytes(original_manifest)\noriginal_preflight=(root/'preflight.md').read_bytes();(root/'preflight.md').write_bytes(original_preflight+b'changed')\ntry:m.capture(sys.argv[1],'G01');raise AssertionError('copied preflight drift')\nexcept m.Withheld as e:assert str(e)=='copied-scope-drift',str(e)\nassert count==1,count\nprint(json.dumps({'networkCalls':count,'status':first['status']}))`;
  // Literal JSON is parsed in Python, never evaluated as Python source.
  const python=code.replace(`json.dumps(${JSON.stringify(row)}).encode()`,`json.dumps(json.loads(${JSON.stringify(JSON.stringify(row))})).encode()`);
  const result=spawnSync('python3',['-c',python,folder,opaque?'opaque':'strict'],{encoding:'utf8',timeout:25000});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{networkCalls:1,status:'received'});
  const retained=JSON.parse(readFileSync(folder+'/G01.json','utf8'));assert.equal(retained.audit.rawBodyRetained,false);assert.equal(retained.packet.facts.length,1);
  assert.equal(retained.receipt.packetSha256,hash(canonical(retained.packet)));
  const store=new DirectoryAcquisitionStore(folder+'/journal',plan);try{assert.equal(store.progress().candidates.count,1);assert.equal(store.progress().attempts.length,1);}finally{store.close();}
 }finally{rmSync(folder,{recursive:true,force:true});}
});
test('supplemental sender respects a prior provider refusal before requesting any new permit',()=>{
 const base='/workspace/build/builderbob/tvd-gl03-method-tests';mkdirSync(base,{recursive:true,mode:0o700});
 const folder=mkdtempSync(base+'/hold-');
 try{
  const prior=JSON.stringify({receipt:{status:'refused'}});writeFileSync(folder+'/prior.json',prior,{mode:0o600});
  const copied=JSON.stringify({...manifest,prior_receipts:[{provider:'github',path:folder+'/prior.json',sha256:hash(prior)}]});
  const methods={'docs/discovery/go-live/execution/GL03-request-manifest.json':hash(copied),'docs/discovery/go-live/execution/GL03-source-preflight.md':hash('preflight')};
  // In this isolated test, intercept reading the two source files as reviewed fixture bytes.
  writeFileSync(folder+'/methods.json',JSON.stringify(methods),{mode:0o600});
  writeFileSync(folder+'/plan.json',JSON.stringify({approvedScopeSha256:hash(canonical(methods)),pages:[page]}),{mode:0o600});
  writeFileSync(folder+'/request-manifest.json',copied,{mode:0o600});writeFileSync(folder+'/preflight.md','preflight',{mode:0o600});
  const code="import importlib.util,sys\nsys.dont_write_bytecode=True\ns=importlib.util.spec_from_file_location('capture','scripts/discovery-directory-capture.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ndef deny(*a,**kw):raise AssertionError('permit or HTTP attempted')\nm.node=deny;m.socket.getaddrinfo=deny\noriginal=m.Path.read_bytes\ndef source_bytes(p):\n if str(p)=='docs/discovery/go-live/execution/GL03-request-manifest.json':return original(m.Path(sys.argv[1])/'request-manifest.json')\n if str(p)=='docs/discovery/go-live/execution/GL03-source-preflight.md':return b'preflight'\n return original(p)\nm.Path.read_bytes=source_bytes\ntry:m.capture(sys.argv[1],'G01');raise AssertionError('hold bypass')\nexcept m.Withheld as e:assert str(e)=='prior-provider-held'\n";
  const result=spawnSync('python3',['-c',code,folder],{encoding:'utf8',timeout:5000});assert.equal(result.status,0,result.stderr);
 }finally{rmSync(folder,{recursive:true,force:true});}
});
