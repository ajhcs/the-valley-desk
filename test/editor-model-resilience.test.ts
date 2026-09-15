import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_EDITOR_MODEL,
  EditorModelError,
  enrichWithEditorModel,
  completeEditorJson,
} from "../src/ingest/editor-model.ts";
import type { ModelResponseDiagnostic } from "../src/ingest/model-response-diagnostics.ts";
import { NewsItem } from "../src/content/schema.ts";

test("bounded response diagnostics classify synthetic malformed paths without claiming production reproduction", async () => {
  for (const [body, phase, finishReason] of [
    ['{"private":"DO-NOT-RECORD",', "outer_json", undefined],
    [JSON.stringify({ id: "gen-1788735624-Example123", usage: { prompt_tokens: 42, completion_tokens: 1024, total_tokens: 1066 }, choices: [{ finish_reason: "length", message: { content: '{"private":"DO-NOT-RECORD",' } }] }), "content_json", "length"],
    [JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"decision": invalid}' } }] }), "content_json", "stop"],
  ] as const) {
    let diagnostic: ModelResponseDiagnostic | undefined;
    await assert.rejects(completeEditorJson([], { apiKey: "DO-NOT-RECORD" }, async () => new Response(body), { maxTokens: 1024, onDiagnostic: d => { diagnostic = d; } }), /malformed JSON/);
    assert.equal(diagnostic?.phase, phase);
    assert.equal(diagnostic?.finishReason, finishReason);
    assert.equal(diagnostic?.failure, "malformed");
    assert.ok(diagnostic?.shape?.parserCategory);
    assert.ok(diagnostic?.startedAt && diagnostic.endedAt);
    assert.ok(JSON.stringify(diagnostic).length < 2048);
    assert.ok(!JSON.stringify(diagnostic).includes("DO-NOT-RECORD"));
    if (finishReason === "length") {
      assert.equal(diagnostic?.usage?.completionTokens, 1024);
      assert.equal(diagnostic?.responseId, "gen-1788735624-Example123");
    }
  }
});

test("response diagnostics retain safe correlation and redact provider-controlled metadata", async () => {
  let diagnostic: ModelResponseDiagnostic | undefined;
  await completeEditorJson([], { apiKey: "test" }, async () => new Response(JSON.stringify({
    id: "Bearer DO-NOT-RECORD", usage: { prompt_tokens: "DO-NOT-RECORD", total_tokens: -1 },
    choices: [{ finish_reason: "DO-NOT-RECORD", message: { content: '{}' } }],
  }), { headers: { "x-request-id": "11111111-1111-4111-8111-111111111111" } }), { onDiagnostic: d => { diagnostic = d; } });
  assert.equal(diagnostic?.requestId, "11111111-1111-4111-8111-111111111111");
  assert.equal(diagnostic?.responseId, undefined);
  assert.equal(diagnostic?.finishReason, "unknown");
  assert.ok(!JSON.stringify(diagnostic).includes("DO-NOT-RECORD"));
});

test("diagnostics preserve fenced and trailing-prose parsing and cannot change outcomes", async () => {
  for (const content of ['```json\n{"ok":true}\n```', 'Result: {"ok":true} trailing prose']) {
    assert.deepEqual(await completeEditorJson([], { apiKey: "test" }, async () => new Response(JSON.stringify({ choices: [{ message: { content } }] })), { onDiagnostic: () => { throw Error("sink failed"); } }), { ok: true });
  }
  await assert.rejects(completeEditorJson([], { apiKey: "test" }, async () => new Response("x".repeat(262145))), /exceeds byte limit/);
});

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
  assert.equal(result?.evidenceSpans.includes(item().title), true);
  assert.equal(result?.impactSentence, "Penn launches a new deployment for regional clinicians.");
  assert.equal(result?.body, "Penn launches a new deployment for regional clinicians.");
});

test("ordinary but relevant first-party news receives the evidence-writing pass", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return response(calls === 1
      ? {
        relevanceScore: 68,
        confidence: 0.88,
        decision: "priority_review",
        reasons: ["Covered system deployment"],
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
  assert.equal(calls, 2);
  assert.equal(result?.impactSentence, "Penn launches a new deployment for regional clinicians.");
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
  assert.deepEqual(result?.evidenceSpans, [item().title]);
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
