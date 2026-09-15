import assert from "node:assert/strict";
import test from "node:test";
import { handleReviewApi, configureReviewGuardsForTests, isReviewApiPath } from "../src/ingest/review-api";
import { pdfDatabase } from "./helpers/policy-pdf";
import { syntheticFixture } from "./fixtures/watch-contracts/synthetic";
import { handleWatchEditorialApi } from "../src/ingest/watch-editorial-api";
import type { D1DatabaseLike } from "../src/ingest/persistence";

test("Watch review queue cannot disguise failed D1 reads as an empty queue", async () => {
  for (const result of [{success:false,results:[]}, {}, {results:null}, {results:{}}]) {
    const statement = {bind(){return statement;},async first(){return null;},async run(){return {};},async all(){return result;}};
    const db = {prepare(){return statement;},async batch(){return [];}} as unknown as D1DatabaseLike;
    const response = await handleWatchEditorialApi(new Request("https://example.test/api/watch-drafts"),db,
      "/api/watch-drafts",null,{} as never);
    assert.equal(response.status,503);
    assert.deepEqual(await response.json(),{error:"watch-review-unavailable"});
    assert.equal(response.headers.get("cache-control"),"no-store");
  }
});

test("Watch review routes reuse authentication, bounded staging, and named operator decisions", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  configureReviewGuardsForTests();
  const env = { VALLEY_DESK_DB: db, REVIEW_API_TOKEN: "synthetic-review-token" };
  const source = await syntheticFixture("policy");
  const proposal = { externalKey: "synthetic:api:policy", draft: source.draft,
    facts: [...source.facts.values()].map(({ verification: _v, evidenceDigests: _e, ...fact }) => fact),
    evidence: [...source.evidence.values()] };
  const request = (path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
    new Request("https://example.test" + path, { method, headers: {
      authorization: "Bearer synthetic-review-token", ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(isReviewApiPath("/api/watch-drafts"), true);
  assert.equal(isReviewApiPath("/api/representative-drafts/one/decision"), true);
  const unauthorized = await handleReviewApi(request("/api/watch-drafts", "POST", proposal,
    { authorization: "", "cf-access-authenticated-user-email": "clyons@ajhcs.org" }), env);
  assert.equal(unauthorized.status, 404);
  const stagedResponse = await handleReviewApi(request("/api/watch-drafts", "POST", proposal), env);
  assert.equal(stagedResponse.status, 201);
  const staged = await stagedResponse.json() as { id: string; sha256: string };
  const list = await handleReviewApi(request("/api/watch-drafts"), env);
  assert.equal(list.headers.get("cache-control"), "no-store");
  assert.equal(((await list.json()) as { items: unknown[] }).items.length, 1);
  const head = await handleReviewApi(request("/api/watch-drafts/" + encodeURIComponent(staged.id), "HEAD"), env);
  assert.equal(head.status, 200); assert.equal(await head.text(), "");
  const decision = { sha256: staged.sha256, action: "accepted" };
  const sourceRulePath = `/api/watch-drafts/${staged.id}/source-rule`;
  assert.equal((await handleReviewApi(request(sourceRulePath, "POST", { sha256: staged.sha256 }, { authorization: "" }), env)).status, 404);
  assert.equal((await handleReviewApi(request(sourceRulePath, "POST", decision), env)).status, 400);
  const sourceRule = await handleReviewApi(request(sourceRulePath, "POST", { sha256: staged.sha256 }), env);
  assert.equal(sourceRule.status, 409);
  assert.deepEqual(await sourceRule.json(), { error: "watch-source-rule-native-capture-required" });
  assert.equal((await handleReviewApi(request(`/api/watch-drafts/${staged.id}/decision`, "POST", decision), env)).status, 403);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM watch_editorial_decisions").get()?.n, 0);
  // A real named operator still cannot approve evidence absent from retained source storage.
  assert.equal((await handleReviewApi(request(`/ops/api/watch-drafts/${staged.id}/decision`, "POST", decision), env,
    { routePrefix: "/ops/api", trustedAccessEmail: "clyons@ajhcs.org" })).status, 503);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM watch_publication_decisions").get()?.n, 0);
  const rejected = await handleReviewApi(request(`/ops/api/watch-drafts/${staged.id}/decision`, "POST", { ...decision, action: "rejected" }),
    env, { routePrefix: "/ops/api", trustedAccessEmail: "clyons@ajhcs.org" });
  assert.equal(rejected.status, 200);
  assert.equal(((await (await handleReviewApi(request("/api/watch-drafts"), env)).json()) as { items: unknown[] }).items.length, 0);
  assert.equal((await handleReviewApi(request("/api/watch-drafts?after=x&after=y"), env)).status, 400);
  assert.equal((await handleReviewApi(request("/api/watch-drafts", "POST", proposal, { "content-length": "500001" }), env)).status, 413);
  assert.equal((await handleReviewApi(request("/api/watch-drafts", "POST", proposal, { "content-type": "text/plain" }), env)).status, 415);
});
