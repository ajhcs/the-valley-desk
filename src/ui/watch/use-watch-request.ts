import { useEffect, useState } from "react";
import type { WatchKind } from "../../content/watch-query";
import { readWatch, WatchReadError, type WatchReadData } from "./watch-api";

type RequestState = { key: string } & (
  { phase: "loading" } | { phase: "ready"; data: WatchReadData } | { phase: "error"; error: WatchReadError }
);

export function useWatchRequest(url: string | null, kind: WatchKind, slug?: string) {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([url, kind, slug, attempt]);
  const [state, setState] = useState<RequestState>({ key: "", phase: "loading" });
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let disposed = false;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    void readWatch(url, kind, controller.signal, slug).then(data => {
      if (!disposed) setState({ key, phase: "ready", data });
    }).catch(error => {
      if (!disposed) setState({ key, phase: "error", error: controller.signal.aborted ? new WatchReadError("timeout") :
        error instanceof WatchReadError ? error : new WatchReadError("network") });
    }).finally(() => window.clearTimeout(timeout));
    return () => { disposed = true; controller.abort(); window.clearTimeout(timeout); };
  }, [url, kind, slug, key]);
  // Never show a previous page's facts while a different URL or retry is pending.
  return { state: state.key === key ? state : { key, phase: "loading" as const }, retry: () => setAttempt(value => value + 1) };
}
