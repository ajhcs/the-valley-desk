import assert from 'node:assert/strict';
import test from 'node:test';
import catalog from '../src/content/discovery-directory-catalog.json';
import {DirectorySnapshotSchema} from '../src/content/discovery-directory';
import {directoryInstitutionHref, directorySourceAccount} from '../src/ingest/discovery-directory-journeys';
import {parseDirectoryQuery, readDirectoryList} from '../src/ingest/discovery-directory-search';

const snapshot = DirectorySnapshotSchema.parse(catalog);
const sleepBoost = snapshot.works.find(w => w.nativeIdentity?.nativeId === '617168725')!;

test('institution detail links reuse the existing filter over the released catalog', async () => {
  const claim = sleepBoost.claims.find(c => c.kind === 'regional-connection');
  assert.ok(claim?.institution);
  const link = directoryInstitutionHref(claim.institution);
  assert.ok(link);
  const url = new URL(link, 'https://thevalleydesk.org');
  assert.equal(url.pathname, '/discover/works');
  const query = parseDirectoryQuery(url.searchParams);
  assert.equal(query.institution, 'Rutgers University–Camden');
  assert.ok((await readDirectoryList(snapshot, query)).items.some(item => item.id === sleepBoost.id));
  const separator = directoryInstitutionHref('Research & Development');
  assert.ok(separator);
  assert.deepEqual([...new URL(separator, url).searchParams], [['institution', 'Research & Development']]);
  assert.equal(directoryInstitutionHref(' '), null);
  assert.equal(directoryInstitutionHref('x'.repeat(201)), null);
});

test('only GitHub repos with exact bound release evidence expose observed namespaces', () => {
  const retainedPacketRepo = snapshot.works.find(w => w.nativeIdentity?.nativeId === '760662846')!;
  assert.equal(directorySourceAccount(retainedPacketRepo)?.login, 'newilson');
  for (const publication of snapshot.works.filter(w => w.kind === 'publication')) {
    assert.equal(directorySourceAccount(publication), null);
  }
  assert.deepEqual(directorySourceAccount(sleepBoost), {
    href: 'https://github.com/akibzaman', login: 'akibzaman', observedDate: '2026-11-16',
  });
  assert.ok(directorySourceAccount({...sleepBoost, owner: null}));
});

test('namespace links fail closed on substituted evidence or ambiguous original URLs', () => {
  const draft = () => structuredClone(sleepBoost);
  const original = (work: typeof sleepBoost) => work.evidence.find(e => e.id === work.url.evidenceId)!;
  const native = (work: typeof sleepBoost) => work.evidence.find(e => e.id === work.nativeIdentity!.evidenceId)!;
  for (const update of [
    (work: typeof sleepBoost) => { native(work).pointer = '/owner/id'; },
    (work: typeof sleepBoost) => { native(work).observationSha256 = 'b'.repeat(64); },
    (work: typeof sleepBoost) => { native(work).observedDate = '2026-11-15'; },
    (work: typeof sleepBoost) => { original(work).sourceUrl = native(work).sourceUrl = 'https://api.github.com/repos/akibzaman/Other'; },
    (work: typeof sleepBoost) => { work.url.value = 'https://github.com.evil.test/akibzaman/SleepBoost'; },
    (work: typeof sleepBoost) => { work.url.value = 'https://github.com/akibzaman/SleepBoost/issues'; },
    (work: typeof sleepBoost) => { work.url.value = 'https://github.com/akibzaman/SleepBoost?ref=other'; },
    (work: typeof sleepBoost) => { work.owner = {name: 'differentAccount', kind: 'User', nativeId: null, evidenceId: work.url.evidenceId}; },
  ]) {
    const work = draft();
    update(work);
    assert.equal(directorySourceAccount(work), null);
  }
});
