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
test('actual sender uses one durable permit, retains only approved facts, and rejects replay before HTTP',()=>{
 const base='/workspace/build/builderbob/tvd-gl03-method-tests';mkdirSync(base,{recursive:true,mode:0o700});
 const folder=mkdtempSync(base+'/batch-');mkdirSync(folder+'/journal',{mode:0o700});
 try {
  const methods=Object.fromEntries(['scripts/discovery-directory-capture.py','scripts/discovery-directory-journal.mjs','scripts/discovery-directory-inspect.mjs'].map(p=>[p,hash(readFileSync(p))]));
  const plan={schemaVersion:'directory-acquisition-plan-v1',id:'GL03:test',gl02ManifestSha256:hash(readFileSync('docs/discovery/go-live/execution/GL02-exploration-manifest.json')),approvedScopeSha256:hash(canonical(methods)),limits:{totalRequests:5,perProviderRequests:5,queue:20,perCountyLeads:10,totalLeads:20,concurrentAttempts:1,resultsPerPage:5,activeMsTotal:16200000,activeMsPerCounty:1800000},pages:[page]};
  for(const [name,data] of Object.entries({'methods.json':methods,'plan.json':plan,'request-manifest.json':manifest}))writeFileSync(folder+'/'+name,JSON.stringify(data),{mode:0o600});
  const code=`import importlib.util,json,sys\nsys.dont_write_bytecode=True\ns=importlib.util.spec_from_file_location('capture','scripts/discovery-directory-capture.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nbody=json.dumps(${JSON.stringify(row)}).encode()\nbody=b'['+body+b']'\ncount=0\nclass Response:\n status=200\n def getheaders(self):return [('Content-Type','application/json;charset=utf-8'),('Content-Length',str(len(body)))]\n def getheader(self,k,d=None):return dict((a.lower(),b) for a,b in self.getheaders()).get(k.lower(),d)\n def read(self,n):return body[:n]\nclass Socket:\n def version(self):return 'TLSv1.3'\nclass Fake:\n def __init__(self,*a):self.sock=Socket()\n def connect(self):pass\n def request(self,*a,**kw):\n  global count\n  count+=1\n def getresponse(self):return Response()\n def close(self):pass\nm.Pinned=Fake\nm.socket.getaddrinfo=lambda *a,**kw:[(0,0,0,'',('1.1.1.1',443))]\nfirst=m.capture(sys.argv[1],'G01')\ntry:m.capture(sys.argv[1],'G01');raise AssertionError('replay sent')\nexcept m.Withheld:pass\nassert first['status']=='received',first\nassert count==1,count\nprint(json.dumps({'networkCalls':count,'status':first['status']}))`;
  // Literal JSON is parsed in Python, never evaluated as Python source.
  const python=code.replace(`json.dumps(${JSON.stringify(row)}).encode()`,`json.dumps(json.loads(${JSON.stringify(JSON.stringify(row))})).encode()`);
  const result=spawnSync('python3',['-c',python,folder],{encoding:'utf8',timeout:25000});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{networkCalls:1,status:'received'});
  const retained=JSON.parse(readFileSync(folder+'/G01.json','utf8'));assert.equal(retained.audit.rawBodyRetained,false);assert.equal(retained.packet.facts.length,1);
  assert.equal(retained.receipt.packetSha256,hash(canonical(retained.packet)));
  const store=new DirectoryAcquisitionStore(folder+'/journal',plan);try{assert.equal(store.progress().candidates.count,1);assert.equal(store.progress().attempts.length,1);}finally{store.close();}
 }finally{rmSync(folder,{recursive:true,force:true});}
});
