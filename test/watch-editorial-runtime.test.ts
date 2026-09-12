import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { canonicalJson, sha256 } from "../src/content/watch-schema";
import { SourceEnrollment, sourceConfigurationDigest } from "../src/ingest/watch/source-enrollment";
import { configureWatchCollectionSource } from "../src/ingest/watch/collection-storage";
import { parseNewJerseyPolicy } from "../src/ingest/policy-watch-native";
import { persistPolicyWatchCapture, buildPolicyEditorialProposal } from "../src/ingest/policy-watch-workflow";
import { stageEditorialProposal, decideEditorialProposal } from "../src/ingest/watch-editorial";
import { createWatchEditorialRuntime } from "../src/ingest/watch-editorial-runtime";
import { readWatchDirectory } from "../src/ingest/watch-persistence";
import { pdfDatabase } from "./helpers/policy-pdf";

test("retained NJ evidence runs through actual source resolution, named review, delivery and capture invalidation", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const capture = JSON.parse(readFileSync(new URL("./fixtures/policy-watch-native/nj-a101-20260912.json", import.meta.url), "utf8"));
  const now = new Date("2026-09-12T18:00:00.000Z");
  const source = SourceEnrollment.parse({ id: capture.source.sourceId, name: "Synthetic qualification for retained NJ test",
    state: "qualified", desk: "policy", jurisdiction: "NJ", family: "legislation", transport: "batch",
    parserId: "policy-native-test", parserVersion: "1", endpoints: [capture.source.sourceUrl],
    linkScopes: [{ host: new URL(capture.source.sourceUrl).hostname, pathPrefix: "/" }], authority: "official",
    dateTimezone: "America/New_York", requiresAuth: false, collectionMode: "rolling", maxBytes: 500_000, maxItems: 100,
    qualificationReceiptId: "synthetic-runtime-qualification" });
  // Test-only authority exercises the code path; it is not a real source approval.
  const qualification = { id: source.qualificationReceiptId, sourceId: source.id,
    configurationSha256: await sourceConfigurationDigest(source), reviewedAt: now.toISOString(), expiresAt: "2026-10-01T00:00:00.000Z",
    engineeringOwnerId: "synthetic-engineer", editorialOwnerId: "synthetic-editor", reviewEvidenceId: "synthetic-runtime-review",
    rightsDecision: "accepted", accessDecision: "public-or-authorized-read", negativeFixtureSha256: await sha256("synthetic-negative"),
    replayFixtureSha256: await sha256("synthetic-replay"), samples: ["2026-09-11T00:00:00.000Z", "2026-09-12T00:00:00.000Z"].map(capturedAt => ({
      endpoint: source.endpoints[0], representationSha256: "1".repeat(64), capturedAt, parserVersion: "1", itemCount: 1, outcome: "parsed" })) };
  await db.prepare("INSERT INTO watch_collection_reviews VALUES(?,?,?,?,?,?,NULL)").bind(qualification.reviewEvidenceId,
    qualification.engineeringOwnerId, qualification.editorialOwnerId, await sha256("synthetic-review"),
    await sha256(canonicalJson(qualification)), now.toISOString()).run();
  await configureWatchCollectionSource(db, { source, qualification, activationId: "synthetic-activation", cadenceSeconds: 3600, expectedRevision: 0 }, now.toISOString());
  const persisted = await persistPolicyWatchCapture(db, parseNewJerseyPolicy(capture.native, capture.sessionKey, capture.source));
  const prepared = await buildPolicyEditorialProposal(db, persisted.id, "nj-a101", now);
  const staged = await stageEditorialProposal(db, prepared.proposal, now);
  const runtime = createWatchEditorialRuntime(db);
  const result = await decideEditorialProposal(db, { id: staged.id, sha256: staged.sha256, action: "accepted" }, "synthetic-editor@example.test", runtime, now);
  assert.equal(result.outcome, "applied");
  const page = await readWatchDirectory(db, { kind: "policy" }, now);
  assert.equal(page.items.length, 1);
  assert.ok(page.items[0]?.kind === "policy");
  assert.equal(page.items[0].legalEffect, "unknown");
  const changed = structuredClone(capture.native); changed.history[0].Comment = "Synthetic correction after retained real capture";
  await persistPolicyWatchCapture(db, parseNewJerseyPolicy(changed, capture.sessionKey,
    { ...capture.source, retrievedAt: "2026-09-12T18:01:00.000Z" }));
  assert.deepEqual((await readWatchDirectory(db, { kind: "policy" }, new Date("2026-09-12T18:02:00.000Z"))).items, []);
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
});
