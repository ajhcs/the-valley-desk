import { createHash } from 'node:crypto';

export function verifyReceipt(bytes, expected) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected) || Object.keys(expected).sort().join(' ') !== 'bytes sha256' || typeof expected.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expected.sha256) || !Number.isSafeInteger(expected.bytes) || expected.bytes < 0 || bytes.byteLength !== expected.bytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw Error('Input receipt mismatch');
}
