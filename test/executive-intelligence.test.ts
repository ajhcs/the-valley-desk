import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { test } from "node:test";
import entityFixtures from "../fixtures/entities.json";
import linkedInInventory from "../fixtures/linkedin-notification-targets.json";

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
import { extractLeaders, monitorLeadershipSources, type LeadershipSnapshot } from "../src/ingest/leadership-monitor.ts";
import type { D1DatabaseLike, D1StatementLike } from "../src/ingest/persistence.ts";
import { normalizeSourceUrl } from "../src/ingest/identity.ts";
import { Entity } from "../src/content/entity.ts";
import { buildRuntimeLeadershipCoverage } from "../src/lib/operational-status.ts";

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
  assert.equal(statuses.get("Jefferson"), "active");
  assert.equal(statuses.get("LVHN"), "active");
  assert.equal(statuses.get("Penn Princeton"), "active");
  assert.equal(statuses.get("Penn Doylestown"), "active");
  assert.equal(statuses.get("Cooper"), "active");
  assert.equal(statuses.get("Nemours"), "active");
  assert.equal(statuses.get("RWJBarnabas"), "active");
  assert.equal(statuses.get("St. Luke's"), "active");
  const sourceUrls = coveragePack.sources.map((source) => normalizeSourceUrl(source.url));
  assert.equal(new Set(sourceUrls).size, sourceUrls.length);
  assert.equal(
    sourceById("src-jefferson-enterprise-leadership")?.url,
    "https://www.jeffersonhealth.org/about-us/news/2025/05/jefferson-extends-contract-with-ceo-joseph-g-cacchione-md",
  );
  assert.equal(
    sourceById("src-st-lukes-leadership")?.url,
    "https://www.slhn.org/about/leadership/executive-leadership",
  );
  assert.equal(
    sourceById("src-penn-princeton-leadership")?.url,
    "https://www.pennmedicine.org/news/penn-medicine-to-break-ground-on-cancer-center-at-princeton-health",
  );
  assert.deepEqual(
    sourceById("src-penn-princeton-leadership")?.alternateUrls,
    ["https://www.pennmedicine.org/locations/entity/princeton-health/financial-reporting"],
  );
  assert.equal(
    sourceById("src-penn-doylestown-ceo")?.url,
    "https://www.pennmedicine.org/news/craig-gronczewski-named-ceo-of-penn-medicine-doylestown-health",
  );
  assert.equal(
    sourceById("src-lvhn-leadership-committees")?.url,
    "https://www.lvhn.org/medical-staff-services/leadership-and-committees",
  );
  assert.equal(
    sourceById("src-christianacare-leadership")?.url,
    "https://christianacare.org/us/en/about-us/who-we-are/our-leadership",
  );
  assert.equal(
    sourceById("src-tower-leadership")?.url,
    "https://towerhealth.org/about/tower-health-leadership-team",
  );
  assert.equal(coveragePack.sources.some((source) => source.kind.startsWith("linkedin") && source.monitor), false);
});

test("runtime leadership coverage separates configured posture from fresh source health", () => {
  const configured = officialSourceCoverage().map((row) => ({ ...row, configuredStatus: row.status }));
  const now = new Date("2026-08-28T12:00:00.000Z");
  const pennSource = configured.find((row) => row.shortName === "Penn")!.sourceIds[0]!;
  const mainLineSources = configured.find((row) => row.shortName === "Main Line")!.sourceIds;
  const cooperSource = configured.find((row) => row.shortName === "Cooper")!.sourceIds[0]!;
  const templeSource = configured.find((row) => row.shortName === "Temple")!.sourceIds[0]!;
  const coverage = buildRuntimeLeadershipCoverage(configured, [
    {
      sourceId: pennSource,
      institutionId: "inst-penn",
      state: "healthy",
      lastSuccessAt: "2026-08-28T11:30:00.000Z",
      lastAttemptedAt: "2026-08-28T11:30:00.000Z",
      nextAttemptAt: "2026-08-28T12:30:00.000Z",
    },
    {
      sourceId: mainLineSources[0]!,
      institutionId: "inst-main-line",
      state: "upstream-failed",
      lastSuccessAt: "2026-08-28T09:00:00.000Z",
      lastAttemptedAt: "2026-08-28T11:00:00.000Z",
      nextAttemptAt: "2026-08-28T12:15:00.000Z",
      consecutiveFailures: 2,
      lastError: "HTTP 503",
    },
    {
      sourceId: mainLineSources[1]!,
      institutionId: "inst-main-line",
      state: "healthy",
      lastSuccessAt: "2026-08-28T11:45:00.000Z",
      lastAttemptedAt: "2026-08-28T11:45:00.000Z",
      nextAttemptAt: "2026-08-28T12:45:00.000Z",
    },
    {
      sourceId: cooperSource,
      institutionId: "inst-cooper",
      state: "blocked",
      lastAttemptedAt: "2026-08-28T11:30:00.000Z",
      nextAttemptAt: "2026-08-28T12:30:00.000Z",
      consecutiveFailures: 1,
      lastError: "HTTP 403",
    },
    {
      sourceId: templeSource,
      institutionId: "inst-temple",
      state: "healthy",
      lastSuccessAt: "2026-08-28T08:00:00.000Z",
      lastAttemptedAt: "2026-08-28T08:00:00.000Z",
      nextAttemptAt: "2026-08-28T13:00:00.000Z",
    },
  ], now);
  const byName = new Map(coverage.map((row) => [row.shortName, row]));
  assert.equal(byName.get("Penn")?.state, "healthy");
  assert.equal(byName.get("Main Line")?.state, "degraded");
  assert.equal(byName.get("Main Line")?.coverageLost, false);
  assert.equal(byName.get("Cooper")?.state, "blocked");
  assert.equal(byName.get("Cooper")?.coverageLost, true);
  assert.equal(byName.get("Temple")?.state, "failed", "stale success is not current coverage");
  assert.equal(byName.get("Jefferson")?.configuredStatus, "active");
  assert.equal(byName.get("Jefferson")?.state, "failed", "configured sources still need a fresh runtime observation");
  assert.equal(byName.get("Main Line")?.sourceStates[0]?.state, "backoff");

  const transient = buildRuntimeLeadershipCoverage([
    { institutionId: "inst-transient", shortName: "Transient", configuredStatus: "active", sourceIds: ["src-transient"] },
  ], [{
    sourceId: "src-transient",
    institutionId: "inst-transient",
    state: "blocked",
    lastSuccessAt: "2026-08-28T11:30:00.000Z",
    lastAttemptedAt: "2026-08-28T11:45:00.000Z",
    nextAttemptAt: "2026-08-28T12:30:00.000Z",
    consecutiveFailures: 1,
    lastError: "HTTP 403",
  }], now)[0]!;
  assert.equal(transient.state, "blocked");
  assert.equal(transient.coverageLost, false, "recent blocked sources retain coverage within the freshness SLO");
});

test("leadership source alternatives stay allowlisted and rescue incomplete primaries", async () => {
  const source = monitorableSources()[0]!;
  const alternateUrl = "https://www.pennmedicine.org/information-services/leadership/alternate";
  const pack = CoveragePackDocument.parse({
    ...coveragePack,
    sources: coveragePack.sources.map((row) => (
      row.id === source.id ? { ...row, alternateUrls: [alternateUrl] } : row
    )),
  });
  const sourceUrl = normalizeSourceUrl(source.url)!;
  const alternateCanonicalUrl = normalizeSourceUrl(alternateUrl)!;
  const requested: string[] = [];
  const result = await monitorLeadershipSources({
    pack,
    now: new Date("2026-08-28T12:00:00.000Z"),
    candidateCap: 1,
    concurrency: 1,
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      if (url === sourceUrl) return new Response("<html><body>No roster here</body></html>", { status: 200 });
      if (url === alternateCanonicalUrl) return new Response("<h2>Julian Mihai</h2><p>CISO</p>", { status: 200 });
      return new Response("", { status: 503 });
    },
  });
  assert.deepEqual(requested, [sourceUrl, alternateCanonicalUrl]);
  assert.equal(result.snapshots[0]?.sourceId, source.id);
  assert.equal(result.snapshots[0]?.finalUrl, alternateCanonicalUrl);
  assert.equal(result.snapshots[0]?.state, "success");
  assert.equal(result.snapshots[0]?.extractionStatus, "complete");
  assert.deepEqual(result.fetchedUrls, [alternateCanonicalUrl]);
});

test("official leadership extraction contracts parse only their scoped card structures", () => {
  const cases = [
    {
      sourceId: "src-tower-leadership",
      expected: "alex tower",
      body: `<h1>Tower Health Leadership Team</h1>${["Alex Tower", "Blair Tower", "Casey Tower"].map((name) => (
        `<div class="people-teaser"><span class="people-teaser__name">${name}, MBA</span><span class="people-teaser__meta">Executive Vice President</span><span class="people-teaser__meta">Chief Information Officer</span></div>`
      )).join("")}`,
    },
    {
      sourceId: "src-st-lukes-leadership",
      expected: "alex luke",
      body: `<h1>Executive Leadership</h1>${["Alex Luke", "Blair Luke", "Casey Luke"].map((name) => (
        `<div class="card card-text-overlay__item"><div class="card-text-overlay__item-content"><p class="card-text-overlay__text">${name}</p><p class="card-text-overlay__text tagline">Vice President<br>Chief Information Officer</p></div></div>`
      )).join("")}`,
    },
    {
      sourceId: "src-virtua-leadership",
      expected: "alex virtua",
      body: `<h2>Senior Leadership</h2>${["Alex Virtua", "Blair Virtua", "Casey Virtua"].map((name) => (
        `<div class="team-group__group-item"><p class="team-group__item-name">${name}, FACHE</p><p class="team-group__item-position">Executive VP and chief information officer</p></div>`
      )).join("")}`,
    },
    {
      sourceId: "src-main-line-luke-olenoski",
      expected: "luke olenoski",
      body: "<h2>Site Navigation</h2><h1>Luke Olenoski</h1><h2>Senior Vice President and Chief Information Officer</h2>",
    },
    {
      sourceId: "src-christianacare-gaboriault",
      expected: "randall gaboriault",
      body: "<h2 class=\"cmp-title__text\">Login</h2><h2 class=\"cmp-title__text\">Randall Gaboriault, MS, MBA</h2><h6 class=\"cmp-title__text\">Senior Vice President, Chief Digital and Information Officer</h6>",
    },
  ] as const;

  for (const row of cases) {
    const source = sourceById(row.sourceId)!;
    const extracted = extractLeaders(row.body, [], source.leadershipExtractionContract);
    assert.equal(extracted[0]?.normalizedName, row.expected, row.sourceId);
    assert.ok(extracted[0]?.normalizedTitle.includes("information officer"), row.sourceId);
  }

  const christiana = sourceById("src-christianacare-leadership")!;
  const cards = ["Alex Care", "Blair Care", "Casey Care", "Devon Care", "Emery Care"].map((name) => (
    `<div class="pagecard component style-leadership"><div class="cmp-pagecard__title_text"><a>${name}, MD</a></div><div class="cmp-pagecard__description">Chief Operating Officer</div></div>`
  )).join("");
  const extracted = extractLeaders(
    `<h1>Our Leadership</h1>${cards}<h2>Board of Directors</h2>`,
    [],
    christiana.leadershipExtractionContract,
  );
  assert.equal(extracted.length, 5);
  assert.equal(extracted[0]?.normalizedName, "alex care");
});

test("an incomplete contracted roster cannot infer departures", async () => {
  const target = sourceById("src-tower-leadership")!;
  const pack = CoveragePackDocument.parse({
    ...coveragePack,
    sources: coveragePack.sources.map((source) => (
      source.id === target.id
        ? source
        : source.kind.startsWith("linkedin")
          ? source
          : { ...source, monitor: false, cadence: "inventory", status: "inventory-only" }
    )),
  });
  const previousLeaders = ["Alex Tower", "Blair Tower", "Casey Tower", "Devon Tower"].map((name) => ({
    name,
    normalizedName: name.toLowerCase(),
    title: "Chief Information Officer",
    normalizedTitle: "chief information officer",
  }));
  const result = await monitorLeadershipSources({
    pack,
    now: new Date("2026-09-01T18:00:00.000Z"),
    states: new Map([[target.id, {
      sourceId: target.id,
      state: "healthy" as const,
      lastHash: "previous",
      lastExtracted: previousLeaders,
      nextAttemptAt: "2026-09-01T17:00:00.000Z",
      consecutiveFailures: 0,
    }]]),
    candidateCap: 1,
    concurrency: 1,
    fetchImpl: async () => new Response(
      "<h1>Tower Health Leadership Team</h1><div class=\"people-teaser\"><span class=\"people-teaser__name\">Alex Tower</span><span class=\"people-teaser__meta\">Chief Information Officer</span></div>",
      { status: 200 },
    ),
  });
  assert.equal(result.snapshots[0]?.state, "failed");
  assert.equal(result.snapshots[0]?.extractionStatus, "partial");
  assert.equal(result.observations.some((row) => row.kind === "person-departed"), false);
});

test("public leadership 403 is a blocked source with retry metadata", async () => {
  const source = monitorableSources()[0]!;
  const result = await monitorLeadershipSources({
    pack: coveragePack,
    now: new Date("2026-08-28T12:00:00.000Z"),
    candidateCap: 1,
    concurrency: 1,
    fetchImpl: async () => new Response("access denied", { status: 403 }),
  });
  assert.equal(result.snapshots[0]?.sourceId, source.id);
  assert.equal(result.snapshots[0]?.state, "blocked");
  assert.equal(result.snapshots[0]?.httpStatus, 403);
  assert.equal(result.schedule[0]?.state, "blocked");
  assert.ok(result.schedule[0]?.nextAttemptAt);
});

test("leadership monitor retains institution-bound article facts without current-affiliation updates", async () => {
  const cases = [
    {
      sourceId: "src-jefferson-enterprise-leadership",
      expectedName: "joseph g cacchione",
      body: "<html><head><title>Jefferson Extends Contract with CEO Joseph G. Cacchione, MD | Jefferson Health</title></head><body></body></html>",
    },
    {
      sourceId: "src-penn-princeton-leadership",
      expectedName: "james demetriades",
      body: "<main><h1>Penn Medicine breaks ground on cancer center at Princeton Health</h1><p>\"This is a significant first step,\" said Princeton Health CEO James Demetriades.</p></main>",
    },
    {
      sourceId: "src-penn-doylestown-ceo",
      expectedName: "craig gronczewski",
      body: "<main><h1>Craig Gronczewski, MD, MBA, FACHE, named Chief Executive Officer of Penn Medicine Doylestown Health</h1></main>",
    },
  ] as const;

  for (const row of cases) {
    const source = sourceById(row.sourceId)!;
    const pack = CoveragePackDocument.parse({
      ...coveragePack,
      sources: coveragePack.sources.map((candidate) => (
        candidate.id === row.sourceId
          ? candidate
          : { ...candidate, monitor: false, cadence: "inventory", status: "inventory-only" }
      )),
    });
    const institution = pack.institutions.find((candidate) => candidate.id === source.institutionId)!;
    const direct = extractLeaders(row.body, institution.aliases);
    assert.equal(direct[0]?.normalizedName, row.expectedName);
    const result = await monitorLeadershipSources({
      pack,
      now: new Date("2026-08-31T12:00:00.000Z"),
      candidateCap: 1,
      concurrency: 1,
      fetchImpl: async () => new Response(row.body, { status: 200 }),
    });
    assert.equal(result.snapshots[0]?.state, "failed");
    assert.equal(result.snapshots[0]?.extractionStatus, "partial");
    assert.equal(result.snapshots[0]?.extracted[0]?.normalizedName, row.expectedName);
    assert.equal(result.snapshots[0]?.extracted[0]?.articleEvidence?.currentAffiliationVerified, false);
    assert.deepEqual(result.observations, []);
  }
});


test("article block boundaries exclude section labels without losing inline names or institution scope", () => {
  const aliases = ["Penn Medicine Doylestown Health"];
  for (const label of ["Announcement", "News", "Press Release", "Leadership Update"]) {
    for (const wrapper of ["span", "div", "p"]) {
      const html = `<main><${wrapper}>${label}</${wrapper}><h1>Alex <em>Example</em>, MD, named Chief Executive Officer of Penn Medicine Doylestown Health</h1></main>`;
      assert.deepEqual(extractLeaders(html, aliases).map((row) => row.normalizedName), ["alex example"]);
    }
  }
  const longName = "<main><h1>Mary Ann Van Der Berg-Smith named Chief Executive Officer of Penn Medicine Doylestown Health</h1></main>";
  assert.equal(extractLeaders(longName, aliases)[0]?.name, "Mary Ann Van Der Berg-Smith");
  // An institution in a separate block cannot qualify an unrelated appointment.
  assert.deepEqual(extractLeaders("<main><p>Penn Medicine Doylestown Health</p><h1>Alex Example named CEO of Other Hospital</h1></main>", aliases), []);
});

test("dated and undated article snapshots preserve provenance in JSON without changing current identities", async () => {
  const fixture = JSON.parse(readFileSync("fixtures/leadership-article-regressions-20261003.json", "utf8")) as {
    representation: string;
    cases: Array<{ sourceId: string; expectedName: string; publishedAt: string | null; html: string }>;
  };
  assert.match(fixture.representation, /Synthetic/);
  for (const row of fixture.cases) {
    const source = sourceById(row.sourceId)!;
    const pack = CoveragePackDocument.parse({ ...coveragePack, sources: coveragePack.sources.map((candidate) => (
      candidate.id === row.sourceId ? { ...candidate, alternateUrls: [] } : { ...candidate, monitor: false, cadence: "inventory", status: "inventory-only" }
    )) });
    const institution = pack.institutions.find((candidate) => candidate.id === source.institutionId)!;
    const direct = extractLeaders(row.html, institution.aliases);
    assert.deepEqual(direct.map((leader) => leader.normalizedName), [row.expectedName]);
    assert.deepEqual(direct[0]?.articleEvidence, {
      sourcePublishedAt: row.publishedAt,
      sourcePublishedCandidates: row.publishedAt ? [row.publishedAt] : [],
      currentAffiliationVerified: false,
    });
    const database = migratedDatabase();
    const db = sqliteD1(database);
    await seedCoveragePack(db, pack);
    const prior = [{ name: "Prior Executive", normalizedName: "prior executive", title: "CEO", normalizedTitle: "ceo" }];
    for (const at of ["2026-10-03T12:00:00.000Z", "2026-10-04T12:00:00.000Z"]) {
      let requests = 0;
      const result = await monitorLeadershipSources({ pack, now: new Date(at), candidateCap: 1, concurrency: 1,
        states: new Map([[source.id, { sourceId: source.id, state: "healthy", lastSuccessAt: "2026-09-01T00:00:00.000Z", lastExtracted: prior, nextAttemptAt: "2026-09-02T00:00:00.000Z", consecutiveFailures: 0 }]]),
        fetchImpl: async () => { requests++; return new Response(row.html, { status: 200 }); },
      });
      assert.ok(requests > 0);
      const snapshot = result.snapshots[0]!;
      assert.equal(snapshot.fetchedAt, at);
      assert.equal(snapshot.extractionStatus, "partial");
      assert.equal(snapshot.state, "failed");
      assert.match(snapshot.error!, /current affiliation is unverified/);
      assert.deepEqual(result.observations, []);
      assert.deepEqual(result.schedule[0]?.lastExtracted, prior);
      assert.equal(result.schedule[0]?.lastSuccessAt, "2026-09-01T00:00:00.000Z");
      await persistLeadershipSnapshots(db, result.snapshots);
      await persistLeadershipObservations(db, result.observations);
      const saved = database.prepare("SELECT extracted_json, fetched_at, final_url FROM source_snapshots WHERE id = ?").get(snapshot.id) as { extracted_json: string; fetched_at: string; final_url: string };
      assert.deepEqual(JSON.parse(saved.extracted_json)[0]?.articleEvidence, direct[0]?.articleEvidence);
      assert.equal(saved.fetched_at, at);
      assert.equal(normalizeSourceUrl(saved.final_url), normalizeSourceUrl(source.url));
    }
    const verified = await autonomouslyVerifyLeadership(db, pack, new Date("2026-10-05T12:00:00.000Z"));
    assert.equal(verified.verifiedRoles, 0);
    assert.deepEqual(verified.editorialCandidates, []);
    assert.deepEqual(await readExecutiveRoles(db), []);
    database.close();
  }
});

test("failed alternates retain dated primary claims; a complete alternate roster still wins", async () => {
  const source = sourceById("src-penn-doylestown-ceo")!;
  const alternate = "https://www.pennmedicine.org/information-services/leadership/alternate";
  const pack = CoveragePackDocument.parse({ ...coveragePack, sources: coveragePack.sources.map((candidate) => (
    candidate.id === source.id ? { ...candidate, alternateUrls: [alternate] } : { ...candidate, monitor: false, cadence: "inventory", status: "inventory-only" }
  )) });
  const article = '<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-05-04"}</script><main><h1>Alex Example named CEO of Penn Medicine Doylestown Health</h1></main>';
  for (const fallback of ["empty", "blocked", "complete"] as const) {
    const requests: string[] = [];
    const result = await monitorLeadershipSources({ pack, now: new Date("2026-10-03T12:00:00.000Z"), candidateCap: 1, concurrency: 1,
      fetchImpl: async (input) => {
        requests.push(String(input));
        if (requests.length === 1) return new Response(article, { status: 200 });
        if (fallback === "blocked") return new Response("Forbidden", { status: 403 });
        return new Response(fallback === "complete" ? "<h2>Jordan Example</h2><p>Chief Executive Officer</p>" : "<main></main>", { status: 200 });
      },
    });
    assert.equal(requests.length, 2);
    const snapshot = result.snapshots[0]!;
    if (fallback === "complete") {
      assert.equal(snapshot.state, "success");
      assert.equal(normalizeSourceUrl(snapshot.finalUrl), normalizeSourceUrl(alternate));
      assert.equal(snapshot.extracted[0]?.normalizedName, "jordan example");
      assert.equal(snapshot.extracted[0]?.articleEvidence, undefined);
    } else {
      assert.equal(snapshot.state, "failed");
      assert.equal(snapshot.extractionStatus, "partial");
      assert.equal(normalizeSourceUrl(snapshot.finalUrl), normalizeSourceUrl(source.url));
      assert.equal(snapshot.extracted[0]?.articleEvidence?.sourcePublishedAt, "2026-05-04");
      assert.deepEqual(result.observations, []);
    }
  }
});

test("article dates retain original publication only; conflicts and invalid dates stay unverified", () => {
  const title = '<main><h1>Alex Example named CEO of Penn Medicine Doylestown Health</h1></main>';
  const extract = (metadata: string) => extractLeaders(metadata + title, ["Penn Medicine Doylestown Health"])[0]?.articleEvidence;
  assert.equal(extract('<meta property="article:published_time" content="2026-05-04T00:00:00Z">')?.sourcePublishedAt, "2026-05-04T00:00:00Z");
  assert.equal(extract('<script type="application/ld+json">{"@type":"NewsArticle","dateModified":"2026-10-03T00:00:00Z"}</script>')?.sourcePublishedAt, null);
  for (const date of ["2026-02-29", "2026-09-31", "2026-05-04T24:00:00Z", "2026-05-04T00:00:00", "nonsense"]) {
    assert.equal(extract(`<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"${date}"}</script>`)?.sourcePublishedAt, null);
  }
  const conflicting = extract('<meta property="article:published_time" content="2026-05-04"><script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2025-10-20"}</script>');
  assert.equal(conflicting?.sourcePublishedAt, null);
  assert.deepEqual(conflicting?.sourcePublishedCandidates, ["2025-10-20", "2026-05-04"]);
  assert.equal(extract('<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2024-02-29"}</script>')?.sourcePublishedAt, "2024-02-29");
  // Structured Person records embedded in an article are also historical claims.
  const personArticle = '<script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","datePublished":"2025-10-20"},{"@type":"Person","name":"Alex Example","jobTitle":"CEO"}]}</script>';
  assert.equal(extractLeaders(personArticle)[0]?.articleEvidence?.currentAffiliationVerified, false);
  const undatedHeadingArticle = '<main><h2>Alex Example</h2><p>Alex Example named Chief Executive Officer of Penn Medicine Doylestown Health</p></main>';
  assert.equal(extractLeaders(undatedHeadingArticle, ["Penn Medicine Doylestown Health"])[0]?.articleEvidence?.currentAffiliationVerified, false);
  // Ordinary roster cards keep their existing extraction shape.
  assert.equal(extractLeaders('<h2>Alex Example</h2><p>Chief Executive Officer</p>')[0]?.articleEvidence, undefined);
});

test("semantic articles cannot promote structured people; only explicit time publication dates qualify", async () => {
  const person = '<script type="application/ld+json">{"@type":"Person","name":"Alex Example","jobTitle":"CEO"}</script>';
  const article = (time: string) => `<article>${person}<h2>Alex Example</h2><p>Chief Executive Officer</p>${time}</article>`;
  const generic = extractLeaders(article('<time datetime="2025-10-20">October 20, 2025</time>'));
  assert.equal(generic[0]?.articleEvidence?.sourcePublishedAt, null);
  assert.equal(generic[0]?.articleEvidence?.currentAffiliationVerified, false);
  for (const time of ['<time itemprop="datePublished" datetime="2025-10-20">October 20, 2025</time>', '<time pubdate datetime="2025-10-20">October 20, 2025</time>']) {
    assert.equal(extractLeaders(article(time))[0]?.articleEvidence?.sourcePublishedAt, "2025-10-20");
  }
  const source = sourceById("src-penn-doylestown-ceo")!;
  const pack = CoveragePackDocument.parse({ ...coveragePack, sources: coveragePack.sources.map((candidate) => (
    candidate.id === source.id ? { ...candidate, alternateUrls: [] } : { ...candidate, monitor: false, cadence: "inventory", status: "inventory-only" }
  )) });
  const result = await monitorLeadershipSources({ pack, now: new Date("2026-10-03T12:00:00.000Z"), candidateCap: 1, concurrency: 1,
    fetchImpl: async () => new Response(article('<time datetime="2025-10-20">October 20, 2025</time>'), { status: 200 }),
  });
  assert.equal(result.snapshots[0]?.extractionStatus, "partial");
  assert.deepEqual(result.observations, []);
  // A known roster contract can use semantic article elements as ordinary cards.
  const cards = '<article><div class="cmp-pagecard__title_text"><a>Alex Example, MD</a></div><div class="cmp-pagecard__description">Chief Executive Officer</div></article>';
  const roster = `<div class="pagecard component style-leadership">${cards}</div>`;
  assert.equal(extractLeaders(roster, [], "christianacare-roster")[0]?.articleEvidence, undefined);
  assert.equal(extractLeaders('<meta property="og:type" content="article">' + roster, [], "christianacare-roster")[0]?.articleEvidence?.currentAffiliationVerified, false);
});

test("configured newsroom primaries stay historical evidence even without article markup", async () => {
  const source = sourceById("src-penn-princeton-leadership")!;
  const pack = CoveragePackDocument.parse({ ...coveragePack, sources: coveragePack.sources.map((candidate) => (
    candidate.id === source.id ? { ...candidate, alternateUrls: [] } : { ...candidate, monitor: false, cadence: "inventory", status: "inventory-only" }
  )) });
  const html = '<main><script type="application/ld+json">{"@type":"Person","name":"Alex Example","jobTitle":"CEO"}</script><h2>Alex Example</h2><p>Chief Executive Officer</p><time datetime="2025-10-20">October 20, 2025</time></main>';
  const result = await monitorLeadershipSources({ pack, now: new Date("2026-10-03T12:00:00.000Z"), candidateCap: 1, concurrency: 1,
    fetchImpl: async () => new Response(html, { status: 200 }),
  });
  assert.equal(result.snapshots[0]?.state, "failed");
  assert.equal(result.snapshots[0]?.extractionStatus, "partial");
  assert.equal(result.snapshots[0]?.extracted[0]?.articleEvidence?.sourcePublishedAt, null);
  assert.equal(result.snapshots[0]?.extracted[0]?.articleEvidence?.currentAffiliationVerified, false);
  assert.equal(result.schedule[0]?.lastSuccessAt, null);
  assert.deepEqual(result.observations, []);
  // The same generic roster on a registered leadership-page source is unaffected.
  const rosterSource = sourceById("src-penn-is-leadership")!;
  const rosterPack = CoveragePackDocument.parse({ ...coveragePack, sources: coveragePack.sources.map((candidate) => (
    candidate.id === rosterSource.id ? { ...candidate, alternateUrls: [] } : { ...candidate, monitor: false, cadence: "inventory", status: "inventory-only" }
  )) });
  const rosterResult = await monitorLeadershipSources({ pack: rosterPack, now: new Date("2026-10-03T12:00:00.000Z"), candidateCap: 1, concurrency: 1,
    fetchImpl: async () => new Response(html, { status: 200 }),
  });
  assert.equal(rosterResult.snapshots[0]?.state, "success");
  assert.equal(rosterResult.snapshots[0]?.extracted[0]?.articleEvidence, undefined);
});

test("retained complete article snapshots cannot newly verify roles, enroll identities or pass explicit overrides", async () => {
  for (const marked of [false, true]) {
    const database = migratedDatabase();
    const db = sqliteD1(database);
    await seedCoveragePack(db, coveragePack);
    const sourceId = marked ? "src-penn-is-leadership" : "src-penn-princeton-leadership";
    const source = sourceById(sourceId)!;
    const name = "Morgan Historical Example";
    const snapshots = ["2026-10-01T12:00:00.000Z", "2026-10-02T12:00:00.000Z"].map((at) => {
      const snapshot = storedLeadershipSnapshot(sourceId, at, [{ name, title: "CEO" }]);
      if (marked) snapshot.extracted[0]!.articleEvidence = { sourcePublishedAt: "2025-10-20", sourcePublishedCandidates: ["2025-10-20"], currentAffiliationVerified: false };
      return snapshot;
    });
    await persistLeadershipSnapshots(db, snapshots);
    const obs = { id: `legacy-article-${marked}`, sourceId, snapshotId: snapshots[1]!.id, institutionId: source.institutionId,
      kind: "person-appeared" as const, status: "review" as const, payload: { leader: snapshots[1]!.extracted[0] }, instructionLike: false, createdAt: "2026-10-02T12:00:00.000Z" };
    await persistLeadershipObservations(db, [obs]);
    const before = database.prepare("SELECT id, extracted_json, state, extraction_status FROM source_snapshots ORDER BY id").all();
    const result = await autonomouslyVerifyLeadership(db, coveragePack, new Date("2026-10-03T12:00:00.000Z"));
    assert.equal(result.verifiedRoles, 0);
    assert.deepEqual(result.editorialCandidates, []);
    assert.deepEqual(await readExecutiveRoles(db), []);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM executive_enrollment_candidates").get() as { count: number }).count, 0);
    await assert.rejects(reviewLeadershipObservation(db, obs.id, "verified", "offline-test", undefined, new Date("2026-10-03T12:00:00.000Z")), /Article leadership evidence cannot verify current affiliation/);
    const ignored = await reviewLeadershipObservation(db, obs.id, "ignored", "offline-test", undefined, new Date("2026-10-03T12:00:00.000Z"));
    assert.equal(ignored.decision, "ignored");
    assert.deepEqual(database.prepare("SELECT id, extracted_json, state, extraction_status FROM source_snapshots ORDER BY id").all(), before);
    database.close();
  }
});

test("covered health-system identities and LinkedIn mappings stay canonical", () => {
  const entities = Entity.array().parse(entityFixtures);
  const entityIds = new Set(entities.map((entity) => entity.id));
  const byName = new Map(linkedInInventory.organizations.map((row) => [row.name, row]));

  for (const institution of coveredInstitutions()) {
    assert.ok(institution.orgIds.length > 0, `${institution.name} must resolve to a canonical org`);
    assert.ok(
      institution.orgIds.every((id) => entityIds.has(id)),
      `${institution.name} contains an unknown coverage org id`,
    );
  }

  for (const [name, expected] of [
    ["Lehigh Valley Health Network", ["org-lvhn"]],
    ["Penn Medicine Princeton Health", ["org-penn-princeton", "org-penn"]],
    ["Nemours Children's Health", ["org-nemours"]],
    ["RWJBarnabas Health", ["org-rwjbarnabas"]],
    ["St. Luke's University Health Network", ["org-st-lukes"]],
  ] as const) {
    const row = byName.get(name);
    assert.ok(row, `missing LinkedIn target ${name}`);
    assert.deepEqual(row.orgs, expected, `${name} must use canonical org ids`);
    assert.ok(row.orgs.every((id) => entityIds.has(id)), `${name} contains an unknown org id`);
  }

  const jefferson = entities.find((entity) => entity.id === "org-jefferson");
  assert.ok(jefferson);
  assert.ok(!jefferson.aliases.includes("Lehigh Valley Health Network"));
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
  assert.equal(incomplete.snapshots[0]?.state, "failed");
  assert.equal(incomplete.snapshots[0]?.extractionStatus, "unrecognized");
  assert.equal(
    incomplete.snapshots[0]?.error,
    "Page fetched, but no recognized leadership structure was found",
  );
  assert.equal(incomplete.observations.length, 0);
  assert.equal(incomplete.schedule[0]?.state, "upstream-failed");
  assert.equal(incomplete.schedule[0]?.lastHash, previous.lastHash);
  assert.equal(
    incomplete.schedule[0]?.lastError,
    "Page fetched, but no recognized leadership structure was found",
  );

  const repeatedIncomplete = await monitorLeadershipSources({
    now: new Date("2026-08-30T00:00:00.000Z"),
    candidateCap: 1,
    concurrency: 1,
    states: new Map([[
      source.id,
      {
        ...incomplete.schedule[0]!,
        lastHash: incomplete.snapshots[0]!.contentHash,
        nextAttemptAt: "2026-08-29T00:00:00.000Z",
      },
    ]]),
    fetchImpl: async () => new Response("<html><body>Just a normal page</body></html>", { status: 200 }),
  });
  assert.equal(repeatedIncomplete.snapshots[0]?.state, "failed");
  assert.equal(repeatedIncomplete.snapshots[0]?.extractionStatus, "unrecognized");

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
  assert.equal(degraded.official_source_status, "active");

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
  const testPack = CoveragePackDocument.parse({
    ...coveragePack,
    sources: [...coveragePack.sources, {
      id: "src-chop-leadership-alt",
      institutionId: "inst-chop",
      kind: "leadership-page",
      url: "https://news.chop.edu/about/executive-leadership",
      host: "news.chop.edu",
      precedence: 90,
      monitor: true,
      cadence: "daily",
      status: "enabled",
    }],
  });
  await seedCoveragePack(db, testPack, new Date("2026-08-27T12:00:00.000Z"));
  const roleSourceId = "src-chop-leadership";
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
    storedLeadershipSnapshot("src-chop-leadership", "2026-08-27T12:00:00.000Z", absent),
    storedLeadershipSnapshot("src-chop-leadership", "2026-08-28T12:00:00.000Z", absent),
    { ...storedLeadershipSnapshot("src-chop-leadership", "2026-08-28T12:00:00.000Z", absent),
      id: "test-src-chop-leadership-alt-2026-08-28T12:00:00.000Z",
      sourceId: "src-chop-leadership-alt",
      finalUrl: "https://news.chop.edu/about/executive-leadership" },
  ]);
  const pending = await autonomouslyVerifyLeadership(db, testPack, new Date("2026-08-28T12:00:00.000Z"));
  assert.equal(pending.editorialCandidates.some((item) => item.title.includes("Hojjat")), false);
  assert.equal((await readExecutiveRoles(db, "person-hojjat-salmasian", "inst-chop"))[0]!.effectiveTo, null);

  await persistLeadershipSnapshots(db, [
    { ...storedLeadershipSnapshot("src-chop-leadership", "2026-08-29T12:00:00.000Z", absent),
      id: "test-src-chop-leadership-alt-2026-08-29T12:00:00.000Z",
      sourceId: "src-chop-leadership-alt",
      finalUrl: "https://news.chop.edu/about/executive-leadership" },
  ]);
  const verified = await autonomouslyVerifyLeadership(db, testPack, new Date("2026-08-29T12:00:00.000Z"));
  const role = (await readExecutiveRoles(db, "person-hojjat-salmasian", "inst-chop"))[0]!;
  assert.equal(role.effectiveTo, "2026-08-28T12:00:00.000Z");
  assert.equal(verified.editorialCandidates.some((item) => item.title.includes("Hojjat")), true);
  database.close();
});

test("person-bio omissions cannot close an executive role as if they were complete rosters", async () => {
  const database = migratedDatabase();
  const db = sqliteD1(database);
  await seedCoveragePack(db, coveragePack, new Date("2026-08-27T12:00:00.000Z"));
  await persistExecutiveRoleChange(db, {
    personId: "person-hojjat-salmasian",
    institutionId: "inst-chop",
    title: "Vice President and Chief Data and Analytics Officer",
    sourceId: "src-chop-salmasian",
    evidenceUrl: sourceById("src-chop-salmasian")!.url,
    effectiveFrom: "2026-08-01T12:00:00.000Z",
    verificationStatus: "verified",
    verifiedBy: "fixture",
    verifiedAt: "2026-08-01T12:00:00.000Z",
  });
  const unrelatedBio = [{ name: "Bimal Desai", title: "Vice President and Chief Health Informatics Officer" }];
  await persistLeadershipSnapshots(db, [
    storedLeadershipSnapshot("src-chop-salmasian", "2026-08-27T12:00:00.000Z", unrelatedBio),
    storedLeadershipSnapshot("src-chop-salmasian", "2026-08-28T12:00:00.000Z", unrelatedBio),
    storedLeadershipSnapshot("src-chop-desai", "2026-08-27T12:00:00.000Z", unrelatedBio),
    storedLeadershipSnapshot("src-chop-desai", "2026-08-28T12:00:00.000Z", unrelatedBio),
  ]);
  const result = await autonomouslyVerifyLeadership(db, coveragePack, new Date("2026-08-28T12:00:00.000Z"));
  assert.equal(result.editorialCandidates.some((item) => item.title.includes("Hojjat")), false);
  assert.equal((await readExecutiveRoles(db, "person-hojjat-salmasian", "inst-chop"))[0]!.effectiveTo, null);
  database.close();
});

test("a malformed dynamic identity is isolated while a valid departure completes without partial mutation", async () => {
  const database = migratedDatabase();
  const db = sqliteD1(database);
  const testPack = CoveragePackDocument.parse({
    ...coveragePack,
    sources: [...coveragePack.sources, {
      id: "src-chop-leadership-alt",
      institutionId: "inst-chop",
      kind: "leadership-page",
      url: "https://news.chop.edu/about/executive-leadership",
      host: "news.chop.edu",
      precedence: 90,
      monitor: true,
      cadence: "daily",
      status: "enabled",
    }],
  });
  await seedCoveragePack(db, testPack, new Date("2026-08-27T12:00:00.000Z"));
  database.prepare(`INSERT INTO covered_people
    (id, display_name, normalized_name, aliases_json, created_at, known_title, source_ids_json)
    VALUES (?, ?, ?, '[]', ?, ?, ?)`
  ).run(
    "person-inst-chop-dynamic-example",
    "Jordan Dynamic",
    "jordan dynamic",
    "2026-08-01T12:00:00.000Z",
    "Chief Analytics Officer",
    JSON.stringify(["src-chop-leadership", "src-chop-leadership-alt"]),
  );
  database.prepare(`INSERT INTO covered_people
    (id, display_name, normalized_name, aliases_json, created_at, known_title, source_ids_json)
    VALUES (?, '', ?, '[]', ?, ?, ?)`
  ).run(
    "person-inst-chop-malformed",
    "malformed identity fixture",
    "2026-08-01T12:00:00.000Z",
    "Chief Data Officer",
    JSON.stringify(["src-chop-leadership", "src-chop-leadership-alt"]),
  );
  await persistExecutiveRoleChange(db, {
    personId: "person-inst-chop-dynamic-example",
    institutionId: "inst-chop",
    title: "Chief Analytics Officer",
    sourceId: "src-chop-leadership",
    evidenceUrl: sourceById("src-chop-leadership")!.url,
    effectiveFrom: "2026-08-01T12:00:00.000Z",
    verificationStatus: "verified",
    verifiedBy: "fixture",
    verifiedAt: "2026-08-01T12:00:00.000Z",
  });
  await persistExecutiveRoleChange(db, {
    personId: "person-inst-chop-malformed",
    institutionId: "inst-chop",
    title: "Chief Data Officer",
    sourceId: "src-chop-leadership",
    evidenceUrl: sourceById("src-chop-leadership")!.url,
    effectiveFrom: "2026-08-01T12:00:00.000Z",
    verificationStatus: "verified",
    verifiedBy: "fixture",
    verifiedAt: "2026-08-01T12:00:00.000Z",
  });
  const absent = [{ name: "Alicia Example", title: "Chief Executive Officer" }];
  await persistLeadershipSnapshots(db, [
    storedLeadershipSnapshot("src-chop-leadership", "2026-08-28T12:00:00.000Z", absent),
    storedLeadershipSnapshot("src-chop-leadership", "2026-08-29T12:00:00.000Z", absent),
    { ...storedLeadershipSnapshot("src-chop-leadership", "2026-08-28T12:00:00.000Z", absent),
      id: "test-src-chop-leadership-alt-2026-08-28T12:00:00.000Z",
      sourceId: "src-chop-leadership-alt",
      finalUrl: "https://news.chop.edu/about/executive-leadership" },
    { ...storedLeadershipSnapshot("src-chop-leadership", "2026-08-29T12:00:00.000Z", absent),
      id: "test-src-chop-leadership-alt-2026-08-29T12:00:00.000Z",
      sourceId: "src-chop-leadership-alt",
      finalUrl: "https://news.chop.edu/about/executive-leadership" },
  ]);
  const result = await autonomouslyVerifyLeadership(db, testPack, new Date("2026-08-29T12:00:00.000Z"));
  assert.deepEqual(result.identityFailures, [{
    personId: "person-inst-chop-malformed",
    institutionId: "inst-chop",
    reason: "Stored executive identity has no display name",
  }]);
  assert.equal(result.editorialCandidates.some((item) => item.title.includes("Jordan Dynamic")), true);
  const [role] = await readExecutiveRoles(db, "person-inst-chop-dynamic-example", "inst-chop");
  assert.equal(role?.effectiveTo, "2026-08-29T12:00:00.000Z");
  const [malformed] = await readExecutiveRoles(db, "person-inst-chop-malformed", "inst-chop");
  assert.equal(malformed?.effectiveTo, null, "malformed identity must not partially close its role");
  database.close();
});
