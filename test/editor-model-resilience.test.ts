import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_EDITOR_MODEL,
  EditorModelError,
  enrichWithEditorModel,
} from "../src/ingest/editor-model.ts";
import { NewsItem } from "../src/content/schema.ts";

function item() {
  return NewsItem.parse({
    id: "resilience-item",
    slug: "resilience-item",
    kind: "news",
    title: "Penn launches a new deployment",
    dek: "Penn launches a new deployment for regional clinicians.",
    body: "Penn launches a new deployment for regional clinicians. The deployment begins this month.",
    status: "review",
    relatedEventIds: [],
    relatedVoiceIds: [],
    updatedAt: "2026-08-28T04:00:00.000Z",
    topics: ["deployment"],
    orgs: ["org-penn"],
    region: "PA",
    authors: [{ name: "The Valley Desk" }],
    source: { kind: "ingest", origin: "penn-medicine-newsroom", url: "https://example.com/penn" },
  });
}

function response(value: unknown) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
}

test("two-pass editor assembles classification and literal copy into the stable enrichment shape", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(request);
    return response(calls.length === 1
      ? {
        relevanceScore: 98,
        confidence: 0.98,
        decision: "priority_review",
        reasons: ["Named regional institution and operational deployment"],
        affectedOrgIds: ["org-penn"],
        productIds: [],
        changeType: "deployment",
        materialityDimensions: ["deployment"],
        evidenceSpans: ["Penn launches a new deployment for regional clinicians."],
      }
      : {
        impactSentence: "Penn launches a new deployment for regional clinicians.",
        body: "Penn launches a new deployment for regional clinicians.",
        bodyEvidenceSpans: ["Penn launches a new deployment for regional clinicians."],
      });
  };

  const result = await enrichWithEditorModel(item(), [], { apiKey: "test" }, fetchImpl as typeof fetch);
  assert.equal(calls.length, 2);
  assert.equal(calls.every((request) => request.model === DEFAULT_EDITOR_MODEL), true);
  assert.equal(result?.decision, "priority_review");
  assert.equal(result?.affectedOrgIds[0], "org-penn");
  assert.equal(result?.impactSentence, "Penn launches a new deployment for regional clinicians.");
  assert.equal(result?.body, "Penn launches a new deployment for regional clinicians.");
});

test("missing model fields become a conservative hold instead of publishable evidence", async () => {
  const result = await enrichWithEditorModel(
    item(),
    [],
    { apiKey: "test" },
    (async () => response({ decision: "hold" })) as typeof fetch,
  );
  assert.equal(result?.decision, "hold");
  assert.equal(result?.relevanceScore, 0);
  assert.equal(result?.confidence, 0);
  assert.deepEqual(result?.affectedOrgIds, []);
  assert.equal(result?.impactSentence, null);
  assert.deepEqual(result?.evidenceSpans, []);
});

test("a missing writing pass fails instead of poisoning the reusable cache", async () => {
  let calls = 0;
  await assert.rejects(
    enrichWithEditorModel(
      item(),
      [],
      { apiKey: "test" },
      (async () => {
        calls += 1;
        return response(calls === 1
          ? {
            relevanceScore: 98,
            confidence: 0.98,
            decision: "priority_review",
            affectedOrgIds: ["org-penn"],
            changeType: "deployment",
            materialityDimensions: ["deployment"],
            evidenceSpans: ["Penn launches a new deployment for regional clinicians."],
          }
          : {});
      }) as typeof fetch,
    ),
    (error: unknown) => error instanceof EditorModelError && error.code === "validation",
  );
  assert.equal(calls, 2);
});

test("an empty classification fails instead of becoming a cached hold", async () => {
  await assert.rejects(
    enrichWithEditorModel(item(), [], { apiKey: "test" }, (async () => response({})) as typeof fetch),
    (error: unknown) => error instanceof EditorModelError && error.code === "validation",
  );
});

test("malformed JSON remains a classified model failure", async () => {
  await assert.rejects(
    enrichWithEditorModel(
      item(),
      [],
      { apiKey: "test" },
      (async () => new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }))) as typeof fetch,
    ),
    (error: unknown) => error instanceof EditorModelError && error.code === "malformed",
  );
});
