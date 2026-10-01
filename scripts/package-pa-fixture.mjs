#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ORIGINAL_BYTES, MANIFEST_NAME, readBounded, packageOriginal } from './lib/pa-fixture-transport.mjs';

// Explicit local source required; no downloads, implicit source selection or binary output.
if (process.argv.length !== 3) throw new Error('Usage: node scripts/package-pa-fixture.mjs <original-archive>');
const directory = fileURLToPath(new URL('../test/fixtures/pa-export/', import.meta.url));
const { manifest, texts } = packageOriginal(readBounded(process.argv[2], ORIGINAL_BYTES));
for (let i = 0; i < texts.length; i++) writeFileSync(join(directory, manifest.parts[i].name), texts[i], { flag: 'wx', mode: 0o644 });
writeFileSync(join(directory, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
