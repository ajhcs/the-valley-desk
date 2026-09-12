import { MAX_WATCH_UPDATES_BYTES, parseWatchUpdates } from "../../content/watch-updates";
import { watchQuerySearch, type WatchKind, type WatchQueryValues } from "../../content/watch-query";
import { WatchReadError } from "./watch-api";
export function watchUpdatesApiPath(kind: WatchKind, values: WatchQueryValues) {
  const params = new URLSearchParams(watchQuerySearch(values, kind, values.cursor));
  return "/api/v2/watch/" + kind + "/updates" + (params.size ? "?" + params.toString() : "");
}
export async function readWatchUpdates(kind: WatchKind, values: WatchQueryValues, signal: AbortSignal,
  fetcher: typeof fetch = fetch) {
  let response: Response;
  try { response = await fetcher(watchUpdatesApiPath(kind, values), { signal, method: "GET", credentials: "omit",
    cache: "no-store", redirect: "error", headers: { Accept: "application/json" } }); }
  catch { throw new WatchReadError("network"); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new WatchReadError(response.status === 410 ? "cursor-expired" : response.status === 400 ? "invalid-query" :
      response.status === 409 ? "held" : "unavailable");
  }
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "") ||
      Number(response.headers.get("content-length")) > MAX_WATCH_UPDATES_BYTES) {
    await response.body?.cancel().catch(() => undefined); throw new WatchReadError("invalid-response");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new WatchReadError("invalid-response");
  let text = "", size = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_WATCH_UPDATES_BYTES) throw new Error("response-size");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { response: parseWatchUpdates(JSON.parse(text), kind), stale: response.headers.get("X-Watch-Data-State") === "stale" };
  } catch { await reader.cancel().catch(() => undefined); throw new WatchReadError("invalid-response"); }
  finally { reader.releaseLock(); }
}

