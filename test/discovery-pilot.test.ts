import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DiscoveryPilotCatalogSchema, DiscoveryPilotResultSchema } from '../src/content/discovery-pilot';
import { handleDiscoveryPilot, parseDiscoveryPilotQuery, queryDiscoveryPilot, readDiscoveryPilot } from '../src/ingest/discovery-pilot';
import { buildDiscoveryPilotCatalog, canonicalPilotJson, parsePilotJson, pilotPointer } from '../scripts/build-discovery-pilot.mjs';
import { pilotAffiliationLabel, pilotAuthorPreview, pilotDateLabel, pilotRecordPath } from '../src/ui/discovery/pilot-presentation';
const selectionFile = new URL('../fixtures/discovery-pilot-selection.json', import.meta.url);
const catalogFile = new URL('../src/content/discovery-pilot-catalog.json', import.meta.url);
const selection = async () => JSON.parse(await readFile(selectionFile, 'utf8'));
const catalog = async () => JSON.parse(await readFile(catalogFile, 'utf8'));
const raw = async (path: string) => readFile(new URL(`../${path}`, import.meta.url));
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const request = (query = '', method = 'GET') => new Request(`https://pilot.invalid/api/discovery-pilot${query}`, {
  method
});
// Keep the original finite selection as a named regression subset when the
// catalog grows. These identities and counts come from the reviewed first batch.
const baselineAuthorCounts = new Map([
  ['crossref:10.1038/s41592-021-01185-5', 42],
  ['crossref:10.1117/1.jmi.5.1.011018', 25],
  ['crossref:10.1093/bioinformatics/btae114', 14],
  ['crossref:10.1093/bioinformatics/btaf060', 9],
  ['crossref:10.1186/1471-2105-15-248', 9],
  ['crossref:10.1093/bib/bbaa381', 10],
]);
const baselineRepositoryIds = ['github:156589095', 'github:128938343', 'github:525946788', 'github:734388793', 'github:15715626', 'github:285885136'];
const baselineIds = new Set([...baselineRepositoryIds, ...baselineAuthorCounts.keys(), 'ror:00b30xv10', 'ror:01z7r7q48']);
const baselineCatalog = (value: Awaited<ReturnType<typeof buildDiscoveryPilotCatalog>>) => ({
  ...value, records: value.records.filter(record => baselineIds.has(record.id)),
  regionalContexts: value.regionalContexts.filter(context => baselineIds.has(context.recordId)),
});
const expansionPairs = [
  { repositoryId: 'github:256420694', repository: 'PennLINC/aslprep', doi: '10.1038/s41592-022-01458-7', authorCount: 114, commit: '48a418cf92b57c5c66502286d2847fd742cbbd48', path: 'CITATION.cff' },
  { repositoryId: 'github:342691278', repository: 'mlcommons/GaNDLF', doi: '10.1038/s44172-023-00066-3', authorCount: 42, commit: '3f9b7726925be0f97a8a0eb108c8f35b19ff50dd', path: 'README.md' },
  { repositoryId: 'github:163997867', repository: 'CBICA/HistoReg', doi: '10.3390/app11041892', authorCount: 6, commit: '5f7290781ae519b5ae930e85be594576576df853', path: 'README.md' },
  { repositoryId: 'github:390797198', repository: 'PennLINC/ModelArray', doi: '10.1016/j.neuroimage.2023.120037', authorCount: 18, commit: 'b38bb2582d38e82040e25aa5b08c98161287411a', path: 'README.Rmd' },
];
// EX30 is a second fixed regression subset. County expansion must preserve all
// twenty-two reviewed record objects, including their original evidence.
const ex30Ids = new Set([...baselineIds, ...expansionPairs.flatMap(pair => [pair.repositoryId, `crossref:${pair.doi}`])]);
const ex30Catalog = (value: Awaited<ReturnType<typeof buildDiscoveryPilotCatalog>>) => ({
  ...value, records: value.records.filter(record => ex30Ids.has(record.id)),
  regionalContexts: value.regionalContexts.filter(context => ex30Ids.has(context.recordId)),
});
const countyPairs = [
  { repositoryId: 'github:692249664', repository: 'raphael-group/GASTON', owner: { id: '5168500', name: 'raphael-group', kind: 'Organization' }, doi: '10.1038/s41592-024-02503-3', authorCount: 7, commit: '79577c45111b3442b808c8e620711b822965493b', blob: '19ce1b5ac3d58264baf7e49aa32b60a1b89b492b', lines: [71, 88], authorQuery: 'Uthsav Chitra' },
  { repositoryId: 'github:617168725', repository: 'akibzaman/SleepBoost', owner: { id: '55422467', name: 'akibzaman', kind: 'User' }, doi: '10.1007/s11517-024-03096-x', authorCount: 5, commit: '0ad7794aa201698f362562f86d2e191c969b9ab5', blob: 'e7b737ac479260f68467f52ed5c113c72539b579', lines: [1, 3], authorQuery: 'Iman Dehzangi' },
  { repositoryId: 'github:192607622', repository: 'AlexsLemonade/OpenPBTA-analysis', owner: { id: '29661525', name: 'AlexsLemonade', kind: 'Organization' }, doi: '10.1016/j.xgen.2023.100340', authorCount: 66, commit: 'e854738b57b16c3725673ad63b4ffd20ec48ad19', blob: 'af5e9b0375e0f150c519a81eed0015de5aacd88f', lines: [1, 12], authorQuery: 'Stephanie J. Spielman' },
];
test('retained-byte projection is deterministic, source-traced and preserves 22 distinct EX30 listings', async () => {
  const selected = await selection(),
    generated = await buildDiscoveryPilotCatalog(selected);
  assert.deepEqual(generated, await catalog());
  assert.deepEqual(await buildDiscoveryPilotCatalog(selected), generated);
  assert.equal(generated.records.length, 28);
  assert.equal(sha(canonicalPilotJson(generated.records)), '7d21281dfd8da10fe9b6d2f107d08558e80b695e1e5fb1560ee34aea281d6f01');
  assert.equal(ex30Catalog(generated).records.length, 22);
  assert.equal(baselineCatalog(generated).records.length, 14);
  assert.equal(sha(canonicalPilotJson(ex30Catalog(generated).records)), '47fedcc07ef997a84055e722a5e94f31fbcb31f246b4e4572cd292fed0a981ef');
  assert.deepEqual(queryDiscoveryPilot(ex30Catalog(generated), {}).counts, {
    repository: 10,
    publication: 10,
    organization: 2
  });
  assert.equal(generated.selectionSha256, sha(canonicalPilotJson(selected)));
  assert.equal(new Set(generated.records.map(record => `${record.provider}:${record.nativeId}`)).size, generated.records.length);
  for (const record of generated.records) {
    const source = (Object.values(selected.sources).find((value: any) => value.sha256 === record.source.sha256) as any);
    assert.ok(source);
    const bytes = await raw(source.bodyPath);
    assert.equal(sha(bytes), record.source.sha256);
    assert.equal(record.source.observedAt, source.observedAt);
    assert.equal(record.source.url, source.requestUrl);
    assert.equal(record.geography.county, null);
    assert.ok(record.provenance.some(value => value.field === 'nativeId'));
    assert.ok(record.provenance.some(value => value.field === 'title'));
  }
});
test('the actual county batch adds exactly three source-bound pairs and nine total directed citations', async () => {
  const selected = await selection();
  const generated = await buildDiscoveryPilotCatalog(selected);
  const actualNewIds = generated.records.filter(record => !ex30Ids.has(record.id)).map(record => record.id).sort();
  assert.deepEqual(actualNewIds, countyPairs.flatMap(pair => [pair.repositoryId, `crossref:${pair.doi}`]).sort());
  assert.deepEqual(queryDiscoveryPilot(generated, {}).counts, { repository: 13, publication: 13, organization: 2 });
  assert.equal(generated.records.flatMap(record => record.relatedLinks).length, 9);
  const publicationOnly = await readDiscoveryPilot(generated, { kind: 'publication' });
  assert.equal(publicationOnly.items.length, 13);
  assert.equal(publicationOnly.citations.length, 9);
  assert.ok(publicationOnly.items.every(record => record.relatedLinks.length === 0));
  for (const expected of countyPairs) {
    const repository = generated.records.find(record => record.id === expected.repositoryId)!;
    const publication = generated.records.find(record => record.id === `crossref:${expected.doi}`)!;
    assert.equal(repository.kind, 'repository');
    assert.equal(repository.nativeId, expected.repositoryId.slice('github:'.length));
    assert.equal(repository.title, expected.repository);
    assert.deepEqual(repository.owner, expected.owner);
    assert.equal(repository.source.url, `https://api.github.com/repos/${expected.repository}`);
    assert.equal(publication.nativeId, expected.doi);
    assert.equal(publication.authors.length, expected.authorCount);
    assert.equal(repository.relatedLinks.length, 1);
    const link = repository.relatedLinks[0];
    assert.equal(link.targetId, publication.id);
    assert.equal(link.targetTitle, publication.title);
    assert.equal(link.url, publication.url);
    assert.equal(link.relation, 'cites-publication');
    assert.equal(link.evidence.method, 'derived-connector-observation');
    assert.equal(link.evidence.observedAt, '2026-11-16T17:42:05Z');
    assert.equal(link.evidence.url, `https://github.com/${expected.repository}/blob/${expected.commit}/README.md`);
    const relation = selected.relationships.find((entry: any) => entry.fromId === repository.id);
    assert.ok(relation);
    assert.equal(relation.file.value.blob_sha, expected.blob);
    assert.deepEqual(relation.file.value.lines, expected.lines);
    assert.deepEqual(relation.file.value.doi_mentions, [expected.doi]);
    assert.equal(relation.file.value.raw_body_persisted, false);
    assert.deepEqual(repository.authors, []);
    assert.deepEqual(repository.geography, { basis: 'not-established', reportedLocations: [], county: null });
    assert.equal(publication.owner, null);
    assert.deepEqual(publication.relatedLinks, []);
  }
});
test('county publication affiliation gaps stay empty and research-only thread is not selected', async () => {
  const selected = await selection();
  const generated = await buildDiscoveryPilotCatalog(selected);
  for (const expected of countyPairs) {
    const publication = generated.records.find(record => record.id === `crossref:${expected.doi}`)!;
    assert.ok(publication.authors.every(author => author.affiliations.length === 0));
    assert.deepEqual(publication.geography, { basis: 'publication-reported-affiliation', reportedLocations: [], county: null });
  }
  const sleep = generated.records.find(record => record.id === 'crossref:10.1007/s11517-024-03096-x')!;
  assert.equal(sleep.authors[3].name, 'Iman Dehzangi');
  assert.ok(!generated.records.some(record => ['github:218530629', 'crossref:10.1101/2020.01.15.908459', 'crossref:10.1371/journal.pcbi.1008638'].includes(record.id)));
  assert.ok(!Object.values(selected.sources).some((source: any) => source.requestUrl === 'https://api.github.com/repos/mathiesonlab/thread' || source.requestUrl.includes('2020.01.15.908459')));
  const unselected = await readDiscoveryPilot(generated, { q: '10.1101/2020.01.15.908459' });
  assert.equal(unselected.items.length, 0);
  assert.deepEqual(unselected.citations, []);
});
test('each county pair supports DOI, repository and author search with exact citation direction', async () => {
  const generated = await catalog();
  for (const expected of countyPairs) {
    for (const q of [expected.doi, expected.authorQuery]) {
      const result = await readDiscoveryPilot(generated, { q, kind: 'repository' });
      assert.deepEqual(result.items.map(record => record.id), [expected.repositoryId]);
      assert.deepEqual(result.matches, [{ recordId: expected.repositoryId, basis: 'cited-publication', relatedRecordId: `crossref:${expected.doi}` }]);
      assert.deepEqual(result.items[0].authors, []);
      assert.equal(result.items[0].geography.county, null);
    }
    const paperResult = await readDiscoveryPilot(generated, { q: expected.repository, kind: 'publication' });
    assert.deepEqual(paperResult.items.map(record => record.id), [`crossref:${expected.doi}`]);
    assert.deepEqual(paperResult.matches, [{ recordId: `crossref:${expected.doi}`, basis: 'citing-repository', relatedRecordId: expected.repositoryId }]);
    assert.equal(paperResult.citations[0].repository.id, expected.repositoryId);
    assert.equal(paperResult.citations[0].publication.id, `crossref:${expected.doi}`);
    assert.deepEqual(paperResult.items[0].relatedLinks, []);
  }
});
test('whitelist excludes native author internals, full text, private paths and rights inferences', async () => {
  const value = await readDiscoveryPilot(await catalog(), {}),
    serialized = JSON.stringify(value);
  for (const forbidden of ['bodyPath', 'ORCID', 'authenticated-orcid', 'raw_body', 'license_hint', 'README text', '/workspace/', '.discovery-work', 'publicationAuthorized', 'currentEmploymentConfirmed', 'abstract', '"html_url":']) assert.ok(!serialized.includes(forbidden), forbidden);
  assert.ok(value.items.filter(row => row.kind === 'repository').every(row => row.authors.length === 0 && row.geography.basis === 'not-established'));
  assert.ok(value.items.filter(row => baselineRepositoryIds.includes(row.id) || expansionPairs.some(pair => pair.repositoryId === row.id)).every(row => row.owner?.kind === 'Organization'));
  assert.ok(value.items.filter(row => row.kind === 'publication').every(row => row.owner === null && row.geography.basis === 'publication-reported-affiliation'));
  assert.ok(value.items.filter(row => row.kind === 'organization').every(row => row.owner === null && row.authors.length === 0 && row.geography.basis === 'registry-reported-location'));
  assert.equal(value.items.find(row => row.id === 'github:156589095')?.sourceDate?.label, 'Repository pushed');
  assert.equal(value.items.find(row => row.id.startsWith('crossref:'))?.sourceDate?.label, 'Published');
});
test('repository owner identities and User or Organization roles remain exactly source-reported', async () => {
  const selected = await selection();
  const generated = await buildDiscoveryPilotCatalog(selected);
  for (const repository of generated.records.filter(record => record.kind === 'repository')) {
    const row = selected.records.find((entry: any) => entry.id === repository.id);
    const source = selected.sources[row.fields.nativeId.source];
    const body = JSON.parse((await raw(source.bodyPath)).toString());
    assert.deepEqual(repository.owner, { id: String(body.owner.id), name: body.owner.login, kind: body.owner.type });
    assert.ok(repository.owner?.kind === 'User' || repository.owner?.kind === 'Organization');
    assert.deepEqual(repository.authors, []);
    assert.deepEqual(repository.geography, { basis: 'not-established', reportedLocations: [], county: null });
  }
});
test('the two original directed repository citations retain their exact derived edge/file/time evidence', async () => {
  const value = baselineCatalog(await catalog()),
    links = value.records.flatMap((row: any) => row.relatedLinks.map((link: any) => ({
      from: row,
      link
    })));
  assert.equal(links.length, 2);
  for (const {
    from,
    link
  } of links) {
    assert.equal(from.kind, 'repository');
    assert.equal(link.relation, 'cites-publication');
    assert.equal(link.evidence.method, 'derived-connector-observation');
    const target = value.records.find((row: any) => row.id === link.targetId);
    assert.equal(target.kind, 'publication');
    assert.equal(link.targetTitle, target.title);
    assert.equal(link.url, target.url);
    assert.equal(target.relatedLinks.length, 0);
    assert.match(link.evidence.url, /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[a-f0-9]{40}\//);
    assert.equal(link.evidence.observedAt, '2026-11-15T21:05:10Z');
  }
});
test('the four new repository-publication pairs use the observed pinned citations and preserve source roles', async () => {
  const value = ex30Catalog(await catalog());
  const newRecords = value.records.filter((record: any) => !baselineIds.has(record.id));
  assert.equal(newRecords.length, 8);
  assert.equal(value.records.flatMap((record: any) => record.relatedLinks).length, 6);
  for (const expected of expansionPairs) {
    const repository = value.records.find((record: any) => record.id === expected.repositoryId);
    const publication = value.records.find((record: any) => record.id === `crossref:${expected.doi}`);
    assert.ok(repository, expected.repository);
    assert.ok(publication, expected.doi);
    assert.equal(repository.title, expected.repository);
    assert.equal(repository.source.url, `https://api.github.com/repos/${expected.repository}`);
    assert.equal(repository.kind, 'repository');
    assert.equal(publication.kind, 'publication');
    assert.equal(publication.nativeId, expected.doi);
    assert.equal(publication.authors.length, expected.authorCount);
    assert.equal(repository.relatedLinks.length, 1);
    const link = repository.relatedLinks[0];
    assert.equal(link.targetId, publication.id);
    assert.equal(link.targetTitle, publication.title);
    assert.equal(link.url, publication.url);
    assert.equal(link.relation, 'cites-publication');
    assert.equal(link.evidence.method, 'derived-connector-observation');
    assert.equal(link.evidence.url, `https://github.com/${expected.repository}/blob/${expected.commit}/${expected.path}`);
    assert.deepEqual(repository.authors, []);
    assert.deepEqual(repository.geography, { basis: 'not-established', reportedLocations: [], county: null });
    assert.equal(publication.owner, null);
    assert.equal(publication.geography.basis, 'publication-reported-affiliation');
    assert.equal(publication.geography.county, null);
    assert.deepEqual(publication.relatedLinks, []);
  }
});
test('each new citation supports both browsing directions without transferring publication authors or affiliations', async () => {
  const value = await catalog();
  for (const expected of expansionPairs) {
    const repositoryResult = await readDiscoveryPilot(value, { q: expected.doi, kind: 'repository' });
    assert.deepEqual(repositoryResult.items.map(record => record.id), [expected.repositoryId]);
    assert.deepEqual(repositoryResult.matches, [{ recordId: expected.repositoryId, basis: 'cited-publication', relatedRecordId: `crossref:${expected.doi}` }]);
    assert.deepEqual(repositoryResult.items[0].authors, []);
    assert.deepEqual(repositoryResult.items[0].geography, { basis: 'not-established', reportedLocations: [], county: null });
    const publicationResult = await readDiscoveryPilot(value, { q: expected.repository, kind: 'publication' });
    assert.deepEqual(publicationResult.items.map(record => record.id), [`crossref:${expected.doi}`]);
    assert.deepEqual(publicationResult.matches, [{ recordId: `crossref:${expected.doi}`, basis: 'citing-repository', relatedRecordId: expected.repositoryId }]);
    assert.equal(publicationResult.citations[0].repository.id, expected.repositoryId);
    assert.equal(publicationResult.citations[0].publication.id, `crossref:${expected.doi}`);
    assert.deepEqual(publicationResult.items[0].relatedLinks, []);
  }
});
test('HistoReg affiliation labels clean deposited ampersands while source values and markup-shaped text stay intact', async () => {
  const value = await catalog();
  const result = await readDiscoveryPilot(value, { q: '10.3390/app11041892', kind: 'publication' });
  const paper = result.items[0];
  assert.equal(paper.authors[0].name, 'Ludovic Venet');
  const affiliation = 'Center for Biomedical Image Computing &amp; Analytics, University of Pennsylvania, Philadelphia, PA 19104, USA';
  assert.equal(paper.authors[0].affiliations[0], affiliation);
  assert.equal(paper.authors.flatMap(author => author.affiliations).length, 11);
  assert.equal(pilotAffiliationLabel(affiliation), 'Center for Biomedical Image Computing & Analytics, University of Pennsylvania, Philadelphia, PA 19104, USA');
  assert.equal(paper.authors[0].affiliations[0], affiliation);
  assert.ok(paper.geography.reportedLocations.includes(affiliation));
  assert.equal(value.records.find((record: any) => record.id === paper.id).authors[0].affiliations[0], affiliation);
  const markupShaped = '<img src=x onerror=alert(1)> &amp; lab';
  assert.equal(pilotAffiliationLabel(markupShaped), '<img src=x onerror=alert(1)> & lab');
  assert.equal(renderToStaticMarkup(createElement('span', null, pilotAffiliationLabel(markupShaped))), '<span>&lt;img src=x onerror=alert(1)&gt; &amp; lab</span>');
});
for (const mutation of ['hash', 'native-pointer', 'title-pointer', 'date-pointer', 'author-pointer', 'derived-edge', 'derived-file', 'unsupported-field', 'duplicate-native']) test(`projection refuses ${mutation} disagreement`, async () => {
  const input = await selection();
  if (mutation === 'hash') input.sources[input.records[0].fields.nativeId.source].sha256 = '0'.repeat(64);
  if (mutation === 'native-pointer') {
    input.records[0].fields.nativeId = input.records[0].fields.ownerId;
    input.records[0].id = `github:${input.records[0].fields.ownerId.value}`;
    input.relationships = input.relationships.filter((row: any) => row.fromId !== 'github:156589095');
  }
  if (mutation === 'title-pointer') input.records[0].fields.title = input.records[0].fields.ownerName;
  if (mutation === 'date-pointer') input.records[0].fields.pushedAt = input.records[0].fields.createdAt;
  if (mutation === 'author-pointer') input.records.find((row: any) => row.kind === 'publication').fields.authors[0].pointer += '/affiliation/0';
  if (mutation === 'derived-edge') input.relationships[0].edge.value.doi = '10.9999/unrelated';
  if (mutation === 'derived-file') input.relationships[0].file.value.commit = '0'.repeat(40);
  if (mutation === 'unsupported-field') input.records[0].fields.readme = input.records[0].fields.title;
  if (mutation === 'duplicate-native') input.records.push(structuredClone(input.records[0]));
  await assert.rejects(buildDiscoveryPilotCatalog(input));
});
test('rehashed observations must retain repository, DOI, commit and semantic-pointer agreement', async () => {
  const original = await selection();
  for (let index = 0; index < original.relationships.length; index++) {
    for (const mutation of ['repository', 'doi', 'commit', 'pointer']) {
      const input = structuredClone(original);
      const relation = input.relationships[index];
      const observation = input.observations[relation.edge.observation];
      const body = JSON.parse((await raw(observation.bodyPath)).toString());
      const replace = (pointer: string, value: unknown) => {
        const keys = pointer.slice(1).split('/');
        const parent = keys.slice(0, -1).reduce((value, key) => value[key], body);
        parent[keys.at(-1)!] = value;
      };
      if (mutation === 'repository') {
        relation.edge.value.repository = 'unrelated-owner/unrelated-repository';
        relation.file.value.repository = relation.edge.value.repository;
        relation.file.value.permalink = `https://github.com/${relation.edge.value.repository}/blob/${relation.file.value.commit}/${relation.file.value.path}`;
      }
      if (mutation === 'doi') {
        relation.edge.value.doi = '10.9999/unrelated';
        relation.file.value.doi_mentions = ['10.9999/unrelated'];
      }
      if (mutation === 'commit') {
        relation.file.value.commit = '0'.repeat(40);
        relation.file.value.permalink = `https://github.com/${relation.edge.value.repository}/blob/${relation.file.value.commit}/${relation.file.value.path}`;
      }
      if (mutation === 'pointer') relation.edge.pointer = '/unreviewed_alias';
      replace(relation.edge.pointer, relation.edge.value);
      replace(relation.file.pointer, relation.file.value);
      const bytes = Buffer.from(JSON.stringify(body));
      observation.sha256 = sha(bytes);
      await assert.rejects(buildDiscoveryPilotCatalog(input, (path: string) => path === observation.bodyPath ? Promise.resolve(bytes) : raw(path)),
        mutation === 'pointer' ? /relation-semantic-pointer/ : /relation-binding/, `${index}: ${mutation}`);
    }
  }
});
test('citation relationships cannot invert a publisher-to-repository observation', async () => {
  const input = await selection();
  const relation = input.relationships[0];
  [relation.fromId, relation.toId] = [relation.toId, relation.fromId];
  await assert.rejects(buildDiscoveryPilotCatalog(input), /relation-endpoints/);
});
test('unsafe source links, path traversal and provider-native identity substitutions fail closed', async () => {
  for (const unsafe of ['http://github.com/PennLINC/qsiprep', 'javascript:alert(1)', 'https://user:secret@github.com/PennLINC/qsiprep', 'https://github.com/PennLINC/qsiprep\\evil']) {
    const input = await selection(),
      source = input.sources[input.records[0].fields.nativeId.source];
    source.requestUrl = unsafe;
    await assert.rejects(buildDiscoveryPilotCatalog(input));
  }
  const input = await selection();
  input.sources[input.records[0].fields.nativeId.source].bodyPath = '../outside-private.json';
  await assert.rejects(buildDiscoveryPilotCatalog(input));
  const wrongProvider = await selection();
  wrongProvider.sources[wrongProvider.records[0].fields.nativeId.source].provider = 'ror';
  await assert.rejects(buildDiscoveryPilotCatalog(wrongProvider));
});
test('builder snapshots caller selection before asynchronous source reads', async () => {
  const input = await selection(),
    before = structuredClone(input);
  let changed = false;
  const result = await buildDiscoveryPilotCatalog(input, async (path: string) => {
    if (!changed) {
      changed = true;
      input.records[0].fields.title.value = 'mutated after snapshot';
    }
    return raw(path);
  });
  assert.equal(result.selectionSha256, sha(canonicalPilotJson(before)));
  assert.deepEqual(result, await catalog());
});
test('bounded strict JSON and RFC6901 pointer handling retain legitimate decimals and reject ambiguity', () => {
  assert.deepEqual(parsePilotJson('{"location":{"lat":39.95,"lng":-75.16}}'), {
    location: {
      lat: 39.95,
      lng: -75.16
    }
  });
  for (const value of ['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"x":"\\ud800"}', '{"x":1e999}', '['.repeat(34) + '0' + ']'.repeat(34)]) assert.throws(() => parsePilotJson(value));
  assert.equal(pilotPointer({
    'a/b': {
      '~x': 2
    }
  }, '/a~1b/~0x'), 2);
  for (const pointer of ['/__proto__', '/constructor', '/a~2b', '/array/00', '/array/-1']) assert.throws(() => pilotPointer({
    array: [0]
  }, pointer));
});
test('search, type/provider filters and both date directions are deterministic with unknown dates last', async () => {
  const value = await catalog();
  assert.equal(queryDiscoveryPilot(value, {
    q: 'qSiPrEp'
  }).items.some(row => row.id === 'github:156589095'), true);
  assert.ok(queryDiscoveryPilot(value, {
    q: 'Philadelphia',
    kind: 'publication',
    provider: 'crossref'
  }).items.every(row => row.kind === 'publication' && row.provider === 'crossref'));
  assert.equal(queryDiscoveryPilot(value, {
    q: 'no-existing-native-record-xyz'
  }).items.length, 0);
  // A context-bound paper requires its native publication year. Exercise the
  // unknown-date sorting branch with an unchanged baseline record instead.
  const unknown = value.records.find((record: any) => baselineIds.has(record.id))!;
  const unknownId = unknown.id;
  unknown.sourceDate = null;
  for (const sort of ['source-date-asc', 'source-date-desc']) {
    const result = queryDiscoveryPilot(value, {
      sort
    });
    assert.equal(result.items.at(-1)?.id, unknownId);
    assert.deepEqual(result.items, queryDiscoveryPilot(value, {
      sort
    }).items);
  }
  const dateResult = queryDiscoveryPilot(value, {
    sort: 'source-date-asc'
  }).items.filter(row => row.sourceDate);
  assert.ok(dateResult.length > 1);
  assert.equal(queryDiscoveryPilot(value, {
    kind: 'organization'
  }).items.length, 2);
  assert.equal(queryDiscoveryPilot(value, {
    kind: 'repository',
    provider: 'crossref'
  }).items.length, 0);
});
test('disabled endpoint does not read catalog; enabled GET/HEAD/method and errors have fixed semantics', async () => {
  let reads = 0;
  const options = {
    loadCatalog: async () => {
      reads++;
      return catalog();
    }
  };
  for (const flag of [undefined, 'false', 'TRUE', true]) for (const method of ['GET', 'HEAD', 'POST']) {
    const result = await handleDiscoveryPilot(request('?private=sentinel', method), {
      DISCOVERY_PILOT_ENABLED: flag
    }, options);
    assert.equal(result.status, 404);
    if (method === 'HEAD') assert.equal(await result.text(), '');
  }
  assert.equal(reads, 0);
  const invalid = await handleDiscoveryPilot(request('?q=x&q=y'), {
    DISCOVERY_PILOT_ENABLED: 'true'
  }, options);
  assert.equal(invalid.status, 400);
  assert.equal(reads, 0);
  const unsupported = await handleDiscoveryPilot(request('', 'POST'), {
    DISCOVERY_PILOT_ENABLED: 'true'
  }, options);
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get('allow'), 'GET, HEAD');
  assert.equal(reads, 0);
  const get = await handleDiscoveryPilot(request(), {
    DISCOVERY_PILOT_ENABLED: 'true'
  }, options);
  const head = await handleDiscoveryPilot(request('', 'HEAD'), {
    DISCOVERY_PILOT_ENABLED: 'true'
  }, options);
  assert.equal(get.status, 200);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  for (const header of ['content-type', 'cache-control', 'cdn-cache-control', 'x-robots-tag']) assert.equal(get.headers.get(header), head.headers.get(header));
  assert.equal(get.headers.get('cache-control'), 'no-store');
  assert.equal(DiscoveryPilotResultSchema.parse(await get.json()).totalRecords, 28);
  const failed = await handleDiscoveryPilot(request(), {
    DISCOVERY_PILOT_ENABLED: 'true'
  }, {
    loadCatalog: async () => {
      throw Error('/private/path SECRET-SENTINEL');
    }
  });
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes('SENTINEL'));
  const trailing = await handleDiscoveryPilot(new Request('https://pilot.invalid/api/discovery-pilot/'), {
    DISCOVERY_PILOT_ENABLED: 'true'
  }, options);
  assert.equal(trailing.status, 200);
});
test('query parser refuses unknown, repeated, oversized and control-bearing parameters', () => {
  for (const query of ['unknown=x', 'q=a&q=b', 'kind=person', 'provider=pubmed', 'sort=relevance', 'q=' + 'x'.repeat(161), 'q=%00', 'q=%0A', '__proto__=x']) assert.throws(() => parseDiscoveryPilotQuery(new URLSearchParams(query)));
  assert.deepEqual(parseDiscoveryPilotQuery(new URLSearchParams()), {
    q: '',
    kind: 'all',
    provider: 'all',
    sort: 'title-asc'
  });
});
test('generated projection drift check is executable and imports do not rebuild catalog', async () => {
  const before = await readFile(catalogFile);
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', 'scripts/build-discovery-pilot.mjs', '--check'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'pilot_projection_current\n');
  assert.deepEqual(await readFile(catalogFile), before);
  assert.equal(DiscoveryPilotCatalogSchema.parse(ex30Catalog(await catalog())).records.length, 22);
});

test('all source author entries remain in order and the original 109 authorship entries are preserved', async () => {
  const selected = await selection();
  const generated = await buildDiscoveryPilotCatalog(selected);
  const counts = new Map<string, number>();
  for (const row of selected.records.filter((entry: any) => entry.kind === 'publication')) {
    const source = selected.sources[row.fields.nativeId.source];
    const body = JSON.parse((await raw(source.bodyPath)).toString());
    const work = body.message.items?.[0] ?? body.message;
    const record = generated.records.find(entry => entry.id === row.id)!;
    counts.set(record.id, record.authors.length);
    assert.deepEqual(record.authors, work.author.map((author: any, sourceIndex: number) => ({
      sourceIndex, name: [author.given, author.family].filter(Boolean).join(' ') || author.name,
      affiliations: (author.affiliation ?? []).map((affiliation: any) => affiliation.name),
    })));
  }
  for (const [id, expected] of baselineAuthorCounts) assert.equal(counts.get(id), expected, id);
  assert.equal([...baselineAuthorCounts.keys()].reduce((sum, id) => sum + counts.get(id)!, 0), 109);
  assert.equal([...counts].filter(([id]) => ex30Ids.has(id)).reduce((sum, [, count]) => sum + count, 0), 289);
  assert.equal([...counts.values()].reduce((sum, count) => sum + count, 0), 367);
  const result = await readDiscoveryPilot(baselineCatalog(generated), { q: 'Philip Cook', kind: 'publication' });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].nativeId, '10.1038/s41592-021-01185-5');
  const preview = pilotAuthorPreview(result.items[0].authors, result.query.q);
  assert.equal(preview.matchesSearch, true);
  assert.match(preview.authors[0].name, /Philip.*Cook/);
  assert.equal(result.items[0].authors.length, 42);
});

test('an omitted, duplicated or reordered author entry cannot silently shrink the source roster', async () => {
  for (const change of ['omit', 'duplicate', 'reorder']) {
    const value = await selection();
    const authors = value.records.find((entry: any) => entry.kind === 'publication').fields.authors;
    if (change === 'omit') authors.pop();
    if (change === 'duplicate') authors[1] = structuredClone(authors[0]);
    if (change === 'reorder') [authors[0], authors[1]] = [authors[1], authors[0]];
    await assert.rejects(buildDiscoveryPilotCatalog(value), undefined, change);
  }
});

test('all descriptions retain exact metadata values and source pointers, including four original non-null values', async () => {
  const selected = await selection();
  const generated = await buildDiscoveryPilotCatalog(selected);
  const repositories = generated.records.filter(record => record.kind === 'repository');
  assert.equal(repositories.filter(record => record.description !== null).length, 11);
  assert.equal(repositories.filter(record => ex30Ids.has(record.id) && record.description !== null).length, 8);
  assert.equal(repositories.filter(record => baselineRepositoryIds.includes(record.id) && record.description !== null).length, 4);
  for (const record of repositories) {
    const row = selected.records.find((entry: any) => entry.id === record.id);
    const source = selected.sources[row.fields.nativeId.source];
    assert.equal(record.description, JSON.parse((await raw(source.bodyPath)).toString()).description);
    assert.ok(record.provenance.some(ref => ref.field === 'description' && ref.pointer === '/description'));
  }
  selected.records[0].fields.description = selected.records[0].fields.title;
  await assert.rejects(buildDiscoveryPilotCatalog(selected));
});

test('citation-aware search finds CaPTk paper and Cook repository without transferring authors or geography', async () => {
  const value = baselineCatalog(await catalog());
  const paper = await readDiscoveryPilot(value, { q: 'CaPTk', kind: 'publication' });
  assert.equal(paper.items.length, 1);
  assert.equal(paper.items[0].nativeId.toLowerCase(), '10.1117/1.jmi.5.1.011018');
  assert.equal(paper.matches[0].basis, 'citing-repository');
  assert.equal(paper.matches[0].relatedRecordId, 'github:128938343');
  const repo = await readDiscoveryPilot(value, { q: 'Philip Cook', kind: 'repository' });
  assert.equal(repo.items.length, 1);
  assert.equal(repo.items[0].id, 'github:156589095');
  assert.equal(repo.matches[0].basis, 'cited-publication');
  assert.deepEqual(repo.items[0].authors, []);
  assert.equal(repo.items[0].geography.basis, 'not-established');
  assert.equal(repo.items[0].geography.county, null);
  assert.equal((await readDiscoveryPilot(value, { q: 'MRI', kind: 'repository' })).items[0].id, 'github:156589095');
  const unlinked = await readDiscoveryPilot(value, { q: '10.1093/bioinformatics/btaf060', kind: 'repository' });
  assert.equal(unlinked.items.length, 0);
  assert.equal(unlinked.citations.length, 0);
});

test('browsable citation context preserves its source direction for publication-only results', async () => {
  const value = ex30Catalog(await catalog());
  const result = await readDiscoveryPilot(value, { kind: 'publication' });
  assert.equal(result.items.length, 10);
  assert.equal(result.citations.length, 6);
  assert.ok(result.items.every(item => item.relatedLinks.length === 0));
  assert.ok(result.citations.every(citation => citation.repository.kind === 'repository' && citation.publication.kind === 'publication'));
  const broken = structuredClone(value);
  broken.records.find((record: any) => record.relatedLinks.length).relatedLinks[0].targetId = 'crossref:10.9999/missing';
  assert.throws(() => queryDiscoveryPilot(broken, { q: 'MRI' }));
  const path = new URL(pilotRecordPath(result.items[0]), 'https://pilot.invalid');
  assert.equal(path.pathname, '/discover');
  assert.equal(path.searchParams.get('kind'), 'publication');
  assert.equal(path.searchParams.get('q'), result.items[0].nativeId);
  assert.equal(pilotDateLabel('2024'), '2024');
  assert.equal(pilotDateLabel('2024-02'), 'Feb 2024');
  assert.equal(pilotDateLabel('2024-02-29'), 'Feb 29, 2024');
});

test('v3 response rejects contradictory, duplicated or unrelated citation context', async () => {
  const full = await readDiscoveryPilot(await catalog(), {});
  for (const mutation of ['title', 'url', 'evidence', 'duplicate-item', 'duplicate-citation', 'missing-citation']) {
    const value = structuredClone(full);
    if (mutation === 'title') value.citations[0].publication.title = 'Wrong publication title';
    if (mutation === 'url') value.citations[0].publication.url = 'https://example.org/wrong';
    if (mutation === 'evidence') value.citations[0].evidence.sha256 = '0'.repeat(64);
    if (mutation === 'duplicate-item') {
      value.items.push(structuredClone(value.items[0]));
      value.matches.push(structuredClone(value.matches[0]));
      value.filteredRecords++; value.totalRecords++; value.counts[value.items[0].kind]++;
    }
    if (mutation === 'duplicate-citation') value.citations.push(structuredClone(value.citations[0]));
    if (mutation === 'missing-citation') value.citations = [];
    assert.equal(DiscoveryPilotResultSchema.safeParse(value).success, false, mutation);
  }
  const unrelated = await readDiscoveryPilot(await catalog(), { kind: 'organization' });
  unrelated.citations.push(full.citations[0]);
  assert.equal(DiscoveryPilotResultSchema.safeParse(unrelated).success, false);
});

test('regional contexts enable the actual three county journeys without filling native affiliations', async () => {
  const generated = await catalog();
  assert.equal(generated.schemaVersion, 'discovery-pilot-catalog-v3');
  assert.equal(generated.regionalContexts.length, 3);
  assert.deepEqual(generated.regionalContexts.map((context: any) => context.recordId).sort(), countyPairs.map(pair => `crossref:${pair.doi}`).sort());
  const cases = [
    { pair: countyPairs[0], queries: ['Princeton', 'Mercer', 'Mercer County'] },
    { pair: countyPairs[1], queries: ['Rutgers', 'Camden', 'Camden County', 'Rutgers-Camden', 'Rutgers–Camden'] },
    { pair: countyPairs[2], queries: ['Rowan', 'Gloucester', 'Gloucester County'] },
  ];
  for (const { pair, queries } of cases) {
    for (const q of queries) {
      const papers = await readDiscoveryPilot(generated, { q, kind: 'publication' });
      assert.equal(papers.query.q, q);
      assert.deepEqual(papers.items.map(record => record.id), [`crossref:${pair.doi}`]);
      assert.deepEqual(papers.matches, [{ recordId: `crossref:${pair.doi}`, basis: 'regional-context', relatedRecordId: null }]);
      assert.equal(papers.regionalContexts.length, 1);
      assert.deepEqual(papers.regionalPublications, []);
      assert.equal(papers.regionalContexts[0].recordId, papers.items[0].id);
      assert.ok(papers.items[0].authors.every(author => author.affiliations.length === 0));
      assert.deepEqual(papers.items[0].geography.reportedLocations, []);
      assert.equal(papers.items[0].geography.county, null);
      const repositories = await readDiscoveryPilot(generated, { q, kind: 'repository' });
      assert.equal(repositories.query.q, q);
      assert.deepEqual(repositories.items.map(record => record.id), [pair.repositoryId]);
      assert.deepEqual(repositories.matches, [{ recordId: pair.repositoryId, basis: 'cited-publication', relatedRecordId: `crossref:${pair.doi}` }]);
      assert.equal(repositories.regionalContexts.length, 1);
      assert.deepEqual(repositories.regionalPublications.map(record => record.id), [`crossref:${pair.doi}`]);
      assert.equal(repositories.regionalContexts[0].recordId, `crossref:${pair.doi}`);
      assert.equal(repositories.citations[0].publication.id, repositories.regionalContexts[0].recordId);
      assert.deepEqual(repositories.items[0].authors, []);
      assert.deepEqual(repositories.items[0].geography, { basis: 'not-established', reportedLocations: [], county: null });
    }
  }
  for (const query of [{ kind: 'organization' }, { q: 'qsiprep', kind: 'repository' }, { q: '10.9999/no-such-regional-record' }, { q: 'Mercer Camden' }, { q: 'Princeton Gloucester' }, { q: 'Rutgers-Gloucester' }]) {
    assert.deepEqual((await readDiscoveryPilot(generated, query)).regionalContexts, []);
    assert.deepEqual((await readDiscoveryPilot(generated, query)).regionalPublications, []);
  }
  for (const q of ['Mercer Camden', 'Princeton Gloucester', 'Rutgers-Gloucester']) {
    assert.deepEqual((await readDiscoveryPilot(generated, { q })).items, []);
  }
});

test('regional context fields and public provenance bind to the retained observation and native publication', async () => {
  const selected = await selection();
  const generated = await buildDiscoveryPilotCatalog(selected);
  for (const field of selected.regionalContexts) {
    const observation = selected.observations[field.observation];
    const bytes = await raw(observation.bodyPath);
    assert.equal(sha(bytes), observation.sha256);
    assert.deepEqual(pilotPointer(JSON.parse(bytes.toString()), field.pointer), field.value);
    const context = generated.regionalContexts.find(context => context.recordId === field.value.recordId)!;
    assert.deepEqual(context, { ...field.value, provenance: { sha256: observation.sha256, pointer: field.pointer, method: 'derived-regional-selection-observation' } });
    const publication = generated.records.find(record => record.id === context.recordId)!;
    assert.equal(context.publicationSourceSha256, publication.source.sha256);
    assert.equal(context.publicationYear, Number(publication.sourceDate!.value.slice(0, 4)));
    for (const author of context.authors) assert.ok(publication.authors.some(native => native.sourceIndex === author.sourceIndex && native.name === author.name));
  }
  const publicResult = JSON.stringify(await readDiscoveryPilot(generated, {}));
  assert.ok(!publicResult.includes('bodyPath'));
  assert.ok(!publicResult.includes('/workspace/'));
});

test('regional projection rejects unbound facts and rehashed source, date, author or record substitutions', async () => {
  for (const mutation of ['observation-hash', 'unbound-value', 'pointer', 'source-sha', 'year', 'author-name', 'author-index', 'author-duplicate', 'unknown-record', 'repository-record', 'county', 'source-url', 'source-date', 'source-method', 'source-empty', 'affiliation-source-duplicate', 'county-source-duplicate', 'notes', 'unexpected-field']) {
    const input = await selection();
    const field = input.regionalContexts[0];
    const observation = input.observations[field.observation];
    const body = JSON.parse((await raw(observation.bodyPath)).toString());
    if (mutation === 'observation-hash') observation.sha256 = '0'.repeat(64);
    if (mutation === 'unbound-value') field.value.institution = 'Unobserved institution';
    if (mutation === 'pointer') field.pointer = '/contexts/01';
    if (mutation === 'source-sha') field.value.publicationSourceSha256 = input.regionalContexts[1].value.publicationSourceSha256;
    if (mutation === 'year') field.value.publicationYear--;
    if (mutation === 'author-name') field.value.authors[0].name = 'Unrelated Author';
    if (mutation === 'author-index') field.value.authors[0].sourceIndex = 999;
    if (mutation === 'author-duplicate') field.value.authors.push(structuredClone(field.value.authors[0]));
    if (mutation === 'unknown-record') field.value.recordId = 'crossref:10.9999/unknown';
    if (mutation === 'repository-record') field.value.recordId = countyPairs[0].repositoryId;
    if (mutation === 'county') field.value.county = 'Atlantic';
    if (mutation === 'source-url') field.value.affiliationSources[0].url = 'http://untrusted.invalid/';
    if (mutation === 'source-date') field.value.affiliationSources[0].observedDate = '2026-02-30';
    if (mutation === 'source-method') field.value.countySources[0].method = 'model-inference';
    if (mutation === 'source-empty') field.value.countySources = [];
    if (mutation === 'affiliation-source-duplicate') field.value.affiliationSources.push(structuredClone(field.value.affiliationSources[0]));
    if (mutation === 'county-source-duplicate') field.value.countySources.push(structuredClone(field.value.countySources[0]));
    if (mutation === 'notes') field.value.notes = ['x'.repeat(401)];
    if (mutation === 'unexpected-field') field.value.currentEmploymentConfirmed = true;
    if (!['observation-hash', 'unbound-value', 'pointer'].includes(mutation)) {
      body.contexts[0] = structuredClone(field.value);
      const bytes = Buffer.from(JSON.stringify(body));
      observation.sha256 = sha(bytes);
      await assert.rejects(buildDiscoveryPilotCatalog(input, (path: string) => path === observation.bodyPath ? Promise.resolve(bytes) : raw(path)), undefined, mutation);
    } else await assert.rejects(buildDiscoveryPilotCatalog(input), undefined, mutation);
  }
  const duplicated = await selection();
  duplicated.regionalContexts.push(structuredClone(duplicated.regionalContexts[0]));
  await assert.rejects(buildDiscoveryPilotCatalog(duplicated), /regional context binding/);
});

test('regional catalog and result validation reject dangling, duplicate or contradictory contexts', async () => {
  const generated = await catalog();
  for (const mutation of ['duplicate', 'unknown', 'source-sha', 'year', 'author', 'provenance', 'provenance-collision']) {
    const candidate = structuredClone(generated);
    const context = candidate.regionalContexts[0];
    if (mutation === 'duplicate') candidate.regionalContexts.push(structuredClone(context));
    if (mutation === 'unknown') context.recordId = 'crossref:10.9999/unknown';
    if (mutation === 'source-sha') context.publicationSourceSha256 = '0'.repeat(64);
    if (mutation === 'year') context.publicationYear--;
    if (mutation === 'author') context.authors[0].name = 'Unknown Author';
    if (mutation === 'provenance') context.provenance.pointer = '/other/0';
    if (mutation === 'provenance-collision') candidate.regionalContexts[1].provenance = structuredClone(context.provenance);
    assert.equal(DiscoveryPilotCatalogSchema.safeParse(candidate).success, false, mutation);
    const result = structuredClone(await readDiscoveryPilot(generated, { kind: 'publication' }));
    result.regionalContexts = candidate.regionalContexts;
    assert.equal(DiscoveryPilotResultSchema.safeParse(result).success, false, mutation);
  }
  const unrelated = await readDiscoveryPilot(generated, { kind: 'organization' });
  unrelated.regionalContexts = [generated.regionalContexts[0]];
  assert.equal(DiscoveryPilotResultSchema.safeParse(unrelated).success, false);
  const wrongNeighbor = await readDiscoveryPilot(generated, { q: 'qsiprep', kind: 'repository' });
  wrongNeighbor.regionalContexts = [generated.regionalContexts[0]];
  assert.equal(DiscoveryPilotResultSchema.safeParse(wrongNeighbor).success, false);
  const missingExplanation = await readDiscoveryPilot(generated, { q: 'Mercer', kind: 'publication' });
  missingExplanation.regionalContexts = [];
  assert.equal(DiscoveryPilotResultSchema.safeParse(missingExplanation).success, false);
});

test('repo-only regional results require exact, relevant publication support instead of unbound summaries', async () => {
  const generated = await catalog();
  const original = await readDiscoveryPilot(generated, { q: 'Mercer', kind: 'repository' });
  assert.equal(original.regionalPublications.length, 1);
  for (const mutation of ['missing-support', 'duplicate-support', 'unrelated-support', 'wrong-kind', 'native-sha', 'native-year', 'native-author', 'summary-title', 'context-sha', 'context-year', 'context-author']) {
    const result = structuredClone(original);
    const publication = result.regionalPublications[0];
    const context = result.regionalContexts[0];
    if (mutation === 'missing-support') result.regionalPublications = [];
    if (mutation === 'duplicate-support') result.regionalPublications.push(structuredClone(publication));
    if (mutation === 'unrelated-support') result.regionalPublications.push(generated.records.find((record: any) => record.id === 'crossref:10.1038/s41592-021-01185-5'));
    if (mutation === 'wrong-kind') result.regionalPublications = [result.items[0]];
    if (mutation === 'native-sha') publication.source.sha256 = '0'.repeat(64);
    if (mutation === 'native-year') publication.sourceDate!.value = `1900${publication.sourceDate!.value.slice(4)}`;
    if (mutation === 'native-author') publication.authors[context.authors[0].sourceIndex].name = 'Unrelated Author';
    if (mutation === 'summary-title') publication.title = 'Wrong summary title';
    if (mutation === 'context-sha') context.publicationSourceSha256 = '0'.repeat(64);
    if (mutation === 'context-year') context.publicationYear--;
    if (mutation === 'context-author') context.authors[0].name = 'Unrelated Author';
    assert.equal(DiscoveryPilotResultSchema.safeParse(result).success, false, mutation);
  }
  const alreadySelected = await readDiscoveryPilot(generated, { q: 'Mercer' });
  assert.deepEqual(alreadySelected.regionalPublications, []);
  alreadySelected.regionalPublications.push(original.regionalPublications[0]);
  assert.equal(DiscoveryPilotResultSchema.safeParse(alreadySelected).success, false);
});
