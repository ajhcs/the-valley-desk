import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { FOLD_REST } from "../src/ui/FoldMark.tsx";
import {
  FOLD_SESSION_KEY,
  persistSessionFold,
  resetFoldSessionForTests,
  shouldPlaySessionFold,
} from "../src/ui/sessionMotion.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("production fold preserves locked geometry and the compact stacked wordmark", () => {
  const svg = read("public/mark-a-fold.svg");
  const layout = read("src/ui/Layout.tsx");
  for (const points of Object.values(FOLD_REST)) assert.ok(svg.includes(`points="${points}"`));
  assert.ok(layout.includes("<FoldMark"));
  assert.ok(layout.includes("Wordmark-kicker"));
  assert.ok(layout.includes("Wordmark-name"));
  assert.ok(layout.includes(">The<"));
  assert.ok(layout.includes(">Valley Desk<"));
});

test("fold plays once per session for 700–900ms and honors reduced motion", () => {
  const css = read("src/styles/home.css");
  const fold = read("src/ui/FoldMark.tsx");
  const duration = css.match(/--fold-ms:\s*(\d+)ms/);
  assert.ok(duration);
  assert.ok(Number(duration[1]) >= 700 && Number(duration[1]) <= 900);
  assert.ok(css.includes("animation: fold-open-plane var(--fold-ms) var(--ease-out) 1 both"));
  assert.ok(css.includes("@media (prefers-reduced-motion: reduce)"));
  assert.ok(!css.includes("crease-sheen"));
  assert.ok(!css.includes("fold-glow"));
  assert.ok(!fold.includes("requestAnimationFrame"));

  resetFoldSessionForTests();
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  assert.equal(shouldPlaySessionFold({ reduced: true, storage }), false);
  assert.equal(shouldPlaySessionFold({ reduced: false, storage }), true);
  persistSessionFold({ storage });
  assert.equal(values.get(FOLD_SESSION_KEY), "1");
  assert.equal(shouldPlaySessionFold({ reduced: false, storage }), false);
});

test("unfinished Valley font files remain outside the production bundle", () => {
  const html = read("index.html");
  const tokens = read("src/styles/tokens.css");
  assert.ok(html.includes("IBM+Plex+Sans"));
  assert.ok(html.includes("0,700"));
  assert.ok(tokens.includes('"IBM Plex Sans"'));
  assert.ok(tokens.includes('"IBM Plex Serif"'));
  assert.ok(!html.includes("Valley Sans"));
  assert.ok(!tokens.includes("Valley Sans"));
});
