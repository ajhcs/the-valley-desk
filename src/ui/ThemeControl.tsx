import * as React from "react";

type ThemePreference = "system" | "light" | "dark";
type ThemeSnapshot = { preference: ThemePreference; theme: "light" | "dark"; sessionOnly: boolean };
type ThemeStore = { getSnapshot: () => ThemeSnapshot; subscribe: (listener: () => void) => () => void;
  setPreference: (preference: ThemePreference) => void };
declare global { interface Window { __VALLEY_DESK_THEME__?: ThemeStore } }
const fallback: ThemeSnapshot = { preference: "system", theme: "light", sessionOnly: true };
const unavailable: ThemeStore = { getSnapshot: () => fallback, subscribe: () => () => {}, setPreference: () => {} };

export function ThemeControl() {
  const store = typeof window === "undefined" ? unavailable : window.__VALLEY_DESK_THEME__ ?? unavailable;
  const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot, () => fallback);
  return <div className="ThemeControl desk-theme">
    <label htmlFor="site-theme">Theme</label>
    <select id="site-theme" value={snapshot.preference}
      aria-describedby={snapshot.sessionOnly ? "theme-storage-status" : undefined}
      onChange={event => store.setPreference(event.target.value as ThemePreference)}>
      <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
    </select>
    {snapshot.sessionOnly ? <span id="theme-storage-status" className="ThemeStorageStatus" role="status">
      Theme preference applies to this visit only.
    </span> : null}
  </div>;
}
