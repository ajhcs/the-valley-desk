import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareWatchReviewPacket, renderWatchReviewPacketMarkdown, REVIEW_PACKET_LIMITS } from "../src/ingest/watch-review-packets";
import { caseHashes, evaluationHash, splitHash } from "../src/ingest/watch-model-evaluation";
import { evidenceHash } from "../src/ingest/policy-pdf";
import { SYNTHETIC_TIME, syntheticCase, syntheticConfiguration, syntheticCorpus } from "./fixtures/watch-model-evaluation/fixtures";

const root = fileURLToPath(new URL("../", import.meta.url));
const script = join(root, "scripts/prepare-watch-review-packets.mjs");
const guard = join(root, "test/fixtures/watch-model-evaluation/no-network.mjs");
const gapCodes = (result: Awaited<ReturnType<typeof prepareWatchReviewPacket>>) => result.gapReport.gaps.map(gap => gap.code);

test("draft packet exposes exact evidence hashes and missing approvals without mutating inputs", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network"); });
  const configuration = syntheticConfiguration(), corpus = await syntheticCorpus([await syntheticCase()]);
  const before = JSON.stringify({ corpus, configuration });
  const result = await prepareWatchReviewPacket(corpus, configuration, { stage: "calibration" });
  const row = result.packet.cases[0]!, hashes = await caseHashes(corpus.cases[0]);
  assert.equal(result.packet.approvalsIssued, 0); assert.equal(result.packet.liveExecutionEnabled, false);
  assert.equal(result.packet.publicationEnabled, false); assert.equal(result.packet.qualificationGranted, false);
  assert.equal(row.hashes.source.computed, hashes.sourceSha256); assert.equal(row.hashes.case.computed, hashes.caseSha256);
  assert.equal(row.hashes.expectedSha256, hashes.expectedSha256);
  assert.equal(result.packetSha256, await evaluationHash(result.packet));
  assert.equal(result.packet.gapReportSha256, await evaluationHash(result.gapReport));
  assert.equal(row.review.status, "missing-reviewers"); assert.deepEqual(row.review.labels, []);
  assert.equal(row.review.adjudication.declaredStatus, "pending");
  assert.equal(row.literalEvidence[0]!.literal, true); assert.ok(row.literalEvidence[0]!.firstUtf16Offset >= 0);
  for (const code of ["synthetic-is-not-real-evaluation-evidence", "editor-labels-incomplete", "adjudication-pending", "split-not-attested"]) assert.ok(gapCodes(result).includes(code), code);
  assert.equal(JSON.stringify({ corpus, configuration }), before);
});

test("inventory is immutable and both splits are hashed while calibration cannot expose holdout evidence", async () => {
  const configuration = syntheticConfiguration();
  const holdout = await syntheticCase({ caseId: "holdout-record", split: "holdout" });
  holdout.source.text = "PRIVATE-HOLDOUT-REVIEW-CONTENT";
  holdout.expected.allowedClaims = ["HOLDOUT-GOLD-LABEL-ONLY"];
  const corpus = await syntheticCorpus([await syntheticCase(), holdout]);
  const result = await prepareWatchReviewPacket(corpus, configuration, { stage: "calibration" });
  assert.equal(result.packet.inventory.entries.length, 2); assert.equal(result.packet.cases.length, 1);
  assert.equal(result.packet.split.hash.computed, await splitHash(corpus.cases));
  assert.equal(result.packet.inventory.sha256, await evaluationHash(result.packet.inventory.entries));
  assert.ok(Object.isFrozen(result.packet.inventory.entries)); assert.ok(Object.isFrozen(result.packet.inventory.entries[0]));
  assert.throws(() => { (result.packet.inventory.entries[0] as { split: string }).split = "holdout"; }, TypeError);
  for (const output of [JSON.stringify(result), renderWatchReviewPacketMarkdown(result)]) {
    assert.ok(!output.includes("PRIVATE-HOLDOUT-REVIEW-CONTENT")); assert.ok(!output.includes("HOLDOUT-GOLD-LABEL-ONLY"));
  }
  const selected = await prepareWatchReviewPacket(corpus, configuration, { stage: "holdout" });
  assert.equal(selected.packet.cases[0]!.source.text, holdout.source.text);
});

test("hash drift and missing digests stay visible and expected pins never repair inputs", async () => {
  const configuration = syntheticConfiguration(), corpus = await syntheticCorpus([await syntheticCase()]);
  const prior = await prepareWatchReviewPacket(corpus, configuration, { stage: "calibration" });
  corpus.cases[0]!.source.text += " A changed literal source.";
  corpus.cases[0]!.caseSha256 = null; corpus.cases[0]!.split = "holdout";
  configuration.timeoutMs = 10_000;
  const result = await prepareWatchReviewPacket(corpus, configuration, { stage: "holdout", expectedCorpusSha256: prior.packet.corpusSha256,
    expectedConfigurationSha256: prior.packet.configuration.hash.computed, expectedSplitSha256: prior.packet.split.hash.computed });
  for (const code of ["source-hash-mismatch", "case-digest-missing", "configuration-hash-mismatch", "split-hash-mismatch",
    "pinned-corpus-hash-drift", "pinned-configuration-hash-drift", "pinned-split-hash-drift"]) assert.ok(gapCodes(result).includes(code), code);
  assert.equal(result.packet.cases[0]!.hashes.case.status, "missing"); assert.equal(corpus.cases[0]!.caseSha256, null);
});

test("supplied approvals remain declarations, disputes and stale or duplicate reviewers are explicit", async () => {
  const row = await syntheticCase({ critical: true }); const hashes = await caseHashes(row);
  row.reviewerLabels = [
    { reviewerId: "reviewer-a", decision: "approved", reviewedAt: SYNTHETIC_TIME, caseSha256: hashes.caseSha256, expectedSha256: hashes.expectedSha256 },
    { reviewerId: "reviewer-b", decision: "disputed", reviewedAt: SYNTHETIC_TIME, caseSha256: hashes.caseSha256, expectedSha256: hashes.expectedSha256 },
  ];
  row.adjudication = { status: "approved", receiptId: "PRIVATE-RECEIPT", adjudicatorId: "PRIVATE-ADJUDICATOR", adjudicatedAt: SYNTHETIC_TIME, caseSha256: hashes.caseSha256 };
  let result = await prepareWatchReviewPacket(await syntheticCorpus([row]), syntheticConfiguration(), { stage: "calibration" });
  assert.equal(result.packet.cases[0]!.review.status, "disputed"); assert.equal(result.packet.cases[0]!.review.missingReviewerCount, 1);
  assert.equal(result.packet.cases[0]!.review.adjudication.authenticatedByThisTool, false);
  assert.ok(!JSON.stringify(result).includes("PRIVATE-RECEIPT")); assert.ok(!JSON.stringify(result).includes("PRIVATE-ADJUDICATOR"));
  row.reviewerLabels[1]!.decision = "approved"; row.reviewerLabels[1]!.caseSha256 = "0".repeat(64);
  result = await prepareWatchReviewPacket(await syntheticCorpus([row]), syntheticConfiguration(), { stage: "calibration" });
  assert.equal(result.packet.cases[0]!.review.status, "stale-or-duplicate"); assert.ok(gapCodes(result).includes("stale-reviewer-label"));
  row.reviewerLabels[1] = structuredClone(row.reviewerLabels[0]!);
  result = await prepareWatchReviewPacket(await syntheticCorpus([row]), syntheticConfiguration(), { stage: "calibration" });
  assert.equal(result.packet.cases[0]!.review.currentDeclaredApprovingReviewerCount, 0); assert.ok(gapCodes(result).includes("duplicate-reviewer-label"));
});

test("allowlisted packet omits operational receipts, private legacy fields and source URL query secrets", async () => {
  const configuration = syntheticConfiguration(), row = await syntheticCase();
  configuration.confirmations.providerPrivacyReceipt = "PRIVATE-PROVIDER-RECEIPT";
  configuration.pricing.baseline.approvedBy = "PRIVATE-PRICE-REVIEWER";
  row.source.reuseAssessment = "PRIVATE-REUSE-NOTES"; row.inputMappingReceipt = "PRIVATE-MAPPING-RECEIPT";
  row.source.url = "https://source.invalid/article?token=PRIVATE-URL-TOKEN#PRIVATE-FRAGMENT";
  const corpus = await syntheticCorpus([row]);
  (corpus.cases[0]!.legacyItem as unknown as Record<string, unknown>).privateNotes = "PRIVATE-LEGACY-NOTES";
  const result = await prepareWatchReviewPacket(corpus, configuration, { stage: "calibration" });
  assert.equal(result.packet.cases[0]!.source.url, "https://source.invalid/article");
  assert.equal(result.packet.cases[0]!.source.queryOrFragmentOmitted, true);
  assert.equal(result.packet.cases[0]!.source.exactUrlSha256, await evaluationHash(row.source.url));
  assert.ok(!JSON.stringify(result).includes("PRIVATE-"));
});

test("Markdown keeps hostile source and expected text inside collision-proof literal fences", async () => {
  const row = await syntheticCase();
  row.source.text = "`````\n<script>alert('source')</script>\n![remote](https://source.invalid/tracker)\n# Forged heading";
  row.expected.allowedClaims = ["```\n</code><img src=x onerror=alert(1)>\n```"];
  const result = await prepareWatchReviewPacket(await syntheticCorpus([row]), syntheticConfiguration(), { stage: "calibration" });
  const markdown = renderWatchReviewPacketMarkdown(result);
  assert.ok(markdown.includes(`\`\`\`\`\`\`\n${row.source.text}\n\`\`\`\`\`\``));
  let fence: string | null = null;
  for (const line of markdown.split("\n")) {
    if (!fence && /^`{3,}$/.test(line)) { fence = line; continue; }
    if (fence && line === fence) { fence = null; continue; }
    if (line.includes("<script>") || line.includes("<img") || line.startsWith("![remote]") || line === "# Forged heading") assert.ok(fence, line);
  }
  assert.equal(fence, null);
});

test("malformed schemas, unknown options and oversized input reject without echoing contents", async () => {
  const corpus = await syntheticCorpus([await syntheticCase()]), configuration = syntheticConfiguration();
  for (const [input, config, options] of [
    [{ ...corpus, secret: "PRIVATE-KEY" }, configuration, { stage: "calibration" }],
    [corpus, { ...configuration, apiKey: "PRIVATE-KEY" }, { stage: "calibration" }],
    [corpus, configuration, { stage: "all" }], [corpus, configuration, { stage: "calibration", approve: true }],
    [corpus, configuration, { stage: "calibration", expectedCorpusSha256: "invalid" }],
    ["x".repeat(REVIEW_PACKET_LIMITS.corpusBytes + 1), configuration, { stage: "calibration" }],
  ]) await assert.rejects(prepareWatchReviewPacket(input, config, options));
});

test("guarded stdout CLI is offline, bounded, deterministic and never rewrites the corpus", async () => {
  const directory = mkdtempSync(join(tmpdir(), "watch-review-packets-"));
  try {
    const corpus = await syntheticCorpus([await syntheticCase()]), configuration = syntheticConfiguration();
    const corpusPath = join(directory, "corpus.json"), configPath = join(directory, "configuration.json");
    const source = JSON.stringify(corpus), config = JSON.stringify(configuration);
    writeFileSync(corpusPath, source); writeFileSync(configPath, config);
    const run = (args: string[]) => spawnSync(process.execPath, ["--import", guard, "--import", "tsx/esm", script, ...args],
      { cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: REVIEW_PACKET_LIMITS.outputBytes + 1000 });
    const help = run([]); assert.equal(help.status, 0); assert.equal(JSON.parse(help.stdout).approvalsIssued, 0);
    const live = run(["--mode", "live", "--corpus", "/does-not-exist"]);
    assert.equal(live.status, 2); assert.equal(JSON.parse(live.stdout).code, "offline-packets-only");
    const args = ["--stage", "calibration", "--corpus", corpusPath, "--configuration", configPath];
    const result = run(args); assert.equal(result.status, 2, result.stderr);
    const json = JSON.parse(result.stdout); assert.equal(json.packet.approvalsIssued, 0);
    assert.equal(json.inputFiles.corpusFileSha256, await evidenceHash(source));
    assert.equal(json.inputFiles.configurationFileSha256, await evidenceHash(config));
    assert.equal(run(args).stdout, result.stdout); assert.equal(readFileSync(corpusPath, "utf8"), source);
    const markdown = run([...args, "--format", "markdown"]); assert.equal(markdown.status, 2); assert.ok(markdown.stdout.includes("DRAFT ONLY"));
    writeFileSync(corpusPath, "PRIVATE-MALFORMED-SOURCE");
    const malformed = run(args); assert.equal(malformed.status, 2); assert.ok(!malformed.stdout.includes("PRIVATE-MALFORMED-SOURCE"));
    assert.equal(JSON.parse(malformed.stdout).code, "invalid-offline-review-packet-input");
    writeFileSync(corpusPath, Buffer.from([0xff, 0xfe])); assert.equal(run(args).status, 2);
    writeFileSync(corpusPath, "x".repeat(REVIEW_PACKET_LIMITS.corpusBytes + 1)); assert.equal(run(args).status, 2);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
