export const OPERATIONAL_CONDITION_STATES = [
  "healthy",
  "degraded",
  "blocked",
  "backoff",
  "failed",
  "resolved",
] as const;

export type OperationalConditionState = (typeof OPERATIONAL_CONDITION_STATES)[number];

export const LEADERSHIP_FRESHNESS_SLO_MS = 2 * 60 * 60 * 1_000;

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
  sourceIds: string[];
  healthySourceIds: string[];
  lastSuccessAt: string | null;
  failureAgeMs: number | null;
  nextRetryAt: string | null;
  sourceStates: RuntimeLeadershipSourceStatus[];
};

function finiteTimestamp(value: string | null | undefined) {
  if (!value) return undefined;
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
  const fresh = lastSuccessMs !== undefined && nowMs - lastSuccessMs <= LEADERSHIP_FRESHNESS_SLO_MS;
  let state: Exclude<OperationalConditionState, "resolved">;
  if ((rawState === "healthy" || rawState === "unchanged") && fresh) {
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
    lastSuccessAt: input.lastSuccessAt ?? null,
    lastAttemptedAt: input.lastAttemptedAt ?? null,
    nextRetryAt: input.nextAttemptAt ?? null,
    failureAgeMs: lastSuccessMs === undefined ? null : Math.max(0, nowMs - lastSuccessMs),
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
      bySource.get(sourceId) ?? {
        sourceId,
        institutionId: institution.institutionId,
        state: "pending",
        consecutiveFailures: 0,
      },
      nowMs,
    ));
    const healthySourceIds = sourceStates.filter((source) => source.state === "healthy").map((source) => source.sourceId);
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
      .filter((source): source is { value: string; timestamp: number } => source.timestamp !== undefined)
      .sort((a, b) => b.timestamp - a.timestamp);
    const latestSuccess = successTimestamps[0];
    const retryTimestamps = sourceStates
      .map((source) => ({ value: source.nextRetryAt, timestamp: finiteTimestamp(source.nextRetryAt) }))
      .filter((source): source is { value: string; timestamp: number } => source.timestamp !== undefined && source.timestamp > nowMs)
      .sort((a, b) => a.timestamp - b.timestamp);
    return {
      institutionId: institution.institutionId,
      shortName: institution.shortName,
      configuredStatus: institution.configuredStatus,
      state,
      coverageLost: healthySourceIds.length === 0,
      sourceIds: [...institution.sourceIds],
      healthySourceIds,
      lastSuccessAt: latestSuccess?.value ?? null,
      failureAgeMs: latestSuccess ? Math.max(0, nowMs - latestSuccess.timestamp) : null,
      nextRetryAt: retryTimestamps[0]?.value ?? null,
      sourceStates,
    };
  });
}
