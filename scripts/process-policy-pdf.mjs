// Authenticated operator workflow. Default LOCAL ONLY; --production requires
// separate operational authorization. Never invokes cron or changes schedules.
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const [origin,versionId,workDir,...flags]=process.argv.slice(2);
if(!origin||!versionId||!workDir) throw Error('Usage: process-policy-pdf.mjs origin version-row-id NEW-work-directory [--production]');
const base=new URL(origin);
if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.pathname!=='/'||base.search||base.hash||flags.some(f=>f!=='--production')) throw Error('HTTP(S) origin and documented flags only');
if(!['localhost','127.0.0.1'].includes(base.hostname) && !(flags.includes('--production') && base.origin==='https://thevalleydesk.org')) throw Error('Local by default; production requires explicit scope');
const token=process.env.REVIEW_API_TOKEN;
if(!token) throw Error('Existing authorized operator REVIEW_API_TOKEN required; never put it on the command line');
const dir=resolve(workDir); mkdirSync(dir,{mode:0o700});
const save=(name,value)=>writeFileSync(`${dir}/${name}`,value,{mode:0o600,flag:'wx'});
async function api(path,body) {
  const r=await fetch(new URL(path,base),{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30_000)});
  if(!r.ok) {
    const detail=await r.json().catch(()=>({}));
    const code=typeof detail.error==='string'&&/^[a-z0-9_-]{1,100}$/.test(detail.error)?detail.error:`http-${r.status}`;
    throw Object.assign(Error(`Policy evidence endpoint ${r.status}: ${path}`),{code});
  }
  return r;
}
let artifact,stage='capture',uploadedPages=0;
try {
  artifact=await api(`/api/policy-versions/${encodeURIComponent(versionId)}/capture`,{}).then(r=>r.json());
  save('artifact.json',JSON.stringify(artifact));
  stage='download';
  const r=await api(`/api/policy-pdf/${artifact.id}/content`);
  const reader=r.body.getReader(),chunks=[]; let size=0;
  try {
    while(true) {
      const {done,value}=await reader.read(); if(done) break;
      size+=value.length; if(size>5_000_000) throw Error('PDF limit'); chunks.push(value);
    }
  } finally { await reader.cancel().catch(()=>undefined); }
  const raw=Buffer.concat(chunks);
  save('artifact.pdf',raw);
  stage='render';
  const completion=JSON.parse(execFileSync('node_modules/.policy-pdf/bin/python',['scripts/render-policy-evidence.py',`${dir}/artifact.pdf`,`${dir}/artifact.json`,`${dir}/pages`],{encoding:'utf8',timeout:120_000,maxBuffer:100_000}));
  stage='upload';
  for(let n=1;n<=completion.pageCount;n++) { await api(`/api/policy-pdf/${artifact.id}/pages/${n}`,JSON.parse(readFileSync(`${dir}/pages/page-${n}.json`,'utf8'))); uploadedPages=n; }
  stage='complete';
  const result=await api(`/api/policy-pdf/${artifact.id}/complete`,completion).then(r=>r.json());
  save('receipt.json',JSON.stringify({artifactId:artifact.id,sha256:artifact.sha256,result,summaryAdmitted:false,finishedAt:new Date().toISOString()},null,2));
  console.log(JSON.stringify({artifactId:artifact.id,result,summaryAdmitted:false}));
} catch(error) {
  let code=error.code??'extraction-failed';
  if(stage==='render') {
    try {const detail=JSON.parse(String(error.stderr));if(['capacity-limit','image-only','version-mismatch','render-failed'].includes(detail.error))code=detail.error;} catch {}
  }
  let persistedState=null;
  const persistedError=['capacity-limit','image-only','version-mismatch','render-failed'].includes(code)?code:'extraction-failed';
  if(artifact)persistedState=await api(`/api/policy-pdf/${artifact.id}/failure`,{artifactSha256:artifact.sha256,error:persistedError}).then(r=>r.json()).then(r=>r.state,()=>null);
  save('failure-receipt.json',JSON.stringify({stage,error:code,artifactId:artifact?.id??null,uploadedPages,persistedState,failurePersisted:persistedState==='failed',finishedAt:new Date().toISOString()},null,2));
  throw Error(`Policy evidence workflow failed at ${stage}; inspect the redacted failure receipt.`);
}
