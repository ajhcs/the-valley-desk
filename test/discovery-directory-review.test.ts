import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { archiveGeneration } from '../scripts/build-discovery-directory.mjs';
import { canonicalDirectoryJson, directorySha256, directoryWorkReviewHash, validateDirectorySelection } from '../src/ingest/discovery/directory-review';

// Dynamic trust is a test fixture only; production authority is separately pinned in code.
async function fixture() {
  const selection = JSON.parse(await readFile('docs/discovery/go-live/evidence/GL04/selection.json', 'utf8'));
  const trust = { selectionSha256: await directorySha256(canonicalDirectoryJson(selection)), operator: 'agent:root', reviewer: 'agent:sol_gl04_review', priorState: null };
  return { selection, trust };
}
const load = (path: string) => readFile(path);
async function pin(selection: unknown) { return { selectionSha256: await directorySha256(canonicalDirectoryJson(selection)), operator: 'agent:root', reviewer: 'agent:sol_gl04_review', priorState: null }; }
async function reseal(entry: any) {
  entry.receipt.bindingsSha256 = await directorySha256(canonicalDirectoryJson(entry.bindings));
  entry.receipt.workSha256 = await directoryWorkReviewHash(entry.work);
  entry.work.reviewRefs[0].receiptSha256 = await directorySha256(canonicalDirectoryJson(entry.receipt));
}
test('retained selection reproduces two works and leaves holds out of projection', async () => {
  const { selection, trust } = await fixture();
  const a = await validateDirectorySelection(selection, trust, load), b = await validateDirectorySelection(selection, trust, load);
  assert.deepEqual(a, b); assert.equal(a.snapshot.works.length, 2);
  assert.ok(selection.entries.some((e: any) => e.decision === 'hold'));
  assert.ok(a.snapshot.works.some(w => w.kind === 'repository')); assert.ok(a.snapshot.works.some(w => w.kind === 'publication'));
});
test('detached trust rejects self-rehashed selection and forged reviewers', async () => {
  const { selection, trust } = await fixture(); const entry = selection.entries.find((e: any) => e.work);
  entry.work.title.value = 'Changed'; await reseal(entry);
  await assert.rejects(validateDirectorySelection(selection, trust, load), /untrusted-selection/);
  entry.receipt.reviewer = 'agent:attacker'; await reseal(entry);
  await assert.rejects(validateDirectorySelection(selection, await pin(selection), load), /receipt-authority/);
});
test('source substitution, invalid pointers and private extra fields fail closed', async () => {
  const { selection, trust } = await fixture();
  await assert.rejects(validateDirectorySelection(selection, trust, async path => path === selection.evidence[0].path ? new TextEncoder().encode('{}') : load(path)), /evidence-hash/);
  await assert.rejects(validateDirectorySelection(selection, trust, async path => path.endsWith('/original/plan.json') ? new TextEncoder().encode('{}') : load(path)), /gl03-plan-hash/);
  const bad = structuredClone(selection); const entry = bad.entries.find((e: any) => e.work?.nativeIdentity?.provider === 'crossref');
  const b = entry.bindings.find((x: any) => x.field === '/title/value'); b.pointer = '/message/items/0/DOI';
  entry.work.evidence.find((x: any) => x.id === b.evidenceId).pointer = b.pointer; await reseal(entry);
  await assert.rejects(validateDirectorySelection(bad, await pin(bad), load));
  const extra = structuredClone(selection); extra.entries.find((e: any) => e.work).work.privateNote = 'no';
  await assert.rejects(validateDirectorySelection(extra, await pin(extra), load));
});
test('author index and stale correction cannot bypass source and prior-state gates', async () => {
  const { selection } = await fixture(); const bad = structuredClone(selection);
  const p = bad.entries.find((e: any) => e.work?.nativeIdentity?.provider === 'crossref');
  p.work.claims.find((c: any) => c.kind === 'regional-connection').sourceAuthorIndex = 6; await reseal(p);
  await assert.rejects(validateDirectorySelection(bad, await pin(bad), load), /author-binding|context-binding/);
  const correction = structuredClone(selection); const entry = correction.entries.find((e: any) => e.work);
  entry.decision = entry.receipt.decision = 'correction'; entry.target = entry.receipt.target = {id: entry.work.id, revision: 1}; await reseal(entry);
  await assert.rejects(validateDirectorySelection(correction, await pin(correction), load), /stale-target/);
});

test('anchored prior state supports correction, holds, removals and blocks resurrection', async () => {
  const { selection, trust } = await fixture(); const initial = await validateDirectorySelection(selection, trust, load);
  const priorBytes = new TextEncoder().encode(JSON.stringify(initial.state));
  const loader = (path: string) => path === 'prior.json' ? Promise.resolve(priorBytes) : load(path);
  const work = initial.snapshot.works[0];
  const correction = structuredClone(selection); correction.entries = [correction.entries.find((e: any) => e.work?.id === work.id)];
  const entry = correction.entries[0]; entry.decision = entry.receipt.decision = 'correction'; entry.target = entry.receipt.target = {id: work.id, revision: work.revision}; entry.work.revision++; await reseal(entry);
  const ctx = { ...(await pin(correction)), priorState: { path: 'prior.json', sha256: await directorySha256(priorBytes) } };
  const updated = await validateDirectorySelection(correction, ctx, loader); assert.equal(updated.snapshot.works.find(w => w.id === work.id)?.revision, work.revision + 1);
  const fixtureBase = process.env.DIRECTORY_TEST_TMP ?? '/workspace/build/builderbob/tvd-gl04-tests';
  await mkdir(fixtureBase, { recursive: true, mode: 0o700 });
  const archiveDir = await mkdtemp(join(fixtureBase, 'directory-parent-'));
  try {
    const archivedPrior = await archiveGeneration(archiveDir, priorBytes);
    const archivedContext = { ...await pin(correction), priorState: archivedPrior };
    const fromArchive = await validateDirectorySelection(correction, archivedContext, load);
    const nextArchive = await archiveGeneration(archiveDir, JSON.stringify(fromArchive.state));
    assert.notEqual(nextArchive.path, archivedPrior.path);
    assert.deepEqual(await validateDirectorySelection(correction, archivedContext, load), fromArchive);
    assert.deepEqual(new Uint8Array(await readFile(archivedPrior.path)), priorBytes);
  } finally { await rm(archiveDir, { recursive: true, force: true }); }
  const held = structuredClone(correction); const h = held.entries[0]; h.decision = h.receipt.decision = 'hold'; h.target = h.receipt.target = null; h.work = null; h.bindings = []; h.receipt.workSha256 = null; h.receipt.bindingsSha256 = await directorySha256(canonicalDirectoryJson([]));
  const heldResult = await validateDirectorySelection(held, {...await pin(held), priorState: ctx.priorState}, loader); assert.deepEqual(heldResult.snapshot.works, initial.snapshot.works);
  h.decision = h.receipt.decision = 'duplicate';
  await assert.rejects(validateDirectorySelection(held, {...await pin(held), priorState: ctx.priorState}, loader), /decision-target/);
  h.target = h.receipt.target = {id: 'missing', revision: 1};
  await assert.rejects(validateDirectorySelection(held, {...await pin(held), priorState: ctx.priorState}, loader), /stale-target/);
  h.target = h.receipt.target = {id: work.id, revision: work.revision};
  assert.equal((await validateDirectorySelection(held, {...await pin(held), priorState: ctx.priorState}, loader)).snapshot.works.length, initial.snapshot.works.length);
  h.decision = h.receipt.decision = 'removal'; h.target = h.receipt.target = {id: work.id, revision: work.revision};
  const removed = await validateDirectorySelection(held, {...await pin(held), priorState: ctx.priorState}, loader); assert.equal(removed.snapshot.works.some(w => w.id === work.id), false); assert.equal(removed.state.tombstones.length, 1);
  const removedBytes = new TextEncoder().encode(JSON.stringify(removed.state));
  const resurrect = structuredClone(selection); resurrect.entries = [resurrect.entries.find((e: any) => e.work?.id === work.id)];
  await assert.rejects(validateDirectorySelection(resurrect, {...await pin(resurrect), priorState: {path:'prior.json',sha256:await directorySha256(removedBytes)}}, p => p === 'prior.json' ? Promise.resolve(removedBytes) : load(p)), /tombstoned-work/);
  const alias = resurrect.entries[0]; alias.work.id = 'different:internal-id'; for (const c of alias.work.claims) c.subjectId = alias.work.id; await reseal(alias);
  await assert.rejects(validateDirectorySelection(resurrect, {...await pin(resurrect), priorState: {path:'prior.json',sha256:await directorySha256(removedBytes)}}, p => p === 'prior.json' ? Promise.resolve(removedBytes) : load(p)), /tombstoned-work/);
});
test('reviewed relation binds directed endpoint identities and rejects reversal', async () => {
  const { selection } = await fixture();
  const from = selection.entries.find((e: any) => e.work?.kind === 'repository'), to = selection.entries.find((e: any) => e.work?.kind === 'publication');
  const identity = (w: any) => ({provider:w.nativeIdentity.provider, namespace:w.nativeIdentity.namespace, nativeId:w.nativeIdentity.nativeId});
  const observation = {relation:{fromId:from.work.id,toId:to.work.id,predicate:'repository-cites-work',fromNativeIdentity:identity(from.work),toNativeIdentity:identity(to.work)}};
  const bytes = new TextEncoder().encode(JSON.stringify(observation)); const sha = await directorySha256(bytes);
  const ev = {id:'test:relation',path:'relation.json',sha256:sha,sourceUrl:'https://example.org/evidence',observedDate:'2026-11-16',method:'reviewed-observation',kind:'curated-observation'};
  selection.evidence.push(ev); from.work.evidence.push({id:ev.id,sourceUrl:ev.sourceUrl,observedDate:ev.observedDate,observationSha256:sha,pointer:'/relation',method:ev.method});
  from.work.relations.push({id:'test:edge',fromId:from.work.id,toId:to.work.id,predicate:'repository-cites-work',evidenceIds:[ev.id],reviewId:from.receipt.id});
  from.bindings.push({field:'/relations/0',evidenceId:ev.id,pointer:'/relation',transform:'reviewed-relation',nativePointer:null}); await reseal(from);
  const loader = (p: string) => p === 'relation.json' ? Promise.resolve(bytes) : load(p);
  assert.equal((await validateDirectorySelection(selection, await pin(selection), loader)).snapshot.works.find(w => w.id === from.work.id)?.relations.length, 1);
  const wrong = structuredClone(selection); wrong.entries.find((e: any) => e.work?.id === from.work.id).work.relations[0].predicate = 'work-links-repository';
  await reseal(wrong.entries.find((e: any) => e.work?.id === from.work.id));
  await assert.rejects(validateDirectorySelection(wrong, await pin(wrong), loader));
});
test('project identity and geographic evidence roles remain bound to the actual observations', async () => {
  const { selection } = await fixture(); const entry = selection.entries.find((e: any) => e.candidateId === 'G04');
  const wrongRole = structuredClone(selection); const region = wrongRole.entries.find((e: any) => e.candidateId === 'G04').work.claims.find((c: any) => c.kind === 'regional-connection');
  region.geographyEvidenceIds = ['GL04:purpose']; await reseal(wrongRole.entries.find((e: any) => e.candidateId === 'G04'));
  await assert.rejects(validateDirectorySelection(wrongRole, await pin(wrongRole), load), /project-evidence-roles/);
  const file = selection.evidence.find((e: any) => e.id === 'GL04:purpose').path;
  const observations = JSON.parse(await readFile(file, 'utf8')); observations.observations[0].facts.projectRepositoryUrl = 'https://github.com/unrelated/repo';
  const bytes = new TextEncoder().encode(JSON.stringify(observations)), digest = await directorySha256(bytes);
  for (const e of selection.evidence) if (e.path === file) e.sha256 = digest;
  for (const item of selection.entries) if (item.work) { for (const evidence of item.work.evidence) if (selection.evidence.find((e: any) => e.id === evidence.id)?.path === file) evidence.observationSha256 = digest; await reseal(item); }
  await assert.rejects(validateDirectorySelection(selection, await pin(selection), p => p === file ? Promise.resolve(bytes) : load(p)), /project-context-binding/);
  assert.ok(entry);
});
test('publication affiliation evidence cannot stand in for county mapping', async () => {
  const { selection } = await fixture();
  const entry = selection.entries.find((e: any) => e.work?.nativeIdentity?.provider === 'crossref');
  const region = entry.work.claims.find((c: any) => c.kind === 'regional-connection');
  region.geographyEvidenceIds = [...region.affiliationEvidenceIds]; await reseal(entry);
  await assert.rejects(validateDirectorySelection(selection, await pin(selection), load), /author-geography-role/);
});
test('source artifact kinds and ambiguous evidence JSON fail closed', async () => {
  const { selection } = await fixture();
  for (const provider of ['github', 'crossref']) {
    const copy = structuredClone(selection); const entry = copy.entries.find((e: any) => e.work?.nativeIdentity?.provider === provider);
    entry.work.kind = provider === 'github' ? 'publication' : 'discussion'; await reseal(entry);
    await assert.rejects(validateDirectorySelection(copy, await pin(copy), load), /gl03-fact-identity|crossref-kind/);
  }
  for (const raw of ['{"duplicate":1,"duplicate":2}', '{"n":9007199254740992}']) {
    const copy = structuredClone(selection); const path = copy.evidence.find((e: any) => e.id === 'GL04:purpose').path;
    const bytes = new TextEncoder().encode(raw), digest = await directorySha256(bytes);
    for (const e of copy.evidence) if (e.path === path) e.sha256 = digest;
    for (const entry of copy.entries) if (entry.work) { for (const e of entry.work.evidence) if (copy.evidence.find((x: any) => x.id === e.id)?.path === path) e.observationSha256 = digest; await reseal(entry); }
    await assert.rejects(validateDirectorySelection(copy, await pin(copy), p => p === path ? Promise.resolve(bytes) : load(p)), /duplicate-json-key|unsafe-json-number/);
  }
});
