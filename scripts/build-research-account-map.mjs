import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { buildResearchAccountMap } from '../src/ingest/discovery/research-account-map.ts';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) throw new Error('Usage: build-research-account-map.mjs [--check]');
const inputs = ['pa-account-leads', 'nj-account-leads', 'pa-account-leads-supplement', 'nj-account-leads-supplement', 'root-account-leads'].map(name => `docs/discovery/go-live/evidence/GL05/${name}.json`);
const raw = await Promise.all(inputs.map(async source => {
  const bytes = await readFile(source);
  return { source, data: JSON.parse(bytes.toString('utf8')), sha256: createHash('sha256').update(bytes).digest('hex') };
}));
const baselinePaths = ['src/content/discovery-pilot-catalog.json', 'docs/discovery/go-live/evidence/GL04/frontier-crosswalk.json', 'docs/discovery/go-live/execution/GL02-source-inventory.json', 'docs/discovery/go-live/execution/GL02-exploration-manifest.json', 'docs/discovery/go-live/execution/GL02-known-project-diagnostic.json'];
const baseline = await Promise.all(baselinePaths.map(async source => {
  const text = await readFile(source, 'utf8');
  return { source, data: source.endsWith('.json') ? JSON.parse(text) : text };
}));
const map = buildResearchAccountMap(raw, baseline);
const escape = value => String(value ?? 'unknown').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const lines = ['# Private research account evidence map', '', 'These are unreviewed private leads, not publication approvals. Dates and affiliations are source-reported; current roles, account control, native GitHub identities and individual or project worksites remain unverified. County associations describe the stated site or affiliation. Keyword relevance is triage, not proof of a health purpose. Literal matches against the pilot catalog and GL02/GL04 inventory are marked; unmatched does not mean new. The [normalized JSON](../evidence/GL05/research-account-map.json) retains complete source facts, pointers and qualifications.', '', `Counts: ${map.counts.accountHandles} unique account handles, ${map.counts.repositories} unique repository URLs and ${map.counts.personOccurrences} person occurrences. These are not counts of people or regional coverage.`, '', '| Reported person / lab or institution | Account | Repository leads and stated purpose | Time, place and sources |', '| --- | --- | --- | --- |'];
for (const o of map.occurrences) {
  const person = o.personOccurrence ? `${escape(o.personOccurrence.name)}${o.accountKey === 'sacanlab' ? ' (paper author; account ownership unverified)' : ''}; ` : '';
  const repos = o.repositories.length ? o.repositories.map(r => {
    const repo = map.repositories.find(item => item.key === r.repositoryKey);
    return `[${escape(repo.key)}](${repo.url}): ${escape(r.purpose)} ([source](${r.institutionRepositorySource}))`;
  }).join('<br>') : `No repository identified${o.reportedProjectPurpose ? `; ${escape(o.reportedProjectPurpose)}` : ''}`;
  const association = o.personResourceAssociation ? `; named person–resource association: ${escape(o.personResourceAssociation.qualification)}` : '';
  const county = o.region.county ? `${escape(o.region.county)} County; ` : '';
  const municipality = o.region.municipality ? `${escape(o.region.municipality)}; ` : '';
  const access = /directly opened|primary-web-rendering/i.test(o.sourceAccess) ? 'direct primary page' : /index/i.test(o.sourceAccess) ? 'indexed primary source' : 'source method in input';
  lines.push(`| ${person}${escape(o.institutionOrLab)}${association} | [${escape(o.accountKey)}](https://github.com/${o.accountKey}) | ${repos} | ${municipality}${county}${escape(o.region.basis)}; ${escape(o.affiliationTimeScope)}; ${access} ([source](${o.institutionAccountSource})) |`);
}
lines.push('', '## Collection queue', '', 'For each account, verify the native account and repository identities, source relationship, health purpose, historical and regional scope, and existing-catalog matches before considering admission. Account-only leads require a repository search.', '', '| Account | Repository leads | Existing literal match |', '| --- | ---: | --- |');
for (const a of map.accounts) lines.push(`| [${escape(a.key)}](${a.url}) | ${a.repositoryKeys.length} | ${a.reconciliation.status === 'matched-existing-url' ? 'matched' : 'unknown'} |`);
lines.push('', '## County and coverage gaps', '', 'Site or dated affiliation evidence does not locate a person or project. No regional coverage is claimed.');
for (const input of raw) for (const gap of (input.data.gaps ?? [])) {
  const description = typeof gap === 'string' ? gap : [gap.county, gap.seed, gap.status].filter(Boolean).join(': ');
  if (description) lines.push(`- ${escape(description)}`);
}
lines.push('', '## Input evidence', '', ...map.inputSources.map(item => `- [${item.source.split('/').pop()}](../evidence/GL05/${item.source.split('/').pop()}): SHA-256 ${item.sha256}`));
const json = `${JSON.stringify(map, null, 2)}\n`, markdown = `${lines.join('\n')}\n`;
if (args[0] === '--check') {
  for (const [path, expected] of [['docs/discovery/go-live/evidence/GL05/research-account-map.json', json], ['docs/discovery/go-live/execution/GL05-research-map.md', markdown]]) if (await readFile(path, 'utf8') !== expected) throw new Error(`Stale: ${path}`);
} else {
  await writeFile('docs/discovery/go-live/evidence/GL05/research-account-map.json', json);
  await writeFile('docs/discovery/go-live/execution/GL05-research-map.md', markdown);
}
