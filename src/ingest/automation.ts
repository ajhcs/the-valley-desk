import { ContentCatalog, type ContentItem } from "../content/schema";
import publishedCatalog from "../content/published-catalog.json";
import {
  DEFAULT_EDITOR_BASE_URL,
  DEFAULT_EDITOR_MODEL,
  DEFAULT_EDITOR_TIMEOUT_MS,
  MAX_EDITOR_TIMEOUT_MS,
  EditorModelError,
  enrichWithEditorModel,
} from "./editor-model";
import {
  DEFAULT_EDITOR_MODEL_BUDGET,
  DEFAULT_EDITOR_MODEL_CONCURRENCY,
  DEFAULT_EDITOR_MODEL_DEADLINE_MS,
  MAX_EDITOR_MODEL_BUDGET,
  MAX_EDITOR_MODEL_CONCURRENCY,
  parseBoundedInt,
  selectEditorModelWorkWithMetrics,
  shouldEnrichCandidate,
} from "./editor-work";
import { evaluateCandidate } from "./editor";
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
  readEditorModelCache,
  readNewsArticleExtractions,
  reconcileMissingPublishedEvents,
  releaseAutomationLock,
  type CandidateEnrichment,
  type D1DatabaseLike,
} from "./persistence";
import { logOps } from "../lib/ops";
import { matchingProductUses } from "./product-watch";
import { runScheduledIngest, type IngestRun, type IngestRunOptions } from "./run-all";
import { isSuccessfulSourceState } from "./source-health";
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
} from "./executive-persistence";
import { monitorLeadershipSources } from "./leadership-monitor";

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
};

export type AutomationIngest = (
  env: { X_BEARER_TOKEN?: string; LINKEDIN_TOKEN?: string },
  fetchImpl: typeof fetch,
  options?: IngestRunOptions,
) => Promise<IngestRun>;

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

function attemptError(error: unknown) {
  if (error instanceof EditorModelError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : "Unknown editor-model error";
}

async function enrichCandidate(
  item: ContentItem,
  env: AutomationEnv,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  reusable?: CandidateEnrichment["enrichment"],
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
) {
  const out: CandidateEnrichment[] = [];
  const concurrency = Math.max(1, Math.min(options.concurrency, items.length || 1));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const remaining = options.deadlineAt - Date.now();
      if (remaining < 1_000) return;
      if (options.heartbeat) await options.heartbeat();
      const index = next++;
      const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs, remaining));
      out[index] = await enrichCandidate(items[index], env, fetchImpl, timeoutMs, reusable.get(items[index].id));
    }
  }));
  return out.filter((row): row is CandidateEnrichment => Boolean(row));
}

type LeadershipAutomationResult = {
  outcome: "ok" | "degraded" | "failed";
  coverage: ReturnType<typeof officialSourceCoverage>;
  seeded: boolean;
  fetched: number;
  snapshots: number;
  observations: number;
  schedules: number;
  error?: string;
};

async function runLeadershipStage(
  env: AutomationEnv,
  fetchImpl: typeof fetch,
  now: Date,
): Promise<LeadershipAutomationResult> {
  const coverage = officialSourceCoverage(coveragePack);
  try {
    await seedCoveragePack(env.VALLEY_DESK_DB, coveragePack, now);
    const states = await readScheduledSourceStates(env.VALLEY_DESK_DB);
    const result = await monitorLeadershipSources({ fetchImpl, pack: coveragePack, states, now });
    const snapshots = await persistLeadershipSnapshots(env.VALLEY_DESK_DB, result.snapshots);
    const observations = await persistLeadershipObservations(env.VALLEY_DESK_DB, result.observations);
    const schedules = await persistScheduledSourceState(env.VALLEY_DESK_DB, result.schedule);
    const failed = result.snapshots.filter((snapshot) => (
      snapshot.state !== "success" && snapshot.state !== "unchanged"
    )).length;
    const outcome = failed > 0 ? "degraded" : "ok";
    logOps("leadership", {
      outcome,
      fetched: result.fetchedUrls.length,
      snapshots,
      observations,
      schedules,
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
    };
  } catch (error) {
    const message = attemptError(error);
    // Leadership monitoring is review-only and must not make the ordinary
    // hourly news/event ingest fail when its additive schema or upstreams are
    // unavailable.
    logOps("leadership", { outcome: "failed", error: message, coverage }, "error");
    return {
      outcome: "failed",
      coverage,
      seeded: false,
      fetched: 0,
      snapshots: 0,
      observations: 0,
      schedules: 0,
      error: message,
    };
  }
}

export async function runAutomation(
  env: AutomationEnv,
  fetchImpl: typeof fetch = runtimeFetch,
  ingest: AutomationIngest = runScheduledIngest,
) {
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
  try {
    await ensureLock();
    stage = "leadership-monitor";
    leadership = await runLeadershipStage(env, fetchImpl, leadershipNow);
    stage = "load-news-extractions";
    const newsExtractions = await readNewsArticleExtractions(env.VALLEY_DESK_DB);
    stage = "fetch-sources";
    const run = await ingest({
      X_BEARER_TOKEN: env.X_BEARER_TOKEN,
      LINKEDIN_TOKEN: env.LINKEDIN_TOKEN,
    }, fetchImpl, { newsExtractions });
    const items = allCandidates(run);
    stage = "persist-news-extractions";
    const newsExtractionCount = await persistNewsArticleExtractions(
      env.VALLEY_DESK_DB,
      run.newsExtraction?.attempts ?? [],
    );
    const newsMetrics = run.newsExtraction?.metrics;
    stage = "load-enrichment-cache";
    const { reusable, states: modelStates } = await readEditorModelCache(env.VALLEY_DESK_DB, items);
    stage = "persist-raw-candidates";
    const persisted = await persistIngestRun(
      env.VALLEY_DESK_DB,
      run,
      items.map((item) => ({ item, enrichment: null })),
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
      DEFAULT_EDITOR_MODEL_BUDGET,
      0,
      MAX_EDITOR_MODEL_BUDGET,
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
    const selectedWork = selectEditorModelWorkWithMetrics(
      fingerprinted,
      modelStates,
      budget,
      new Date(),
      new Set(reusable.keys()),
    );
    const selected = selectedWork.items;
    stage = "model-enrichment";
    const modeled = await enrichBounded(selected, env, fetchImpl, reusable, {
      concurrency,
      timeoutMs,
      deadlineAt: Date.now() + deadlineMs,
      heartbeat: ensureLock,
    });
    const modeledById = new Map(modeled.map((row) => [row.item.id, row]));
    const candidates = items.map((item) => (
      modeledById.get(item.id) ?? { item, enrichment: reusable.get(item.id) ?? null }
    ));
    stage = "persist-enrichments";
    const enrichedCount = await persistEnrichments(env.VALLEY_DESK_DB, candidates);
    stage = "editor-policy";
    const decisions = candidates.map((candidate) => ({
      ...candidate,
      decision: evaluateCandidate(candidate.item, candidate.enrichment),
    }));
    stage = "persist-editorial-decisions";
    const editorial = await persistEditorialDecisions(
      env.VALLEY_DESK_DB,
      decisions,
      env.EDITOR_MODEL || DEFAULT_EDITOR_MODEL,
      env.EDITOR_MODEL_BASE_URL || DEFAULT_EDITOR_BASE_URL,
    );
    stage = "complete-run";
    const finishedAt = await markIngestRunSucceeded(env.VALLEY_DESK_DB, persisted.runId);
    const modelAttemptedCount = modeled.filter((row) => row.attempt).length;
    const modelSucceededCount = modeled.filter((row) => row.attempt?.outcome === "success").length;
    const modelFailedCount = modeled.filter((row) => row.attempt?.outcome === "failure").length;
    const sources = (run.notes.sources ?? []).map((source) => ({
      id: source.id,
      origin: source.origin,
      type: source.type,
      state: source.state,
      itemCount: source.itemCount,
      complete: source.complete,
    }));
    const sourceErrorCount = sources.filter(
      (source) => source.state !== "disabled" && !isSuccessfulSourceState(source.state),
    ).length;
    logOps("run", {
      outcome: "succeeded",
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
      outcome: modelFailedCount && !modelSucceededCount ? "failed" : modelFailedCount ? "degraded" : "ok",
      runId: persisted.runId,
      budget,
      selected: selected.length,
      attempted: modelAttemptedCount,
      succeeded: modelSucceededCount,
      failed: modelFailedCount,
      reused: reusable.size,
      editorModel: env.EDITOR_MODEL || DEFAULT_EDITOR_MODEL,
    });
    logOps("publication", {
      outcome: "applied",
      runId: persisted.runId,
      ...editorial,
    });
    logOps("reconciliation", {
      outcome: reconciliation.withdrawn ? "withdrawn" : "ok",
      runId: persisted.runId,
      ...reconciliation,
    });
    return {
      ...persisted,
      finishedAt,
      enrichedCount,
      reusedEnrichmentCount: reusable.size,
      modelBudget: budget,
      modelSelectedCount: selected.length,
      queueMetrics: selectedWork.metrics,
      modelAttemptedCount,
      modelSucceededCount,
      modelFailedCount,
      sourceHealthCount,
      newsExtractionCount,
      leadership,
      ...reconciliation,
      ...editorial,
      notes: run.notes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown automation error";
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
