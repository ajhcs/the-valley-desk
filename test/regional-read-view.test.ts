import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { prepareRegionalSourceReadView, queryRegionalSourceReadView } from "../src/ingest/regional-read-view";
import type { PersistedSourceHealth } from "../src/ingest/source-health";

const asOf = "2026-10-02T04:00:00Z";
const inventory = JSON.parse(await readFile(new URL("../fixtures/regional-source-inventory-v1.json", import.meta.url), "utf8"));
const institution = { id: "inst-fixture", name: "Fixture Institution", covered: true, edge: false };
const source = { id: "src-fixture-news", institutionId: institution.id, category: "news", status: "enabled", url: "https://fixture.edu/news" };
const input = () => ({ inventory, existingInstitutions: [institution], existingOfficialSources: [source], asOf });
function health(overrides: Partial<PersistedSourceHealth> = {}): PersistedSourceHealth {
  return { sourceId: source.id, state: "healthy", itemCount: 7, complete: false, consecutiveFailures: 0,
    lastCheckedAt: "2026-10-02T03:50:00Z", lastSuccessAt: "2026-10-02T03:50:00Z", lastError: null,
    nextAttemptAt: asOf, lastHttpStatus: 200, requiresAuth: false, ...overrides };
}

test("new proposals remain inactive and configured sources without receipts remain unknown", async () => {
  const view = await prepareRegionalSourceReadView(input());
  const result = queryRegionalSourceReadView(view, { limit: 50 }, asOf);
  assert.equal(result.counts.sourcesInFilter, 10);
  assert.equal(result.counts.configuredSourcesInFilter, 1);
  assert.equal(result.counts.unobservedSourcesAtSnapshotInFilter, 1);
  assert.equal(result.counts.freshSourcesAtSnapshotInFilter, 0);
  assert.equal(result.results.filter(row => row.freshnessAtSnapshot === "not-active").length, 9);
  assert.equal(result.collectionAuthorized, false);
  assert.equal(result.collectorActivatedByThisWorkstream, false);
  assert.equal(result.channelApplicabilityReviewed, false);
  assert.equal(result.counts.registeredPeopleWithCurrentAffiliation, null);
  assert.equal(result.counts.acceptedPublications, null);
});

test("fresh success survives a transient warning without leaking raw errors or item counts", async () => {
  const view = await prepareRegionalSourceReadView({ ...input(), health: [health({ state: "timed-out", lastError: "Bearer private-token\n<script>fetch('/private')</script>" })] });
  const result = queryRegionalSourceReadView(view, { institutionIds: [institution.id] }, asOf);
  assert.equal(result.results[0].freshnessAtSnapshot, "fresh");
  assert.equal(result.results[0].warning, "timed-out");
  assert.equal(result.results[0].lastSuccessAt, "2026-10-02T03:50:00Z");
  assert.equal(result.counts.freshSourcesAtSnapshotInFilter, 1);
  const serialized = JSON.stringify(result);
  for (const forbidden of ["private-token", "<script>", "lastError", "itemCount", "nextAttemptAt", "lastFallbackUrl"])
    assert.equal(serialized.includes(forbidden), false, forbidden);
});

test("stale, future and disabled receipts cannot count fresh", async () => {
  for (const receipt of [health({ lastSuccessAt: "2026-10-01T20:00:00Z" }),
    health({ lastCheckedAt: "2026-10-03T03:50:00Z" }), health({ state: "disabled" })]) {
    const view = await prepareRegionalSourceReadView({ ...input(), health: [receipt] });
    assert.equal(queryRegionalSourceReadView(view, {}, asOf).counts.freshSourcesAtSnapshotInFilter, 0);
  }
});

test("citations preserve observation and unknown source dates without exposing quotes or page HTML", async () => {
  const view = await prepareRegionalSourceReadView(input());
  const result = queryRegionalSourceReadView(view, { configurations: ["planned", "inventory-only"], limit: 50 }, asOf);
  assert.equal(result.results.length, 9);
  for (const row of result.results) {
    assert.equal(row.evidenceBasis, "inventory-citation-declarations");
    assert.equal(row.evidenceVerifiedByThisAdapter, false);
    assert.equal(row.sourcePublishedAt, null);
    for (const citation of row.citations) {
      assert.ok(citation.observedAt);
      assert.equal(citation.sourcePublishedAt, null);
      assert.match(citation.representationSha256, /^[a-f0-9]{64}$/);
      assert.equal("quote" in citation, false);
      assert.equal("body" in citation, false);
    }
  }
  assert.equal(result.untrustedText, true);
});

test("pagination is deterministic, bounded, snapshot-bound and filter-bound", async () => {
  const view = await prepareRegionalSourceReadView(input());
  const first = queryRegionalSourceReadView(view, { limit: 3 }, asOf);
  assert.equal(first.results.length, 3);
  assert.ok(first.nextCursor);
  const second = queryRegionalSourceReadView(view, { limit: 3, cursor: first.nextCursor }, asOf);
  assert.equal(second.results.length, 3);
  assert.equal(new Set([...first.results, ...second.results].map(row => row.sourceId)).size, 6);
  assert.throws(() => queryRegionalSourceReadView(view, { channels: ["news"], cursor: first.nextCursor }, asOf), /context-mismatch/);
  const newer = await prepareRegionalSourceReadView({ ...input(), asOf: "2026-10-02T04:01:00Z" });
  assert.throws(() => queryRegionalSourceReadView(newer, { cursor: first.nextCursor }, "2026-10-02T04:01:00Z"), /context-mismatch/);
  const changed = { ...first.nextCursor!, afterSourceId: "src-missing" };
  assert.throws(() => queryRegionalSourceReadView(view, { cursor: changed }, asOf), /cursor-source-missing/);
});

test("caller output mutation and JSON-forged view tokens cannot alter the stored view", async () => {
  const view = await prepareRegionalSourceReadView(input());
  const first = queryRegionalSourceReadView(view, { limit: 1 }, asOf);
  first.results[0].configuration = "configured";
  first.results[0].citations.splice(0);
  const again = queryRegionalSourceReadView(view, { limit: 1 }, asOf);
  assert.notEqual(again.results[0].configuration, "configured");
  assert.ok(again.results[0].citations.length);
  assert.throws(() => queryRegionalSourceReadView(JSON.parse(JSON.stringify(view)), {}, asOf), /unprepared/);
  assert.equal(Object.isFrozen(view), true);
});

test("server time enforces snapshot validity and cannot be supplied through query fields", async () => {
  const view = await prepareRegionalSourceReadView(input());
  assert.equal(queryRegionalSourceReadView(view, {}, "2026-10-02T04:14:59Z").snapshot.expiresAt, "2026-10-02T04:15:00.000Z");
  for (const now of ["2026-10-02T04:15:00Z", "2026-10-02T03:59:59Z"])
    assert.throws(() => queryRegionalSourceReadView(view, {}, now), /expired-or-future/);
  assert.throws(() => queryRegionalSourceReadView(view, { now: asOf }, asOf));
});

test("unknown fields, action requests, arbitrary URLs, invalid selectors and oversized pages fail closed", async () => {
  const view = await prepareRegionalSourceReadView(input());
  for (const request of [{ action: "activate" }, { url: "https://fixture.edu/private" }, { deploy: true }, { limit: 51 },
    { institutionIds: ["inst-missing"] }, { channels: ["private"] }, { institutionIds: [institution.id, institution.id] },
    { configurations: ["configured", "configured"] }, { limit: "20" }, { limit: 0 }])
    assert.throws(() => queryRegionalSourceReadView(view, request, asOf));
});

test("unsafe registry links and invalid health states or calendar dates fail closed", async () => {
  await assert.rejects(prepareRegionalSourceReadView({ ...input(), existingOfficialSources: [{ ...source, url: "https://127.0.0.1/" }] }));
  await assert.rejects(prepareRegionalSourceReadView({ ...input(), health: [health({ lastCheckedAt: "2026-02-30T03:50:00Z" })] }));
  await assert.rejects(prepareRegionalSourceReadView({ ...input(), health: [health({ state: "Bearer token" as PersistedSourceHealth["state"] })] }));
  await assert.rejects(prepareRegionalSourceReadView({ ...input(), asOf: "2026-10-01T03:00:00Z" }), /inventory-later/);
});

test("actual regional registries yield exactly nine inactive proposals and unknown live freshness", async () => {
  const coverage = JSON.parse(await readFile(new URL("../fixtures/coverage-pack-v1.json", import.meta.url), "utf8"));
  const official = JSON.parse(await readFile(new URL("../fixtures/official-source-registry-v1.json", import.meta.url), "utf8"));
  const view = await prepareRegionalSourceReadView({ inventory, existingInstitutions: coverage.institutions,
    existingOfficialSources: official.sources, existingLeadershipSources: coverage.sources, asOf });
  const result = queryRegionalSourceReadView(view, { limit: 50 }, asOf);
  assert.equal(result.counts.institutionsInFilter, 33);
  assert.equal(result.results.filter(row => row.sourceId.startsWith("rgn-")).length, 9);
  assert.equal(result.results.filter(row => row.configuration === "planned").length, 3);
  assert.equal(result.results.filter(row => row.sourceId.startsWith("rgn-") && row.configuration === "inventory-only").length, 6);
  assert.equal(result.counts.freshSourcesAtSnapshotInFilter, 0);
  assert.equal(result.counts.registrationGapsInInstitutionChannelFilter, 127);
  assert.deepEqual(result.unintegratedExistingRegistryFamilies, ["rss", "event-adapters", "technology-source-plans"]);
  assert.equal(result.nextCursor, null);
});
