import assert from "node:assert/strict";
import { test } from "node:test";
import { ContentItem } from "../src/content/schema";
import { EditorEnrichment } from "../src/ingest/editor-model";
import { isEditorModelEligible } from "../src/ingest/editor-work";
import { runAutomation } from "../src/ingest/automation";
import {
  candidateFingerprint, editorAttemptFingerprint, persistEnrichments,
  persistIngestRun, readEditorModelCache, type EditorCacheConfiguration,
} from "../src/ingest/persistence";
import type { IngestRun } from "../src/ingest/run-all";
import { pdfDatabase } from "./helpers/policy-pdf";

const baseline = { model: "meta/muse-spark-1.2-contributor" };
const candidate = { model: "meta/muse-spark-1.3-contributor" };
const now = new Date("2026-09-12T14:00:00.000Z");
const item = ContentItem.parse({
  id: "cache-provenance-news", slug: "cache-provenance-news", kind: "news",
  title: "CHOP releases a synthetic research resource", dek: "A synthetic fixture for cache isolation.",
  body: "CHOP releases a synthetic research resource.", status: "review", updatedAt: now.toISOString(),
  orgs: ["inst-chop"], topics: [], region: "regional", authors: [], citations: [],
  relatedEventIds: [], relatedVoiceIds: [],
  source: { kind: "ingest", origin: "cache-fixture", url: "https://example.org/synthetic-cache-case" },
});
const enrichment = EditorEnrichment.parse({
  relevanceScore: 0, confidence: 0, decision: "hold", reasons: [], affectedOrgIds: [], productIds: [],
  changeType: "other", materialityDimensions: [], impactSentence: null, whyAttend: null,
  whoYoullMeet: [], evidenceSpans: [],
});
const verification = { approved: false, objections: [], verifiedAt: now.toISOString() };
const run: IngestRun = { fetchedAt: now.toISOString(), rss: [item], events: [], social: [],
  notes: { rss: 1, events: 0, linkedin: { count: 0 }, x: { count: 0 }, grok: { count: 0, pending: 0 } } };

async function seeded() {
  const fixture = pdfDatabase();
  await persistIngestRun(fixture.db, run, [{ item, enrichment: null }]);
  return fixture;
}

async function save(fixture: Awaited<ReturnType<typeof seeded>>, config: EditorCacheConfiguration, outcome: "success" | "failure" = "success") {
  await persistEnrichments(fixture.db, [{ item, enrichment: outcome === "success" ? enrichment : null,
    verification: outcome === "success" ? verification : null,
    attempt: { fingerprint: await editorAttemptFingerprint(item, config), attemptedAt: now.toISOString(), outcome,
      error: outcome === "failure" ? "synthetic failure" : null } }], config);
}

test("untagged legacy caches stay baseline-only and a model switch does not mutate rows", async () => {
  const fixture = await seeded();
  try {
    const fingerprint = await candidateFingerprint(item);
    fixture.sqlite.prepare(`UPDATE content_candidates SET enrichment_json=?, verification_json=?,
      enrichment_fingerprint=?, enrichment_outcome='success', enrichment_attempted_at=?, enrichment_attempt_count=1 WHERE id=?`)
      .run(JSON.stringify(enrichment), JSON.stringify(verification), fingerprint, now.toISOString(), item.id);
    const before = fixture.sqlite.prepare("SELECT * FROM content_candidates").all();
    const old = await readEditorModelCache(fixture.db, [item], baseline);
    assert.equal(old.reusable.size, 1);
    assert.equal(old.verifications.size, 1);
    const next = await readEditorModelCache(fixture.db, [item], candidate);
    assert.equal(next.reusable.size, 0);
    assert.equal(next.verifications.size, 0);
    assert.equal(isEditorModelEligible(item, fingerprint, next.states.get(item.id), now), true);
    assert.deepEqual(fixture.sqlite.prepare("SELECT * FROM content_candidates").all(), before);
    assert.equal(await editorAttemptFingerprint(item, baseline), fingerprint);
    assert.notEqual(await editorAttemptFingerprint(item, candidate), fingerprint);
  } finally { fixture.sqlite.close(); }
});

test("new enrichment and verifier sidecars carry exact model/endpoint provenance", async () => {
  const fixture = await seeded();
  try {
    await save(fixture, candidate);
    const row = fixture.sqlite.prepare("SELECT * FROM content_candidates WHERE id=?").get(item.id)!;
    const stored = JSON.parse(String(row.enrichment_json));
    assert.equal(stored.modelProvenance.model, candidate.model);
    assert.equal(stored.modelProvenance.baseUrl, "https://openrouter.ai/api/v1");
    assert.deepEqual(JSON.parse(String(row.verification_json)).modelProvenance, stored.modelProvenance);
    assert.equal(row.fingerprint, await candidateFingerprint(item));
    const current = await readEditorModelCache(fixture.db, [item], { ...candidate, baseUrl: "https://openrouter.ai/api/v1/" });
    assert.equal(current.reusable.size, 1);
    assert.equal(current.verifications.size, 1);
    assert.equal(isEditorModelEligible(item, await candidateFingerprint(item), current.states.get(item.id), now), false);
    for (const config of [baseline, { ...candidate, baseUrl: "https://provider.example/v1" }]) {
      const other = await readEditorModelCache(fixture.db, [item], config);
      assert.equal(other.reusable.size, 0);
      assert.equal(other.verifications.size, 0);
    }
    await persistEnrichments(fixture.db, [{ item, enrichment, verification: { ...verification, approved: true } }], candidate);
    assert.equal((await readEditorModelCache(fixture.db, [item], candidate)).verifications.get(item.id)?.approved, true);
    fixture.sqlite.prepare("UPDATE content_candidates SET enrichment_json=?, verification_json=? WHERE id=?")
      .run(JSON.stringify(enrichment), JSON.stringify(verification), item.id);
    const missingProvenance = await readEditorModelCache(fixture.db, [item], candidate);
    assert.equal(missingProvenance.reusable.size, 0);
    assert.equal(missingProvenance.verifications.size, 0);
    assert.equal(isEditorModelEligible(item, await candidateFingerprint(item), missingProvenance.states.get(item.id), now), true);
  } finally { fixture.sqlite.close(); }
});

test("failed attempts retain same-model backoff without blocking another model", async () => {
  const fixture = await seeded();
  try {
    await save(fixture, candidate, "failure");
    await save(fixture, candidate, "failure");
    const current = await readEditorModelCache(fixture.db, [item], candidate);
    assert.equal(current.states.get(item.id)?.attemptCount, 2);
    assert.equal(isEditorModelEligible(item, await candidateFingerprint(item), current.states.get(item.id), now), false);
    const other = await readEditorModelCache(fixture.db, [item], baseline);
    assert.equal(isEditorModelEligible(item, await candidateFingerprint(item), other.states.get(item.id), now), true);
    assert.equal(fixture.sqlite.prepare("SELECT enrichment_json FROM content_candidates WHERE id=?").get(item.id)?.enrichment_json, null);
  } finally { fixture.sqlite.close(); }
});

test("cache invalidation does not reopen approved or unchanged rejected candidates", async () => {
  const fixture = await seeded();
  try {
    await save(fixture, baseline);
    for (const status of ["approved", "rejected"]) {
      fixture.sqlite.prepare("UPDATE content_candidates SET queue_status=? WHERE id=?").run(status, item.id);
      const current = await readEditorModelCache(fixture.db, [item], candidate);
      assert.equal(isEditorModelEligible(item, await candidateFingerprint(item), current.states.get(item.id), now), false);
      assert.equal(fixture.sqlite.prepare("SELECT queue_status FROM content_candidates WHERE id=?").get(item.id)?.queue_status, status);
    }
  } finally { fixture.sqlite.close(); }
});

test("automation requalifies a baseline cache once and reuses only its new model result", async () => {
  const fixture = await seeded();
  const originalLog = console.log;
  const originalWarn = console.warn;
  let calls = 0;
  console.log = () => {};
  console.warn = () => {};
  try {
    await save(fixture, baseline);
    const fetchImpl: typeof fetch = async (input, init) => {
      if (String(input) === "https://openrouter.ai/api/v1/chat/completions") {
        calls++;
        assert.equal(JSON.parse(String(init?.body)).model, candidate.model);
        return Response.json({ choices: [{ message: { content: JSON.stringify({ decision: "hold" }) }, finish_reason: "stop" }] });
      }
      return new Response("", { status: 404 });
    };
    const env = { VALLEY_DESK_DB: fixture.db, EDITOR_MODEL: candidate.model, EDITOR_MODEL_BUDGET: 1,
      OPENROUTER_API_KEY: "synthetic-test-only", EDITOR_MODEL_DEADLINE_MS: 5000 };
    await runAutomation(env, fetchImpl, async () => run);
    assert.equal(calls, 1);
    assert.equal((await readEditorModelCache(fixture.db, [item], candidate)).reusable.size, 1);
    await runAutomation(env, fetchImpl, async () => run);
    assert.equal(calls, 1, "matching cache should not spend another model call");
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) n FROM published_content").get()?.n, 0);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    fixture.sqlite.close();
  }
});
