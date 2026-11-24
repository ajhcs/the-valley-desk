import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { fromJSONSchema } from 'zod';

const projectURL = new URL('../../src/content/public-directory-projects.json', import.meta.url);
const readJSON = (path) => JSON.parse(readFileSync(path, 'utf8'));
const projectSchema = fromJSONSchema(readJSON(new URL(
  '../../src/content/public-directory-projects.schema.json', import.meta.url,
)));
const truncation = /(?:…|\.{2,}|:)\s*$/u;

export function httpsURL(value) {
  if (typeof value !== 'string' || !/^https:\/\/[^/\s\\]/u.test(value) || /[\s\\]/u.test(value)) return false;
  try {
    const url = new URL(value);
    const authority = value.slice(8).split(/[/?#]/u, 1)[0];
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password && !authority.includes('@');
  } catch {
    return false;
  }
}

function validDate(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function validate(records, {
  blocked = new Set(), baselineCount, acknowledgeDrop = false,
} = {}) {
  if (!Array.isArray(records) || !records.length) throw new Error('Expected a nonempty array of public projects');
  if (baselineCount !== undefined && records.length * 100 < baselineCount * 98 && !acknowledgeDrop) {
    throw new Error(`Record count fell from ${baselineCount} to ${records.length}. Pass --acknowledge-drop after review.`);
  }

  const errors = [];
  const ids = new Set();
  const codes = new Set();
  for (const [index, record] of records.entries()) {
    const id = record?.id ?? `row ${index + 1}`;
    const report = (message) => errors.push(`${id}: ${message}`);
    const parsed = projectSchema.safeParse(record);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) report(`${issue.path.join('.') || 'record'}: ${issue.message}`);
      continue;
    }
    const code = record.code.toLowerCase();
    if (ids.has(id)) report('duplicate id');
    if (codes.has(code)) report('duplicate code');
    ids.add(id);
    codes.add(code);
    if (blocked.has(id)) report('declined or removed repository');
    if (record.countyBasis && !record.county) report('county basis requires county');
    if (record.label === 'Verified' && !record.source) report('Verified requires source');
    if (truncation.test(record.purpose)) report('purpose ends in a truncation mark');
    for (const field of ['code', 'source', 'paper', 'homepage', 'readmeUrl', 'citationUrl']) {
      if (record[field] != null && !httpsURL(record[field])) report(`${field} must be a credential-free HTTPS URL`);
    }
    for (const field of ['readmeUrl', 'citationUrl']) {
      if (record[field] != null && !record[field].toLowerCase().startsWith(code + '/blob/')) report(`${field} must point to a file in the repository`);
    }
    for (const field of ['updated', 'added', 'created', 'pushed', 'checked']) {
      if (record[field] != null && !validDate(record[field])) report(`${field} is not a valid date`);
    }
    for (const [paperIndex, paper] of (record.papers ?? []).entries()) {
      if (!httpsURL(paper.url)) report(`papers.${paperIndex}.url must be a credential-free HTTPS URL`);
    }
    if (record.papers?.length && record.paper !== record.papers[0].url) {
      report('paper must match the first URL in papers');
    }
    if (record.owner && record.owner.login.toLowerCase() !== code.split('/')[3]) {
      report('owner login does not match the code URL');
    }
  }
  if (errors.length) {
    throw new Error(`${errors.length} directory validation issues\n${errors.slice(0, 25).join('\n')}`);
  }
}

function blockedIds(paths) {
  const ids = new Set();
  for (const path of paths) {
    const source = readJSON(path);
    if (!Array.isArray(source) || source.some((id) => typeof id !== 'string' || !/^[1-9][0-9]{0,19}$/.test(id))) {
      throw new Error('Decline and removal lists must be JSON arrays of decimal-string GitHub IDs');
    }
    for (const id of source) ids.add(id);
  }
  return ids;
}

function main() {
  const { values } = parseArgs({ options: {
    file: { type: 'string' },
    baseline: { type: 'string' },
    decline: { type: 'string', multiple: true, default: [] },
    removals: { type: 'string', multiple: true, default: [] },
    'acknowledge-drop': { type: 'boolean' },
  } });
  const rows = readJSON(values.file ?? projectURL);
  validate(rows, {
    blocked: blockedIds([...values.decline, ...values.removals]),
    baselineCount: values.baseline ? readJSON(values.baseline).length : undefined,
    acknowledgeDrop: values['acknowledge-drop'],
  });
  console.log(`Validated ${rows.length} public directory projects`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
