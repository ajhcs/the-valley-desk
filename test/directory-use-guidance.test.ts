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

test('recorded repository names select their own guides and validated accession', () => {
  const cases = [
    ['GEO', 'GSE123', 'GEO download guide'], ['PRIDE', 'PXD123456', 'PRIDE download guide'],
    ['ArrayExpress', 'E-MTAB-1234', 'ArrayExpress download guide'], ['PDB', '1ABC', 'RCSB PDB downloads'],
    ['Dryad', '10.5061/dryad.ab123', 'Dryad publication guide'], ['Zenodo', '10.5281/zenodo.123', 'Zenodo record features'],
    ['figshare', '10.6084/m9.figshare.123', 'figshare API documentation'], ['OSF', '10.17605/OSF.IO/ABCDE', 'OSF download guide'],
  ];
  for (const [repository, accession, label] of cases) {
    const steps = datasetUseGuidance({ repository, accessions: [accession], url: 'https://example.org/', access: 'open' });
    assert.match(steps[0].text, new RegExp(accession.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(steps.at(-1)?.links?.[0].label, label);
  }
});
test('study accession uses selector, and untrusted identifiers are omitted', () => {
  const input = { repository: 'SRA', accessions: ['SRP12345'], url: 'https://example.org/', access: 'open' };
  const steps = datasetUseGuidance(input);
  assert.match(steps[0].text, /SRP12345/); assert.equal(steps[1].command, undefined);
  assert.match(steps[1].text, /Run Selector/);
  assert.doesNotMatch(datasetUseGuidance({ ...input, accessions: ['SRP1<script>'] })[0].text, /script/);
});
test('controlled dbGaP provides its guide and registration does not promise open access', () => {
  const input = { repository: 'dbGaP', accessions: ['phs000123.v1.p1'], url: 'https://example.org/', access: 'controlled' };
  assert.equal(datasetUseGuidance(input)[1].links?.[0].label, 'dbGaP download guide');
  assert.match(datasetUseGuidance({ ...input, repository: 'Zenodo', access: 'registration' })[1].text, /registration/);
});

test('all remaining mapped repositories have a specific source guide', () => {
  for (const repository of ['EMDB', 'Mendeley Data', 'Dataverse', 'Harvard Dataverse', 'PhysioNet', 'OpenNeuro', 'Synapse', 'TCIA', 'NIMH Data Archive', 'DANDI', 'ICPSR']) {
    const base = { repository, accessions: [], url: 'https://example.org/', access: 'open' };
    const steps = datasetUseGuidance(base);
    assert.ok(steps.at(-1)?.links?.length, repository);
    assert.notEqual(steps.at(-1)?.text, 'Select the available files and follow the repository’s download instructions.');
  }
  const controlled = datasetUseGuidance({ repository: 'PhysioNet', accessions: [], url: 'https://example.org/', access: 'controlled' });
  assert.equal(controlled[1].links?.[0].label, 'PhysioNet access guide');
  assert.match(controlled[1].text, /request access/);
  assert.equal(datasetUseGuidance({ repository: 'Other', accessions: [], url: 'https://doi.org/10.1234/example', access: 'open' }).at(-1)?.links, undefined);
});
