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
});
const expansionPairs = [
  { repositoryId: 'github:256420694', repository: 'PennLINC/aslprep', doi: '10.1038/s41592-022-01458-7', authorCount: 114, commit: '48a418cf92b57c5c66502286d2847fd742cbbd48', path: 'CITATION.cff' },
  { repositoryId: 'github:342691278', repository: 'mlcommons/GaNDLF', doi: '10.1038/s44172-023-00066-3', authorCount: 42, commit: '3f9b7726925be0f97a8a0eb108c8f35b19ff50dd', path: 'README.md' },
  { repositoryId: 'github:163997867', repository: 'CBICA/HistoReg', doi: '10.3390/app11041892', authorCount: 6, commit: '5f7290781ae519b5ae930e85be594576576df853', path: 'README.md' },
  { repositoryId: 'github:390797198', repository: 'PennLINC/ModelArray', doi: '10.1016/j.neuroimage.2023.120037', authorCount: 18, commit: 'b38bb2582d38e82040e25aa5b08c98161287411a', path: 'README.Rmd' },
];
test('retained-byte projection is deterministic, source-traced and contains 22 distinct listings', async () => {
  const selected = await selection(),
    generated = await buildDiscoveryPilotCatalog(selected);
  assert.deepEqual(generated, await catalog());
  assert.deepEqual(await buildDiscoveryPilotCatalog(selected), generated);
  assert.equal(generated.records.length, 22);
  assert.equal(baselineCatalog(generated).records.length, 14);
  assert.deepEqual(queryDiscoveryPilot(generated, {}).counts, {
    repository: 10,
    publication: 10,
    organization: 2
  });
  assert.equal(generated.selectionSha256, sha(canonicalPilotJson(selected)));
  assert.equal(new Set(generated.records.map(record => `${record.provider}:${record.nativeId}`)).size, 22);
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
test('whitelist excludes native author internals, full text, private paths and rights inferences', async () => {
  const value = await readDiscoveryPilot(await catalog(), {}),
    serialized = JSON.stringify(value);
  for (const forbidden of ['bodyPath', 'ORCID', 'authenticated-orcid', 'raw_body', 'license_hint', 'README text', '/workspace/', '.discovery-work', 'publicationAuthorized', 'currentEmploymentConfirmed', 'abstract', '"html_url":']) assert.ok(!serialized.includes(forbidden), forbidden);
  assert.ok(value.items.filter(row => row.kind === 'repository').every(row => row.owner?.kind === 'Organization' && row.authors.length === 0 && row.geography.basis === 'not-established'));
  assert.ok(value.items.filter(row => row.kind === 'publication').every(row => row.owner === null && row.geography.basis === 'publication-reported-affiliation'));
  assert.ok(value.items.filter(row => row.kind === 'organization').every(row => row.owner === null && row.authors.length === 0 && row.geography.basis === 'registry-reported-location'));
  assert.equal(value.items.find(row => row.id === 'github:156589095')?.sourceDate?.label, 'Repository pushed');
  assert.equal(value.items.find(row => row.id.startsWith('crossref:'))?.sourceDate?.label, 'Published');
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
  const value = await catalog();
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
  const unknownId = value.records[0].id;
  value.records[0].sourceDate = null;
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
  assert.equal(DiscoveryPilotResultSchema.parse(await get.json()).totalRecords, 22);
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
  assert.equal(DiscoveryPilotCatalogSchema.parse(await catalog()).records.length, 22);
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
  assert.equal([...counts.values()].reduce((sum, count) => sum + count, 0), 289);
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
  assert.equal(repositories.filter(record => record.description !== null).length, 8);
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
  const value = await catalog();
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

test('v2 response rejects contradictory, duplicated or unrelated citation context', async () => {
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
