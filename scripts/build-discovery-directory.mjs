#!/usr/bin/env node
import { readFile, realpath, writeFile, rename, unlink, mkdir, link, lstat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { parsePilotJson } from './build-discovery-pilot.mjs';
import { validateDirectorySelection, directorySha256 } from '../src/ingest/discovery/directory-review.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
export const selectionPath = 'docs/discovery/go-live/evidence/GL06/selection.json';
export const catalogPath = 'src/content/discovery-directory-catalog.json';
export const removalsPath = 'src/content/discovery-directory-removals.json';
export const statePath = 'docs/discovery/go-live/evidence/GL06/generation-state.json';
export const reportPath = 'docs/discovery/go-live/evidence/GL06/generation-report.json';
export const generationsPath = 'docs/discovery/go-live/evidence/GL06/generations';
/** Publish exact bytes under their digest without overwriting an existing archive. */
export async function archiveGeneration(directory, bytes, check = false) {
  const sha256 = await directorySha256(bytes);
  const path = join(directory, `${sha256}.json`);
  if (!check) {
    await mkdir(directory, { recursive: true });
    const directoryEntry = await lstat(directory);
    if (!directoryEntry.isDirectory() || directoryEntry.isSymbolicLink() || await realpath(directory) !== resolve(directory)) throw Error('generation-directory');
    const temporary = join(directory, `.generation-${randomBytes(8).toString('hex')}.tmp`);
    try {
      await writeFile(temporary, bytes, { flag: 'wx' });
      try { await link(temporary, path); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    } finally { await unlink(temporary).catch(() => {}); }
  }
  const directoryEntry = await lstat(directory);
  if (!directoryEntry.isDirectory() || directoryEntry.isSymbolicLink() || await realpath(directory) !== resolve(directory)) throw Error('generation-directory');
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink() || !Buffer.from(await readFile(path)).equals(Buffer.from(bytes))) throw Error('generation-archive-conflict');
  return { path, sha256 };
}
export async function buildDirectorySelection(selection, authority, loadBytes) {
  return validateDirectorySelection(selection, authority, loadBytes);
}
async function loadEvidence(path) {
  if (typeof path !== 'string' || !path.startsWith('docs/discovery/') || path.includes('\\') || path.split('/').some(p => p === '..' || p === '.' || !p)) throw Error('evidence-path');
  const target = await realpath(resolve(root, path));
  const rel = relative(await realpath(resolve(root, 'docs/discovery')), target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw Error('evidence-path');
  return readFile(target);
}
export async function runDirectoryBuild(args) {
  let temporary;
  try {
    if (args.length > 1 || args.length && args[0] !== '--check') throw Error('arguments');
    const { DIRECTORY_REVIEW_AUTHORITY, DIRECTORY_REVIEW_ARTIFACT } = await import('../src/ingest/discovery/directory-review-authority.ts');
    if (!DIRECTORY_REVIEW_AUTHORITY || !DIRECTORY_REVIEW_ARTIFACT || await directorySha256(await loadEvidence(DIRECTORY_REVIEW_ARTIFACT.path)) !== DIRECTORY_REVIEW_ARTIFACT.sha256) throw Error('authority-absent');
    if (DIRECTORY_REVIEW_AUTHORITY.priorState) {
      const prior = DIRECTORY_REVIEW_AUTHORITY.priorState;
      if (!/^docs\/discovery\/go-live\/evidence\/GL[0-9]{2}\/generations\/[a-f0-9]{64}\.json$/.test(prior.path) || !prior.path.endsWith(`/${prior.sha256}.json`)) throw Error('mutable-prior-path');
      const entry = await lstat(resolve(root, prior.path));
      if (!entry.isFile() || entry.isSymbolicLink() || await realpath(resolve(root, prior.path)) !== resolve(root, prior.path)) throw Error('mutable-prior-path');
    }
    const raw = await readFile(resolve(root, selectionPath));
    if (raw.length > 5000000) throw Error('selection-size');
    const selection = parsePilotJson(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    const result = await buildDirectorySelection(selection, DIRECTORY_REVIEW_AUTHORITY, loadEvidence);
    const removals = { schemaVersion: 'discovery-directory-removals-v1', snapshotVersion: result.snapshot.version, removedIds: result.state.tombstones.map(t => t.id).sort() };
    const bytes = `${JSON.stringify(result.snapshot, null, 2)}\n`, removalBytes = `${JSON.stringify(removals, null, 2)}\n`, stateBytes = `${JSON.stringify(result.state, null, 2)}\n`, output = resolve(root, catalogPath);
    const archive = await archiveGeneration(resolve(root, generationsPath), stateBytes, args[0] === '--check');
    const report = { ...result.report, nextPriorState: { path: `${generationsPath}/${archive.sha256}.json`, sha256: archive.sha256 } };
    const reportBytes = `${JSON.stringify(report, null, 2)}\n`;
    if (args[0] === '--check') {
      if (await readFile(output, 'utf8') !== bytes || await readFile(resolve(root, removalsPath), 'utf8') !== removalBytes || await readFile(resolve(root, statePath), 'utf8') !== stateBytes || await readFile(resolve(root, reportPath), 'utf8') !== reportBytes) throw Error('projection-drift');
      process.stdout.write('directory_projection_current\n');
    } else {
      temporary = join(dirname(output), `.directory-${randomBytes(8).toString('hex')}.tmp`);
      await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, output); temporary = undefined;
      temporary = join(dirname(resolve(root, removalsPath)), `.directory-removals-${randomBytes(8).toString('hex')}.tmp`);
      await writeFile(temporary, removalBytes, { flag: 'wx' }); await rename(temporary, resolve(root, removalsPath)); temporary = undefined;
      temporary = join(dirname(resolve(root, statePath)), `.directory-state-${randomBytes(8).toString('hex')}.tmp`);
      await writeFile(temporary, stateBytes, { flag: 'wx' }); await rename(temporary, resolve(root, statePath)); temporary = undefined;
      temporary = join(dirname(resolve(root, reportPath)), `.directory-report-${randomBytes(8).toString('hex')}.tmp`);
      await writeFile(temporary, reportBytes, { flag: 'wx' }); await rename(temporary, resolve(root, reportPath)); temporary = undefined;
      process.stdout.write('directory_projection_written\n');
    }
    return 0;
  } catch { process.stderr.write('invalid_directory_projection\n'); return 1; }
  finally { if (temporary) await unlink(temporary).catch(() => {}); }
}
const invoked = process.argv[1] ? await realpath(resolve(process.argv[1])).catch(() => null) : null;
if (invoked === fileURLToPath(import.meta.url)) process.exitCode = await runDirectoryBuild(process.argv.slice(2));
