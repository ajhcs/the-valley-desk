import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, mkdtemp, chmod, stat, symlink, link } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { prepareDiscoveryHumanReview, dispatchDiscoveryHumanReview, checkDiscoveryHumanReturn,
  prepareDiscoveryHumanAdjudication } from "../src/ingest/discovery-human-review";
import { discoveryEvaluationDigest, DiscoveryReferenceManifest, assessDiscoveryReferenceReadiness,
  discoveryReferenceReviewContext } from "../src/ingest/discovery-evaluation";
import type { DiscoveryReceiptVerifier } from "../src/ingest/discovery-evaluation";
import { createDiscoveryReferenceReceiptVerifier } from "../src/ingest/discovery-reference-receipts";
import { createDiscoverySignedReceiptStore, discoveryReferenceSigningBytes } from "../src/ingest/discovery-reference-signatures";

const sha = (data: string) => createHash("sha256").update(data).digest("hex");
const ref = (id: string) => ({ id, sha256: "0".repeat(64) });
const revision = { id: "fixture-rubric", revision: 1 };
const start = "2026-01-01T00:00:00Z", end = "2030-01-01T00:00:00Z";
const body = "Fictional permitted original evidence. No actual human or authority.";
async function fixture() {
  const m = DiscoveryReferenceManifest.parse({ schemaVersion: "discovery-reference-v1", status: "not_frozen", revision: { id: "fixture-manifest", revision: 1 },
    rubric: revision, policy: { id: "fixture-policy", revision: 1 }, design: "wp03-evaluation-design-v1", createdAt: start,
    reviewers: ["fixture-first", "fixture-second"].map(id => ({ id, authority: ref(`grant-${id}`) })),
    sources: [{ id: "fixture-source", revision: { id: "fixture-source", revision: 1 }, identity: { provider: "github", installation: "fixture", nativeId: "fixture/native", kind: "artifact" },
      originFamilyId: "fixture-origin", observedAt: start, representationSha256: sha(body), evidence: ref("fixture-evidence"), permission: ref("fixture-permission") }],
    cases: [{ id: "fixture-case", partition: "development", subject: { kind: "artifact", id: "fixture-artifact" }, claimMode: "work-regional-at-creation", primaryRoute: "github", appearances: ["github"],
      counties: ["PA:Philadelphia"], countyUnknown: false, families: { people: [], projects: [], origins: ["fixture-origin"], equivalences: [] }, sourceIds: ["fixture-source"],
      familyReview: ref("fixture-family"), selectionReceipt: ref("fixture-selection"), annotations: [], adjudication: null, challenges: ["mirror"] }],
    sampling: { heldout: null, recall: null, audit: null }, history: null });
  const records = new Map<string, any>();
  const capture: DiscoveryReceiptVerifier = async (r, e) => {
    const record = { schemaVersion: "discovery-authenticated-receipt-v1", id: r.id, authorityId: "fixture-authority", ...e, issuedAt: start, expiresAt: end };
    records.set(r.id, record); r.sha256 = await discoveryEvaluationDigest(record);
    return { status: "verified", receiptSha256: r.sha256, ...e, method: "synthetic" };
  };
  // Build the authoritative expectations through the unchanged readiness implementation.
  await assessDiscoveryReferenceReadiness(m, capture);
  const patch = (x: any): void => {
    if (!x || typeof x !== "object") return;
    if ("sha256" in x && records.has(x.id)) x.sha256 = "";
    else Object.values(x).forEach(patch);
  };
  patch(m);
  // Capture parsed schema refs cannot mutate the caller's refs: transfer explicit digests.
  const refs = [m.reviewers[0]!.authority, m.reviewers[1]!.authority, m.sources[0]!.evidence, m.sources[0]!.permission, m.cases[0]!.familyReview, m.cases[0]!.selectionReceipt];
  for (const r of refs) r.sha256 = await discoveryEvaluationDigest(records.get(r.id));
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const envelope = async (domain: string, payload: unknown) => ({ domain, keyId: "fixture-key", algorithm: "Ed25519", payload,
    signatureHex: Buffer.from(await crypto.subtle.sign("Ed25519", pair.privateKey, await discoveryReferenceSigningBytes(domain, "fixture-key", payload))).toString("hex") });
  const policy = { revision: "synthetic-not-enrolled", validFrom: start, validUntil: end,
    keys: [{ id: "fixture-key", algorithm: "Ed25519", spkiHex: Buffer.from(await crypto.subtle.exportKey("spki", pair.publicKey)).toString("hex"), roles: ["receipt", "authority"], authorityIds: ["fixture-authority"], validFrom: start, validUntil: end, revoked: false }], revokedReceiptIds: [], revokedAuthorityIds: [] };
  const authority = { schemaVersion: "discovery-authority-statement-v1", issuedAt: start, expiresAt: end,
    authority: { id: "fixture-authority", purposes: ["evidence", "permission", "reviewer-authority", "family-review", "selection", "independent-annotation", "blinding", "sampling", "history", "exposure"], principals: [null, "fixture-first", "fixture-second"], validFrom: start, validUntil: end, revoked: false } };
  const signed = async () => {
    const bundle = { receipts: await Promise.all([...records.values()].map(x => envelope("discovery-reference-receipt-signature-v1", x))), authorities: [await envelope("discovery-reference-authority-signature-v1", authority)] };
    return { bundle, verify: createDiscoveryReferenceReceiptVerifier(await createDiscoverySignedReceiptStore(policy, bundle)) };
  };
  const originals = [{ sourceId: "fixture-source", bytesBase64: Buffer.from(body).toString("base64") }];
  return { m, records, signed, policy, originals };
}
async function returned(packet: any) {
  return { schemaVersion: "discovery-human-return-v1", packetSha256: await discoveryEvaluationDigest(packet), contextSha256: packet.contextSha256,
    annotation: { reviewerId: packet.reviewerId, labels: { overall: "ambiguous", identity: "ambiguous", professionalBasis: "ambiguous", relevance: "ambiguous", currentPresence: "ambiguous", regionalCreation: "ambiguous", creatorRole: "ambiguous", rights: "ambiguous" },
      rationale: "Fictional independent draft return; no real human result.", confidence: "low", sourceIds: ["fixture-source"], rubric: revision, recordedAt: "2026-11-15T01:00:00Z" } };
}
async function signReturn(x: Awaited<ReturnType<typeof fixture>>, packet: any) {
  const result: any = await returned(packet), a = result.annotation;
  a.receipt = ref(`annotation-${a.reviewerId}`); a.blindedBatch = ref(`blind-${a.reviewerId}`);
  const payload = { ...a }; delete payload.receipt; delete payload.blindedBatch;
  const add = async (r: any, purpose: string, content: unknown) => {
    const record = { schemaVersion: "discovery-authenticated-receipt-v1", id: r.id, authorityId: "fixture-authority", purpose, subjectId: packet.caseId,
      principalId: a.reviewerId, contentSha256: await discoveryEvaluationDigest(content), issuedAt: start, expiresAt: end };
    x.records.set(r.id, record); r.sha256 = await discoveryEvaluationDigest(record);
  };
  await add(a.receipt, "independent-annotation", { schemaVersion: "discovery-independent-annotation-v2", contextSha256: packet.contextSha256, annotation: payload });
  await add(a.blindedBatch, "blinding", { schemaVersion: "discovery-blinding-v2", contextSha256: packet.contextSha256, reviewerId: a.reviewerId, rubric: a.rubric, annotation: a.receipt });
  return result;
}
test("development preparation has no invented principals, refs, labels, context or quota", () => {
  const result = prepareDiscoveryHumanReview({ groups: [{ taskId: "preparation-project-1", kind: "project", materials: [{ locator: "original-1", bodySha256: null }] }] });
  assert.equal(result.readiness, "blocked"); assert.equal(result.dispatchPermitted, false); assert.equal(result.referenceCaseCredit, 0);
  assert.ok(result.tasks[0]!.reviewerSlots.every(x => x.reviewerId === null && Object.values(x.labels).every(value => value === null)));
  assert.equal(result.tasks[0]!.strictCaseId, null); assert.equal(result.tasks[0]!.adjudication, null);
});
test("packet is an isolated whitelist and context helper matches signed readiness expectation", async () => {
  const x = await fixture(), { verify } = await x.signed();
  const packet = await dispatchDiscoveryHumanReview(x.m, "fixture-case", "fixture-first", x.originals, verify);
  assert.equal(packet.contextSha256, await discoveryEvaluationDigest(discoveryReferenceReviewContext(x.m, x.m.cases[0]!)));
  assert.equal(x.records.get("fixture-selection").contentSha256, packet.contextSha256);
  const text = JSON.stringify(packet);
  for (const hidden of ["fixture-second", "PA:Philadelphia", "mirror", "fixture-origin", '"adjudication":', '"familyReview":', '"selectionReceipt":']) assert.ok(!text.includes(hidden));
  assert.equal(Buffer.from(packet.originals[0]!.bytesBase64, "base64").toString(), body);
  assert.ok(Object.values(packet.labels).every(x => x === null));
  assert.equal(packet.originals[0]!.source.observedAt, start);
});
test("authentic stale selection, changed original, wrong rights purpose, and missing authority refuse release", async () => {
  const x = await fixture(), { verify } = await x.signed();
  for (const change of [() => { x.m.cases[0]!.counties = ["PA:Bucks"]; }, () => { x.m.sources[0]!.observedAt = end; }]) {
    const old = structuredClone(x.m); change();
    await assert.rejects(dispatchDiscoveryHumanReview(x.m, "fixture-case", "fixture-first", x.originals, verify)); x.m = old;
  }
  await assert.rejects(dispatchDiscoveryHumanReview(x.m, "fixture-case", "fixture-first", [{ sourceId: "fixture-source", bytesBase64: "YmFk" }], verify));
  x.records.get("fixture-permission").contentSha256 = await discoveryEvaluationDigest({ uses: ["fetch"] });
  await assert.rejects(dispatchDiscoveryHumanReview(x.m, "fixture-case", "fixture-first", x.originals, (await x.signed()).verify));
  x.policy.keys = []; await assert.rejects(dispatchDiscoveryHumanReview(x.m, "fixture-case", "fixture-first", x.originals, (await x.signed()).verify));
});
test("unsigned drafts stay detached and reject altered packet, rubric, role, sources and context", async () => {
  const x = await fixture(), { verify } = await x.signed(), packet = await dispatchDiscoveryHumanReview(x.m, "fixture-case", "fixture-first", x.originals, verify);
  const result = await returned(packet), checked = await checkDiscoveryHumanReturn(x.m, packet, result, verify);
  assert.equal(checked.annotationReceiptsVerified, false); assert.equal(checked.humanIdentityAndIndependenceEstablished, false);
  result.annotation.rationale = "changed after return check"; assert.notEqual((checked.originalReturn as any).annotation.rationale, result.annotation.rationale);
  for (const mutate of [(r: any) => r.annotation.reviewerId = "fixture-second", (r: any) => r.contextSha256 = "f".repeat(64), (r: any) => r.annotation.rubric.revision++, (r: any) => r.annotation.sourceIds = ["unknown"]]) {
    const r = await returned(packet); mutate(r); await assert.rejects(checkDiscoveryHumanReturn(x.m, packet, r, verify));
  }
  const changed = structuredClone(packet); changed.instructions = "machine prediction" as any;
  await assert.rejects(checkDiscoveryHumanReturn(x.m, changed, await returned(changed), verify));
});
test("two native signed returns preserve disagreement and exact adjudication input without accepting humans", async () => {
  const x = await fixture(), { verify } = await x.signed();
  const packets: [any, any] = [await dispatchDiscoveryHumanReview(x.m, "fixture-case", "fixture-first", x.originals, verify), await dispatchDiscoveryHumanReview(x.m, "fixture-case", "fixture-second", x.originals, verify)];
  const returns: [any, any] = [await signReturn(x, packets[0]), await signReturn(x, packets[1])];
  // Re-attest a genuinely distinct fictional first annotation and preserve the disagreement.
  returns[1].annotation.labels.identity = "refuted";
  const record = x.records.get(returns[1].annotation.receipt.id), { receipt, blindedBatch, ...annotation } = returns[1].annotation;
  record.contentSha256 = await discoveryEvaluationDigest({ schemaVersion: "discovery-independent-annotation-v2", contextSha256: packets[1].contextSha256, annotation });
  receipt.sha256 = await discoveryEvaluationDigest(record);
  const blindRecord = x.records.get(blindedBatch.id); blindRecord.contentSha256 = await discoveryEvaluationDigest({ schemaVersion: "discovery-blinding-v2", contextSha256: packets[1].contextSha256, reviewerId: annotation.reviewerId, rubric: annotation.rubric, annotation: receipt });
  blindedBatch.sha256 = await discoveryEvaluationDigest(blindRecord);
  const signed = await x.signed(), output = await prepareDiscoveryHumanAdjudication(x.m, packets, returns, signed.verify);
  assert.deepEqual(output.disagreements, ["identity"]); assert.deepEqual(output.annotations, returns.map(x => x.annotation));
  assert.equal(output.adjudication, null); assert.equal(output.humanIdentityAndIndependenceEstablished, false);
  assert.equal((await checkDiscoveryHumanReturn(x.m, packets[0], returns[0], signed.verify, true)).annotationReceiptsVerified, true);
  x.m.cases[0]!.annotations = [{ ...structuredClone(returns[0].annotation), reviewerId: "fixture-third-preserved" }];
  await assert.rejects(prepareDiscoveryHumanAdjudication(x.m, packets, returns, signed.verify), /full-set-handoff/);
  x.m.cases[0]!.annotations = [];
  returns[0].annotation.labels.overall = "eligible"; await assert.rejects(checkDiscoveryHumanReturn(x.m, packets[0], returns[0], signed.verify, true));
});
test("account identity cases use native subject and unqualified sampling partitions stay held", async () => {
  const x = await fixture(); x.m.cases[0]!.subject = { kind: "account", id: "fixture-account" }; x.m.cases[0]!.claimMode = "identity-relationship";
  await assessDiscoveryReferenceReadiness(x.m, async (r, e) => {
    const record = x.records.get(r.id); if (record) { record.contentSha256 = e.contentSha256; r.sha256 = await discoveryEvaluationDigest(record); }
    return { status: "verified", receiptSha256: r.sha256, ...e, method: "synthetic" };
  });
  for (const r of [x.m.cases[0]!.selectionReceipt, x.m.cases[0]!.familyReview]) r.sha256 = await discoveryEvaluationDigest(x.records.get(r.id));
  const packet = await dispatchDiscoveryHumanReview(x.m, "fixture-case", "fixture-first", x.originals, (await x.signed()).verify); assert.equal(packet.claim.subject.kind, "account");
  x.m.cases[0]!.partition = "heldout"; await assert.rejects(dispatchDiscoveryHumanReview(x.m, "fixture-case", "fixture-first", x.originals, (await x.signed()).verify));
});
test("CLI private preparation, no overwrite, aliases, bounded JSON and sanitized errors", async () => {
  const base = join(process.cwd(), ".discovery-work/wp03-human/sol"); await mkdir(base, { recursive: true, mode: 0o700 }); await chmod(base, 0o700);
  const dir = await mkdtemp(join(base, "test-")); await chmod(dir, 0o700);
  const request = join(dir, "request.json"), output = join(dir, "draft.json");
  await writeFile(request, JSON.stringify({ groups: [{ taskId: "draft-1", kind: "project", materials: [{ locator: "original", bodySha256: sha(body) }] }] }));
  const run = (args = ["prepare", "--request", request, "--output", output]) => spawnSync(process.execPath, ["--import", "tsx/esm", "scripts/discovery-human-review.mjs", ...args], { encoding: "utf8", cwd: process.cwd() });
  assert.equal(run().status, 2); assert.equal((await stat(output)).mode & 0o777, 0o600); const bytes = await readFile(output, "utf8");
  assert.equal(run().status, 3); assert.equal(await readFile(output, "utf8"), bytes);
  for (const body of ['{"groups":[],"groups":[]}', '{"secret":"\\ud800"}', '{"secret":1.2}']) {
    await writeFile(request, body); const result = run(["prepare", "--request", request, "--output", join(dir, "bad.json")]);
    assert.equal(result.status, 3); assert.equal(result.stderr, "invalid_offline_human_review\n"); assert.equal(result.stdout, "");
  }
  const alias = join(dir, "alias"); await symlink(request, alias); assert.equal(run(["prepare", "--request", alias, "--output", join(dir, "new.json")]).status, 3);
  const hard = join(dir, "hard"); await link(output, hard); assert.equal(run(["prepare", "--request", request, "--output", hard]).status, 3);
});
async function reattest(x: Awaited<ReturnType<typeof fixture>>) {
  for (let round = 0; round < 4; round++) {
    await assessDiscoveryReferenceReadiness(x.m, async (r, e) => {
      x.records.set(r.id, { schemaVersion: "discovery-authenticated-receipt-v1", id: r.id, authorityId: "fixture-authority", ...e, issuedAt: start, expiresAt: end });
      return { status: "verified", receiptSha256: r.sha256, ...e, method: "synthetic" };
    });
    const walk = async (v: any): Promise<void> => {
      if (!v || typeof v !== "object") return;
      if (typeof v.id === "string" && typeof v.sha256 === "string" && x.records.has(v.id)) v.sha256 = await discoveryEvaluationDigest(x.records.get(v.id));
      else for (const value of Object.values(v)) await walk(value);
    };
    await walk(x.m);
  }
}
async function samplingFixture(kind: "heldout" | "recall") {
  const x = await fixture(); x.m.cases[0]!.partition = kind;
  x.m.sampling[kind] = { frame: ref(`fixture-frame-${kind}`), assembly: ref(`fixture-assembly-${kind}`), method: "Fictional independently selected frame", selectedAt: "2026-02-01T00:00:00Z", sourceScopes: ["fixture-scope"], from: start, until: "2026-02-01T00:00:00Z" };
  x.m.history = { receipt: ref("fixture-history"), exposures: [], previous: [] };
  const routes = ["github", "pubmed", "crossref", "arxiv", "forum", "institutional"] as const;
  const append = (id: string, partition: "heldout" | "recall" | "development", route: typeof routes[number]) => {
    const source = structuredClone(x.m.sources[0]!), item = structuredClone(x.m.cases[0]!);
    source.id = `source-${id}`; source.revision = { id: source.id, revision: 1 }; source.identity.provider = route; source.identity.nativeId = id;
    source.originFamilyId = `origin-${id}`; source.representationSha256 = sha(`distinct synthetic bytes ${id}`); source.evidence = ref(`evidence-${id}`); source.permission = ref(`permission-${id}`);
    item.id = id; item.partition = partition; item.subject.id = `subject-${id}`; item.primaryRoute = route; item.appearances = [route];
    item.sourceIds = [source.id]; item.families = { people: [], projects: [], origins: [source.originFamilyId], equivalences: [] };
    item.familyReview = ref(`family-${id}`); item.selectionReceipt = ref(`selection-${id}`);
    x.m.sources.push(source); x.m.cases.push(item);
  };
  for (let i = 1; i < (kind === "heldout" ? 360 : 100); i++) append(`${kind}-case-${i}`, kind, routes[i % 6]!);
  append("fixture-development", "development", "github");
  await reattest(x); return x;
}
for (const kind of ["heldout", "recall"] as const) test(`${kind} dispatch requires authentic sampling, independent assembly and complete history`, async () => {
  const x = await samplingFixture(kind), { verify } = await x.signed();
  const packet = await dispatchDiscoveryHumanReview(x.m, "fixture-case", "fixture-first", x.originals, verify); assert.equal(packet.caseId, "fixture-case");
  for (const id of [`fixture-frame-${kind}`, `fixture-assembly-${kind}`, "fixture-history"]) {
    const original = x.records.get(id); x.records.delete(id);
    await assert.rejects(dispatchDiscoveryHumanReview(x.m, "fixture-case", "fixture-first", x.originals, (await x.signed()).verify)); x.records.set(id, original);
  }
});
test("async mutation cannot substitute handoff labels or preserved original returns", async () => {
  const x = await fixture(), signed = await x.signed();
  const packets: [any, any] = [await dispatchDiscoveryHumanReview(x.m, "fixture-case", "fixture-first", x.originals, signed.verify), await dispatchDiscoveryHumanReview(x.m, "fixture-case", "fixture-second", x.originals, signed.verify)];
  const returns: [any, any] = [await signReturn(x, packets[0]), await signReturn(x, packets[1])], verifier = (await x.signed()).verify;
  const mutate: DiscoveryReceiptVerifier = async (r, e) => {
    if (e.purpose === "blinding") { returns[0].annotation.labels.identity = "supported"; returns[0].annotation.rationale = "unverified mutation"; }
    return verifier(r, e);
  };
  const handoff = await prepareDiscoveryHumanAdjudication(x.m, packets, returns, mutate);
  assert.equal(handoff.annotations[0]!.labels.identity, "ambiguous");
  assert.notEqual((handoff.preservedReturns[0] as any).annotation.rationale, "unverified mutation");
});
test("CLI dispatch, unsigned check, signed verification and paired handoff run end to end privately", async () => {
  const x = await fixture(), first = await x.signed();
  const base = join(process.cwd(), ".discovery-work/wp03-human/sol"); await mkdir(base, { recursive: true, mode: 0o700 }); await chmod(base, 0o700);
  const dir = await mkdtemp(join(base, "e2e-")); await chmod(dir, 0o700);
  const files = Object.fromEntries(["manifest", "bundle", "policy", "request", "original", "packet", "return", "unsigned", "verified", "second-packet", "second-return", "handoff"].map(name => [name, join(dir, `${name}.json`)]));
  const write = async (name: string, value: unknown) => writeFile(files[name]!, JSON.stringify(value));
  await Promise.all([write("manifest", x.m), write("bundle", first.bundle), write("policy", x.policy), writeFile(files.original!, body),
    write("request", { caseId: "fixture-case", reviewerId: "fixture-first", originals: [{ sourceId: "fixture-source", path: files.original }] })]);
  const trust = ["--manifest", files.manifest!, "--bundle", files.bundle!, "--trust-policy", files.policy!, "--expected-policy-sha256", sha(JSON.stringify(x.policy))];
  const run = (operation: string, args: string[]) => spawnSync(process.execPath, ["--import", "tsx/esm", "scripts/discovery-human-review.mjs", operation, ...trust, ...args], { cwd: process.cwd(), encoding: "utf8" });
  const dispatch = run("dispatch", ["--request", files.request!, "--output", files.packet!]); assert.equal(dispatch.status, 0, dispatch.stderr);
  const packet = JSON.parse(await readFile(files.packet!, "utf8")); await write("return", await returned(packet));
  assert.equal(run("check-return", ["--packet", files.packet!, "--return", files.return!, "--output", files.unsigned!]).status, 0);
  const unsigned = JSON.parse(await readFile(files.unsigned!, "utf8")); assert.equal(unsigned.annotationReceiptsVerified, false);
  assert.equal(Buffer.from(unsigned.originalReturnFileBase64, "base64").toString(), await readFile(files.return!, "utf8"));
  const secondPacket = await dispatchDiscoveryHumanReview(x.m, "fixture-case", "fixture-second", x.originals, first.verify);
  await write("second-packet", secondPacket); await write("return", await signReturn(x, packet)); await write("second-return", await signReturn(x, secondPacket)); await write("bundle", (await x.signed()).bundle);
  const verified = run("verify-return", ["--packet", files.packet!, "--return", files.return!, "--output", files.verified!]); assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(await readFile(files.verified!, "utf8")).annotationReceiptsVerified, true);
  const handoff = run("adjudication-handoff", ["--first-packet", files.packet!, "--second-packet", files["second-packet"]!, "--first-return", files.return!, "--second-return", files["second-return"]!, "--output", files.handoff!]); assert.equal(handoff.status, 0, handoff.stderr);
  assert.equal(JSON.parse(await readFile(files.handoff!, "utf8")).adjudication, null);
  for (const name of ["packet", "unsigned", "verified", "handoff"]) assert.equal((await stat(files[name]!)).mode & 0o777, 0o600);
});
