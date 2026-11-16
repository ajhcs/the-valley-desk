import {readFileSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DirectoryAcquisitionStore} from '../../../scripts/discovery-directory-acquire.mjs';
import {canonical} from '../../../src/ingest/discovery/directory-acquisition.ts';
const batch=process.argv[2];const plan=JSON.parse(readFileSync(batch+'/plan.json','utf8'));
const directory=mkdtempSync(batch+'/replay-');const store=new DirectoryAcquisitionStore(directory,plan);
let replayed=0;const outcomes=[];
try{for(const p of plan.pages){const capture=JSON.parse(readFileSync(batch+'/'+p.id+'.json','utf8'));store.reserve(p.id);store.markAttempt(p.id,capture.receipt.issuedAt);const first=store.finish(capture.receipt,capture.packet??undefined),second=store.finish(capture.receipt,capture.packet??undefined);assert.equal(second.replay,true);assert.equal(second.inserted,0);assert.throws(()=>store.markAttempt(p.id,capture.receipt.issuedAt));outcomes.push({page:p.id,...first});replayed++;}}finally{store.close();}
const original=new DirectoryAcquisitionStore(batch+'/journal',plan),reopened=new DirectoryAcquisitionStore(directory,plan);
try{assert.deepEqual(reopened.listCandidates(),original.listCandidates());const sha=v=>createHash('sha256').update(canonical(v)).digest('hex');const result={schemaVersion:'GL03-replay-check-v1',scope:'retained fact packets and private journal only; no native body reconstruction',pages:replayed,candidates:reopened.progress().candidates.count,candidatesSha256:sha(reopened.listCandidates()),outcomes,reopened:true,noNetwork:true};writeFileSync(batch+'/replay-result.json',JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify(result));}finally{original.close();reopened.close();}
