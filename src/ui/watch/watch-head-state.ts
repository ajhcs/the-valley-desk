import type { WatchReadData, WatchReadErrorCode } from "../../content/watch-response";
import { watchErrorStatus, watchPageHead, type WatchPageHead, type WatchPageRoute } from "../../lib/watch-page";

type RequestToken = { route: WatchPageRoute };
type Snapshot = { key: string; head: WatchPageHead } | null;

/** Advisory metadata only. A token prevents stale requests or cleanup from replacing a newer route. */
export function createWatchHeadStore() {
  let active: RequestToken | null = null;
  let snapshot: Snapshot = null;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    getServerSnapshot: (): Snapshot => null,
    begin(route: WatchPageRoute): RequestToken {
      const token = { route };
      active = token;
      snapshot = { key: route.key, head: watchPageHead({ route, status: route.status }) };
      emit();
      return token;
    },
    ready(token: RequestToken, data: WatchReadData) {
      if (active !== token) return;
      snapshot = { key: token.route.key, head: watchPageHead({ route: token.route, status: 200, data }) };
      emit();
    },
    error(token: RequestToken, error: WatchReadErrorCode) {
      if (active !== token) return;
      snapshot = { key: token.route.key, head: watchPageHead({ route: token.route, status: watchErrorStatus(error), error }) };
      emit();
    },
    clear(token: RequestToken) {
      if (active !== token) return;
      active = null; snapshot = null; emit();
    },
  };
}

export const watchHeadStore = createWatchHeadStore();
