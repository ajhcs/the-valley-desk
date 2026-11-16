import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readDiscoveryPilot } from '../src/ingest/discovery-pilot';

// Fixed native identities are deliberately independent of the live directory selection.
const nativeIds = [
  'crossref:10.1007/s11517-024-03096-x', 'crossref:10.1016/j.neuroimage.2023.120037',
  'crossref:10.1016/j.xgen.2023.100340', 'crossref:10.1038/s41592-021-01185-5',
  'crossref:10.1038/s41592-022-01458-7', 'crossref:10.1038/s41592-024-02503-3',
  'crossref:10.1038/s44172-023-00066-3', 'crossref:10.1093/bib/bbaa381',
  'crossref:10.1093/bioinformatics/btae114', 'crossref:10.1093/bioinformatics/btaf060',
  'crossref:10.1117/1.jmi.5.1.011018', 'crossref:10.1186/1471-2105-15-248',
  'crossref:10.3390/app11041892', 'github:128938343', 'github:156589095',
  'github:15715626', 'github:163997867', 'github:192607622', 'github:256420694',
  'github:285885136', 'github:342691278', 'github:390797198', 'github:525946788',
  'github:617168725', 'github:692249664', 'github:734388793', 'ror:00b30xv10', 'ror:01z7r7q48',
];
const pairs = [
  ['github:128938343', 'crossref:10.1117/1.jmi.5.1.011018'],
  ['github:156589095', 'crossref:10.1038/s41592-021-01185-5'],
  ['github:163997867', 'crossref:10.3390/app11041892'],
  ['github:192607622', 'crossref:10.1016/j.xgen.2023.100340'],
  ['github:256420694', 'crossref:10.1038/s41592-022-01458-7'],
  ['github:342691278', 'crossref:10.1038/s44172-023-00066-3'],
  ['github:390797198', 'crossref:10.1016/j.neuroimage.2023.120037'],
  ['github:617168725', 'crossref:10.1007/s11517-024-03096-x'],
  ['github:692249664', 'crossref:10.1038/s41592-024-02503-3'],
];
const catalog = JSON.parse(await readFile(new URL('../src/content/discovery-pilot-catalog.json', import.meta.url), 'utf8'));
const native = (id: string) => id.startsWith('ror:') ? `https://ror.org/${id.slice(4)}` : id.slice(id.indexOf(':') + 1);

test('retained pilot resolves all 28 fixed native identities through its read API', async () => {
  assert.deepEqual(catalog.records.map((record: { id: string }) => record.id).sort(), [...nativeIds].sort());
  for (const id of nativeIds) {
    const result = await readDiscoveryPilot(catalog, { q: native(id) });
    assert.ok(result.items.some(record => record.id === id && record.nativeId === native(id)), id);
    assert.equal(result.totalRecords, 28);
  }
});

test('all nine retained directed citations resolve from either exact native endpoint', async () => {
  const all = await readDiscoveryPilot(catalog, {});
  assert.deepEqual(all.citations.map(c => [c.repository.id, c.publication.id]).sort(), [...pairs].sort());
  for (const [repository, publication] of pairs) {
    for (const id of [repository, publication]) {
      const result = await readDiscoveryPilot(catalog, { q: native(id) });
      assert.ok(result.items.some(record => record.id === id), id);
      assert.ok(result.citations.some(c => c.repository.id === repository && c.publication.id === publication), `${id}: ${repository} -> ${publication}`);
    }
  }
});
