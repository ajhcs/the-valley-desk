import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalDiscoveryEvidenceJson as canonical } from '../src/ingest/discovery-evidence-store';
import { ENRICHMENT_LIMITS as limits, enrichmentUrl, inspectGithubEnrichmentPage as inspect, buildGithubEnrichmentQueue } from '../src/ingest/discovery/github-enrichment';
import { prepareGithubEnrichmentScope, prepareEnrichmentYieldSample, validateRetainedEnrichmentPage } from '../scripts/discovery-github-enrichment.mjs';

function repository(index = 1, extra: Record<string, unknown> = {}) {
  return { id: index, name: `care-${index}`, full_name: `maker/care-${index}`, private: false,
    html_url: `https://github.com/maker/care-${index}`, url: `https://api.github.com/repos/maker/care-${index}`,
    owner: { id: 123, login: 'maker', type: 'User' }, description: 'A source-reported purpose',
    fork: false, archived: true, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-02-01T00:00:00Z',
    pushed_at: null, ...extra };
}
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
const link = (page: number, path = '/users/maker/repos') => `<${enrichmentUrl('maker', Math.min(page, limits.maxPagesPerAccount)).replace('/users/maker/repos', path).replace(/page=\d+$/, `page=${page}`)}>; rel="next"`;

test('projects metadata with repository ID and exact source pointers, retaining nulls, archived and forks', () => {
  const result = inspect(bytes([repository(1, { fork: true, new_metadata_field: { harmless: 'value' } }), repository(2, { description: null })]), 'maker', 1, null);
  assert.equal(result.owner?.nativeId, '123');
  assert.equal(result.repositories[0].nativeId, '1');
  assert.equal(result.repositories[0].sourcePointer, '/0');
  assert.equal(result.repositories[0].fork, true);
  assert.equal(result.repositories[0].archived, true);
  assert.equal(result.repositories[1].description, null);
  assert.equal(result.repositories[0].pushedAt, null);
  assert.equal(result.continuation.state, 'complete');
  assert.equal(result.publicationAuthorized, false);
});

test('binds numeric continuation to observed native owner, preserving frozen query scope', () => {
  const first = inspect(bytes([repository()]), 'maker', 1, link(2, '/user/123/repos'));
  assert.equal(first.continuation.nextPage, 2);
  const org = repository(1, { owner: { id: 123, login: 'maker', type: 'Organization' } });
  assert.equal(inspect(bytes([org]), 'maker', 1, link(2, '/organizations/123/repos')).continuation.state, 'more');
  assert.deepEqual(inspect(bytes([org]), 'maker', 1, link(2, '/user/123/repos')).continuation.pathKinds, ['native-user']);
  assert.throws(() => inspect(bytes([repository()]), 'maker', 1, link(2, '/user/124/repos')), /link-scope/);
  assert.throws(() => inspect(bytes([repository()]), 'maker', 1, link(2).replace('type=owner', 'type=member')), /link-query/);
  assert.throws(() => inspect(bytes([repository()]), 'maker', 1, link(2).replace('api.github.com', 'evil.example')), /link-scope/);
  assert.throws(() => inspect(bytes([repository()]), 'maker', 1, link(3)), /link-sequence/);
  assert.throws(() => inspect(bytes([repository()]), 'maker', 1, link(2).replace('&page=2', '&page=2&page=2')), /link-query/);
});

test('holds full unlinked pages, capped inventories and unverified empty owners honestly', () => {
  assert.equal(inspect(bytes(Array.from({ length: limits.perPage }, (_, i) => repository(i + 1))), 'maker', 1, null).continuation.state, 'unknown');
  assert.equal(inspect(bytes([]), 'maker', 1, null).continuation.state, 'empty-unverified');
  const owner = inspect(bytes([repository()]), 'maker', 1, link(2)).owner;
  assert.equal(inspect(bytes([]), 'maker', 2, null, owner).continuation.state, 'empty-unverified');
  assert.equal(inspect(bytes([repository()]), 'maker', limits.maxPagesPerAccount, link(limits.maxPagesPerAccount + 1)).continuation.state, 'page-cap');
});

test('rejects unsafe metadata anywhere in the body before projection, duplicate JSON keys and unsafe numeric IDs', () => {
  for (const extra of [{ ignored: { email: 'contact@example.org' } }, { ignored: 'mailto:contact@example.org' }, { ignored: { token: 'secret' } }]) {
    assert.throws(() => inspect(bytes([repository(1, extra)]), 'maker', 1, null), /preflight/);
  }
  assert.throws(() => inspect(Buffer.from('[{"id":1,"id":2}]'), 'maker', 1, null), /preflight/);
  assert.throws(() => inspect(bytes([repository(Number.MAX_SAFE_INTEGER + 1)]), 'maker', 1, null), /preflight|native-id/);
  assert.throws(() => inspect(Buffer.from([0xff]), 'maker', 1, null), /preflight/);
  assert.throws(() => inspect(Buffer.alloc(limits.maxBytesPerResponse + 1), 'maker', 1, null), /byte-cap/);
});

test('does not confuse owner ID, repository ID, private state, aliases or identity across pages', () => {
  assert.throws(() => inspect(bytes([repository(1, { private: true })]), 'maker', 1, null), /preflight|binding/);
  assert.throws(() => inspect(bytes([repository(1, { full_name: 'other/care-1' })]), 'maker', 1, null), /binding/);
  assert.throws(() => inspect(bytes([repository(1, { name: '..', full_name: 'maker/..', html_url: 'https://github.com/maker/..', url: 'https://api.github.com/repos/maker/..' })]), 'maker', 1, null), /binding/);
  assert.throws(() => inspect(bytes([repository(1, { url: 'https://api.github.com/repos/other/care-1' })]), 'maker', 1, null), /binding/);
  assert.throws(() => inspect(bytes([repository(), repository()]), 'maker', 1, null), /duplicate-native-id/);
  assert.throws(() => inspect(bytes([repository(1, { created_at: '2024-02-30T00:00:00Z' })]), 'maker', 1, null), /date/);
  assert.throws(() => inspect(bytes([repository()]), 'maker', 2, null, { nativeId: '124', login: 'maker', type: 'User' }), /owner-change/);
  assert.throws(() => inspect(bytes([repository(1, { fork: null })]), 'maker', 1, null), /state/);
});

test('native ID groups aliases while retaining observations; same names with different IDs stay separate', () => {
  const repo = inspect(bytes([repository()]), 'maker', 1, null).repositories[0];
  const observation = { ...repo, receiptId: 'receipt-1', observedAt: '2026-11-17T12:00:00Z', sourceObservationIds: ['source-1'] };
  const result = buildGithubEnrichmentQueue([observation, { ...observation, fullName: 'new-owner/care-1', receiptId: 'receipt-2' }, { ...observation, nativeId: '2' }]);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].observations.length, 2);
  assert.deepEqual(result.candidates[0].aliases, ['maker/care-1', 'new-owner/care-1']);
  assert.equal(result.publicationAuthorized, false);
});

test('freezes source-bound primary cohort and budgets while excluding neighboring collections', () => {
  const scope = prepareGithubEnrichmentScope();
  assert.equal(scope.roster.length, 41);
  assert.equal(new Set(scope.roster.map(a => a.login)).size, 41);
  assert.deepEqual(scope.excludedCollections, ['christiana', 'lehigh', 'scranton']);
  assert.equal(scope.limits.maxRequests, 55);
  for (const account of scope.roster) {
    assert.ok(account.evidence.length > 0);
    assert.ok(account.sourceObservationIds.length > 0);
    assert.ok(account.sourceObservationIds.every(id => !/^(christiana|lehigh|scranton):/.test(id)));
  }
});

test('retained projections bind to frozen roster, request, receipt and content digest', () => {
  const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
  const scope = Buffer.from(JSON.stringify({ roster: [{ login: 'maker', sourceObservationIds: ['primary:source'] }] }));
  const scopeSha256 = sha(scope), receiptId = sha(`${scopeSha256}\nmaker\n1`);
  const projection = { ...inspect(bytes([repository()]), 'maker', 1, null), nativeBodySha256: sha(bytes([repository()])) };
  const packet = { login: 'maker', page: 1, requestUrl: enrichmentUrl('maker', 1), scopeSha256, receiptId,
    sourceObservationIds: ['primary:source'], rawBodyRetained: false, status: 'received', projection, projectionSha256: sha(canonical(projection)) };
  const name = `page-${receiptId}.json`;
  assert.equal(validateRetainedEnrichmentPage(packet, scope, name), packet);
  assert.throws(() => validateRetainedEnrichmentPage({ ...packet, projection: { ...projection, repositories: [] } }, scope, name), /receipt-binding/);
  assert.throws(() => validateRetainedEnrichmentPage({ ...packet, sourceObservationIds: ['lehigh:source'] }, scope, name), /receipt-binding/);
  assert.throws(() => validateRetainedEnrichmentPage({ ...packet, requestUrl: enrichmentUrl('other', 1) }, scope, name), /receipt-binding/);
});

test('yield sample freezes 100 native IDs without labels or metadata-completeness filters', () => {
  const queue = { publicationAuthorized: false, candidates: Array.from({ length: 130 }, (_, i) => ({ nativeId: String(i + 1), description: i % 2 ? null : 'care' })) };
  const first = prepareEnrichmentYieldSample(queue, 'hash');
  const reversed = prepareEnrichmentYieldSample({ ...queue, candidates: [...queue.candidates].reverse() }, 'hash');
  assert.deepEqual(first.rows.map(row => row.nativeId), reversed.rows.map(row => row.nativeId));
  assert.equal(first.rows.length, 100);
  assert.ok(first.rows.some(row => row.description === null));
  assert.ok(first.rows.every(row => row.review.eligible === null && row.review.activeReviewMinutes === null));
  assert.equal(first.eligibleFraction, null);
  assert.equal(first.minutesPerAdmission, null);
  assert.throws(() => prepareEnrichmentYieldSample({ ...queue, candidates: [] }, 'hash'), /sample-cohort/);
  assert.throws(() => prepareEnrichmentYieldSample({ ...queue, candidates: queue.candidates.map(() => ({ nativeId: '1' })) }, 'hash'), /sample-cohort/);
});
