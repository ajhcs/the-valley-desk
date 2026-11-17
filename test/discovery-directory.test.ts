import test from 'node:test';
import assert from 'node:assert/strict';
import { DIRECTORY_TOPIC_REVISION, DirectorySnapshotSchema, DirectoryWorkSchema } from '../src/content/discovery-directory';
import { DirectoryPrivateFrontierSchema } from '../src/ingest/discovery/directory-frontier';

// Fictional records exercise shape and bindings, not real-world source truth or authority.
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

test('paperless user-owned repository is structurally valid without biography or license', () => {
  assert.equal(DirectoryWorkSchema.safeParse(record()).success, true);
});

test('standalone project and independently sourced work kinds do not require provider identity or a repository', () => {
  for (const kind of ['project', 'publication', 'preprint', 'discussion']) {
    const work = record(`work:${kind}`, kind); work.nativeIdentity = null as never; work.owner = null as never;
    assert.equal(DirectorySnapshotSchema.safeParse(snapshot(work)).success, true, kind);
  }
});

test('regional evidence roles can share one observation but must be bound and dated', () => {
  const work = record(); assert.equal(DirectoryWorkSchema.safeParse(work).success, true);
  const region = work.claims[1]; region.geographyEvidenceIds = ['ev:missing'];
  assert.equal(DirectoryWorkSchema.safeParse(work).success, false);
  region.geographyEvidenceIds = ['ev:source']; region.asOf = { precision: 'day', value: '2024-02-30' };
  assert.equal(DirectoryWorkSchema.safeParse(work).success, false);
});

test('unknown county remains null without a fabricated county evidence claim', () => {
  const work = record(); const region = work.claims[1];
  region.county = null as never;
  assert.equal(DirectoryWorkSchema.safeParse(work).success, true);
  region.geographyEvidenceIds = [];
  assert.equal(DirectoryWorkSchema.safeParse(work).success, false);
});

test('independent county-based work can omit institution, municipality and campus', () => {
  const work = record(); const region = work.claims[1];
  region.institution = null as never; region.municipality = null as never; region.regionalBasis = 'county';
  assert.equal(DirectoryWorkSchema.safeParse(work).success, true);
  region.state = 'PA'; assert.equal(DirectoryWorkSchema.safeParse(work).success, false);
});

test('snapshot rejects duplicate canonical native IDs and conflicting shared evidence', () => {
  const a = record('work:a'); const b = record('work:b');
  assert.equal(DirectorySnapshotSchema.safeParse(snapshot(a, b)).success, false);
  b.nativeIdentity.nativeId = '124'; assert.equal(DirectorySnapshotSchema.safeParse(snapshot(a, b)).success, true);
  b.evidence[0].observationSha256 = 'c'.repeat(64); assert.equal(DirectorySnapshotSchema.safeParse(snapshot(a, b)).success, false);
  const p = record('work:doi1', 'publication'); const q = record('work:doi2', 'publication');
  p.nativeIdentity = { provider: 'crossref', namespace: null, nativeId: '10.1000/TEST', evidenceId: 'ev:source' };
  q.nativeIdentity = { provider: 'crossref', namespace: null, nativeId: 'https://doi.org/10.1000/test', evidenceId: 'ev:source' };
  assert.equal(DirectorySnapshotSchema.safeParse(snapshot(p, q)).success, false);
});

test('installation-scoped identities remain separate and conflicting review IDs fail', () => {
  const a = record('work:a', 'discussion'); const b = record('work:b', 'discussion');
  a.nativeIdentity = { provider: 'other', namespace: 'https://forum-a.example/', nativeId: '42', evidenceId: 'ev:source' } as never;
  b.nativeIdentity = { provider: 'other', namespace: 'https://forum-b.example/', nativeId: '42', evidenceId: 'ev:source' } as never;
  assert.equal(DirectorySnapshotSchema.safeParse(snapshot(a, b)).success, true);
  b.nativeIdentity.namespace = 'https://forum-a.example/' as never;
  assert.equal(DirectorySnapshotSchema.safeParse(snapshot(a, b)).success, false);
  b.nativeIdentity.namespace = 'https://forum-b.example/' as never;
  b.reviewRefs[0].receiptSha256 = 'c'.repeat(64);
  assert.equal(DirectorySnapshotSchema.safeParse(snapshot(a, b)).success, false);
});

test('arxiv explicit versions remain distinct and aliases of the same version collide', () => {
  const a = record('work:a', 'preprint'); const b = record('work:b', 'preprint');
  a.nativeIdentity = { provider: 'arxiv', namespace: null, nativeId: '2401.12345v1', evidenceId: 'ev:source' } as never;
  b.nativeIdentity = { provider: 'arxiv', namespace: null, nativeId: '2401.12345v2', evidenceId: 'ev:source' } as never;
  assert.equal(DirectorySnapshotSchema.safeParse(snapshot(a, b)).success, true);
  b.nativeIdentity.nativeId = 'https://arxiv.org/abs/2401.12345v1';
  assert.equal(DirectorySnapshotSchema.safeParse(snapshot(a, b)).success, false);
});

test('opaque installation IDs remain exact and cannot collide across tuple boundaries', () => {
  const a = record('work:a', 'discussion'); const b = record('work:b', 'discussion');
  a.nativeIdentity = { provider: 'other', namespace: 'https://forum.example.org/', nativeId: 'Ａ', evidenceId: 'ev:source' } as never;
  b.nativeIdentity = { provider: 'other', namespace: 'https://forum.example.org/', nativeId: 'A', evidenceId: 'ev:source' } as never;
  assert.equal(DirectorySnapshotSchema.safeParse(snapshot(a, b)).success, true);
  a.nativeIdentity.nativeId = 'a:b'; b.nativeIdentity.namespace = 'https://forum.example.org/:a' as never; b.nativeIdentity.nativeId = 'b';
  assert.equal(DirectorySnapshotSchema.safeParse(snapshot(a, b)).success, true);
});

test('checked date cannot precede its referenced observations', () => {
  const work = record(); work.evidence[0].observedDate = '2026-11-17';
  assert.equal(DirectoryWorkSchema.safeParse(work).success, false);
});

test('snapshot rejects duplicate directed relation triples and global claim identities', () => {
  const repo = record(); const pub = record('work:paper', 'publication'); pub.nativeIdentity = null as never;
  const link = { id: 'rel:1', fromId: repo.id, toId: pub.id, predicate: 'repository-cites-work', evidenceIds: ['ev:source'], reviewId: 'review:1' };
  repo.relations.push(link, { ...link, id: 'rel:2' }); assert.equal(DirectorySnapshotSchema.safeParse(snapshot(repo, pub)).success, false);
  repo.relations.pop(); pub.claims[0].id = repo.claims[0].id; assert.equal(DirectorySnapshotSchema.safeParse(snapshot(repo, pub)).success, false);
});

test('generic local software without health purpose is not a valid lean listing', () => {
  const work = record(); work.claims = [work.claims[1]];
  assert.equal(DirectoryWorkSchema.safeParse(work).success, false);
});

test('regional author scope binds a source index and cannot silently become an account identity', () => {
  const work = record(); const region = work.claims[1]; region.subjectRole = 'author-affiliation';
  assert.equal(DirectoryWorkSchema.safeParse(work).success, false);
  region.sourceAuthorIndex = 3 as never; region.subjectLabel = 'Author label from source';
  assert.equal(DirectoryWorkSchema.safeParse(work).success, true);
});

test('native facts and reviewed claims require known evidence and matching work subject', () => {
  const work = record(); work.title.evidenceId = 'ev:missing';
  assert.equal(DirectoryWorkSchema.safeParse(work).success, false);
  work.title.evidenceId = 'ev:source'; work.claims[0].reviewId = 'review:missing';
  assert.equal(DirectoryWorkSchema.safeParse(work).success, false);
  work.claims[0].reviewId = 'review:1'; work.claims[0].subjectId = 'work:other';
  assert.equal(DirectoryWorkSchema.safeParse(work).success, false);
});

test('snapshot relation direction and endpoints are explicit and closed', () => {
  const repo = record(); const pub = record('work:paper', 'publication'); pub.nativeIdentity = null as never;
  repo.relations.push({ id: 'rel:1', fromId: repo.id, toId: pub.id, predicate: 'repository-cites-work', evidenceIds: ['ev:source'], reviewId: 'review:1' });
  assert.equal(DirectorySnapshotSchema.safeParse(snapshot(repo, pub)).success, true);
  repo.relations[0].predicate = 'work-links-repository';
  assert.equal(DirectorySnapshotSchema.safeParse(snapshot(repo, pub)).success, false);
  repo.relations[0].predicate = 'repository-cites-work';
  assert.equal(DirectorySnapshotSchema.safeParse(snapshot(repo)).success, false);
});

test('topic requires the frozen vocabulary, revision and evidence reference', () => {
  const work = record(); work.claims.push({ id: 'claim:topic', subjectId: work.id, evidenceIds: ['ev:source'], reviewId: 'review:1', kind: 'topic', topic: 'machine-learning', vocabularyRevision: DIRECTORY_TOPIC_REVISION } as never);
  assert.equal(DirectoryWorkSchema.safeParse(work).success, true);
  (work.claims[2] as unknown as {topic: string}).topic = 'everything-is-ai';
  assert.equal(DirectoryWorkSchema.safeParse(work).success, false);
});

test('duplicate identifiers, unsafe URLs, bad hashes and private fields are rejected', () => {
  const duplicate = record(); duplicate.evidence.push({ ...duplicate.evidence[0] }); assert.equal(DirectoryWorkSchema.safeParse(duplicate).success, false);
  const badUrl = record(); badUrl.url.value = 'https://user:password@example.org/'; assert.equal(DirectoryWorkSchema.safeParse(badUrl).success, false);
  const badHash = record(); badHash.evidence[0].observationSha256 = 'abc'; assert.equal(DirectoryWorkSchema.safeParse(badHash).success, false);
  const privateField = { ...record(), privateReviewNotes: 'not public' }; assert.equal(DirectoryWorkSchema.safeParse(privateField).success, false);
});

test('long malformed JSON pointer is rejected without pathological backtracking', () => {
  const work = record(); work.evidence[0].pointer = '/'.repeat(900) + '~2';
  assert.equal(DirectoryWorkSchema.safeParse(work).success, false);
});

test('schema validity does not prove external source content or review authority', () => {
  const work = record(); work.claims[0].text = 'Syntactically valid but unsupported assertion';
  assert.equal(DirectoryWorkSchema.safeParse(work).success, true);
  // Separate GL04 reconstruction, source use and authority validation are mandatory.
});


test('private frontier preserves provisional collection lead and never grants publication', () => {
  const item = { schemaVersion: 'discovery-directory-private-frontier-v1', id: 'candidate:1', revision: 1,
    source: { kind: 'collection-lead', provider: 'github', sourceId: 'source:1', scopeId: 'scope:1', pageReceiptId: 'page:1', requestSha256: 'c'.repeat(64), representationSha256: 'd'.repeat(64), leadIndex: 0, lead: { nativeId: '123', kind: 'artifact', artifactKind: 'repository', displayName: 'Quiet project', sourceStage: 'baseline', sourceDates: [], relatedAccounts: [], unresolvedPeople: [], publicationAuthorized: false } },
    disposition: 'ready-for-reviewed-projection', duplicateOf: null, reason: null, publicationAuthorized: false };
  assert.equal(DirectoryPrivateFrontierSchema.safeParse(item).success, true);
  assert.equal(DirectoryPrivateFrontierSchema.safeParse({ ...item, publicationAuthorized: true }).success, false);
  assert.equal(DirectoryPrivateFrontierSchema.safeParse({ ...item, source: { ...item.source, lead: { ...item.source.lead, publicationAuthorized: true } } }).success, false);
  assert.equal(DirectoryPrivateFrontierSchema.safeParse({ ...item, disposition: 'duplicate' }).success, false);
  for (const disposition of ['needs-evidence', 'ineligible', 'duplicate']) assert.equal(DirectoryPrivateFrontierSchema.safeParse({ ...item, disposition, duplicateOf: disposition === 'duplicate' ? 'candidate:2' : null }).success, false);
  assert.equal(DirectoryPrivateFrontierSchema.safeParse({ ...item, disposition: 'duplicate', duplicateOf: 'candidate:2', reason: 'Same source identity' }).success, true);
  assert.equal(DirectoryWorkSchema.safeParse(item).success, false);
  assert.equal(DirectorySnapshotSchema.safeParse({ schemaVersion: 'discovery-directory-snapshot-v1', version: 'snapshot:1', works: [item] }).success, false);
});

test('safe source fragments are supported without allowing fragment-bearing installation identity', () => {
  const work = record(); work.url.value = 'https://example.org/discussion#post-3'; work.evidence[0].sourceUrl = 'https://example.org/file#L10';
  assert.equal(DirectoryWorkSchema.safeParse(work).success, true);
  work.nativeIdentity = { provider: 'other', namespace: 'https://forum.example/#unsafe', nativeId: '3', evidenceId: 'ev:source' } as never;
  assert.equal(DirectoryWorkSchema.safeParse(work).success, false);
  work.nativeIdentity.namespace = 'not-a-url' as never;
  assert.doesNotThrow(() => DirectoryWorkSchema.safeParse(work));
  assert.equal(DirectoryWorkSchema.safeParse(work).success, false);
});
