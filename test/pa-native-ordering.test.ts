import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync,readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy,unstable_splitSqlQuery } from 'wrangler';
import { launchCandidate } from '../fixtures/watch-launch-candidates';
import { syntheticZip } from './fixtures/pa-export/synthetic';
import { derivePaExport,parsePennsylvaniaExportPolicy } from '../src/ingest/watch/pennsylvania-export';
import { persistPolicyWatchCapture,readPolicyWatchCapture } from '../src/ingest/policy-watch-workflow';
import { materializePolicyCapture } from '../src/ingest/policy-watch-native';
import { syntheticFixture, NOW } from './fixtures/watch-contracts/synthetic';
import { syntheticDeliveryForRecord, stageSyntheticDelivery } from './fixtures/watch-delivery/synthetic';
import { projectPolicyDossier } from '../src/content/watch-projection';
import { applyReviewedWatchProjection, readWatchSubject } from '../src/ingest/watch-persistence';
import { canonicalJson, sha256, WatchPublicRecord } from '../src/content/watch-schema';
import type { D1DatabaseLike } from '../src/ingest/persistence';

test('later retained PA native status/version is preserved when an older export arrives with newer retrieval time',{timeout:120000},async t=>{
 const proxy=await getPlatformProxy<{WATCH_TEST_DB:D1DatabaseLike}>({configPath:fileURLToPath(new URL('./fixtures/watch-d1/wrangler.jsonc',import.meta.url)),envFiles:[],persist:false,remoteBindings:false});
 t.after(()=>proxy.dispose());const db=proxy.env.WATCH_TEST_DB,migrations=new URL('../migrations/',import.meta.url);
 for(const name of readdirSync(migrations).filter(n=>n.endsWith('.sql')).sort())await db.batch(unstable_splitSqlQuery(readFileSync(new URL(name,migrations),'utf8')).map(sql=>db.prepare(sql)));
 const source=launchCandidate('candidate-pa-export').source,derived=await derivePaExport(source,syntheticZip());
 const hb=derived.records.find(record=>record.bill==='HB1925')!;
 const capture=parsePennsylvaniaExportPolicy(hb.document,{sourceId:source.id,sourceLabel:source.name,sourceUrl:source.endpoints[0],retrievedAt:'2026-09-30T20:00:00.000Z'});
 // Fabricated separately retained structured status observation for ordering tests.
 // No assertion about the real unretained House vote response is made.
 const later=structuredClone(capture);later.source.sourceId='synthetic-later-status';later.source.retrievedAt='2026-10-01T21:00:00.000Z';
 const action={...later.actions.at(-1)!,eventKey:'synthetic-later-retained-action',text:'Synthetic later retained action',rawDate:'2026-10-01',sourceOrder:12,pointer:'/native/syntheticLaterObservation'};later.native={...later.native as object,syntheticLaterObservation:{text:action.text,date:action.rawDate}};later.actions.push(action);
 const stored=await persistPolicyWatchCapture(db,later);
 await assert.rejects(persistPolicyWatchCapture(db,{...capture,source:{...capture.source,retrievedAt:'2026-10-01T22:00:00.000Z'}}),/action-regression/);
 const newerPn=structuredClone(later);newerPn.version.nativeId='PN 4000';newerPn.source.retrievedAt='2026-10-01T22:01:00.000Z';await persistPolicyWatchCapture(db,newerPn);
 await assert.rejects(persistPolicyWatchCapture(db,{...later,source:{...later.source,retrievedAt:'2026-10-01T22:02:00.000Z'},title:'Changed synthetic title'}),/version-or-action-regression/);
 assert.equal((await readPolicyWatchCapture(db,stored.id)).material.parsed.actions.at(-1)?.text,'Synthetic later retained action');
 assert.equal((await db.prepare('SELECT count(*) n FROM policy_watch_captures').first<{n:number}>())?.n,2);
 assert.ok((await materializePolicyCapture(capture)).actions.every(action=>!action.value.text.includes('144-59')));
 // Real D1 publication transaction with wholly synthetic reviewed proof, not a
 // claimed real vote. Verify the accepted fact survives an export attempt.
 const fixture=await syntheticFixture('policy'),accepted=await projectPolicyDossier(fixture.draft,fixture.context);
 const freshCapture=parsePennsylvaniaExportPolicy(derived.records.find(record=>record.bill==='HB1993')!.document,capture.source);
 const material=await materializePolicyCapture(freshCapture),subjectId=material.subjectId;
 const record=WatchPublicRecord.parse({...accepted,id:subjectId,slug:'synthetic-reviewed-pa-status',identity:{...accepted.identity,value:freshCapture.identity}});
 const payload=canonicalJson(record),inputHash=await sha256('synthetic-reviewed-pa-input'),decisionId='synthetic-reviewed-pa-status-decision';
 await db.prepare("INSERT INTO watch_subjects(id,kind,external_key,slug,input_revision,input_sha256,first_seen_at) VALUES(?,'policy',?,?,1,?,?)").bind(subjectId,'synthetic-reviewed-pa',record.slug,inputHash,NOW).run();
 await db.prepare('INSERT INTO watch_reviewed_projections VALUES(?,?,1,?,0,?,?,?,?,?)').bind(decisionId,subjectId,inputHash,await sha256(payload),payload,'synthetic-editor','synthetic-gate',NOW).run();
 const delivery=await syntheticDeliveryForRecord(record,1,'synthetic-gate');await stageSyntheticDelivery(db,decisionId,delivery.handle);
 await applyReviewedWatchProjection(db,decisionId,new Date(NOW));
 assert.ok((await readWatchSubject(db,'policy',subjectId,'id',new Date(NOW)))?.kind==='policy');
 await persistPolicyWatchCapture(db,freshCapture); // metadata staging is not frozen by an accepted status
 assert.equal((await db.prepare('SELECT count(*) n FROM watch_public_revisions WHERE subject_id=?').bind(subjectId).first<{n:number}>())?.n,1);

});
