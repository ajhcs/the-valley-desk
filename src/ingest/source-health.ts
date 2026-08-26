export type SourceRunState = "success" | "error";

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

export function snapshotCompleteness(source: SourceRunNote): SnapshotCompleteness {
  if (source.state === "success" && source.itemCount <= 0) return "empty-unverified";
  if (source.completeness) return source.completeness;
  if (source.state !== "success") return "partial";
  return source.complete ? "complete" : "partial";
}

/** HTTP 200 with zero rows, parser-shape changes, and partial windows must not withdraw live events. */
export function sourceAuthorizesDisappearance(source: SourceRunNote): boolean {
  return source.type === "events"
    && source.state === "success"
    && snapshotCompleteness(source) === "complete"
    && source.itemCount > 0;
}
