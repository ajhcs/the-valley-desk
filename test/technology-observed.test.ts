import assert from "node:assert/strict";
import test from "node:test";
import { parseTechnologyCaptureSnapshot, technologyCaptureRole } from "../src/ingest/watch/technology-adapter";
import { SourceEnrollment } from "../src/ingest/watch/source-enrollment";
import { technologyRegionalSources } from "../src/ingest/technology-source-plans";
import { RegionalEligibility } from "../src/content/watch-delivery";
import { pdfDatabase } from "./helpers/policy-pdf";
import { persistTechnologySourceRepresentation } from "../src/ingest/technology-editorial-adapter";

test("technology regional capture parser is installed-endpoint and literal-location scoped", async () => {
  const endpoint = technologyRegionalSources.chop.url;
  const source = SourceEnrollment.parse({ id: "test-chop-region", name: "Synthetic location", state: "pending",
    desk: "technology", jurisdiction: "regional", family: "technology", transport: "html",
    parserId: "technology-capture-v1", parserVersion: "1", endpoints: [endpoint],
    linkScopes: [{ host: "www.chop.edu", pathPrefix: "/" }], authority: "first-party", dateTimezone: null,
    requiresAuth: false, collectionMode: "rolling", maxBytes: 1000000, maxItems: 1, qualificationReceiptId: null });
  const input = { source, finalUrl: endpoint, fetchedAt: "2026-09-15T15:00:00.000Z",
    body: "<p>" + technologyRegionalSources.chop.quote + "</p>" };
  assert.equal((await parseTechnologyCaptureSnapshot(input)).observations.length, 1);
  assert.equal((await parseTechnologyCaptureSnapshot({ ...input, body: "<p>Location unknown</p>" })).observations.length, 0);
  assert.throws(() => technologyCaptureRole("https://example.org/location"), /not-installed/);
  assert.equal((await parseTechnologyCaptureSnapshot({ ...input, source: { ...source, parserVersion: "99" } })).observations.length, 0);
});

test("observed regional eligibility cannot masquerade as an unbounded historical term", () => {
  const value = { relationshipId: "relationship", entityId: "chop", geography: "delaware-valley",
    temporalStatus: "observed", asOfDay: "2026-09-15", validFrom: "2026-09-15", validTo: "2026-10-15" };
  assert.equal(RegionalEligibility.safeParse(value).success, true);
  assert.equal(RegionalEligibility.safeParse({ ...value, validFrom: "2000-01-01" }).success, false);
  assert.equal(RegionalEligibility.safeParse({ ...value, validTo: null }).success, false);
});

test("unchanged bytes refresh monotonic head time without rewriting the original observation", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const capture = { url: technologyRegionalSources.chop.url, checkedAt: "2026-09-15T10:00:00.000Z", body: "Synthetic retained location" };
  const first = await persistTechnologySourceRepresentation(db, "test-resource", "test-source", capture);
  const later = { ...capture, checkedAt: "2026-09-15T11:00:00.000Z" };
  const repeated = await persistTechnologySourceRepresentation(db, "test-resource", "test-source", later);
  assert.equal(repeated.observationId, first.observationId);
  const head = await db.prepare("SELECT checked_at FROM technology_source_heads WHERE subject_id=?").bind("test-resource").first<{ checked_at: string }>();
  const raw = await db.prepare("SELECT checked_at FROM technology_source_representations WHERE id=?").bind(first.observationId).first<{ checked_at: string }>();
  assert.equal(head?.checked_at, later.checkedAt);
  assert.equal(raw?.checked_at, capture.checkedAt);
  await assert.rejects(persistTechnologySourceRepresentation(db, "test-resource", "test-source", capture), /out-of-order/);
});
