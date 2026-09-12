import assert from "node:assert/strict";
import test from "node:test";
import { parseWatchUpdates } from "../src/content/watch-updates";
import { latestQuerySupported, watchView, watchViewSearch } from "../src/ui/watch/watch-views";
import { readWatchUpdates, watchUpdatesApiPath } from "../src/ui/watch/watch-updates-api";
import { WatchReadError } from "../src/ui/watch/watch-api";
const NOW = "2026-09-12T12:00:00.000Z";
const item = { id: "synthetic-update", subjectId: "synthetic-subject", subjectSlug: "synthetic-tool",
  subjectTitle: "Synthetic tool", title: "Synthetic tool v2", summary: null, type: "software-release",
  sourceOccurredAt: { precision: "day", value: "2026-09-10", timezone: null, timezoneReason: "Source gives a date only.", evidenceIds: ["source"] },
  sources: [{ id: "source", sourceId: "synthetic-official", label: "Synthetic source", url: "https://example.org/release",
    quote: null, locator: "Release date" }] };
const envelope = (items: unknown[] = [item]) => ({ version: "watch-updates-1", kind: "technology",
  generation: 1, asOf: NOW, items, nextCursor: null });
const error = (code: string) => (value: unknown) => value instanceof WatchReadError && value.code === code;
test("Watch views preserve actual resource typing and separate hash navigation from API filters", () => {
  assert.equal(watchView("technology", "", {}), "directory");
  assert.equal(watchView("technology", "", { type: "paper" }), "papers");
  assert.equal(watchView("technology", "latest", {}), "latest");
  assert.equal(watchView("policy", "#representatives", {}), "representatives");
  assert.equal(watchView("technology", "#representatives", {}), "directory");
  assert.deepEqual(watchViewSearch("technology", "papers", { cursor: "old-directory", organization: "chop", type: "software" }),
    { type: "paper", organization: "chop" });
  assert.deepEqual(watchViewSearch("technology", "latest", { cursor: "old", type: "paper", q: "tool", limit: "10" }), { limit: "10" });
  assert.equal(latestQuerySupported({ q: "tool" }), false);
  assert.equal(latestQuerySupported({ cursor: "opaque", limit: "10" }), true);
  assert.deepEqual(watchViewSearch("policy", "representatives", { jurisdiction: "PA", cursor: "old" }), {});
});
test("accepted updates preserve source date precision and reject invented or unbound dates", () => {
  const result = parseWatchUpdates(envelope(), "technology");
  assert.deepEqual(result.items[0]!.sourceOccurredAt, item.sourceOccurredAt);
  for (const sourceOccurredAt of [{ precision: "unknown", reason: "Discovery only" },
    { ...item.sourceOccurredAt, evidenceIds: ["missing"] }]) {
    assert.throws(() => parseWatchUpdates(envelope([{ ...item, sourceOccurredAt }]), "technology"));
  }
  for (const type of ["baseline", "indexing", "tag", "commit", "policy-action"]) {
    assert.throws(() => parseWatchUpdates(envelope([{ ...item, type }]), "technology"));
  }
});
test("updates reject wrong desk, duplicate identities, extra fields and unestablished snapshots", () => {
  assert.throws(() => parseWatchUpdates(envelope(), "policy"));
  assert.throws(() => parseWatchUpdates(envelope([item, item]), "technology"));
  assert.throws(() => parseWatchUpdates({ ...envelope(), reviewer: "untrusted" }, "technology"));
  assert.throws(() => parseWatchUpdates({ ...envelope(), generation: 0 }, "technology"));
  assert.throws(() => parseWatchUpdates({ ...envelope(), asOf: null }, "technology"));
  assert.deepEqual(parseWatchUpdates({ ...envelope([]), generation: 0, asOf: null }, "technology").items, []);
});
test("update transport uses bounded same-origin credential-free requests and exact pagination", async () => {
  assert.equal(watchUpdatesApiPath("technology", { cursor: "opaque+value", limit: "10" }),
    "/api/v2/watch/technology/updates?limit=10&cursor=opaque%2Bvalue");
  assert.throws(() => watchUpdatesApiPath("technology", { type: "paper" }), error("invalid-query"));
  let seen: RequestInit | undefined;
  const result = await readWatchUpdates("technology", {}, new AbortController().signal, async (url, init) => {
    assert.equal(url, "/api/v2/watch/technology/updates"); seen = init;
    return new Response(JSON.stringify(envelope()), { headers: { "content-type": "application/json", "X-Watch-Data-State": "stale" } });
  });
  assert.equal(result.stale, true); assert.equal(seen?.credentials, "omit"); assert.equal(seen?.redirect, "error"); assert.equal(seen?.cache, "no-store");
});
test("missing updates service is unavailable, not an empty result; malformed and oversized responses fail closed", async () => {
  for (const [status, code] of [[404, "unavailable"], [503, "unavailable"], [410, "cursor-expired"], [409, "held"], [400, "invalid-query"]] as const) {
    await assert.rejects(readWatchUpdates("technology", {}, new AbortController().signal,
      async () => new Response("", { status })), error(code));
  }
  for (const response of [
    new Response("<html>Not an API</html>", { headers: { "content-type": "text/html" } }),
    new Response("{}", { headers: { "content-type": "application/json" } }),
    new Response("{}", { headers: { "content-type": "application/json", "content-length": "1000001" } }),
    new Response(" ".repeat(1000001), { headers: { "content-type": "application/json" } }),
  ]) await assert.rejects(readWatchUpdates("technology", {}, new AbortController().signal, async () => response), error("invalid-response"));
});
