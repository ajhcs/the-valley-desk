import assert from "node:assert/strict";
import test from "node:test";
import { validateEditorialDetail } from "../src/ui/watch-editorial-client";
import { canonicalJson, sha256 } from "../src/content/watch-schema";
import { syntheticFixture, NOW } from "./fixtures/watch-contracts/synthetic";

test("review detail binds exact proposal hash and expected identity", async () => {
  const fixture = await syntheticFixture("policy");
  const proposal = { externalKey: "synthetic", draft: fixture.draft,
    facts: [...fixture.facts.values()].map(({ verification: _v, evidenceDigests: _d, ...fact }) => fact),
    evidence: [...fixture.evidence.values()] };
  const detail = { id: "review-one", sha256: await sha256(canonicalJson(proposal)), createdAt: NOW, proposal, decision: null };
  assert.deepEqual(await validateEditorialDetail(detail, detail.id), detail);
  await assert.rejects(validateEditorialDetail(detail, "other"), /integrity/);
  await assert.rejects(validateEditorialDetail({ ...detail, sha256: "0".repeat(64) }, detail.id), /integrity/);
  const malformed = { ...proposal, evidence: [{ id: "bad" }] };
  await assert.rejects(validateEditorialDetail({ ...detail, proposal: malformed, sha256: await sha256(canonicalJson(malformed)) }, detail.id), /integrity/);
});
