import { legacyUtcDatetime, legacyUrl } from "../lib/schema-compat";
import { z } from "zod";
import { ContentItem } from "../content/schema";
import { evidenceHash } from "./policy-pdf";
import {
  DEFAULT_EDITOR_TIMEOUT_MS, EDITOR_CLASSIFICATION_MAX_TOKENS, EDITOR_COPY_MAX_TOKENS,
  EDITOR_PROMPT_VERSION, EDITOR_REASONING_EFFORT, EditorModelError, enrichWithEditorModel,
} from "./editor-model";
import { evaluateCandidate, verificationInputForCandidate } from "./editor";
import { isHighRiskNews, verifyWithSecondModel } from "./verification";
import { diagnosticUsage } from "./model-response-diagnostics";

export const EVALUATION_MODELS = {
  baseline: "meta/muse-spark-1.2-contributor",
  candidate: "meta/muse-spark-1.3-contributor",
} as const;
export const REQUIRED_DESK_COUNTS = { news: 20, events: 10, policy: 35, technology: 25, "cross-cutting": 10 } as const;
export const POLICY_GROUPS = ["federal", "PA", "NJ", "DE", "local"] as const;
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/);
const Label = z.string().trim().min(1).max(500);
const Stamp = legacyUtcDatetime();
const NullableLabel = Label.nullable();
const SourceUrl = legacyUrl().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
});
const Strings = z.array(Label).max(40);
const Stage = z.enum(["calibration", "holdout"]);
const Pricing = z.object({
  inputNanoUsdPerToken: z.number().int().min(0).max(1_000_000),
  outputNanoUsdPerToken: z.number().int().min(0).max(1_000_000),
  status: z.enum(["synthetic", "pending", "approved"]),
  evidenceUrl: SourceUrl.nullable(),
  checkedAt: Stamp.nullable(),
  approvedBy: NullableLabel,
}).strict();

export const EvaluationConfiguration = z.object({
  version: z.literal("watch-model-evaluation-config-1"),
  phase: z.literal("model-only"),
  models: z.object({
    baseline: z.literal(EVALUATION_MODELS.baseline), candidate: z.literal(EVALUATION_MODELS.candidate),
  }).strict(),
  editorPromptVersion: z.literal(EDITOR_PROMPT_VERSION),
  timeoutMs: z.number().int().min(1_000).max(120_000),
  maxInputTokens: z.number().int().min(1_024).max(200_000),
  maxCalls: z.number().int().min(0).max(2_000),
  maxSpendNanoUsd: z.number().int().min(0).max(1_000_000_000_000),
  pricing: z.object({ baseline: Pricing, candidate: Pricing }).strict(),
  confirmations: z.object({
    accountAccessReceipt: NullableLabel,
    contributorPublicDataReceipt: NullableLabel,
    providerPrivacyReceipt: NullableLabel,
    operationalAuthorizationReceipt: NullableLabel,
  }).strict(),
}).strict();
export type EvaluationConfiguration = z.infer<typeof EvaluationConfiguration>;

const Expected = z.object({
  disposition: z.enum(["review", "hold", "drop"]),
  identity: z.record(z.string(), Label).refine((value) => Object.keys(value).length <= 12),
  dates: z.array(z.discriminatedUnion("precision", [
    z.object({ field: Label, precision: z.literal("instant"), value: Stamp }).strict(),
    z.object({ field: Label, precision: z.literal("day"), value: z.string().date() }).strict(),
    z.object({ field: Label, precision: z.literal("unknown"), value: z.null() }).strict(),
  ])).max(12),
  localEligibility: z.enum(["eligible", "ineligible", "unresolved"]),
  requiredEvidenceSpans: Strings,
  allowedClaims: Strings,
  prohibitedClaims: Strings,
  requiredHolds: Strings,
  rubric: z.object({ relevance: Label, explanation: Label, usefulness: Label }).strict(),
}).strict();

export const EvaluationCase = z.object({
  caseId: Id,
  fixtureType: z.enum(["synthetic", "public-source"]),
  desk: z.enum(["news", "events", "policy", "technology", "cross-cutting"]),
  policyJurisdiction: z.enum(POLICY_GROUPS).nullable(),
  split: Stage,
  critical: z.boolean(),
  source: z.object({
    id: Id, url: SourceUrl, text: z.string().min(1).max(24_000), sha256: Digest.nullable(),
    reuseAssessment: NullableLabel, publicDataAssessment: NullableLabel,
  }).strict(),
  // Phase one deliberately exercises the unchanged legacy editor task. Watch
  // artifacts need an editor-reviewed input mapping, not an implicit kind cast.
  legacyItem: ContentItem,
  inputMappingReceipt: NullableLabel,
  expected: Expected,
  reviewerLabels: z.array(z.object({
    reviewerId: Id, decision: z.enum(["approved", "disputed"]), reviewedAt: Stamp,
    caseSha256: Digest, expectedSha256: Digest,
  }).strict()).max(10),
  adjudication: z.object({
    status: z.enum(["pending", "approved"]), receiptId: NullableLabel,
    adjudicatorId: Id.nullable(), adjudicatedAt: Stamp.nullable(), caseSha256: Digest.nullable(),
  }).strict(),
  caseSha256: Digest.nullable(),
}).strict();
export type EvaluationCase = z.infer<typeof EvaluationCase>;

export const EvaluationCorpus = z.object({
  version: z.literal("watch-model-evaluation-corpus-1"), corpusId: Id,
  configurationSha256: Digest.nullable(),
  splitFreeze: z.object({ sha256: Digest.nullable(), frozenAt: Stamp.nullable(), frozenBy: Id.nullable() }).strict(),
  cases: z.array(EvaluationCase).max(200),
}).strict();
export type EvaluationCorpus = z.infer<typeof EvaluationCorpus>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("non-json-number");
  const text = JSON.stringify(value);
  if (text === undefined) throw new Error("non-json-value");
  return text;
}
export const evaluationHash = (value: unknown) => evidenceHash(canonicalJson(value));

export async function caseHashes(input: unknown) {
  const row = EvaluationCase.parse(input);
  const { caseSha256: _hash, reviewerLabels: _labels, adjudication: _adjudication, ...material } = row;
  return {
    sourceSha256: await evidenceHash(row.source.text),
    expectedSha256: await evaluationHash(row.expected),
    caseSha256: await evaluationHash(material),
  };
}

export const splitHash = (cases: EvaluationCase[]) => evaluationHash(cases.map(({ caseId, split, critical }) => ({ caseId, split, critical }))
  .sort((a, b) => a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0));

type EvaluationIssue = { code: string; caseId?: string; detail?: string };
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
function sourceText(item: z.infer<typeof ContentItem>) {
  return [item.title, item.dek, item.body, item.kind === "event" ? item.hostOrg : ""].filter(Boolean).join("\n");
}

export async function validateEvaluationCorpus(raw: unknown, rawConfig: unknown, stage: "calibration" | "holdout") {
  Stage.parse(stage);
  const configuration = EvaluationConfiguration.parse(rawConfig);
  const corpus = EvaluationCorpus.parse(raw);
  const configurationSha256 = await evaluationHash(configuration);
  const issues: EvaluationIssue[] = [];
  const holds: EvaluationIssue[] = [];
  const ids = new Set<string>();
  const scenarios = new Set<string>();
  const counts: Record<string, number> = {};
  const policyCounts: Record<string, number> = {};
  const splitCounts = { calibration: 0, holdout: 0 };
  const deskSplits = new Set<string>();
  const policySplits = new Set<string>();
  for (const row of corpus.cases) {
    const issue = (code: string) => issues.push({ code, caseId: row.caseId });
    const hold = (code: string) => holds.push({ code, caseId: row.caseId });
    if (ids.has(row.caseId)) issue("duplicate-case-id");
    ids.add(row.caseId);
    counts[row.desk] = (counts[row.desk] ?? 0) + 1;
    splitCounts[row.split] += 1;
    deskSplits.add(`${row.desk}:${row.split}`);
    if (row.desk === "policy") {
      if (!row.policyJurisdiction) issue("policy-jurisdiction-required");
      else {
        policyCounts[row.policyJurisdiction] = (policyCounts[row.policyJurisdiction] ?? 0) + 1;
        policySplits.add(`${row.policyJurisdiction}:${row.split}`);
      }
    } else if (row.policyJurisdiction !== null) issue("non-policy-jurisdiction");
    const hashes = await caseHashes(row);
    if (hashes.sourceSha256 !== row.source.sha256) issue("source-hash-mismatch");
    if (hashes.caseSha256 !== row.caseSha256) issue("case-hash-mismatch");
    const scenario = await evaluationHash([row.desk, row.policyJurisdiction, hashes.sourceSha256, hashes.expectedSha256]);
    if (scenarios.has(scenario)) issue("duplicate-scenario");
    scenarios.add(scenario);
    if (sourceText(row.legacyItem) !== row.source.text || row.legacyItem.source.url !== row.source.url) issue("source-input-mismatch");
    const expectedKinds = { news: ["news"], events: ["event"], policy: ["policy"], technology: ["news", "ai"], "cross-cutting": ["news", "event", "policy", "ai", "voice"] };
    if (!expectedKinds[row.desk].includes(row.legacyItem.kind)) issue("desk-input-kind-mismatch");
    if (row.legacyItem.body.length > 6_000) issue("input-would-be-truncated");
    if (row.legacyItem.status !== "review" || row.legacyItem.featured) issue("input-must-remain-review");
    for (const span of row.expected.requiredEvidenceSpans) {
      if (!row.source.text.includes(span)) issue("required-span-not-literal");
    }
    if (!row.expected.allowedClaims.length && !row.expected.requiredHolds.length) issue("missing-case-assertion");
    if (row.fixtureType === "synthetic") hold("synthetic-is-not-real-evaluation-evidence");
    if (new URL(row.source.url).hostname.endsWith(".invalid")) hold("reserved-fixture-source");
    if (!row.source.reuseAssessment || !row.source.publicDataAssessment) hold("source-assessment-missing");
    if (!row.inputMappingReceipt) hold("input-mapping-unreviewed");
    const reviewers = new Set<string>();
    for (const label of row.reviewerLabels) {
      if (reviewers.has(label.reviewerId)) issue("duplicate-reviewer-label");
      reviewers.add(label.reviewerId);
      if (label.caseSha256 !== hashes.caseSha256 || label.expectedSha256 !== hashes.expectedSha256) issue("stale-reviewer-label");
      if (label.decision === "disputed") hold("unresolved-label-disagreement");
    }
    const approved = row.reviewerLabels.filter((label) => label.decision === "approved");
    if (approved.length < (row.critical ? 2 : 1)) hold("editor-labels-incomplete");
    const adjudication = row.adjudication;
    if (adjudication.status !== "approved" || !adjudication.receiptId || !adjudication.adjudicatorId || !adjudication.adjudicatedAt) hold("adjudication-pending");
    else if (adjudication.caseSha256 !== hashes.caseSha256) issue("stale-adjudication");
  }
  if (corpus.cases.length !== 100) issues.push({ code: "case-count", detail: `${corpus.cases.length}/100` });
  for (const [desk, expected] of Object.entries(REQUIRED_DESK_COUNTS)) {
    if (counts[desk] !== expected) issues.push({ code: "desk-allocation", detail: `${desk}:${counts[desk] ?? 0}/${expected}` });
    if (!deskSplits.has(`${desk}:calibration`) || !deskSplits.has(`${desk}:holdout`)) issues.push({ code: "split-desk-coverage", detail: desk });
  }
  for (const group of POLICY_GROUPS) {
    if (policyCounts[group] !== 7) issues.push({ code: "policy-allocation", detail: `${group}:${policyCounts[group] ?? 0}/7` });
    if (!policySplits.has(`${group}:calibration`) || !policySplits.has(`${group}:holdout`)) issues.push({ code: "split-policy-coverage", detail: group });
  }
  if (!corpus.cases.some((row) => row.critical)) holds.push({ code: "critical-subset-missing" });
  if (splitCounts.calibration !== 20 || splitCounts.holdout !== 80) issues.push({ code: "split-allocation" });
  if (corpus.configurationSha256 !== configurationSha256) issues.push({ code: "configuration-hash-mismatch" });
  const frozenSplitSha256 = await splitHash(corpus.cases);
  if (corpus.splitFreeze.sha256 !== frozenSplitSha256) issues.push({ code: "split-hash-mismatch" });
  if (!corpus.splitFreeze.frozenAt || !corpus.splitFreeze.frozenBy) holds.push({ code: "split-not-attested" });
  for (const [name, receipt] of Object.entries(configuration.confirmations)) {
    if (!receipt) holds.push({ code: "confirmation-missing", detail: name });
  }
  for (const [model, pricing] of Object.entries(configuration.pricing)) {
    if (pricing.status !== "approved" || !pricing.checkedAt || !pricing.evidenceUrl || !pricing.approvedBy) holds.push({ code: "pricing-unqualified", detail: model });
  }
  const selected = corpus.cases.filter((row) => row.split === stage);
  const attemptsPerModel = selected.reduce((sum, row) => sum + (row.critical ? 3 : 1), 0);
  const maximumCalls = attemptsPerModel * 2 * 3;
  const maximumSpendNanoUsd = Object.values(configuration.pricing).reduce((sum, pricing) => sum + attemptsPerModel * (
    configuration.maxInputTokens * pricing.inputNanoUsdPerToken * 3
    + (EDITOR_CLASSIFICATION_MAX_TOKENS + EDITOR_COPY_MAX_TOKENS + 2_048) * pricing.outputNanoUsdPerToken
  ), 0);
  if (maximumCalls > configuration.maxCalls) holds.push({ code: "insufficient-call-cap" });
  if (maximumSpendNanoUsd > configuration.maxSpendNanoUsd) holds.push({ code: "insufficient-spend-cap" });
  return {
    version: "watch-model-evaluation-readiness-1", mode: "offline-validation", stage,
    corpusSha256: await evaluationHash(corpus), configurationSha256, splitSha256: frozenSplitSha256,
    distinctCases: corpus.cases.length, counts, policyCounts, splitCounts,
    selectedCases: selected.length, attemptsPerModel, maximumCalls, maximumSpendNanoUsd,
    integrityValid: issues.length === 0, qualificationRequirementsMet: issues.length === 0 && holds.length === 0,
    liveExecutionEnabled: false, publicationEnabled: false, issues, holds,
  };
}

export const RecordedReply = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("response"), stage: z.enum(["classification", "copy", "verifier"]),
    status: z.number().int().min(200).max(599), body: z.string().max(262_144), elapsedMs: z.number().int().min(0).max(120_000) }).strict(),
  z.object({ outcome: z.enum(["timeout", "transport-error"]), stage: z.enum(["classification", "copy", "verifier"]),
    elapsedMs: z.number().int().min(0).max(120_000) }).strict(),
]);
type RecordedReply = z.infer<typeof RecordedReply>;
type ModelRole = keyof typeof EVALUATION_MODELS;
type RequestStage = RecordedReply["stage"];
const Usage = z.object({ promptTokens: z.number().int().min(0).max(10_000_000), completionTokens: z.number().int().min(0).max(10_000_000) }).strict();
const LedgerEntry = z.object({
  requestId: Id, reservedNanoUsd: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  state: z.enum(["reserved", "unresolved", "reconciled"]), actualNanoUsd: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
}).strict();
type LedgerEntry = z.infer<typeof LedgerEntry>;
export const SpendSnapshot = z.object({ version: z.literal("watch-evaluation-spend-1"), entries: z.array(LedgerEntry).max(2_000) }).strict();

// Replay accounting only. A future live runner must durably acknowledge reserve
// events before dispatch. Loading this snapshot never erases unresolved spend.
export class ReplaySpendLedger {
  private entries: LedgerEntry[];
  constructor(private capNanoUsd: number, private maxCalls: number, snapshot: unknown = { version: "watch-evaluation-spend-1", entries: [] }) {
    z.number().int().min(0).max(1_000_000_000_000).parse(capNanoUsd);
    z.number().int().min(0).max(2_000).parse(maxCalls);
    this.entries = SpendSnapshot.parse(snapshot).entries;
    if (new Set(this.entries.map((row) => row.requestId)).size !== this.entries.length) throw new Error("duplicate-spend-request");
    if (this.entries.some((row) => (row.state === "reconciled") !== (row.actualNanoUsd !== null))) throw new Error("inconsistent-spend-state");
    if (!Number.isSafeInteger(this.committedNanoUsd)) throw new Error("spend-overflow");
  }
  get committedNanoUsd() { return this.entries.reduce((sum, row) => sum + (row.actualNanoUsd ?? row.reservedNanoUsd), 0); }
  matchesLimits(capNanoUsd: number, maxCalls: number) { return capNanoUsd === this.capNanoUsd && maxCalls === this.maxCalls; }
  reserve(requestId: string, reservedNanoUsd: number) {
    const entry = LedgerEntry.parse({ requestId, reservedNanoUsd, state: "reserved", actualNanoUsd: null });
    if (this.entries.some((row) => row.requestId === requestId)) throw new Error("duplicate-spend-request");
    if (this.entries.length >= this.maxCalls) throw new Error("call-cap-exhausted");
    if (this.committedNanoUsd + reservedNanoUsd > this.capNanoUsd) throw new Error("spend-cap-exhausted");
    this.entries.push(entry);
  }
  unresolved(requestId: string) {
    const row = this.entries.find((entry) => entry.requestId === requestId);
    if (!row || row.state === "reconciled") throw new Error("spend-state-conflict");
    row.state = "unresolved";
  }
  reconcile(requestId: string, actualNanoUsd: number) {
    z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(actualNanoUsd);
    const row = this.entries.find((entry) => entry.requestId === requestId);
    if (!row || row.state === "reconciled") throw new Error("spend-state-conflict");
    if (!Number.isSafeInteger(this.committedNanoUsd - row.reservedNanoUsd + actualNanoUsd)) throw new Error("spend-overflow");
    row.actualNanoUsd = actualNanoUsd;
    row.state = "reconciled";
  }
  snapshot() { return structuredClone({ version: "watch-evaluation-spend-1" as const, entries: this.entries }); }
}

function requestStage(body: Record<string, unknown>): RequestStage {
  const format = body.response_format as { type?: string; json_schema?: { name?: string } } | undefined;
  if (format?.json_schema?.name === "valley_desk_editor_classification") return "classification";
  if (format?.json_schema?.name === "valley_desk_editor_copy") return "copy";
  if (format?.type === "json_object" && body.max_tokens === 2_048) return "verifier";
  throw new Error("unrecognized-request-stage");
}

export type ReplayRequestReceipt = {
  requestId: string; caseId: string; caseSha256: string; configurationSha256: string;
  model: string; role: ModelRole; repetition: number; stage: RequestStage;
  promptVersion: string; promptSha256: string; schemaSha256: string; inputSha256: string;
  requestSha256: string; requestConfigurationSha256: string; responseSha256: string | null;
  startedAt: string; endedAt: string; scriptedLatencyMs: number; timeoutMs: number;
  maxOutputTokens: number; inputByteUpperBound: number; reservedNanoUsd: number; actualNanoUsd: number | null;
  transportOutcome: string; httpStatus: number | null; usage: z.infer<typeof Usage> | null;
};

export async function replayEvaluationPair(
  rawCase: unknown, rawConfiguration: unknown,
  rawRecordings: { baseline: unknown[]; candidate: unknown[] }, stage: "calibration" | "holdout",
  ledger?: ReplaySpendLedger,
) {
  Stage.parse(stage);
  const row = EvaluationCase.parse(rawCase);
  const configuration = EvaluationConfiguration.parse(rawConfiguration);
  if (row.fixtureType !== "synthetic") throw new Error("replay-requires-explicit-synthetic-case");
  if (row.split !== stage) throw new Error("wrong-evaluation-stage");
  const hashes = await caseHashes(row);
  if (hashes.sourceSha256 !== row.source.sha256 || hashes.caseSha256 !== row.caseSha256) throw new Error("unsealed-replay-case");
  if (sourceText(row.legacyItem) !== row.source.text || row.legacyItem.source.url !== row.source.url || row.legacyItem.body.length > 6_000) throw new Error("source-input-mismatch");
  if (row.legacyItem.status !== "review" || row.legacyItem.featured) throw new Error("input-must-remain-review");
  const configurationSha256 = await evaluationHash(configuration);
  const spending = ledger ?? new ReplaySpendLedger(configuration.maxSpendNanoUsd, configuration.maxCalls);
  if (!spending.matchesLimits(configuration.maxSpendNanoUsd, configuration.maxCalls)) throw new Error("ledger-configuration-mismatch");
  const requests: ReplayRequestReceipt[] = [];
  const replayIssues: Array<{ role: ModelRole; code: string; count?: number }> = [];
  const results: Array<{ role: ModelRole; model: string; repetition: number; enrichment: string;
    verifierApproved: boolean | null; legacyDisposition: { action: string; rule: string } | null }> = [];
  const repetitions = row.critical ? 3 : 1;
  for (const role of ["baseline", "candidate"] as const) {
    const recordings = z.array(RecordedReply).max(9).parse(rawRecordings[role]);
    let nextReply = 0;
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const replayFetch: typeof fetch = async (input, init) => {
        if (String(input) !== "https://openrouter.ai/api/v1/chat/completions" || init?.method !== "POST" || typeof init.body !== "string") throw new Error("unexpected-wrapper-request");
        const body = JSON.parse(init.body) as Record<string, unknown>;
        if (body.model !== EVALUATION_MODELS[role]) throw new Error("model-drift");
        const requestKind = requestStage(body);
        const maxOutputTokens = requestKind === "classification" ? EDITOR_CLASSIFICATION_MAX_TOKENS : requestKind === "copy" ? EDITOR_COPY_MAX_TOKENS : 2_048;
        if (body.max_tokens !== maxOutputTokens || body.temperature !== (requestKind === "verifier" ? 0 : 0.1)) throw new Error("request-configuration-drift");
        const reasoning = body.reasoning as { effort?: string; exclude?: boolean };
        if (reasoning.effort !== (requestKind === "verifier" ? "low" : EDITOR_REASONING_EFFORT) || reasoning.exclude !== true) throw new Error("request-reasoning-drift");
        const recording = recordings[nextReply];
        if (!recording || recording.stage !== requestKind) throw new Error("recording-stage-mismatch");
        const inputByteUpperBound = byteLength(init.body) + 512;
        if (inputByteUpperBound > configuration.maxInputTokens) {
          replayIssues.push({ role, code: "input-bound-exceeded" });
          throw new Error("input-bound-exceeded");
        }
        const pricing = configuration.pricing[role];
        const reservedNanoUsd = configuration.maxInputTokens * pricing.inputNanoUsdPerToken + maxOutputTokens * pricing.outputNanoUsdPerToken;
        const requestId = `eval-${hashes.caseSha256.slice(0, 32)}:${role}:${repetition}:${requestKind}`;
        try { spending.reserve(requestId, reservedNanoUsd); }
        catch (error) {
          replayIssues.push({ role, code: error instanceof Error ? error.message : "reservation-failed" });
          throw error;
        }
        nextReply += 1;
        const messages = body.messages as Array<{ role: string; content: string }>;
        const startedAt = new Date().toISOString();
        const receipt: ReplayRequestReceipt = {
          requestId, caseId: row.caseId, caseSha256: hashes.caseSha256, configurationSha256,
          model: EVALUATION_MODELS[role], role, repetition, stage: requestKind,
          promptVersion: requestKind === "verifier" ? "unversioned-existing-verifier" : EDITOR_PROMPT_VERSION,
          promptSha256: await evaluationHash(messages.filter((message) => message.role === "system")),
          schemaSha256: await evaluationHash(body.response_format), inputSha256: await evaluationHash(messages.filter((message) => message.role !== "system")),
          requestSha256: await evidenceHash(init.body),
          requestConfigurationSha256: await evaluationHash({ model: body.model, temperature: body.temperature, max_tokens: body.max_tokens, reasoning: body.reasoning, response_format: body.response_format }),
          responseSha256: null, startedAt, endedAt: startedAt, scriptedLatencyMs: recording.elapsedMs,
          timeoutMs: configuration.timeoutMs, maxOutputTokens, inputByteUpperBound, reservedNanoUsd,
          actualNanoUsd: null, transportOutcome: recording.outcome, httpStatus: null, usage: null,
        };
        requests.push(receipt);
        if (recording.outcome !== "response") {
          spending.unresolved(requestId);
          receipt.endedAt = new Date().toISOString();
          throw new DOMException("Synthetic recorded transport failure", recording.outcome === "timeout" ? "TimeoutError" : "NetworkError");
        }
        receipt.responseSha256 = await evidenceHash(recording.body);
        receipt.httpStatus = recording.status;
        receipt.transportOutcome = recording.status < 400 ? "response" : "http-error";
        let usage: unknown;
        try { usage = diagnosticUsage((JSON.parse(recording.body) as { usage?: unknown }).usage); } catch { /* Preserve the full reservation when usage is unreadable. */ }
        const parsedUsage = Usage.safeParse(usage && typeof usage === "object" ? {
          promptTokens: (usage as { promptTokens?: unknown }).promptTokens,
          completionTokens: (usage as { completionTokens?: unknown }).completionTokens,
        } : usage);
        if (parsedUsage.success) {
          receipt.usage = parsedUsage.data;
          receipt.actualNanoUsd = parsedUsage.data.promptTokens * pricing.inputNanoUsdPerToken + parsedUsage.data.completionTokens * pricing.outputNanoUsdPerToken;
          spending.reconcile(requestId, receipt.actualNanoUsd);
          if (parsedUsage.data.promptTokens > configuration.maxInputTokens || parsedUsage.data.completionTokens > maxOutputTokens) {
            replayIssues.push({ role, code: "reported-usage-exceeds-reservation-bound" });
          }
        } else spending.unresolved(requestId);
        receipt.endedAt = new Date().toISOString();
        return new Response(recording.body, { status: recording.status, headers: { "content-type": "application/json" } });
      };
      let enrichmentOutcome = "not-started";
      let verifierApproved: boolean | null = null;
      let legacyDisposition: { action: string; rule: string } | null = null;
      try {
        const modelConfiguration = { apiKey: "synthetic-offline-replay-only", model: EVALUATION_MODELS[role], timeoutMs: configuration.timeoutMs };
        const enrichment = await enrichWithEditorModel(row.legacyItem, [], modelConfiguration, replayFetch);
        enrichmentOutcome = enrichment ? "schema-and-evidence-valid" : "not-configured";
        if (enrichment) {
          const verificationInput = verificationInputForCandidate(row.legacyItem, enrichment);
          const verification = isHighRiskNews(verificationInput)
            ? await verifyWithSecondModel(verificationInput, modelConfiguration, replayFetch) : null;
          verifierApproved = verification?.approved ?? null;
          const verdict = evaluateCandidate(row.legacyItem, enrichment, new Date(row.legacyItem.updatedAt), verification);
          legacyDisposition = { action: verdict.action, rule: verdict.rule };
        }
      } catch (error) {
        enrichmentOutcome = error instanceof EditorModelError ? error.code : "replay-or-transport-failure";
      }
      results.push({ role, model: EVALUATION_MODELS[role], repetition, enrichment: enrichmentOutcome, verifierApproved, legacyDisposition });
    }
    if (nextReply !== recordings.length) replayIssues.push({ role, code: "unused-recordings-do-not-count-as-calls", count: recordings.length - nextReply });
  }
  return {
    version: "watch-model-replay-receipt-1", mode: "synthetic-offline-replay", stage,
    caseId: row.caseId, caseSha256: hashes.caseSha256, configurationSha256,
    distinctCases: 1, repetitionsPerModel: repetitions, requestCount: requests.length,
    requests, results, replayIssues, spend: spending.snapshot(), committedNanoUsd: spending.committedNanoUsd,
    costBasis: "configured-token-rates-not-provider-invoice",
    simulatedSpendOnly: true, measuredProviderLatency: false, editorialQualityEvaluated: false,
    watchPublicationGatesEvaluated: false, publicationPerformed: false, liveExecutionEnabled: false,
  };
}

export const evaluationDefaults = { timeoutMs: DEFAULT_EDITOR_TIMEOUT_MS, editorPromptVersion: EDITOR_PROMPT_VERSION };
