import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { WatchKind } from "../../content/watch-query";
import { WatchId } from "../../content/watch-schema";

export const WATCH_SAVES_KEY = "valley-desk:watch-saves:v1";
export const WATCH_SAVE_LIMIT = 500;
const SavedRecord = z.object({ kind: z.enum(["policy", "technology"]), id: WatchId }).strict();
const SavedRecords = z.object({ version: z.literal("watch-saves-1"), items: z.array(SavedRecord).max(WATCH_SAVE_LIMIT) }).strict();
export type WatchSavedRecord = z.infer<typeof SavedRecord>;
type SaveSnapshot = { items: readonly WatchSavedRecord[]; sessionOnly: boolean; message: string | null };
type SaveStorage = Pick<Storage, "getItem" | "setItem">;
const EMPTY: SaveSnapshot = { items: [], sessionOnly: false, message: null };

export function parseWatchSaves(raw: string | null): WatchSavedRecord[] {
  if (!raw || raw.length > 160_000) return [];
  try {
    const parsed = SavedRecords.safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    const unique = new Map(parsed.data.items.map(item => [`${item.kind}:${item.id}`, item]));
    return [...unique.values()];
  } catch { return []; }
}

/** Storage holds only stable IDs, never downloaded facts, evidence, or personal data. */
export function createWatchSaveStore(storage?: SaveStorage) {
  let snapshot: SaveSnapshot = { ...EMPTY, sessionOnly: !storage };
  if (storage) {
    try { snapshot = { ...snapshot, items: parseWatchSaves(storage.getItem(WATCH_SAVES_KEY)) }; }
    catch { snapshot = { ...snapshot, sessionOnly: true }; }
  }
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    receive: (raw: string | null) => {
      if (snapshot.sessionOnly) return;
      snapshot = { items: parseWatchSaves(raw), sessionOnly: false, message: null };
      notify();
    },
    setSaved: (kind: WatchKind, id: string, saved: boolean) => {
      SavedRecord.parse({ kind, id });
      const items = snapshot.items.filter(item => item.kind !== kind || item.id !== id);
      if (saved && items.length >= WATCH_SAVE_LIMIT) {
        snapshot = { ...snapshot, message: `The ${WATCH_SAVE_LIMIT}-record save limit has been reached.` };
        notify(); return;
      }
      if (saved) items.push({ kind, id });
      let sessionOnly = snapshot.sessionOnly;
      if (storage && !sessionOnly) {
        try { storage.setItem(WATCH_SAVES_KEY, JSON.stringify({ version: "watch-saves-1", items })); }
        catch { sessionOnly = true; }
      }
      snapshot = { items, sessionOnly, message: sessionOnly ? "Saved preferences are available for this visit only." : null };
      notify();
    },
  };
}

let browserStore: ReturnType<typeof createWatchSaveStore> | undefined;
const serverStore = createWatchSaveStore();
function getStore() {
  if (typeof window === "undefined") return serverStore;
  if (!browserStore) {
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* Memory-only preferences remain usable. */ }
    browserStore = createWatchSaveStore(storage);
    window.addEventListener("storage", event => {
      if (event.storageArea === storage && (event.key === WATCH_SAVES_KEY || event.key === null)) browserStore?.receive(event.newValue);
    });
  }
  return browserStore;
}

export function useWatchSaves() {
  const store = getStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY);
  return { ...snapshot, setSaved: store.setSaved };
}
