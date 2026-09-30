import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeControl } from "../src/ui/ThemeControl";

const script = readFileSync(new URL("../public/theme.js", import.meta.url), "utf8");
const key = "valley-desk:theme:v1";
function boot(options: { saved?: string; dark?: boolean; denied?: boolean; writeDenied?: boolean;
  noMedia?: boolean; noEvents?: boolean; values?: Map<string, string> } = {}) {
  const values = options.values ?? new Map(options.saved ? [[key, options.saved]] : []);
  const storage = { getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => { if (options.writeDenied) throw Error("denied"); values.set(name, value); } };
  let mediaChange = () => {};
  let storageChange = (_event: object) => {};
  const media = { matches: options.dark ?? false, addEventListener: (_type: string, listener: () => void) => { mediaChange = listener; } };
  const root = { dataset: {} as { theme: string }, style: { colorScheme: "" } };
  const window = {
    get localStorage() { if (options.denied) throw Error("denied"); return storage; },
    matchMedia: options.noMedia ? undefined : () => media,
    addEventListener: options.noEvents ? undefined : (_type: string, listener: (event: object) => void) => { storageChange = listener; },
    __VALLEY_DESK_THEME__: undefined as unknown as { getSnapshot: () => { preference: string; theme: string; sessionOnly: boolean };
      setPreference: (value: string) => void; subscribe: (listener: () => void) => () => void },
  };
  runInNewContext(script, { window, document: { documentElement: root }, Set, Error });
  return { store: window.__VALLEY_DESK_THEME__, values, storage, root,
    os: (dark: boolean) => { media.matches = dark; mediaChange(); },
    event: (event: object) => storageChange(event) };
}

test("head bootstrap resolves saved palette before application/styles load", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(html.indexOf('src="/theme.js"') < html.indexOf('src="/src/main.tsx"'));
  assert.ok(html.indexOf('src="/theme.js"') < html.indexOf('rel="stylesheet"'));
  const app = boot({ saved: "dark" });
  assert.equal(app.root.dataset.theme, "dark");
  assert.equal(app.root.style.colorScheme, "dark");
  assert.equal(app.store.getSnapshot().preference, "dark");
});
test("selection persists across reload and System follows OS changes; explicit mode overrides OS", () => {
  const app = boot({ dark: true });
  assert.equal(app.root.dataset.theme, "dark");
  app.os(false); assert.equal(app.root.dataset.theme, "light");
  app.store.setPreference("dark"); app.os(false); assert.equal(app.root.dataset.theme, "dark");
  const reload = boot({ values: app.values }); assert.equal(reload.root.dataset.theme, "dark");
  reload.store.setPreference("system"); reload.os(true); assert.equal(reload.root.dataset.theme, "dark");
  reload.os(false); assert.equal(reload.root.dataset.theme, "light");
  assert.equal(reload.values.get(key), "system");
});
test("cross-tab preference/clear events synchronize while unrelated storage is ignored", () => {
  const app = boot();
  app.event({ key, newValue: "dark", storageArea: app.storage });
  assert.equal(app.root.dataset.theme, "dark"); assert.equal(app.store.getSnapshot().preference, "dark");
  app.event({ key: "other", newValue: "light" }); assert.equal(app.root.dataset.theme, "dark");
  app.event({ key, newValue: "light", storageArea: {} }); assert.equal(app.root.dataset.theme, "dark");
  app.event({ key: null, newValue: null }); assert.equal(app.store.getSnapshot().preference, "system");
  app.event({ key, newValue: "invalid" }); assert.equal(app.store.getSnapshot().preference, "system");
});
test("blocked storage leaves a usable visit-only selection", () => {
  for (const options of [{ denied: true }, { writeDenied: true }]) {
    const app = boot(options);
    app.store.setPreference("dark");
    assert.equal(app.root.dataset.theme, "dark"); assert.equal(app.store.getSnapshot().sessionOnly, true);
    app.store.setPreference("system"); app.os(true); assert.equal(app.root.dataset.theme, "dark");
  }
});
test("missing media/storage event APIs and invalid saved values fail gracefully", () => {
  const app = boot({ noMedia: true, noEvents: true, saved: "invalid" });
  assert.equal(app.root.dataset.theme, "light"); assert.equal(app.store.getSnapshot().preference, "system");
  app.store.setPreference("dark"); assert.equal(app.root.dataset.theme, "dark");
});
test("subscriptions notify real changes and release cleanly", () => {
  const app = boot(); let notifications = 0;
  const original = app.store.getSnapshot(); const unsubscribe = app.store.subscribe(() => notifications++);
  app.os(false); assert.equal(app.store.getSnapshot(), original); assert.equal(notifications, 0);
  app.store.setPreference("dark"); assert.equal(notifications, 1);
  unsubscribe(); app.store.setPreference("light"); assert.equal(notifications, 1);
});

test("control exposes a native labeled select and explains visit-only persistence", () => {
  const html = renderToStaticMarkup(createElement(ThemeControl));
  assert.match(html, /<label for="site-theme">Theme<\/label>/);
  assert.match(html, /<select id="site-theme"/);
  for (const value of ["system", "light", "dark"]) assert.ok(html.includes(`value="${value}"`));
  assert.match(html, /aria-describedby="theme-storage-status"/);
  assert.match(html, /role="status"/);
});

test("semantic text, actions, status and field borders have accessible palette contrast", () => {
  const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
  const tokens = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)].map(match => [match[1], match[2]]));
  const light = tokens(css.split(':root[data-theme="dark"]')[0]);
  const dark = { ...light, ...tokens(css.split(':root[data-theme="dark"]')[1]) };
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const ratio = (a: string, b: string) => {
    const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (values[0] + .05) / (values[1] + .05);
  };
  for (const palette of [light, dark]) {
    for (const text of ["text", "mute", "ink", "admiral", "error-text", "warning-text", "event-text"])
      assert.ok(ratio(palette[text], palette.paper) >= 4.5, `${text} against paper`);
    assert.ok(ratio(palette.text, palette.surface) >= 4.5);
    assert.ok(ratio(palette.paper, palette.ink) >= 4.5, "filled action contrast");
    assert.ok(ratio(palette["on-event"], palette.event) >= 4.5, "event chip contrast");
    assert.ok(ratio(palette["field-border"], palette.paper) >= 3, "form boundary contrast");
  }
});
