import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EVALUATION_MODELS, EvaluationCase, EvaluationConfiguration, POLICY_GROUPS, REQUIRED_DESK_COUNTS,
  ReplaySpendLedger, caseHashes, evaluationHash, replayEvaluationPair, validateEvaluationCorpus,
} from "../src/ingest/watch-model-evaluation.ts";
import {
  SYNTHETIC_TIME, heldReply, passingReplies, reply, sealSyntheticCase,
  syntheticCase, syntheticConfiguration, syntheticCorpus,
} from "./fixtures/watch-model-evaluation/fixtures.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const script = join(root, "scripts/evaluate-watch-model.mjs");
const guard = join(root, "test/fixtures/watch-model-evaluation/no-network.mjs");
const codes = (result: Awaited<ReturnType<typeof validateEvaluationCorpus>>) => [...result.issues, ...result.holds].map((issue) => issue.code);

async function allocationFixture() {
  // Mechanically generated synthetic counting data, never a real gold corpus.
  const cases: EvaluationCase[] = [];
  const calibrationCounts = { news: 4, events: 2, technology: 5, "cross-cutting": 2 };
  for (const [desk, count] of Object.entries(REQUIRED_DESK_COUNTS)) {
    if (desk === "policy") continue;
    for (let index = 0; index < count; index += 1) {
      cases.push(await syntheticCase({
        caseId: `synthetic-${desk}-${index}`, desk: desk as EvaluationCase["desk"], policyJurisdiction: null,
        split: index < calibrationCounts[desk as keyof typeof calibrationCounts] ? "calibration" : "holdout",
        critical: desk === "cross-cutting",
      }));
    }
  }
  for (const [groupIndex, policyJurisdiction] of POLICY_GROUPS.entries()) {
    for (let index = 0; index < 7; index += 1) {
      cases.push(await syntheticCase({
        caseId: `synthetic-policy-${policyJurisdiction}-${index}`, policyJurisdiction,
        split: index < (groupIndex < 2 ? 2 : 1) ? "calibration" : "holdout",
      }));
    }
  }
  return syntheticCorpus(cases);
}

test("configuration pins exact Contributor models and rejects new phases, fields, budgets, and unsupported stages", async () => {
  const config = syntheticConfiguration();
  assert.deepEqual(config.models, EVALUATION_MODELS);
  assert.equal(EvaluationConfiguration.safeParse({ ...config, models: { ...config.models, candidate: "meta/muse-spark-1.3" } }).success, false);
  assert.equal(EvaluationConfiguration.safeParse({ ...config, phase: "watch-prompts" }).success, false);
  assert.equal(EvaluationConfiguration.safeParse({ ...config, apiKey: "synthetic-secret" }).success, false);
  assert.equal(EvaluationConfiguration.safeParse({ ...config, maxCalls: -1 }).success, false);
  assert.equal(EvaluationConfiguration.safeParse({ ...config, maxSpendNanoUsd: Number.MAX_SAFE_INTEGER }).success, false);
  const row = await syntheticCase();
  assert.equal(EvaluationCase.safeParse({ ...row, source: { ...row.source, url: "not-a-url" } }).success, false);
  assert.equal(EvaluationCase.safeParse({ ...row, source: { ...row.source, url: "https://user:password@source.invalid/synthetic" } }).success, false);
  assert.equal(EvaluationCase.safeParse({ ...row, expected: { ...row.expected, dates: [{ field: "action", precision: "day", value: "2026-02-30" }] } }).success, false);
  assert.equal(EvaluationCase.safeParse({ ...row, expected: { ...row.expected, dates: [{ field: "action", precision: "unknown", value: "2026-09-12" }] } }).success, false);
  await assert.rejects(() => replayEvaluationPair(row, config, { baseline: [], candidate: [] }, "holdout"), /wrong-evaluation-stage/);
});

test("100 synthetic cases prove exact allocation and split arithmetic without qualifying real evaluation", async () => {
  const corpus = await allocationFixture();
  const readiness = await validateEvaluationCorpus(corpus, syntheticConfiguration(), "calibration");
  assert.equal(readiness.integrityValid, true, JSON.stringify(readiness.issues));
  assert.deepEqual(readiness.counts, REQUIRED_DESK_COUNTS);
  assert.deepEqual(readiness.splitCounts, { calibration: 20, holdout: 80 });
  assert.equal(readiness.selectedCases, 20);
  assert.equal(readiness.attemptsPerModel, 24, "Two critical calibration cases repeat three times, not six new cases");
  assert.equal(readiness.maximumCalls, 144, "Every possible verifier call is included");
  assert.equal(readiness.qualificationRequirementsMet, false);
  assert.equal(readiness.liveExecutionEnabled, false);
  for (const code of ["synthetic-is-not-real-evaluation-evidence", "editor-labels-incomplete", "adjudication-pending", "split-not-attested", "pricing-unqualified", "confirmation-missing"]) {
    assert.ok(codes(readiness).includes(code), code);
  }
  const holdout = await validateEvaluationCorpus(corpus, syntheticConfiguration(), "holdout");
  assert.equal(holdout.selectedCases, 80);
  assert.equal(holdout.attemptsPerModel, 96);
});

test("wrong totals, duplicate IDs/scenarios, missing regions, and unstratified splits fail", async () => {
  const config = syntheticConfiguration();
  const original = await allocationFixture();
  const missing = await syntheticCorpus(original.cases.slice(1));
  const missingResult = await validateEvaluationCorpus(missing, config, "calibration");
  assert.ok(codes(missingResult).includes("case-count"));
  assert.ok(codes(missingResult).includes("desk-allocation"));
  const duplicate = structuredClone(original);
  duplicate.cases[1] = duplicate.cases[0];
  const duplicateResult = await validateEvaluationCorpus(duplicate, config, "calibration");
  assert.ok(codes(duplicateResult).includes("duplicate-case-id"));
  assert.ok(codes(duplicateResult).includes("duplicate-scenario"));
  const noDe = structuredClone(original);
  for (const row of noDe.cases) if (row.policyJurisdiction === "DE") row.policyJurisdiction = "PA";
  assert.ok(codes(await validateEvaluationCorpus(noDe, config, "calibration")).includes("policy-allocation"));
  const noSplit = structuredClone(original);
  for (const [index, row] of noSplit.cases.entries()) row.split = index < 20 ? "calibration" : "holdout";
  assert.ok(codes(await validateEvaluationCorpus(noSplit, config, "calibration")).includes("split-desk-coverage"));
  const wrongKind = structuredClone(original);
  wrongKind.cases[0].desk = "events";
  assert.ok(codes(await validateEvaluationCorpus(wrongKind, config, "calibration")).includes("desk-input-kind-mismatch"));
});

test("source, case, configuration and split hashes detect material tampering", async () => {
  const config = syntheticConfiguration();
  const corpus = await syntheticCorpus([await syntheticCase()]);
  const changed = structuredClone(corpus);
  changed.cases[0].source.text += " A changed synthetic exception.";
  const result = await validateEvaluationCorpus(changed, config, "calibration");
  assert.ok(codes(result).includes("source-hash-mismatch"));
  assert.ok(codes(result).includes("case-hash-mismatch"));
  assert.ok(codes(result).includes("source-input-mismatch"));
  const changedConfig = { ...config, timeoutMs: 10_000 };
  assert.ok(codes(await validateEvaluationCorpus(corpus, changedConfig, "calibration")).includes("configuration-hash-mismatch"));
  corpus.cases[0].split = "holdout";
  assert.ok(codes(await validateEvaluationCorpus(corpus, config, "holdout")).includes("split-hash-mismatch"));
  assert.equal(await evaluationHash({ a: 1, b: { c: 2 } }), await evaluationHash({ b: { c: 2 }, a: 1 }), "Object-key ordering is not evidence drift");
});

test("reviewer labels require distinct reviewers and current case/expected hashes; pending adjudication never approves", async () => {
  const row = await syntheticCase({ critical: true });
  const hashes = await caseHashes(row);
  row.reviewerLabels = [{ reviewerId: "synthetic-reviewer-a", decision: "approved", reviewedAt: SYNTHETIC_TIME, caseSha256: hashes.caseSha256, expectedSha256: hashes.expectedSha256 }];
  let result = await validateEvaluationCorpus(await syntheticCorpus([row]), syntheticConfiguration(), "calibration");
  assert.ok(codes(result).includes("editor-labels-incomplete"));
  assert.ok(codes(result).includes("adjudication-pending"));
  row.reviewerLabels.push(structuredClone(row.reviewerLabels[0]));
  assert.ok(codes(await validateEvaluationCorpus(await syntheticCorpus([row]), syntheticConfiguration(), "calibration")).includes("duplicate-reviewer-label"));
  row.reviewerLabels[1].reviewerId = "synthetic-reviewer-b";
  row.reviewerLabels[1].decision = "disputed";
  assert.ok(codes(await validateEvaluationCorpus(await syntheticCorpus([row]), syntheticConfiguration(), "calibration")).includes("unresolved-label-disagreement"));
  row.expected.prohibitedClaims.push("Another synthetic prohibited conclusion.");
  const resealed = await sealSyntheticCase(row);
  result = await validateEvaluationCorpus(await syntheticCorpus([resealed]), syntheticConfiguration(), "calibration");
  assert.ok(codes(result).includes("stale-reviewer-label"));
  assert.equal(result.qualificationRequirementsMet, false);
});

test("required literal spans, input bounds, review status, and complete worst-case budgets remain gated", async () => {
  const row = await syntheticCase();
  row.expected.requiredEvidenceSpans = ["This text was never in the synthetic source."];
  row.legacyItem.status = "published";
  row.legacyItem.impactSentence = "Synthetic publication is not authorized.";
  row.legacyItem.body += "x".repeat(6_001);
  const config = { ...syntheticConfiguration(), maxCalls: 0, maxSpendNanoUsd: 0 };
  const corpus = await syntheticCorpus([await sealSyntheticCase(row)], config);
  const result = await validateEvaluationCorpus(corpus, config, "calibration");
  for (const code of ["required-span-not-literal", "input-would-be-truncated", "input-must-remain-review", "insufficient-call-cap", "insufficient-spend-cap"]) {
    assert.ok(codes(result).includes(code), code);
  }
});

test("paired replay invokes existing split editor and verifier wrappers without network or publication", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("No real fetch may execute"); });
  const row = await syntheticCase();
  const replies = passingReplies(row);
  const result = await replayEvaluationPair(row, syntheticConfiguration(), { baseline: replies, candidate: replies }, "calibration");
  assert.equal(result.requestCount, 6, JSON.stringify(result));
  assert.deepEqual(result.requests.map((request) => request.stage), ["classification", "copy", "verifier", "classification", "copy", "verifier"]);
  assert.equal(result.results.every((run) => run.enrichment === "schema-and-evidence-valid" && run.verifierApproved === true), true);
  assert.equal(result.committedNanoUsd, 720_000);
  assert.equal(result.publicationPerformed, false);
  assert.equal(result.measuredProviderLatency, false);
  assert.equal(result.editorialQualityEvaluated, false);
  for (const request of result.requests) {
    for (const hash of [request.caseSha256, request.configurationSha256, request.promptSha256, request.inputSha256, request.requestSha256, request.schemaSha256, request.requestConfigurationSha256, request.responseSha256]) assert.match(hash!, /^[a-f0-9]{64}$/);
    assert.equal(request.timeoutMs, 45_000);
    assert.equal(request.scriptedLatencyMs, 25);
    assert.equal(request.usage?.promptTokens, 1_000);
  }
  for (let index = 0; index < 3; index += 1) {
    assert.equal(result.requests[index].promptSha256, result.requests[index + 3].promptSha256);
    assert.equal(result.requests[index].inputSha256, result.requests[index + 3].inputSha256);
    assert.notEqual(result.requests[index].requestSha256, result.requests[index + 3].requestSha256);
  }
  assert.ok(!JSON.stringify(result).includes("synthetic-offline-replay-only"), "Authorization headers never enter receipts");
});

test("critical repetitions are three per model and held classifications do not fabricate copy/verifier calls", async () => {
  const row = await syntheticCase({ critical: true });
  const replies = [heldReply(), heldReply(), heldReply()];
  const result = await replayEvaluationPair(row, syntheticConfiguration(), { baseline: replies, candidate: replies }, "calibration");
  assert.equal(result.distinctCases, 1);
  assert.equal(result.repetitionsPerModel, 3);
  assert.equal(result.requestCount, 6);
  assert.ok(result.requests.every((request) => request.stage === "classification"));
  assert.deepEqual(result.results.map((run) => run.repetition), [1, 2, 3, 1, 2, 3]);
});

test("timeouts retain spend reservations across snapshot reload and blocked follow-on dispatch", async () => {
  const row = await syntheticCase();
  const config = syntheticConfiguration();
  const reserve = config.maxInputTokens * 100 + 4_096 * 200;
  config.maxSpendNanoUsd = reserve;
  const timeout = { outcome: "timeout", stage: "classification", elapsedMs: 45_000 };
  const result = await replayEvaluationPair(row, config, { baseline: [timeout], candidate: [timeout] }, "calibration");
  assert.equal(result.requestCount, 1, "Second model is blocked before a simulated request");
  assert.equal(result.committedNanoUsd, reserve);
  assert.equal(result.spend.entries[0].state, "unresolved");
  assert.equal(result.spend.entries[0].actualNanoUsd, null);
  assert.ok(result.replayIssues.some((issue) => issue.code === "spend-cap-exhausted"));
  const restored = new ReplaySpendLedger(config.maxSpendNanoUsd, config.maxCalls, result.spend);
  assert.equal(restored.committedNanoUsd, reserve);
  assert.throws(() => restored.reserve("synthetic-next-request", 1), /spend-cap-exhausted/);
});

test("missing, malformed, incomplete, HTTP-error, and excessive actual usage never become silently free", async () => {
  const row = await syntheticCase();
  const config = syntheticConfiguration();
  const badReplies = [
    { ...heldReply(), status: 429, body: "not-json" },
    reply("classification", { decision: "hold" }, null),
    reply("classification", { decision: "hold" }, { prompt_tokens: 100 }),
    reply("classification", { decision: "hold" }, { prompt_tokens: -1, completion_tokens: 0 }),
  ];
  for (const bad of badReplies) {
    const result = await replayEvaluationPair(row, config, { baseline: [bad], candidate: [bad] }, "calibration");
    assert.equal(result.requestCount, 2);
    assert.ok(result.spend.entries.every((entry) => entry.state === "unresolved" && entry.actualNanoUsd === null));
    assert.ok(result.committedNanoUsd > 0);
  }
  const over = reply("classification", { decision: "hold" }, { prompt_tokens: 1_000_000, completion_tokens: 100 });
  const exceeded = await replayEvaluationPair(row, config, { baseline: [over], candidate: [over] }, "calibration");
  assert.ok(exceeded.spend.entries.every((entry) => entry.actualNanoUsd! > entry.reservedNanoUsd));
  assert.equal(exceeded.committedNanoUsd, 200_040_000, "Actual usage is never clamped to the reservation");
});

test("verifier timeout is accounted independently after two successful editor calls", async () => {
  const row = await syntheticCase();
  const replies: unknown[] = passingReplies(row);
  replies[2] = { outcome: "timeout", stage: "verifier", elapsedMs: 45_000 };
  const result = await replayEvaluationPair(row, syntheticConfiguration(), { baseline: replies, candidate: replies }, "calibration");
  assert.equal(result.requestCount, 6);
  assert.equal(result.results.every((run) => run.verifierApproved === false), true);
  assert.deepEqual(result.spend.entries.map((entry) => entry.state), ["reconciled", "reconciled", "unresolved", "reconciled", "reconciled", "unresolved"]);
  assert.equal(result.results.some((run) => run.legacyDisposition?.action === "publish"), false);
});

test("malformed model JSON and unsupported copy stop the unchanged validators without releasing observed spend", async () => {
  const row = await syntheticCase();
  const malformed = { ...heldReply(), body: JSON.stringify({ choices: [{ message: { content: "not json" } }], usage: { prompt_tokens: 1_000, completion_tokens: 100 } }) };
  const malformedResult = await replayEvaluationPair(row, syntheticConfiguration(), { baseline: [malformed], candidate: [malformed] }, "calibration");
  assert.equal(malformedResult.requestCount, 2);
  assert.ok(malformedResult.results.every((result) => result.enrichment === "malformed"));
  const unsupported = [passingReplies(row)[0], reply("copy", { impactSentence: "An unsupported clinical claim.", body: "An unsupported clinical claim.", bodyEvidenceSpans: ["An unsupported clinical claim."] })];
  const unsupportedResult = await replayEvaluationPair(row, syntheticConfiguration(), { baseline: unsupported, candidate: unsupported }, "calibration");
  assert.equal(unsupportedResult.requestCount, 4);
  assert.ok(unsupportedResult.results.every((result) => result.enrichment === "validation" && result.legacyDisposition === null));
  assert.equal(unsupportedResult.committedNanoUsd, 480_000);
});

test("no-key default is not used, wrong stage and unapproved live evidence cannot be replayed", async () => {
  const row = await syntheticCase();
  const config = syntheticConfiguration();
  await assert.rejects(() => replayEvaluationPair({ ...row, fixtureType: "public-source" }, config, { baseline: [], candidate: [] }, "calibration"), /explicit-synthetic/);
  await assert.rejects(() => replayEvaluationPair(row, config, { baseline: [], candidate: [] }, "holdout"), /wrong-evaluation-stage/);
  await assert.rejects(() => replayEvaluationPair(row, config, { baseline: [], candidate: [] }, "calibration", new ReplaySpendLedger(0, 0)), /ledger-configuration-mismatch/);
  const zero = { ...config, maxCalls: 0 };
  const result = await replayEvaluationPair(row, zero, { baseline: [heldReply()], candidate: [heldReply()] }, "calibration");
  assert.equal(result.requestCount, 0);
  assert.equal(result.committedNanoUsd, 0);
  assert.ok(result.replayIssues.some((issue) => issue.code === "call-cap-exhausted"));
});

test("ledger rejects inconsistent restore, duplicate request IDs, cap resets, and unsafe arithmetic", () => {
  const ledger = new ReplaySpendLedger(1_000, 2);
  ledger.reserve("synthetic-reserved", 500);
  assert.throws(() => ledger.reserve("synthetic-reserved", 1), /duplicate-spend-request/);
  ledger.unresolved("synthetic-reserved");
  const restored = new ReplaySpendLedger(1_000, 2, ledger.snapshot());
  assert.equal(restored.committedNanoUsd, 500);
  restored.reconcile("synthetic-reserved", 800);
  assert.equal(restored.committedNanoUsd, 800);
  assert.throws(() => restored.reserve("synthetic-more", 201), /spend-cap-exhausted/);
  assert.throws(() => restored.reconcile("synthetic-reserved", 1), /spend-state-conflict/);
  assert.throws(() => new ReplaySpendLedger(1_000, 2, { version: "watch-evaluation-spend-1", entries: [{ requestId: "synthetic-bad", reservedNanoUsd: 500, state: "unresolved", actualNanoUsd: 0 }] }), /inconsistent-spend-state/);
  assert.throws(() => new ReplaySpendLedger(1_000, 2, { version: "watch-evaluation-spend-1", entries: ["a", "b"].map((requestId) => ({ requestId, reservedNanoUsd: Number.MAX_SAFE_INTEGER, state: "reserved", actualNanoUsd: null })) }), /spend-overflow/);
  const overflow = new ReplaySpendLedger(1_000, 2);
  overflow.reserve("synthetic-a", 100);
  overflow.reserve("synthetic-b", 100);
  overflow.reconcile("synthetic-a", Number.MAX_SAFE_INTEGER - 100);
  assert.throws(() => overflow.reconcile("synthetic-b", 200), /spend-overflow/);
  assert.equal(overflow.snapshot().entries[1].actualNanoUsd, null);
});

test("CLI defaults and live rejection work with network and operational credential reads forbidden", () => {
  const run = (args: string[]) => spawnSync(process.execPath, ["--import", guard, "--import", "tsx/esm", script, ...args], { cwd: root, encoding: "utf8", timeout: 10_000 });
  const idle = run([]);
  assert.equal(idle.status, 0, idle.stderr);
  assert.equal(JSON.parse(idle.stdout).status, "offline-preparation-only");
  const blocked = run(["--mode", "live", "--corpus", "/does/not/exist/private-input", "--configuration", "/does/not/exist/provider-key"]);
  assert.equal(blocked.status, 2);
  assert.deepEqual(JSON.parse(blocked.stdout), { status: "blocked", code: "live-execution-not-qualified", networkRequests: 0, publicationEnabled: false });
});

test("CLI validates and replays bounded synthetic files, emits hashes, and never exposes source bodies or credentials", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tvd-watch-evaluation-test-"));
  try {
    const row = await syntheticCase();
    const config = syntheticConfiguration();
    const corpus = await syntheticCorpus([row], config);
    const corpusFile = join(dir, "corpus.json");
    const configurationFile = join(dir, "configuration.json");
    const recordingsFile = join(dir, "recordings.json");
    writeFileSync(corpusFile, JSON.stringify(corpus));
    writeFileSync(configurationFile, JSON.stringify(config));
    writeFileSync(recordingsFile, JSON.stringify({ baseline: passingReplies(row), candidate: passingReplies(row) }));
    const run = (args: string[]) => spawnSync(process.execPath, ["--import", guard, "--import", "tsx/esm", script, "--stage", "calibration", "--corpus", corpusFile, "--configuration", configurationFile, ...args], { cwd: root, encoding: "utf8", timeout: 10_000 });
    const validation = run(["--mode", "validate"]);
    assert.equal(validation.status, 2, validation.stderr);
    const readiness = JSON.parse(validation.stdout);
    assert.equal(readiness.credentialSource, "none");
    assert.equal(readiness.readiness.qualificationRequirementsMet, false);
    assert.match(readiness.implementationSha256, /^[a-f0-9]{64}$/);
    const replay = run(["--mode", "replay", "--case", row.caseId, "--recordings", recordingsFile]);
    assert.equal(replay.status, 0, replay.stdout + replay.stderr);
    const result = JSON.parse(replay.stdout);
    assert.equal(result.result.requestCount, 6);
    assert.equal(result.networkRequests, 0);
    assert.ok(!replay.stdout.includes(row.legacyItem.body));
    assert.ok(!replay.stdout.includes("synthetic-offline-replay-only"));
    writeFileSync(corpusFile, "{");
    assert.equal(run(["--mode", "validate"]).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
