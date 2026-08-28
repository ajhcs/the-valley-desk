import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { test } from "node:test";

import {
  CoveragePackDocument,
  coverageBoundsAreClosed,
  coveragePack,
  coveredInstitutions,
  geographyMatchesEntityBoundary,
  monitorableSources,
  officialSourceCoverage,
  sourceById,
} from "../src/ingest/coverage-pack.ts";
import {
  applyRoleChange,
  normalizeTitle,
  resolvePersonId,
} from "../src/ingest/executive-history.ts";
import {
  persistExecutiveRoleChange,
  persistLeadershipObservations,
  persistLeadershipSnapshots,
  readExecutiveRoles,
  reviewLeadershipObservation,
  seedCoveragePack,
  autonomouslyVerifyLeadership,
} from "../src/ingest/executive-persistence.ts";
import { monitorLeadershipSources, type LeadershipSnapshot } from "../src/ingest/leadership-monitor.ts";
import type { D1DatabaseLike, D1StatementLike } from "../src/ingest/persistence.ts";
import { normalizeSourceUrl } from "../src/ingest/identity.ts";

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

function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations").filter((file) => file.endsWith(".sql")).sort()) {
    database.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  return database;
}

function storedLeadershipSnapshot(
  sourceId: string,
  fetchedAt: string,
  leaders: Array<{ name: string; title: string }>,
  state: LeadershipSnapshot["state"] = "success",
  extractionStatus: LeadershipSnapshot["extractionStatus"] = "complete",
): LeadershipSnapshot {
  const extracted = leaders.map((leader) => ({
    ...leader,
    normalizedName: leader.name.toLowerCase(),
    normalizedTitle: normalizeTitle(leader.title),
  }));
  return {
    id: `test-${sourceId}-${fetchedAt}`,
    sourceId,
    fetchedAt,
    finalUrl: sourceById(sourceId)!.url,
    contentHash: `${sourceId}-${fetchedAt}`,
    normalizedText: leaders.map((leader) => `${leader.name} ${leader.title}`).join(" "),
    byteCount: new TextEncoder().encode(JSON.stringify(leaders)).byteLength,
    extracted,
    extractionStatus,
    state,
    error: null,
    instructionLike: false,
  };
}

test("coverage registry has closed geography, bounded fetches, and explicit 16-system posture", () => {
  assert.equal(coveredInstitutions().length, 16);
  assert.equal(officialSourceCoverage().length, 16);
  assert.equal(geographyMatchesEntityBoundary(), true);
  assert.equal(coverageBoundsAreClosed(), true);
  const statuses = new Map(officialSourceCoverage().map((row) => [row.shortName, row.status]));
  assert.equal(statuses.get("Jefferson"), "degraded");
  assert.equal(statuses.get("LVHN"), "active");
  assert.equal(statuses.get("Penn Princeton"), "degraded");
  assert.equal(statuses.get("Penn Doylestown"), "degraded");
  assert.equal(statuses.get("Cooper"), "active");
  assert.equal(statuses.get("Nemours"), "active");
  assert.equal(statuses.get("RWJBarnabas"), "active");
  assert.equal(statuses.get("St. Luke's"), "active");
  const sourceUrls = coveragePack.sources.map((source) => normalizeSourceUrl(source.url));
  assert.equal(new Set(sourceUrls).size, sourceUrls.length);
  assert.equal(
    sourceById("src-jefferson-enterprise-leadership")?.url,
    "https://magazine.jefferson.edu/content/dam/oia/2026/jim-spring-2026/Jefferson_Innovator_Magazine_Spring_2026.pdf",
  );
  assert.equal(
    sourceById("src-st-lukes-leadership")?.url,
    "https://www.slhn.org/about/leadership/executive-leadership",
  );
  assert.equal(
    sourceById("src-lvhn-leadership-committees")?.url,
    "https://www.lvhn.org/medical-staff-services/leadership-and-committees",
  );
  assert.equal(coveragePack.sources.some((source) => source.kind.startsWith("linkedin") && source.monitor), false);
});

test("leadership monitor persists exact bytes and never infers departures from incomplete pages", async () => {
  const source = monitorableSources()[0]!;
  const now = new Date("2026-08-28T12:00:00.000Z");
  const completeBody = "<h2>Julian Mihai</h2><p>CISO</p>";
  const complete = await monitorLeadershipSources({
    now,
    candidateCap: 1,
    concurrency: 1,
    fetchImpl: async () => new Response(completeBody, { status: 200 }),
  });
  assert.equal(complete.snapshots.length, 1);
  assert.equal(complete.snapshots[0]?.sourceId, source.id);
  assert.equal(complete.snapshots[0]?.extractionStatus, "complete");
  assert.equal(complete.snapshots[0]?.byteCount, new TextEncoder().encode(completeBody).byteLength);
  assert.ok(complete.observations.some((row) => row.kind === "person-appeared" && row.personId === "person-julian-mihai"));

  const previous = complete.schedule[0]!;
  const incomplete = await monitorLeadershipSources({
    now: new Date("2026-08-29T12:00:00.000Z"),
    candidateCap: 1,
    concurrency: 1,
    states: new Map([[source.id, { ...previous, nextAttemptAt: "2026-08-29T00:00:00.000Z" }]]),
    fetchImpl: async () => new Response("<html><body>Just a normal page</body></html>", { status: 200 }),
  });
  assert.equal(incomplete.snapshots[0]?.state, "success");
  assert.equal(incomplete.snapshots[0]?.extractionStatus, "unrecognized");
  assert.equal(incomplete.observations.length, 0);
  assert.equal(incomplete.schedule[0]?.state, "upstream-failed");
  assert.equal(incomplete.schedule[0]?.lastHash, previous.lastHash);

  const challenge = await monitorLeadershipSources({
    now: new Date("2026-08-30T12:00:00.000Z"),
    candidateCap: 1,
    concurrency: 1,
    fetchImpl: async () => new Response("<html><body>Checking your browser...</body></html>", { status: 200 }),
  });
  assert.equal(challenge.snapshots[0]?.state, "hostile");
  assert.equal(challenge.snapshots[0]?.extractionStatus, "challenge");
  assert.equal(challenge.observations[0]?.kind, "hostile-content");
});

test("role changes normalize replacement titles and preserve the prior history row", () => {
  const first = applyRoleChange([], {
    personId: "person-julian-mihai",
    institutionId: "inst-penn",
    title: "Chief Information Officer",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(first.applied, "inserted");
  const replacement = applyRoleChange(first.roles, {
    personId: "person-julian-mihai",
    institutionId: "inst-penn",
    title: "CIO",
    replacesNormalizedTitle: "chief-information officer",
    effectiveFrom: "2026-06-01T00:00:00.000Z",
  });
  assert.equal(replacement.applied, "superseded");
  assert.equal(replacement.roles[0]?.effectiveTo, "2026-06-01T00:00:00.000Z");
  assert.equal(replacement.roles[1]?.normalizedTitle, normalizeTitle("CIO"));
  assert.equal(resolvePersonId("Julian Mihai", coveragePack.people, "inst-penn"), "person-julian-mihai");
  assert.equal(resolvePersonId("Julian Mihai", coveragePack.people, "inst-temple"), undefined);
});

test("coverage seed and reviewer verification persist identity, evidence, and role status", async () => {
  const database = migratedDatabase();
  const db = sqliteD1(database);
  const now = new Date("2026-08-28T12:00:00.000Z");
  await seedCoveragePack(db, coveragePack, now);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM covered_institutions WHERE covered = 1").get().count, 16);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM scheduled_source_state").get().count, monitorableSources().length);
  const penn = database.prepare(
    "SELECT known_title, source_ids_json FROM covered_people WHERE id = 'person-julian-mihai'",
  ).get() as { known_title: string; source_ids_json: string };
  assert.equal(penn.known_title, "CISO");
  assert.deepEqual(JSON.parse(penn.source_ids_json), ["src-penn-is-leadership"]);
  const degraded = database.prepare(
    "SELECT official_source_status FROM covered_institutions WHERE id = 'inst-jefferson'",
  ).get() as { official_source_status: string };
  assert.equal(degraded.official_source_status, "degraded");

  const body = "<h2>Julian Mihai</h2><p>CISO</p>";
  const monitored = await monitorLeadershipSources({
    now,
    candidateCap: 1,
    concurrency: 1,
    fetchImpl: async () => new Response(body, { status: 200 }),
  });
  await persistLeadershipSnapshots(db, monitored.snapshots);
  await persistLeadershipObservations(db, monitored.observations);
  const observationId = monitored.observations.find((row) => row.kind === "person-appeared")?.id;
  assert.ok(observationId);
  const review = await reviewLeadershipObservation(db, observationId, "verified", "reviewer@example.com", "checked");
  assert.equal(review.decision, "verified");
  assert.equal(review.role?.applied, "inserted");
  const role = (await readExecutiveRoles(db, "person-julian-mihai", "inst-penn"))[0]!;
  assert.equal(role.verificationStatus, "verified");
  assert.equal(role.evidenceUrl, normalizeSourceUrl(sourceById(monitored.snapshots[0]!.sourceId)?.url));
  const observation = database.prepare(
    "SELECT status, verification_status, reviewed_by FROM source_observations WHERE id = ?",
  ).get(observationId) as { status: string; verification_status: string; reviewed_by: string };
  assert.equal(observation.status, "review");
  assert.equal(observation.verification_status, "verified");
  assert.equal(observation.reviewed_by, "reviewer@example.com");
  database.close();
});

test("requested replacements never silently become concurrent roles", async () => {
  const database = migratedDatabase();
  const db = sqliteD1(database);
  await seedCoveragePack(db, coveragePack, new Date("2026-08-28T12:00:00.000Z"));
  await persistExecutiveRoleChange(db, {
    personId: "person-julian-mihai",
    institutionId: "inst-penn",
    title: "CISO",
    sourceId: "src-penn-is-leadership",
    evidenceUrl: "https://www.pennmedicine.org/information-services/leadership",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
  });
  const result = await persistExecutiveRoleChange(db, {
    personId: "person-julian-mihai",
    institutionId: "inst-penn",
    title: "Chief Information Officer",
    replacesNormalizedTitle: "Chief Security Officer",
    effectiveFrom: "2026-02-01T00:00:00.000Z",
  });
  assert.equal(result.applied, "unchanged");
  assert.equal((await readExecutiveRoles(db, "person-julian-mihai", "inst-penn")).length, 1);
  database.close();
});

test("autonomous verification applies only after two daily snapshots and emits a review candidate", async () => {
  const database = migratedDatabase();
  const db = sqliteD1(database);
  await seedCoveragePack(db, coveragePack, new Date("2026-08-27T12:00:00.000Z"));
  const sourceId = "src-penn-is-leadership";
  const leader = { name: "Julian Mihai", title: "CISO" };
  await persistLeadershipSnapshots(db, [storedLeadershipSnapshot(
    sourceId,
    "2026-08-27T12:00:00.000Z",
    [leader],
  )]);
  const pending = await autonomouslyVerifyLeadership(db, coveragePack, new Date("2026-08-27T12:00:00.000Z"));
  assert.equal(pending.verifiedRoles, 0);
  assert.equal((await readExecutiveRoles(db, "person-julian-mihai", "inst-penn")).length, 0);

  await persistLeadershipSnapshots(db, [storedLeadershipSnapshot(
    sourceId,
    "2026-08-28T12:00:00.000Z",
    [leader],
  )]);
  const verified = await autonomouslyVerifyLeadership(db, coveragePack, new Date("2026-08-28T12:00:00.000Z"));
  assert.equal(verified.verifiedRoles, 1);
  assert.equal(verified.editorialCandidates.length, 1);
  assert.equal(verified.editorialCandidates[0]?.status, "review");
  assert.equal(verified.editorialCandidates[0]?.source.origin, "executive-leadership-monitor");
  const role = (await readExecutiveRoles(db, "person-julian-mihai", "inst-penn"))[0]!;
  assert.equal(role.verificationStatus, "verified");
  assert.equal(role.verifiedBy, "autonomous-leadership-monitor");
  assert.equal(role.evidenceUrl, sourceById(sourceId)!.url);
  database.close();
});

test("unknown roster names persist and enroll only after repeated first-party evidence", async () => {
  const database = migratedDatabase();
  const db = sqliteD1(database);
  await seedCoveragePack(db, coveragePack, new Date("2026-08-27T12:00:00.000Z"));
  const sourceId = "src-penn-is-leadership";
  const leader = { name: "Morgan Example", title: "Chief Operating Officer" };
  await persistLeadershipSnapshots(db, [storedLeadershipSnapshot(
    sourceId,
    "2026-08-27T12:00:00.000Z",
    [leader],
  )]);
  const pending = await autonomouslyVerifyLeadership(db, coveragePack, new Date("2026-08-27T12:00:00.000Z"));
  assert.equal(pending.verifiedRoles, 0);
  assert.equal(database.prepare(
    "SELECT status, enrolled_person_id FROM executive_enrollment_candidates WHERE institution_id = 'inst-penn' AND normalized_name = 'morgan example'",
  ).get().status, "pending");
  assert.equal((await readExecutiveRoles(db, undefined, "inst-penn")).some((role) => role.title === leader.title), false);

  await persistLeadershipSnapshots(db, [storedLeadershipSnapshot(
    sourceId,
    "2026-08-28T12:00:00.000Z",
    [leader],
  )]);
  const enrolled = await autonomouslyVerifyLeadership(db, coveragePack, new Date("2026-08-28T12:00:00.000Z"));
  assert.equal(enrolled.verifiedRoles, 1);
  const candidate = database.prepare(
    "SELECT status, enrolled_person_id FROM executive_enrollment_candidates WHERE institution_id = 'inst-penn' AND normalized_name = 'morgan example'",
  ).get() as { status: string; enrolled_person_id: string };
  assert.equal(candidate.status, "enrolled");
  assert.match(candidate.enrolled_person_id, /^person-inst-penn-morgan-example$/);
  const role = (await readExecutiveRoles(db, candidate.enrolled_person_id, "inst-penn"))[0]!;
  assert.equal(role.verificationStatus, "verified");
  assert.equal(enrolled.editorialCandidates.length, 1);
  assert.doesNotMatch(enrolled.editorialCandidates[0]!.body, /autonomously|editorial candidate|review/i);
  assert.doesNotMatch(enrolled.editorialCandidates[0]!.dek, /autonomously|editorial candidate|review/i);
  await persistLeadershipSnapshots(db, [storedLeadershipSnapshot(
    sourceId,
    "2026-08-29T12:00:00.000Z",
    [leader],
  )]);
  const unchanged = await autonomouslyVerifyLeadership(db, coveragePack, new Date("2026-08-29T12:00:00.000Z"));
  assert.equal(unchanged.verifiedRoles, 0);
  assert.equal(unchanged.editorialCandidates.length, 0);
  database.close();
});

test("same-name identities across institutions remain ambiguous", async () => {
  const database = migratedDatabase();
  const db = sqliteD1(database);
  await seedCoveragePack(db, coveragePack, new Date("2026-08-27T12:00:00.000Z"));
  await persistExecutiveRoleChange(db, {
    personId: "person-julian-mihai",
    institutionId: "inst-penn",
    title: "Chief Operating Officer",
    sourceId: "src-penn-is-leadership",
    evidenceUrl: sourceById("src-penn-is-leadership")!.url,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
  });
  const sourceId = "src-main-line-leadership";
  const leader = { name: "Julian Mihai", title: "Chief Operating Officer" };
  await persistLeadershipSnapshots(db, [
    storedLeadershipSnapshot(sourceId, "2026-08-27T12:00:00.000Z", [leader]),
    storedLeadershipSnapshot(sourceId, "2026-08-28T12:00:00.000Z", [leader]),
  ]);
  const result = await autonomouslyVerifyLeadership(db, coveragePack, new Date("2026-08-28T12:00:00.000Z"));
  assert.equal(result.verifiedRoles, 0);
  const candidate = database.prepare(
    "SELECT status FROM executive_enrollment_candidates WHERE institution_id = 'inst-main-line' AND normalized_name = 'julian mihai'",
  ).get() as { status: string };
  assert.equal(candidate.status, "ambiguous");
  assert.equal((await readExecutiveRoles(db, "person-julian-mihai", "inst-main-line")).length, 0);
  database.close();
});

test("conflicting titles retain an unknown identity without auto-enrollment", async () => {
  const database = migratedDatabase();
  const db = sqliteD1(database);
  const testPack = CoveragePackDocument.parse({
    ...coveragePack,
    sources: [...coveragePack.sources, {
      id: "src-main-line-alt",
      institutionId: "inst-main-line",
      kind: "leadership-page",
      url: "https://alt.mainlinehealth.org/about/leadership",
      host: "alt.mainlinehealth.org",
      precedence: 90,
      monitor: true,
      cadence: "daily",
      status: "enabled",
    }],
  });
  await seedCoveragePack(db, testPack, new Date("2026-08-27T12:00:00.000Z"));
  const leader = { name: "Taylor Example", title: "Chief Operating Officer" };
  await persistLeadershipSnapshots(db, [
    storedLeadershipSnapshot("src-main-line-leadership", "2026-08-27T12:00:00.000Z", [leader]),
    storedLeadershipSnapshot("src-main-line-leadership", "2026-08-28T12:00:00.000Z", [leader]),
  ]);
  const alternate = storedLeadershipSnapshot("src-main-line-leadership", "2026-08-28T12:00:00.000Z", [{
    name: leader.name,
    title: "Chief Financial Officer",
  }]);
  await persistLeadershipSnapshots(db, [{
    ...alternate,
    id: "test-src-main-line-alt-2026-08-28T12:00:00.000Z",
    sourceId: "src-main-line-alt",
    finalUrl: "https://alt.mainlinehealth.org/about/leadership",
  }]);
  const result = await autonomouslyVerifyLeadership(db, testPack, new Date("2026-08-28T12:00:00.000Z"));
  assert.equal(result.verifiedRoles, 0);
  assert.ok(result.conflicts >= 1);
  const candidate = database.prepare(
    "SELECT status, independent_source_count FROM executive_enrollment_candidates WHERE institution_id = 'inst-main-line' AND normalized_name = 'taylor example'",
  ).get() as { status: string; independent_source_count: number };
  assert.equal(candidate.status, "pending");
  assert.equal(candidate.independent_source_count, 2);
  database.close();
});

test("autonomous departure requires two snapshots on two independent official sources", async () => {
  const database = migratedDatabase();
  const db = sqliteD1(database);
  await seedCoveragePack(db, coveragePack, new Date("2026-08-27T12:00:00.000Z"));
  const roleSourceId = "src-chop-salmasian";
  await persistExecutiveRoleChange(db, {
    personId: "person-hojjat-salmasian",
    institutionId: "inst-chop",
    title: "Vice President and Chief Data and Analytics Officer",
    sourceId: roleSourceId,
    evidenceUrl: sourceById(roleSourceId)!.url,
    effectiveFrom: "2026-08-01T12:00:00.000Z",
    verificationStatus: "verified",
    verifiedBy: "fixture",
    verifiedAt: "2026-08-01T12:00:00.000Z",
  });
  const absent = [{ name: "Alicia Example", title: "Chief Executive Officer" }];
  await persistLeadershipSnapshots(db, [
    storedLeadershipSnapshot("src-chop-salmasian", "2026-08-27T12:00:00.000Z", absent),
    storedLeadershipSnapshot("src-chop-salmasian", "2026-08-28T12:00:00.000Z", absent),
    storedLeadershipSnapshot("src-chop-desai", "2026-08-28T12:00:00.000Z", absent),
  ]);
  const pending = await autonomouslyVerifyLeadership(db, coveragePack, new Date("2026-08-28T12:00:00.000Z"));
  assert.equal(pending.editorialCandidates.some((item) => item.title.includes("Hojjat")), false);
  assert.equal((await readExecutiveRoles(db, "person-hojjat-salmasian", "inst-chop"))[0]!.effectiveTo, null);

  await persistLeadershipSnapshots(db, [
    storedLeadershipSnapshot("src-chop-desai", "2026-08-29T12:00:00.000Z", absent),
  ]);
  const verified = await autonomouslyVerifyLeadership(db, coveragePack, new Date("2026-08-29T12:00:00.000Z"));
  const role = (await readExecutiveRoles(db, "person-hojjat-salmasian", "inst-chop"))[0]!;
  assert.equal(role.effectiveTo, "2026-08-29T12:00:00.000Z");
  assert.equal(verified.editorialCandidates.some((item) => item.title.includes("Hojjat")), true);
  database.close();
});
