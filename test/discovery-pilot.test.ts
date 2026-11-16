import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DiscoveryPilotCatalogSchema, DiscoveryPilotResultSchema } from '../src/content/discovery-pilot';
import { handleDiscoveryPilot, parseDiscoveryPilotQuery, queryDiscoveryPilot, readDiscoveryPilot } from '../src/ingest/discovery-pilot';
import { buildDiscoveryPilotCatalog, canonicalPilotJson, parsePilotJson, pilotPointer } from '../scripts/build-discovery-pilot.mjs';
const selectionFile = new URL('../fixtures/discovery-pilot-selection.json', import.meta.url);
const catalogFile = new URL('../src/content/discovery-pilot-catalog.json', import.meta.url);
const selection = async () => JSON.parse(await readFile(selectionFile, 'utf8'));
const catalog = async () => JSON.parse(await readFile(catalogFile, 'utf8'));
const raw = async (path: string) => readFile(new URL(`../${path}`, import.meta.url));
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const request = (query = '', method = 'GET') => new Request(`https://pilot.invalid/api/discovery-pilot${query}`, {
  method
});
test('retained-byte projection is deterministic, source-traced and contains 14 distinct listings', async () => {
  const selected = await selection(),
    generated = await buildDiscoveryPilotCatalog(selected);
  assert.deepEqual(generated, await catalog());
  assert.deepEqual(await buildDiscoveryPilotCatalog(selected), generated);
  assert.equal(generated.records.length, 14);
  assert.deepEqual(queryDiscoveryPilot(generated, {}).counts, {
    repository: 6,
    publication: 6,
    organization: 2
  });
  assert.equal(generated.selectionSha256, sha(canonicalPilotJson(selected)));
  assert.equal(new Set(generated.records.map(record => `${record.provider}:${record.nativeId}`)).size, 14);
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
test('only two directed repository citations use exact derived edge/file/time evidence', async () => {
  const value = await catalog(),
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
  assert.equal(DiscoveryPilotResultSchema.parse(await get.json()).totalRecords, 14);
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
  assert.equal(DiscoveryPilotCatalogSchema.parse(await catalog()).records.length, 14);
});
