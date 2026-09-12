import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { githubRepositoryKey, sha256, TechnologyArtifact, canonicalJson } from "../src/content/watch-schema";
import { buildTechnologyDossierDraft, persistTechnologyDossierDraft, readTechnologyDossierDraft,
  type TechnologyDossierInput } from "../src/ingest/technology-dossiers";
import { prepareTechnologySourceDraft, technologySourcePlans } from "../src/ingest/technology-source-plans";
import { persistTechnologySourceRepresentation, prepareTechnologyEditorialProposal, technologyAcceptanceGuards } from "../src/ingest/technology-editorial-adapter";
import { deliveryDependencyKey } from "../src/content/watch-delivery";
import { recordWatchDependencyHead } from "../src/ingest/watch-delivery";
import { evidenceMatches } from "../src/content/watch-projection";
import { pdfDatabase } from "./helpers/policy-pdf";
import type { D1DatabaseLike } from "../src/ingest/persistence";

const NOW = "2026-09-12T12:00:00.000Z";
async function input(): Promise<TechnologyDossierInput> {
  const subjectId = await githubRepositoryKey("123");
  const artifactId = subjectId + ":repository", quote = "Synthetic local institution created this exact repository.";
  const fact = (value: unknown) => ({ value, evidenceIds: ["synthetic-evidence"] });
  return {
    schemaVersion: "technology-dossier-input-1", repository: { numericId: "123", fullName: "synthetic/tool", commitSha: "a".repeat(40) },
    slug: "synthetic-tool", title: "Synthetic tool", resourceType: "software", discoveredAt: NOW,
    evidence: [{ id: "synthetic-evidence", url: "https://example.org/tool", checkedAt: NOW, representationSha256: await sha256(quote),
      quote, retainedText: quote }],
    purpose: fact("Synthetic purpose."), intendedUsers: fact(["Researchers"]),
    workflow: fact({ inputs: [], steps: ["Read the synthetic documentation."], outputs: [] }),
    setup: fact({ verification: "not-verified", version: null, prerequisites: null, guideUrl: null }),
    limitations: fact(["Synthetic test only."]),
    relationship: { evidenceIds: ["synthetic-evidence"], value: { id: "synthetic-local", resourceId: subjectId,
      artifactId, entityId: "synthetic-pa", entityName: "Synthetic institution", type: "created-by", temporalStatus: "historical",
      validFrom: null, validTo: null, checkedAt: NOW, validThrough: null } },
    licenses: [{ evidenceIds: ["synthetic-evidence"], value: { artifactId, artifactVersion: "a".repeat(40),
      scope: "code", classification: "unknown", spdxId: null, licenseSha256: null, sourceUrl: null, conditions: [] } }],
    developments: [], aliasProposal: null,
  };
}
test("technology drafts persist artifacts and are invisible to public and accepted storage", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const source = await input(), result = await persistTechnologyDossierDraft(db, source, 0);
  assert.equal(result.revision, 1); assert.equal(result.draft.publicationAuthorized, false);
  assert.equal((await readTechnologyDossierDraft(db, result.draft.subjectId))?.draft.inputSha256, result.draft.inputSha256);
  for (const table of ["watch_subjects", "watch_reviewed_projections", "watch_public_revisions", "published_content"]) {
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM " + table).get()!.n, 0);
  }
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM technology_artifact_observations").get()!.n, 1);
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
});
test("discovery refresh is idempotent; changed source creates a revision and stale writes fail", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const source = await input(), first = await persistTechnologyDossierDraft(db, source, 0);
  source.discoveredAt = "2026-09-13T12:00:00.000Z";
  source.evidence[0]!.checkedAt = source.discoveredAt;
  source.relationship.value.checkedAt = source.discoveredAt;
  assert.equal((await persistTechnologyDossierDraft(db, source, 1)).outcome, "unchanged");
  source.title = "Changed title";
  assert.equal((await persistTechnologyDossierDraft(db, source, 1)).revision, 2);
  source.title = "Racing title";
  await assert.rejects(persistTechnologyDossierDraft(db, source, 1), /stale-draft-revision/);
  assert.equal((await readTechnologyDossierDraft(db, first.draft.subjectId))?.revision, 2);
});
test("racing head revision rolls back the entire draft batch", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const source = await input();
  await persistTechnologyDossierDraft(db, source, 0);
  source.title = "Changed";
  const racing: D1DatabaseLike = { prepare: query => db.prepare(query), async batch(statements) {
    sqlite.exec("UPDATE technology_dossier_heads SET revision=2");
    return db.batch(statements);
  } };
  await assert.rejects(persistTechnologyDossierDraft(racing, source, 1));
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM technology_dossier_drafts").get()!.n, 1);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM technology_artifact_observations").get()!.n, 1);
});
test("unbound local evidence, license versions, duplicate scopes and nonliteral quotes fail closed", async () => {
  const source = await input();
  const unrelated = structuredClone(source); unrelated.relationship.value.artifactId = "another-artifact";
  await assert.rejects(buildTechnologyDossierDraft(unrelated), /relationship-conflict/);
  const missing = structuredClone(source); missing.purpose.evidenceIds = ["missing"];
  await assert.rejects(buildTechnologyDossierDraft(missing), /missing-evidence/);
  const version = structuredClone(source); version.licenses[0]!.value.artifactVersion = "different-version";
  await assert.rejects(buildTechnologyDossierDraft(version), /license-version-conflict/);
  const duplicate = structuredClone(source); duplicate.licenses.push(duplicate.licenses[0]!);
  await assert.rejects(buildTechnologyDossierDraft(duplicate), /duplicate-license-scope/);
  const fabricated = structuredClone(source); fabricated.evidence[0]!.quote = "Invented source claim";
  await assert.rejects(buildTechnologyDossierDraft(fabricated), /must be literal/);
});
test("releases keep source time, while tags, baselines, drafts and prereleases cannot masquerade as releases", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const source = await input(), subjectId = await githubRepositoryKey("123");
  source.developments = [{ nativeId: "55", type: "software-release", title: "v1",
    artifact: { id: "release-55", resourceId: subjectId, artifactType: "release", host: "github.com", nativeId: "55",
      version: "v1", url: "https://github.com/synthetic/tool/releases/tag/v1", availability: "public" },
    sourceOccurredAt: { precision: "instant", value: "2020-01-01T00:00:00.000Z", evidenceIds: ["synthetic-evidence"] },
    evidenceIds: ["synthetic-evidence"], draft: false, prerelease: false }];
  const result = await persistTechnologyDossierDraft(db, source, 0);
  assert.equal(result.draft.developments[0]!.latestReviewEligible, false);
  assert.equal(sqlite.prepare("SELECT source_occurred_at AS at FROM technology_development_observations").get()!.at, "2020-01-01T00:00:00.000Z");
  source.developments[0]!.sourceOccurredAt = { precision: "instant", value: "2026-09-11T00:00:00.000Z", evidenceIds: ["synthetic-evidence"] };
  assert.equal((await buildTechnologyDossierDraft(source)).developments[0]!.latestReviewEligible, true);
  source.developments[0]!.prerelease = true;
  assert.equal((await buildTechnologyDossierDraft(source)).developments[0]!.latestReviewEligible, false);
  for (const type of ["baseline", "tag", "indexing"] as const) {
    source.developments[0]!.type = type;
    await assert.rejects(buildTechnologyDossierDraft(source), /invented-release-date/);
  }
  source.developments[0]!.type = "software-release"; source.developments[0]!.draft = true;
  await assert.rejects(buildTechnologyDossierDraft(source), /invented-release-date/);
});
test("draft schema rejects caller publication authority and corrupted stored content", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const source = await input();
  await assert.rejects(buildTechnologyDossierDraft({ ...source, accepted: true }));
  const result = await persistTechnologyDossierDraft(db, source, 0);
  sqlite.exec("UPDATE technology_dossier_drafts SET payload_json=json_set(payload_json,'$.title','Tampered')");
  await assert.rejects(readTechnologyDossierDraft(db, result.draft.subjectId), /stored-draft-corrupt/);
});
test("researched source plans bind exact GitHub identities and never generalize known code licenses to data", async () => {
  assert.equal(technologySourcePlans.length, 3);
  assert.equal(technologySourcePlans[0].numericId, "1308325438");
  assert.equal(technologySourcePlans[0].classification, "restricted-source");
  assert.ok(technologySourcePlans.every(plan => plan.classification !== ("osi-open-source" as string)));
  const plan = technologySourcePlans[0];
  const capture = { url: "https://example.org", checkedAt: NOW, body: "{}" };
  await assert.rejects(prepareTechnologySourceDraft(plan, { repository: capture, commit: capture,
    readme: capture, license: capture, releases: capture }), /identity-conflict/);
});

test("captured ORCA, CaPTk and OpenPedCan drafts persist offline with exact licenses and release chronology", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  for (const plan of technologySourcePlans) {
    const source = JSON.parse(readFileSync(new URL("../fixtures/technology-dossier-drafts/" + plan.slug + ".json", import.meta.url), "utf8"));
    const result = await persistTechnologyDossierDraft(db, source, 0);
    assert.equal(result.draft.input.repository.numericId, plan.numericId);
    assert.equal(result.draft.input.licenses.find(item => item.value.scope === "code")!.value.licenseSha256, plan.licenseSha256);
    assert.ok(result.draft.input.licenses.filter(item => item.value.scope !== "code").every(item => item.value.classification === "unknown"));
    assert.equal((await persistTechnologyDossierDraft(db, source, 1)).outcome, "unchanged");
    assert.equal((await readTechnologyDossierDraft(db, result.draft.subjectId))?.draft.inputSha256, result.draft.inputSha256);
    if (plan.slug === "chop-orca") {
      assert.equal(result.draft.developments.length, 0);
      assert.equal(result.draft.input.aliasProposal?.existingId, "epic-orca-chop");
    }
  }
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM technology_dossier_drafts").get()!.n, 3);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM technology_artifact_observations").get()!.n, 23);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM technology_development_observations").get()!.n, 20);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM watch_public_revisions").get()!.n, 0);
});

test("editorial adapter binds literal references to retained bytes and source-head assertions", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const source = await input(), staged = await persistTechnologyDossierDraft(db, source, 0);
  const citation = source.evidence[0]!;
  await persistTechnologySourceRepresentation(db, staged.draft.subjectId, "synthetic-enrolled-source",
    { url: citation.url, checkedAt: NOW, body: citation.retainedText });
  const prepared = await prepareTechnologyEditorialProposal(db, staged.draft.subjectId);
  assert.equal(prepared.proposal.draft.kind, "technology");
  assert.ok(prepared.proposal.facts.every(fact => !("verification" in fact)));
  for (const item of prepared.proposal.evidence) assert.equal(await evidenceMatches(item, prepared.observations.get(item.observationId)!), true);
  const guards = await technologyAcceptanceGuards(db, prepared.sourceHeadAssertions, "synthetic-review");
  await db.batch(guards);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM watch_dependency_heads").get()!.n, 0);
});

test("changed source bytes retract existing artifacts and scoped licenses without approving replacements", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const source = await input(), staged = await persistTechnologyDossierDraft(db, source, 0);
  const citation = source.evidence[0]!, subjectId = staged.draft.subjectId;
  const capture = { url: citation.url, checkedAt: NOW, body: citation.retainedText };
  await persistTechnologySourceRepresentation(db, subjectId, "synthetic-enrolled-source", capture);
  const artifactId = subjectId + ":repository";
  for (const scope of [null, "code", "data", "weights"] as const) {
    const kind = scope === null ? "artifact" : "artifact-license";
    const key = await deliveryDependencyKey(kind, scope === null ? [artifactId] : [artifactId, scope]);
    await recordWatchDependencyHead(db, { key, kind, revision: 1, digest: await sha256("synthetic-accepted"),
      immutableRecordId: "synthetic-accepted-" + (scope ?? "artifact"), changedAt: NOW });
  }
  assert.equal((await persistTechnologySourceRepresentation(db, subjectId, "synthetic-enrolled-source", capture)).outcome, "unchanged");
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM watch_dependency_heads WHERE digest IS NOT NULL").get()!.n, 4);
  await persistTechnologySourceRepresentation(db, subjectId, "synthetic-enrolled-source",
    { ...capture, checkedAt: "2026-09-13T12:00:00.000Z", body: capture.body + " Changed license." });
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM watch_dependency_heads WHERE digest IS NULL").get()!.n, 4);
  await assert.rejects(prepareTechnologyEditorialProposal(db, subjectId), /current-source-conflict/);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM watch_public_revisions").get()!.n, 0);
});

test("a source refresh after resolution aborts the acceptance transaction, including earlier writes", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const source = await input(), staged = await persistTechnologyDossierDraft(db, source, 0);
  const citation = source.evidence[0]!, subjectId = staged.draft.subjectId;
  const capture = { url: citation.url, checkedAt: NOW, body: citation.retainedText };
  await persistTechnologySourceRepresentation(db, subjectId, "synthetic-enrolled-source", capture);
  const prepared = await prepareTechnologyEditorialProposal(db, subjectId);
  const guards = await technologyAcceptanceGuards(db, prepared.sourceHeadAssertions, "synthetic-racing-review");
  await persistTechnologySourceRepresentation(db, subjectId, "synthetic-enrolled-source",
    { ...capture, checkedAt: "2026-09-13T12:00:00.000Z", body: capture.body + " Changed." });
  sqlite.exec("CREATE TABLE synthetic_acceptance(value INTEGER)");
  await assert.rejects(db.batch([db.prepare("INSERT INTO synthetic_acceptance VALUES(1)"), ...guards]));
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM synthetic_acceptance").get()!.n, 0);
  await assert.rejects(persistTechnologySourceRepresentation(db, subjectId, "synthetic-enrolled-source", capture), /out-of-order/);
});

test("artifact dates are optional and do not alter existing undated canonical records", async () => {
  const artifact = (await buildTechnologyDossierDraft(await input())).artifacts[0]!;
  assert.equal("sourceOccurredAt" in TechnologyArtifact.parse(artifact), false);
  assert.equal(canonicalJson(TechnologyArtifact.parse(artifact)), canonicalJson(artifact));
});

test("a first artifact approval racing after source pre-scan is retracted in the capture transaction", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const source = await input(), staged = await persistTechnologyDossierDraft(db, source, 0);
  const subjectId = staged.draft.subjectId, citation = source.evidence[0]!;
  const capture = { url: citation.url, checkedAt: NOW, body: citation.retainedText };
  await persistTechnologySourceRepresentation(db, subjectId, "synthetic-source", capture);
  const key = await deliveryDependencyKey("artifact", [subjectId + ":repository"]);
  let injected = false;
  const racing: D1DatabaseLike = { prepare: sql => db.prepare(sql), async batch(statements) {
    if (!injected) {
      injected = true;
      await recordWatchDependencyHead(db, { key, kind: "artifact", revision: 1, digest: await sha256("synthetic-first-approval"),
        immutableRecordId: "synthetic-racing-first-approval", changedAt: NOW });
    }
    return db.batch(statements);
  } };
  await persistTechnologySourceRepresentation(racing, subjectId, "synthetic-source",
    { ...capture, body: capture.body + " Source revision.", checkedAt: "2026-09-13T12:00:00.000Z" });
  const head = await db.prepare("SELECT digest,revision FROM watch_dependency_heads WHERE dependency_key=?").bind(key)
    .first<{ digest: string | null; revision: number }>();
  assert.equal(head?.digest, null); assert.equal(head?.revision, 2);
});

test("a changing artifact inventory aborts source refresh until its retractions can be replanned", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const source = await input(), staged = await persistTechnologyDossierDraft(db, source, 0);
  const subjectId = staged.draft.subjectId, citation = source.evidence[0]!;
  const capture = { url: citation.url, checkedAt: NOW, body: citation.retainedText };
  await persistTechnologySourceRepresentation(db, subjectId, "synthetic-source", capture);
  const racing: D1DatabaseLike = { prepare: sql => db.prepare(sql), async batch(statements) {
    await persistTechnologyDossierDraft(db, { ...source, title: "Revised synthetic draft" }, 1);
    return db.batch(statements);
  } };
  await assert.rejects(persistTechnologySourceRepresentation(racing, subjectId, "synthetic-source",
    { ...capture, body: capture.body + " Source revision.", checkedAt: "2026-09-13T12:00:00.000Z" }), /CHECK constraint/);
  const row = await db.prepare("SELECT revision FROM technology_source_heads WHERE subject_id=?").bind(subjectId).first<{ revision: number }>();
  assert.equal(row?.revision, 1);
});

test("editorial release dates come only from matching dated developments and retain date evidence", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const source = await input(), subjectId = await githubRepositoryKey("123");
  const dateEvidence = { ...source.evidence[0]!, id: "date-evidence" };
  source.evidence.push(dateEvidence);
  const date = { precision: "instant" as const, value: "2020-01-01T00:00:00.000Z", evidenceIds: [dateEvidence.id] };
  source.developments = [{ nativeId: "55", type: "software-release", title: "v1",
    artifact: { id: "release-55", resourceId: subjectId, artifactType: "release", host: "github.com", nativeId: "55",
      version: "v1", url: "https://github.com/synthetic/tool/releases/tag/v1", availability: "public",
      sourceOccurredAt: { ...date, value: NOW } },
    sourceOccurredAt: date, evidenceIds: ["synthetic-evidence"], draft: false, prerelease: false }];
  await persistTechnologySourceRepresentation(db, subjectId, "synthetic-enrolled-source",
    { url: dateEvidence.url, checkedAt: NOW, body: dateEvidence.retainedText });
  let revision = 0;
  async function prepare() {
    revision = (await persistTechnologyDossierDraft(db, source, revision)).revision;
    return (await prepareTechnologyEditorialProposal(db, subjectId)).proposal.facts.filter(fact => fact.field === "artifact");
  }
  const facts = await prepare();
  assert.equal("sourceOccurredAt" in (facts[0]!.value as object), false);
  assert.deepEqual((facts[1]!.value as TechnologyArtifact).sourceOccurredAt, date);
  assert.ok(facts[1]!.evidenceIds.includes("date-evidence"));
  source.developments[0]!.prerelease = true;
  assert.equal("sourceOccurredAt" in ((await prepare())[1]!.value as object), false);
  source.developments[0]!.prerelease = false;
  source.developments[0]!.artifact.artifactType = "repository";
  await assert.rejects(prepare(), /technology-release-artifact-required/);
  source.developments[0]!.type = "baseline";
  source.developments[0]!.sourceOccurredAt = { precision: "unknown", reason: "Discovery only." };
  assert.equal("sourceOccurredAt" in ((await prepare())[1]!.value as object), false);
});
