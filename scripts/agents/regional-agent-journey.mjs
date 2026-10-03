import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {chromium} from '/workspace/cache/builderbob/global-tools/npm/lib/node_modules/playwright/index.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {startRegionalLocalPreview} from './regional-local-preview.mjs';
const [output,capturesPath,publicationSnapshotPath,mode]=process.argv.slice(2);
if(!output||!capturesPath||!publicationSnapshotPath)throw new Error('Supply evidence directory, retained capture path and retained PubMed snapshot path.');
await mkdir(output,{recursive:true});
const report={checks:[],screenshots:[],protocol:'2025-11-25',paidCalls:0,sourceRequests:0,productionCollectors:0,liveChatGptAccountJourneyPerformed:false,current2026ProtocolClaimed:false};
// HTTPS browser origin is fulfilled exclusively from an ephemeral local Vite/Worker adapter.
// Ephemeral signed Access JWTs test the released guard; this is not a live owner login.
const nativeToolNames=['regional_source_inventory','regional_discovery_candidates','regional_discovery_record'];
// React development remounting may briefly expose registrations that are about
// to be aborted. Wait through render frames and require exact names, not count.
async function waitForNativeRegistration(page) {
 await page.waitForFunction(async names=>{
  if(typeof document.modelContext?.getTools!=='function')return false;
  const exact=tools=>tools.length===names.length&&names.every(name=>tools.filter(tool=>tool.name===name).length===1);
  if(!exact(await document.modelContext.getTools()))return false;
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  return exact(await document.modelContext.getTools());
 },nativeToolNames,{timeout:10000});
}
// Only the local Vite development handshake is mocked. All other sockets close;
// no WebSocket connects to the production hostname or a source publisher.
function localHmrHandshake(socket,origin) {
 const url=new URL(socket.url());
 if(url.host===new URL(origin).host&&url.pathname==='/'&&url.searchParams.has('token'))socket.send(JSON.stringify({type:'connected'}));
 else socket.close();
}
async function executeNativeTool(page,name,args) {
 return page.evaluate(async({name,args})=>{
  const deadline=performance.now()+10000;let matching;
  // Poll discovery only: a remount can occur between the outer readiness check
  // and this evaluation. An execution itself is attempted exactly once.
  for(;;){
   matching=(await document.modelContext.getTools()).filter(tool=>tool.name===name);
   if(matching.length===1)break;
   if(matching.length>1||performance.now()>=deadline)throw new Error('Expected one current native tool: '+name);
   await new Promise(resolve=>requestAnimationFrame(resolve));
  }
  // Acquire the current RegisteredTool inside the same evaluation as execution.
  // Never retry an execution or suppress its failure.
  const result=await document.modelContext.executeTool(matching[0],JSON.stringify(args));
  return typeof result==='string'?JSON.parse(result):result;
 },{name,args});
}
async function privateOpsJourney(output) {
 const {createServer}=await import('vite');const {readFile}=await import('node:fs/promises');const {fileURLToPath}=await import('node:url');
 const {handleOpsRequest}=await import('../../src/ingest/ops-access.ts');
 const {accessJwtFixture}=await import('../../test/helpers/ops-jwt-fixture.ts');
 const {verifiedOpsJwtIdentity}=await import('../../src/ingest/ops-jwt.ts');
 const fixture=await accessJwtFixture(),token=await fixture.sign(),originalFetch=globalThis.fetch;let local,server,browser;
 const root=fileURLToPath(new URL('../../',import.meta.url)),publicOrigin='https://thevalleydesk.org';
 const evidence={checks:[],browserRequests:[],syntheticAccessIdentity:true,syntheticSignedJwt:true,syntheticDevelopmentHmr:true,blockedResourceRequests:[],liveAccessVerified:false,sourceRequests:0,modelCalls:0,productionMutations:0};
 // Ephemeral public keys and loopback only. Never fetch live Access keys or sources.
 globalThis.fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));
  if(url.href===fixture.issuer+'/cdn-cgi/access/certs')return fixture.fetcher(input,init);
  if(local&&url.origin===local)return originalFetch(input,init);
  throw new Error('unexpected-test-network');
 };
 try {
 assert.equal(await verifiedOpsJwtIdentity(new Request('https://thevalleydesk.org/ops',{headers:{'cf-access-jwt-assertion':token}}),fixture.config),'clyons@ajhcs.org');
 server=await createServer({root,configFile:false,server:{host:'127.0.0.1',port:0,strictPort:true,hmr:false},plugins:[(await import('@vitejs/plugin-react')).default(),(await import('@tailwindcss/vite')).default(),{
 name:'private-ops-worker-contract',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  const path=req.url.split('?')[0];if(path!=='/ops'&&!path.startsWith('/ops/api/'))return next();
  try {
   const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):value);
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
   const hasSession=(req.headers.cookie??'').split(';').some(row=>row.trim()==='tvd_local_ops=retained-contract-test');
   if(hasSession)headers.set('cf-access-jwt-assertion',token);
   const request=new Request(publicOrigin+req.url,{method:req.method,headers,...(req.method==='POST'?{body}: {})});
   let response;
   if(path.startsWith('/ops/api/')&&!path.startsWith('/ops/api/agent/')&&hasSession)response=Response.json({}); // unrelated status/policy reads use synthetic empty state
   else response=await handleOpsRequest(request,fixture.config,undefined,publicOrigin,async()=>vite.transformIndexHtml('/ops',await readFile(root+'/index.html','utf8')));
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  } catch {res.writeHead(500);res.end('Local contract unavailable');}
 });}}]});
 await server.listen();local='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await chromium.launch({headless:true,executablePath:'/workspace/cache/builderbob/global-tools/browsers/chromium-1243/chrome-linux64/chrome',args:['--enable-features=WebMCP','--enable-blink-features=ModelContext']});
  evidence.browserVersion=browser.version();const context=await browser.newContext();
  await context.routeWebSocket('**/*',socket=>localHmrHandshake(socket,publicOrigin));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(url.origin!==publicOrigin){evidence.blockedResourceRequests.push({origin:url.origin,path:url.pathname});return route.abort();}
   const evidenceRow=url.pathname.startsWith('/ops/api/agent/')?{method:request.method(),path:url.pathname,origin:request.headers().origin??null,sessionCookieSent:(request.headers().cookie??'').includes('tvd_local_ops=retained-contract-test')}:null;
   if(evidenceRow)evidence.browserRequests.push(evidenceRow);
   const headers=await request.allHeaders();delete headers.host;
   const response=await fetch(local+url.pathname+url.search,{method:request.method(),headers,...(request.postDataBuffer()?{body:request.postDataBuffer()}:{}),redirect:'manual'});
   if(evidenceRow)evidenceRow.status=response.status;
   await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  });
  const page=await context.newPage(),errors=[],consoleErrors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'){let location;try{const url=new URL(message.location().url);location={origin:url.origin,path:url.pathname};}catch{}consoleErrors.push({text:message.text(),...location});}});
  await page.goto(publicOrigin+'/ops');assert.equal(await page.locator('body').innerText(),' {"error":"not_found"}'.trim());evidence.checks.push('Unauthenticated Ops shell denied');
  await context.addCookies([{name:'tvd_local_ops',value:'retained-contract-test',url:publicOrigin,httpOnly:true,secure:true,sameSite:'Strict'}]);
  await page.goto(publicOrigin);await page.waitForFunction(()=>document.querySelector('#root')?.textContent?.length>100);
  assert.equal((await page.evaluate(async()=>await document.modelContext.getTools())).length,0);evidence.checks.push('Public homepage registers no tools');
  await page.evaluate(()=>{history.pushState(null,'','/ops');window.dispatchEvent(new PopStateEvent('popstate'));});
  await waitForNativeRegistration(page);
  const call=(name,args)=>executeNativeTool(page,name,args);
  const inventory=await call('regional_source_inventory',{limit:50});assert.equal(inventory.counts.sourcesInFilter,49);
  const candidates=await call('regional_discovery_candidates',{institutionIds:['inst-regional-wistar'],limit:10});assert.equal(candidates.results.length,5);
  const detail=await call('regional_discovery_record',{snapshotId:candidates.snapshot.snapshotId,recordId:candidates.results[0].recordId,authorLimit:1});assert.equal(detail.details.authorsReturned,1);
  assert.equal((await call('regional_discovery_candidates',{publish:true})).error.code,'invalid-query');
  await writeFile(output+'/private-ops-native-response.json',JSON.stringify({inventory,candidates,detail},null,2)+'\n');
  evidence.checks.push('All three native tools execute through same-origin private Worker handler');
  assert.equal(new URL(page.url()).pathname,'/ops');
  assert.ok((await page.locator('#root').innerText()).length>100);
  assert.equal(await page.locator('h1').innerText(),'The Valley Desk operations');
  evidence.checks.push('Ops page identity and nonblank content verified');
  await page.screenshot({path:output+'/private-ops-native.png',fullPage:true});
  await page.evaluate(()=>{history.pushState(null,'','/');window.dispatchEvent(new PopStateEvent('popstate'));});
  await page.waitForFunction(async()=>(await document.modelContext.getTools()).length===0);evidence.checks.push('SPA exit disposes tools');
  await page.evaluate(()=>{history.pushState(null,'','/ops');window.dispatchEvent(new PopStateEvent('popstate'));});
  await waitForNativeRegistration(page);
  assert.equal((await call('regional_source_inventory',{limit:2})).results.length,2);
  evidence.checks.push('SPA re-entry restores exactly three tools and executes inventory');
  await page.goto(publicOrigin+'/ops');await waitForNativeRegistration(page);
  assert.equal((await call('regional_source_inventory',{limit:2})).results.length,2);
  evidence.checks.push('Authenticated Ops shell reload executes tools through signed-JWT guard');
  await context.clearCookies();
  assert.equal((await call('regional_source_inventory',{limit:2})).error.code,'read-unavailable');
  await page.goto(publicOrigin+'/ops');assert.equal(await page.locator('body').innerText(),'{"error":"not_found"}');
  assert.equal((await page.evaluate(async()=>await document.modelContext.getTools())).length,0);
  evidence.checks.push('Session removal denies tool reads and Ops shell without leaking retained data');
  evidence.pageErrors=errors;evidence.consoleErrors=consoleErrors;
  assert.deepEqual(errors,[]);assert.ok(consoleErrors.every(message=>/^Failed to load resource: the server responded with a status of 404/.test(message.text)
   || (message.text==='Failed to load resource: net::ERR_FAILED'&&evidence.blockedResourceRequests.some(row=>row.origin===message.origin&&row.path===message.path))));
  assert.ok(evidence.browserRequests.length>=6);assert.ok(evidence.browserRequests.filter(row=>row.status===200).every(row=>row.sessionCookieSent));
  assert.ok(evidence.browserRequests.some(row=>row.status===404&&!row.sessionCookieSent));assert.ok(evidence.browserRequests.filter(row=>row.method==='POST').every(row=>row.origin===publicOrigin));
  evidence.checks.push('Secure HttpOnly same-origin session cookie and POST Origin observed');
  evidence.jwksFetches=fixture.calls();assert.equal(evidence.jwksFetches,1);
  await writeFile(output+'/private-ops-journey-report.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
 } catch(error){evidence.failure={message:error.message};await writeFile(output+'/private-ops-journey-report.json',JSON.stringify(evidence,null,2)+'\n');throw error;}
 finally {globalThis.fetch=originalFetch;await browser?.close();await server?.close();}
}
if(mode==='--private-ops'){await privateOpsJourney(output);process.exit(0);}
const preview=await startRegionalLocalPreview({capturesPath,publicationSnapshotPath});let client,browser,unsupported;
const check=(name,details={})=>report.checks.push({name,status:'passed',...details});
const save=async(name,value)=>writeFile(output+'/'+name+'.json',JSON.stringify(value,null,2)+'\n');
try{
 client=new Client({name:'TheValleyDesk-local-review-client',version:'0.2.0'});await client.connect(new StreamableHTTPClientTransport(new URL(preview.origin+'/mcp')));
 const tools=await client.listTools();assert.deepEqual(tools.tools.map(x=>x.name),['regional_source_inventory','regional_discovery_candidates','regional_discovery_record']);
 for(const tool of tools.tools){assert.equal(tool.inputSchema.additionalProperties,false);assert.equal(tool.outputSchema.additionalProperties,false);assert.equal(tool.annotations.readOnlyHint,true);}
 await save('mcp-tools-list',tools);check('Official SDK initialize and discover three strict read tools');
 const call=async(name,args={})=>{const result=await client.callTool({name,arguments:args});assert.notEqual(result.isError,true);return result.structuredContent;};
 const inventory=await call('regional_source_inventory',{limit:50});assert.equal(inventory.counts.sourcesInFilter,49);assert.equal(inventory.counts.freshSourcesAtSnapshotInFilter,0);assert.equal(inventory.counts.acceptedPublications,null);await save('inventory-response',inventory);
 const all=[];let cursor;do{const page=await call('regional_discovery_candidates',{limit:10,...(cursor?{cursor}:{})});all.push(...page.results);cursor=page.nextCursor;}while(cursor);
 assert.equal(all.length,28);assert.equal(new Set(all.map(x=>x.recordId)).size,28);check('Snapshot pagination returns 28 distinct retained candidates',{rss:22,pubmed:5,repository:1});
 const wistar=await call('regional_discovery_candidates',{institutionIds:['inst-regional-wistar'],providers:['pubmed-metadata'],limit:10});
 assert.equal(wistar.results.length,5);assert.equal(wistar.results.filter(x=>x.explicitRegionalAuthorAffiliationMatches>0).length,4);assert.equal(wistar.results.filter(x=>x.explicitRegionalAuthorAffiliationMatches===0).length,1);assert.ok(wistar.results.every(x=>!x.provenance.upstreamWireBytesVerifiedByThisAdapter&&!x.currentEmploymentConfirmed));await save('wistar-pubmed-response',wistar);
 const authors=await call('regional_discovery_record',{snapshotId:wistar.snapshot.snapshotId,recordId:wistar.results[0].recordId,authorLimit:2});assert.ok(authors.details.authorsReturned<=2);assert.ok(authors.details.authors.every(x=>x.personId===null&&!x.currentAffiliationConfirmed));assert.ok(!JSON.stringify(authors).match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i));await save('publication-record-response',authors);
 const penn=await call('regional_discovery_candidates',{institutionIds:['inst-regional-penn-university']});assert.equal(penn.results.length,1);
 const repo=await call('regional_discovery_record',{snapshotId:penn.snapshot.snapshotId,recordId:penn.results[0].recordId});assert.equal(repo.details.repositoryNumericId,'128938343');assert.equal(repo.record.organizationOwnershipVerified,false);assert.ok(repo.details.literalContext.length>0);await save('repository-record-response',repo);
 const jefferson=await call('regional_discovery_candidates',{institutionIds:['inst-regional-jefferson-university'],limit:10});assert.equal(jefferson.counts.recordsInFilter,22);assert.ok(jefferson.results.every(x=>x.institutionScopeDeclaration==='unverified'));await save('jefferson-rss-response',jefferson);
 check('Publication disambiguation, repository numeric identity and dates/provenance remain qualified');
 const first=await call('regional_discovery_candidates',{limit:2});
 for(const args of [{activate:true},{limit:11},{providers:['private']},{providers:['pubmed-metadata'],cursor:first.nextCursor}]){
  const result=await client.callTool({name:'regional_discovery_candidates',arguments:args});assert.equal(result.isError,true);assert.equal(result._meta['thevalleydesk/errorCode'],'invalid-query');assert.equal(result.structuredContent,undefined);
 }
 for(const [path,init,status] of [
  ['/mcp',{method:'POST',headers:{Origin:'https://untrusted.invalid','Content-Type':'application/json'},body:'{}'},403],
  ['/mcp',{method:'GET'},405],['/mcp',{method:'POST',body:'{}'},415],
  ['/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(20000)},413],
  ['/api/agent/regional-discovery-candidates?url=private',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},403],
  ['/api/agent/regional-discovery-candidates',{method:'POST',headers:{'Content-Type':'application/json'},body:Buffer.from([0xff])},400],
 ]){const response=await fetch(preview.origin+path,init);assert.equal(response.status,status);}
 check('Strict safe-error, origin, method, bytes, URL-query and UTF-8 boundaries');
 const executablePath='/workspace/cache/builderbob/global-tools/browsers/chromium-1243/chrome-linux64/chrome';
 unsupported=await chromium.launch({headless:true,executablePath});const fallback=await unsupported.newPage();
 await fallback.routeWebSocket('**/*',socket=>localHmrHandshake(socket,preview.origin));
 await fallback.route('**/*',route=>new URL(route.request().url()).origin===preview.origin?route.continue():route.abort());
 await fallback.goto(preview.origin);await fallback.waitForFunction(()=>document.querySelector('#root')?.textContent?.length>100);
 assert.equal(await fallback.evaluate(()=>typeof document.modelContext?.registerTool==='function'),false);check('Unsupported browser renders current homepage');
 browser=await chromium.launch({headless:true,executablePath,args:['--enable-features=WebMCP','--enable-blink-features=ModelContext']});report.browserVersion=browser.version();
 const baseline=await browser.newPage({viewport:{width:1400,height:900}}),page=await browser.newPage({viewport:{width:1400,height:900}});
 const errors=[];for(const p of [baseline,page]){await p.routeWebSocket('**/*',socket=>localHmrHandshake(socket,preview.origin));p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',route=>new URL(route.request().url()).origin===preview.origin?route.continue():route.abort());}
 await baseline.route('**/src/agents/regional-bootstrap.ts',route=>route.fulfill({contentType:'application/javascript',body:'export {};'}));
 await baseline.goto(preview.origin);await page.goto(preview.origin);
 await waitForNativeRegistration(page);
 const native=(name,args)=>executeNativeTool(page,name,args);
 const nativeWistar=await native('regional_discovery_candidates',{institutionIds:['inst-regional-wistar'],limit:10});assert.equal(nativeWistar.results.length,5);
 const nativeDetail=await native('regional_discovery_record',{snapshotId:nativeWistar.snapshot.snapshotId,recordId:nativeWistar.results[0].recordId,authorLimit:1});assert.equal(nativeDetail.details.authorsReturned,1);
 const nativeInventory=await native('regional_source_inventory',{limit:2});assert.equal(nativeInventory.results.length,2);
 assert.equal((await native('regional_discovery_candidates',{publish:true})).error.code,'invalid-query');check('Native document.modelContext discovers and executes all three real tools');
 // Compare decoded RGBA pixels in identical Chromium builds, not PNG container bytes.
 const pixels=async(buffer)=>baseline.evaluate(async base64=>{const bytes=Uint8Array.from(atob(base64),x=>x.charCodeAt(0));const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const data=ctx.getImageData(0,0,bitmap.width,bitmap.height).data;const digest=await crypto.subtle.digest('SHA-256',data);return {width:bitmap.width,height:bitmap.height,sha:Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('')};},buffer.toString('base64'));
 for(const [label,viewport] of [['desktop',{width:1400,height:900}],['mobile',{width:390,height:844}]])for(const theme of ['light','dark']){
  for(const p of [baseline,page]){await p.setViewportSize(viewport);await p.locator('#site-theme').selectOption(theme);await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(100);}
  const before=await baseline.screenshot({path:output+'/'+label+'-'+theme+'-baseline.png',animations:'disabled'}),after=await page.screenshot({path:output+'/'+label+'-'+theme+'-native.png',animations:'disabled'});
  const a=await pixels(before),b=await pixels(after);assert.deepEqual(b,a,label+' '+theme+' pixels differ');report.screenshots.push(label+'-'+theme+'-baseline.png',label+'-'+theme+'-native.png');check(label+' '+theme+' frontend pixel parity',a);
 }
 assert.deepEqual(errors,[]);check('Browser page errors absent');
 await save('native-discovery-response',nativeWistar);await save('agent-journey-report',report);console.log(JSON.stringify(report,null,2));
}catch(error){report.failure={message:error.message};await save('agent-journey-report',report);throw error;}
finally{await client?.close();await browser?.close();await unsupported?.close();await preview.close();}
