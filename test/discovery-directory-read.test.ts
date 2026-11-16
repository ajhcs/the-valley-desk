import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDirectoryQuery, readDirectoryDetail, readDirectoryList } from '../src/ingest/discovery-directory';

const record = (id = 'work:one', kind = 'repository') => ({
  schemaVersion: 'discovery-directory-work-v1', id, revision: 1, kind,
  nativeIdentity: { provider: 'github', namespace: null, nativeId: '123', evidenceId: 'ev:source' },
  title: { value: 'Sleep signal toolkit', evidenceId: 'ev:source' },
  url: { value: 'https://example.org/tool', evidenceId: 'ev:source' }, description: null,
  owner: { name: 'quiet-user', kind: 'User', nativeId: '99', evidenceId: 'ev:source' },
  sourceDate: null, checkedAt: '2026-11-16',
  reviewRefs: [{ id: 'review:1', receiptSha256: 'b'.repeat(64) }],
  evidence: [{ id: 'ev:source', sourceUrl: 'https://example.org/observation', observedDate: '2026-11-16', observationSha256: 'a'.repeat(64), pointer: '/title', method: 'provider-metadata' }],
  claims: [
    { id: `${id}:health`, subjectId: id, evidenceIds: ['ev:source'], reviewId: 'review:1', kind: 'health-purpose', text: 'Research on sleep signals' },
    { id: `${id}:region`, subjectId: id, evidenceIds: ['ev:source'], reviewId: 'review:1', kind: 'regional-connection', institution: 'Example University', campus: null, municipality: 'Camden', state: 'NJ', regionalBasis: 'municipality', county: 'Camden', asOf: { precision: 'year', value: '2024' }, subjectRole: 'account-association', subjectLabel: 'quiet-user', sourceAuthorIndex: null, affiliationEvidenceIds: ['ev:source'], geographyEvidenceIds: ['ev:source'], scope: 'historical', qualification: 'Dated project association; worksite unknown' },
  ], relations: [] as { id: string; fromId: string; toId: string; predicate: string; evidenceIds: string[]; reviewId: string }[],
});
const snapshot = (...works: ReturnType<typeof record>[]) => ({ schemaVersion: 'discovery-directory-snapshot-v1', version: 'snapshot:1', works });

test('list and detail preserve separate identities and precision with bounded continuation', async () => {
  const a = record('work:a'); const b = record('work:b', 'publication'); b.nativeIdentity = null as never; b.owner = null as never;
  const data = snapshot(a, b);
  const page = await readDirectoryList(data, { limit: 1 });
  assert.equal(page.totalWorks, 2); assert.equal(page.matchingWorks, 2); assert.equal(page.items[0].id, 'work:a');
  assert.equal(readDirectoryDetail(data, 'work:b')?.owner, null);
  assert.deepEqual(readDirectoryDetail(data, 'work:a')?.claims[1].kind === 'regional-connection' && (readDirectoryDetail(data, 'work:a')!.claims[1] as any).asOf, { precision: 'year', value: '2024' });
  assert.equal((await readDirectoryList(data, { limit: 1, after: page.nextAfter })).items[0].id, 'work:b');
  await assert.rejects(readDirectoryList({ ...data, version: 'snapshot:2' }, { limit: 1, after: page.nextAfter }), /restart/);
  await assert.rejects(readDirectoryList({ ...data, works: [a] }, { limit: 1, after: page.nextAfter }), /restart/);
  await assert.rejects(readDirectoryList(data, { limit: 1, q: 'Camden', after: page.nextAfter }), /restart/);
});

test('query rejects ambiguous parameters and search only matches each work own fields', async () => {
  assert.throws(() => parseDirectoryQuery(new URLSearchParams('q=a&q=b')));
  assert.throws(() => parseDirectoryQuery(new URLSearchParams('limit=01')));
  assert.throws(() => parseDirectoryQuery(new URLSearchParams('private=yes')));
  const a = record('work:a'); const b = record('work:b'); b.nativeIdentity.nativeId = '124'; b.title.value = 'Other topic'; b.claims[0].text = 'Other research';
  assert.deepEqual((await readDirectoryList(snapshot(a, b), { q: 'sleep' })).items.map(x => x.id), ['work:a']);
  assert.equal(readDirectoryDetail(snapshot(a, b), 'work:missing'), null);
});
