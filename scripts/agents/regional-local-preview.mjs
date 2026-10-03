import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { prepareRegionalSourceReadView, queryRegionalSourceReadView } from '../../src/ingest/regional-read-view.ts';
import { prepareRegionalDiscoveryView, queryRegionalDiscoveryView, queryRegionalDiscoveryRecord } from '../../src/ingest/regional-discovery-view.ts';
import { createRegionalMcpHandler, invokeRegionalTool, REGIONAL_TOOLS } from './regional-mcp-adapter.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const json=async path=>JSON.parse(await readFile(path,'utf8'));
/** Temporary loopback harness; paths are operator inputs, never client tool parameters. */
export async function startRegionalLocalPreview({capturesPath,publicationSnapshotPath}) {
  const inventory=await json(new URL('../../fixtures/regional-source-inventory-v1.json',import.meta.url));
  const coverage=await json(new URL('../../fixtures/coverage-pack-v1.json',import.meta.url));
  const official=await json(new URL('../../fixtures/official-source-registry-v1.json',import.meta.url));
  const captures=await json(capturesPath), publicationSnapshot=await json(publicationSnapshotPath);
  let views,pending;
  const getViews=async()=>{
    const now=new Date().toISOString();
    if(!views||Date.parse(now)>=Date.parse(views.discovery.expiresAt)){
      pending??=Promise.all([
        prepareRegionalSourceReadView({inventory,existingInstitutions:coverage.institutions,existingOfficialSources:official.sources,existingLeadershipSources:coverage.sources,asOf:now}),
        prepareRegionalDiscoveryView({inventory,captures,publicationSnapshot,asOf:now}),
      ]).then(([inventory,discovery])=>{views={inventory,discovery};}).finally(()=>{pending=undefined;});
      await pending;
    }return {views,now};
  };
  const readers={
    regional_source_inventory:async request=>{const {views,now}=await getViews();return queryRegionalSourceReadView(views.inventory,request,now);},
    regional_discovery_candidates:async request=>{const {views,now}=await getViews();return queryRegionalDiscoveryView(views.discovery,request,now);},
    regional_discovery_record:async request=>{const {views,now}=await getViews();return queryRegionalDiscoveryRecord(views.discovery,request,now);},
  };
  const endpoints={'/api/agent/regional-source-inventory':'regional_source_inventory','/api/agent/regional-discovery-candidates':'regional_discovery_candidates','/api/agent/regional-discovery-record':'regional_discovery_record'};
  let origin,mcp;
  const server=await createServer({root,configFile:false,server:{host:'127.0.0.1',port:0,strictPort:true},plugins:[
    (await import('@vitejs/plugin-react')).default(),(await import('@tailwindcss/vite')).default(),
    {name:'regional-local-agent-preview',transformIndexHtml:()=>[{tag:'script',attrs:{type:'module',src:'/src/agents/regional-bootstrap.ts'},injectTo:'body'}],
      configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
        const path=req.url?.split('?')[0];if(!endpoints[path]&&path!=='/api/agent/tools'&&path!=='/mcp')return next();
        const respond=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
        if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin)||req.url.includes('?'))return respond(403,{error:'Origin or endpoint not allowed.'});
        if(path==='/api/agent/tools')return req.method==='GET'?respond(200,{tools:REGIONAL_TOOLS}):respond(405,{error:'Read method required.'});
        if(req.method!=='POST')return respond(405,{error:'Read method required.'});
        if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??''))return respond(415,{error:'JSON content required.'});
        let timer;
        try{
          let expired=false;timer=setTimeout(()=>{expired=true;req.destroy();},10000);
          const chunks=[];let total=0;
          for await(const chunk of req){total+=chunk.length;if(total>16384)return respond(413,{error:'Request too large.'});chunks.push(chunk);}
          clearTimeout(timer);if(expired)return;
          const body=Buffer.concat(chunks);let parsed;
          try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{return respond(400,{error:'Invalid JSON request.'});}
          if(path==='/mcp'){
            const response=await mcp(new Request(origin+path,{method:'POST',headers:req.headers,body}));
            res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
          }
          return respond(200,await invokeRegionalTool(readers,endpoints[path],parsed));
        }catch{if(!res.destroyed)return respond(500,{isError:true,error:{code:'read-unavailable',message:'The regional source read is temporarily unavailable.'}});}
        finally{clearTimeout(timer);}
      });},
    },
  ]});
  await server.listen();origin='http://127.0.0.1:'+server.httpServer.address().port;mcp=createRegionalMcpHandler({readers,origin});
  return {origin,close:()=>server.close(),readers};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const preview=await startRegionalLocalPreview({capturesPath:process.argv[2],publicationSnapshotPath:process.argv[3]});
  console.log(JSON.stringify({origin:preview.origin,mcp:preview.origin+'/mcp',localOnly:true,collectorsActive:false}));
  for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>{void preview.close().then(()=>process.exit(0));});
}
