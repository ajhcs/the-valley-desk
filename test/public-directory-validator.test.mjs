import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validate } from '../scripts/directory/validate.mjs';

const project = {
  id: '1', code: 'https://github.com/example/project', name: 'Project',
  purpose: 'Runs a medical image quality check.', topic: 'Medical imaging', label: 'Listed',
};

test('accepts the public projection in one-record-per-line form', () => {
  const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const records = read('../src/content/public-directory-projects.json');
  validate(records);
  const source = readFileSync(new URL('../src/content/public-directory-projects.json', import.meta.url), 'utf8');
  assert.equal(source.trimEnd().split('\n').length, records.length + 2);
});

test('preserves descriptions longer than the GitHub editor limit in the source projection', () => {
  validate([{ ...project, description: 'A source description. '.repeat(45) }]);
});

for (const [title, edit, expected] of [
  ['missing field', (row) => delete row.name, /name:/],
  ['blank field', (row) => row.name = ' ', /name:/],
  ['unknown field', (row) => row.notes = 'private', /notes/],
  ['non-HTTPS paper', (row) => row.paper = 'http://example.org/paper', /paper:/],
  ['credentialed source', (row) => row.source = 'https://user:pw@example.org/', /source:/],
  ['credentialed nested paper', (row) => row.papers = [{ title: 'Paper', url: 'https://user@example.org/', doi: null, year: 2024, venue: null }], /papers/],
  ['foreign code host', (row) => row.code = 'https://github.com.example.org/example/project', /code:/],
  ['unknown county', (row) => row.county = 'Kent', /county:/],
  ['verified with no source', (row) => row.label = 'Verified', /Verified requires source/],
  ['long purpose', (row) => row.purpose = 'a'.repeat(181), /purpose:/],
  ['truncated purpose', (row) => row.purpose = 'Runs a medical…', /truncation mark/],
  ['purpose ending in a colon', (row) => row.purpose = 'Runs these checks:', /truncation mark/],
  ['invalid date', (row) => row.pushed = '2026-02-29', /pushed: Invalid ISO date/],
  ['owner mismatch', (row) => row.owner = { login: 'different', name: null, kind: 'user' }, /owner login/],
  ['mismatched primary URL', (row) => row.papers = [{ title: 'Paper', url: 'https://example.org/', doi: null, year: 2024, venue: null }], /first URL/],
]) {
  test(`rejects ${title}`, () => {
    const record = { ...project };
    edit(record);
    assert.throws(() => validate([record]), expected);
  });
}

test('rejects duplicate IDs and case-insensitive duplicate repository URLs', () => {
  assert.throws(() => validate([project, { ...project, code: 'https://github.com/example/other' }]), /duplicate id/);
  assert.throws(() => validate([project, { ...project, id: '2', code: project.code.toUpperCase().replace('HTTPS://GITHUB.COM/', 'https://github.com/') }]), /duplicate code/);
});

test('rejects a repository in the effective decline or removal set', () => {
  assert.throws(() => validate([project], { blocked: new Set(['1']) }), /declined or removed/);
});

test('requires explicit acknowledgment for a drop greater than two percent', () => {
  const records = Array.from({ length: 98 }, (_, index) => ({
    ...project, id: String(index + 1), code: `${project.code}-${index + 1}`,
  }));
  validate(records, { baselineCount: 100 });
  assert.throws(() => validate(records.slice(1), { baselineCount: 100 }), /acknowledge-drop/);
  validate(records.slice(1), { baselineCount: 100, acknowledgeDrop: true });
});
