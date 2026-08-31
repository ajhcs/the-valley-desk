import { ContentCatalog, type ContentItem } from "../content/schema";
import publishedCatalog from "../content/published-catalog.json";
import {
  DEFAULT_EDITOR_BASE_URL,
  DEFAULT_EDITOR_MODEL,
  DEFAULT_EDITOR_TIMEOUT_MS,
  EDITOR_COPY_MIN_CONFIDENCE,
  EDITOR_COPY_MIN_RELEVANCE,
  MAX_EDITOR_TIMEOUT_MS,
  EditorModelError,
  enrichWithEditorModel,
} from "./editor-model";
import {
  DEFAULT_EDITOR_LANE_TOTAL_BUDGET,
  DEFAULT_EDITOR_MODEL_CONCURRENCY,
  DEFAULT_EDITOR_MODEL_DEADLINE_MS,
  MAX_EDITOR_LANE_TOTAL_BUDGET,
  MAX_EDITOR_MODEL_CONCURRENCY,
  parseBoundedInt,
  selectEditorModelWorkWithLanes,
  shouldEnrichCandidate,
} from "./editor-work";
import { evaluateCandidate, verificationInputForCandidate } from "./editor";
import { isHighRiskNews, verifyWithSecondModel, type VerificationResult } from "./verification";
import {
  acquireAutomationLock,
  candidateFingerprint,
  renewAutomationLock,
  markIngestRunFailed,
  markIngestRunSucceeded,
  persistEnrichments,
  persistEditorialDecisions,
  persistIngestRun,
  persistNewsArticleExtractions,
  persistSourceHealth,
  readSourceHealth,
  readEditorModelCache,
  readReviewBacklog,
  readNewsArticleExtractions,
  reconcileMissingPublishedEvents,
  releaseAutomationLock,
  type CandidateEnrichment,
  type D1DatabaseLike,
} from "./persistence";
import { logOps } from "../lib/ops";
import { matchingProductUses } from "./product-watch";
import { sourceIdentityKey } from "./identity";
import { runScheduledIngest, type IngestRun, type IngestRunOptions } from "./run-all";
import { isSuccessfulSourceState } from "./source-health";
import { markSocialEvidenceProcessed } from "./social-evidence";
import {
  officialSourceCoverage,
  coveragePack,
} from "./coverage-pack";
import {
  persistLeadershipObservations,
  persistLeadershipSnapshots,
  persistScheduledSourceState,
  readScheduledSourceStates,
  seedCoveragePack,
  autonomouslyVerifyLeadership,
} from "./executive-persistence";
import { monitorLeadershipSources } from "./leadership-monitor";
import { verifyPendingSignalPointers, type SignalVerificationResult } from "./signal-verification";
import {
  runOfficialSourceStage,
  type OfficialSourceAutomationResult,
} from "./official-source-automation";

export type AutomationEnv = {
  VALLEY_DESK_DB: D1DatabaseLike;
  OPENROUTER_API_KEY?: string;
  /** Legacy provider-neutral secret name. Prefer OPENROUTER_API_KEY. */
  EDITOR_MODEL_API_KEY?: string;
  EDITOR_MODEL_BASE_URL?: string;
  EDITOR_MODEL?: string;
  EDITOR_MODEL_BUDGET?: string | number;
  EDITOR_MODEL_CONCURRENCY?: string | number;
  EDITOR_MODEL_TIMEOUT_MS?: string | number;
  EDITOR_MODEL_DEADLINE_MS?: string | number;
  X_BEARER_TOKEN?: string;
  LINKEDIN_TOKEN?: string;
  SOCIAL_INGEST_TOKEN?: string;
};

export type AutomationIngest = (
  env: {
    X_BEARER_TOKEN?: string;
    LINKEDIN_TOKEN?: string;
    VALLEY_DESK_DB?: D1DatabaseLike;
    sourceHealth?: ReadonlyMap<string, import("./source-health").PersistedSourceHealth>;
  },
  fetchImpl: typeof fetch,
  options?: IngestRunOptions,
) => Promise<IngestRun>;

export type AutomationMode = "hourly" | "daily";

export type AutomationOptions = {
  /** Hourly keeps the freshness lane hot; daily enables the deep event scan. */
  mode?: AutomationMode;
};

// Cloudflare Workers requires the platform fetch function to be invoked with
// globalThis as its receiver. Passing the bare function through the ingest
// pipeline causes `Illegal invocation` in production even though Node accepts
// it in tests.
export const runtimeFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

const BUNDLED_INGEST_EVENTS = ContentCatalog.parse(publishedCatalog)
  .filter((item): item is Extract<ContentItem, { kind: "event" }> => (
    item.kind === "event" && item.source.kind === "ingest"
  ))
  .map((item) => ({
    id: item.id,
    origin: item.source.origin,
    title: item.title,
    content: item,
  }));

function allCandidates(run: IngestRun) {
  return [...run.rss, ...run.events, ...run.social];
}

function mergeCurrentAndBacklog(current: ContentItem[], backlog: ContentItem[]) {
  const byIdentity = new Map<string, ContentItem>();
  // Current source content wins over a historic review row with the same
  // canonical identity; the backlog fills gaps in partial source snapshots.
  for (const item of [...current, ...backlog]) {
    const identity = sourceIdentityKey(item);
    if (!byIdentity.has(identity)) byIdentity.set(identity, item);
  }
  return [...byIdentity.values()];
}

function attemptError(error: unknown) {
  if (error instanceof EditorModelError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

async function enrichCandidate(
  item: ContentItem,
  env: AutomationEnv,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  reusable?: CandidateEnrichment["enrichment"],
  untrustedSourceEvidence?: Record<string, unknown>,
): Promise<CandidateEnrichment> {
  if (reusable) return { item, enrichment: reusable };
  const apiKey = env.OPENROUTER_API_KEY || env.EDITOR_MODEL_API_KEY;
  const fingerprint = await candidateFingerprint(item);
  const attemptedAt = new Date().toISOString();
  if (!shouldEnrichCandidate(item) || !apiKey) return { item, enrichment: null };
  try {
    const enrichment = await enrichWithEditorModel(
      item,
      matchingProductUses(item),
      {
        apiKey,
        baseUrl: env.EDITOR_MODEL_BASE_URL,
        model: env.EDITOR_MODEL,
        timeoutMs,
        untrustedSourceEvidence,
      },
      fetchImpl,
    );
    if (!enrichment) {
      return {
        item,
        enrichment: null,
        attempt: { fingerprint, attemptedAt, outcome: "failure", error: "no_content: Editor model returned no content" },
      };
    }
    return {
      item,
      enrichment,
      attempt: { fingerprint, attemptedAt, outcome: "success", error: null },
    };
  } catch (error) {
    logOps("model", { outcome: "item-failure", itemId: item.id, error: attemptError(error) }, "warn");
    return {
      item,
      enrichment: null,
      attempt: { fingerprint, attemptedAt, outcome: "failure", error: attemptError(error) },
    };
  }
}

async function enrichBounded(
  items: ContentItem[],
  env: AutomationEnv,
  fetchImpl: typeof fetch,
  reusable: Map<string, NonNullable<CandidateEnrichment["enrichment"]>>,
  options: { concurrency: number; timeoutMs: number; deadlineAt: number; heartbeat?: () => Promise<void> },
  editorEvidence: ReadonlyMap<string, Record<string, unknown>> = new Map(),
) {
  const out: CandidateEnrichment[] = [];
  const concurrency = Math.max(1, Math.min(options.concurrency, items.length || 1));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      if (options.deadlineAt - Date.now() < 1_000) return;
      const index = next++;
      const item = items[index];
      if (!item) return;
      if (options.heartbeat) await options.heartbeat();
      const remaining = options.deadlineAt - Date.now();
      if (remaining < 1_000) return;
      const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs, remaining));
      out[index] = await enrichCandidate(
        item,
        env,
        fetchImpl,
        timeoutMs,
        reusable.get(item.id),
        editorEvidence.get(item.id),
      );
    }
  }));
  return out.filter((row): row is CandidateEnrichment => Boolean(row));
}

async function verifyBounded(
  candidates: Array<{ item: ContentItem; enrichment: NonNullable<CandidateEnrichment["enrichment"]> }>,
  env: AutomationEnv,
  fetchImpl: typeof fetch,
  existing: Map<string, VerificationResult>,
  options: {
    budget: number;
    concurrency: number;
    timeoutMs: number;
    deadlineAt: number;
    heartbeat?: () => Promise<void>;
  },
) {
  const results = new Map(existing);
  const work = candidates
    .filter(({ item, enrichment }) => (
      !results.has(item.id)
      && isHighRiskNews(verificationInputForCandidate(item, enrichment))
    ))
    .slice(0, Math.max(0, options.budget));
  let next = 0;
  let attempted = 0;
  let failed = 0;
  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, options.concurrency), work.length) },
    async () => {
      while (true) {
        if (options.deadlineAt - Date.now() < 1_000) return;
        const row = work[next++];
        if (!row) return;
        if (options.heartbeat) await options.heartbeat();
        const remaining = options.deadlineAt - Date.now();
        if (remaining < 1_000) return;
        attempted += 1;
        const verification = await verifyWithSecondModel(
          verificationInputForCandidate(row.item, row.enrichment),
          {
            apiKey: env.OPENROUTER_API_KEY || env.EDITOR_MODEL_API_KEY,
            baseUrl: env.EDITOR_MODEL_BASE_URL,
            model: env.EDITOR_MODEL,
            timeoutMs: Math.max(1_000, Math.min(options.timeoutMs, remaining)),
          },
          fetchImpl,
        );
        if (verification.objections.some((objection) => objection.code.startsWith("verifier-"))) {
          failed += 1;
        }
        results.set(row.item.id, verification);
      }
    },
  ));
  return {
    results,
    attempted,
    failed,
    approved: [...results.values()].filter((row) => row.approved).length,
    rejected: [...results.values()].filter((row) => !row.approved).length,
  };
}

type LeadershipAutomationResult = {
  outcome: "ok" | "degraded" | "failed";
  coverage: ReturnType<typeof officialSourceCoverage>;
  seeded: boolean;
  fetched: number;
  snapshots: number;
  observations: number;
  schedules: number;
  verifiedRoles: number;
  unresolved: number;
  conflicts: number;
  failed: number;
  editorialCandidates: ContentItem[];
  error?: string;
};

async function runLeadershipStage(
  env: AutomationEnv,
  fetchImpl: typeof fetch,
  now: Date,
  mode: AutomationMode = "hourly",
): Promise<LeadershipAutomationResult> {
  const coverage = officialSourceCoverage(coveragePack);
  try {
    await seedCoveragePack(env.VALLEY_DESK_DB, coveragePack, now);
    const states = await readScheduledSourceStates(env.VALLEY_DESK_DB);
    const result = await monitorLeadershipSources({ fetchImpl, pack: coveragePack, states, now });
    const snapshots = await persistLeadershipSnapshots(env.VALLEY_DESK_DB, result.snapshots);
    const observations = await persistLeadershipObservations(env.VALLEY_DESK_DB, result.observations);
    const schedules = await persistScheduledSourceState(env.VALLEY_DESK_DB, result.schedule);
    const autonomous = await autonomouslyVerifyLeadership(env.VALLEY_DESK_DB, coveragePack, now);
    const failed = result.snapshots.filter((snapshot) => (
      snapshot.state !== "success" && snapshot.state !== "unchanged"
    )).length;
    const outcome = failed > 0 ? "degraded" : "ok";
    logOps("leadership", {
      outcome,
      cadence: mode,
      fetched: result.fetchedUrls.length,
      snapshots,
      observations,
      schedules,
      verifiedRoles: autonomous.verifiedRoles,
      unresolved: autonomous.unresolved,
      conflicts: autonomous.conflicts,
      editorialCandidates: autonomous.editorialCandidates.length,
      failed,
      coverage,
    }, outcome === "ok" ? "info" : "warn");
    return {
      outcome,
      coverage,
      seeded: true,
      fetched: result.fetchedUrls.length,
      snapshots,
      observations,
      schedules,
      verifiedRoles: autonomous.verifiedRoles,
      unresolved: autonomous.unresolved,
      conflicts: autonomous.conflicts,
      failed,
      editorialCandidates: autonomous.editorialCandidates,
    };
  } catch (error) {
    const message = attemptError(error);
    // Leadership monitoring and autonomous history application must not make
    // the ordinary hourly news/event ingest fail when its additive schema or
    // upstreams are unavailable. Emitted editorial candidates remain review.
    logOps("leadership", { outcome: "failed", error: message, coverage }, "error");
    return {
      outcome: "failed",
      coverage,
      seeded: false,
      fetched: 0,
      snapshots: 0,
      observations: 0,
      schedules: 0,
      verifiedRoles: 0,
      unresolved: 0,
      conflicts: 0,
      failed: 0,
      editorialCandidates: [],
      error: message,
    };
  }
}

export async function runAutomation(
  env: AutomationEnv,
  fetchImpl: typeof fetch = runtimeFetch,
  ingest: AutomationIngest = runScheduledIngest,
  options: AutomationOptions = {},
) {
  const mode = options.mode ?? "hourly";
  const lockOwner = crypto.randomUUID();
  if (!(await acquireAutomationLock(env.VALLEY_DESK_DB, lockOwner))) {
    logOps("lock", { outcome: "busy", reason: "automation-already-running" }, "warn");
    return { skipped: true, reason: "automation-already-running" };
  }
  const heartbeat = setInterval(() => {
    void renewAutomationLock(env.VALLEY_DESK_DB, lockOwner).catch((error) => {
      console.error("automation-lock-renew-failed", error);
    });
  }, 60_000);
  const ensureLock = async () => {
    if (!(await renewAutomationLock(env.VALLEY_DESK_DB, lockOwner))) {
      throw new Error("automation-lock-lost");
    }
  };
  logOps("lock", { outcome: "acquired" });
  let stage = "load-news-extractions";
  let persistedRunId: string | undefined;
  const leadershipNow = new Date();
  let leadership: LeadershipAutomationResult;
  let signalVerification: SignalVerificationResult = {
    outcome: "ok",
    discoveries: 0,
    pointers: 0,
    fetched: 0,
    verified: 0,
    rejected: 0,
    failed: 0,
    candidates: [],
  };
  let officialDiscovery: OfficialSourceAutomationResult = {
    outcome: "ok",
    fetched: 0,
    snapshots: 0,
    schedules: 0,
    candidates: 0,
    accepted: 0,
    editorialCandidates: [],
  };
  try {
    await ensureLock();
    stage = "leadership-monitor";
    leadership = await runLeadershipStage(env, fetchImpl, leadershipNow, mode);
    stage = "official-source-discovery";
    try {
      officialDiscovery = await runOfficialSourceStage(
        env.VALLEY_DESK_DB,
        env,
        fetchImpl,
        leadershipNow,
      );
      logOps("official-source-discovery", {
        outcome: officialDiscovery.outcome,
        cadence: mode,
        fetched: officialDiscovery.fetched,
        snapshots: officialDiscovery.snapshots,
        schedules: officialDiscovery.schedules,
        candidates: officialDiscovery.candidates,
        accepted: officialDiscovery.accepted,
        editorialCandidates: officialDiscovery.editorialCandidates.length,
      }, officialDiscovery.outcome === "ok" ? "info" : "warn");
    } catch (error) {
      // Official-source discovery is additive. A D1/schema or upstream failure
      // must not stop the ordinary hourly ingest, and no discovery can publish here.
      officialDiscovery = {
        ...officialDiscovery,
        outcome: "failed",
        error: error instanceof Error ? error.message : "Official source discovery failed",
      };
      logOps("official-source-discovery", { outcome: "failed", error: officialDiscovery.error }, "error");
    }
    stage = "signal-verification";
    try {
      signalVerification = await verifyPendingSignalPointers(
        env.VALLEY_DESK_DB,
        fetchImpl,
        leadershipNow,
      );
      logOps("signal-verification", {
        outcome: signalVerification.outcome,
        discoveries: signalVerification.discoveries,
        pointers: signalVerification.pointers,
        fetched: signalVerification.fetched,
        verified: signalVerification.verified,
        rejected: signalVerification.rejected,
        failed: signalVerification.failed,
        candidates: signalVerification.candidates.length,
      }, signalVerification.outcome === "ok" ? "info" : "warn");
    } catch (error) {
      // Signal verification is additive. A D1/schema or upstream failure must
      // not stop the ordinary hourly ingest, and no pointer can publish here.
      signalVerification = {
        ...signalVerification,
        outcome: "failed",
        error: error instanceof Error ? error.message : "Signal verification failed",
      };
      logOps("signal-verification", { outcome: "failed", error: signalVerification.error }, "error");
    }
    stage = "load-news-extractions";
    const newsExtractions = await readNewsArticleExtractions(env.VALLEY_DESK_DB);
    const sourceHealth = await readSourceHealth(env.VALLEY_DESK_DB);
    stage = "fetch-sources";
    const ingestedRun = await ingest({
      X_BEARER_TOKEN: env.X_BEARER_TOKEN,
      LINKEDIN_TOKEN: env.LINKEDIN_TOKEN,
      VALLEY_DESK_DB: env.VALLEY_DESK_DB,
      sourceHealth,
    }, fetchImpl, {
      newsExtractions,
      mode,
      includeEvents: mode === "daily",
    });
    const signalCandidates = signalVerification.candidates;
    const officialNews = officialDiscovery.editorialCandidates.filter((item) => item.kind !== "event");
    const officialEvents = officialDiscovery.editorialCandidates.filter((item) => item.kind === "event");
    const additiveNews = [...leadership.editorialCandidates, ...signalCandidates, ...officialNews];
    const run = additiveNews.length > 0 || officialEvents.length > 0
      ? {
        ...ingestedRun,
        rss: additiveNews.length > 0 ? [...ingestedRun.rss, ...additiveNews] : ingestedRun.rss,
        events: officialEvents.length > 0 ? [...ingestedRun.events, ...officialEvents] : ingestedRun.events,
        notes: {
          ...ingestedRun.notes,
          rss: ingestedRun.notes.rss + additiveNews.length,
          events: ingestedRun.notes.events + officialEvents.length,
        },
      }
      : ingestedRun;
    const currentItems = allCandidates(run);
    const backlog = await readReviewBacklog(env.VALLEY_DESK_DB);
    const items = mergeCurrentAndBacklog(currentItems, backlog);
    stage = "persist-news-extractions";
    const newsExtractionCount = await persistNewsArticleExtractions(
      env.VALLEY_DESK_DB,
      run.newsExtraction?.attempts ?? [],
    );
    const newsMetrics = run.newsExtraction?.metrics;
    stage = "load-enrichment-cache";
    const { reusable, states: modelStates, verifications } = await readEditorModelCache(env.VALLEY_DESK_DB, items);
    stage = "persist-raw-candidates";
    const persisted = await persistIngestRun(
      env.VALLEY_DESK_DB,
      run,
      currentItems.map((item) => ({ item, enrichment: null })),
    );
    persistedRunId = persisted.runId;
    stage = "persist-source-health";
    const sourceHealthCount = await persistSourceHealth(
      env.VALLEY_DESK_DB,
      persisted.runId,
      run.notes.sources ?? [],
    );
    stage = "reconcile-missing-events";
    const reconciliation = await reconcileMissingPublishedEvents(
      env.VALLEY_DESK_DB,
      persisted.runId,
      run.fetchedAt,
      run.notes.sources ?? [],
      2,
      BUNDLED_INGEST_EVENTS,
    );
    const budget = parseBoundedInt(
      env.EDITOR_MODEL_BUDGET,
      DEFAULT_EDITOR_LANE_TOTAL_BUDGET,
      0,
      MAX_EDITOR_LANE_TOTAL_BUDGET,
    );
    const concurrency = parseBoundedInt(
      env.EDITOR_MODEL_CONCURRENCY,
      DEFAULT_EDITOR_MODEL_CONCURRENCY,
      1,
      MAX_EDITOR_MODEL_CONCURRENCY,
    );
    const timeoutMs = parseBoundedInt(
      env.EDITOR_MODEL_TIMEOUT_MS,
      DEFAULT_EDITOR_TIMEOUT_MS,
      1_000,
      MAX_EDITOR_TIMEOUT_MS,
    );
    const deadlineMs = parseBoundedInt(
      env.EDITOR_MODEL_DEADLINE_MS,
      DEFAULT_EDITOR_MODEL_DEADLINE_MS,
      5_000,
      120_000,
    );
    const fingerprinted = await Promise.all(items.map(async (item) => ({
      item,
      fingerprint: await candidateFingerprint(item),
    })));
    await ensureLock();
    const selectedWork = selectEditorModelWorkWithLanes(
      fingerprinted,
      modelStates,
      {
        totalBudget: budget,
        now: new Date(),
        reusableIds: new Set(reusable.keys()),
      },
    );
    const selected = selectedWork.items;
    const modelDeadlineAt = Date.now() + deadlineMs;
    stage = "model-enrichment";
    const modeled = await enrichBounded(selected, env, fetchImpl, reusable, {
      concurrency,
      timeoutMs,
      deadlineAt: modelDeadlineAt,
      heartbeat: ensureLock,
    });
    const modeledById = new Map(modeled.map((row) => [row.item.id, row]));
    const verificationCandidates = items.flatMap((item) => {
      const enrichment = modeledById.get(item.id)?.enrichment ?? reusable.get(item.id);
      return enrichment ? [{ item, enrichment }] : [];
    });
    const verificationEligibleCandidates = verificationCandidates.filter(({ item, enrichment }) => (
      !verifications.has(item.id)
      && enrichment.decision === "priority_review"
      && enrichment.relevanceScore >= EDITOR_COPY_MIN_RELEVANCE
      && enrichment.confidence >= EDITOR_COPY_MIN_CONFIDENCE
      && Boolean(enrichment.impactSentence?.trim())
      && isHighRiskNews(verificationInputForCandidate(item, enrichment))
    ));
    const fingerprintById = new Map(fingerprinted.map((row) => [row.item.id, row.fingerprint]));
    const verificationSelection = selectEditorModelWorkWithLanes(
      verificationEligibleCandidates.map(({ item }) => ({
        item,
        fingerprint: fingerprintById.get(item.id) ?? item.id,
      })),
      new Map(),
      { totalBudget: budget, now: new Date() },
    );
    const verificationById = new Map(verificationEligibleCandidates.map((row) => [row.item.id, row]));
    const prioritizedVerificationCandidates = verificationSelection.items.flatMap((item) => {
      const row = verificationById.get(item.id);
      return row ? [row] : [];
    });
    stage = "model-verification";
    const verificationRun = await verifyBounded(
      prioritizedVerificationCandidates,
      env,
      fetchImpl,
      verifications,
      {
        budget,
        concurrency,
        timeoutMs,
        // Verification is an independent specialist pass. Giving it a fresh
        // bounded window prevents enrichment from consuming the entire run
        // deadline and leaving high-risk stories permanently unverified.
        deadlineAt: Date.now() + deadlineMs,
        heartbeat: ensureLock,
      },
    );
    const candidates = items.map((item) => {
      const modeledCandidate = modeledById.get(item.id);
      if (modeledCandidate) {
        return {
          ...modeledCandidate,
          verification: verificationRun.results.get(item.id) ?? null,
        };
      }
      return {
        item,
        enrichment: reusable.get(item.id) ?? null,
        verification: verificationRun.results.get(item.id) ?? null,
      };
    });
    stage = "persist-enrichments";
    const enrichedCount = await persistEnrichments(env.VALLEY_DESK_DB, candidates);
    stage = "editor-policy";
    const decisions = candidates.map((candidate) => ({
      ...candidate,
      decision: evaluateCandidate(candidate.item, candidate.enrichment, new Date(), candidate.verification),
    }));
    stage = "persist-editorial-decisions";
    const editorial = await persistEditorialDecisions(
      env.VALLEY_DESK_DB,
      decisions,
      env.EDITOR_MODEL || DEFAULT_EDITOR_MODEL,
      env.EDITOR_MODEL_BASE_URL || DEFAULT_EDITOR_BASE_URL,
    );
    stage = "ack-social-evidence";
    const socialEvidenceProcessedCount = await markSocialEvidenceProcessed(
      env.VALLEY_DESK_DB,
      run.socialEvidenceProcessed ?? [],
      new Date(),
    );
    stage = "complete-run";
    const finishedAt = await markIngestRunSucceeded(env.VALLEY_DESK_DB, persisted.runId);
    const modelAttemptedCount = modeled.filter((row) => row.attempt).length;
    const modelSucceededCount = modeled.filter((row) => row.attempt?.outcome === "success").length;
    const modelFailedCount = modeled.filter((row) => row.attempt?.outcome === "failure").length;
    const modelValidationRejectedCount = modeled.filter((row) => (
      row.attempt?.outcome === "failure" && row.attempt.error?.startsWith("validation:")
    )).length;
    const modelOperationalFailedCount = modelFailedCount - modelValidationRejectedCount;
    const sources = (run.notes.sources ?? []).map((source) => ({
      id: source.id,
      origin: source.origin,
      type: source.type,
      state: source.state,
      itemCount: source.itemCount,
      complete: source.complete,
    }));
    const sourceErrorCount = sources.filter(
      (source) => !["disabled", "misconfigured"].includes(source.state) && !isSuccessfulSourceState(source.state),
    ).length;
    logOps("run", {
      outcome: "succeeded",
      cadence: mode,
      runId: persisted.runId,
      itemCount: persisted.itemCount,
      finishedAt,
    });
    logOps("source", {
      outcome: sourceErrorCount > 0 ? "degraded" : "ok",
      runId: persisted.runId,
      checked: sources.length,
      errors: sourceErrorCount,
      sources,
    });
    logOps("news-extraction", {
      outcome: !newsMetrics
        ? "ok"
        : newsMetrics.failed && !newsMetrics.success && !newsMetrics.reused && !newsMetrics.preserved
          ? "failed"
          : newsMetrics.failed || newsMetrics.noContent
            ? "degraded"
            : "ok",
      runId: persisted.runId,
      persisted: newsExtractionCount,
      ...(newsMetrics ?? {}),
    });
    logOps("model", {
      outcome: modelOperationalFailedCount && !modelSucceededCount
        ? "failed"
        : modelOperationalFailedCount ? "degraded" : "ok",
      runId: persisted.runId,
      budget,
      selected: selected.length,
      attempted: modelAttemptedCount,
      succeeded: modelSucceededCount,
      failed: modelFailedCount,
      validationRejected: modelValidationRejectedCount,
      operationalFailed: modelOperationalFailedCount,
      reused: reusable.size,
      verifierAttempted: verificationRun.attempted,
      verifierFailed: verificationRun.failed,
      verifierApproved: verificationRun.approved,
      verifierRejected: verificationRun.rejected,
      verifierLanes: Object.fromEntries(Object.entries(verificationSelection.selectedByLane).map(([lane, rows]) => [
        lane,
        rows.length,
      ])),
      lanes: Object.fromEntries(Object.entries(selectedWork.metricsByLane).map(([lane, metrics]) => [lane, {
        eligible: metrics.eligibleCount,
        selected: metrics.selectedCount,
        budget: metrics.budget,
        oldestAgeMs: metrics.oldestEligibleAgeMs,
      }])),
      editorModel: env.EDITOR_MODEL || DEFAULT_EDITOR_MODEL,
    });
    logOps("publication", {
      outcome: "applied",
      runId: persisted.runId,
      ...editorial,
    });
    logOps("social-evidence", {
      outcome: "acknowledged",
      runId: persisted.runId,
      processed: socialEvidenceProcessedCount,
    });
    logOps("reconciliation", {
      outcome: reconciliation.withdrawn ? "withdrawn" : "ok",
      runId: persisted.runId,
      ...reconciliation,
    });
    return {
      ...persisted,
      cadence: mode,
      finishedAt,
      enrichedCount,
      reusedEnrichmentCount: reusable.size,
      modelBudget: budget,
      modelSelectedCount: selected.length,
      queueMetrics: selectedWork.metricsByLane,
      selectedByLane: Object.fromEntries(Object.entries(selectedWork.selectedByLane).map(([lane, rows]) => [
        lane,
        rows.length,
      ])),
      modelAttemptedCount,
      modelSucceededCount,
      modelFailedCount,
      modelValidationRejectedCount,
      modelOperationalFailedCount,
      verifierAttemptedCount: verificationRun.attempted,
      verifierFailedCount: verificationRun.failed,
      verifierApprovedCount: verificationRun.approved,
      verifierRejectedCount: verificationRun.rejected,
      sourceHealthCount,
      socialEvidenceProcessedCount,
      newsExtractionCount,
      signalVerification,
      officialDiscovery,
      leadership,
      ...reconciliation,
      ...editorial,
      notes: run.notes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logOps("run", { outcome: "failed", stage, runId: persistedRunId, message }, "error");
    if (persistedRunId) {
      try {
        await markIngestRunFailed(env.VALLEY_DESK_DB, persistedRunId, `${stage}: ${message}`);
      } catch (statusError) {
        logOps("run", {
          outcome: "status-write-failed",
          runId: persistedRunId,
          message: statusError instanceof Error ? statusError.message : "Unknown status write failure",
        }, "error");
      }
    }
    throw new Error(`Automation failed during ${stage}: ${message}`, { cause: error });
  } finally {
    clearInterval(heartbeat);
    try {
      await releaseAutomationLock(env.VALLEY_DESK_DB, lockOwner);
      logOps("lock", { outcome: "released" });
    } catch (error) {
      logOps("lock", {
        outcome: "release-failed",
        message: error instanceof Error ? error.message : "Unknown lock release failure",
      }, "error");
    }
  }
}
