import type { PaHealthEntry } from "../../content/pa-source-freshness";
import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import type { WatchKind } from "../../content/watch-query";
import { parseWatchPageRoute } from "../../lib/watch-page";
import { readWatch, readPaHealth, WatchReadError, type WatchReadData } from "./watch-api";
import { watchHeadStore } from "./watch-head-state";

type RequestState = { key: string } & (
  { phase: "loading" } | { phase: "ready"; data: WatchReadData } | { phase: "error"; error: WatchReadError }
);

export function useWatchRequest(url: string | null, kind: WatchKind, slug?: string) {
  const pathname = useRouterState({ select: state => state.location.pathname });
  const search = useRouterState({ select: state => state.location.searchStr });
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([url, kind, slug, attempt, pathname, search]);
  const [health,setHealth]=useState<{key:string;entries:PaHealthEntry[]}>({key:"",entries:[]});
  const [state, setState] = useState<RequestState>({ key: "", phase: "loading" });
  useEffect(() => {
    const route = parseWatchPageRoute(pathname, search);
    if (!route) return;
    const token = watchHeadStore.begin(route);
    if (route.status !== 200) {
      const error = new WatchReadError(route.status === 404 ? "not-found" : "invalid-query");
      watchHeadStore.error(token, error.code);
      setState({ key, phase: "error", error });
      return () => watchHeadStore.clear(token);
    }
    if (!url) return () => watchHeadStore.clear(token);
    const controller = new AbortController();
    let disposed = false;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    void readWatch(url, kind, controller.signal, slug).then(data => {
      if (!disposed) {
        watchHeadStore.ready(token, data); setState({ key, phase: "ready", data });
        const items=data.response.version==='watch-directory-1'?data.response.items:[data.response.item];
        void readPaHealth(items,controller.signal).then(entries=>{if(!disposed)setHealth({key,entries});});
      }
    }).catch(error => {
      if (!disposed) {
        const failure = controller.signal.aborted ? new WatchReadError("timeout") :
          error instanceof WatchReadError ? error : new WatchReadError("network");
        watchHeadStore.error(token, failure.code);
        setState({ key, phase: "error", error: failure });
      }
    }).finally(() => window.clearTimeout(timeout));
    return () => { disposed = true; controller.abort(); window.clearTimeout(timeout); watchHeadStore.clear(token); };
  }, [url, kind, slug, key, pathname, search]);
  // Never show a previous page's facts while a different URL or retry is pending.
  return { health: health.key===key?health.entries:[], state: state.key === key ? state : { key, phase: "loading" as const }, retry: () => setAttempt(value => value + 1) };
}
