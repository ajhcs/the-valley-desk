import { ContentItem } from "../../../src/content/schema.ts";
import {
  EVALUATION_MODELS, EvaluationCase, EvaluationConfiguration, EvaluationCorpus,
  caseHashes, evaluationDefaults, evaluationHash, splitHash,
} from "../../../src/ingest/watch-model-evaluation.ts";
import { evidenceHash } from "../../../src/ingest/policy-pdf.ts";

export const SYNTHETIC_TIME = "2026-09-12T12:00:00.000Z";
const syntheticPricing = {
  inputNanoUsdPerToken: 100, outputNanoUsdPerToken: 200, status: "synthetic" as const,
  evidenceUrl: null, checkedAt: null, approvedBy: null,
};

// These rates are arbitrary simulation inputs, not verified provider prices.
export function syntheticConfiguration() {
  return EvaluationConfiguration.parse({
    version: "watch-model-evaluation-config-1", phase: "model-only", models: EVALUATION_MODELS,
    editorPromptVersion: evaluationDefaults.editorPromptVersion,
    timeoutMs: evaluationDefaults.timeoutMs, maxInputTokens: 32_768, maxCalls: 2_000,
    maxSpendNanoUsd: 1_000_000_000_000,
    pricing: { baseline: syntheticPricing, candidate: syntheticPricing },
    confirmations: {
      accountAccessReceipt: null, contributorPublicDataReceipt: null,
      providerPrivacyReceipt: null, operationalAuthorizationReceipt: null,
    },
  });
}

export async function sealSyntheticCase(input: unknown) {
  const row = EvaluationCase.parse(input);
  if (row.fixtureType !== "synthetic") throw new Error("fixture-helper-cannot-attest-real-cases");
  row.source.sha256 = await evidenceHash(row.source.text);
  row.caseSha256 = (await caseHashes(row)).caseSha256;
  return row;
}

export async function syntheticCase(overrides: Partial<EvaluationCase> = {}) {
  const caseId = overrides.caseId ?? "synthetic-policy-amendment";
  const title = `Synthetic policy example ${caseId}`;
  const dek = "A synthetic policy example for offline evaluation mechanics.";
  const body = `Synthetic Hospital changed its test workflow for ${caseId}. The synthetic policy text preserves its existing exception.`;
  const source = { kind: "ingest", origin: "synthetic-model-evaluation", url: `https://source.invalid/${caseId}`, fetchedAt: SYNTHETIC_TIME };
  const desk = overrides.desk ?? "policy";
  const details = desk === "news" ? { kind: "news", relatedEventIds: [], relatedVoiceIds: [] }
    : desk === "events" ? { kind: "event", startsAt: "2026-10-10T12:00:00.000Z", timezone: "America/New_York", hostOrg: "Synthetic Event Host", partner: "chapter", registrationUrl: "https://registration.invalid/synthetic-event" }
      : desk === "technology" ? { kind: "ai", vendor: "Synthetic Vendor", product: "Synthetic Artifact", announcedAt: SYNTHETIC_TIME }
        : { kind: "policy", jurisdiction: "PA", issuer: "legislature", changeType: "legislation" };
  const item = ContentItem.parse({
    id: caseId, slug: caseId, ...details, title, dek, body, status: "review",
    updatedAt: SYNTHETIC_TIME, topics: ["policy"], orgs: [], authors: [], region: "PA",
    source,
  });
  return sealSyntheticCase({
    caseId, fixtureType: "synthetic", desk: "policy", policyJurisdiction: "PA", split: "calibration", critical: false,
    source: { id: `${caseId}-source`, url: source.url, text: [title, dek, body, item.kind === "event" ? item.hostOrg : ""].filter(Boolean).join("\n"), sha256: null, reuseAssessment: null, publicDataAssessment: null },
    legacyItem: item, inputMappingReceipt: null,
    expected: {
      disposition: "hold", identity: { itemId: caseId }, dates: [{ field: "updatedAt", precision: "instant", value: SYNTHETIC_TIME }],
      localEligibility: "unresolved", requiredEvidenceSpans: [body], allowedClaims: [body],
      prohibitedClaims: ["This synthetic policy applies to actual hospitals."], requiredHolds: ["unreviewed-synthetic-policy"],
      rubric: { relevance: "Acknowledge the synthetic-only source.", explanation: "Preserve the synthetic exception.", usefulness: "Never imply real policy advice." },
    },
    reviewerLabels: [], adjudication: { status: "pending", receiptId: null, adjudicatorId: null, adjudicatedAt: null, caseSha256: null },
    caseSha256: null,
    ...overrides,
  });
}

export async function syntheticCorpus(cases: EvaluationCase[], configuration = syntheticConfiguration()) {
  return EvaluationCorpus.parse({
    version: "watch-model-evaluation-corpus-1", corpusId: "synthetic-corpus-only",
    configurationSha256: await evaluationHash(configuration),
    splitFreeze: { sha256: await splitHash(cases), frozenAt: null, frozenBy: null }, cases,
  });
}

export function reply(stage: "classification" | "copy" | "verifier", content: unknown, usage: unknown = { prompt_tokens: 1_000, completion_tokens: 100 }) {
  return {
    outcome: "response" as const, stage, status: 200, elapsedMs: 25,
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }], usage }),
  };
}

export function passingReplies(row: EvaluationCase) {
  const first = row.legacyItem.body.split(". ")[0] + ".";
  return [
    reply("classification", {
      relevanceScore: 90, confidence: 0.95, decision: "priority_review", reasons: ["Synthetic direct evidence."],
      affectedOrgIds: [], productIds: [], changeType: "regulatory", materialityDimensions: ["workflow"], evidenceSpans: [first],
    }),
    reply("copy", {
      impactSentence: first, body: row.legacyItem.body, bodyEvidenceSpans: [first, "The synthetic policy text preserves its existing exception."],
      contextSentence: null, contextItemIds: [], contextEvidenceSpans: [], whyAttend: null, whoYoullMeet: [],
      whyAttendEvidenceSpans: [], whoYoullMeetEvidenceSpans: [],
    }),
    reply("verifier", { approved: true, objections: [] }),
  ];
}

export function heldReply() {
  return reply("classification", {
    relevanceScore: 0, confidence: 0, decision: "hold", reasons: [], affectedOrgIds: [], productIds: [],
    changeType: "other", materialityDimensions: [], evidenceSpans: [],
  });
}
