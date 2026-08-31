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
  EMAIL_TRUSTED_AUTHSERV_ID,
  acceptedEmailRecipient,
  cleanupEmailDiscoveries,
  handleInboundEmail,
  keepHttpsDiscoveryUrl,
  parseEmailDiscovery,
  persistEmailDiscovery,
} from "../src/ingest/email.ts";
import {
  cleanupNewsArticleExtractions,
  persistEditorialDecisions,
  persistIngestRun,
  persistNewsArticleExtractions,
  readNewsArticleExtractions,
  type D1DatabaseLike,
  type D1StatementLike,
} from "../src/ingest/persistence.ts";
import {
  NEWS_ARTICLE_MAX_ROWS,
  NEWS_ARTICLE_RETENTION_DAYS,
} from "../src/ingest/news-extraction-config.ts";
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
import {
  OPS_ALERT_RECIPIENT,
  OPS_ALERT_SENDER,
  dispatchOperationalAlert,
  dispatchOperationalDigest,
  recordOperationalAlert,
  resolveOperationalAlert,
  sanitizeAlertDetails,
} from "../src/lib/alerts.ts";
import {
  handleOpsRequest,
  isOpsPath,
  trustedOpsIdentity,
} from "../src/ingest/ops-access.ts";
import { seedCoveragePack } from "../src/ingest/executive-persistence.ts";
import { sendAutomationAlerts } from "../worker.js";

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
  await seedCoveragePack(db, undefined, new Date());
  const pennLastSuccess = new Date(Date.now() - 30 * 60 * 1_000).toISOString();
  database.prepare(`
    UPDATE scheduled_source_state
    SET state = 'healthy', last_attempted_at = ?, last_success_at = ?,
        next_attempt_at = ?, consecutive_failures = 0, last_error = NULL
    WHERE source_id = 'src-penn-is-leadership'
  `).run(pennLastSuccess, pennLastSuccess, new Date(Date.now() + 30 * 60 * 1_000).toISOString());
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
  const statusBody = await status.json() as {
    schemaVersion: string;
    buildSha: string;
    publicOrigin: string;
    review?: unknown;
    socialEvidence?: { available?: boolean };
    valeCollector?: { available?: boolean; lastSuccessful?: unknown };
    modelHealth?: { available?: boolean };
    alerts?: { available?: boolean; open?: unknown[] };
    executiveIntelligence?: { runtimeCoverage?: Array<{ institutionId?: string; state?: string; coverageLost?: boolean }> };
  };
  assert.equal(statusBody.schemaVersion, SCHEMA_VERSION);
  assert.equal(statusBody.buildSha, "deadbeef");
  assert.equal(statusBody.publicOrigin, DEFAULT_PUBLIC_ORIGIN);
  assert.equal(statusBody.review, undefined);
  assert.equal(statusBody.socialEvidence?.available, true);
  assert.equal(statusBody.valeCollector?.available, true);
  assert.equal(statusBody.valeCollector?.lastSuccessful, null);
  assert.equal(statusBody.modelHealth?.available, true);
  assert.equal(statusBody.alerts?.available, true);
  const pennCoverage = statusBody.executiveIntelligence?.runtimeCoverage?.find((row) => row.institutionId === "inst-penn");
  assert.equal(pennCoverage?.state, "healthy");
  assert.equal(pennCoverage?.coverageLost, false);
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

test("operations status exposes bounded Vale platform health", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  database.prepare(`
    INSERT INTO social_collector_runs (
      id, schema_version, collector, manifest_version, manifest_hash,
      started_at, finished_at, outcome, accounts_checked, posts_seen,
      accepted, duplicates, failures, platforms_json, failure_reasons_json, created_at
    ) VALUES (?, 1, 'vale', ?, ?, ?, ?, 'success', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "vale-ops-health", "manifest-v1", "a".repeat(64),
    "2026-08-31T12:00:00.000Z", "2026-08-31T12:30:00.000Z",
    4, 8, 6, 1, 1,
    JSON.stringify({
      linkedin: { state: "healthy", accessVerified: true, targetsChecked: 4, postsSeen: 8, accepted: 6, duplicates: 1, failures: 0 },
      x: { state: "inactive", accessVerified: false, targetsChecked: 0, postsSeen: 0, accepted: 0, duplicates: 0, failures: 0, reason: "X connector is not activated" },
    }),
    JSON.stringify(["bounded upstream note"]),
    "2026-08-31T12:30:00.000Z",
  );
  const response = await handleReviewApi(new Request(`${DEFAULT_PUBLIC_ORIGIN}/api/automation/status`, {
    headers: { authorization: "Bearer ops-token" },
  }), { VALLEY_DESK_DB: db, REVIEW_API_TOKEN: "ops-token" });
  assert.equal(response.status, 200);
  const body = await response.json() as {
    valeCollector?: {
      latest?: {
        platforms?: Record<string, { state?: string; accessVerified?: boolean; targetsChecked?: number; reason?: string }>;
        failureReasons?: string[];
      } | null;
    };
  };
  assert.deepEqual(body.valeCollector?.latest?.platforms?.linkedin, {
    state: "healthy", accessVerified: true, targetsChecked: 4, postsSeen: 8, accepted: 6, duplicates: 1, failures: 0,
  });
  assert.deepEqual(body.valeCollector?.latest?.platforms?.x, {
    state: "inactive", accessVerified: false, targetsChecked: 0, postsSeen: 0, accepted: 0, duplicates: 0, failures: 0,
    reason: "X connector is not activated",
  });
  assert.deepEqual(body.valeCollector?.latest?.failureReasons, ["bounded upstream note"]);
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
  assert.ok(worker.includes("isSocialManifestPath"));
  assert.ok(worker.includes("isSocialCollectorRunsPath"));
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
        "authentication-results": "mx.cloudflare.net; dkim=pass header.d=linkedin.com",
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
  assert.equal(acceptedEmailRecipient("signals+garbage@thevalleydesk.org"), null);
  assert.equal(keepHttpsDiscoveryUrl("https://www.linkedin.com/posts/example?utm_source=email"), "https://linkedin.com/posts/example");
  assert.equal(keepHttpsDiscoveryUrl("http://www.linkedin.com/posts/example"), undefined);
  assert.equal(keepHttpsDiscoveryUrl("https://127.0.0.1/private"), undefined);
  assert.equal(keepHttpsDiscoveryUrl("https://user:pass@example.com/private"), undefined);
  assert.equal(keepHttpsDiscoveryUrl("https://example.com/story?token=secret&id=42&utm_source=email"), "https://example.com/story");
});

test("email pointer policy never calls editorial/model machinery", () => {
  const emailSrc = readFileSync(join(root, "src/ingest/email.ts"), "utf8");
  assert.equal(/fetch\s*\(|enrichWithEditorModel|persistEditorialDecisions|evaluateCandidate/.test(emailSrc), false);
});

test("email MIME To cannot override an invalid envelope alias", async () => {
  const parsed = await parseEmailDiscovery({
    envelopeFrom: "notifications-noreply@linkedin.com",
    envelopeTo: "signals+garbage@thevalleydesk.org",
    headers: new Headers({
      to: "signals+linkedin@thevalleydesk.org",
      subject: "Update",
      "content-type": "text/plain",
    }),
    raw: "Content-Type: text/plain\r\n\r\nhttps://example.com/story",
    rawSize: 80,
  });
  assert.deepEqual(parsed, { error: "unsupported_recipient" });
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
      "authentication-results": "mx.cloudflare.net; dkim=pass header.d=linkedin.com",
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

test("exact category aliases survive forwarded sender rewriting and cleanup expires old rows", async () => {
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
  assert.equal(spoofed.category, "linkedin");
  assert.equal(spoofed.trustState, "untrusted-pointer");

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

test("inbound LinkedIn mail is bounded, review-only, untrusted, and stores no raw MIME", async () => {
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
      "authentication-results": "mx.cloudflare.net; dkim=pass header.d=linkedin.com",
    }),
    raw,
    rawSize: new TextEncoder().encode(raw).byteLength,
    receivedAt: "2026-08-27T17:00:00.000Z",
  });
  assert.ok(!("error" in parsed));
  assert.equal(parsed.category, "linkedin");
  assert.equal(parsed.status, "review");
  assert.equal(parsed.trustState, "untrusted-pointer");
  assert.deepEqual(parsed.urls, ["https://linkedin.com/posts/temple-health-update"]);
  assert.equal(EMAIL_TRUSTED_AUTHSERV_ID, "");

  const first = inboundEmail(raw);
  const accepted = await handleInboundEmail(first.message, { VALLEY_DESK_DB: db });
  assert.equal(accepted.outcome, "accepted");
  assert.equal(first.rejected(), "");
  const stored = database.prepare("SELECT trust_state FROM email_discoveries").get() as { trust_state: string };
  assert.equal(stored.trust_state, "untrusted-pointer");
  const columns = database.prepare("PRAGMA table_info(email_discoveries)").all() as Array<{ name: string }>;
  assert.equal(columns.some((column) => ["raw", "raw_mime", "mime", "body"].includes(column.name)), false);
  assert.ok(columns.some((column) => column.name === "raw_size"));
  const emailSrc = readFileSync(join(root, "src/ingest/email.ts"), "utf8");
  assert.equal(emailSrc.includes("persistEditorialDecisions"), false);
  assert.equal(emailSrc.includes("evaluateCandidate"), false);
  database.close();
});

test("spoofed Authentication-Results never authenticates an inbound pointer", async () => {
  const raw = "Content-Type: text/plain\r\n\r\nTemple Health posted https://example.com/story";
  for (const headers of [
    new Headers({
      subject: "Update",
      "message-id": "<spoof-1@example.com>",
      "authentication-results": "mx.cloudflare.net; dkim=pass header.d=linkedin.com",
    }),
    new Headers({
      subject: "Update",
      "message-id": "<spoof-2@example.com>",
      "arc-authentication-results": "i=1; mx.google.com; dkim=pass header.d=linkedin.com",
    }),
    new Headers({
      subject: "Update",
      "message-id": "<spoof-3@example.com>",
    }),
  ]) {
    const parsed = await parseEmailDiscovery({
      envelopeFrom: "notifications-noreply@linkedin.com",
      envelopeTo: "signals+linkedin@thevalleydesk.org",
      headers,
      raw,
      rawSize: 80,
      receivedAt: "2026-08-27T17:00:00.000Z",
    });
    assert.ok(!("error" in parsed));
    assert.equal(parsed.status, "review");
    assert.equal(parsed.trustState, "untrusted-pointer");
  }
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const inbound = inboundEmail(raw);
  const result = await handleInboundEmail(inbound.message, { VALLEY_DESK_DB: db });
  assert.equal(result.outcome, "accepted");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM email_discoveries").get().count, 1);
  database.close();
});

test("email authentication accepts only an explicitly configured exact authserv-id", async () => {
  const raw = "Content-Type: text/plain\r\n\r\nTemple Health posted https://example.com/story";
  const base = {
    envelopeFrom: "notifications-noreply@linkedin.com",
    envelopeTo: "signals+linkedin@thevalleydesk.org",
    raw,
    rawSize: 80,
    receivedAt: "2026-08-27T17:00:00.000Z",
    trustedAuthservId: "trusted.mx.cloudflare.net",
  };
  const accepted = await parseEmailDiscovery({
    ...base,
    headers: new Headers({
      subject: "Update",
      "message-id": "<trusted-1@example.com>",
      "authentication-results": "trusted.mx.cloudflare.net; dkim=pass header.d=linkedin.com",
    }),
  });
  assert.ok(!("error" in accepted));
  assert.equal(accepted.status, "review");
  assert.equal(accepted.trustState, "authenticated-pointer");

  const lookalike = await parseEmailDiscovery({
    ...base,
    headers: new Headers({
      subject: "Update",
      "message-id": "<trusted-2@example.com>",
      "authentication-results": "trusted.mx.cloudflare.net.attacker.example; dkim=pass header.d=linkedin.com",
    }),
  });
  assert.ok(!("error" in lookalike));
  assert.equal(lookalike.status, "review");
  assert.equal(lookalike.trustState, "untrusted-pointer");

  const senderLookalike = await parseEmailDiscovery({
    ...base,
    headers: new Headers({
      subject: "Update",
      "message-id": "<trusted-3@example.com>",
      "authentication-results": "trusted.mx.cloudflare.net; dkim=pass header.d=linkedin.com.attacker.example",
    }),
  });
  assert.ok(!("error" in senderLookalike));
  assert.equal(senderLookalike.status, "review");
  assert.equal(senderLookalike.trustState, "untrusted-pointer");
});

test("exact duplicate email replays are idempotent without extra writes or cap refresh", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const raw = "Content-Type: text/plain\r\n\r\nhttps://example.com/story";
  const parsed = await parseEmailDiscovery({
    envelopeFrom: "notifications-noreply@linkedin.com",
    envelopeTo: "signals+linkedin@thevalleydesk.org",
    headers: new Headers({
      subject: "Update",
      "message-id": "<dup-1@example.com>",
      "content-type": "text/plain",
    }),
    raw,
    rawSize: 80,
    receivedAt: "2026-08-26T12:00:00.000Z",
  });
  assert.ok(!("error" in parsed));
  parsed.status = "review";
  assert.equal(await persistEmailDiscovery(db, parsed), "accepted");
  const first = database.prepare(`
    SELECT last_seen_at, receive_count, first_seen_at FROM email_discoveries WHERE id = ?
  `).get(parsed.id) as { last_seen_at: string; receive_count: number; first_seen_at: string };
  assert.equal(first.receive_count, 1);
  assert.equal(first.last_seen_at, "2026-08-26T12:00:00.000Z");
  const replay = { ...parsed, receivedAt: "2026-08-27T17:00:00.000Z", status: "review" as const };
  for (let index = 0; index < 8; index += 1) {
    assert.equal(await persistEmailDiscovery(db, replay), "duplicate");
  }
  const after = database.prepare(`
    SELECT last_seen_at, receive_count FROM email_discoveries WHERE id = ?
  `).get(parsed.id) as { last_seen_at: string; receive_count: number };
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM email_discoveries").get().count, 1);
  assert.equal(after.receive_count, 1);
  assert.equal(after.last_seen_at, "2026-08-26T12:00:00.000Z");
  await cleanupEmailDiscoveries(db, new Date("2026-12-01T00:00:00.000Z"));
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM email_discoveries").get().count, 0);
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

test("Access context gates ops on both apex and workers.dev without trusting headers", async () => {
  assert.equal(isOpsPath("/ops"), true);
  assert.equal(isOpsPath("/ops/"), true);
  assert.equal(isOpsPath("/ops/api/automation/status"), true);
  assert.equal(isOpsPath("/opsx"), false);
  assert.equal(await trustedOpsIdentity(undefined), undefined);
  assert.equal(await trustedOpsIdentity({ access: { getIdentity: async () => ({ email: "attacker@example.com" }) } }), undefined);
  assert.equal(await trustedOpsIdentity({ access: { getIdentity: async () => ({ email: "Clyons@AJHCS.org" }) } }), "clyons@ajhcs.org");

  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const env = { VALLEY_DESK_DB: db, PUBLIC_ORIGIN: DEFAULT_PUBLIC_ORIGIN };
  const denied = await handleOpsRequest(
    new Request(`${DEFAULT_PUBLIC_ORIGIN}/ops`, { headers: { "cf-access-authenticated-user-email": "clyons@ajhcs.org" } }),
    env,
    undefined,
    DEFAULT_PUBLIC_ORIGIN,
    async () => "private",
  );
  assert.equal(denied.status, 404);
  const allowed = await handleOpsRequest(
    new Request(`${DEFAULT_PUBLIC_ORIGIN}/ops`),
    env,
    { access: { getIdentity: async () => ({ email: "clyons@ajhcs.org" }) } },
    DEFAULT_PUBLIC_ORIGIN,
    async () => "private-shell",
  );
  assert.equal(allowed.status, 200);
  assert.equal(await allowed.text(), "private-shell");
  const workersDev = await handleOpsRequest(
    new Request(`${PREVIEW_ORIGIN}/ops`),
    env,
    { access: { getIdentity: async () => ({ email: "clyons@ajhcs.org" }) } },
    DEFAULT_PUBLIC_ORIGIN,
    async () => "private-shell",
  );
  assert.equal(workersDev.status, 404);
  const api = await handleOpsRequest(
    new Request(`${DEFAULT_PUBLIC_ORIGIN}/ops/api/automation/status`),
    env,
    { access: { getIdentity: async () => ({ email: "clyons@ajhcs.org" }) } },
    DEFAULT_PUBLIC_ORIGIN,
    async () => "unused",
  );
  assert.equal(api.status, 200);
  const spoofed = await handleOpsRequest(
    new Request(`${DEFAULT_PUBLIC_ORIGIN}/ops/api/automation/status`, { headers: { "cf-access-authenticated-user-email": "clyons@ajhcs.org" } }),
    env,
    undefined,
    DEFAULT_PUBLIC_ORIGIN,
    async () => "unused",
  );
  assert.equal(spoofed.status, 404);
  database.close();
});

test("operational alerts dedupe durably, sanitize secrets, and send to the fixed owner", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const sent: Array<{ to: string; from: string; subject: string; text: string }> = [];
  const binding = {
    async send(message: { to: string; from: string; subject: string; text: string }) {
      sent.push(message);
      return { messageId: "message-1" };
    },
  };
  const firstAt = new Date("2026-08-28T08:00:00.000Z");
  const input = {
    fingerprint: "valley-desk:test-alert",
    event: "source-degraded",
    severity: "warning" as const,
    conditionState: "blocked" as const,
    institutionId: "inst-cooper",
    subsystem: "rss",
    groupKey: "valley-desk:rss:inst-cooper",
    threshold: 2,
    now: firstAt,
    details: {
      sourceId: "source-1",
      reason: "safe detail",
      token: "do-not-send",
      body: "do-not-send",
      injected: "line\nheader",
    },
  };
  assert.equal((await dispatchOperationalAlert(db, binding, input)).outcome, "deduped");
  assert.equal((await dispatchOperationalAlert(db, binding, { ...input, now: new Date("2026-08-28T09:00:00.000Z") })).outcome, "sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, OPS_ALERT_RECIPIENT);
  assert.equal(sent[0].from, OPS_ALERT_SENDER);
  assert.equal(sent[0].text.includes("do-not-send"), false);
  assert.equal(sent[0].text.includes("\nheader"), false);
  const context = database.prepare(
    "SELECT condition_state, institution_id, subsystem, group_key FROM operational_alerts WHERE fingerprint = ?",
  ).get(input.fingerprint) as { condition_state: string; institution_id: string; subsystem: string; group_key: string };
  assert.deepEqual({ ...context }, {
    condition_state: "blocked",
    institution_id: "inst-cooper",
    subsystem: "rss",
    group_key: "valley-desk:rss:inst-cooper",
  });
  assert.match(sent[0].text, /condition_state: blocked/);
  assert.match(sent[0].text, /institution: inst-cooper/);
  assert.deepEqual(sanitizeAlertDetails(input.details), {
    sourceId: "source-1",
    reason: "safe detail",
    injected: "line header",
  });
  const replay = await dispatchOperationalAlert(db, binding, { ...input, now: new Date("2026-08-28T09:10:00.000Z") });
  assert.equal(replay.outcome, "deduped");
  assert.equal(sent.length, 1);
  database.close();
});

test("operational alert reminders send once, then no more than daily", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const sent: string[] = [];
  const binding = {
    async send(message: { to: string; from: string; subject: string; text: string }) {
      sent.push(message.subject);
      return { messageId: `message-${sent.length}` };
    },
  };
  const fingerprint = "valley-desk:critical-reminder-cadence";
  const first = new Date("2026-08-28T00:00:00.000Z");

  await dispatchOperationalAlert(db, binding, {
    fingerprint,
    event: "source-coverage-lost",
    severity: "critical",
    threshold: 1,
    now: first,
  });
  assert.equal(sent.length, 1, "the threshold transition is immediate");
  let row = database.prepare(
    "SELECT next_notify_at FROM operational_alerts WHERE fingerprint = ?",
  ).get(fingerprint) as { next_notify_at: string };
  assert.equal(row.next_notify_at, "2026-08-28T06:00:00.000Z");

  await dispatchOperationalAlert(db, binding, {
    fingerprint,
    event: "source-coverage-lost",
    severity: "critical",
    threshold: 1,
    now: new Date("2026-08-28T06:00:00.000Z"),
  });
  assert.equal(sent.length, 2, "one sustained-incident reminder is allowed");
  row = database.prepare(
    "SELECT next_notify_at FROM operational_alerts WHERE fingerprint = ?",
  ).get(fingerprint) as { next_notify_at: string };
  assert.equal(row.next_notify_at, "2026-08-29T06:00:00.000Z");

  await dispatchOperationalAlert(db, binding, {
    fingerprint,
    event: "source-coverage-lost",
    severity: "critical",
    threshold: 1,
    now: new Date("2026-08-28T12:00:00.000Z"),
  });
  assert.equal(sent.length, 2, "the same incident is quiet between daily reminders");

  await dispatchOperationalAlert(db, binding, {
    fingerprint,
    event: "source-coverage-lost",
    severity: "critical",
    threshold: 1,
    now: new Date("2026-08-29T06:00:00.000Z"),
  });
  assert.equal(sent.length, 3, "a continuing incident may remind once per day");
  database.close();
});

test("operational alerts require durable consecutive recovery and reopen cleanly", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const sent: string[] = [];
  const binding = {
    async send(message: { to: string; from: string; subject: string; text: string }) {
      sent.push(message.subject);
      return { messageId: `message-${sent.length}` };
    },
  };
  const fingerprint = "valley-desk:recovery-test";
  const first = new Date("2026-08-28T00:00:00.000Z");
  await dispatchOperationalAlert(db, binding, {
    fingerprint,
    event: "source-degraded",
    severity: "warning",
    threshold: 1,
    now: first,
  });
  assert.equal(sent.length, 1);
  const firstRecovery = await resolveOperationalAlert(db, fingerprint, new Date("2026-08-28T01:00:00.000Z"), 2);
  assert.equal(firstRecovery?.state, "open");
  assert.equal(firstRecovery?.recovery_count, 1);
  const resolved = await resolveOperationalAlert(db, fingerprint, new Date("2026-08-28T02:00:00.000Z"), 2);
  assert.equal(resolved?.state, "resolved");
  assert.equal(resolved?.recovery_count, 2);

  const reopened = await dispatchOperationalAlert(db, binding, {
    fingerprint,
    event: "source-degraded",
    severity: "warning",
    threshold: 2,
    now: new Date("2026-08-28T03:00:00.000Z"),
  });
  assert.equal(reopened.outcome, "deduped");
  assert.equal(reopened.row.occurrence_count, 1, "a reopened alert starts a fresh consecutive-failure streak");
  const resent = await dispatchOperationalAlert(db, binding, {
    fingerprint,
    event: "source-degraded",
    severity: "warning",
    threshold: 2,
    now: new Date("2026-08-28T04:00:00.000Z"),
  });
  assert.equal(resent.outcome, "sent");
  assert.equal(sent.length, 2);
  const row = database.prepare("SELECT state, recovery_count, occurrence_count FROM operational_alerts WHERE fingerprint = ?").get(fingerprint) as { state: string; recovery_count: number; occurrence_count: number };
  assert.deepEqual({ ...row }, { state: "open", recovery_count: 0, occurrence_count: 2 });
  database.close();
});

test("automation alerts cover leadership/model failures and stable source fingerprints", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const sent: string[] = [];
  const binding = {
    async send(message: { to: string; from: string; subject: string; text: string }) {
      sent.push(message.subject);
      return { messageId: `message-${sent.length}` };
    },
  };
  const env = { VALLEY_DESK_DB: db, NOTIFY_OPS: binding };
  const failed = {
    notes: {
      sources: [{ id: "source-1", state: "upstream-failed", type: "rss", itemCount: 0, consecutiveFailures: 3, institutionIds: ["inst-cooper"] }],
    },
    leadership: { outcome: "failed", fetched: 0, error: "upstream unavailable" },
    modelSelectedCount: 1,
    modelFailedCount: 1,
    modelSucceededCount: 0,
  };
  const at = new Date("2026-08-28T04:00:00.000Z");
  for (const [index, state] of ["upstream-failed", "parser-failed", "timed-out"].entries()) {
    await sendAutomationAlerts(env, {
      ...failed,
      notes: { sources: [{ ...failed.notes.sources[0], state }] },
    }, new Date(at.getTime() + index * 60 * 60 * 1_000));
  }
  assert.equal(sent.length, 2, "only the critical source/leadership transitions send immediate mail; model warnings stay in the digest");
  const rows = database.prepare("SELECT fingerprint, state, occurrence_count FROM operational_alerts ORDER BY fingerprint").all() as Array<{ fingerprint: string; state: string; occurrence_count: number }>;
  assert.deepEqual(rows.map((row) => row.fingerprint), [
    "valley-desk:leadership-monitor",
    "valley-desk:model-enrichment",
    "valley-desk:source:source-1",
  ]);
  const leadershipAlert = database.prepare(
    "SELECT detail_json FROM operational_alerts WHERE fingerprint = 'valley-desk:leadership-monitor'",
  ).get() as { detail_json: string };
  assert.match(leadershipAlert.detail_json, /upstream unavailable/);
  assert.doesNotMatch(leadershipAlert.detail_json, /Unknown automation failure/);

  const healthy = {
    notes: { sources: [{ id: "source-1", state: "healthy", type: "rss", itemCount: 1 }] },
    leadership: { outcome: "ok", fetched: 1 },
    modelSelectedCount: 1,
    modelFailedCount: 0,
    modelSucceededCount: 1,
  };
  await sendAutomationAlerts(env, healthy, new Date("2026-08-28T07:00:00.000Z"));
  await sendAutomationAlerts(env, healthy, new Date("2026-08-28T08:00:00.000Z"));
  const resolved = database.prepare("SELECT COUNT(*) AS count FROM operational_alerts WHERE state = 'resolved'").get() as { count: number };
  assert.equal(resolved.count, 3);
  assert.equal(sent.filter((subject) => subject.includes("RECOVERED")).length, 3);
  database.close();
});

test("public source blocks are warning-level and deliberate backoff does not create an alert", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const sent: string[] = [];
  const env = {
    VALLEY_DESK_DB: db,
    NOTIFY_OPS: {
      async send(message: { subject: string }) {
        sent.push(message.subject);
        return { messageId: `message-${sent.length}` };
      },
    },
  };
  const base = new Date("2026-08-28T00:00:00.000Z");
  for (let index = 0; index < 3; index += 1) {
    await sendAutomationAlerts(env, {
      notes: { sources: [
        { id: "cooper-newsroom", state: "upstream-blocked", type: "rss", itemCount: 0, consecutiveFailures: index + 1, httpStatus: 403, error: "HTTP 403", lastSuccessAt: "2026-08-27T12:00:00.000Z", fallbackUrl: "https://www.cooperhealth.org/about-us/newsroom", institutionIds: ["inst-cooper"] },
        { id: "penn-medicine-newsroom", state: "healthy", type: "rss", itemCount: 1, institutionIds: ["inst-penn"] },
      ] },
    }, new Date(base.getTime() + index * 60 * 60 * 1_000));
  }
  const blocked = database.prepare(
    "SELECT severity, detail_json FROM operational_alerts WHERE fingerprint = 'valley-desk:source:cooper-newsroom'",
  ).get() as { severity: string; detail_json: string };
  assert.equal(blocked.severity, "warning");
  assert.match(blocked.detail_json, /403/);
  assert.match(blocked.detail_json, /"hasFallback":true/);
  assert.match(blocked.detail_json, /2026-08-27T12:00:00.000Z/);
  assert.doesNotMatch(blocked.detail_json, /cooperhealth\.org/);
  assert.equal(sent.length, 0, "public upstream blocks are durable warning data for the digest");

  await sendAutomationAlerts(env, {
    notes: { sources: [{ id: "cooper-newsroom", state: "backoff", type: "rss", itemCount: 0, consecutiveFailures: 4, nextAttemptAt: "2026-08-28T06:00:00.000Z" }] },
  }, new Date("2026-08-28T04:00:00.000Z"));
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM operational_alerts WHERE fingerprint = 'valley-desk:source:cooper-newsroom'").get().count,
    1,
  );
  database.close();
});

test("pack-wide public source blocks escalate only after required peers are lost", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const sent: string[] = [];
  const env = {
    VALLEY_DESK_DB: db,
    NOTIFY_OPS: {
      async send(message: { subject: string }) {
        sent.push(message.subject);
        return { messageId: `message-${sent.length}` };
      },
    },
  };
  for (let index = 0; index < 3; index += 1) {
    await sendAutomationAlerts(env, {
      notes: { sources: [
        { id: "cooper-newsroom", state: "upstream-blocked", type: "rss", itemCount: 0, consecutiveFailures: index + 1, httpStatus: 403, error: "HTTP 403", institutionIds: ["inst-cooper"] },
        { id: "cooper-newsroom-alt", state: "upstream-blocked", type: "rss", itemCount: 0, consecutiveFailures: index + 1, httpStatus: 403, error: "HTTP 403", institutionIds: ["inst-cooper"] },
      ] },
    }, new Date(`2026-08-28T0${index}:00:00.000Z`));
  }
  const row = database.prepare(
    "SELECT severity FROM operational_alerts WHERE fingerprint = 'valley-desk:source:cooper-newsroom'",
  ).get() as { severity: string };
  assert.equal(row.severity, "critical");
  assert.equal(sent.length, 2, "each blocked source gets one thresholded critical transition");
  database.close();
});

test("recent source success keeps a transient public failure below critical coverage loss", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const sent: string[] = [];
  const env = {
    VALLEY_DESK_DB: db,
    NOTIFY_OPS: {
      async send(message: { subject: string }) {
        sent.push(message.subject);
        return { messageId: `message-${sent.length}` };
      },
    },
  };
  const now = new Date("2026-08-28T12:00:00.000Z");
  for (const sourceId of ["cooper-newsroom", "cooper-newsroom-alt"]) {
    await sendAutomationAlerts(env, {
      notes: {
        sources: [{
          id: sourceId,
          state: "upstream-blocked",
          type: "rss",
          itemCount: 0,
          consecutiveFailures: 1,
          httpStatus: 403,
          error: "HTTP 403",
          lastSuccessAt: "2026-08-28T11:30:00.000Z",
          institutionIds: ["inst-cooper"],
        }],
      },
    }, now);
  }
  const rows = database.prepare(
    "SELECT severity, detail_json FROM operational_alerts WHERE group_key LIKE 'valley-desk:rss:inst-cooper%' ORDER BY fingerprint",
  ).all() as Array<{ severity: string; detail_json: string }>;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.severity === "warning"));
  assert.ok(rows.every((row) => row.detail_json.includes('"coverageLost":false')));
  assert.equal(sent.length, 0);
  database.close();
});

test("incomplete leadership extraction surfaces a bounded actionable reason without inventing departures", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const sent: string[] = [];
  const env = {
    VALLEY_DESK_DB: db,
    NOTIFY_OPS: {
      async send(message: { subject: string }) {
        sent.push(message.subject);
        return { messageId: `message-${sent.length}` };
      },
    },
  };
  const reason = "Page fetched, but no recognized leadership structure was found";
  for (let index = 0; index < 2; index += 1) {
    await sendAutomationAlerts(env, {
      notes: { sources: [] },
      leadership: {
        outcome: "degraded",
        fetched: 1,
        failed: 1,
        coverage: [
          { institutionId: "inst-example", status: "active" },
          { institutionId: "inst-peer", status: "active" },
        ],
        failureDetails: [{
          sourceId: "src-example-leadership",
          errorClass: "unrecognized",
          reason,
          nextRetryAt: "2026-08-28T06:00:00.000Z",
        }],
      },
    }, new Date(`2026-08-28T0${index}:00:00.000Z`));
  }
  assert.equal(sent.length, 0, "degraded leadership with remaining coverage belongs in the digest, not immediate mail");
  const row = database.prepare(
    "SELECT severity, detail_json FROM operational_alerts WHERE fingerprint = 'valley-desk:leadership-monitor'",
  ).get() as { severity: string; detail_json: string };
  assert.equal(row.severity, "warning");
  assert.match(row.detail_json, /no recognized leadership structure/);
  assert.match(row.detail_json, /src-example-leadership/);
  assert.doesNotMatch(row.detail_json, /Unknown automation failure/);
  database.close();
});

test("leadership backoff does not count as a healthy recovery", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const env = {
    VALLEY_DESK_DB: db,
    NOTIFY_OPS: {
      async send() {
        return { messageId: "message-1" };
      },
    },
  };
  const failed = {
    notes: { sources: [] },
    leadership: {
      outcome: "degraded",
      fetched: 1,
      failed: 1,
      coverage: [{ institutionId: "inst-example", status: "active" }],
    },
  };
  await sendAutomationAlerts(env, failed, new Date("2026-08-28T00:00:00.000Z"));
  await sendAutomationAlerts(env, failed, new Date("2026-08-28T01:00:00.000Z"));
  await sendAutomationAlerts(env, {
    notes: { sources: [] },
    leadership: { outcome: "ok", fetched: 0, backoff: 1 },
  }, new Date("2026-08-28T02:00:00.000Z"));
  let row = database.prepare(
    "SELECT state, recovery_count FROM operational_alerts WHERE fingerprint = 'valley-desk:leadership-monitor'",
  ).get() as { state: string; recovery_count: number };
  assert.deepEqual({ ...row }, { state: "open", recovery_count: 0 });
  await sendAutomationAlerts(env, {
    notes: { sources: [] },
    leadership: { outcome: "ok", fetched: 0, backoff: 0 },
  }, new Date("2026-08-28T03:00:00.000Z"));
  await sendAutomationAlerts(env, {
    notes: { sources: [] },
    leadership: { outcome: "ok", fetched: 0, backoff: 0 },
  }, new Date("2026-08-28T04:00:00.000Z"));
  row = database.prepare(
    "SELECT state, recovery_count FROM operational_alerts WHERE fingerprint = 'valley-desk:leadership-monitor'",
  ).get() as { state: string; recovery_count: number };
  assert.deepEqual({ ...row }, { state: "resolved", recovery_count: 2 });
  database.close();
});

test("recent leadership source failure remains warning while fresh coverage survives", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const sent: string[] = [];
  await sendAutomationAlerts({
    VALLEY_DESK_DB: db,
    NOTIFY_OPS: {
      async send(message: { subject: string }) {
        sent.push(message.subject);
        return { messageId: "message-1" };
      },
    },
  }, {
    notes: { sources: [] },
    leadership: {
      outcome: "degraded",
      fetched: 1,
      failed: 1,
      coverage: [{ institutionId: "inst-example", status: "active" }],
      runtimeCoverage: [{
        institutionId: "inst-example",
        shortName: "Example",
        configuredStatus: "active",
        state: "blocked",
        coverageLost: false,
        sourceIds: ["src-example-leadership"],
        healthySourceIds: [],
        lastSuccessAt: "2026-08-28T11:30:00.000Z",
        failureAgeMs: 1_800_000,
        nextRetryAt: "2026-08-28T12:30:00.000Z",
        sourceStates: [],
      }],
      failureDetails: [{
        sourceId: "src-example-leadership",
        institutionId: "inst-example",
        errorClass: "upstream-blocked",
        httpStatus: 403,
        nextRetryAt: "2026-08-28T12:30:00.000Z",
        reason: "HTTP 403",
      }],
    },
  }, new Date("2026-08-28T12:00:00.000Z"));
  assert.equal(sent.length, 0, "fresh coverage keeps a transient source failure in the digest");
  const row = database.prepare(
    "SELECT severity, condition_state, detail_json FROM operational_alerts WHERE fingerprint = 'valley-desk:leadership-monitor'",
  ).get() as { severity: string; condition_state: string; detail_json: string };
  assert.equal(row.severity, "warning");
  assert.equal(row.condition_state, "degraded");
  assert.match(row.detail_json, /src-example-leadership/);
  database.close();
});

test("source coverage loss stays warning when a healthy fallback is still serving the origin", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const sent: string[] = [];
  const env = {
    VALLEY_DESK_DB: db,
    NOTIFY_OPS: {
      async send(message: { subject: string }) {
        sent.push(message.subject);
        return { messageId: `message-${sent.length}` };
      },
    },
  };
  for (let index = 0; index < 3; index += 1) {
    await sendAutomationAlerts(env, {
      notes: {
        sources: [{
          id: "cooper-newsroom",
          state: "upstream-failed",
          type: "rss",
          itemCount: 0,
          consecutiveFailures: index + 1,
          httpStatus: 502,
          error: "HTTP 502",
          fallbackUrl: "https://www.cooperhealth.org/about-us/newsroom",
          institutionIds: ["inst-cooper"],
        }],
      },
    }, new Date(`2026-08-28T0${index}:00:00.000Z`));
  }
  const row = database.prepare(
    "SELECT severity, detail_json FROM operational_alerts WHERE fingerprint = 'valley-desk:source:cooper-newsroom'",
  ).get() as { severity: string; detail_json: string };
  assert.equal(row.severity, "warning");
  assert.match(row.detail_json, /"hasFallback":true/);
  assert.match(row.detail_json, /"coverageLost":true/);
  assert.equal(sent.length, 0, "fallback coverage keeps the incident in the digest instead of immediate critical mail");
  database.close();
});

test("active source fallback is visible in the digest and recovers only after primary success", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const sent: string[] = [];
  const env = {
    VALLEY_DESK_DB: db,
    NOTIFY_OPS: {
      async send(message: { subject: string }) {
        sent.push(message.subject);
        return { messageId: `message-${sent.length}` };
      },
    },
  };
  const fallback = {
    id: "cooper-newsroom",
    state: "healthy",
    type: "rss",
    itemCount: 3,
    fallbackUrl: "https://phillyvoice.com/tags/cooperuniversity-health-care",
    institutionIds: ["inst-cooper"],
  };
  await sendAutomationAlerts(env, { notes: { sources: [fallback] } }, new Date("2026-08-28T00:00:00.000Z"));
  const active = database.prepare(
    "SELECT severity, event, state, detail_json FROM operational_alerts WHERE fingerprint = 'valley-desk:source-fallback:cooper-newsroom'",
  ).get() as { severity: string; event: string; state: string; detail_json: string };
  assert.deepEqual({ severity: active.severity, event: active.event, state: active.state }, {
    severity: "warning",
    event: "source-fallback-active",
    state: "open",
  });
  assert.match(active.detail_json, /"fallbackActive":true/);
  assert.equal(sent.length, 0, "fallback use is digest data, not an immediate alert");

  const primary = { notes: { sources: [{ id: "cooper-newsroom", state: "healthy", type: "rss", itemCount: 3 }] } };
  await sendAutomationAlerts(env, primary, new Date("2026-08-28T01:00:00.000Z"));
  await sendAutomationAlerts(env, primary, new Date("2026-08-28T02:00:00.000Z"));
  const recovered = database.prepare(
    "SELECT state, recovery_count FROM operational_alerts WHERE fingerprint = 'valley-desk:source-fallback:cooper-newsroom'",
  ).get() as { state: string; recovery_count: number };
  assert.deepEqual({ ...recovered }, { state: "resolved", recovery_count: 2 });
  assert.equal(sent.filter((subject) => subject.includes("RECOVERED")).length, 1);
  database.close();
});

test("intentional source gaps and evidence-validation rejections do not generate failure mail", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const sent: string[] = [];
  const binding = {
    async send(message: { subject: string }) {
      sent.push(message.subject);
      return { messageId: `message-${sent.length}` };
    },
  };
  const env = { VALLEY_DESK_DB: db, NOTIFY_OPS: binding };
  await sendAutomationAlerts(env, {
    notes: { sources: [{ id: "linkedin-person", state: "misconfigured", consecutiveFailures: 99 }] },
    modelSelectedCount: 1,
    modelFailedCount: 1,
    modelValidationRejectedCount: 1,
    modelOperationalFailedCount: 0,
    modelSucceededCount: 0,
  }, new Date("2026-08-28T10:00:00.000Z"));
  assert.deepEqual(sent, []);
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM operational_alerts WHERE state = 'open'").get().count,
    0,
  );
  database.close();
});

test("an empty cooldown queue does not falsely resolve a model outage", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const env = { VALLEY_DESK_DB: db };
  for (let index = 0; index < 2; index += 1) {
    await sendAutomationAlerts(env, {
      notes: { sources: [] },
      modelSelectedCount: 1,
      modelFailedCount: 1,
      modelOperationalFailedCount: 1,
      modelSucceededCount: 0,
    }, new Date(`2026-08-28T0${index}:00:00.000Z`));
  }
  for (let index = 2; index < 4; index += 1) {
    await sendAutomationAlerts(env, {
      notes: { sources: [] },
      modelSelectedCount: 0,
      modelFailedCount: 0,
      modelOperationalFailedCount: 0,
      modelSucceededCount: 0,
    }, new Date(`2026-08-28T0${index}:00:00.000Z`));
  }
  const row = database.prepare(
    "SELECT state, recovery_count FROM operational_alerts WHERE fingerprint = 'valley-desk:model-enrichment'",
  ).get() as { state: string; recovery_count: number };
  assert.deepEqual({ ...row }, { state: "open", recovery_count: 0 });
  database.close();
});

test("daily operational digest claims once per pack and remains bounded", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  await dispatchOperationalAlert(db, undefined, {
    fingerprint: "valley-desk:digest-alert",
    event: "source-degraded",
    severity: "warning",
    threshold: 1,
    now: new Date("2026-08-28T08:00:00.000Z"),
    details: {
      sourceId: "source-1",
      lastSuccessAt: "2026-08-27T08:00:00.000Z",
      failureAgeMs: 86_400_000,
      currentFallback: true,
      nextRetryAt: "2026-08-28T08:15:00.000Z",
      affectedCoverage: "remaining-source-peers",
    },
  });
  const sent: string[] = [];
  const binding = {
    async send(message: { to: string; from: string; subject: string; text: string }) {
      sent.push(message.text);
      return { messageId: "digest-1" };
    },
  };
  const first = await dispatchOperationalDigest(db, binding, new Date("2026-08-28T08:05:00.000Z"));
  assert.equal(first.outcome, "sent");
  const second = await dispatchOperationalDigest(db, binding, new Date("2026-08-28T08:06:00.000Z"));
  assert.equal(second.outcome, "deduped");
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes("source-degraded"));
  assert.match(sent[0], /lastSuccessAt=2026-08-27T08:00:00.000Z/);
  assert.match(sent[0], /failureAgeMs=86400000/);
  assert.match(sent[0], /currentFallback=true/);
  assert.match(sent[0], /nextRetryAt=2026-08-28T08:15:00.000Z/);
  assert.match(sent[0], /affectedCoverage=remaining-source-peers/);
  assert.match(sent[0], /ops: \/ops/);
  database.close();
});

test("daily operational digest groups related source alerts by subsystem and institution", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const groupKey = "valley-desk:rss:inst-cooper";
  await recordOperationalAlert(db, {
    fingerprint: "valley-desk:grouped-primary",
    event: "source-degraded",
    severity: "warning",
    conditionState: "blocked",
    institutionId: "inst-cooper",
    subsystem: "rss",
    groupKey,
    notify: false,
    now: new Date("2026-08-28T08:00:00.000Z"),
    details: { sourceId: "source-1", httpStatus: 403 },
  });
  await recordOperationalAlert(db, {
    fingerprint: "valley-desk:grouped-fallback",
    event: "source-fallback-active",
    severity: "warning",
    conditionState: "degraded",
    institutionId: "inst-cooper",
    subsystem: "rss",
    groupKey,
    notify: false,
    now: new Date("2026-08-28T08:01:00.000Z"),
    details: { sourceId: "source-2", currentFallback: true },
  });
  const sent: string[] = [];
  const binding = {
    async send(message: { text: string }) {
      sent.push(message.text);
      return { messageId: "grouped-digest" };
    },
  };
  const result = await dispatchOperationalDigest(db, binding, new Date("2026-08-28T08:05:00.000Z"));
  assert.equal(result.outcome, "sent");
  assert.equal(sent.length, 1);
  assert.match(sent[0], /alerts: 2/);
  assert.match(sent[0], /groups: 1/);
  assert.match(sent[0], /rss\/inst-cooper/);
  assert.match(sent[0], /source-1/);
  assert.match(sent[0], /source-2/);
  database.close();
});

test("news article extraction cleanup expires stale rows and preserves recent success and backoff", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const now = new Date("2026-08-27T12:00:00.000Z");
  const stale = new Date(now.getTime() - (NEWS_ARTICLE_RETENTION_DAYS + 5) * 86_400_000).toISOString();
  const recent = "2026-08-26T12:00:00.000Z";
  const futureBackoff = "2026-08-28T12:00:00.000Z";
  const cachedText = "A bounded extracted article body that remains available after cleanup.";
  await persistNewsArticleExtractions(db, [
    {
      url: "https://news.christianacare.org/stale-failure",
      state: "failed",
      cachedText: null,
      method: null,
      attemptCount: 3,
      lastAttemptedAt: stale,
      lastSuccessAt: null,
      nextAttemptAt: stale,
      error: "HTTP 503",
      attemptedAt: stale,
    },
    {
      url: "https://news.christianacare.org/recent-success",
      state: "success",
      cachedText,
      method: "article",
      attemptCount: 1,
      lastAttemptedAt: recent,
      lastSuccessAt: recent,
      nextAttemptAt: "2026-09-02T12:00:00.000Z",
      error: null,
      attemptedAt: recent,
    },
    {
      url: "https://news.christianacare.org/active-backoff",
      state: "failed",
      cachedText,
      method: "article",
      attemptCount: 2,
      lastAttemptedAt: stale,
      lastSuccessAt: stale,
      nextAttemptAt: futureBackoff,
      error: "Timed out",
      attemptedAt: stale,
    },
  ]);
  await cleanupNewsArticleExtractions(db, now);
  const remaining = [...(await readNewsArticleExtractions(db)).keys()].sort();
  assert.deepEqual(remaining, [
    "https://news.christianacare.org/active-backoff",
    "https://news.christianacare.org/recent-success",
  ]);
  assert.equal((await readNewsArticleExtractions(db, ["https://news.christianacare.org/recent-success"])).get("https://news.christianacare.org/recent-success")?.cachedText, cachedText);

  const overflow = Array.from({ length: NEWS_ARTICLE_MAX_ROWS + 5 }, (_, index) => ({
    url: `https://news.christianacare.org/overflow-${index}`,
    state: "failed" as const,
    cachedText: null,
    method: null,
    attemptCount: 1,
    lastAttemptedAt: `2026-08-01T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
    lastSuccessAt: null,
    nextAttemptAt: stale,
    error: "HTTP 404",
    attemptedAt: stale,
  }));
  await persistNewsArticleExtractions(db, overflow);
  await cleanupNewsArticleExtractions(db, now);
  const afterCap = await readNewsArticleExtractions(db);
  assert.ok(afterCap.size <= NEWS_ARTICLE_MAX_ROWS);
  assert.ok(afterCap.has("https://news.christianacare.org/recent-success"));
  assert.ok(afterCap.has("https://news.christianacare.org/active-backoff"));
  const worker = readFileSync(join(root, "worker.js"), "utf8");
  assert.ok(worker.includes("cleanupNewsArticleExtractions"));
  assert.ok(worker.includes("news-extraction-cleanup"));
  assert.ok(worker.indexOf("cleanupNewsArticleExtractions") < worker.indexOf("runAutomation(env"));
  database.close();
});

test("News article extraction state upserts idempotently and preserves cached text on failure", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const url = "https://news.christianacare.org/article";
  const cachedText = "A bounded extracted article body that remains available after a refresh failure.";
  await persistNewsArticleExtractions(db, [{
    url,
    state: "success",
    cachedText,
    method: "article",
    attemptCount: 1,
    lastAttemptedAt: "2026-08-20T12:00:00.000Z",
    lastSuccessAt: "2026-08-20T12:00:00.000Z",
    nextAttemptAt: "2026-08-27T12:00:00.000Z",
    error: null,
    attemptedAt: "2026-08-20T12:00:00.000Z",
  }]);
  await persistNewsArticleExtractions(db, [{
    url,
    state: "failed",
    cachedText,
    method: "article",
    attemptCount: 1,
    lastAttemptedAt: "2026-08-27T12:00:00.000Z",
    lastSuccessAt: "2026-08-20T12:00:00.000Z",
    nextAttemptAt: "2026-08-27T18:00:00.000Z",
    error: "HTTP 503",
    attemptedAt: "2026-08-27T12:00:00.000Z",
  }]);
  const state = await readNewsArticleExtractions(db, [url]);
  assert.equal(state.size, 1);
  assert.equal(state.get(url)?.state, "failed");
  assert.equal(state.get(url)?.cachedText, cachedText);
  assert.equal(state.get(url)?.error, "HTTP 503");
  database.close();
});
