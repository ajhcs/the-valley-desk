import { readFile } from 'node:fs/promises';
import { prepareRegionalSourceReadView, queryRegionalSourceReadView } from '../src/ingest/regional-read-view.ts';

const args = process.argv.slice(2), accepted = new Set(['--now', '--query', '--health']), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!accepted.has(args[i]) || !args[i + 1] || options[args[i]])
    throw new Error('Usage: node --import tsx/esm scripts/regional-read-view.mjs [--now ISO-instant] [--query local-json-path] [--health local-json-path]');
  options[args[i]] = args[i + 1];
}
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const inventory = await json(new URL('../fixtures/regional-source-inventory-v1.json', import.meta.url));
const coverage = await json(new URL('../fixtures/coverage-pack-v1.json', import.meta.url));
const official = await json(new URL('../fixtures/official-source-registry-v1.json', import.meta.url));
const health = options['--health'] ? await json(options['--health']) : [];
if (!Array.isArray(health)) throw new Error('Health receipts must be a local JSON array.');
const asOf = options['--now'] ?? new Date().toISOString();
const view = await prepareRegionalSourceReadView({ inventory, existingInstitutions: coverage.institutions,
  existingOfficialSources: official.sources, existingLeadershipSources: coverage.sources, health, asOf });
const query = options['--query'] ? await json(options['--query']) : { limit: 50 };
console.log(JSON.stringify(queryRegionalSourceReadView(view, query, asOf), null, 2));
