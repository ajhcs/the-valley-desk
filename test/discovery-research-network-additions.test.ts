import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateManifest, validateIntake } from '../src/ingest/discovery/research-network-additions.ts';
import { extendNetwork } from '../src/ingest/discovery/research-network-extension.ts';
import { verifyReceipt } from '../scripts/lib/research-network-extension-receipts.mjs';
const base='docs/discovery/go-live/evidence/GL05/';
const read=(p:string)=>JSON.parse(readFileSync(base+p,'utf8'));
const sample=(batch='wistar')=>({m:read(`regional-additions-20261117/${batch}/manifest.json`),d:read(`regional-additions-20261117/${batch}/source-assertions.json`)});
test('closed intake contracts and receipts reject changes before parsing',()=>{
 for(const batch of ['incubators','wistar','public-health']) {const {m,d}=sample(batch);validateManifest(m,batch);validateIntake(d,m);}
 const {m,d}=sample(); const bad=structuredClone(m);bad.metadataPolicies['github-accounts.csv'].push('extra');assert.throws(()=>validateManifest(bad,'wistar'));assert.throws(()=>validateManifest(m,'unknown'));
 for(const f of [(r:any)=>r.nativeId='42',(r:any)=>r.publicationAuthorized=true,(r:any)=>r.url='https://u:p@example.org', (r:any)=>r.sourceRef='../secret#row=2',(r:any)=>delete r.metadata.github_login,(r:any)=>r.metadata.contact='x',(r:any)=>r.metadata.checked_utc='2026-02-30T10:00:00Z',(r:any)=>r.metadata.proseTruncated='maybe',(r:any)=>r.metadata.sourceUrls='["https://user:pass@example.com"]']) {const x=structuredClone(d);f(x.records[0]);assert.throws(()=>validateIntake(x,m));}
 const hash=createHash('sha256').update('x').digest('hex');verifyReceipt(Buffer.from('x'),{sha256:hash,bytes:1});assert.throws(()=>verifyReceipt(Buffer.from('x'),{sha256:hash,bytes:2}));assert.throws(()=>verifyReceipt(Buffer.from('y'),{sha256:hash,bytes:1}));
});
test('secondary URLs stay source scoped and retain queries and fragments',()=>{
 const r={id:'example:row',kind:'project',url:'https://example.org',metadata:{links:'https://github.com/a/b?tab=readme#details https://github.com/another/account'},sourceRef:'input.csv#row=2',reviewState:'source_reported_unreviewed'};
 const out=extendNetwork([],[],[],[r]);assert(out.observations.some(x=>x.url==='https://github.com/a/b?tab=readme#details' && x.fields.sourceRefs?.[0]==='metadata:links:0'));assert(out.observations.some(x=>x.url==='https://github.com/another/account'));assert.equal(out.repositories.length,0);
});
test('frozen ancestry and derived exports remain compact',()=>{
 const old=read('regional-extension-20261117/qualification-queue.json'),now=read('regional-additions-20261117/qualification-queue.json'),oldNet=read('regional-extension-20261117/research-network.json'),net=read('regional-additions-20261117/research-network.json');
 assert.equal(old.observations.length,17665);assert.deepEqual(now.observations.slice(0,17665),old.observations);assert.deepEqual(net.nodes,oldNet.nodes);assert.deepEqual(net.edges,oldNet.edges);assert.equal(net.counts.nativeRepositories,231);assert.equal(now.inheritedSourceRecords.count,3261);assert.equal(old.inheritedSourceRecords.count,4472);assert.equal(now.sourceRecords.length,1788);
 const derived=now.sourceRecords.filter((r:any)=>r.id.startsWith('incubators:unreviewed-'));assert.equal(derived.length,3);for(const r of derived){assert.equal(r.kind,'coverage');assert.equal(r.url,null);assert(!JSON.stringify(r.metadata).includes('https://'));assert.equal(now.observations.filter((o:any)=>o.id.startsWith(r.id)).length,1);}
 const {m,d}=sample('incubators');const altered=structuredClone(d);altered.records.find((r:any)=>r.id.startsWith('incubators:unreviewed-')).url='https://github.com/a/b';assert.throws(()=>validateIntake(altered,m));
});
