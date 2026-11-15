import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, chmod, symlink, link, stat, readdir, mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync, spawn } from "node:child_process";
const root = process.cwd();
const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
async function setup() {
  await mkdir(join(root, ".discovery-work/wp03-cli-sol/tmp"), { recursive: true });
  await mkdir(join(root, ".discovery-work/wp03-cli-sol/cache"), { recursive: true });
  const dir = await mkdtemp(join(root, ".discovery-work/wp03-cli-sol/case-")); await chmod(dir, 0o700);
  const manifest = join(dir, "manifest.json"), bundle = join(dir, "bundle.json"), policy = join(dir, "policy.json"), output = join(dir, "report.json");
  const original = await readFile(join(root, "docs/discovery/reference-manifest.json"));
  const policyData = JSON.stringify({ revision: "unenrolled-diagnostic", validFrom: "2026-01-01T00:00:00Z", validUntil: "2027-01-01T00:00:00Z", keys: [], revokedReceiptIds: [], revokedAuthorityIds: [] });
  await Promise.all([writeFile(manifest, original), writeFile(bundle, '{"receipts":[],"authorities":[]}'), writeFile(policy, policyData)]);
  const args = ["--manifest", manifest, "--bundle", bundle, "--trust-policy", policy, "--expected-policy-sha256", digest(policyData), "--output", output];
  const run = (change: string[] = args) => spawnSync(process.execPath, ["--import", "tsx/esm", "scripts/discovery-reference-intake.mjs", ...change], { cwd: root, encoding: "utf8", env: { HOME: process.env.HOME, PATH: process.env.PATH, TMPDIR: join(root, ".discovery-work/wp03-cli-sol/tmp"), XDG_CACHE_HOME: join(root, ".discovery-work/wp03-cli-sol/cache"), npm_config_cache: join(root, ".discovery-work/wp03-cli-sol/cache") } });
  return { dir, manifest, bundle, policy, output, args, run };
}
test("actual empty inventory creates private summary, blocked exit2; report contains no labels", async () => {
  const x = await setup(), result = x.run();
  assert.equal(result.status, 2, result.stderr); assert.equal(result.stdout, "blocked\n"); assert.equal(result.stderr, "");
  const report = JSON.parse(await readFile(x.output, "utf8"));
  assert.equal(report.status, "not_frozen"); assert.equal(report.freezeIssued, false); assert.equal(report.packageAccepted, false);
  assert.equal(report.manifestFileSha256, digest(await readFile(x.manifest)));
  assert.equal(report.bundleFileSha256, digest(await readFile(x.bundle)));
  assert.equal(report.counts.heldout, 0); assert.equal((await stat(x.output)).mode & 0o777, 0o600);
  assert.ok(!("heldoutHistory" in report)); assert.ok(!("findings" in report));
});
test("refuses policy hash mismatch without publishing or leaking inputs", async () => {
  const x = await setup(); x.args[7] = "f".repeat(64); const result = x.run();
  assert.equal(result.status, 3); assert.equal(result.stdout, ""); assert.equal(result.stderr, "invalid_offline_intake\n");
  assert.ok(!(await readdir(x.dir)).includes("report.json"));
});
for (const json of ['{"receipts":[],"receipts":[],"authorities":[]}', '{"receipts":[],"rece\\u0069pts":[],"authorities":[]}', '{"secret-private-label":"\\ud800"}', '{"secret-private-label":9007199254740993}', '{"secret-private-label":1e400}', '{"secret-private-label":-0}', '{"secret-private-label":1.0}', 'not-json-private-label']) test(`rejects ambiguous/malformed JSON privately: ${json.slice(0, 20)}`, async () => {
  const x = await setup(); await writeFile(x.bundle, json); const result = x.run();
  assert.equal(result.status, 3); assert.equal(result.stderr, "invalid_offline_intake\n"); assert.equal(result.stdout, "");
  assert.ok(!(await readdir(x.dir)).includes("report.json"));
});
test("raw oversized input and invalid UTF8 fail before parsing", async () => {
  const x = await setup(); await writeFile(x.bundle, Buffer.alloc(16000001, 32));
  assert.equal(x.run().status, 3);
  await writeFile(x.bundle, Buffer.from([0xff])); assert.equal(x.run().status, 3);
  await writeFile(x.bundle, "\ufeff{\"receipts\":[],\"authorities\":[]}"); assert.equal(x.run().status, 3);
});
test("new-output rule preserves existing files and symlinks", async () => {
  const x = await setup(); await writeFile(x.output, "preserve"); assert.equal(x.run().status, 3); assert.equal(await readFile(x.output, "utf8"), "preserve");
  const y = await setup(); await symlink(y.manifest, y.output); const original = await readFile(y.manifest, "utf8");
  assert.equal(y.run().status, 3); assert.equal(await readFile(y.manifest, "utf8"), original);
});
test("rejects input symlink and hardlink alias, path collision, and nonprivate output parent", async () => {
  const x = await setup(); const alias = join(x.dir, "alias.json"); await symlink(x.bundle, alias); x.args[3] = alias; assert.equal(x.run().status, 3);
  const y = await setup(); const hard = join(y.dir, "hard.json"); await link(y.manifest, hard); y.args[3] = hard; assert.equal(y.run().status, 3);
  const z = await setup(); z.args[9] = z.manifest; assert.equal(z.run().status, 3);
  const q = await setup(); await chmod(q.dir, 0o755); assert.equal(q.run().status, 3);
});
test("invalid CLI flags and schema errors reveal only fixed error state", async () => {
  const x = await setup(); assert.equal(x.run(["--secret-label"]).status, 3);
  await writeFile(x.manifest, '{"private-corpus-label":"DO-NOT-LEAK"}'); const result = x.run();
  assert.equal(result.status, 3); assert.equal(result.stderr, "invalid_offline_intake\n"); assert.equal(result.stdout, "");
});
test("concurrent output creation admits one writer without clobber or temporary residue", async () => {
  const x = await setup(); const invoke = () => new Promise<number | null>((done, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx/esm", "scripts/discovery-reference-intake.mjs", ...x.args], { cwd: root, stdio: "ignore" });
    child.on("error", reject); child.on("exit", done);
  });
  const states = await Promise.all([invoke(), invoke()]);
  assert.deepEqual(states.sort(), [2, 3]);
  assert.equal(JSON.parse(await readFile(x.output, "utf8")).status, "not_frozen");
  assert.ok(!(await readdir(x.dir)).some(name => name.endsWith(".tmp")));
});
test("subprocess verifies ephemeral signed reviewer receipt, then detects signature tamper without leaking identity", async () => {
  const { discoveryReferenceSigningBytes } = await import("../src/ingest/discovery-reference-signatures");
  const { discoveryEvaluationDigest } = await import("../src/ingest/discovery-evaluation");
  const x = await setup(), manifest = JSON.parse(await readFile(x.manifest, "utf8"));
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const begin = "2026-01-01T00:00:00Z", end = "2027-01-01T00:00:00Z", reviewerId = "synthetic-private-reviewer";
  const record = { schemaVersion: "discovery-authenticated-receipt-v1", id: "synthetic-private-receipt", authorityId: "synthetic-authority", purpose: "reviewer-authority", subjectId: reviewerId, principalId: reviewerId,
    contentSha256: await discoveryEvaluationDigest({ reviewerId, policy: manifest.policy }), issuedAt: begin, expiresAt: end };
  manifest.reviewers = [{ id: reviewerId, authority: { id: record.id, sha256: await discoveryEvaluationDigest(record) } }];
  const envelope = async (domain: string, payload: unknown) => ({ domain, keyId: "synthetic-key", algorithm: "Ed25519", payload,
    signatureHex: Buffer.from(await crypto.subtle.sign("Ed25519", pair.privateKey, await discoveryReferenceSigningBytes(domain, "synthetic-key", payload))).toString("hex") });
  const bundle = { receipts: [await envelope("discovery-reference-receipt-signature-v1", record)], authorities: [await envelope("discovery-reference-authority-signature-v1", { schemaVersion: "discovery-authority-statement-v1", issuedAt: begin, expiresAt: end,
    authority: { id: "synthetic-authority", purposes: ["reviewer-authority"], principals: [reviewerId], validFrom: begin, validUntil: end, revoked: false } })] };
  const policy = JSON.stringify({ revision: "synthetic-ephemeral-policy", validFrom: begin, validUntil: end, keys: [{ id: "synthetic-key", algorithm: "Ed25519", spkiHex: Buffer.from(await crypto.subtle.exportKey("spki", pair.publicKey)).toString("hex"), roles: ["receipt", "authority"], authorityIds: ["synthetic-authority"], validFrom: begin, validUntil: end, revoked: false }], revokedReceiptIds: [], revokedAuthorityIds: [] });
  await Promise.all([writeFile(x.manifest, JSON.stringify(manifest)), writeFile(x.bundle, JSON.stringify(bundle)), writeFile(x.policy, policy)]); x.args[7] = digest(policy);
  assert.equal(x.run().status, 2);
  const report = JSON.parse(await readFile(x.output, "utf8")); assert.ok(!report.findingCategories.includes("unverified")); assert.ok(!JSON.stringify(report).includes(reviewerId));
  bundle.receipts[0]!.signatureHex = "00".repeat(64); await writeFile(x.bundle, JSON.stringify(bundle)); x.args[9] = join(x.dir, "tampered-report.json");
  assert.equal(x.run().status, 2);
  const tampered = JSON.parse(await readFile(x.args[9]!, "utf8")); assert.ok(tampered.findingCategories.includes("unverified"));
});
test("rejects nonregular/missing input, symlink ancestors and unsafe output ancestors", async () => {
  const x = await setup(); const directory = join(x.dir, "directory"); await mkdir(directory); x.args[3] = directory; assert.equal(x.run().status, 3);
  x.args[3] = join(x.dir, "absent"); assert.equal(x.run().status, 3);
  const fifo = join(x.dir, "fifo"); assert.equal(spawnSync("mkfifo", [fifo]).status, 0); x.args[3] = fifo; assert.equal(x.run().status, 3);
  const alias = join(x.dir, "alias-parent"); await symlink(x.dir, alias); x.args[3] = join(alias, "bundle.json"); assert.equal(x.run().status, 3);
  const y = await setup(); const outputParent = join(y.dir, "private-child"); await mkdir(outputParent, { mode: 0o700 }); await chmod(y.dir, 0o777);
  // y.dir has a private ancestor owned by this UID, so other users cannot traverse it;
  // the direct output parent must still be private. Symlink aliases always fail.
  const symlinkParent = join(y.dir, "linked-child"); await symlink(outputParent, symlinkParent); y.args[9] = join(symlinkParent, "report.json"); assert.equal(y.run().status, 3);
});
test("JSON depth/node budgets and integer canonicality reject ambiguous documents", async () => {
  const x = await setup();
  for (const body of ["[".repeat(34) + "null" + "]".repeat(34), "[" + Array(500001).fill("null").join(",") + "]", '{"n":1e0}', '{"n":0.1}', '{"n":01}']) {
    await writeFile(x.bundle, body); assert.equal(x.run().status, 3);
  }
});
test("symlink and space-containing entrypoints execute CLI and reject missing arguments", async () => {
  const x = await setup(), entry = join(x.dir, "intake entry with spaces.mjs");
  await symlink(join(root, "scripts/discovery-reference-intake.mjs"), entry);
  const run = (path: string, args: string[] = []) => spawnSync(process.execPath, ["--import", "tsx/esm", path, ...args], { cwd: root, encoding: "utf8" });
  const result = run(entry); assert.equal(result.status, 3); assert.equal(result.stderr, "invalid_offline_intake\n"); assert.equal(result.stdout, "");
  const invoked = run(entry, x.args); assert.equal(invoked.status, 2); assert.equal(invoked.stdout, "blocked\n");
  const copiedRoot = join(x.dir, "path with spaces"); await mkdir(join(copiedRoot, "scripts"), { recursive: true });
  await symlink(join(root, "src"), join(copiedRoot, "src"));
  const copied = join(copiedRoot, "scripts", "intake copy.mjs"); await copyFile(join(root, "scripts/discovery-reference-intake.mjs"), copied);
  const copiedResult = run(copied); assert.equal(copiedResult.status, 3); assert.equal(copiedResult.stderr, "invalid_offline_intake\n");
  // Importing the module alone must not launch the command.
  const imported = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", `await import(${JSON.stringify(new URL("../scripts/discovery-reference-intake.mjs", import.meta.url).href)});`], { cwd: root, encoding: "utf8" });
  assert.equal(imported.status, 0); assert.equal(imported.stdout, ""); assert.equal(imported.stderr, "");
});
