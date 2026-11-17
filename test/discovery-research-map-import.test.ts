import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyGithubUrl } from '../src/ingest/discovery/research-map-import';

test('publication link classification separates resources from paths and malformed fragments', () => {
  assert.deepEqual(classifyGithubUrl('https://github.com/Owner/Repo'), { kind: 'repository-url', accountKey: 'owner', repositoryKey: 'owner/repo' });
  assert.equal(classifyGithubUrl('https://github.com/Owner').kind, 'account-url');
  assert.equal(classifyGithubUrl('https://github.com/Owner/Repo/blob/main/file.txt').kind, 'file-path-reference');
  for (const value of ['github.com/owner/repo', 'https://github.com', 'https://github.com/owner/repo#frag', 'https://example.org/owner/repo', 'https://github.com/a//b', 'https://github.com//owner/repo']) assert.equal(classifyGithubUrl(value).kind, 'invalid-fragment');
  for (const path of ['/orgs/Penn/repositories', '/topics/health', '/search/code', '/organizations/Penn', '/users/example', '/login', '/ORGs/Penn']) {
    assert.deepEqual(classifyGithubUrl('https://github.com'+path), {kind:'invalid-fragment', accountKey:null, repositoryKey:null});
  }
});

import { mergeResearchMap } from '../src/ingest/discovery/research-map-import';
const existing = { publicationAuthorized: false, accounts: [{ key: 'test', url: 'https://github.com/test' }], repositories: [{ key: 'test/repo', url: 'https://github.com/test/repo' }] };
const native = { nativeId: '123', url: 'https://github.com/Test/Repo', fork: false, archived: false };
test('native IDs reconcile only by matching URL, with zero and failed accounts retained', () => {
  const result = mergeResearchMap(existing, { accounts: [{ handle: 'Test', status: 'observed', repositories: [native] }, { handle: 'empty', status: 'observed', repositories: [] }, { handle: 'failed', status: 'failed', repositories: [] }] }, [{ articleId: 'PMC1', url: 'https://github.com/Test/Repo' }]);
  assert.deepEqual(result.counts, { accounts: 3, repositories: 1, nativeObservedRepositories: 1, urlOnlyRepositories: 0, matchedExistingAccounts: 1, matchedExistingRepositories: 1, publicationPairs: 1 });
  assert.equal(result.publicationQueue[0].relationship, 'unknown');
  assert.equal(result.accounts.find(a => a.key === 'failed')!.censusStatus, 'failed');
  assert.equal(result.accounts.find(a => a.key === 'empty')!.nativeRepositoryCount, 0);
});
test('rejects conflicting native aliases, repeated account and publication pairs', () => {
  const account = { handle: 'test', status: 'observed', repositories: [native, { ...native, url: 'https://github.com/test/other' }] };
  assert.throws(() => mergeResearchMap(existing, { accounts: [account] }, []));
  assert.throws(() => mergeResearchMap(existing, { accounts: [{ ...account, repositories: [] }, { ...account, repositories: [] }] }, []));
  assert.throws(() => mergeResearchMap(existing, { accounts: [] }, [{ articleId: 'P', url: 'bad' }, { articleId: 'P', url: 'bad' }]));
});

import { readFile } from 'node:fs/promises';
import { importSanitizedResearchMap } from '../src/ingest/discovery/research-map-import';
test('sanitized intake retains actual coverage and withholds untrusted fields', async () => {
  const dir = 'docs/discovery/go-live/evidence/GL05/';
  const read = async (path: string) => JSON.parse(await readFile(dir + path, 'utf8'));
  const [base, accounts, publications] = await Promise.all([read('research-account-map.json'), read('jefferson-import-20261117/account-evidence.json'), read('jefferson-import-20261117/publication-links.json')]);
  accounts.accounts[0].privateContact = 'must not propagate';
  accounts.accounts[0].repositories[0].abstract = 'must not propagate';
  assert.throws(() => importSanitizedResearchMap(base, accounts, publications));
  delete accounts.accounts[0].privateContact; delete accounts.accounts[0].repositories[0].abstract;
  const map = importSanitizedResearchMap(base, accounts, publications);
  assert.deepEqual(map.counts, { accounts: 68, repositories: 277, nativeObservedRepositories: 231, urlOnlyRepositories: 46, matchedExistingAccounts: 2, matchedExistingRepositories: 1, publicationPairs: 504 });
  assert.equal(map.sourceAccounts.find(a => a.handle === 'cpnn-lab')!.reportedRepositoryCount, 0);
  assert.equal(map.sourceAccounts.find(a => a.handle === 'talexand003')!.reportedRepositoryCount, null);
  assert.equal(map.sourceAccounts.find(a => a.handle === 'talexand003')!.repositories, null);
  assert.ok(!JSON.stringify(map).includes('must not propagate'));
  assert.ok(map.publicationQueue.every(row => row.review === 'unreviewed' && row.relationship === 'unknown' && row.publicationAuthorized === false));
  assert.equal(map.publicationQueue.filter(row => row.url === null).length, 14);
});

import { verifyIntakeOutput } from '../src/ingest/discovery/research-map-import';
import { createHash } from 'node:crypto';
test('byte receipt detects mutations and byte-count mismatches', () => {
  const bytes = Buffer.from('source'); const sha256 = createHash('sha256').update(bytes).digest('hex');
  verifyIntakeOutput({ sha256, bytes: bytes.length }, { sha256, bytes: bytes.length });
  assert.throws(() => verifyIntakeOutput({ sha256: createHash('sha256').update('sourcf').digest('hex'), bytes: bytes.length }, { sha256, bytes: bytes.length }));
  assert.throws(() => verifyIntakeOutput({ sha256, bytes: bytes.length }, { sha256, bytes: 100 }));
});
test('intake rejects impossible dates and missing withheld URL hashes', async () => {
  const dir = 'docs/discovery/go-live/evidence/GL05/';
  const read = async (p: string) => JSON.parse(await readFile(dir + p, 'utf8'));
  const [base, accounts, pubs] = await Promise.all([read('research-account-map.json'), read('jefferson-import-20261117/account-evidence.json'), read('jefferson-import-20261117/publication-links.json')]);
  const broken = structuredClone(accounts); broken.observedDate = '2026-02-30';
  assert.throws(() => importSanitizedResearchMap(base, broken, pubs));
  const invalidArticle = structuredClone(pubs); invalidArticle.rows[0].articleId = 'not-a-PMC';
  assert.throws(() => importSanitizedResearchMap(base, accounts, invalidArticle));
  const missing = structuredClone(pubs); missing.rows.find((r: any) => r.url === null).withheldUrlSha256 = null;
  assert.throws(() => importSanitizedResearchMap(base, accounts, missing), /requires hash/);
});
