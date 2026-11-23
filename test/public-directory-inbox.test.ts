import assert from "node:assert/strict";
import test from "node:test";
import { handleReaderInbox, isInboxPath } from "../src/ingest/public-directory-inbox";
import { directoryNotificationPath } from "../src/ingest/directory-notifications";
import { OPS_ALERT_RECIPIENT, OPS_ALERT_SENDER, type SendEmailBindingLike } from "../src/lib/alerts";
import worker from "../worker.js";

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

test("directory notifications require the dedicated token and send only through the fixed ops binding", async () => {
  const credential = "a".repeat(64);
  const sent: Parameters<SendEmailBindingLike["send"]>[0][] = [];
  const env = {
    DIRECTORY_NOTIFICATION_TOKEN: credential,
    NOTIFY_OPS: { async send(message: typeof sent[number]) { sent.push(message); return {}; } },
  };
  const send = (note: object, auth = credential, settings = env) => worker.fetch(new Request(origin + directoryNotificationPath, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + auth },
    body: JSON.stringify(note),
  }), settings, {});
  assert.equal((await send({ kind: "test" }, "b".repeat(64))).status, 404);
  assert.equal((await send({ kind: "test" }, credential, { ...env, DIRECTORY_NOTIFICATION_TOKEN: "" })).status, 404);
  assert.equal((await worker.fetch(new Request(origin + directoryNotificationPath), env, {})).status, 404);
  assert.equal((await send({ kind: "failed", text: "Daily update failed", to: "other@example.invalid" })).status, 400);
  assert.equal((await send({ kind: "failed", text: "x".repeat(4200) })).status, 413);
  assert.equal(sent.length, 0);

  const okay = await send({ kind: "stopped", text: "Project count exceeded the limit." });
  assert.equal(okay.status, 204);
  assert.equal(okay.headers.get("cache-control"), "no-store");
  assert.deepEqual(sent[0], {
    to: OPS_ALERT_RECIPIENT, from: OPS_ALERT_SENDER,
    subject: "[The Valley Desk] directory run stopped", text: "Project count exceeded the limit.",
  });
  const failingBinding = { ...env, NOTIFY_OPS: { async send() { throw new Error("synthetic provider failure"); } } };
  assert.equal((await send({ kind: "test" }, credential, failingBinding)).status, 502);
});
