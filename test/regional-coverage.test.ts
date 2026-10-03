import assert from "node:assert/strict";
import test from "node:test";
import { buildRegionalCoverageReport } from "../src/ingest/regional-coverage";
import type { PersistedSourceHealth } from "../src/ingest/source-health";
const asOf = "2026-10-02T03:00:00Z";
const institutions = [{ id: "inst-a", name: "Institution A", scope: "core" }, { id: "inst-b", name: "Community B", scope: "core" }];
const sources = [{ id: "src-a", institutionId: "inst-a", channel: "news" as const, status: "configured" as const,
  maxAgeHours: 2, url: "https://fixture.edu/news" }];
function health(overrides: Partial<PersistedSourceHealth> = {}): PersistedSourceHealth {
  return { sourceId: "src-a", state: "healthy", itemCount: 1, complete: false, consecutiveFailures: 0,
    lastCheckedAt: "2026-10-02T02:50:00Z", lastSuccessAt: "2026-10-02T02:50:00Z", lastError: null,
    nextAttemptAt: asOf, lastHttpStatus: 200, requiresAuth: false, ...overrides };
}
const news = (receipts: PersistedSourceHealth[] = []) => buildRegionalCoverageReport({ institutions, sources, health: receipts, asOf }).institutions[0].channels[0];
test("configured without health receipts is unobserved; missing channels are visible", () => {
  const report = buildRegionalCoverageReport({ institutions, sources, asOf });
  assert.equal(news().freshSources, 0);
  assert.equal(news().unobservedSources, 1);
  assert.ok(report.missingChannels.some(row => row.institutionId === "inst-b" && row.channel === "news"));
  assert.equal(report.collectionAuthorized, false);
});
test("recent success remains fresh with a transient failure warning", () => {
  const row = news([health({ state: "upstream-failed", consecutiveFailures: 1, lastSuccessAt: "2026-10-02T02:30:00Z" })]);
  assert.equal(row.freshSources, 1);
  assert.equal(row.sources[0].warning, "upstream-failed");
});
test("stale health, invalid future receipts and disabled sources cannot count fresh", () => {
  assert.equal(news([health({ lastSuccessAt: "2026-10-01T20:00:00Z" })]).staleSources, 1);
  assert.equal(news([health({ lastCheckedAt: "2026-10-03T02:00:00Z" })]).freshSources, 0);
  assert.equal(news([health({ lastSuccessAt: "2026-10-03T02:00:00Z" })]).sources[0].warning, "invalid-health-timestamps");
  assert.equal(news([health({ state: "disabled" })]).sources[0].freshness, "not-active");
});
test("inventory entries and healthy-empty receipts never imply complete institutional coverage", () => {
  assert.equal(news([health({ state: "healthy-empty", itemCount: 0 })]).freshSources, 1);
  const report = buildRegionalCoverageReport({ institutions, sources: [{ ...sources[0], status: "inventory-only" }], health: [health()], asOf });
  const row = report.institutions[0].channels[0];
  assert.equal(row.freshSources, 0);
  assert.deepEqual(row.gaps, ["collection-not-qualified-or-active"]);
});
test("unknown health IDs, duplicate and orphan source IDs are explicit", () => {
  const report = buildRegionalCoverageReport({ institutions, sources, health: [health({ sourceId: "unknown-source" })], asOf });
  assert.deepEqual(report.unregisteredHealthSourceIds, ["unknown-source"]);
  assert.throws(() => buildRegionalCoverageReport({ institutions, sources: [...sources, ...sources], asOf }));
  assert.throws(() => buildRegionalCoverageReport({ institutions, sources: [{ ...sources[0], institutionId: "missing" }], asOf }));
  assert.throws(() => buildRegionalCoverageReport({ institutions, sources, health: [health(), health()], asOf }));
});
