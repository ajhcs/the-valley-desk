import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareRegionalSourceReadView,queryRegionalSourceReadView} from '../src/ingest/regional-read-view.ts';
import {createRegionalMcpHandler,invokeRegionalTool,REGIONAL_TOOLS} from '../scripts/agents/regional-mcp-adapter.mjs';
import {registerRegionalBrowserTools} from '../src/agents/regional-browser.ts';
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const now=new Date().toISOString();
const view=await prepareRegionalSourceReadView({inventory:await json('../fixtures/regional-source-inventory-v1.json'),existingInstitutions:(await json('../fixtures/coverage-pack-v1.json')).institutions,existingOfficialSources:(await json('../fixtures/official-source-registry-v1.json')).sources,asOf:now});
const readers={regional_source_inventory:async q=>queryRegionalSourceReadView(view,q,now),regional_discovery_candidates:async()=>{throw new Error('PRIVATE_SOURCE_ERROR_SENTINEL');},regional_discovery_record:async()=>{throw new Error('PRIVATE_SOURCE_ERROR_SENTINEL');}};
const origin='http://127.0.0.1:8181', handler=createRegionalMcpHandler({readers,origin});
const req=(body='{}',headers={},path='/mcp',method='POST')=>new Request(origin+path,{method,headers:{'Content-Type':'application/json',...headers},...(method==='POST'?{body}:{})});
test('MCP rejects host/origin/query/method, batches, malformed/oversized/invalid UTF-8 before calling readers',async()=>{
 for(const [request,status] of [[req('{}',{Host:'evil.invalid'}),403],[req('{}',{Origin:'https://evil.invalid'}),403],[req('{}',{},'/mcp?x=1'),403],[req('{}',{},'/mcp','GET'),405],[req('[]'),400],[req('{'),400],[req('x'.repeat(16385)),413],[req(new Uint8Array([255])),400]])assert.equal((await handler(request)).status,status);
});
test('strict tool queries and backend exceptions have fixed safe errors without source text',async()=>{
 for(const [name,args] of [['regional_source_inventory',{activate:true}],['regional_source_inventory',{limit:51}],['regional_discovery_candidates',{}],['regional_discovery_record',{snapshotId:'a'.repeat(64),recordId:'discovery-'+'a'.repeat(24)}]]){
  const result=await invokeRegionalTool(readers,name,args);assert.equal(result.isError,true);assert.equal(JSON.stringify(result).includes('PRIVATE_SOURCE_ERROR_SENTINEL'),false);
 }
 const result=await invokeRegionalTool(readers,'regional_source_inventory',{limit:2});assert.equal(result.results.length,2);assert.match(result.urlProjection,/omit all query/);
});
test('native browser registration has fixed same-origin endpoints, strict outputs, cancellation and disposal',async()=>{
 const previous=globalThis.fetch, registered=new Map();let lastInit,fetches=0;
 const doc={defaultView:{isSecureContext:true},modelContext:{registerTool:async(tool,{signal})=>{registered.set(tool.name,tool);signal.addEventListener('abort',()=>registered.delete(tool.name),{once:true});}}};
 globalThis.fetch=async(url,init)=>{
  fetches++;lastInit=init;
  if(url==='/api/agent/tools')return Response.json({tools:REGIONAL_TOOLS});
  if(init.signal.aborted)throw new DOMException('Cancelled','AbortError');
  assert.equal(url,'/api/agent/regional-source-inventory');return Response.json(queryRegionalSourceReadView(view,JSON.parse(init.body),now));
 };
 try{
  const first=registerRegionalBrowserTools(doc),second=registerRegionalBrowserTools(doc);assert.equal(first,second);
  const state=await first;assert.equal(state.registered,true);assert.equal(registered.size,3);
  const tool=registered.get('regional_source_inventory');const result=await tool.execute({limit:2},{signal:new AbortController().signal});
  assert.equal(result.results.length,2);assert.equal(lastInit.credentials,'omit');assert.equal(lastInit.redirect,'error');assert.ok(lastInit.signal);
  const controller=new AbortController();controller.abort();const cancelled=await tool.execute({}, {signal:controller.signal});assert.equal(cancelled.error.code,'cancelled');
  const large=await tool.execute({junk:'x'.repeat(17000)});assert.equal(large.error.code,'invalid-query');
  state.dispose();assert.equal(registered.size,0);assert.ok(fetches>=3);
 }finally{globalThis.fetch=previous;}
});
test('malformed metadata registration disposes already registered tools',async()=>{
 const previous=globalThis.fetch,registered=new Map();
 const metadata=structuredClone(REGIONAL_TOOLS);metadata[1].inputSchema.additionalProperties=true;
 const doc={defaultView:{isSecureContext:true},modelContext:{registerTool:async(tool,{signal})=>{registered.set(tool.name,tool);signal.addEventListener('abort',()=>registered.delete(tool.name),{once:true});}}};
 globalThis.fetch=async()=>Response.json({tools:metadata});
 try{assert.equal((await registerRegionalBrowserTools(doc)).registered,false);assert.equal(registered.size,0);}finally{globalThis.fetch=previous;}
});
test('Ops browser tools reuse same-origin session and synchronous lifecycle abort permits clean re-registration',async()=>{
 const previous=globalThis.fetch,registered=new Map(),requests=[];
 const doc={defaultView:{isSecureContext:true},modelContext:{registerTool:async(tool,{signal})=>{registered.set(tool.name,tool);signal.addEventListener('abort',()=>registered.delete(tool.name),{once:true});}}};
 globalThis.fetch=async(url,init)=>{requests.push({url,credentials:init.credentials,cache:init.cache});if(url==='/ops/api/agent/tools')return Response.json({tools:REGIONAL_TOOLS});assert.equal(url,'/ops/api/agent/regional-source-inventory');return Response.json(queryRegionalSourceReadView(view,JSON.parse(init.body),now));};
 try{
  const lifecycle=new AbortController(),state=await registerRegionalBrowserTools(doc,'ops',lifecycle.signal);assert.equal(state.registered,true);
  await registered.get('regional_source_inventory').execute({limit:1});assert.ok(requests.every(row=>row.url.startsWith('/ops/api/agent/')&&row.credentials==='same-origin'&&row.cache==='no-store'));
  lifecycle.abort();assert.equal(registered.size,0);
  const second=await registerRegionalBrowserTools(doc,'ops');assert.equal(registered.size,3);state.dispose();assert.equal(registered.size,3);second.dispose();assert.equal(registered.size,0);
 }finally{globalThis.fetch=previous;}
});
test('Ops lifecycle aborted during metadata read leaves no tools and no cached session',async()=>{
 const previous=globalThis.fetch,registered=new Map();let release;
 const doc={defaultView:{isSecureContext:true},modelContext:{registerTool:async(tool,{signal})=>{if(signal.aborted)throw new DOMException('Cancelled','AbortError');registered.set(tool.name,tool);signal.addEventListener('abort',()=>registered.delete(tool.name),{once:true});}}};
 globalThis.fetch=()=>new Promise(resolve=>{release=resolve;});
 try{const lifecycle=new AbortController(),pending=registerRegionalBrowserTools(doc,'ops',lifecycle.signal);lifecycle.abort();release(Response.json({tools:REGIONAL_TOOLS}));assert.equal((await pending).registered,false);assert.equal(registered.size,0);
 globalThis.fetch=async()=>Response.json({tools:REGIONAL_TOOLS});const next=await registerRegionalBrowserTools(doc,'ops');assert.equal(next.registered,true);next.dispose();}finally{globalThis.fetch=previous;}
});
test('already-aborted Ops lifecycle leaves no cached registration and permits fresh entry',async()=>{
 const previous=globalThis.fetch,registered=new Map();let reads=0;
 const doc={defaultView:{isSecureContext:true},modelContext:{registerTool:async(tool,{signal})=>{registered.set(tool.name,tool);signal.addEventListener('abort',()=>registered.delete(tool.name),{once:true});}}};
 globalThis.fetch=async()=>{reads++;return Response.json({tools:REGIONAL_TOOLS});};
 try{const aborted=new AbortController();aborted.abort();const cancelled=await registerRegionalBrowserTools(doc,'ops',aborted.signal);assert.equal(cancelled.supported,true);assert.equal(cancelled.registered,false);assert.equal(reads,0);
 const next=await registerRegionalBrowserTools(doc,'ops',new AbortController().signal);assert.equal(next.registered,true);assert.equal(registered.size,3);next.dispose();assert.equal(registered.size,0);}finally{globalThis.fetch=previous;}
});
