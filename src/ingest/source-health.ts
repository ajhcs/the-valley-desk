export type SourceRunState = "success" | "error";

export type SourceRunNote = {
  id: string;
  origin: string;
  type: "rss" | "events" | "social";
  state: SourceRunState;
  checkedAt: string;
  itemCount: number;
  /** True only when a successful response represents the source's complete active set. */
  complete: boolean;
  url?: string;
  error?: string;
};

export type IngestSourceResult<T> = {
  items: T[];
  sources: SourceRunNote[];
};
