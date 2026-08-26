import type { ContentItem } from "../content/schema";
import {
  DEFAULT_EDITOR_BASE_URL,
  DEFAULT_EDITOR_MODEL,
  DEFAULT_EDITOR_TIMEOUT_MS,
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
  selectEditorModelWork,
  shouldEnrichCandidate,
} from "./editor-work";
import { evaluateCandidate } from "./editor";
import {
  acquireAutomationLock,
  candidateFingerprint,
  markIngestRunFailed,
  markIngestRunSucceeded,
  persistEnrichments,
  persistEditorialDecisions,
  persistIngestRun,
  persistSourceHealth,
  readEditorModelCache,
  reconcileMissingPublishedEvents,
  releaseAutomationLock,
  type CandidateEnrichment,
  type D1DatabaseLike,
} from "./persistence";
import { matchingProductUses } from "./product-watch";
import { runScheduledIngest, type IngestRun } from "./run-all";

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
) => Promise<IngestRun>;

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
    console.warn("editor-enrichment-skipped", item.id, attemptError(error));
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
  options: { concurrency: number; timeoutMs: number; deadlineAt: number },
) {
  const out: CandidateEnrichment[] = [];
  const concurrency = Math.max(1, Math.min(options.concurrency, items.length || 1));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const remaining = options.deadlineAt - Date.now();
      if (remaining < 1_000) return;
      const index = next++;
      const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs, remaining));
      out[index] = await enrichCandidate(items[index], env, fetchImpl, timeoutMs, reusable.get(items[index].id));
    }
  }));
  return out.filter((row): row is CandidateEnrichment => Boolean(row));
}

export async function runAutomation(
  env: AutomationEnv,
  fetchImpl: typeof fetch = fetch,
  ingest: AutomationIngest = runScheduledIngest,
) {
  const lockOwner = crypto.randomUUID();
  if (!(await acquireAutomationLock(env.VALLEY_DESK_DB, lockOwner))) {
    return { skipped: true, reason: "automation-already-running" };
  }
  let stage = "fetch-sources";
  let persistedRunId: string | undefined;
  try {
    const run = await ingest({
      X_BEARER_TOKEN: env.X_BEARER_TOKEN,
      LINKEDIN_TOKEN: env.LINKEDIN_TOKEN,
    }, fetchImpl);
    const items = allCandidates(run);
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
      DEFAULT_EDITOR_TIMEOUT_MS,
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
    const selected = selectEditorModelWork(
      fingerprinted,
      modelStates,
      budget,
      new Date(),
      new Set(reusable.keys()),
    );
    stage = "model-enrichment";
    const modeled = await enrichBounded(selected, env, fetchImpl, reusable, {
      concurrency,
      timeoutMs,
      deadlineAt: Date.now() + deadlineMs,
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
    return {
      ...persisted,
      finishedAt,
      enrichedCount,
      reusedEnrichmentCount: reusable.size,
      modelBudget: budget,
      modelSelectedCount: selected.length,
      modelAttemptedCount: modeled.filter((row) => row.attempt).length,
      modelSucceededCount: modeled.filter((row) => row.attempt?.outcome === "success").length,
      modelFailedCount: modeled.filter((row) => row.attempt?.outcome === "failure").length,
      sourceHealthCount,
      ...reconciliation,
      ...editorial,
      notes: run.notes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown automation error";
    if (persistedRunId) {
      try {
        await markIngestRunFailed(env.VALLEY_DESK_DB, persistedRunId, `${stage}: ${message}`);
      } catch (statusError) {
        console.error("ingest-run-failure-status-write-failed", statusError);
      }
    }
    throw new Error(`Automation failed during ${stage}: ${message}`, { cause: error });
  } finally {
    try {
      await releaseAutomationLock(env.VALLEY_DESK_DB, lockOwner);
    } catch (error) {
      console.error("automation-lock-release-failed", error);
    }
  }
}
