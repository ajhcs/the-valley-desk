import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ContentCatalog, EventItem } from "../src/content/schema.ts";
import { evaluateCandidate } from "../src/ingest/editor.ts";
import { DEFAULT_EDITOR_BASE_URL, DEFAULT_EDITOR_MODEL } from "../src/ingest/editor-model.ts";
import {
  EMAIL_MAX_RAW_BYTES,
  acceptedEmailRecipient,
  cleanupEmailDiscoveries,
  handleInboundEmail,
  keepHttpsDiscoveryUrl,
  parseEmailDiscovery,
} from "../src/ingest/email.ts";
import { persistEditorialDecisions, persistIngestRun, type D1DatabaseLike, type D1StatementLike } from "../src/ingest/persistence.ts";
import { runAutomation, runtimeFetch } from "../src/ingest/automation.ts";
import { configureReviewGuardsForTests, handleReviewApi } from "../src/ingest/review-api.ts";
import { feedXml, sitemapXml } from "../src/ingest/public-feed.ts";
import { toFeed } from "../src/ingest/feed-contract.ts";
import {
  DEFAULT_PUBLIC_ORIGIN,
  PREVIEW_ORIGIN,
  PRODUCTION_ORIGIN,
  canonicalUrl,
  llmsTxt,
  publicUrl,
  resolvePublicOrigin,
  robotsTxt,
} from "../src/lib/canonical.ts";
import { decorateHtml, primaryNoscript, routeJsonLd } from "../src/lib/crawler-html.ts";
import {
  SCHEMA_VERSION,
  applySecurityHeaders,
  asHeadResponse,
  buildShaFromEnv,
  canonicalHostRedirect,
  handlePublicHealth,
  hstsHeader,
  htmlCsp,
  logOps,
  publicHealth,
} from "../src/lib/ops.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = ContentCatalog.parse(JSON.parse(readFileSync(join(root, "fixtures/catalog.json"), "utf8")));

const base = {
  dek: "Dek",
  body: "Body",
  updatedAt: "2026-08-26T12:00:00.000Z",
  topics: ["events"],
  orgs: ["org-dvhimss"],
  region: "regional",
  authors: [{ name: "The Valley Desk" }],
};

class SqliteD1Statement implements D1StatementLike {
  private values: unknown[] = [];
  constructor(private readonly statement: StatementSync) {}
  bind(...values: unknown[]) {
    const bound = new SqliteD1Statement(this.statement);
    bound.values = values;
    return bound;
  }
  async first<T = unknown>() {
    return (this.statement.get(...this.values as never[]) as T | undefined) ?? null;
  }
  async run() {
    return this.statement.run(...this.values as never[]);
  }
  async all<T = unknown>() {
    return { results: this.statement.all(...this.values as never[]) as T[] };
  }
}

function sqliteD1(database: DatabaseSync): D1DatabaseLike {
  return {
    prepare(query: string) {
      return new SqliteD1Statement(database.prepare(query));
    },
    async batch(statements: D1StatementLike[]) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function applyMigrations(database: DatabaseSync) {
  for (const name of readdirSync(join(root, "migrations")).filter((file) => file.endsWith(".sql")).sort()) {
    database.exec(readFileSync(join(root, "migrations", name), "utf8"));
  }
}

test("PUBLIC_ORIGIN defaults to the live domain and rejects non-https values", () => {
  assert.equal(DEFAULT_PUBLIC_ORIGIN, PRODUCTION_ORIGIN);
  assert.equal(resolvePublicOrigin(undefined), DEFAULT_PUBLIC_ORIGIN);
  assert.equal(resolvePublicOrigin(""), DEFAULT_PUBLIC_ORIGIN);
  assert.equal(resolvePublicOrigin("http://thevalleydesk.org"), DEFAULT_PUBLIC_ORIGIN);
  assert.equal(resolvePublicOrigin("javascript:alert(1)"), DEFAULT_PUBLIC_ORIGIN);
  assert.equal(resolvePublicOrigin("https://thevalleydesk.org/"), PRODUCTION_ORIGIN);
  assert.equal(resolvePublicOrigin(PRODUCTION_ORIGIN), PRODUCTION_ORIGIN);
  assert.equal(publicUrl("/news"), `${DEFAULT_PUBLIC_ORIGIN}/news`);
  assert.equal(
    canonicalUrl({ kind: "news", slug: "penn-in-house-ai-scribe" }, DEFAULT_PUBLIC_ORIGIN),
    `${DEFAULT_PUBLIC_ORIGIN}/news/penn-in-house-ai-scribe`,
  );
});

test("generated machine documents advertise the canonical live domain", () => {
  const origin = DEFAULT_PUBLIC_ORIGIN;
  const feed = toFeed(catalog, "2026-08-26T12:00:00.000Z");
  const rss = feedXml(feed, origin);
  const sitemap = sitemapXml(feed, origin);
  const robots = robotsTxt(origin);
  const llms = llmsTxt(origin);
  for (const document of [rss, sitemap, robots, llms]) {
    assert.ok(document.includes(origin));
    assert.ok(document.includes("thevalleydesk.org"));
    assert.equal(/scrape|ingested from|rss adapter/i.test(document), false);
  }
  assert.ok(robots.includes(`Sitemap: ${origin}/sitemap.xml`));
  assert.ok(llms.includes(`${origin}/feed.json`));
});

test("www redirects permanently to the canonical apex without losing the request target", () => {
  const redirect = canonicalHostRedirect(
    new Request("https://www.thevalleydesk.org/news/example?from=www"),
    PRODUCTION_ORIGIN,
  );
  assert.equal(redirect?.status, 308);
  assert.equal(redirect?.headers.get("location"), "https://thevalleydesk.org/news/example?from=www");
  assert.equal(canonicalHostRedirect(new Request("https://thevalleydesk.org/news"), PRODUCTION_ORIGIN), undefined);
  assert.equal(canonicalHostRedirect(new Request("https://the-valley-desk.clyons.workers.dev/"), PRODUCTION_ORIGIN), undefined);
});

test("public health is unauthenticated and exposes only build/schema stamps", async () => {
  const env = { BUILD_SHA: "abc123def", PUBLIC_ORIGIN: DEFAULT_PUBLIC_ORIGIN };
  const get = await handlePublicHealth(new Request("https://preview.example/api/health"), env);
  assert.equal(get.status, 200);
  const body = await get.json() as { ok: boolean; schemaVersion: string; buildSha: string };
  assert.deepEqual(body, { ok: true, schemaVersion: SCHEMA_VERSION, buildSha: "abc123def" });
  assert.equal(Object.keys(body).sort().join(), "buildSha,ok,schemaVersion");
  const post = await handlePublicHealth(new Request("https://preview.example/api/health", { method: "POST" }), env);
  assert.equal(post.status, 405);
  const head = asHeadResponse(get);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(publicHealth({}).buildSha, "unknown");
  assert.equal(buildShaFromEnv({ CF_VERSION_METADATA: { id: "version-id" } }), "version-id");
});

test("protected automation status/review require the bearer token and constant-time comparison path", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const env = { VALLEY_DESK_DB: db, REVIEW_API_TOKEN: "ops-token", BUILD_SHA: "deadbeef" };
  const missing = await handleReviewApi(new Request(`${DEFAULT_PUBLIC_ORIGIN}/api/automation/status`), env);
  assert.equal(missing.status, 404);
  const wrong = await handleReviewApi(new Request(`${DEFAULT_PUBLIC_ORIGIN}/api/automation/status`, {
    headers: { authorization: "Bearer other-token" },
  }), env);
  assert.equal(wrong.status, 404);
  const status = await handleReviewApi(new Request(`${DEFAULT_PUBLIC_ORIGIN}/api/automation/status`, {
    headers: { authorization: "Bearer ops-token" },
  }), env);
  assert.equal(status.status, 200);
  const statusBody = await status.json() as { schemaVersion: string; buildSha: string; publicOrigin: string; review?: unknown };
  assert.equal(statusBody.schemaVersion, SCHEMA_VERSION);
  assert.equal(statusBody.buildSha, "deadbeef");
  assert.equal(statusBody.publicOrigin, DEFAULT_PUBLIC_ORIGIN);
  assert.equal(statusBody.review, undefined);
  const review = await handleReviewApi(new Request(`${DEFAULT_PUBLIC_ORIGIN}/api/automation/status/review`, {
    headers: { authorization: "Bearer ops-token" },
  }), env);
  const reviewBody = await review.json() as { review?: { items: unknown[] }; decisions?: unknown[] };
  assert.ok(Array.isArray(reviewBody.review?.items));
  assert.ok(Array.isArray(reviewBody.decisions));
  const patch = await handleReviewApi(new Request(`${DEFAULT_PUBLIC_ORIGIN}/api/automation/status`, {
    method: "PATCH",
    headers: { authorization: "Bearer ops-token" },
  }), env);
  assert.equal(patch.status, 405);
  database.close();
});

test("review mutations validate method/content-type, stay idempotent, and rate-limit", async () => {
  configureReviewGuardsForTests({ postLimit: 3 });
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const now = new Date("2026-08-26T12:00:00.000Z");
  const event = EventItem.parse({
    ...base,
    id: "evt-ops-review",
    slug: "ops-review",
    title: "Ops review event",
    kind: "event",
    status: "review",
    startsAt: "2026-10-20T16:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "DVHIMSS",
    registrationUrl: "https://web.cvent.com/event/ops-review",
    partner: "dvhimss",
    autoPublish: true,
    source: { kind: "ingest", origin: "dvhimss-events", url: "https://dvhimss.org/event/ops-review" },
  });
  await persistIngestRun(db, {
    fetchedAt: now.toISOString(),
    rss: [],
    events: [event],
    social: [],
    notes: { rss: 0, events: 1, linkedin: { count: 0 }, x: { count: 0 }, sources: [] },
  }, [{ item: event, enrichment: null }]);
  await persistEditorialDecisions(
    db,
    [{ item: event, enrichment: null, decision: evaluateCandidate(event, null, now) }],
    DEFAULT_EDITOR_MODEL,
    DEFAULT_EDITOR_BASE_URL,
    now,
  );
  const env = { VALLEY_DESK_DB: db, REVIEW_API_TOKEN: "ops-token" };
  const headers = {
    authorization: "Bearer ops-token",
    "content-type": "application/json",
    "idempotency-key": "withdraw-1",
  };
  const url = `${DEFAULT_PUBLIC_ORIGIN}/api/review-queue/${event.id}/decision`;
  const unsupported = await handleReviewApi(new Request(url, {
    method: "POST",
    headers: { authorization: "Bearer ops-token", "content-type": "text/plain" },
    body: '{"decision":"rejected"}',
  }), env);
  assert.equal(unsupported.status, 415);
  const first = await handleReviewApi(new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "rejected", note: "Confirmed withdrawal" }),
  }), env);
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  const replay = await handleReviewApi(new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "rejected", note: "Confirmed withdrawal" }),
  }), env);
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), firstBody);
  const third = await handleReviewApi(new Request(url, {
    method: "POST",
    headers: { authorization: "Bearer ops-token", "content-type": "application/json" },
    body: JSON.stringify({ decision: "rejected" }),
  }), env);
  assert.equal(third.status, 200);
  const limited = await handleReviewApi(new Request(url, {
    method: "POST",
    headers: { authorization: "Bearer ops-token", "content-type": "application/json" },
    body: JSON.stringify({ decision: "rejected" }),
  }), env);
  assert.equal(limited.status, 429);
  database.close();
  configureReviewGuardsForTests();
  const malformed = await handleReviewApi(new Request(
    `${DEFAULT_PUBLIC_ORIGIN}/api/review-queue/%E0%A4%A/decision`,
    {
      method: "POST",
      headers: { authorization: "Bearer ops-token", "content-type": "application/json" },
      body: '{"decision":"rejected"}',
    },
  ), env);
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "invalid_candidate_id" });
  configureReviewGuardsForTests();
});

test("security headers are present and HSTS is omitted on workers.dev", () => {
  const previewReq = new Request(`${PREVIEW_ORIGIN}/`);
  assert.equal(hstsHeader(previewReq, PREVIEW_ORIGIN), undefined);
  const prodReq = new Request(`${PRODUCTION_ORIGIN}/news`);
  assert.equal(hstsHeader(prodReq, PRODUCTION_ORIGIN), "max-age=86400");
  assert.equal(hstsHeader(previewReq, PRODUCTION_ORIGIN), undefined);
  const nonce = "csp-nonce-1";
  const html = applySecurityHeaders(new Response("<html></html>", {
    headers: { "content-type": "text/html; charset=utf-8" },
  }), { request: previewReq, publicOrigin: PREVIEW_ORIGIN, html: true, nonce });
  assert.equal(html.headers.get("x-content-type-options"), "nosniff");
  assert.equal(html.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(html.headers.get("x-frame-options"), "DENY");
  assert.match(html.headers.get("permissions-policy") ?? "", /camera=\(\)/);
  assert.equal(html.headers.get("strict-transport-security"), null);
  assert.ok((html.headers.get("content-security-policy") ?? "").includes(`nonce-${nonce}`));
  assert.ok(htmlCsp(nonce).includes("frame-ancestors 'none'"));
  const prodHtml = applySecurityHeaders(new Response("<html></html>", {
    headers: { "content-type": "text/html" },
  }), { request: prodReq, publicOrigin: PRODUCTION_ORIGIN, html: true, nonce });
  assert.equal(prodHtml.headers.get("strict-transport-security"), "max-age=86400");
});

test("initial HTML includes noscript primary copy and JSON-LD for the latest news lead", () => {
  const penn = catalog.find((item) => item.id === "news-penn-ai-scribe");
  assert.ok(penn);
  const html = decorateHtml({
    html: `<!doctype html><html><head><title>The Valley Desk</title></head><body><noscript id="tvd-primary">fallback</noscript></body></html>`,
    path: "/",
    origin: DEFAULT_PUBLIC_ORIGIN,
    nonce: "n1",
    items: catalog.filter((item) => item.status === "published"),
  });
  assert.ok(html.includes(`nonce="n1"`));
  assert.ok(html.includes("__VALLEY_DESK_PUBLIC_ORIGIN__"));
  assert.ok(html.includes(DEFAULT_PUBLIC_ORIGIN));
  assert.ok(html.includes("thevalleydesk.org"));
  assert.ok(html.includes("application/ld+json"));
  assert.ok(html.includes("Latest news") || html.includes("News"));
  const noscript = primaryNoscript("/", DEFAULT_PUBLIC_ORIGIN, catalog.filter((item) => item.status === "published"));
  assert.ok(noscript.includes("<h1>"));
  assert.equal(/scrape|ingest|rss adapter/i.test(noscript), false);
  const graph = routeJsonLd("/", DEFAULT_PUBLIC_ORIGIN, catalog.filter((item) => item.status === "published"));
  assert.ok(graph.some((row) => row && typeof row === "object" && (row as { "@type"?: string })["@type"] === "WebSite"));
});

test("SCHEMA_VERSION matches the latest D1 migration and wrangler stays a single Worker", () => {
  const migrations = readdirSync(join(root, "migrations")).filter((file) => file.endsWith(".sql")).sort();
  assert.equal(SCHEMA_VERSION, migrations.at(-1)?.slice(0, 4));
  const wrangler = readFileSync(join(root, "wrangler.jsonc"), "utf8");
  assert.ok(wrangler.includes(`"PUBLIC_ORIGIN": "${DEFAULT_PUBLIC_ORIGIN}"`));
  assert.ok(wrangler.includes("CF_VERSION_METADATA"));
  assert.ok(!wrangler.includes("env.staging") && !wrangler.includes('"staging"'));
  assert.ok(!wrangler.includes("the-valley-desk-staging"));
  assert.ok(wrangler.includes('"pattern": "thevalleydesk.org", "custom_domain": true'));
  assert.ok(wrangler.includes('"pattern": "www.thevalleydesk.org", "custom_domain": true'));
  const worker = readFileSync(join(root, "worker.js"), "utf8");
  assert.ok(worker.includes("/api/health"));
  assert.ok(worker.includes("HEAD"));
  assert.ok(worker.includes("robots.txt"));
  assert.ok(worker.includes("let dynamicItem = section && slug"));
  assert.ok(!worker.includes("let dynamicItem = staticPathState !== true"));
  const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  assert.ok(workflow.includes("npm ci"));
  assert.ok(workflow.includes("npm test"));
  assert.ok(workflow.includes("npm run build"));
  assert.ok(workflow.includes("secret-scan"));
  assert.ok(workflow.includes("npm audit"));
});

test("structured ops logs are single JSON objects and homepage lead stays latest news", () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    logOps("cron", { outcome: "succeeded", token: "super-secret", runId: "run-1" });
  } finally {
    console.log = original;
  }
  const payload = JSON.parse(lines.at(-1) ?? "{}") as { event?: string; outcome?: string; token?: string };
  assert.equal(payload.event, "cron");
  assert.equal(payload.outcome, "succeeded");
  assert.equal(payload.token, "[redacted]");
  const home = readFileSync(join(root, "src/ui/HomePage.tsx"), "utf8");
  assert.ok(home.includes("rankedNews[0]"));
  assert.ok(home.includes("latestNews"));
});

test("scheduled automation smoke persists a run and emits lock/run outcomes", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const result = await runAutomation({ VALLEY_DESK_DB: db }, async () => new Response("", { status: 404 }), async () => ({
    fetchedAt: "2026-08-26T12:00:00.000Z",
    rss: [],
    events: [],
    social: [],
    notes: { rss: 0, events: 0, linkedin: { count: 0 }, x: { count: 0 }, sources: [] },
  }));
  assert.equal("skipped" in result && result.skipped, false);
  const run = database.prepare("SELECT state, item_count FROM ingest_runs ORDER BY started_at DESC LIMIT 1").get() as {
    state: string;
    item_count: number;
  };
  assert.equal(run.state, "succeeded");
  assert.equal(run.item_count, 0);
  database.close();
});

test("scheduled automation preserves Cloudflare's required fetch receiver", async () => {
  const originalFetch = globalThis.fetch;
  let receiver: unknown;
  globalThis.fetch = function (this: unknown) {
    receiver = this;
    return Promise.resolve(new Response("ok"));
  } as typeof fetch;
  try {
    const response = await runtimeFetch("https://example.com/health");
    assert.equal(await response.text(), "ok");
    assert.equal(receiver, globalThis);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function inboundEmail(raw: string, overrides: Partial<{
  from: string;
  to: string;
  rawSize: number;
}> = {}) {
  let rejected = "";
  const bytes = new TextEncoder().encode(raw);
  return {
    message: {
      from: overrides.from ?? "notifications-noreply@linkedin.com",
      to: overrides.to ?? "signals+linkedin@thevalleydesk.org",
      headers: new Headers({
        from: "LinkedIn <notifications-noreply@linkedin.com>",
        to: overrides.to ?? "signals+linkedin@thevalleydesk.org",
        subject: "Temple Health shared an update",
        "message-id": "<linkedin-123@example.com>",
        "content-type": "text/plain; charset=utf-8",
      }),
      raw: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      rawSize: overrides.rawSize ?? bytes.byteLength,
      setReject(reason: string) {
        rejected = reason;
      },
    },
    rejected: () => rejected,
  };
}

test("email discovery accepts only scoped inboxes and public HTTPS URLs", () => {
  assert.equal(acceptedEmailRecipient("signals@thevalleydesk.org")?.local, "signals");
  assert.equal(acceptedEmailRecipient("signals+linkedin@thevalleydesk.org")?.categoryHint, "linkedin");
  assert.equal(acceptedEmailRecipient("linkedin@thevalleydesk.org")?.categoryHint, "linkedin");
  assert.equal(acceptedEmailRecipient("leads@thevalleydesk.org"), null);
  assert.equal(acceptedEmailRecipient("signals@example.com"), null);
  assert.equal(keepHttpsDiscoveryUrl("https://www.linkedin.com/posts/example?utm_source=email"), "https://linkedin.com/posts/example");
  assert.equal(keepHttpsDiscoveryUrl("http://www.linkedin.com/posts/example"), undefined);
  assert.equal(keepHttpsDiscoveryUrl("https://127.0.0.1/private"), undefined);
  assert.equal(keepHttpsDiscoveryUrl("https://user:pass@example.com/private"), undefined);
  assert.equal(keepHttpsDiscoveryUrl("https://example.com/story?token=secret&id=42&utm_source=email"), "https://example.com/story");
});

test("email MIME parsing keeps the first multipart part and ignores attachments", async () => {
  const raw = [
    "From: LinkedIn <spoofed@attacker.example>",
    "To: signals+linkedin@thevalleydesk.org",
    "Subject: Regional health update",
    "Message-ID: <multipart-1@example.com>",
    "Content-Type: multipart/mixed; boundary=desk-boundary",
    "",
    "--desk-boundary",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Temple Health posted an update at https://example.com/story?id=3D42",
    "--desk-boundary",
    "Content-Type: application/octet-stream",
    "Content-Disposition: attachment; filename=payload.bin",
    "Content-Transfer-Encoding: base64",
    "",
    "c2VjcmV0LWF0dGFjaG1lbnQ=",
    "--desk-boundary--",
  ].join("\r\n");
  const parsed = await parseEmailDiscovery({
    envelopeFrom: "notifications-noreply@linkedin.com",
    envelopeTo: "signals+linkedin@thevalleydesk.org",
    headers: new Headers({
      from: "LinkedIn <spoofed@attacker.example>",
      to: "signals+linkedin@thevalleydesk.org",
      subject: "Regional health update",
      "message-id": "<multipart-1@example.com>",
      "content-type": "multipart/mixed; boundary=desk-boundary",
    }),
    raw,
    rawSize: new TextEncoder().encode(raw).byteLength,
    receivedAt: "2026-08-27T17:00:00.000Z",
  });
  assert.ok(!("error" in parsed));
  assert.equal(parsed.fromDomain, "linkedin.com");
  assert.ok(parsed.excerpt?.includes("Temple Health"));
  assert.deepEqual(parsed.urls, ["https://example.com/story"]);
  assert.equal(parsed.excerpt?.includes("secret-attachment"), false);
});

test("email identity includes normalized content even when Message-ID is reused", async () => {
  const base = {
    envelopeFrom: "notifications-noreply@linkedin.com",
    envelopeTo: "signals+linkedin@thevalleydesk.org",
    headers: new Headers({
      subject: "Update",
      "message-id": "<reused@example.com>",
      "content-type": "text/plain",
    }),
    rawSize: 100,
    receivedAt: "2026-08-27T17:00:00.000Z",
  };
  const first = await parseEmailDiscovery({ ...base, raw: "Content-Type: text/plain\r\n\r\nhttps://example.com/one" });
  const second = await parseEmailDiscovery({ ...base, raw: "Content-Type: text/plain\r\n\r\nhttps://example.com/two" });
  assert.ok(!("error" in first) && !("error" in second));
  assert.notEqual(first.id, second.id);
});

test("category aliases require a matching envelope sender and cleanup expires old rows", async () => {
  const spoofed = await parseEmailDiscovery({
    envelopeFrom: "attacker@example.com",
    envelopeTo: "signals+linkedin@thevalleydesk.org",
    headers: new Headers({
      from: "LinkedIn <notifications-noreply@linkedin.com>",
      subject: "Spoofed notification",
      "content-type": "text/plain",
    }),
    raw: "Content-Type: text/plain\r\n\r\nhttps://example.com/story",
    rawSize: 80,
    receivedAt: "2026-08-27T17:00:00.000Z",
  });
  assert.ok(!("error" in spoofed));
  assert.equal(spoofed.fromDomain, "example.com");
  assert.equal(spoofed.category, "unknown");

  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  database.prepare(`
    INSERT INTO email_discoveries (
      id, envelope_to, from_domain, category, status, url_count, urls_json,
      raw_size, first_seen_at, last_seen_at
    ) VALUES ('old', 'linkedin@thevalleydesk.org', 'linkedin.com', 'linkedin', 'review', 0, '[]', 10,
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `).run();
  await cleanupEmailDiscoveries(db, new Date("2026-08-27T17:00:00.000Z"));
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM email_discoveries").get().count, 0);
  database.close();
});

test("inbound LinkedIn mail is bounded, idempotent, review-only, and stores no raw MIME", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const raw = [
    "From: LinkedIn <notifications-noreply@linkedin.com>",
    "To: signals+linkedin@thevalleydesk.org",
    "Subject: Temple Health shared an update",
    "Message-ID: <linkedin-123@example.com>",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Temple Health published an operational update.",
    "https://www.linkedin.com/posts/temple-health-update?utm_source=email",
  ].join("\r\n");
  const parsed = await parseEmailDiscovery({
    envelopeFrom: "notifications-noreply@linkedin.com",
    envelopeTo: "signals+linkedin@thevalleydesk.org",
    headers: new Headers({
      from: "LinkedIn <notifications-noreply@linkedin.com>",
      to: "signals+linkedin@thevalleydesk.org",
      subject: "Temple Health shared an update",
      "message-id": "<linkedin-123@example.com>",
    }),
    raw,
    rawSize: new TextEncoder().encode(raw).byteLength,
    receivedAt: "2026-08-27T17:00:00.000Z",
  });
  assert.ok(!("error" in parsed));
  assert.equal(parsed.category, "linkedin");
  assert.equal(parsed.status, "review");
  assert.deepEqual(parsed.urls, ["https://linkedin.com/posts/temple-health-update"]);

  const first = inboundEmail(raw);
  const accepted = await handleInboundEmail(first.message, { VALLEY_DESK_DB: db });
  assert.equal(accepted.outcome, "accepted");
  assert.equal(first.rejected(), "");
  const replay = inboundEmail(raw);
  const duplicate = await handleInboundEmail(replay.message, { VALLEY_DESK_DB: db });
  assert.equal(duplicate.outcome, "duplicate");
  const row = database.prepare(`
    SELECT category, status, url_count, urls_json, receive_count, excerpt
    FROM email_discoveries
  `).get() as Record<string, unknown>;
  assert.equal(row.category, "linkedin");
  assert.equal(row.status, "review");
  assert.equal(row.url_count, 1);
  assert.equal(row.receive_count, 2);
  assert.ok(String(row.excerpt).includes("Temple Health"));
  const columns = database.prepare("PRAGMA table_info(email_discoveries)").all() as Array<{ name: string }>;
  assert.equal(columns.some((column) => ["raw", "raw_mime", "mime", "body"].includes(column.name)), false);
  assert.ok(columns.some((column) => column.name === "raw_size"));
  database.close();
});

test("oversized and unsupported inbound email is rejected before persistence", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const tooLarge = inboundEmail("small", { rawSize: EMAIL_MAX_RAW_BYTES + 1 });
  const oversized = await handleInboundEmail(tooLarge.message, { VALLEY_DESK_DB: db });
  assert.equal(oversized.outcome, "too_large");
  assert.equal(tooLarge.rejected(), "Message too large");
  const leads = inboundEmail("lead", { to: "leads@thevalleydesk.org" });
  const unsupported = await handleInboundEmail(leads.message, { VALLEY_DESK_DB: db });
  assert.equal(unsupported.outcome, "unsupported_recipient");
  assert.equal(leads.rejected(), "Mailbox unavailable");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM email_discoveries").get().count, 0);
  database.close();
});
