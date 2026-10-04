import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { coveragePack, type CoveragePackDocument, type CoverageSource } from "../src/ingest/coverage-pack";
import { extractLeaders, monitorLeadershipSources, type ScheduledLeadershipState } from "../src/ingest/leadership-monitor";
import { dispatchOperationalDigest } from "../src/lib/alerts";
import type { D1DatabaseLike } from "../src/ingest/persistence";

const NOW = new Date("2026-10-04T00:10:00Z");
const officialCases = JSON.parse(fs.readFileSync(new URL("../fixtures/leadership-source-quality-20261004.json", import.meta.url), "utf8"));
function article(claim: string, date: string | null = "2026-09-28T20:39:34+00:00", modified = "2026-10-04T00:10:00Z") {
  return `<script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", datePublished: date, dateModified: modified })}</script><main><p>${claim}</p></main>`;
}
function packFor(institutionId = "inst-penn", kind: CoverageSource["kind"] = "leadership-page") {
  const base = coveragePack.sources.find((row) => row.institutionId === institutionId && row.monitor)!;
  const source: CoverageSource = { ...base, id: "src-offline-quality", kind, url: "https://example.org/leadership", host: "example.org", alternateUrls: undefined, leadershipExtractionContract: undefined, scanMaxBytes: undefined, retainSuffixBytes: undefined };
  return { ...coveragePack, sources: [source] } as CoveragePackDocument;
}
async function monitor(html: string, pack = packFor(), states?: Map<string, ScheduledLeadershipState>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  return { ...(await monitorLeadershipSources({ fetchImpl, pack, now: NOW, states })), calls };
}

for (const row of officialCases.cases) {
  test(`bounded official attribution: ${row.id}`, () => {
    const leaders = extractLeaders(article(row.literalClaim, row.sourcePublishedAt), row.aliases);
    assert.equal(leaders.length, 1);
    assert.equal(leaders[0].normalizedName, row.expectedName);
    assert.equal(leaders[0].title, row.expectedTitle);
    assert.equal(leaders[0].articleEvidence?.sourcePublishedAt, row.sourcePublishedAt);
    assert.equal(leaders[0].articleEvidence?.currentAffiliationVerified, false);
  });
}
test("quote claims stay partial and cannot alter the last current roster", async () => {
  const pack = packFor("inst-cooper", "newsroom-bio");
  const id = pack.sources[0].id;
  const previous: ScheduledLeadershipState = { sourceId: id, state: "healthy", nextAttemptAt: "2026-10-03T00:00:00Z", consecutiveFailures: 0, lastSuccessAt: "2026-10-02T00:00:00Z", lastHash: "prior", lastExtracted: extractLeaders("<h2>Alex Example</h2><p>Chief Information Officer</p>") };
  const result = await monitor(article(officialCases.cases[0].literalClaim), pack, new Map([[id, previous]]));
  assert.equal(result.snapshots[0].extractionStatus, "partial");
  assert.equal(result.snapshots[0].state, "failed");
  assert.equal(result.snapshots[0].extracted[0].normalizedName, "snehal gandhi");
  assert.deepEqual(result.observations, []);
  assert.deepEqual(result.schedule[0].lastExtracted, previous.lastExtracted);
  assert.equal(result.schedule[0].lastSuccessAt, previous.lastSuccessAt);
  assert.equal(result.schedule[0].consecutiveFailures, 1);
});
test("attribution requires the named institution directly after the role", () => {
  assert.deepEqual(extractLeaders(article("Cooper Norcross Health welcomed guests, said Alex Example, chief medical information officer at Remote Health."), ["Cooper Norcross Health"]), []);
  assert.deepEqual(extractLeaders(article("said Alex Example, former chief information officer at Cooper Norcross Health."), ["Cooper Norcross Health"]), []);
  assert.deepEqual(extractLeaders(article("said Alex Example, chief information officer at Cooper Norcross Health Foundation."), ["Cooper Norcross Health"]), []);
});
test("institution aliases are literal, including regex punctuation", () => {
  assert.equal(extractLeaders(article("said Alex Example, chief information officer at Example (East) Health."), ["Example (East) Health"]).length, 1);
  assert.equal(extractLeaders(article("said Alex Example, chief information officer at Example East Health."), ["Example (East) Health"]).length, 0);
});
test("publication offsets are preserved; invalid dates and update dates are not publication", () => {
  const claim = "said Alex Example, president and chief executive of Example Health.";
  for (const value of ["2026-09-15T11:03:19-0400", "2026-09-15T11:03:19-04:00"]) {
    assert.equal(extractLeaders(article(claim, value), ["Example Health"])[0].articleEvidence?.sourcePublishedAt, value);
  }
  for (const value of [null, "2026-02-30T11:03:19-0400", "2026-09-15T11:03:19-2460"]) {
    assert.equal(extractLeaders(article(claim, value), ["Example Health"])[0].articleEvidence?.sourcePublishedAt, null);
  }
});
test("a heading cannot borrow the next person's title", () => {
  assert.deepEqual(extractLeaders("<main><h2>Alex Example</h2><h2>Jordan Example</h2><p>Chief Information Officer</p></main>").map((row) => row.name), ["Jordan Example"]);
  assert.equal(extractLeaders("<h2>Alex Example</h2><h4>Chief Information Officer</h4>")[0].name, "Alex Example");
});
test("empty vendor bootstrap is a challenge and cannot recover a source", async () => {
  const html = '<html><head><meta name="robots" content="noindex,nofollow"><script src="/_Incapsula_Resource?synthetic-public-fixture"></script></head><body></body></html>';
  const result = await monitor(html);
  assert.equal(result.snapshots[0].extractionStatus, "challenge");
  assert.equal(result.snapshots[0].state, "hostile");
  assert.match(result.snapshots[0].error!, /Challenge-like/);
  assert.equal(result.schedule[0].lastSuccessAt, null);
  assert.equal(result.schedule[0].consecutiveFailures, 1);
  assert.ok(result.observations.every((row) => row.kind === "hostile-content"));
});
test("ordinary script shells stay empty-unverified", async () => {
  const result = await monitor('<html><head><script src="/assets/app.js"></script></head><body></body></html>');
  assert.equal(result.snapshots[0].extractionStatus, "empty-unverified");
  assert.equal(result.snapshots[0].state, "failed");
  assert.deepEqual(result.observations, []);
});
test("a future retry date prevents all fetches, even with an available fixture", async () => {
  const pack = packFor(); const id = pack.sources[0].id;
  const state: ScheduledLeadershipState = { sourceId: id, state: "blocked", nextAttemptAt: "2026-10-09T23:01:13.480Z", consecutiveFailures: 10, lastSuccessAt: null, lastError: "HTTP 403" };
  const result = await monitor("<h2>Alex Example</h2><p>Chief Information Officer</p>", pack, new Map([[id, state]]));
  assert.deepEqual(result.calls, []); assert.deepEqual(result.snapshots, []); assert.deepEqual(result.schedule, []);
});
test("digest counts consistently describe condition evaluations rather than attempts", async () => {
  const rows = ["leadership", "editorial"].map((subsystem) => ({ fingerprint: subsystem, pack_id: "offline", event: "source-unhealthy", severity: "warning", condition_state: "backoff", institution_id: null, subsystem, group_key: subsystem, occurrence_count: 176, first_seen_at: "2026-10-03T00:00:00Z", last_seen_at: NOW.toISOString(), detail_json: "{}" }));
  const db = { prepare() { return { bind() { return this; }, async first() { return null; }, async run() { return { success: true, meta: { changes: 1 } }; }, async all() { return { results: rows }; } }; } } as unknown as D1DatabaseLike;
  let text = "";
  const result = await dispatchOperationalDigest(db, { async send(message) { text = message.text; return { messageId: "offline-mock" }; } }, NOW, "offline");
  assert.equal(result.outcome, "sent");
  assert.match(text, /leadership.*176 condition evaluations/);
  assert.match(text, /editorial.*176 condition evaluations/);
  assert.doesNotMatch(text, /176 new failures/);
});


test("review probe: role-bearing next-person heading cannot lend a title", async () => {
  const html = '<main><h2>Alex Example</h2><h2>Jordan Example, CEO</h2><p>Chief Information Officer</p></main>';
  const leaders = extractLeaders(html);
  assert.deepEqual(leaders.map((row) => ({ name: row.name, title: row.title })), [{ name: "Jordan Example", title: "CEO" }]);
  const result = await monitor(html);
  assert.ok(result.observations.every((row) => !JSON.stringify(row.payload).includes("Alex Example")));
});
test("review probe: another institution's article officer is never a target claim", async () => {
  const html = '<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-09-28T20:39:34+00:00"}</script><main><p>Cooper Norcross Health welcomed Remote Health chief medical information officer Alex Example.</p></main>';
  assert.deepEqual(extractLeaders(html, ["Cooper Norcross Health"]), []);
  const result = await monitor(html, packFor("inst-cooper", "newsroom-bio"));
  assert.deepEqual(result.snapshots[0].extracted, []);
  assert.deepEqual(result.observations, []);
  assert.equal(result.schedule[0].lastSuccessAt, null);
});
test("all article grammars require immediate institutional role linkage", () => {
  const aliases = ["Cooper Norcross Health"];
  for (const claim of [
    "Cooper Norcross Health welcomed Alex Example named chief medical information officer of Remote Health.",
    "Cooper Norcross Health welcomed chief medical information officer Alex Example of Remote Health.",
    "Cooper Norcross Health welcomed Remote Health CEO Alex Example.",
  ]) assert.deepEqual(extractLeaders(article(claim), aliases), []);
  for (const claim of [
    "Cooper Norcross Health CEO Alex Example.",
    "Cooper Norcross Health extends contract with CEO Alex Example.",
    "Alex Example named chief medical information officer of Cooper Norcross Health.",
    "chief medical information officer Alex Example of Cooper Norcross Health.",
  ]) assert.equal(extractLeaders(article(claim), aliases).length, 1, claim);
});
test("unscoped article headings and structured people cannot become institution claims", () => {
  const html = article("Cooper Norcross Health welcomed guests.")
    + '<h2>Alex Example</h2><p>Chief Information Officer, Remote Health</p>'
    + '<script type="application/ld+json">{"@type":"Person","name":"Jordan Example","jobTitle":"Chief Information Officer","worksFor":{"name":"Remote Health"}}</script>';
  assert.deepEqual(extractLeaders(html, ["Cooper Norcross Health"]), []);
});
