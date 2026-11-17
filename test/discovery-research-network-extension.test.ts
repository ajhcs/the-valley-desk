import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateManifest, validateIntake, extendNetwork } from '../src/ingest/discovery/research-network-extension.ts';
import { verifyReceipt } from '../scripts/lib/research-network-extension-receipts.mjs';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const sample=()=>{
 const dir='docs/discovery/go-live/evidence/GL05/regional-extension-20261117/sju/';
 const m=JSON.parse(readFileSync(dir+'manifest.json','utf8'));
 const d=JSON.parse(readFileSync(dir+'source-assertions.json','utf8'));
 return {m,d,r:d.records[0]};
};
const synthetic=()=>{
 const r:any={id:'example:input.csv#row=2',kind:'publication',url:'https://example.org/paper',nativeId:null,sourceRef:'input.csv#row=2',metadata:{github_url:'https://github.com/lab/work?tab=readme and https://github.com/lab/work',final_url:'https://github.com/other/project'},publicationAuthorized:false,reviewState:'source_reported_unreviewed'};
 return r;
};
test('closed contracts reject authority, unexpected fields, invalid references and URLs',()=>{
 const {m,d}=sample(); validateManifest(m,'sju'); validateIntake(d,m);
 const cases:[string,(s:any)=>void][]=[['missing',s=>delete s.r.kind],['extra',s=>s.r.extra='x'],['identity',s=>s.r.nativeId='123'],['authority',s=>s.r.publicationAuthorized=true],['url',s=>s.r.url='https://user:pass@example.org/'],['traversal',s=>s.r.sourceRef='../input.csv#row=2'],['header',s=>s.r.sourceRef='input.csv#row=1'],['unlisted',s=>s.r.sourceRef='other.csv#row=2'],['metadata',s=>s.r.metadata.extra='x'],['envelope',s=>s.d.extra=true]];
 for(const [label,change] of cases){const s=sample();change(s);assert.throws(()=>validateIntake(s.d,s.m),label);}
 const bad=sample();bad.m.extra=true;assert.throws(()=>validateManifest(bad.m,'sju'));
 const unsupported=sample(); unsupported.m.batch='example'; unsupported.d.batch='example';
 assert.throws(()=>validateManifest(unsupported.m,'example'),/Unsupported intake batch/);
 assert.throws(()=>validateIntake(unsupported.d,unsupported.m),/Unsupported intake batch/);
 const expected={sha256:sha('x'),bytes:1};
 assert.throws(()=>verifyReceipt(Buffer.from('xx'),expected));
 assert.throws(()=>verifyReceipt(Buffer.from('y'),expected));
 verifyReceipt(Buffer.from('x'),expected);
});
test('secondary URLs remain source-scoped leads without asserted aliases or catalog promotion',()=>{
 const r=synthetic(); const result=extendNetwork([],[],[],[r]);
 assert.equal(result.observations[0].url,'https://example.org/paper');
 assert(result.observations.some(x=>x.url==='https://github.com/lab/work' && x.repositoryKey==='lab/work'));
 assert(result.observations.some(x=>x.url==='https://github.com/lab/work?tab=readme' && x.urlKind==='invalid-fragment'));
 assert(result.observations.some(x=>x.repositoryKey==='other/project'));
 assert.equal(result.repositories.length,0);
 assert(result.observations.every(x=>x.nativeId===null && x.publicationAuthorized===false));
});
test('frozen batch policies and required fields reject self-authorization and impossible dates',()=>{
 const dir='docs/discovery/go-live/evidence/GL05/regional-extension-20261117/sju/';
 const m=JSON.parse(readFileSync(dir+'manifest.json','utf8'));
 const d=JSON.parse(readFileSync(dir+'source-assertions.json','utf8'));
 validateManifest(m,'sju'); validateIntake(d,m);
 const badPolicy=structuredClone(m); badPolicy.metadataPolicies['accounts.csv'].push('invented');
 assert.throws(()=>validateManifest(badPolicy,'sju'));
 const missing=structuredClone(d); delete missing.records[0].metadata.account;
 assert.throws(()=>validateIntake(missing,m));
 const date=structuredClone(d); date.records[0].metadata.snapshot_utc='2026-02-30T24:00:00Z';
 assert.throws(()=>validateIntake(date,m));
 const coverage=structuredClone(d); coverage.coverage.profile={body:'private'};
 assert.throws(()=>validateIntake(coverage,m));
});
test('generated extension preserves frozen observations and graph',()=>{
 const base='docs/discovery/go-live/evidence/GL05/';
 const read=(p:string)=>JSON.parse(readFileSync(base+p,'utf8'));
 const old=read('regional-expansion-20261117/qualification-queue.json'), now=read('regional-extension-20261117/qualification-queue.json');
 const oldNet=read('regional-expansion-20261117/research-network.json'), net=read('regional-extension-20261117/research-network.json');
 assert.deepEqual(now.observations.slice(0,old.observations.length),old.observations);
 assert.deepEqual(net.nodes,oldNet.nodes); assert.deepEqual(net.edges,oldNet.edges);
 assert.equal(now.inheritedSourceRecords.count,old.sourceRecords.length);
 assert.equal(net.counts.nativeRepositories,231);
});
