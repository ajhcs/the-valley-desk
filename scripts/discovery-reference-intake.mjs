#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { constants } from "node:fs";
import { open, lstat, realpath, link, unlink } from "node:fs/promises";
import { dirname, resolve, isAbsolute, parse as parsePath, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { assessDiscoverySignedReferenceIntake } from "../src/ingest/discovery-reference-signatures.ts";

// Strict JSON intake: decoded duplicate keys, lossy numbers and invalid Unicode fail closed.
export function parseDiscoveryIntakeJson(text) {
  let at = 0, nodes = 0;
  const bad = () => { throw new Error("invalid-json"); };
  const ws = () => { while (/[\x20\x09\x0a\x0d]/.test(text[at] ?? "X")) at++; };
  const string = () => {
    const start = at++;
    while (at < text.length) {
      const code = text.charCodeAt(at++);
      if (code === 34) {
        let value; try { value = JSON.parse(text.slice(start, at)); } catch { bad(); }
        for (let i = 0; i < value.length; i++) {
          const c = value.charCodeAt(i);
          if (c >= 0xd800 && c <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) bad(); }
          else if (c >= 0xdc00 && c <= 0xdfff) bad();
        }
        return value;
      }
      if (code === 92) at++;
      else if (code < 32) bad();
    }
    bad();
  };
  const value = depth => {
    if (depth > 32 || ++nodes > 500000) bad();
    ws(); const token = text[at];
    if (token === '"') return string();
    if (token === "{" || token === "[") {
      at++; ws(); const array = token === "[", end = array ? "]" : "}", result = array ? [] : Object.create(null), keys = new Set();
      if (text[at] === end) { at++; return result; }
      for (;;) {
        ws(); let key;
        if (!array) { if (text[at] !== '"') bad(); key = string(); if (keys.has(key)) bad(); keys.add(key); ws(); if (text[at++] !== ":") bad(); }
        const entry = value(depth + 1); if (array) result.push(entry); else result[key] = entry;
        ws(); const next = text[at++]; if (next === end) return result; if (next !== ",") bad();
      }
    }
    for (const [literal, entry] of [["true", true], ["false", false], ["null", null]]) if (text.startsWith(literal, at)) { at += literal.length; return entry; }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(at));
    if (!number) bad();
    at += number[0].length; const n = Number(number[0]);
    // Intake schemas use integer revisions/counts; reject all decimal/exponent/negative-zero forms.
    if (!Number.isSafeInteger(n) || Object.is(n, -0) || /[.eE]/.test(number[0])) bad();
    return n;
  };
  const result = value(0); ws(); if (at !== text.length) bad(); return result;
}

async function rejectSymlinkAncestors(path, enforceOwnership = false) {
  const parent = dirname(path); let current = parsePath(parent).root, protectedByPrivate = false;
  for (const part of parent.slice(current.length).split("/").filter(Boolean)) {
    current = join(current, part); const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("invalid-parent");
    if (enforceOwnership) {
      if (stat.uid !== 0 && stat.uid !== process.getuid()) throw new Error("invalid-parent");
      if (!protectedByPrivate && (stat.mode & 0o022) !== 0) throw new Error("invalid-parent");
      if (stat.uid === process.getuid() && (stat.mode & 0o077) === 0) protectedByPrivate = true;
    }
  }
}
async function readBounded(path, limit) {
  await rejectSymlinkAncestors(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat(); if (!stat.isFile() || stat.size > limit) throw new Error("invalid-input");
    const data = Buffer.alloc(limit + 1); let count = 0;
    while (count < data.length) { const { bytesRead } = await handle.read(data, count, data.length - count, null); if (!bytesRead) break; count += bytesRead; }
    if (count > limit) throw new Error("invalid-input");
    return { data: data.subarray(0, count), inode: `${stat.dev}:${stat.ino}` };
  } finally { await handle.close(); }
}
async function privateOutput(path) {
  const parent = dirname(path);
  await rejectSymlinkAncestors(path, true);
  const stat = await lstat(parent);
  if (stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700 || await realpath(parent) !== parent) throw new Error("invalid-output");
  try { await lstat(path); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  throw new Error("output-exists");
}

export async function runDiscoveryReferenceIntake(argv) {
  let temporary;
  try {
    const options = new Map(), names = ["--manifest", "--bundle", "--trust-policy", "--expected-policy-sha256", "--output"];
    if (argv.length !== 10) throw new Error("arguments");
    for (let i = 0; i < argv.length; i += 2) { if (!names.includes(argv[i]) || options.has(argv[i])) throw new Error("arguments"); options.set(argv[i], argv[i + 1]); }
    const paths = ["--manifest", "--bundle", "--trust-policy", "--output"].map(name => options.get(name));
    if (paths.some(path => typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path) || new Set(paths).size !== 4 || !/^[a-f0-9]{64}$/.test(options.get("--expected-policy-sha256"))) throw new Error("arguments");
    const [manifestPath, bundlePath, policyPath, output] = paths;
    await privateOutput(output);
    const policy = await readBounded(policyPath, 262144);
    const policySha256 = createHash("sha256").update(policy.data).digest("hex");
    if (policySha256 !== options.get("--expected-policy-sha256")) throw new Error("policy-hash");
    const manifest = await readBounded(manifestPath, 16000000), bundle = await readBounded(bundlePath, 16000000);
    if (new Set([policy.inode, manifest.inode, bundle.inode]).size !== 3) throw new Error("input-alias");
    const decode = bytes => parseDiscoveryIntakeJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
    const assessment = await assessDiscoverySignedReferenceIntake(decode(manifest.data), decode(policy.data), decode(bundle.data));
    if (assessment.findings.some(x => x.startsWith("schema:") || x === "invalid-signed-intake-or-trust-policy")) throw new Error("invalid-assessment");
    const ready = assessment.readiness === "ready_for_accountable_freeze_review";
    // No case IDs, labels, source data, receipt contents or full findings leave this boundary.
    const report = { schemaVersion: "discovery-offline-intake-report-v1", status: "not_frozen", readiness: assessment.readiness,
      freezeIssued: false, packageAccepted: false, policyFileSha256: policySha256,
      manifestFileSha256: createHash("sha256").update(manifest.data).digest("hex"),
      bundleFileSha256: createHash("sha256").update(bundle.data).digest("hex"),
      counts: assessment.counts, findingCount: assessment.findings.length,
      findingCategories: [...new Set(assessment.findings.map(x => x.split(":")[0]))].sort(),
      trustScope: "Signatures under supplied policy only; operator enrollment, policy freshness and source truth remain external." };
    const bytes = Buffer.from(JSON.stringify(report, null, 2) + "\n"); if (bytes.length > 65536) throw new Error("report-size");
    temporary = join(dirname(output), `.discovery-intake-${randomBytes(16).toString("hex")}.tmp`);
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await link(temporary, output); await unlink(temporary); temporary = undefined;
    process.stdout.write(ready ? "ready_for_accountable_freeze_review\n" : "blocked\n");
    return ready ? 0 : 2;
  } catch {
    process.stderr.write("invalid_offline_intake\n"); return 3;
  } finally { if (temporary) await unlink(temporary).catch(() => {}); }
}
const invokedPath = process.argv[1] ? await realpath(resolve(process.argv[1])).catch(() => null) : null;
if (invokedPath === fileURLToPath(import.meta.url)) process.exitCode = await runDiscoveryReferenceIntake(process.argv.slice(2));
