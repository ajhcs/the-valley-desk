import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ingestRssWithHealth } from "../src/ingest/rss.ts";
import { persistSourceHealth, readSourceHealth, type D1DatabaseLike, type D1StatementLike } from "../src/ingest/persistence.ts";
import { type PersistedSourceHealth, type SourceRunNote } from "../src/ingest/source-health.ts";
import { dispatchOperationalDigest, recordOperationalAlert, resolveOperationalAlertWithTransition } from "../src/lib/alerts.ts";
import { projectOperationalSources } from "../src/ingest/automation.ts";
import { operationalConditionLabel } from "../src/lib/operational-presentation.ts";
import { sendAutomationAlerts } from "../worker.js";

const primary = "https://blogs.cooperhealth.org/news/feed/";
const official = "https://www.cooperhealth.org/about-us/newsroom";
const independent = "https://www.phillyvoice.com/tags/cooperuniversity-health-care/";
const empty = "<rss><channel></channel></rss>";
const at = "2026-10-04T08:00:00.000Z";
const later = "2026-10-04T08:15:00.000Z";
const officialHtml = `<html><body><h2>Cooper launches a regional program</h2><span>October 4, 2026</span><a href="https://blogs.cooperhealth.org/news/regional-program/">Cooper launches a regional program</a></body></html>`;
const independentHtml = `<html><body><article><a href="https://www.phillyvoice.com/cooper-new-campus/">Cooper University Health Care plans a new campus</a><time>October 4, 2026</time><span>by cooperhealth.org</span></article></body></html>`;

function database(beforeFreshnessMigration = false) {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").filter(x => x.endsWith(".sql")).sort()) {
    if (beforeFreshnessMigration && file.startsWith("0039_")) continue;
    sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  }
  const statement = (query: string, values: unknown[] = []): D1StatementLike => ({
    bind: (...args: unknown[]) => statement(query, args),
    first: async <T>() => (sqlite.prepare(query).get(...values as never[]) as T) ?? null,
    all: async <T>() => ({ results: sqlite.prepare(query).all(...values as never[]) as T[] }),
    run: async () => sqlite.prepare(query).run(...values as never[]),
  });
  const db: D1DatabaseLike = { prepare: query => statement(query), batch: async statements => Promise.all(statements.map(s => s.run())) };
  return { sqlite, db };
}

async function collect(path: "primary" | "official" | "independent" | "failed", checkedAt = at, prior?: PersistedSourceHealth) {
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input); requests.push(url);
    if (url === primary && path === "primary") return new Response(`<rss><channel><item><title>Cooper publishes a current update</title><link>https://blogs.cooperhealth.org/news/current-update/</link><pubDate>Sun, 04 Oct 2026 07:00:00 GMT</pubDate></item></channel></rss>`);
    if (url === official && path === "official") return new Response(officialHtml);
    if (url === independent && path === "independent") return new Response(independentHtml);
    if ([primary, official, independent].includes(url)) return new Response("blocked", { status: 403 });
    return new Response(empty);
  };
  const result = await ingestRssWithHealth(new Date(checkedAt), fetcher, { sourceHealth: prior ? new Map([["cooper-newsroom", prior]]) : undefined });
  const source = result.sources.find(row => row.id === "cooper-newsroom")!;
  assert.ok(source);
  return { source, requests, items: result.items };
}

async function persist(sqlite: DatabaseSync, db: D1DatabaseLike, runId: string, source: SourceRunNote) {
  sqlite.prepare("INSERT INTO ingest_runs(id,started_at,state) VALUES (?,?,'succeeded')").run(runId, source.checkedAt);
  await persistSourceHealth(db, runId, [source]);
}

const alert = (sqlite: DatabaseSync, fingerprint = "valley-desk:source:cooper-newsroom") => sqlite.prepare("SELECT * FROM operational_alerts WHERE fingerprint=?").get(fingerprint) as any;
const failedSource = { id: "cooper-newsroom", state: "upstream-blocked", type: "rss", itemCount: 0, institutionIds: ["inst-cooper"], httpStatus: 403 };

test("one successful fallback run and its replay cannot satisfy two recovery observations", async () => {
  const { sqlite, db } = database(); const sent: string[] = [];
  try {
    const env = { VALLEY_DESK_DB: db, NOTIFY_OPS: { send: async (m: { text: string }) => { sent.push(m.text); return {}; } } };
    await sendAutomationAlerts(env, { runId: "failed-run", notes: { sources: [failedSource] } }, new Date("2026-10-04T07:00:00.000Z"));
    const first = (await collect("official")).source;
    await sendAutomationAlerts(env, { runId: "fallback-run-1", notes: { sources: [first] } }, new Date(at));
    assert.equal(alert(sqlite).state, "open"); assert.equal(alert(sqlite).recovery_count, 1);
    assert.equal(alert(sqlite).condition_state, "healthy");
    await sendAutomationAlerts(env, { runId: "fallback-run-1", notes: { sources: [first] } }, new Date("2026-10-04T08:05:00.000Z"));
    assert.equal(alert(sqlite).state, "open"); assert.equal(alert(sqlite).recovery_count, 1);
    const second = (await collect("official", later)).source;
    await sendAutomationAlerts(env, { runId: "fallback-run-2", notes: { sources: [second] } }, new Date(later));
    assert.equal(alert(sqlite).state, "resolved"); assert.equal(alert(sqlite).recovery_count, 2);
    assert.equal(alert(sqlite, "valley-desk:source-fallback:cooper-newsroom").state, "open");
    assert.equal(sent.filter(text => text.includes("operational alert recovered")).length, 1);
    assert.match(sent.at(-1)!, /fallback-serving/);
  } finally { sqlite.close(); }
});

test("independent fallback records fresh delivery without claiming primary health or authority", async () => {
  const { source, items } = await collect("independent");
  assert.equal(source.primaryState, "upstream-blocked");
  assert.equal(source.primaryLastSuccessAt, null); assert.equal(source.fallbackLastSuccessAt, at);
  assert.equal(source.lastSuccessAt, at); assert.equal(source.servingPath, "independent-discovery-fallback");
  assert.equal(source.nextAttemptAt, later); assert.equal(source.complete, false);
  const item = items.find(row => row.source.origin === "cooper-independent-discovery");
  assert.ok(item); assert.ok(item.citations?.some(row => row.name.includes("corroboration required")));
});

test("durable primary and fallback times survive alternation and failures without invented history", async () => {
  const { sqlite, db } = database();
  try {
    let source = (await collect("official")).source;
    await persist(sqlite, db, "fixture-1", source);
    let prior = (await readSourceHealth(db)).get(source.id)!;
    assert.equal(prior.primaryLastSuccessAt, null); assert.equal(prior.fallbackLastSuccessAt, at);
    source = (await collect("primary", later, prior)).source;
    await persist(sqlite, db, "fixture-2", source);
    prior = (await readSourceHealth(db)).get(source.id)!;
    assert.equal(prior.primaryLastSuccessAt, later); assert.equal(prior.fallbackLastSuccessAt, at);
    const thirdAt = "2026-10-04T08:30:00.000Z";
    source = (await collect("independent", thirdAt, prior)).source;
    await persist(sqlite, db, "fixture-3", source);
    prior = (await readSourceHealth(db)).get(source.id)!;
    assert.equal(prior.primaryLastSuccessAt, later); assert.equal(prior.fallbackLastSuccessAt, thirdAt);
    source = (await collect("failed", "2026-10-04T08:45:00.000Z", prior)).source;
    await persist(sqlite, db, "fixture-4", source);
    prior = (await readSourceHealth(db)).get(source.id)!;
    assert.equal(prior.primaryLastSuccessAt, later); assert.equal(prior.fallbackLastSuccessAt, thirdAt);
    assert.equal(prior.lastSuccessAt, thirdAt); assert.equal(source.servingPath, "unavailable");
  } finally { sqlite.close(); }
});

test("fresh fallback during primary backoff advances only collection freshness and preserves retry hold", async () => {
  const { sqlite, db } = database();
  try {
    await persist(sqlite, db, "fixture-failed", (await collect("failed", "2026-10-04T07:55:00.000Z")).source);
    const prior = (await readSourceHealth(db)).get("cooper-newsroom")!;
    const { source, requests } = await collect("official", at, prior);
    assert.ok(!requests.includes(primary)); assert.equal(source.nextAttemptAt, prior.nextAttemptAt);
    await persist(sqlite, db, "fixture-backoff", source);
    const next = (await readSourceHealth(db)).get(source.id)!;
    assert.equal(next.state, "backoff"); assert.equal(next.consecutiveFailures, prior.consecutiveFailures);
    assert.equal(next.nextAttemptAt, prior.nextAttemptAt); assert.equal(next.lastError, prior.lastError);
    assert.equal(next.primaryLastSuccessAt, null); assert.equal(next.fallbackLastSuccessAt, at); assert.equal(next.lastSuccessAt, at);
  } finally { sqlite.close(); }
});

test("a retained fallback URL is not a fresh fallback observation during cooldown", async () => {
  const { sqlite, db } = database();
  try {
    await recordOperationalAlert(db, { fingerprint: "valley-desk:source-fallback:cooper-newsroom", event: "source-fallback-active", severity: "warning", notify: false, now: new Date("2026-10-04T06:00:00.000Z") });
    const prior: PersistedSourceHealth = { sourceId: "cooper-newsroom", state: "upstream-blocked", itemCount: 3, complete: false, consecutiveFailures: 10, lastCheckedAt: "2026-10-03T00:00:00.000Z", lastSuccessAt: "2026-10-02T00:00:00.000Z", fallbackLastSuccessAt: "2026-10-02T00:00:00.000Z", primaryLastSuccessAt: null, nextAttemptAt: "2026-10-09T00:00:00.000Z", lastError: "HTTP 403", lastHttpStatus: 403, requiresAuth: false, lastFallbackUrl: official, institutionIds: ["inst-cooper"] };
    await sendAutomationAlerts({ VALLEY_DESK_DB: db }, { runId: "failed", notes: { sources: [failedSource] } }, new Date("2026-10-04T07:00:00.000Z"));
    const { source, requests } = await collect("failed", at, prior);
    assert.ok(!requests.includes(primary)); assert.equal(source.servingPath, "unavailable");
    await sendAutomationAlerts({ VALLEY_DESK_DB: db }, { runId: "no-fallback", notes: { sources: [source] } }, new Date(at));
    assert.equal(alert(sqlite).recovery_count, 0);
    const detail = JSON.parse(alert(sqlite, "valley-desk:source-fallback:cooper-newsroom").detail_json);
    assert.equal(detail.currentFallback, false); assert.equal(detail.affectedCoverage, "fallback-unavailable-during-backoff");
  } finally { sqlite.close(); }
});

test("pre-migration reads preserve retry holds and leave mixed historical successes unattributed", async () => {
  const { sqlite, db } = database(true);
  try {
    sqlite.prepare("INSERT INTO ingest_runs(id,started_at,state) VALUES ('fixture-history',?,'succeeded')").run(at);
    sqlite.prepare("INSERT INTO source_health(source_id,origin,source_type,state,complete,item_count,consecutive_failures,last_checked_at,last_success_at,next_attempt_at,last_error,requires_auth,last_run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run("cooper-newsroom", "cooper-newsroom", "rss", "backoff", 0, 3, 10, at, at, "2026-10-09T00:00:00.000Z", "HTTP 403", 0, "fixture-history");
    let prior = (await readSourceHealth(db)).get("cooper-newsroom")!;
    assert.equal(prior.consecutiveFailures, 10); assert.equal(prior.nextAttemptAt, "2026-10-09T00:00:00.000Z");
    assert.equal(prior.primaryLastSuccessAt, null); assert.equal(prior.fallbackLastSuccessAt, null);
    sqlite.exec(readFileSync("migrations/0039_source_delivery_freshness.sql", "utf8"));
    prior = (await readSourceHealth(db)).get("cooper-newsroom")!;
    assert.equal(prior.primaryLastSuccessAt, null); assert.equal(prior.fallbackLastSuccessAt, null);
    assert.equal(prior.lastSuccessAt, at); assert.equal(prior.consecutiveFailures, 10);
  } finally { sqlite.close(); }
});

test("recovery-pending digest uses condition evaluation units and separate collection timestamps", async () => {
  const { sqlite, db } = database(); const sent: string[] = [];
  try {
    const env = { VALLEY_DESK_DB: db };
    await sendAutomationAlerts(env, { runId: "failed", notes: { sources: [failedSource] } }, new Date("2026-10-04T07:00:00.000Z"));
    await sendAutomationAlerts(env, { runId: "one-healthy", notes: { sources: [(await collect("official")).source] } }, new Date(at));
    await dispatchOperationalDigest(db, { send: async (message) => { sent.push(message.text); return {}; } }, new Date("2026-10-04T08:03:00.000Z"));
    assert.match(sent[0]!, /degraded\/recovery pending/); assert.match(sent[0]!, /condition evaluations/);
    assert.doesNotMatch(sent[0]!, /[0-9]+ occurrences/); assert.match(sent[0]!, /primaryLastSuccessAt=null/);
    assert.match(sent[0]!, /fallbackLastSuccessAt=2026-10-04T08:00:00.000Z/);
    assert.match(sent[0]!, /primaryState=upstream-blocked/); assert.match(sent[0]!, /servingPath=official-html-fallback/);
    assert.match(sent[0]!, /recoveryChecks=1, lastHealthyObservationAt=2026-10-04T08:00:00.000Z/);
    assert.equal(operationalConditionLabel("healthy", "open"), "recovery pending");
    assert.equal(operationalConditionLabel("healthy", "resolved"), "healthy");
  } finally { sqlite.close(); }
});

test("resolver ignores replayed run IDs, duplicate legacy timestamps, and stale observations", async () => {
  const { sqlite, db } = database();
  try {
    await recordOperationalAlert(db, { fingerprint: "test:recovery", event: "test-failed", severity: "warning", notify: false, now: new Date("2026-10-04T07:00:00.000Z") });
    const details = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`field${i}`, i]));
    await resolveOperationalAlertWithTransition(db, "test:recovery", new Date(at), 2, { ...details, observationId: "run-1" });
    await resolveOperationalAlertWithTransition(db, "test:recovery", new Date(later), 2, { observationId: "run-1" });
    await resolveOperationalAlertWithTransition(db, "test:recovery", new Date("2026-10-04T07:59:00.000Z"), 2, { observationId: "stale-run" });
    assert.equal(alert(sqlite, "test:recovery").recovery_count, 1);
    await resolveOperationalAlertWithTransition(db, "test:recovery", new Date(later), 2, { observationId: "run-2" });
    assert.equal(alert(sqlite, "test:recovery").state, "resolved");
    await recordOperationalAlert(db, { fingerprint: "test:legacy", event: "test-failed", severity: "warning", notify: false, now: new Date("2026-10-04T07:00:00.000Z") });
    await resolveOperationalAlertWithTransition(db, "test:legacy", new Date(at));
    await resolveOperationalAlertWithTransition(db, "test:legacy", new Date(at));
    assert.equal(alert(sqlite, "test:legacy").recovery_count, 1);
  } finally { sqlite.close(); }
});


test("replaying an old completed run cannot recover a newly recorded failure", async () => {
  const { sqlite, db } = database();
  try {
    const env = { VALLEY_DESK_DB: db };
    await sendAutomationAlerts(env, { runId: "new-failure", notes: { sources: [failedSource] } }, new Date(later));
    const source = (await collect("official")).source;
    await sendAutomationAlerts(env, { runId: "old-healthy", finishedAt: at, notes: { sources: [source] } }, new Date("2026-10-04T08:30:00.000Z"));
    assert.equal(alert(sqlite).recovery_count, 0); assert.equal(alert(sqlite).condition_state, "blocked");
    await sendAutomationAlerts(env, { runId: "new-healthy-1", finishedAt: "2026-10-04T08:35:00.000Z", notes: { sources: [source] } }, new Date("2026-10-04T08:36:00.000Z"));
    assert.equal(alert(sqlite).recovery_count, 1);
  } finally { sqlite.close(); }
});


test("the scheduled source projection preserves checkedAt and legacy receipts retain completion time", async () => {
  const { sqlite, db } = database();
  try {
    const source = (await collect("official")).source;
    const projected = projectOperationalSources([source]);
    assert.equal(projected[0]!.checkedAt, at);
    const env = { VALLEY_DESK_DB: db };
    await sendAutomationAlerts(env, { runId: "failure", notes: { sources: [failedSource] } }, new Date("2026-10-04T07:00:00.000Z"));
    await sendAutomationAlerts(env, { runId: "projected", finishedAt: "2026-10-04T08:01:00.000Z", notes: { sources: projected } }, new Date("2026-10-04T08:02:00.000Z"));
    assert.equal(JSON.parse(alert(sqlite).recovery_detail_json).observedAt, at);
    await sendAutomationAlerts(env, { runId: "failure-2", notes: { sources: [failedSource] } }, new Date("2026-10-04T08:05:00.000Z"));
    const { checkedAt: ignored, ...legacy } = projected[0]!;
    await sendAutomationAlerts(env, { runId: "legacy-projected", finishedAt: later, notes: { sources: [legacy] } }, new Date("2026-10-04T08:16:00.000Z"));
    assert.equal(JSON.parse(alert(sqlite).recovery_detail_json).observedAt, later);
  } finally { sqlite.close(); }
});

test("unavailable fallback interrupts availability recovery even without a retained fallback URL", async () => {
  for (const retainUrl of [true, false]) {
    const { sqlite, db } = database();
    try {
      const env = { VALLEY_DESK_DB: db };
      await sendAutomationAlerts(env, { runId: "failure", notes: { sources: [failedSource] } }, new Date("2026-10-04T07:00:00.000Z"));
      const source = (await collect("official")).source;
      await sendAutomationAlerts(env, { runId: "good-1", finishedAt: at, notes: { sources: projectOperationalSources([source]) } }, new Date(at));
      assert.equal(alert(sqlite).recovery_count, 1);
      const unavailable = { ...source, state: "backoff", servingPath: "unavailable", checkedAt: later, nextAttemptAt: "2026-10-09T00:00:00.000Z", ...(retainUrl ? {} : { fallbackUrl: undefined }) };
      await sendAutomationAlerts(env, { runId: "unavailable", finishedAt: later, notes: { sources: [unavailable] } }, new Date(later));
      assert.equal(alert(sqlite).recovery_count, 0); assert.equal(alert(sqlite).condition_state, "backoff");
      assert.equal(alert(sqlite).last_seen_at, later); assert.deepEqual(JSON.parse(alert(sqlite).recovery_detail_json), {});
      await sendAutomationAlerts(env, { runId: "good-1", finishedAt: at, notes: { sources: [source] } }, new Date("2026-10-04T08:16:00.000Z"));
      assert.equal(alert(sqlite).recovery_count, 0, "pre-interruption success cannot restart recovery");
      const secondAt = "2026-10-04T08:30:00.000Z";
      const second = (await collect("official", secondAt)).source;
      await sendAutomationAlerts(env, { runId: "good-2", finishedAt: secondAt, notes: { sources: [second] } }, new Date(secondAt));
      assert.equal(alert(sqlite).state, "open"); assert.equal(alert(sqlite).recovery_count, 1);
      const thirdAt = "2026-10-04T08:45:00.000Z";
      await sendAutomationAlerts(env, { runId: "good-3", finishedAt: thirdAt, notes: { sources: [(await collect("official", thirdAt)).source] } }, new Date(thirdAt));
      assert.equal(alert(sqlite).state, "resolved");
      assert.equal(alert(sqlite, "valley-desk:source-fallback:cooper-newsroom").state, "open");
    } finally { sqlite.close(); }
  }
});

test("all-path failure interrupts primary recovery of the fallback warning", async () => {
  const { sqlite, db } = database(); const fallbackFingerprint = "valley-desk:source-fallback:cooper-newsroom";
  try {
    const env = { VALLEY_DESK_DB: db };
    await sendAutomationAlerts(env, { runId: "fallback", finishedAt: at, notes: { sources: [(await collect("official")).source] } }, new Date(at));
    await sendAutomationAlerts(env, { runId: "primary-1", finishedAt: later, notes: { sources: [(await collect("primary", later)).source] } }, new Date(later));
    assert.equal(alert(sqlite, fallbackFingerprint).recovery_count, 1);
    const failureAt = "2026-10-04T08:30:00.000Z";
    await sendAutomationAlerts(env, { runId: "all-failed", finishedAt: failureAt, notes: { sources: [(await collect("failed", failureAt)).source] } }, new Date(failureAt));
    assert.equal(alert(sqlite, fallbackFingerprint).recovery_count, 0);
    assert.equal(alert(sqlite, fallbackFingerprint).condition_state, "blocked");
    assert.equal(JSON.parse(alert(sqlite, fallbackFingerprint).detail_json).currentFallback, false);
    const secondAt = "2026-10-04T08:45:00.000Z";
    await sendAutomationAlerts(env, { runId: "primary-2", finishedAt: secondAt, notes: { sources: [(await collect("primary", secondAt)).source] } }, new Date(secondAt));
    assert.equal(alert(sqlite, fallbackFingerprint).state, "open"); assert.equal(alert(sqlite, fallbackFingerprint).recovery_count, 1);
    const thirdAt = "2026-10-04T09:00:00.000Z";
    await sendAutomationAlerts(env, { runId: "primary-3", finishedAt: thirdAt, notes: { sources: [(await collect("primary", thirdAt)).source] } }, new Date(thirdAt));
    assert.equal(alert(sqlite, fallbackFingerprint).state, "resolved");
  } finally { sqlite.close(); }
});

test("missing source configuration cannot resolve an outage or complete recovery", async () => {
 const {sqlite,db}=database();const sent:string[]=[];
 try {
  const env={VALLEY_DESK_DB:db,NOTIFY_OPS:{send:async(m:{text:string})=>{sent.push(m.text);return {};}}};
  await sendAutomationAlerts(env,{runId:'configuration-failure',notes:{sources:[failedSource]}},new Date('2026-10-04T07:00:00Z'));
  const first=(await collect('primary')).source;
  await sendAutomationAlerts(env,{runId:'configuration-recovery-1',notes:{sources:[first]}},new Date(at));
  assert.equal(alert(sqlite).recovery_count,1);
  await sendAutomationAlerts(env,{runId:'configuration-missing',notes:{sources:[{...first,state:'misconfigured',itemCount:0}]}},new Date('2026-10-04T08:05:00Z'));
  assert.equal(alert(sqlite).state,'open');assert.equal(alert(sqlite).condition_state,'degraded');assert.equal(alert(sqlite).recovery_count,0);
  assert.equal(sent.filter(text=>text.includes('operational alert recovered')).length,0);
  await sendAutomationAlerts(env,{runId:'configuration-recovery-2',notes:{sources:[(await collect('primary',later)).source]}},new Date(later));
  assert.equal(alert(sqlite).state,'open');assert.equal(alert(sqlite).recovery_count,1);
  await sendAutomationAlerts(env,{runId:'configuration-recovery-3',notes:{sources:[(await collect('primary','2026-10-04T08:30:00Z')).source]}},new Date('2026-10-04T08:30:00Z'));
  assert.equal(alert(sqlite).state,'resolved');assert.equal(sent.filter(text=>text.includes('operational alert recovered')).length,1);
 } finally {sqlite.close();}
});
