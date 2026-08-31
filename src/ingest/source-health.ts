export const SOURCE_RUN_STATES = [
  "healthy",
  "healthy-empty",
  "disabled",
  "misconfigured",
  "auth-failed",
  "upstream-blocked",
  "backoff",
  "rate-limited",
  "upstream-failed",
  "parser-failed",
  "timed-out",
] as const;

export type SourceRunState = (typeof SOURCE_RUN_STATES)[number];

export type PersistedSourceHealth = {
  sourceId: string;
  state: SourceRunState;
  itemCount: number;
  complete: boolean;
  completeness?: SnapshotCompleteness;
  consecutiveFailures: number;
  lastCheckedAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  nextAttemptAt: string;
  lastHttpStatus: number | null;
  requiresAuth: boolean;
  lastFallbackUrl?: string | null;
};

export const SOURCE_HEALTHY_REFRESH_MS = 15 * 60 * 1_000;
export const SOURCE_RETRY_DELAYS_MS = [
  15 * 60 * 1_000,
  60 * 60 * 1_000,
  6 * 60 * 60 * 1_000,
  24 * 60 * 60 * 1_000,
] as const;

/** Snapshot trust for disappearance reconciliation. Empty and shape-changed feeds are never complete. */
export type SnapshotCompleteness = "complete" | "partial" | "empty-unverified";

export type SourceRunNote = {
  id: string;
  origin: string;
  type: "rss" | "events" | "social";
  state: SourceRunState;
  checkedAt: string;
  itemCount: number;
  /** True only when a successful response represents the source's complete active set. */
  complete: boolean;
  /** Explicit snapshot trust. Prefer this over inferring from `complete` + `itemCount`. */
  completeness?: SnapshotCompleteness;
  url?: string;
  error?: string;
  /** True only when the source was explicitly configured to require credentials. */
  requiresAuth?: boolean;
  /** HTTP status supplied by the upstream, when a response was received. */
  httpStatus?: number;
  /** Durable cooldown returned by the source scheduler, when applicable. */
  nextAttemptAt?: string;
  /** URL that served the successful snapshot when a fallback was used. */
  fallbackUrl?: string;
  /** Durable streak metadata copied into operational results when available. */
  consecutiveFailures?: number;
  lastSuccessAt?: string | null;
};

export type IngestSourceResult<T> = {
  items: T[];
  sources: SourceRunNote[];
};

export function isSuccessfulSourceState(state: SourceRunState) {
  return state === "healthy" || state === "healthy-empty";
}

export function isFailureSourceState(state: SourceRunState) {
  return state === "auth-failed"
    || state === "upstream-blocked"
    || state === "rate-limited"
    || state === "upstream-failed"
    || state === "parser-failed"
    || state === "timed-out";
}

export function sourceRetryDelayMs(consecutiveFailures: number) {
  const index = Math.max(0, Math.min(SOURCE_RETRY_DELAYS_MS.length - 1, Math.trunc(consecutiveFailures) - 1));
  return SOURCE_RETRY_DELAYS_MS[index] ?? SOURCE_RETRY_DELAYS_MS[0];
}

export function sourceNextAttemptAt(
  state: SourceRunState,
  checkedAt: string,
  consecutiveFailures: number,
  explicit?: string,
) {
  if (explicit) return explicit;
  const timestamp = Date.parse(checkedAt);
  if (!Number.isFinite(timestamp)) return checkedAt;
  const delay = (isFailureSourceState(state) || state === "backoff")
    ? sourceRetryDelayMs(consecutiveFailures)
    : SOURCE_HEALTHY_REFRESH_MS;
  return new Date(timestamp + delay).toISOString();
}

export function sourceIsInBackoff(
  state: Pick<PersistedSourceHealth, "state" | "nextAttemptAt"> | undefined,
  now: Date,
) {
  if (!state || (!isFailureSourceState(state.state) && state.state !== "backoff")) return false;
  const next = Date.parse(state.nextAttemptAt);
  return Number.isFinite(next) && next > now.getTime();
}

export function sourceBackoffNote(
  id: string,
  origin: string,
  type: SourceRunNote["type"],
  checkedAt: string,
  prior?: PersistedSourceHealth,
  url?: string,
): SourceRunNote {
  return sourceNote({
    id,
    origin,
    type,
    state: "backoff",
    checkedAt,
    itemCount: prior?.itemCount ?? 0,
    complete: prior?.complete ?? false,
    ...(prior?.completeness ? { completeness: prior.completeness } : {}),
    ...(url ? { url } : {}),
    error: prior?.lastError ?? "Source is in retry backoff",
    nextAttemptAt: prior?.nextAttemptAt,
    httpStatus: prior?.lastHttpStatus ?? undefined,
    requiresAuth: prior?.requiresAuth,
    ...(prior?.lastFallbackUrl ? { fallbackUrl: prior.lastFallbackUrl } : {}),
    consecutiveFailures: prior?.consecutiveFailures ?? 0,
    lastSuccessAt: prior?.lastSuccessAt ?? null,
  });
}

export function sourceStateForItemCount(count: number): Extract<SourceRunState, "healthy" | "healthy-empty"> {
  return count > 0 ? "healthy" : "healthy-empty";
}

export function classifyHttpStatus(status: number, options: { requiresAuth?: boolean } = {}): SourceRunState {
  if (status === 401 || status === 403) return options.requiresAuth ? "auth-failed" : "upstream-blocked";
  if (status === 429) return "rate-limited";
  if (status === 408) return "timed-out";
  return "upstream-failed";
}

export function classifyFetchError(error: unknown): SourceRunState {
  if (error instanceof Error && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && (SOURCE_RUN_STATES as readonly string[]).includes(code)) {
      return code as SourceRunState;
    }
  }
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "TimeoutError" || name === "AbortError" || /timeout|timed out|aborted/i.test(message)) {
    return "timed-out";
  }
  return "upstream-failed";
}

export function sourceNote(
  partial: Omit<SourceRunNote, "complete" | "itemCount"> & Partial<Pick<SourceRunNote, "complete" | "itemCount">>,
): SourceRunNote {
  return {
    complete: false,
    itemCount: 0,
    ...partial,
  };
}

export function snapshotCompleteness(source: SourceRunNote): SnapshotCompleteness {
  if (isSuccessfulSourceState(source.state) && source.itemCount <= 0) return "empty-unverified";
  if (source.completeness) return source.completeness;
  if (!isSuccessfulSourceState(source.state)) return "partial";
  return source.complete ? "complete" : "partial";
}

/** Empty, failed, shape-changed, and partial snapshots never authorize disappearance. */
export function sourceAuthorizesDisappearance(source: SourceRunNote): boolean {
  return source.type === "events"
    && isSuccessfulSourceState(source.state)
    && snapshotCompleteness(source) === "complete"
    && source.itemCount > 0;
}
