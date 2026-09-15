// LOCAL FIXTURE PREVIEW ONLY. No production database, secrets, or Access bypass.
// Run with node --import tsx/esm; all outgoing official PDF fetches use captured bytes.
import { createServer } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pdfDatabase, seedPdfBills, officialPdfFixtureFetch } from '../test/helpers/policy-pdf.ts';
import { handleReviewApi } from '../src/ingest/review-api.ts';
import { policyBaselineView } from '../src/ingest/policy-pdf.ts';

const [newDirectory, portText='5197']=process.argv.slice(2);
const port=Number(portText);
if (!newDirectory || !Number.isInteger(port) || port<1024 || port>65535) throw Error('Usage: preview-policy-evidence.mjs NEW-scratch-directory [port]');
if (!process.env.REVIEW_API_TOKEN) throw Error('Set a throwaway LOCAL fixture bearer token; never use production credentials.');
const dir=resolve(newDirectory);
mkdirSync(dir,{mode:0o700});
const {db,sqlite}=pdfDatabase(`${dir}/policy.sqlite`);
await seedPdfBills(db);
writeFileSync(`${dir}/versions.json`,JSON.stringify(sqlite.prepare('SELECT id,version_id FROM policy_versions ORDER BY id').all(),null,2),{mode:0o600});
globalThis.fetch=officialPdfFixtureFetch;
const server=await createServer({server:{host:'127.0.0.1',port,strictPort:true},plugins:[{
  name:'local-policy-fixture-api',
  configureServer(vite) {
    vite.middlewares.use(async (req,res,next)=>{
      const url=new URL(req.url,`http://127.0.0.1:${port}`);
      if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/ops/api/')) return next();
      try {
        const chunks=[];let size=0;
        for await(const chunk of req) { size+=chunk.length;if(size>900000)throw Error('request-limit');chunks.push(chunk); }
        const request=new Request(url,{method:req.method,headers:req.headers,...(size?{body:Buffer.concat(chunks)}:{})});
        const response=url.pathname==='/api/policy-watchlist'
          ? Response.json(await policyBaselineView(db))
          : await handleReviewApi(request,{VALLEY_DESK_DB:db,REVIEW_API_TOKEN:process.env.REVIEW_API_TOKEN},
            url.pathname.startsWith('/ops/api/')?{routePrefix:'/ops/api'}:{});
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
      } catch { res.writeHead(500,{'content-type':'application/json'});res.end('{"error":"local-fixture-request-failed"}'); }
    });
  },
}]});
await server.listen();
console.log(JSON.stringify({kind:'LOCAL CAPTURED-FIXTURE PREVIEW',origin:`http://127.0.0.1:${port}`,evidenceDirectory:dir,productionActions:false}));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();sqlite.close();process.exit(0);});
