import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildRegionalEvidenceReview, CORE_REGIONAL_MONITOR_IDS, RegionalEvidenceInventory } from "../src/content/regional-evidence";
import type { RegionalEvidenceLeadershipReceipt } from "../src/content/regional-evidence";
import type { PersistedSourceHealth } from "../src/ingest/source-health";
import { PublicAffiliation, resolveInstitutionalAuthor, verifyPublicAffiliation } from "../src/ingest/regional-contracts";
import type { RegionalEvidence, RegionalInstitution } from "../src/ingest/regional-contracts";

const json = async (path: string) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const [scopeInventory, inventory, coverage, official] = await Promise.all([
  json("../fixtures/regional-evidence/institution-scope-v1.json"), json("../fixtures/regional-source-inventory-v1.json"),
  json("../fixtures/coverage-pack-v1.json"), json("../fixtures/official-source-registry-v1.json"),
]);
const asOf = "2026-10-06T19:00:00Z";
const input = () => ({ scopeInventory: structuredClone(scopeInventory), inventory: structuredClone(inventory),
  existingInstitutions: structuredClone(coverage.institutions), existingOfficialSources: structuredClone(official.sources),
  existingLeadershipSources: structuredClone(coverage.sources), asOf });
function health(sourceId = "ofs-penn-news", overrides: Partial<PersistedSourceHealth> = {}): PersistedSourceHealth {
  return { sourceId, state: "healthy", itemCount: 1, complete: true, consecutiveFailures: 0,
    lastCheckedAt: asOf, lastSuccessAt: asOf, lastError: null,
    nextAttemptAt: asOf, lastHttpStatus: 200, requiresAuth: false, ...overrides };
}
function addBoundedEvidence(value: ReturnType<typeof input>, kind: "article" | "profile" | "committee" | "repository-work") {
  value.scopeInventory.evidence.push({ id: "scope-bounded-observation", sourceId: "ofs-penn-news", kind,
    basis: "delegated-research-summary", url: "https://www.pennmedicine.org/news/parent-item",
    summary: "Synthetic parent institution observation. No subsidiary identity, employment term or complete executive roster is established.",
    institutionIds: ["inst-penn"], inventoryEvidenceId: null, observedAt: null, representationSha256: null });
  return value;
}

test("actual registry keeps 16 news rows, 14 institutional attributions and fixed 16 monitor IDs", () => {
  const report = buildRegionalEvidenceReview(input());
  assert.equal(report.counts.coreNewsRegistrySources, 16);
  assert.equal(report.counts.coreInstitutionsWithNewsRegistryAttribution, 14);
  assert.equal(report.counts.coreInstitutions, 16);
  assert.deepEqual(report.coreMonitorIds, CORE_REGIONAL_MONITOR_IDS);
  for (const id of ["inst-cooper", "inst-lvhn"])
    assert.equal(report.coreNews.find(row => row.institutionId === id)!.registrySourceIds.length, 2);
  assert.equal(report.counts.coreNewsAttributionGaps, 2);
  assert.equal(report.counts.coreNewsReviewScopeAttributionGaps, 2);
  assert.equal(report.counts.coreNewsRegistrationGaps, 0);
  assert.equal(report.counts.coreNewsKnownSubsidiaryAttributionGaps, 2);
  for (const id of ["inst-penn-princeton", "inst-penn-doylestown"]) {
    const row = report.coreNews.find(row => row.institutionId === id)!;
    assert.equal(row.attributionState, "attribution-gap");
    assert.equal(row.newsExistence, "unknown");
    assert.deepEqual(row.registrySourceIds, []);
    assert.deepEqual(row.relationshipSourceIds, ["ofs-penn-news"]);
  }
  assert.ok(report.coreMonitorIds.includes("inst-st-lukes"));
  assert.ok(report.coreMonitorIds.includes("inst-lvhn"));
  assert.equal(report.coreMonitorIds.includes("inst-review-penn-perelman" as typeof CORE_REGIONAL_MONITOR_IDS[number]), false);
});

test("all fixed-core missing registry attributions count even without a review relationship", () => {
  const value = input();
  value.existingOfficialSources = value.existingOfficialSources.filter((row: { institutionId?: string; category: string }) =>
    !(row.institutionId === "inst-main-line" && row.category === "news"));
  const report = buildRegionalEvidenceReview(value);
  const missing = report.coreNews.find(row => row.institutionId === "inst-main-line")!;
  assert.equal(missing.attributionState, "registration-gap");
  assert.deepEqual(missing.registrySourceIds, []);
  assert.deepEqual(missing.relationshipSourceIds, []);
  assert.equal(missing.newsExistence, "unknown");
  assert.equal(missing.institutionCoverageFreshness, "unknown");
  assert.equal(report.counts.coreNewsAttributionGaps, 3);
  assert.equal(report.counts.coreNewsKnownSubsidiaryAttributionGaps, 2);
  assert.equal(report.counts.coreNewsReviewScopeAttributionGaps, 2);
  assert.equal(report.counts.coreNewsRegistrationGaps, 1);
  assert.equal(report.counts.coreNewsAttributionGaps,
    report.counts.coreNewsReviewScopeAttributionGaps + report.counts.coreNewsRegistrationGaps);
  assert.equal(report.counts.coreInstitutionsWithNewsRegistryAttribution + report.counts.coreNewsAttributionGaps,
    report.counts.coreInstitutions);
  const noReviewLink = input();
  noReviewLink.scopeInventory.relationships = noReviewLink.scopeInventory.relationships.filter((row: { institutionId: string }) =>
    row.institutionId !== "inst-penn-princeton");
  const reclassified = buildRegionalEvidenceReview(noReviewLink);
  assert.equal(reclassified.counts.coreNewsAttributionGaps, 2);
  assert.equal(reclassified.counts.coreNewsKnownSubsidiaryAttributionGaps, 2);
  assert.equal(reclassified.counts.coreNewsReviewScopeAttributionGaps, 1);
  assert.equal(reclassified.counts.coreNewsRegistrationGaps, 1);
});

test("separate Penn and Jefferson scope declarations retain their exact evidence and no invented capture dates", () => {
  const report = buildRegionalEvidenceReview(input());
  const penn = report.relationships.filter(row => row.sourceId === "ofs-penn-news");
  assert.equal(penn.length, 4);
  assert.equal(new Set(penn.flatMap(row => row.evidenceIds)).size, 4);
  assert.deepEqual(report.relationships.filter(row => row.sourceId === "rgn-jefferson-research").map(row => row.institutionId).sort(),
    ["inst-jefferson", "inst-regional-jefferson-university"]);
  for (const row of report.evidence) {
    assert.equal(row.evidenceVerifiedByThisSlice, false);
    assert.equal(row.observedAt, null);
    assert.equal(row.representationSha256, null);
    assert.equal(row.status, "review-only");
  }
});

test("multiple institution relationships do not multiply a source or its health receipt", () => {
  const report = buildRegionalEvidenceReview({ ...input(), health: [health()] });
  const withoutLinks = input(); withoutLinks.scopeInventory.relationships = [];
  const control = buildRegionalEvidenceReview({ ...withoutLinks, health: [health()] });
  assert.equal(report.sources.filter(row => row.sourceId === "ofs-penn-news").length, 1);
  assert.equal(report.counts.distinctSources, control.counts.distinctSources);
  assert.equal(report.counts.distinctConfiguredSources, control.counts.distinctConfiguredSources);
  assert.equal(report.counts.freshDistinctSourceHealthReceipts, 1);
  assert.equal(control.counts.freshDistinctSourceHealthReceipts, 1);
  assert.equal(report.relationships.filter(row => row.sourceId === "ofs-penn-news").length, 4);
});

test("a fresh parent article and complete source receipt cannot qualify either subsidiary", () => {
  const value = addBoundedEvidence(input(), "article");
  const report = buildRegionalEvidenceReview({ ...value, health: [health()] });
  assert.equal(report.sources.find(row => row.sourceId === "ofs-penn-news")!.sourceHealth.freshness, "fresh");
  for (const id of ["inst-penn-princeton", "inst-penn-doylestown"]) {
    const row = report.relationships.find(row => row.institutionId === id)!;
    assert.equal(row.institutionCoverageFreshness, "unknown");
    assert.equal(row.contentAttributionQualified, false);
    assert.equal(row.status, "review-only");
  }
  value.scopeInventory.relationships.find((row: { institutionId: string }) => row.institutionId === "inst-penn-princeton").evidenceIds = ["scope-bounded-observation"];
  assert.throws(() => buildRegionalEvidenceReview(value), /exact source, institution and kind/);
});

test("invited repository work cannot establish employment or become institutional scope evidence", () => {
  const value = input();
  value.scopeInventory.evidence.push({ id: "scope-invited-work", sourceId: "rgn-jefferson-research", kind: "repository-work",
    basis: "delegated-research-summary", url: "https://jdc.jefferson.edu/invited-work",
    summary: "Synthetic invited contributor work retained by the repository; the author is not shown to be employed by University or Health.",
    institutionIds: ["inst-jefferson"], inventoryEvidenceId: null, observedAt: null, representationSha256: null });
  const report = buildRegionalEvidenceReview(value);
  assert.equal(report.evidence.find(row => row.id === "scope-invited-work")!.currentEmployment, "unknown");
  assert.equal(report.counts.peopleWithCurrentEmployment, null);
  value.scopeInventory.relationships.find((row: { id: string }) => row.id === "rel-jdc-health").evidenceIds = ["scope-invited-work"];
  assert.throws(() => buildRegionalEvidenceReview(value), /exact source, institution and kind/);
});

test("University CaPTk link preserves exact University scope and cannot imply UPHS ownership", () => {
  const value = input(), report = buildRegionalEvidenceReview(value);
  const link = report.relationships.find(row => row.id === "rel-penn-captk")!;
  assert.equal(link.institutionId, "inst-regional-penn-university");
  assert.equal(link.repositoryOwnership, "unknown");
  assert.equal(link.contentAttributionQualified, false);
  value.scopeInventory.relationships.find((row: { id: string }) => row.id === link.id).institutionId = "inst-penn";
  assert.throws(() => buildRegionalEvidenceReview(value), /exact source, institution and kind/);
  value.scopeInventory.evidence.find((row: { id: string }) => row.id === "scope-penn-captk").institutionIds = ["inst-penn"];
  assert.throws(() => buildRegionalEvidenceReview(value), /inventory-evidence-scope-mismatch/);
});

for (const kind of ["profile", "article", "committee"] as const) test(`${kind} cannot imply a complete leadership roster`, () => {
  const value = addBoundedEvidence(input(), kind);
  const report = buildRegionalEvidenceReview({ ...value, health: [health()] });
  assert.equal(report.evidence.find(row => row.id === "scope-bounded-observation")!.completeLeadershipRoster, "unknown");
  assert.equal(report.counts.completeLeadershipRosters, null);
  assert.equal(report.counts.qualifiedInstitutionCoverage, null);
  value.scopeInventory.relationships[0].evidenceIds = ["scope-bounded-observation"];
  assert.throws(() => buildRegionalEvidenceReview(value), /exact source, institution and kind/);
});

function leadershipInput(ageHours: number, cadence = "daily") {
  const value = input();
  value.existingLeadershipSources = [{ id: "src-synthetic-leadership", institutionId: "inst-penn", kind: "leadership-page",
    status: "enabled", monitor: true, cadence, url: "https://www.pennmedicine.org/about/leadership" }];
  const success = new Date(Date.parse(asOf) - ageHours * 3_600_000).toISOString();
  const receipt: RegionalEvidenceLeadershipReceipt = { sourceId: "src-synthetic-leadership", institutionId: "inst-penn",
    state: "unchanged", lastSuccessAt: success, lastAttemptedAt: asOf, nextAttemptAt: null, consecutiveFailures: 0 };
  return { ...value, health: [health(receipt.sourceId, { lastSuccessAt: success })], leadershipRuntime: [receipt] };
}
const leadershipRow = (age: number, cadence = "daily") => buildRegionalEvidenceReview(leadershipInput(age, cadence)).sources.find(row => row.sourceId === "src-synthetic-leadership")!;

test("daily diagnostic uses authoritative 26 hours while existing read projection remains 48 hours", () => {
  const before = leadershipRow(25), boundary = leadershipRow(26), after = leadershipRow(26 + 1 / 3_600_000);
  assert.equal(before.sourceHealth.budgetMs, 48 * 3_600_000);
  assert.equal(before.leadershipOperational!.budgetMs, 26 * 3_600_000);
  assert.equal(before.leadershipOperational!.freshness, "fresh");
  assert.equal(boundary.leadershipOperational!.freshness, "fresh");
  assert.equal(after.leadershipOperational!.freshness, "stale");
  assert.equal(after.sourceHealth.freshness, "fresh");
  assert.equal(after.leadershipOperational!.clockDiffersFromReadProjection, true);
  assert.equal(leadershipRow(49).sourceHealth.freshness, "stale");
});

test("hourly and weekly diagnostic budgets follow configured cadence and remain distinct clocks", () => {
  assert.equal(leadershipRow(1, "hourly").leadershipOperational!.budgetMs, 2 * 3_600_000);
  const weekly = leadershipRow(171, "weekly");
  assert.equal(weekly.leadershipOperational!.budgetMs, 170 * 3_600_000);
  assert.equal(weekly.sourceHealth.budgetMs, 192 * 3_600_000);
  assert.equal(weekly.leadershipOperational!.freshness, "stale");
  assert.equal(weekly.sourceHealth.freshness, "fresh");
});

test("generic health cannot substitute for a leadership scheduler receipt or infer institution freshness", () => {
  const value = leadershipInput(1); value.leadershipRuntime = [];
  const report = buildRegionalEvidenceReview(value), row = report.sources.find(source => source.sourceId === "src-synthetic-leadership")!;
  assert.equal(row.sourceHealth.freshness, "fresh");
  assert.equal(row.leadershipOperational!.freshness, "unknown");
  assert.ok(report.relationships.every(link => link.institutionCoverageFreshness === "unknown"));
  assert.equal(buildRegionalEvidenceReview(input()).counts.freshDistinctSourceHealthReceipts, 0);
});

test("separate seven-day affiliation TTL remains exclusive and does not follow source freshness", async () => {
  const observedAt = asOf, profileUrl = "https://www.pennmedicine.org/person/synthetic-alex";
  const institution: RegionalInstitution = { id: "inst-penn", name: "Penn Medicine", kind: "health-system",
    existingInstitutionId: "inst-penn", officialHosts: ["www.pennmedicine.org"], regionalScope: "core", evidenceIds: ["ev-synthetic-role"], owner: "offline test" };
  const row = PublicAffiliation.parse({ id: "aff-synthetic-alex", personId: "person-synthetic-alex", fullName: "Alex Example",
    institutionId: institution.id, profileUrl, role: "Research Director", evidenceId: "ev-synthetic-role",
    validFrom: null, validUntil: null, observedAt, expiresAt: "2026-10-13T19:00:00Z" });
  async function citation(id: string, body: string, representation: RegionalEvidence["representation"]) {
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
    const evidence: RegionalEvidence = { id, url: profileUrl, observedAt, sourcePublishedAt: null, representation,
      representationSha256: [...bytes].map(value => value.toString(16).padStart(2, "0")).join(""), quote: body };
    return { evidence, retained: { url: profileUrl, observedAt, body } };
  }
  const role = await citation(row.evidenceId, `${row.fullName} ${row.role}`, "normalized-text");
  const profile = await citation("ev-synthetic-profile", JSON.stringify({ "@context": "https://schema.org", "@type": "ProfilePage", url: profileUrl,
    mainEntity: { "@type": "Person", name: row.fullName, url: profileUrl } }), "json");
  const token = await verifyPublicAffiliation(row, institution, role.evidence, role.retained, { profile });
  assert.ok(token);
  const author = { name: row.fullName, institutionalProfileUrl: profileUrl };
  assert.equal(resolveInstitutionalAuthor(author, [token], "2026-10-13T18:59:59Z").state, "matched");
  assert.equal(resolveInstitutionalAuthor(author, [token], row.expiresAt).state, "unresolved");
  assert.equal(resolveInstitutionalAuthor(author, [JSON.parse(JSON.stringify(token))], asOf).state, "unresolved");
  assert.throws(() => PublicAffiliation.parse({ ...row, expiresAt: "2026-10-13T19:00:00.001Z" }));
  assert.equal(buildRegionalEvidenceReview(input()).freshnessPolicies.affiliation.maxObservationTtlMs, 7 * 24 * 3_600_000);
});

test("duplicate, orphan and cross-institution identity joins fail closed", () => {
  const value = input();
  value.scopeInventory.relationships.push(structuredClone(value.scopeInventory.relationships[0]));
  assert.throws(() => buildRegionalEvidenceReview(value), /duplicate/);
  const unknown = input(); unknown.scopeInventory.relationships[0].sourceId = "source-missing";
  assert.throws(() => buildRegionalEvidenceReview(unknown));
  assert.throws(() => buildRegionalEvidenceReview({ ...input(), health: [health(), health()] }), /duplicate-source-health/);
  const runtime = leadershipInput(1);
  runtime.leadershipRuntime[0].institutionId = "inst-jefferson";
  assert.throws(() => buildRegionalEvidenceReview(runtime), /leadership-receipt-registry-mismatch/);
  const repeated = leadershipInput(1); repeated.leadershipRuntime.push(repeated.leadershipRuntime[0]);
  assert.throws(() => buildRegionalEvidenceReview(repeated), /duplicate-leadership-receipt/);
});

test("a citation from another host or channel cannot declare a source relationship", () => {
  const otherHost = input(); otherHost.scopeInventory.evidence[0].url = "https://jdc.jefferson.edu/about.html";
  assert.throws(() => buildRegionalEvidenceReview(otherHost), /scope-evidence-source-host-mismatch/);
  const otherChannel = input();
  otherChannel.scopeInventory.relationships.find((row: { id: string }) => row.id === "rel-jdc-health").relation = "newsroom-serves-institution";
  assert.throws(() => buildRegionalEvidenceReview(otherChannel), /relationship-source-channel-mismatch/);
});

test("receipt freshness rejects impossible calendars, future attempts and success after the attempt", () => {
  for (const overrides of [{ lastCheckedAt: "2026-02-30T19:00:00Z" }, { lastSuccessAt: "2026-10-07T19:00:00Z" }]) {
    if (overrides.lastCheckedAt) assert.throws(() => buildRegionalEvidenceReview({ ...input(), health: [health("ofs-penn-news", overrides)] }));
    else assert.equal(buildRegionalEvidenceReview({ ...input(), health: [health("ofs-penn-news", overrides)] }).counts.freshDistinctSourceHealthReceipts, 0);
  }
  const value = leadershipInput(1); value.leadershipRuntime[0].lastSuccessAt = "2026-10-07T19:00:00Z";
  assert.throws(() => buildRegionalEvidenceReview(value), /invalid-leadership-receipt-times/);
  const future = leadershipInput(1); future.leadershipRuntime[0].lastAttemptedAt = "2026-10-07T19:00:00Z";
  assert.throws(() => buildRegionalEvidenceReview(future), /invalid-leadership-receipt-times/);
});

test("fixed IDs, activation attempts, invented capture hashes and unsafe evidence URLs are rejected", () => {
  const changed = input(); changed.scopeInventory.coreMonitorIds[0] = "inst-replacement";
  assert.throws(() => buildRegionalEvidenceReview(changed), /fixed core monitor IDs changed/);
  const changedRegistry = input(); changedRegistry.existingInstitutions.find((row: { id: string }) => row.id === "inst-penn").covered = false;
  assert.throws(() => buildRegionalEvidenceReview(changedRegistry), /fixed-core-monitor-mismatch/);
  for (const changes of [{ collectionAuthorized: true }, { publicationAuthorized: true }, { activate: true }])
    assert.equal(RegionalEvidenceInventory.safeParse({ ...scopeInventory, ...changes }).success, false);
  for (const changes of [{ representationSha256: "a".repeat(64) }, { observedAt: asOf },
    { url: "https://127.0.0.1/" }, { url: "https://www.pennmedicine.org/news?token=private" }]) {
    const value = input(); Object.assign(value.scopeInventory.evidence[0], changes);
    assert.throws(() => buildRegionalEvidenceReview(value));
  }
});

test("review output omits errors, source query parameters and health completeness; input registries remain unchanged", () => {
  const value = input(), before = JSON.stringify(value);
  const report = buildRegionalEvidenceReview({ ...value, health: [health("ofs-penn-news", {
    lastError: "Bearer private-token", institutionIds: ["inst-penn-princeton", "inst-penn-doylestown"], complete: true,
  })] });
  const serialized = JSON.stringify(report);
  for (const forbidden of ["private-token", "lastError", "itemCount", "?redirect=", "?l=25", "?page=1", "\"complete\":true"])
    assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.equal(JSON.stringify(value), before);
  assert.equal(report.publicationAuthorized, false);
  assert.equal(report.collectionAuthorized, false);
  assert.equal(report.collectorActivatedByThisSlice, false);
  assert.equal(report.completeInstitutionCoverageClaimed, false);
  report.relationships[0].evidenceIds.splice(0);
  assert.ok(buildRegionalEvidenceReview(value).relationships[0].evidenceIds.length);
});
