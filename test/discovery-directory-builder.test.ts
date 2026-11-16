import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {spawnSync} from 'node:child_process';
import {DIRECTORY_REVIEW_AUTHORITY} from '../src/ingest/discovery/directory-review-authority';
import {canonicalDirectoryJson,directorySha256,directoryWorkReviewHash} from '../src/ingest/discovery/directory-review';
import { archiveGeneration, buildDirectorySelection, selectionPath } from '../scripts/build-discovery-directory.mjs';

test('content-addressed generation preserves prior bytes across a new generation and repeat checks', async () => {
  const base = '/workspace/build/builderbob/tvd-gl04-tests';
  await mkdir(base, {recursive:true,mode:0o700});
  const directory = await mkdtemp(join(base, 'archive-test-'));
  try {
  const prior = '{"snapshot":"before","tombstones":[]}\n';
  const corrected = '{"snapshot":"after","tombstones":[]}\n';
  const a = await archiveGeneration(directory, prior), b = await archiveGeneration(directory, corrected);
  assert.notEqual(a.path, b.path);
  assert.equal(await readFile(a.path, 'utf8'), prior);
  assert.deepEqual(await archiveGeneration(directory, prior), a);
  assert.deepEqual(await archiveGeneration(directory, corrected, true), b);
  await writeFile(b.path, 'corrupt');
  await assert.rejects(archiveGeneration(directory, corrected), /generation-archive-conflict/);
  await assert.rejects(archiveGeneration(directory, corrected, true), /generation-archive-conflict/);
  assert.equal(await readFile(a.path, 'utf8'), prior);
  } finally {await rm(directory,{recursive:true,force:true});}
});


test('production pinned authority reproduces only approved works and rejects rehashed proposals before evidence reads',async()=>{
 const selection=JSON.parse(await readFile(selectionPath,'utf8'));
 const result=await buildDirectorySelection(selection,DIRECTORY_REVIEW_AUTHORITY,(p:string)=>readFile(p));assert.equal(result.snapshot.works.length,6);assert.equal(result.report.supportObjectCount,0);assert.equal(result.report.projectGroupCount,null);assert.equal(result.report.changes.filter((c:any)=>c.decision==='hold').length,0);
 const changed=structuredClone(selection),entry=changed.entries.find((e:any)=>e.work);entry.work.claims[0].text='Unapproved treatment claim';entry.receipt.workSha256=await directoryWorkReviewHash(entry.work);entry.work.reviewRefs[0].receiptSha256=await directorySha256(canonicalDirectoryJson(entry.receipt));
 let reads=0;await assert.rejects(()=>buildDirectorySelection(changed,DIRECTORY_REVIEW_AUTHORITY,async()=>{reads++;return new Uint8Array();}),/untrusted-selection/);assert.equal(reads,0);
});
test('production CLI checks all generated artifacts and refuses authority override arguments',()=>{
 const check=spawnSync(process.execPath,['--import','tsx/esm','scripts/build-discovery-directory.mjs','--check'],{encoding:'utf8'});assert.equal(check.status,0,check.stderr);assert.match(check.stdout,/directory_projection_current/);
 const bad=spawnSync(process.execPath,['--import','tsx/esm','scripts/build-discovery-directory.mjs','--authority=anything'],{encoding:'utf8'});assert.equal(bad.status,1);assert.equal(bad.stderr.trim(),'invalid_directory_projection');
});
