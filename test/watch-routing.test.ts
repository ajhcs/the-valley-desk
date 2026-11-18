import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker.js";
import { canonicalJson, MAX_PUBLIC_WATCH_BYTES, sha256, type WatchPublicRecord } from "../src/content/watch-schema";
import { projectPolicyDossier, projectTechnologyProfile } from "../src/content/watch-projection";
import type { DeliveryDependencyKind, WatchDeliveryManifest } from "../src/content/watch-delivery";
import { decodeWatchResponse, parseWatchResponse, WatchReadError, type WatchReadData } from "../src/content/watch-response";
import { applyReviewedWatchProjection, readWatchDirectory, expireWatchGenerations } from "../src/ingest/watch-persistence";
import { recordWatchDependencyHead } from "../src/ingest/watch-delivery";
import type { D1DatabaseLike } from "../src/ingest/persistence";
import { decorateHtml, decorateWatchHtml, watchPrimaryNoscript } from "../src/lib/crawler-html";
import { normalizePublicFeatures, publicFeatures, publicFeaturesFromEnv } from "../src/lib/public-features";
import { navSection } from "../src/lib/nav";
import { llmsTxt } from "../src/lib/canonical";
import { catalogDependentPath, createCatalogNavigationBoundary, reloadActiveCatalogDocument, sameOriginDocumentHref } from "../src/lib/catalog-navigation";
import { isWatchPagePath, parseWatchPageRoute, readWatchPage, watchPageHead, type WatchPageResult } from "../src/lib/watch-page";
import { createWatchHeadStore } from "../src/ui/watch/watch-head-state";
import { pdfDatabase } from "./helpers/policy-pdf";
import { NOW, syntheticFixture } from "./fixtures/watch-contracts/synthetic";
import { stageSyntheticDelivery, syntheticDeliveryForRecord } from "./fixtures/watch-delivery/synthetic";

const origin = "https://thevalleydesk.org";
const template = '<!doctype html><html><head><title>The Valley Desk</title></head><body><noscript id="tvd-primary">Original fallback</noscript><div id="root"></div></body></html>';
const policyFixture = await syntheticFixture("policy");
const technologyFixture = await syntheticFixture("technology");
const policy = await projectPolicyDossier(policyFixture.draft, policyFixture.context);
const technology = await projectTechnologyProfile(technologyFixture.draft, technologyFixture.context);
const fingerprint = await sha256("synthetic-routing-input");

function environment(extra: Record<string, unknown> = {}) {
  const requests: string[] = [];
  return { requests, env: { PUBLIC_ORIGIN: origin, ASSETS: { async fetch(input: Request | URL) {
    const path = new URL(input instanceof Request ? input.url : input).pathname;
    requests.push(path);
    if (path === "/feed.json") return new Response(JSON.stringify({ product: "the-valley-desk", version: "1", generatedAt: NOW, items: [] }),
      { headers: { "content-type": "application/json" } });
    return new Response(path === "/index.html" ? template : "Not found", { status: path === "/index.html" ? 200 : 404 });
  } }, ...extra } };
}
function body(html: string) { return /<noscript id="tvd-primary">([\s\S]*?)<\/noscript>/.exec(html)?.[1] ?? ""; }
function assertPrivateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
  assert.equal(response.headers.get("x-robots-tag"), "noindex");
  assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
}
function detailData(item: WatchPublicRecord = policy): WatchReadData {
  return { response: parseWatchResponse({ version: "watch-detail-1", item, asOf: NOW }, item.kind, item.slug), stale: false };
}
function directoryData(items: WatchPublicRecord[] = [policy]): WatchReadData {
  return { response: parseWatchResponse({ version: "watch-directory-1", generation: 1, items, asOf: NOW, nextCursor: null }, items[0]?.kind ?? "policy"), stale: false };
}
function readResponse(data: WatchReadData, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data.response), { headers: { "content-type": "application/json", ...headers } });
}

// Synthetic SQL setup deliberately represents an already reviewed projection.
// It is never a source qualification tool or an application publishing path.
async function publish(db: D1DatabaseLike, item: WatchPublicRecord) {
  const compiled = await syntheticDeliveryForRecord(item, 1, "synthetic-routing-gates-v1");
  item = compiled.record;
  await db.prepare(`INSERT INTO watch_subjects
    (id,kind,external_key,slug,input_revision,input_sha256,first_seen_at) VALUES(?,?,?,?,1,?,?)`)
    .bind(item.id, item.kind, `synthetic-routing:${item.id}`, item.slug, fingerprint, NOW).run();
  const json = canonicalJson(item);
  const decisionId = `routing-review-${item.id}`;
  await db.prepare(`INSERT INTO watch_reviewed_projections
    (id,subject_id,input_revision,input_sha256,expected_public_revision,payload_sha256,payload_json,reviewer_id,gate_version,reviewed_at)
    VALUES(?,?,1,?,0,?,?,?,?,?)`).bind(decisionId, item.id, fingerprint, await sha256(json), json,
      "synthetic-editor", "synthetic-routing-gates-v1", NOW).run();
  await stageSyntheticDelivery(db, decisionId, compiled.handle);
  await applyReviewedWatchProjection(db, decisionId, new Date(NOW));
  return compiled;
}

async function changeDependency(db: D1DatabaseLike, manifest: WatchDeliveryManifest, field: string, kind: DeliveryDependencyKind) {
  const dependency = manifest.groups.find(group => group.field === field)?.dependencies.find(binding => binding.kind === kind);
  assert.ok(dependency, `missing synthetic ${field}/${kind} dependency`);
  const head = await db.prepare("SELECT revision FROM watch_dependency_heads WHERE dependency_key=?")
    .bind(dependency.key).first<{ revision: number }>();
  assert.ok(head);
  const revision = head.revision + 1;
  await recordWatchDependencyHead(db, { key: dependency.key, kind, revision, digest: await sha256(`synthetic-routing-change:${revision}`),
    immutableRecordId: `routing-head-${dependency.key}-${revision}`, changedAt: NOW });
}

test("Watch page routes use literal canonical slugs and only their shared query grammar", () => {
  assert.equal(parseWatchPageRoute("/news"), null);
  assert.equal(isWatchPagePath("/ops/api/policy-watch"), false);
  assert.equal(parseWatchPageRoute("/policy-watch/")?.apiPath, "/api/v2/watch/policy");
  assert.equal(parseWatchPageRoute("/technology-watch/synthetic-technology")?.apiPath,
    "/api/v2/watch/technology/synthetic-technology?lookup=slug");
  assert.equal(parseWatchPageRoute("/policy-watch", "?q=hello%20world&limit=2")?.apiPath,
    "/api/v2/watch/policy?q=hello+world&limit=2");
  for (const path of ["/policy-watch/updates", "/technology-watch/UPPER", "/policy-watch/%73lug", "/policy-watch/x/y", "/policy-watch//", `/policy-watch/${"a".repeat(101)}`]) {
    assert.equal(parseWatchPageRoute(path)?.status, 404, path);
  }
  for (const query of ["?q=a&q=b", "?limit=01", "?stage=enacted", "?type=software", "?q=%00", "?__proto__=x", "?constructor=", "?invalid_search_field=", "?unknown=1", "?jurisdiction=NY", `?q=${"a".repeat(121)}`]) {
    assert.equal(parseWatchPageRoute("/policy-watch", query)?.status, 400, query);
  }
  assert.equal(parseWatchPageRoute("/policy-watch/synthetic-policy", "?lookup=slug")?.status, 400);
});

test("disabled Watch pages return 404 for GET and HEAD without reading D1 or a feed", async () => {
  let reads = 0;
  const db = { prepare() { reads++; throw Error("must not read"); } };
  for (const flag of [undefined, "false", "TRUE", " true", true]) {
    for (const path of ["/policy-watch", "/technology-watch/synthetic-technology"]) {
      const { env, requests } = environment({ WATCH_PUBLIC_ENABLED: flag, VALLEY_DESK_DB: db });
      for (const method of ["GET", "HEAD"]) {
        const response = await worker.fetch(new Request(`${origin}${path}`, { method }), env, {});
        assert.equal(response.status, 404); assertPrivateHeaders(response);
        const html = await response.text();
        if (method === "HEAD") assert.equal(html, "");
        else { assert.match(body(html), /This page is not published/); assert.doesNotMatch(html, /__VALLEY_DESK_DYNAMIC_ITEMS__|application\/ld\+json/); }
      }
      assert.deepEqual(requests, ["/index.html", "/index.html"]);
    }
  }
  assert.equal(reads, 0);
});

test("private Watch-shaped paths remain outside public routing and never reach D1", async () => {
  let reads = 0;
  const { env, requests } = environment({ WATCH_PUBLIC_ENABLED: "true", VALLEY_DESK_DB: { prepare() { reads++; throw Error("private read"); } } });
  for (const path of ["/ops", "/ops/api/watch/policy", "/ops/api/technology-watch"]) {
    const response = await worker.fetch(new Request(`${origin}${path}`, { headers: { "cf-access-authenticated-user-email": "synthetic@example.test" } }), env, {});
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /Synthetic|watch-directory-1/);
  }
  assert.equal(reads, 0); assert.deepEqual(requests, []);
});

test("invalid Watch page paths and query fields fail before any data lookup", async () => {
  let reads = 0;
  const { env } = environment({ WATCH_PUBLIC_ENABLED: "true", VALLEY_DESK_DB: { prepare() { reads++; throw Error("must not read"); } } });
  for (const [path, expected] of [["/policy-watch/updates", 404], ["/technology-watch/Uppercase", 404], ["/policy-watch?__proto__=x", 400],
    ["/policy-watch?constructor=&invalid_search_field=", 400], ["/technology-watch?license=mit", 400], ["/policy-watch/synthetic-policy?q=x", 400]]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await worker.fetch(new Request(`${origin}${path}`, { method }), env, {});
      assert.equal(response.status, expected); assertPrivateHeaders(response);
      if (method === "HEAD") assert.equal(await response.text(), "");
      else assert.doesNotMatch(await response.text(), /Synthetic health|watch-directory-1/);
    }
  }
  assert.equal(reads, 0);
});

test("enabled Watch pages are read-only and unavailable D1 is 503, never empty 200", async () => {
  const { env } = environment({ WATCH_PUBLIC_ENABLED: "true" });
  for (const path of ["/policy-watch", "/technology-watch/synthetic-technology"]) {
    const unavailable = await worker.fetch(new Request(`${origin}${path}`), env, {});
    assert.equal(unavailable.status, 503); assertPrivateHeaders(unavailable);
    const html = await unavailable.text(); assert.match(body(html), /temporarily unavailable/); assert.doesNotMatch(html, /No accepted records|0 records/);
    const denied = await worker.fetch(new Request(`${origin}${path}`, { method: "POST" }), env, {});
    assert.equal(denied.status, 405); assert.equal(denied.headers.get("allow"), "GET, HEAD"); assertPrivateHeaders(denied);
  }
});

test("asset failures preserve hidden 404 and unavailable 503 instead of throwing or claiming success", async () => {
  for (const fetch of [async () => new Response("missing", { status: 404 }), async () => { throw Error("private-asset-diagnostic"); }]) {
    for (const enabled of [undefined, "true"]) {
      const { env } = environment({ WATCH_PUBLIC_ENABLED: enabled, ASSETS: { fetch } });
      const response = await worker.fetch(new Request(`${origin}/policy-watch`), env, {});
      assert.equal(response.status, enabled ? 503 : 404); assertPrivateHeaders(response);
      const html = await response.text(); assert.match(html, /<meta name="robots" content="noindex"/);
      assert.match(html, /<main><h1>/);
      assert.doesNotMatch(html, /private-asset-diagnostic|No accepted records/);
    }
  }
});

test("real accepted D1 directory and detail reads become Watch HTML, without v1 content", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(NOW) });
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  await publish(db, policy); await publish(db, technology);
  const { env, requests } = environment({ WATCH_PUBLIC_ENABLED: "true", VALLEY_DESK_DB: db });
  for (const item of [policy, technology]) {
    const base = `/${item.kind === "policy" ? "policy" : "technology"}-watch`;
    for (const path of [base, `${base}/${item.slug}`]) {
      const response = await worker.fetch(new Request(`${origin}${path}`), env, {});
      assert.equal(response.status, 200); assertPrivateHeaders(response);
      assert.equal(response.headers.get("x-watch-data-state"), "unknown");
      const html = await response.text();
      assert.match(html, /<meta name="robots" content="noindex"/);
      assert.ok(body(html).includes(item.title));
      assert.ok(html.includes(`<link rel="canonical" href="${origin}${path}"`));
      assert.match(html, /Source-check freshness is not reported/);
      assert.ok(html.includes(`Published projection as of: <time datetime="${NOW}"`));
      assert.doesNotMatch(html, /__VALLEY_DESK_DYNAMIC_ITEMS__|__VALLEY_DESK_WITHDRAWN_IDS__|application\/ld\+json|rel="alternate"|NewsArticle/);
      const head = await worker.fetch(new Request(`${origin}${path}`, { method: "HEAD" }), env, {});
      assert.equal(head.status, 200); assertPrivateHeaders(head); assert.equal(await head.text(), "");
    }
  }
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM published_content").get()!.n, 0);
  assert.ok(requests.every(path => path === "/index.html"));
});

test("unknown dossiers are real 404 and no slug/ID fallback or directory scan occurs", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(NOW) });
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  await publish(db, policy);
  const { env } = environment({ WATCH_PUBLIC_ENABLED: "true", VALLEY_DESK_DB: db });
  for (const slug of [policy.id, "not-published"]) {
    const response = await worker.fetch(new Request(`${origin}/policy-watch/${slug}`), env, {});
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), new RegExp(policy.title));
  }
});

test("directory query, genuine empty result and expired cursor keep their distinct statuses", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(NOW) });
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  await publish(db, policy);
  await publish(db, { ...policy, id: "policy-2", slug: "synthetic-policy-two", title: "Zeta synthetic policy" });
  const { env } = environment({ WATCH_PUBLIC_ENABLED: "true", VALLEY_DESK_DB: db });
  const empty = await worker.fetch(new Request(`${origin}/policy-watch?jurisdiction=NJ`), env, {});
  assert.equal(empty.status, 200); assert.match(body(await empty.text()), /No records match these filters/);
  const filtered = await worker.fetch(new Request(`${origin}/policy-watch?q=Zeta&jurisdiction=PA`), env, {});
  assert.equal(filtered.status, 200);
  const html = await filtered.text();
  assert.match(body(html), /Zeta synthetic policy/); assert.ok(!body(html).includes(policy.title));
  assert.ok(html.includes(`<link rel="canonical" href="${origin}/policy-watch"`));
  const page = await readWatchDirectory(db, { kind: "policy", limit: 1 }); assert.ok(page.nextCursor);
  const first = await worker.fetch(new Request(`${origin}/policy-watch?limit=1`), env, {});
  assert.match(body(await first.text()), /rel="next" href="https:\/\/thevalleydesk.org\/policy-watch\?limit=1&amp;cursor=/);
  await publish(db, { ...policy, id: "policy-3", slug: "synthetic-policy-three", title: "Other synthetic policy" });
  await expireWatchGenerations(db, 3);
  const expired = await worker.fetch(new Request(`${origin}/policy-watch?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`), env, {});
  assert.equal(expired.status, 410); assertPrivateHeaders(expired);
  assert.match(body(await expired.text()), /snapshot has expired/);
});

test("current policy dependency changes redact meaning, then hold required metadata in real Worker HTML", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(NOW) });
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const accepted = await publish(db, policy);
  const { env } = environment({ WATCH_PUBLIC_ENABLED: "true", VALLEY_DESK_DB: db });
  const path = `/policy-watch/${accepted.record.slug}`;
  const before = await worker.fetch(new Request(`${origin}${path}`), env, {});
  assert.equal(before.status, 200); assert.ok((await before.text()).includes(policy.interpretation.summary!.value));
  await changeDependency(db, accepted.manifest, "interpretation", "policy-definition");
  const redacted = await worker.fetch(new Request(`${origin}${path}`), env, {});
  assert.equal(redacted.status, 200); assert.equal(redacted.headers.get("x-watch-delivery-as-of"), NOW);
  const html = await redacted.text();
  assert.ok(html.includes(policy.title)); assert.ok(!html.includes(policy.interpretation.summary!.value));
  assert.match(body(html), /evidence-changed/);
  await changeDependency(db, accepted.manifest, "title", "accepted-fact");
  for (const method of ["GET", "HEAD"]) {
    const held = await worker.fetch(new Request(`${origin}${path}`, { method }), env, {});
    assert.equal(held.status, 409); assertPrivateHeaders(held);
    const heldHtml = await held.text();
    assert.ok(!heldHtml.includes(policy.title)); assert.ok(!heldHtml.includes(policy.interpretation.summary!.value));
    if (method === "HEAD") assert.equal(heldHtml, "");
    else assert.match(heldHtml, /Record held for review/);
  }
});

test("a current local connection expires into a held dossier and disappears from Worker directory HTML", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(NOW) });
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const item = structuredClone(technology);
  item.localRelationships[0]!.value = { ...item.localRelationships[0]!.value,
    temporalStatus: "current", validThrough: "2026-09-12T13:00:30.000Z" };
  const accepted = await publish(db, item);
  const { env } = environment({ WATCH_PUBLIC_ENABLED: "true", VALLEY_DESK_DB: db });
  const path = `/technology-watch/${accepted.record.slug}`;
  assert.equal((await worker.fetch(new Request(`${origin}${path}`), env, {})).status, 200);
  t.mock.timers.tick(31_000);
  const held = await worker.fetch(new Request(`${origin}${path}`), env, {});
  assert.equal(held.status, 409); assert.ok(!(await held.text()).includes(item.title));
  const directory = await worker.fetch(new Request(`${origin}/technology-watch`), env, {});
  assert.equal(directory.status, 200);
  const html = await directory.text(); assert.ok(!html.includes(item.title));
  assert.match(body(html), /No accepted records are listed yet/);
});

test("a changed code-license dependency removes OSS membership before the Worker renders results", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(NOW) });
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const item = structuredClone(technology);
  item.licenses[0]!.value = { ...item.licenses[0]!.value, classification: "osi-open-source", spdxId: "MIT", conditions: [] };
  item.oss = true;
  const accepted = await publish(db, item);
  const { env } = environment({ WATCH_PUBLIC_ENABLED: "true", VALLEY_DESK_DB: db });
  const query = `${origin}/technology-watch?license=osi-open-source`;
  assert.ok((await (await worker.fetch(new Request(query), env, {})).text()).includes(item.title));
  await changeDependency(db, accepted.manifest, "license", "artifact-license");
  const filtered = await worker.fetch(new Request(query), env, {});
  assert.equal(filtered.status, 200);
  const filteredHtml = await filtered.text(); assert.ok(!filteredHtml.includes(item.title));
  assert.match(body(filteredHtml), /No records match these filters/);
  const detail = await worker.fetch(new Request(`${origin}/technology-watch/${item.slug}`), env, {});
  assert.equal(detail.status, 200);
  const html = await detail.text(); assert.ok(html.includes(item.title));
  assert.match(body(html), /License terms not yet established/); assert.doesNotMatch(body(html), /osi-open-source|MIT/);
});

test("Watch HTML escapes source text and preserves literal quote bytes, including dollar substitutions", async () => {
  const item = structuredClone(policy);
  item.title = 'Synthetic <title> & "context" $& $$';
  item.sources[0]!.quote = 'Literal </noscript><script>fixture</script> & "quote" $& $$ $` $\'';
  item.sources[0]!.label = 'Synthetic <source> & "label"';
  item.sources[0]!.locator = '<page> $&';
  const result: WatchPageResult = { route: parseWatchPageRoute(`/policy-watch/${item.slug}`)!, status: 200, data: detailData(item) };
  const html = decorateWatchHtml({ html: template, result, origin, nonce: 'test"nonce' });
  assert.match(html, /Synthetic &lt;title&gt; &amp; &quot;context&quot; \$&amp; \$\$/);
  assert.match(body(html), /&lt;\/noscript&gt;&lt;script&gt;fixture&lt;\/script&gt;/);
  assert.match(body(html), /<blockquote>/);
  assert.ok(body(html).includes('$&amp; $$ $` $\''));
  assert.doesNotMatch(html, /<script>fixture|<page>|Original fallback/);
  assert.equal((html.match(/<noscript id="tvd-primary">/g) ?? []).length, 1);
  assert.match(html, /nonce="test&quot;nonce"/);
});

test("noscript technology context keeps historical locality, workflow and restricted license terms", () => {
  const result: WatchPageResult = { route: parseWatchPageRoute(`/technology-watch/${technology.slug}`)!, status: 200, data: detailData(technology) };
  const html = watchPrimaryNoscript(result, origin);
  assert.match(html, /historical connection/); assert.match(html, /Workflow/); assert.match(html, /maintainer-documented/);
  assert.match(html, /restricted-source/); assert.match(html, /clinical use/i); assert.match(html, /License source/);
  assert.match(html, /Accepted sources/); assert.doesNotMatch(html, /<blockquote>/);
  assert.doesNotMatch(html, /desk-tested|production-ready|permissive OSS/);
});

test("unknown technology setup is explicit and never converted to a documented deployment", () => {
  const item = structuredClone(technology);
  item.setup!.value = { verification: "not-verified", version: null, prerequisites: null, guideUrl: null };
  item.workflow = null;
  const result: WatchPageResult = { route: parseWatchPageRoute(`/technology-watch/${item.slug}`)!, status: 200, data: detailData(item) };
  const html = watchPrimaryNoscript(result, origin);
  assert.match(html, /Version not established/); assert.match(html, /Prerequisites not established/);
  assert.match(html, /Workflow not yet established/); assert.match(html, /not-verified/);
  assert.doesNotMatch(html, /Setup guide|maintainer-documented|desk-tested/);
});

test("only explicit accepted fallback responses are labeled stale; projection is not source freshness", async () => {
  const request = new Request(`${origin}/policy-watch`);
  for (const stale of [false, true]) {
    const page = await readWatchPage(request, true, async () => readResponse(directoryData(), {
      ...(stale ? { "X-Watch-Data-State": "stale" } : {}), "X-Watch-Delivery-As-Of": NOW,
    }));
    assert.equal(page?.status, 200); assert.equal(page?.data?.stale, stale); assert.equal(page?.deliveryAsOf, NOW);
    const html = watchPrimaryNoscript(page!, origin);
    assert.equal(html.includes("last accepted fallback"), stale);
    assert.match(html, /Source-check freshness is not reported/);
  }
});

test("held, malformed and unavailable responses do not leak old facts or operator error text", async () => {
  const request = new Request(`${origin}/policy-watch/${policy.slug}`);
  for (const status of [400, 404, 409, 410, 503]) {
    const result = await readWatchPage(request, true, async () => new Response(JSON.stringify({ error: { code: "private-code", message: "private-review-notes" } }), { status }));
    assert.equal(result?.status, status); assert.equal(result?.data, undefined);
    const html = decorateWatchHtml({ html: template, result: result!, origin, nonce: "test" });
    assert.doesNotMatch(html, /private-review-notes|private-code/); assert.ok(!html.includes(policy.title));
    if (status === 409) assert.match(html, /held for review/);
  }
  for (const payload of [{ version: "watch-detail-1", item: { ...policy, privateNotes: "must not appear" }, asOf: NOW },
    { version: "watch-detail-1", item: technology, asOf: NOW }, { version: "watch-detail-1", item: { ...policy, slug: "other-slug" }, asOf: NOW }]) {
    const result = await readWatchPage(request, true, async () => new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }));
    assert.equal(result?.status, 503); assert.equal(result?.data, undefined);
  }
});

test("internal page lookup always uses the fixed local API and explicit slug mode", async () => {
  let called = 0;
  const page = await readWatchPage(new Request(`${origin}/policy-watch/${policy.slug}`, { method: "HEAD", headers: { authorization: "synthetic-private" } }), true, async request => {
    called++; assert.equal(request.method, "GET");
    assert.equal(request.url, `${origin}/api/v2/watch/policy/${policy.slug}?lookup=slug`);
    assert.equal(request.headers.get("authorization"), null);
    return readResponse(detailData());
  });
  assert.equal(called, 1); assert.equal(page?.status, 200);
  const disabled = await readWatchPage(new Request(`${origin}/policy-watch`), false, async () => { throw Error("not called"); });
  assert.equal(disabled?.status, 404);
});

test("shared Watch decoding rejects and closes malformed or oversized response streams", async () => {
  const maximum = MAX_PUBLIC_WATCH_BYTES + 16_384;
  const invalid = (error: unknown) => error instanceof WatchReadError && error.code === "invalid-response";
  for (const headers of [{ "content-type": "text/html" },
    { "content-type": "application/json", "content-length": String(maximum + 1) }]) {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    await assert.rejects(decodeWatchResponse(new Response(stream, { headers }), "policy", policy.slug), invalid);
    assert.equal(cancelled, true);
  }
  for (const bytes of [new Uint8Array(maximum + 1), new Uint8Array([0xff]), new TextEncoder().encode("{not-json")]) {
    let cancelled = false;
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) controller.close();
        else { controller.enqueue(bytes); sent = true; }
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    await assert.rejects(decodeWatchResponse(new Response(stream, {
      headers: { "content-type": "application/json", "content-length": "1" },
    }), "policy", policy.slug), invalid);
    if (bytes.byteLength > maximum || bytes[0] === 0xff) assert.equal(cancelled, true);
    assert.equal(stream.locked, false);
  }
});

test("shared Watch decoding preserves chunked UTF-8 and ignores malformed delivery timestamps", async () => {
  const item = { ...policy, title: "Synthetic caf\u00e9 policy" };
  const bytes = new TextEncoder().encode(JSON.stringify(detailData(item).response));
  const split = bytes.indexOf(0xc3) + 1;
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(bytes.slice(0, split)); controller.enqueue(bytes.slice(split)); controller.close();
  } });
  const data = await decodeWatchResponse(new Response(stream, { headers: { "content-type": "application/json; charset=utf-8" } }), "policy", policy.slug);
  assert.equal(data.response.version, "watch-detail-1");
  assert.equal(data.response.version === "watch-detail-1" && data.response.item.title, item.title);
  const page = await readWatchPage(new Request(`${origin}/policy-watch/${policy.slug}`), true,
    async () => readResponse(detailData(), { "X-Watch-Delivery-As-Of": "2026-09-12" }));
  assert.equal(page?.status, 200); assert.equal(page?.deliveryAsOf, undefined);
});

test("metadata request tokens clear old facts and ignore late resolution or cleanup across routes", () => {
  const store = createWatchHeadStore();
  let changes = 0;
  const unsubscribe = store.subscribe(() => changes++);
  const routeA = parseWatchPageRoute(`/policy-watch/${policy.slug}`)!;
  const a = store.begin(routeA); store.ready(a, detailData());
  assert.ok(store.getSnapshot()?.head.title.includes(policy.title));
  const routeB = parseWatchPageRoute(`/technology-watch/${technology.slug}`)!;
  const b = store.begin(routeB);
  assert.equal(store.getSnapshot()?.key, routeB.key);
  assert.ok(!store.getSnapshot()?.head.title.includes(policy.title));
  store.ready(a, detailData()); store.error(a, "held"); store.clear(a);
  assert.equal(store.getSnapshot()?.key, routeB.key);
  store.ready(b, detailData(technology)); assert.ok(store.getSnapshot()?.head.title.includes(technology.title));
  for (const error of ["held", "unavailable", "not-found"] as const) {
    const token = store.begin(routeB); store.ready(token, detailData(technology)); store.error(token, error);
    assert.ok(!store.getSnapshot()?.head.title.includes(technology.title));
    assert.equal(store.getSnapshot()?.head.status, error === "held" ? 409 : error === "not-found" ? 404 : 503);
  }
  const back = store.begin(routeA); store.ready(back, detailData());
  const retry = store.begin(routeA); store.ready(back, detailData()); store.clear(back);
  assert.ok(!store.getSnapshot()?.head.title.includes(policy.title));
  store.error(retry, "held"); assert.match(store.getSnapshot()!.head.title, /held for review/);
  store.clear(retry); assert.equal(store.getSnapshot(), null); assert.equal(store.getServerSnapshot(), null);
  assert.ok(changes > 10); unsubscribe();
});

test("metadata uses the exact active route/search key and directory canonicals exclude filters", () => {
  const store = createWatchHeadStore();
  const first = parseWatchPageRoute("/policy-watch", "?q=one&jurisdiction=PA")!;
  const second = parseWatchPageRoute("/policy-watch", "?q=two&jurisdiction=PA")!;
  const token = store.begin(first); store.ready(token, directoryData());
  const next = store.begin(second); store.clear(token);
  assert.equal(store.getSnapshot()?.key, "/policy-watch?q=two&jurisdiction=PA");
  assert.equal(store.getSnapshot()?.head.canonicalPath, "/policy-watch");
  store.clear(next);
  assert.equal(watchPageHead({ route: parseWatchPageRoute("/policy-watch/updates")!, status: 404 }).status, 404);
});

test("public policy background uses an exact-true independent gate before every D1 read", async () => {
  let reads = 0;
  const db = { prepare() { reads++; throw Error("must not read held background"); } };
  for (const flag of [undefined, false, true, "false", "TRUE", " true", "true "]) {
    const { env } = environment({ POLICY_BACKGROUND_PUBLIC_ENABLED: flag, WATCH_PUBLIC_ENABLED: "true", VALLEY_DESK_DB: db });
    for (const method of ["GET", "HEAD"]) {
      for (const path of ["/policy", "/policy/"]) {
        const response = await worker.fetch(new Request(`${origin}${path}`, { method }), env, {});
        assert.equal(response.status, 404); assertPrivateHeaders(response);
        const html = await response.text();
        if (method === "HEAD") assert.equal(html, "");
        else {
          assert.match(body(html), /This page is not published/);
          assert.match(html, /__VALLEY_DESK_PUBLIC_FEATURES__=\{"policyBackground":false,"watch":true\}/);
          assert.doesNotMatch(html, /Healthcare policy watchlist|public baseline JSON|application\/ld\+json/);
        }
      }
      const response = await worker.fetch(new Request(`${origin}/api/policy-watchlist`, { method }), env, {});
      assert.equal(response.status, 503);
      for (const header of ["cache-control", "cdn-cache-control"]) assert.equal(response.headers.get(header), "no-store");
      assert.equal(response.headers.get("x-robots-tag"), "noindex");
      if (method === "HEAD") assert.equal(await response.text(), "");
      else assert.deepEqual(await response.json(), { error: "policy-background-not-enabled" });
    }
  }
  assert.equal(reads, 0);
});

test("explicit public background opt-in preserves baseline reads and off-state leaves private review unchanged", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const { env } = environment({ POLICY_BACKGROUND_PUBLIC_ENABLED: "true", VALLEY_DESK_DB: db, REVIEW_API_TOKEN: "synthetic-review-only" });
  const response = await worker.fetch(new Request(`${origin}/api/policy-watchlist`), env, {});
  assert.equal(response.status, 200); assert.equal((await response.json()).kind, "policy-background");
  const page = await worker.fetch(new Request(`${origin}/policy`), env, {});
  assert.equal(page.status, 200);
  const html = await page.text(); assert.match(body(html), /Healthcare policy watchlist/);
  assert.match(html, /__VALLEY_DESK_PUBLIC_FEATURES__=\{"policyBackground":true,"watch":false\}/);
  const off = { ...env, POLICY_BACKGROUND_PUBLIC_ENABLED: "false" };
  const privateRead = await worker.fetch(new Request(`${origin}/api/policy-background`, {
    headers: { authorization: "Bearer synthetic-review-only" },
  }), off, {});
  assert.equal(privateRead.status, 200); assert.equal((await privateRead.json()).kind, "policy-background");
  const denied = await worker.fetch(new Request(`${origin}/api/policy-background`), off, {});
  assert.equal(denied.status, 404);
});

test("public feature signals are boolean allowlists and hidden policy HTML is defensive by default", () => {
  for (const value of [undefined, true, "true", {}, { policyBackground: "true" }, { policyBackground: false }, Object.create({ policyBackground: true })]) {
    assert.deepEqual(normalizePublicFeatures(value), { policyBackground: false, watch: false });
  }
  assert.deepEqual(normalizePublicFeatures({ policyBackground: true, privateReviewToken: "discard" }), { policyBackground: true, watch: false });
  assert.deepEqual(publicFeaturesFromEnv({ POLICY_BACKGROUND_PUBLIC_ENABLED: true }), { policyBackground: false, watch: false });
  assert.deepEqual(publicFeaturesFromEnv({ POLICY_BACKGROUND_PUBLIC_ENABLED: "true" }), { policyBackground: true, watch: false });
  assert.deepEqual(publicFeatures(), { policyBackground: false, watch: false });
  const hidden = decorateHtml({ html: template, path: "/policy", origin, nonce: "fixture" });
  assert.match(body(hidden), /This page is not published/); assert.doesNotMatch(hidden, /Healthcare policy watchlist|application\/ld\+json/);
  const accepted = decorateHtml({ html: template, path: "/policy", origin, nonce: "fixture", publicFeatures: { policyBackground: true, watch: false } });
  assert.match(body(accepted), /Healthcare policy watchlist/);
  const watch = decorateWatchHtml({ html: template, result: { route: parseWatchPageRoute("/policy-watch")!, status: 404 }, origin,
    nonce: "fixture", publicFeatures: { policyBackground: true, watch: false } });
  assert.match(watch, /__VALLEY_DESK_PUBLIC_FEATURES__=\{"policyBackground":true,"watch":false\}/);
});

test("Watch routes retain their exact opt-in while public navigation promotes the project directory", async () => {
  for (const flag of [undefined, false, true, "false", "TRUE", " true", "true ", "true"]) {
    const features = publicFeaturesFromEnv({ WATCH_PUBLIC_ENABLED: flag });
    assert.equal(features.watch, flag === "true");
    const html = decorateHtml({ html: template, path: "/", origin, nonce: "fixture", publicFeatures: features });
    for (const path of ["/policy-watch", "/technology-watch"]) {
      assert.ok(!body(html).includes(`${origin}${path}`));
      assert.ok(!llmsTxt(origin).includes(`${origin}${path}`));
    }
    assert.doesNotMatch(body(html), /<h2>Voices<\/h2>/);
    assert.doesNotMatch(llmsTxt(origin), /\[Voices\]/);
    const { env } = environment({ WATCH_PUBLIC_ENABLED: flag });
    const response = await worker.fetch(new Request(`${origin}/llms.txt`), env, {});
    const text = await response.text();
    assert.ok(text.includes(`${origin}/discover/works`));
    assert.doesNotMatch(text, /\[(?:News|Events|Policy Watch|Technology Watch)\]/);
  }
  for (const value of [{ watch: "true" }, Object.create({ watch: true }), { watch: 1 }]) {
    assert.equal(normalizePublicFeatures(value).watch, false);
  }
  assert.deepEqual(normalizePublicFeatures({ watch: true, privateReviewToken: "discard" }), { policyBackground: false, watch: true });
});

test("Watch directory and dossier navigation do not alias legacy Voices URLs", () => {
  for (const section of ["policy-watch", "technology-watch"] as const) {
    for (const suffix of ["", "/", "/accepted-dossier"]) assert.equal(navSection(`/${section}${suffix}`), section);
    assert.equal(navSection(`/${section}-other`), null);
  }
  assert.equal(navSection("/voices/legacy-statement"), "voices");
  const html = decorateHtml({ html: template, path: "/voices", origin, nonce: "fixture", publicFeatures: { policyBackground: false, watch: true } });
  assert.match(body(html), /Voices/);
  assert.match(html, /rel="canonical" href="https:\/\/thevalleydesk.org\/voices"/);
});

test("Watch and legacy background documents reload before catalog views, without reload loops", () => {
  for (const initial of ["/policy-watch", "/technology-watch/a-profile", "/policy", "/policy/"]) {
    const boundary = createCatalogNavigationBoundary(initial);
    assert.equal(boundary.shouldReload(initial), false);
    assert.equal(boundary.shouldReload("/policy-watch/another-record"), false);
    for (const target of ["/", "/news", "/news/a-story", "/events", "/events/an-event", "/voices", "/lab/calendar"]) {
      assert.equal(boundary.shouldReload(target), true, `${initial} -> ${target}`);
      assert.equal(createCatalogNavigationBoundary(target).shouldReload(target), false, "fresh legacy document must not loop");
    }
    assert.equal(boundary.shouldReload("/unpublished"), false);
    assert.equal(boundary.shouldReload("/"), true, "an error link still requires a complete legacy document");
  }
  const legacy = createCatalogNavigationBoundary("/news");
  assert.equal(legacy.shouldReload("/events"), false);
  assert.equal(legacy.shouldReload("/policy-watch"), false);
  assert.equal(legacy.shouldReload("/news"), true, "back/popstate after entering Watch must reload the catalog");
  assert.equal(catalogDependentPath("/newsletters"), false);
  assert.equal(createCatalogNavigationBoundary("/policy-watchlist").shouldReload("/news"), false);
});

test("catalog preloads are inert and document reloads preserve same-origin paths, queries and hashes", () => {
  const legacy = createCatalogNavigationBoundary("/news");
  assert.equal(legacy.shouldReload("/technology-watch", true), false);
  assert.equal(legacy.shouldReload("/events"), false);
  const watch = createCatalogNavigationBoundary("/policy-watch");
  assert.equal(watch.shouldReload("/news", true), false);
  assert.equal(watch.shouldReload("/news"), true);
  for (const href of ["/news?q=C%2B%2B&organization=inst-chop#main-content", "/events?from=2026-09-12&page=2#agenda"]) {
    assert.equal(sameOriginDocumentHref(href, origin), href);
    assert.equal(sameOriginDocumentHref(`${origin}${href}`, origin), href);
  }
  for (const href of ["https://other.example.test/news", "//other.example.test/news", "https://name:pass@thevalleydesk.org/news"]) {
    assert.throws(() => sameOriginDocumentHref(href, origin), TypeError);
  }
});

test("already-committed catalog URLs force a document reload and retain history state across hash changes", () => {
  for (const oldHash of ["#main-content", "#previous"]) {
    let reloads = 0;
    const replacements: Array<{ state: unknown; href: string | URL | null | undefined }> = [];
    const state = { key: "router-key", __TSR_index: 4, retained: "reader-state" };
    const browser = { location: { origin, pathname: "/news", search: "?q=literal%2Bquery", hash: oldHash, reload() { reloads++; } },
      history: { state, replaceState(value: unknown, _unused: string, href?: string | URL | null) { replacements.push({ state: value, href }); } } };
    const href = "/news?q=literal%2Bquery#main-content";
    assert.equal(reloadActiveCatalogDocument(href, browser), true);
    assert.equal(reloads, 1);
    assert.equal(replacements.length, oldHash === "#main-content" ? 0 : 1);
    if (replacements.length) { assert.equal(replacements[0]!.state, state); assert.equal(replacements[0]!.href, href); }
    assert.equal(reloadActiveCatalogDocument("/events#main-content", browser), false);
    assert.equal(reloads, 1);
  }
});
