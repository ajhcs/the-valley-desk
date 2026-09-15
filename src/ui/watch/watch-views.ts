import { watchQuerySearch, type WatchKind, type WatchQueryValues } from "../../content/watch-query";
export type WatchView = "directory" | "latest" | "papers" | "representatives";
export function latestQuerySupported(values: WatchQueryValues) {
  return Object.keys(values).every(key => key === "cursor" || key === "limit");
}
export function watchView(kind: WatchKind, hash: string, values: WatchQueryValues): WatchView {
  if (hash.replace(/^#/, "") === "latest") return "latest";
  if (kind === "policy" && hash.replace(/^#/, "") === "representatives") return "representatives";
  return kind === "technology" && values.type === "paper" ? "papers" : "directory";
}
export function watchViewSearch(kind: WatchKind, view: WatchView, values: WatchQueryValues) {
  if (view === "representatives") return {};
  if (view === "latest") return watchQuerySearch(values.limit ? { limit: values.limit } : {}, kind);
  const next = { ...values };
  delete next.cursor;
  if (kind === "technology") {
    if (view === "papers") next.type = "paper";
    else if (next.type === "paper") delete next.type;
  }
  return watchQuerySearch(next, kind);
}
