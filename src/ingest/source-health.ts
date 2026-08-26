export const SOURCE_RUN_STATES = [
  "healthy",
  "healthy-empty",
  "disabled",
  "misconfigured",
  "auth-failed",
  "rate-limited",
  "upstream-failed",
  "parser-failed",
  "timed-out",
] as const;

export type SourceRunState = (typeof SOURCE_RUN_STATES)[number];

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
    || state === "rate-limited"
    || state === "upstream-failed"
    || state === "parser-failed"
    || state === "timed-out";
}

export function sourceStateForItemCount(count: number): Extract<SourceRunState, "healthy" | "healthy-empty"> {
  return count > 0 ? "healthy" : "healthy-empty";
}

export function classifyHttpStatus(status: number): SourceRunState {
  if (status === 401 || status === 403) return "auth-failed";
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
