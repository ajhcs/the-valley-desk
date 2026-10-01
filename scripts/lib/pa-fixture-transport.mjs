// Offline fixture transport only; never a publisher response or ingestion adapter.
import { createHash } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, readSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ORIGINAL_BYTES = 1649358;
export const ORIGINAL_SHA256 = 'f1f5484439dd2f2d22ef9e956169aa296fe1893b97b1625b8d917fed7c13a003';
export const PART_BYTES = 32768;
export const PART_COUNT = 51;
export const TEXT_BYTES = 2199263;
export const MANIFEST_NAME = 'pa-original-transport.json';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const partName = index => `pa-original.part-${String(index + 1).padStart(3, '0')}.base64`;
const fail = () => { throw new Error('Invalid PA fixture transport'); };

// Bound allocations before reading; reject symlinks, special files and concurrent size changes.
export function readBounded(path, limit) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) fail();
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!count) fail();
      offset += count;
    }
    if (readSync(fd, Buffer.alloc(1), 0, 1, null) || fstatSync(fd).size !== stat.size) fail();
    return bytes;
  } finally { closeSync(fd); }
}

export function assertOriginal(bytes) {
  if (bytes.length !== ORIGINAL_BYTES || digest(bytes) !== ORIGINAL_SHA256) fail();
}

export function packageOriginal(bytes) {
  assertOriginal(bytes);
  const texts = Array.from({ length: PART_COUNT }, (_, i) => Buffer.from(bytes.subarray(i * PART_BYTES, (i + 1) * PART_BYTES).toString('base64') + '\n'));
  const manifest = {
    format: 'pa-original-independent-base64-1',
    derivation: 'Generated lossless transport of unchanged historical raw ZIP; text parts are not publisher responses.',
    originalBytes: ORIGINAL_BYTES, originalSha256: ORIGINAL_SHA256,
    rawPartBytes: PART_BYTES, partCount: PART_COUNT, totalTextBytes: TEXT_BYTES,
    parts: texts.map((text, i) => ({ name: partName(i), rawBytes: Math.min(PART_BYTES, ORIGINAL_BYTES - i * PART_BYTES), textBytes: text.length, sha256: digest(text) })),
  };
  return { manifest, texts };
}

export function reconstructOriginal(directory) {
  if (directory instanceof URL) directory = fileURLToPath(directory);
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) fail();
  const manifestBytes = readBounded(join(directory, MANIFEST_NAME), 16384);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.format !== 'pa-original-independent-base64-1' || manifest.originalBytes !== ORIGINAL_BYTES || manifest.originalSha256 !== ORIGINAL_SHA256 || manifest.rawPartBytes !== PART_BYTES || manifest.partCount !== PART_COUNT || manifest.totalTextBytes !== TEXT_BYTES || !Array.isArray(manifest.parts) || manifest.parts.length !== PART_COUNT) fail();
  const names = readdirSync(directory).filter(name => name.startsWith('pa-original.part') || name.endsWith('.base64')).sort();
  if (names.length !== PART_COUNT || names.some((name, i) => name !== partName(i))) fail();
  const archive = Buffer.alloc(ORIGINAL_BYTES);
  let total = 0;
  for (let i = 0; i < PART_COUNT; i++) {
    const part = manifest.parts[i];
    const rawSize = Math.min(PART_BYTES, ORIGINAL_BYTES - i * PART_BYTES);
    const textSize = 4 * Math.ceil(rawSize / 3) + 1;
    if (part.name !== partName(i) || part.rawBytes !== rawSize || part.textBytes !== textSize || !/^[a-f0-9]{64}$/.test(part.sha256)) fail();
    // Use computed basenames, never manifest paths.
    const bytes = readBounded(join(directory, partName(i)), textSize);
    if (bytes.length !== textSize || digest(bytes) !== part.sha256) fail();
    const text = bytes.toString('ascii');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?\n$/.test(text)) fail();
    const raw = Buffer.from(text.slice(0, -1), 'base64');
    if (raw.length !== rawSize || !Buffer.from(raw.toString('base64') + '\n').equals(bytes)) fail();
    raw.copy(archive, i * PART_BYTES);
    total += bytes.length;
  }
  if (total !== TEXT_BYTES) fail();
  assertOriginal(archive);
  // Bind every manifest field, digest and serialization to the deterministic generator.
  const canonical = packageOriginal(archive).manifest;
  if (!Buffer.from(JSON.stringify(canonical, null, 2) + '\n').equals(manifestBytes)) fail();
  return archive;
}
