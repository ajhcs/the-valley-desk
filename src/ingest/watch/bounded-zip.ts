/** ZIP32 only. No filesystem extraction; all sizes, flags and CRCs are checked. */
export const PA_ARCHIVE_LIMITS = { maxEntries: 100, maxExpandedBytes: 64 * 1024 * 1024 } as const;
export function zipCrc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export async function extractBoundedZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (reason: string): never => { throw Error('pa-zip-' + reason); };
  const u16 = (at: number) => at >= 0 && at + 2 <= bytes.length ? view.getUint16(at, true) : fail('truncated');
  const u32 = (at: number) => at >= 0 && at + 4 <= bytes.length ? view.getUint32(at, true) : fail('truncated');
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && u32(end) !== 0x06054b50) end--;
  if (end < 0 || u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length) fail('end-record');
  const count = u16(end + 10), central = u32(end + 16), centralSize = u32(end + 12);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || !count || count > PA_ARCHIVE_LIMITS.maxEntries ||
      central + centralSize !== end) fail('directory');
  const entries: { name: string; bytes: Uint8Array; crc32: number }[] = [], names = new Set<string>();
  let cursor = central, localEnd = 0, expanded = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50) fail('central-header');
    const flags = u16(cursor + 8), method = u16(cursor + 10), crc = u32(cursor + 16),
      compressed = u32(cursor + 20), size = u32(cursor + 24), nameSize = u16(cursor + 28),
      extraSize = u16(cursor + 30), commentSize = u16(cursor + 32), local = u32(cursor + 42);
    if (u16(cursor + 6) > 20 || flags & ~0x808 || ![0, 8].includes(method) || u16(cursor + 34) ||
        (u32(cursor + 38) >>> 16 & 0xf000) === 0xa000 || compressed === 0xffffffff || size === 0xffffffff ||
        local !== localEnd || cursor + 46 + nameSize + extraSize + commentSize > end) fail('unsupported-entry');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(cursor + 46, cursor + 46 + nameSize));
    if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(name) || name.split('/').some(part => part === '.' || part === '..') || names.has(name.toLowerCase())) fail('unsafe-or-duplicate-path');
    names.add(name.toLowerCase());
    const checkExtra = (at: number, length: number) => {
      const stop = at + length;
      while (at < stop) {
        if (at + 4 > stop || u16(at) === 1 || at + 4 + u16(at + 2) > stop) fail('extra-field');
        at += 4 + u16(at + 2);
      }
    };
    checkExtra(cursor + 46 + nameSize, extraSize);
    if (u32(local) !== 0x04034b50 || u16(local + 4) > 20 || u16(local + 6) !== flags || u16(local + 8) !== method || u16(local + 26) !== nameSize) fail('local-header');
    const localExtra = u16(local + 28), start = local + 30 + nameSize + localExtra;
    if (start + compressed > central || new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(local + 30, local + 30 + nameSize)) !== name) fail('local-name-or-size');
    checkExtra(local + 30 + nameSize, localExtra);
    if (flags & 8) {
      if (![0, crc].includes(u32(local + 14)) || ![0, compressed].includes(u32(local + 18)) || ![0, size].includes(u32(local + 22))) fail('local-descriptor');
    } else if (u32(local + 14) !== crc || u32(local + 18) !== compressed || u32(local + 22) !== size) fail('local-size');
    expanded += size;
    if (expanded > PA_ARCHIVE_LIMITS.maxExpandedBytes) fail('expanded-limit');
    const packed = bytes.slice(start, start + compressed);
    let content: Uint8Array;
    if (method === 0) content = packed;
    else {
      // Verified in local workerd. Read incrementally; never allocate an unbounded response.
      const reader = new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      const chunks: Uint8Array[] = []; let actual = 0;
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          actual += part.value.length;
          if (actual > size || actual > PA_ARCHIVE_LIMITS.maxExpandedBytes) { await reader.cancel(); fail('actual-expanded-limit'); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      content = new Uint8Array(actual); let offset = 0;
      for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.length; }
    }
    if (content.length !== size || zipCrc32(content) !== crc) fail('crc-or-size');
    localEnd = start + compressed;
    if (flags & 8) {
      if (u32(localEnd) === 0x08074b50) localEnd += 4;
      if (u32(localEnd) !== crc || u32(localEnd + 4) !== compressed || u32(localEnd + 8) !== size) fail('data-descriptor');
      localEnd += 12;
    }
    if (localEnd > central) fail('overlap');
    entries.push({ name, bytes: content, crc32: crc });
    cursor += 46 + nameSize + extraSize + commentSize;
  }
  if (cursor !== end || localEnd !== central) fail('unindexed-bytes');
  return entries;
}
