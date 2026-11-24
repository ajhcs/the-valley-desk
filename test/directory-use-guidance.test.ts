import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { datasetUseGuidance, softwareUseGuidance } from '../src/ingest/directory-use-guidance';

test('controlled data never suggests an unrestricted download', () => {
  const steps = datasetUseGuidance({ repository: 'EGA', accessions: ['EGAS123'], url: 'https://ega-archive.org/studies/EGAS123', access: 'controlled' });
  assert.match(steps[1].text, /Data Access Committee/); assert.equal(steps[1].command, undefined);
});
test('SRA commands contain only validated run accessions', () => {
  const input = { repository: 'SRA', accessions: ['SRR123; rm -rf /', 'SRR123'], url: 'https://ncbi.nlm.nih.gov/sra', access: 'open' };
  assert.equal(datasetUseGuidance(input)[1].command, 'prefetch SRR123');
  assert.equal(datasetUseGuidance({ ...input, accessions: [input.accessions[0]] })[1].command, undefined);
});
test('software links only observed files within its own repository', () => {
  const input = { code: 'https://github.com/example/repo', readmeUrl: 'https://github.com/example/repo/blob/abc/README.md', citationUrl: 'https://github.com/other/repo/blob/main/CITATION.cff', language: 'R', license: 'MIT' };
  const steps = softwareUseGuidance(input); assert.equal(steps[0].command, 'git clone https://github.com/example/repo.git');
  assert.equal(steps[1].links?.[0].url, input.readmeUrl); assert.equal(steps.at(-1)?.links, undefined);
});
