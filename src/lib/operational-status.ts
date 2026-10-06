import { LEADERSHIP_CADENCE_MS } from "../ingest/leadership-config";

export const OPERATIONAL_CONDITION_STATES = [
  "healthy",
  "degraded",
  "blocked",
  "backoff",
  "failed",
  "resolved",
] as const;

export type OperationalConditionState = (typeof OPERATIONAL_CONDITION_STATES)[number];

/** A recent successful observation keeps a transient source failure non-critical. */
export const SOURCE_FRESHNESS_SLO_MS = 2 * 60 * 60 * 1_000;
/** Conservative fallback for missing cadence; daily/weekly sources use their own interval. */
export const LEADERSHIP_FRESHNESS_SLO_MS = SOURCE_FRESHNESS_SLO_MS;
export const LEADERSHIP_FRESHNESS_GRACE_MS = 2 * 60 * 60 * 1_000;

export function leadershipFreshnessBudgetMs(cadence: unknown) {
  if (cadence !== "hourly" && cadence !== "daily" && cadence !== "weekly") {
    return LEADERSHIP_FRESHNESS_SLO_MS;
  }
  const interval = LEADERSHIP_CADENCE_MS[cadence];
  return interval + Math.min(interval, LEADERSHIP_FRESHNESS_GRACE_MS);
}

/** Map source scheduler vocabulary onto the operator-facing state model. */
export function conditionStateForSourceState(state: unknown, fallbackActive = false): OperationalConditionState {
  if (state === "backoff") return "backoff";
  if (state === "upstream-blocked" || state === "blocked") return "blocked";
  if (state === "healthy" || state === "healthy-empty" || state === "success" || state === "unchanged") {
    return fallbackActive ? "degraded" : "healthy";
  }
  return "failed";
}

export type RuntimeLeadershipSourceInput = {
  sourceId: string;
  institutionId: string;
  state?: string | null;
  /** Trusted configured cadence, never inferred from retry/backoff dates. */
  cadence?: string | null;
  lastSuccessAt?: string | null;
  lastAttemptedAt?: string | null;
  nextAttemptAt?: string | null;
  consecutiveFailures?: number;
  lastError?: string | null;
};

export type RuntimeLeadershipSourceStatus = {
  sourceId: string;
  institutionId: string;
  state: Exclude<OperationalConditionState, "resolved">;
  rawState: string;
  cadence: string | null;
  freshnessBudgetMs: number;
  freshUntilAt: string | null;
  coverageCurrent: boolean;
  lastSuccessAt: string | null;
  lastAttemptedAt: string | null;
  nextRetryAt: string | null;
  failureAgeMs: number | null;
  consecutiveFailures: number;
  reason: string | null;
};

export type RuntimeLeadershipInstitutionInput = {
  institutionId: string;
  shortName: string;
  configuredStatus: "active" | "degraded";
  sourceIds: string[];
};

export type RuntimeLeadershipCoverage = {
  institutionId: string;
  shortName: string;
  configuredStatus: "active" | "degraded";
  state: Exclude<OperationalConditionState, "resolved">;
  coverageLost: boolean;
  /** Evidence expiry, not a retry deadline or evidence of a person's departure. */
  freshUntilAt: string | null;
  coverageLossReason: "expired" | "never-observed" | "invalid-success-time" | null;
  sourceIds: string[];
  healthySourceIds: string[];
  lastSuccessAt: string | null;
  failureAgeMs: number | null;
  nextRetryAt: string | null;
  sourceStates: RuntimeLeadershipSourceStatus[];
};

function finiteTimestamp(value: string | null | undefined) {
  if (!value) return undefined;
  // Date.parse silently rolls September31 or a non-leap February29 forward.
  // Require a zoned ISO timestamp and validate its calendar before parsing.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return undefined;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]!
    || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59
    || (zone !== "Z" && (Number(zone!.slice(1, 3)) > 23 || Number(zone!.slice(4)) > 59))) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function sourceStatus(
  input: RuntimeLeadershipSourceInput,
  nowMs: number,
): RuntimeLeadershipSourceStatus {
  const rawState = typeof input.state === "string" && input.state.trim() ? input.state : "pending";
  const lastSuccessMs = finiteTimestamp(input.lastSuccessAt);
  const nextRetryMs = finiteTimestamp(input.nextAttemptAt);
  const failures = Math.max(0, Number(input.consecutiveFailures) || 0);
  const freshnessBudgetMs = leadershipFreshnessBudgetMs(input.cadence);
  const failureAgeMs = lastSuccessMs !== undefined && lastSuccessMs <= nowMs
    ? nowMs - lastSuccessMs
    : null;
  const fresh = failureAgeMs !== null && failureAgeMs <= freshnessBudgetMs;
  let state: Exclude<OperationalConditionState, "resolved">;
  if ((rawState === "healthy" || rawState === "unchanged") && fresh && failures === 0) {
    state = "healthy";
  } else if (rawState === "blocked") {
    state = "blocked";
  } else if (nextRetryMs !== undefined && nextRetryMs > nowMs && failures > 0) {
    state = "backoff";
  } else if (rawState === "pending" && failures === 0) {
    state = "degraded";
  } else {
    state = "failed";
  }
  return {
    sourceId: input.sourceId,
    institutionId: input.institutionId,
    state,
    rawState,
    cadence: input.cadence ?? null,
    freshnessBudgetMs,
    freshUntilAt: failureAgeMs === null ? null : new Date(lastSuccessMs! + freshnessBudgetMs).toISOString(),
    coverageCurrent: fresh,
    lastSuccessAt: input.lastSuccessAt ?? null,
    lastAttemptedAt: input.lastAttemptedAt ?? null,
    nextRetryAt: input.nextAttemptAt ?? null,
    failureAgeMs,
    consecutiveFailures: failures,
    reason: input.lastError ?? null,
  };
}

/**
 * Join configured leadership coverage to durable runtime scheduler state. A
 * configured source is not considered healthy until it has a recent successful
 * or unchanged observation; missing runtime state is explicitly degraded.
 */
export function buildRuntimeLeadershipCoverage(
  configured: readonly RuntimeLeadershipInstitutionInput[],
  sources: readonly RuntimeLeadershipSourceInput[],
  now = new Date(),
): RuntimeLeadershipCoverage[] {
  const bySource = new Map(sources.map((source) => [source.sourceId, source]));
  const nowMs = now.getTime();
  return configured.map((institution) => {
    const sourceStates = institution.sourceIds.map((sourceId) => sourceStatus(
      (bySource.get(sourceId)?.institutionId === institution.institutionId ? bySource.get(sourceId) : undefined) ?? {
        sourceId,
        institutionId: institution.institutionId,
        state: "pending",
        consecutiveFailures: 0,
      },
      nowMs,
    ));
    const healthySourceIds = sourceStates.filter((source) => source.state === "healthy").map((source) => source.sourceId);
    const freshSourceIds = sourceStates
      .filter((source) => source.coverageCurrent)
      .map((source) => source.sourceId);
    const allBackoff = sourceStates.length > 0 && sourceStates.every((source) => source.state === "backoff");
    const anyBlocked = sourceStates.some((source) => source.state === "blocked");
    const state: Exclude<OperationalConditionState, "resolved"> = sourceStates.length === 0
      ? "degraded"
      : healthySourceIds.length > 0
        ? (healthySourceIds.length === sourceStates.length ? "healthy" : "degraded")
        : anyBlocked
          ? "blocked"
          : allBackoff
            ? "backoff"
            : "failed";
    const successTimestamps = sourceStates
      .map((source) => ({ value: source.lastSuccessAt, timestamp: finiteTimestamp(source.lastSuccessAt) }))
      .filter((source): source is { value: string; timestamp: number } => source.timestamp !== undefined && source.timestamp <= nowMs)
      .sort((a, b) => b.timestamp - a.timestamp);
    const latestSuccess = successTimestamps[0];
    const coverageLost = freshSourceIds.length === 0;
    const expiryTimestamps = sourceStates
      .map((source) => ({ value: source.freshUntilAt, timestamp: finiteTimestamp(source.freshUntilAt) }))
      .filter((source): source is { value: string; timestamp: number } => source.timestamp !== undefined)
      .sort((a, b) => b.timestamp - a.timestamp);
    const coverageLossReason = !coverageLost
      ? null
      : latestSuccess
        ? "expired" as const
        : sourceStates.some((source) => source.lastSuccessAt)
          ? "invalid-success-time" as const
          : "never-observed" as const;
    const retryTimestamps = sourceStates
      .map((source) => ({ value: source.nextRetryAt, timestamp: finiteTimestamp(source.nextRetryAt) }))
      .filter((source): source is { value: string; timestamp: number } => source.timestamp !== undefined && source.timestamp > nowMs)
      .sort((a, b) => a.timestamp - b.timestamp);
    return {
      institutionId: institution.institutionId,
      shortName: institution.shortName,
      configuredStatus: institution.configuredStatus,
      state,
      // A blocked/backoff source can still provide current coverage until its
      // last successful observation ages past the freshness SLO. Alerting
      // should distinguish that degraded condition from actual coverage loss.
      coverageLost,
      freshUntilAt: expiryTimestamps[0]?.value ?? null,
      coverageLossReason,
      sourceIds: [...institution.sourceIds],
      healthySourceIds,
      lastSuccessAt: latestSuccess?.value ?? null,
      failureAgeMs: latestSuccess ? Math.max(0, nowMs - latestSuccess.timestamp) : null,
      nextRetryAt: retryTimestamps[0]?.value ?? null,
      sourceStates,
    };
  });
}
