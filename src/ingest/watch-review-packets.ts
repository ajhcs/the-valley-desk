import { z } from "zod";
import { EvaluationConfiguration, EvaluationCorpus, caseHashes, evaluationHash, splitHash, validateEvaluationCorpus } from "./watch-model-evaluation";

export const REVIEW_PACKET_LIMITS = { corpusBytes: 8_000_000, configurationBytes: 64_000, outputBytes: 16_000_000 } as const;
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Options = z.object({ stage: z.enum(["calibration", "holdout"]), expectedCorpusSha256: Digest.optional(),
  expectedConfigurationSha256: Digest.optional(), expectedSplitSha256: Digest.optional() }).strict();
type Gap = { severity: "integrity" | "qualification"; code: string; caseId?: string; detail?: string };
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
function bound(value: unknown, limit: number) {
  const serialized = JSON.stringify(value);
  if (!serialized || bytes(serialized) > limit) throw new Error("review-packet-size-invalid");
}
const digestState = (declared: string | null, computed: string) => ({ declared, computed,
  status: declared === null ? "missing" as const : declared === computed ? "current" as const : "drifted" as const });
const declaration = (value: string | null) => ({ present: Boolean(value), authenticatedByThisTool: false });
function publicSourceReference(source: string) {
  const url = new URL(source);
  return { url: `${url.origin}${url.pathname}`, queryOrFragmentOmitted: Boolean(url.search || url.hash) };
}

/** Offline draft authoring only. This function neither reseals inputs nor issues
 * approvals, freeze attestations, source rights, operational grants or model calls. */
export async function prepareWatchReviewPacket(rawCorpus: unknown, rawConfiguration: unknown, rawOptions: unknown) {
  bound(rawCorpus, REVIEW_PACKET_LIMITS.corpusBytes); bound(rawConfiguration, REVIEW_PACKET_LIMITS.configurationBytes);
  const options = Options.parse(rawOptions);
  const corpus = EvaluationCorpus.parse(rawCorpus), configuration = EvaluationConfiguration.parse(rawConfiguration);
  const readiness = await validateEvaluationCorpus(corpus, configuration, options.stage);
  const corpusSha256 = await evaluationHash(corpus), configurationSha256 = await evaluationHash(configuration);
  const splitSha256 = await splitHash(corpus.cases);
  const gaps: Gap[] = [
    ...readiness.issues.map(issue => ({ severity: "integrity" as const, ...issue })),
    ...readiness.holds.map(hold => ({ severity: "qualification" as const, ...hold })),
  ];
  for (const [name, expected, actual] of [
    ["corpus", options.expectedCorpusSha256, corpusSha256],
    ["configuration", options.expectedConfigurationSha256, configurationSha256],
    ["split", options.expectedSplitSha256, splitSha256],
  ] as const) if (expected && expected !== actual) gaps.push({ severity: "integrity", code: `pinned-${name}-hash-drift` });
  const inventory = [];
  const cases = [];
  for (const row of corpus.cases) {
    const hashes = await caseHashes(row);
    inventory.push({ caseId: row.caseId, desk: row.desk, policyJurisdiction: row.policyJurisdiction, split: row.split,
      critical: row.critical, fixtureType: row.fixtureType, caseSha256: hashes.caseSha256 });
    if (!row.source.sha256) gaps.push({ severity: "integrity", code: "source-digest-missing", caseId: row.caseId });
    if (!row.caseSha256) gaps.push({ severity: "integrity", code: "case-digest-missing", caseId: row.caseId });
    if (row.split !== options.stage) continue;
    const reviewerCounts = new Map<string, number>();
    for (const label of row.reviewerLabels) reviewerCounts.set(label.reviewerId, (reviewerCounts.get(label.reviewerId) ?? 0) + 1);
    const reviewers = row.reviewerLabels.map((label, index) => ({ slot: index + 1, declaredDecision: label.decision,
      reviewedAt: label.reviewedAt, duplicateReviewer: reviewerCounts.get(label.reviewerId)! > 1,
      hashBinding: label.caseSha256 === hashes.caseSha256 && label.expectedSha256 === hashes.expectedSha256 ? "current" : "stale",
      reviewerIdSha256: null as string | null, authenticatedByThisTool: false }));
    for (let index = 0; index < reviewers.length; index++) reviewers[index]!.reviewerIdSha256 = await evaluationHash(row.reviewerLabels[index]!.reviewerId);
    const currentApprovingReviewers = new Set(row.reviewerLabels.filter(label => label.decision === "approved" &&
      label.caseSha256 === hashes.caseSha256 && label.expectedSha256 === hashes.expectedSha256 && reviewerCounts.get(label.reviewerId) === 1).map(label => label.reviewerId)).size;
    const disputed = row.reviewerLabels.some(label => label.decision === "disputed");
    const stale = reviewers.some(label => label.hashBinding === "stale" || label.duplicateReviewer);
    const requiredReviewerCount = row.critical ? 2 : 1;
    const reviewStatus = disputed ? "disputed" : stale ? "stale-or-duplicate" : currentApprovingReviewers < requiredReviewerCount ? "missing-reviewers" : "declared-labels-present";
    const adjudication = row.adjudication;
    const adjudicationFieldsPresent = Boolean(adjudication.receiptId && adjudication.adjudicatorId && adjudication.adjudicatedAt);
    cases.push({ caseId: row.caseId, fixtureType: row.fixtureType, draft: true, desk: row.desk, policyJurisdiction: row.policyJurisdiction,
      split: row.split, critical: row.critical,
      hashes: { source: digestState(row.source.sha256, hashes.sourceSha256), case: digestState(row.caseSha256, hashes.caseSha256),
        expectedSha256: hashes.expectedSha256, legacyInputSha256: await evaluationHash(row.legacyItem) },
      source: { id: row.source.id, ...publicSourceReference(row.source.url), exactUrlSha256: await evaluationHash(row.source.url), text: row.source.text,
        reuseAssessment: declaration(row.source.reuseAssessment), publicDataAssessment: declaration(row.source.publicDataAssessment) },
      mapping: { legacyKind: row.legacyItem.kind, receipt: declaration(row.inputMappingReceipt) },
      expected: row.expected,
      literalEvidence: row.expected.requiredEvidenceSpans.map(text => ({ text, firstUtf16Offset: row.source.text.indexOf(text), literal: row.source.text.includes(text) })),
      review: { status: reviewStatus, requiredReviewerCount, currentDeclaredApprovingReviewerCount: currentApprovingReviewers,
        missingReviewerCount: Math.max(0, requiredReviewerCount - currentApprovingReviewers), labels: reviewers,
        adjudication: { declaredStatus: adjudication.status, fieldsPresent: adjudicationFieldsPresent,
          hashBinding: adjudication.caseSha256 === null ? "missing" : adjudication.caseSha256 === hashes.caseSha256 ? "current" : "stale",
          adjudicatedAt: adjudication.adjudicatedAt, authenticatedByThisTool: false } },
    });
  }
  inventory.sort((a, b) => a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0);
  const frozenInventory = Object.freeze(inventory.map(entry => Object.freeze(entry)));
  const inventorySha256 = await evaluationHash(inventory);
  const gapReport = { version: "watch-review-gaps-1", stage: options.stage, corpusSha256, configurationSha256, inventorySha256,
    status: "draft-review-only", qualificationGranted: false, liveExecutionEnabled: false, publicationEnabled: false,
    counts: { totalCases: corpus.cases.length, selectedCases: cases.length, desks: readiness.counts,
      policyJurisdictions: readiness.policyCounts, splits: readiness.splitCounts, integrityGaps: gaps.filter(gap => gap.severity === "integrity").length,
      qualificationGaps: gaps.filter(gap => gap.severity === "qualification").length }, gaps };
  const packet = { version: "watch-review-packet-1", status: "draft-not-an-approval", stage: options.stage, corpusId: corpus.corpusId,
    networkRequests: 0, credentialSource: "none", approvalsIssued: 0, qualificationGranted: false, liveExecutionEnabled: false, publicationEnabled: false,
    corpusSha256, configuration: { hash: digestState(corpus.configurationSha256, configurationSha256), models: configuration.models,
      phase: configuration.phase, editorPromptVersion: configuration.editorPromptVersion,
      confirmations: Object.fromEntries(Object.entries(configuration.confirmations).map(([key, value]) => [key, declaration(value)])),
      pricing: { baseline: { declaredStatus: configuration.pricing.baseline.status }, candidate: { declaredStatus: configuration.pricing.candidate.status } } },
    inventory: Object.freeze({ status: "immutable-content-snapshot-not-a-freeze-attestation", sha256: inventorySha256, entries: frozenInventory }),
    split: { hash: digestState(corpus.splitFreeze.sha256, splitSha256), attestationFieldsPresent: Boolean(corpus.splitFreeze.frozenBy && corpus.splitFreeze.frozenAt),
      frozenAt: corpus.splitFreeze.frozenAt, authenticatedByThisTool: false },
    gapReportSha256: await evaluationHash(gapReport), cases };
  const result = { packetSha256: await evaluationHash(packet), packet, gapReport };
  bound(result, REVIEW_PACKET_LIMITS.outputBytes);
  return result;
}
export type WatchReviewPacket = Awaited<ReturnType<typeof prepareWatchReviewPacket>>;

function literalBlock(text: string) {
  let longest = 2;
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const fence = "`".repeat(longest + 1);
  return `${fence}\n${text}\n${fence}`;
}
export function renderWatchReviewPacketMarkdown(result: WatchReviewPacket) {
  const { cases, ...metadata } = result.packet;
  const sections = ["# Watch Evaluation Review Packet", "DRAFT ONLY. No approval, rights determination, freeze attestation, model call or publication is issued.",
    "## Packet And Inventory", literalBlock(JSON.stringify({ packetSha256: result.packetSha256, ...metadata }, null, 2)),
    "## Machine-Readable Gaps", literalBlock(JSON.stringify(result.gapReport, null, 2))];
  for (const row of cases) {
    const { source, expected, literalEvidence, ...metadata } = row;
    sections.push(`## Case ${row.caseId}`, literalBlock(JSON.stringify({ ...metadata, source: { ...source, text: undefined } }, null, 2)),
      "### Source Representation", literalBlock(source.text), "### Expected Claims And Evidence", literalBlock(JSON.stringify({ expected, literalEvidence }, null, 2)));
  }
  const markdown = `${sections.join("\n\n")}\n`;
  if (bytes(markdown) > REVIEW_PACKET_LIMITS.outputBytes) throw new Error("review-packet-size-invalid");
  return markdown;
}
