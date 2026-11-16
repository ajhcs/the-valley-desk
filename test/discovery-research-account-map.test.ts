import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { buildResearchAccountMap } from '../src/ingest/discovery/research-account-map';

const source = 'docs/discovery/go-live/evidence/GL05/test-account-leads.json';
const fixture = () => ({ title: 'test', observedDate: '2026-11-16', status: 'private', method: 'fixture', publicationAuthorized: false, accounts: [{
  account: 'Example', accountUrl: 'https://github.com/Example', accountType: null, person: 'Same Name', institutionOrLab: 'Lab A', affiliationTimeScope: '2020', region: { municipality: null, county: 'Mercer', basis: 'campus only', source: 'https://example.org/campus' }, accountLinkSource: 'https://example.org/lab', relationshipBasis: 'Lab links repository; ownership not established', publicationAuthorized: false, repositories: [{ url: 'https://github.com/Example/Repo', purpose: 'neuroscience modeling', purposeSource: 'https://example.org/research', githubPageChecked: false, note: null }],
}] });

test('casefolded account and repository duplicates retain distinct conflicting source occurrences', () => {
  const data = fixture();
  const second = structuredClone(data.accounts[0]);
  second.account = 'example'; second.accountUrl = 'https://github.com/example'; second.repositories[0].url = 'https://github.com/example/repo';
  second.institutionOrLab = 'Lab B'; second.region.county = 'Camden';
  data.accounts.push(second);
  const map = buildResearchAccountMap([{ source, data }]);
  assert.equal(map.counts.accountHandles, 1); assert.equal(map.counts.repositories, 1); assert.equal(map.counts.personOccurrences, 2);
  assert.equal(map.accounts[0].occurrenceIds.length, 2); assert.equal(map.repositories[0].occurrenceIds.length, 2);
  assert.deepEqual(map.occurrences.map(o => o.region.county), ['Mercer', 'Camden']);
  assert.ok(map.occurrences.every(o => o.personAccountEdge === null && o.currentEmployment === null && o.projectWorksite === null));
  assert.equal(map.counts.distinctPeople, null);
  assert.deepEqual(map.repositories[0].relevance, ['triage-general-method-or-neuroscience-health-purpose-review-required']);
  assert.deepEqual(buildResearchAccountMap([{ source, data }]), map);
});

test('rejects public authorization, mismatched namespace, and insecure evidence', () => {
  const publicData = fixture(); publicData.publicationAuthorized = true;
  assert.throws(() => buildResearchAccountMap([{ source, data: publicData }]));
  const publicEntry = fixture(); publicEntry.accounts[0].publicationAuthorized = true;
  assert.throws(() => buildResearchAccountMap([{ source, data: publicEntry }]));
  const nested = fixture(); (nested.accounts[0].repositories[0] as any).publicationAuthorized = true;
  assert.throws(() => buildResearchAccountMap([{ source, data: nested }]));
  const mismatch = fixture(); mismatch.accounts[0].repositories[0].url = 'https://github.com/Other/Repo';
  assert.throws(() => buildResearchAccountMap([{ source, data: mismatch }]), /owner mismatch/);
  const insecure = fixture(); insecure.accounts[0].repositories[0].purposeSource = 'http://example.org/research';
  assert.throws(() => buildResearchAccountMap([{ source, data: insecure }]));
});

test('actual source files preserve private boundaries and evidence references', async () => {
  const inputs = await Promise.all(['pa-account-leads', 'nj-account-leads', 'pa-account-leads-supplement', 'nj-account-leads-supplement', 'root-account-leads'].map(async state => {
    const source = `docs/discovery/go-live/evidence/GL05/${state}.json`;
    return { source, data: JSON.parse(await readFile(source, 'utf8')) };
  }));
  const map = buildResearchAccountMap(inputs);
  assert.equal(map.publicationAuthorized, false);
  assert.ok(map.counts.accountHandles > 28); assert.ok(map.counts.repositories > 27); assert.equal(map.counts.personOccurrences, 11);
  assert.equal(map.repositories.filter(r => r.key === 'mlbc-lab/lungclust').length, 1);
  assert.equal(map.repositories.find(r => r.key === 'mlbc-lab/lungclust')!.occurrenceIds.length, 2);
  assert.equal(map.occurrences.find(o => o.accountKey === 'shannonpileggi').personResourceAssociation.type, 'source-person-resource-association');
  assert.equal(map.occurrences.find(o => o.accountKey === 'nickabattista').personResourceAssociation.type, 'source-person-resource-association');
  assert.equal(map.occurrences.filter(o => o.repositories.length === 0).length, 8);
  assert.ok(map.occurrences.every(o => !o.publicationAuthorized && o.novelty.startsWith('unknown') && (o.id.includes('#/accounts/') || o.id.includes('#/accountOnlyLeads/'))));
  const sacan = map.occurrences.find(o => o.accountKey === 'sacanlab');
  assert.equal(sacan.personAccountEdge, null); assert.match(sacan.personOccurrence.role, /paper-author/);
  const princeton = map.occurrences.find(o => o.accountKey === 'murthylab');
  assert.equal(princeton.region.county, 'Mercer'); assert.equal(princeton.projectWorksite, null);
});

test('baseline reconciliation uses literal URL matches and leaves others unknown', () => {
  const map = buildResearchAccountMap([{ source, data: fixture() }], [{ source: 'baseline.json', data: { url: 'https://github.com/EXAMPLE/REPO' } }]);
  assert.equal(map.accounts[0].reconciliation.status, 'matched-existing-url');
  assert.equal(map.repositories[0].reconciliation.status, 'matched-existing-url');
  assert.deepEqual(map.repositories[0].reconciliation.evidence, ['baseline.json#/url']);
  const unmatched = buildResearchAccountMap([{ source, data: fixture() }]);
  assert.equal(unmatched.repositories[0].reconciliation.status, 'unknown');
});

test('generated input hashes bind exact five sources and script rejects unknown arguments', async () => {
  const map = JSON.parse(await readFile('docs/discovery/go-live/evidence/GL05/research-account-map.json', 'utf8'));
  assert.equal(map.inputSources.length, 5);
  for (const input of map.inputSources) assert.equal(createHash('sha256').update(await readFile(input.source)).digest('hex'), input.sha256);
  const invalid = spawnSync(process.execPath, ['--import', 'tsx/esm', 'scripts/build-research-account-map.mjs', '--invalid'], { encoding: 'utf8' });
  assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /Usage:/);
});
