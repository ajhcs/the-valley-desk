import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalDirectoryJson, directorySha256, directoryWorkReviewHash, validateDirectorySelection } from '../src/ingest/discovery/directory-review';
const priorState = { path: 'docs/discovery/go-live/evidence/GL04/generations/cfb33800e554f75836f2fcc2c659b3edd37eb97ac66d7b1efd61f5f71bdb3891.json', sha256: 'cfb33800e554f75836f2fcc2c659b3edd37eb97ac66d7b1efd61f5f71bdb3891' };
const load = (path: string) => readFile(path);
async function fixture() { return JSON.parse(await readFile('docs/discovery/go-live/evidence/GL05/selection.json', 'utf8')); }
async function validate(s: any, loader = load) { return validateDirectorySelection(s, { selectionSha256: await directorySha256(canonicalDirectoryJson(s)), operator: 'agent:root', reviewer: 'agent:sol_gl04_review', priorState }, loader); }
async function reseal(e: any) { e.receipt.bindingsSha256 = await directorySha256(canonicalDirectoryJson(e.bindings)); e.receipt.workSha256 = await directoryWorkReviewHash(e.work); e.work.reviewRefs[0].receiptSha256 = await directorySha256(canonicalDirectoryJson(e.receipt)); }
test('retained GL05 selection qualifies six works against retained prior state', async () => { const s = await fixture(); assert.equal((await validate(s)).snapshot.works.length, 6); });
test('capture receipts and provider field semantics reject substitution', async () => {
  const s = await fixture();
  await assert.rejects(validate(s, p => p.endsWith('github-sleepboost/observation.json') ? Promise.resolve(Buffer.from('{}')) : load(p)), /gl05-receipt-hash/);
  const e = s.entries.find((x: any) => x.work?.nativeIdentity?.nativeId === '617168725');
  const b = e.bindings.find((x: any) => x.field === '/title/value'); b.pointer = '/name'; e.work.evidence.find((x: any) => x.id === b.evidenceId).pointer = '/name'; e.work.title.value = 'SleepBoost'; await reseal(e);
  await assert.rejects(validate(s), /gl05-native-field/);
});
test('claims require subject-specific topics and purpose', async () => {
  const s = await fixture(); const e = s.entries.find((x: any) => x.work?.nativeIdentity?.nativeId === '192607622'); e.work.claims.find((c: any) => c.kind === 'topic').topic = 'sleep'; await reseal(e); await assert.rejects(validate(s), /gl05-topic-subject/);
  const t = await fixture(); const x = t.entries.find((x: any) => x.work?.nativeIdentity?.nativeId === '617168725'); x.work.claims.find((c: any) => c.kind === 'health-purpose').text = 'Clinically proven cure.'; await reseal(x); await assert.rejects(validate(t), /gl05-purpose-subject/);
});
test('project geography and directed citation stay attached to observed subject', async () => {
  const s = await fixture(); const e = s.entries.find((x: any) => x.work?.nativeIdentity?.nativeId === '617168725'); e.work.claims.find((c: any) => c.kind === 'regional-connection').municipality = 'Glassboro'; await reseal(e); await assert.rejects(validate(s), /gl05-project-context/);
  const t = await fixture(); const x = t.entries.find((x: any) => x.work?.nativeIdentity?.nativeId === '617168725'); x.work.relations[0].toId = 'GL05:work:crossref:openpbta'; await reseal(x); await assert.rejects(validate(t), /gl05-relation-subject/);
});
test('OpenPBTA project date is the historical publication month, not the later observation', async () => {
  const s = await fixture(); const e = s.entries.find((x: any) => x.work?.nativeIdentity?.nativeId === '192607622');
  const claim = e.work.claims.find((c: any) => c.kind === 'regional-connection');
  assert.deepEqual(claim.asOf, { precision: 'month', value: '2022-10' }); assert.equal(claim.scope, 'historical');
  claim.asOf = { precision: 'day', value: '2026-11-16' }; claim.scope = 'observed'; await reseal(e);
  await assert.rejects(validate(s), /gl05-project-context/);
});
