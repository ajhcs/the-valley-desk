import { readFile } from 'node:fs/promises';
import { RegionalInventory } from '../src/ingest/regional-contracts.ts';
import { regionalCoverageInputs, buildRegionalCoverageReport } from '../src/ingest/regional-coverage.ts';

const args = process.argv.slice(2), accepted = new Set(['--now', '--health']);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!accepted.has(args[i]) || !args[i + 1] || options[args[i]]) throw new Error('Usage: node --import tsx/esm scripts/regional-coverage-report.mjs [--now ISO-instant] [--health local-json-path]');
  options[args[i]] = args[i + 1];
}
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const inventory = RegionalInventory.parse(await json(new URL('../fixtures/regional-source-inventory-v1.json', import.meta.url)));
const coverage = await json(new URL('../fixtures/coverage-pack-v1.json', import.meta.url));
const official = await json(new URL('../fixtures/official-source-registry-v1.json', import.meta.url));
const health = options['--health'] ? await json(options['--health']) : [];
if (!Array.isArray(health)) throw new Error('Source health input must be an array of persisted receipts.');
const report = buildRegionalCoverageReport({ ...regionalCoverageInputs(inventory, coverage.institutions, official.sources, coverage.sources),
  health, asOf: options['--now'] ?? new Date().toISOString() });
console.log(JSON.stringify(report, null, 2));
