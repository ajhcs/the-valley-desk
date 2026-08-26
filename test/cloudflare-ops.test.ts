import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ContentCatalog, EventItem } from "../src/content/schema.ts";
import { evaluateCandidate } from "../src/ingest/editor.ts";
import { DEFAULT_EDITOR_BASE_URL, DEFAULT_EDITOR_MODEL } from "../src/ingest/editor-model.ts";
import { persistEditorialDecisions, persistIngestRun, type D1DatabaseLike, type D1StatementLike } from "../src/ingest/persistence.ts";
import { runAutomation } from "../src/ingest/automation.ts";
import { configureReviewGuardsForTests, handleReviewApi } from "../src/ingest/review-api.ts";
import { feedXml, sitemapXml } from "../src/ingest/public-feed.ts";
import { toFeed } from "../src/ingest/feed-contract.ts";
import {
  DEFAULT_PUBLIC_ORIGIN,
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

test("PUBLIC_ORIGIN defaults to the live preview and rejects non-https values", () => {
  assert.equal(DEFAULT_PUBLIC_ORIGIN, "https://the-valley-desk.clyons.workers.dev");
  assert.ok(!DEFAULT_PUBLIC_ORIGIN.includes("thevalleydesk.org"));
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

test("generated machine documents do not advertise the parked domain", () => {
  const origin = DEFAULT_PUBLIC_ORIGIN;
  const feed = toFeed(catalog, "2026-08-26T12:00:00.000Z");
  const rss = feedXml(feed, origin);
  const sitemap = sitemapXml(feed, origin);
  const robots = robotsTxt(origin);
  const llms = llmsTxt(origin);
  for (const document of [rss, sitemap, robots, llms]) {
    assert.ok(document.includes(origin));
    assert.ok(!document.includes("thevalleydesk.org"));
    assert.equal(/scrape|ingested from|rss adapter/i.test(document), false);
  }
  assert.ok(robots.includes(`Sitemap: ${origin}/sitemap.xml`));
  assert.ok(llms.includes(`${origin}/feed.json`));
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
});

test("security headers are present and HSTS is omitted on workers.dev", () => {
  const previewReq = new Request(`${DEFAULT_PUBLIC_ORIGIN}/`);
  assert.equal(hstsHeader(previewReq, DEFAULT_PUBLIC_ORIGIN), undefined);
  const prodReq = new Request(`${PRODUCTION_ORIGIN}/news`);
  assert.equal(hstsHeader(prodReq, PRODUCTION_ORIGIN), "max-age=86400");
  assert.equal(hstsHeader(previewReq, PRODUCTION_ORIGIN), undefined);
  const nonce = "csp-nonce-1";
  const html = applySecurityHeaders(new Response("<html></html>", {
    headers: { "content-type": "text/html; charset=utf-8" },
  }), { request: previewReq, publicOrigin: DEFAULT_PUBLIC_ORIGIN, html: true, nonce });
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
  assert.ok(!html.includes("thevalleydesk.org"));
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
  const worker = readFileSync(join(root, "worker.js"), "utf8");
  assert.ok(worker.includes("/api/health"));
  assert.ok(worker.includes("HEAD"));
  assert.ok(worker.includes("robots.txt"));
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
