import { readFile } from 'node:fs/promises';
import { RegionalInventory, verifyRegionalEvidence, verifyInstitutionalRepository } from '../src/ingest/regional-contracts.ts';
import { discoverDeclaredFeeds, parseRegionalFeed } from '../src/ingest/regional-discovery.ts';
import { prepareRegionalEditorialContext } from '../src/ingest/regional-context.ts';
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--captures') throw new Error('Usage: node --import tsx/esm scripts/regional-source-replay.mjs --captures local-captures.json');
const inventory = RegionalInventory.parse(JSON.parse(await readFile(new URL('../fixtures/regional-source-inventory-v1.json', import.meta.url), 'utf8')));
const captures = Object.values(JSON.parse(await readFile(args[1], 'utf8')));
const retained = new Map();
const evidence = await Promise.all(inventory.evidence.map(async citation => {
  const capture = captures.find(row => row.url === citation.url && row.observedAt === citation.observedAt);
  const representation = capture && { url: capture.url, observedAt: capture.observedAt,
    body: citation.representation === 'normalized-text' ? capture.text : capture.body };
  if (representation) retained.set(citation.id, representation);
  return { evidenceId: citation.id, verified: !!representation && await verifyRegionalEvidence(citation, representation) };
}));
const discovery = inventory.sources.filter(source => source.transport === 'html').map(source => {
  const capture = captures.find(row => row.url === source.url);
  return { sourceId: source.id, captured: !!capture, declaredFeeds: capture ? discoverDeclaredFeeds(capture.body, capture.url, source.allowedHosts) : [] };
});
const feeds = inventory.sources.filter(source => source.transport === 'rss' || source.transport === 'atom').map(source => {
  const capture = captures.find(row => row.url === source.url);
  return { sourceId: source.id, captured: !!capture, result: capture ? parseRegionalFeed(capture.body, source, capture.observedAt) : null };
});
const institution = inventory.institutions.find(row => row.id === 'inst-regional-penn-university');
const citation = inventory.evidence.find(row => row.id === 'ev-penn-captk-link');
const api = captures.find(row => row.url === 'https://api.github.com/repos/CBICA/CaPTk');
let repository = null;
if (api && institution && citation && retained.has(citation.id)) {
  const raw = JSON.parse(api.body);
  repository = await verifyInstitutionalRepository({ institution, evidence: citation, retained: retained.get(citation.id),
    repository: { id: String(raw.id), fullName: raw.full_name, private: raw.private, htmlUrl: raw.html_url }, repositoryCapture: api });
}
const editorialContext = await prepareRegionalEditorialContext({ facts: inventory.evidence.filter(row => row.representation === 'normalized-text')
  .map(row => ({ evidenceId: row.id, literalText: row.quote })),
  synthesis: [{ text: 'The institutional disclaimer supports a research-use context. Clinical deployment and artifact-specific licensing remain separate review questions.',
    author: 'Regional source workstream (engineering draft)', evidenceIds: ['ev-penn-captk-research-use'], isInference: true }] }, inventory.evidence, retained);
const report = { schemaVersion: 1, networkRequests: 0, collectionAuthorized: false, publicationAuthorized: false,
  evidence, discovery, feeds, repository, editorialContext };
console.log(JSON.stringify(report, null, 2));
if (evidence.some(row => !row.verified)) process.exitCode = 1;
