import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, unlinkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconstructOriginal, packageOriginal, digest, partName, MANIFEST_NAME, ORIGINAL_SHA256, TEXT_BYTES } from '../scripts/lib/pa-fixture-transport.mjs';

const directory = fileURLToPath(new URL('./fixtures/pa-export/', import.meta.url));
test('lossless transport is deterministic and receipt-bound', () => {
 const bytes = reconstructOriginal(directory);
 assert.equal(digest(bytes), ORIGINAL_SHA256);
 const { manifest, texts } = packageOriginal(bytes);
 assert.equal(texts.reduce((sum: number, text: Buffer) => sum + text.length, 0), TEXT_BYTES);
 assert.equal(Math.max(...texts.map((text: Buffer) => text.length)), 43693);
 assert.equal(manifest.parts.length, 51);
 assert.equal(readFileSync(join(directory, MANIFEST_NAME), 'utf8'), JSON.stringify(manifest, null, 2) + '\n');
 const receipt = JSON.parse(readFileSync(join(directory, 'receipt.json'), 'utf8'));
 assert.equal(receipt.transportManifestPath, MANIFEST_NAME);
 assert.equal(receipt.transportManifestSha256, digest(readFileSync(join(directory, MANIFEST_NAME))));
 assert.throws(() => packageOriginal(Buffer.alloc(bytes.length)));
});

const mutations: Record<string, (dir: string) => void> = {
 missing: dir => unlinkSync(join(dir, partName(0))),
 extra: dir => writeFileSync(join(dir, partName(51)), 'AA==\n'),
 duplicate: dir => writeFileSync(join(dir, partName(1)), readFileSync(join(dir, partName(0)))),
 truncated: dir => writeFileSync(join(dir, partName(0)), readFileSync(join(dir, partName(0))).subarray(1)),
 oversized: dir => writeFileSync(join(dir, partName(0)), Buffer.alloc(43694)),
 'oversized manifest': dir => writeFileSync(join(dir, MANIFEST_NAME), Buffer.alloc(16385)),
 symlink: dir => { unlinkSync(join(dir, partName(0))); symlinkSync(join(directory, partName(0)), join(dir, partName(0))); },
};
for (const [name, mutate] of Object.entries(mutations)) test(`transport rejects ${name}`, () => {
 const dir = mkdtempSync(join(tmpdir(), 'pa-transport-'));
 try { cpSync(directory, dir, { recursive: true }); mutate(dir); assert.throws(() => reconstructOriginal(dir)); }
 finally { rmSync(dir, { recursive: true, force: true }); }
});
for (const name of ['reordered', 'duplicated manifest', 'traversal', 'wrong count', 'wrong raw identity', 'wrong size', 'wrong digest', 'garbage', 'padding bits', 'tampered with updated digest', 'high bit']) test(`transport rejects ${name}`, () => {
 const dir = mkdtempSync(join(tmpdir(), 'pa-transport-'));
 try {
  cpSync(directory, dir, { recursive: true });
  const path = join(dir, MANIFEST_NAME);
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (name === 'reordered') [manifest.parts[0], manifest.parts[1]] = [manifest.parts[1], manifest.parts[0]];
  else if (name === 'duplicated manifest') manifest.parts[1] = manifest.parts[0];
  else if (name === 'traversal') manifest.parts[0].name = '../escape';
  else if (name === 'wrong count') manifest.partCount--;
  else if (name === 'wrong raw identity') manifest.originalSha256 = '0'.repeat(64);
  else if (name === 'wrong size') manifest.parts[0].rawBytes--;
  else if (name === 'wrong digest') manifest.parts[0].sha256 = '0'.repeat(64);
  else {
   const part = name === 'padding bits' ? manifest.parts.at(-1) : manifest.parts[0];
   const payload = readFileSync(join(dir, part.name));
   if (name === 'padding bits') payload[payload.length - 3] = 66; // Nonzero unused bits before '='.
   else payload[0] = name === 'garbage' ? 33 : name === 'high bit' ? payload[0] | 128 : payload[0] === 65 ? 66 : 65;
   writeFileSync(join(dir, part.name), payload);
   part.sha256 = digest(payload); // Exercise strict decoder and whole-archive pin independently.
  }
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
  assert.throws(() => reconstructOriginal(dir));
 } finally { rmSync(dir, { recursive: true, force: true }); }
});
