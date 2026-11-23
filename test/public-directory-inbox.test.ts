import assert from "node:assert/strict";
import test from "node:test";
import { handleReaderInbox, isInboxPath } from "../src/ingest/public-directory-inbox";

const origin = "https://thevalleydesk.org";

function fakeDb() {
  const rows: unknown[][] = [];
  return {
    rows,
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() { if (sql.startsWith("INSERT")) rows.push(values); return {}; },
            async first<T>() { return { n: rows.length } as T; },
          };
        },
      };
    },
  };
}

const post = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request(origin + path, {
    method: "POST",
    body: new URLSearchParams(fields),
    headers: { origin, "content-type": "application/x-www-form-urlencoded", ...headers },
  });

test("suggestions and page feedback are stored privately and answered without echoing input", async () => {
  assert.ok(isInboxPath("/discover/suggest/") && isInboxPath("/discover/feedback"));
  const db = fakeDb();
  const env = { VALLEY_DESK_DB: db };

  const suggestion = await handleReaderInbox(post("/discover/suggest", { item_type: "dataset", url: "https://data.example.org/x", connection: "Drexel" }), env, origin);
  assert.equal(suggestion.status, 303);
  assert.equal(suggestion.headers.get("location"), "/discover/suggest?sent=suggestion#suggest");
  assert.deepEqual(db.rows[0].slice(0, 1), ["suggestion"]);
  assert.equal(db.rows[0][4], "dataset");
  assert.equal(db.rows[0][5], "https://data.example.org/x");

  const rating = await handleReaderInbox(post("/discover/feedback", { page: "/discover/work/1", rating: "not-useful" }, { accept: "application/json" }), env, origin);
  assert.equal(rating.status, 200);
  assert.deepEqual(await rating.json(), { ok: true });
  assert.equal(db.rows[1][2], "/discover/work/1");
  assert.equal(db.rows[1][3], "not-useful");

  // Off-site page values, unsafe links, cross-site posts and the trap field never store a row.
  await handleReaderInbox(post("/discover/feedback", { page: "//evil.example", message: "hi" }), env, origin);
  assert.equal(db.rows[2][2], null);
  const unsafe = await handleReaderInbox(post("/discover/suggest", { url: "javascript:alert(1)" }), env, origin);
  assert.equal(unsafe.headers.get("location"), "/discover/suggest?sent=error#suggest");
  const foreign = await handleReaderInbox(post("/discover/feedback", { rating: "useful" }, { origin: "https://evil.example", accept: "application/json" }), env, origin);
  assert.equal(foreign.status, 403);
  const trapped = await handleReaderInbox(post("/discover/feedback", { rating: "useful", website: "x" }, { accept: "application/json" }), env, origin);
  assert.equal(trapped.status, 200);
  assert.equal(db.rows.length, 3);

  const limited = await handleReaderInbox(post("/discover/feedback", { rating: "useful" }, { accept: "application/json" }), {
    VALLEY_DESK_DB: db, READER_RATE_LIMITER: { limit: async () => ({ success: false }) },
  }, origin);
  assert.equal(limited.status, 429);

  const page = await handleReaderInbox(new Request(origin + "/discover/suggest?sent=suggestion"), env, origin);
  const body = await page.text();
  assert.match(body, /Thank you\. We will review your suggestion\./);
  assert.match(body, /<meta name="robots" content="noindex, follow">/);
  assert.equal(page.headers.get("cache-control"), "no-store");
});
