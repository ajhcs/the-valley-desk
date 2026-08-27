import { useState } from "react";

const KEY = "vd-home-session-motion";

export const FOLD_SESSION_KEY = "vd-fold-mark-session";

type FoldStore = Pick<Storage, "getItem" | "setItem">;

let foldPlayedWithoutStorage = false;

export function resetFoldSessionForTests() {
  foldPlayedWithoutStorage = false;
}

export function shouldPlaySessionFold(options?: {
  reduced?: boolean;
  storage?: FoldStore | null;
}): boolean {
  const reduced =
    options?.reduced ??
    (typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (reduced) return false;

  const storage =
    options && "storage" in options
      ? options.storage
      : typeof window === "undefined"
        ? null
        : window.sessionStorage;

  if (!storage) return !foldPlayedWithoutStorage && typeof window !== "undefined";
  try {
    return storage.getItem(FOLD_SESSION_KEY) !== "1";
  } catch {
    return !foldPlayedWithoutStorage;
  }
}

export function persistSessionFold(options?: { storage?: FoldStore | null }): void {
  const storage =
    options && "storage" in options
      ? options.storage
      : typeof window === "undefined"
        ? null
        : window.sessionStorage;

  if (!storage) {
    foldPlayedWithoutStorage = true;
    return;
  }
  try {
    storage.setItem(FOLD_SESSION_KEY, "1");
  } catch {
    foldPlayedWithoutStorage = true;
  }
}

/** Session-first homepage motion. Do not restagger on client nav back to /. */
export function useSessionFirstHome() {
  const [play] = useState(() => {
    if (typeof sessionStorage === "undefined") return false;
    try {
      if (sessionStorage.getItem(KEY)) return false;
      sessionStorage.setItem(KEY, "1");
      return true;
    } catch {
      return false;
    }
  });
  return play;
}
