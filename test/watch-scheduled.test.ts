import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { pdfDatabase } from "./helpers/policy-pdf";
import { NOW, syntheticFixture } from "./fixtures/watch-contracts/synthetic";
import { stageEditorialProposal } from "../src/ingest/watch-editorial";
import { watchSchedulePhase, runScheduledWatchCollection, runScheduledWatchPublication } from "../src/ingest/watch-scheduled";
import { watchOperationBudget, WatchOperationBudgetError } from "../src/ingest/watch-operation-budget";

test("Watch operation budget counts bound statements and refuses an entire oversized atomic batch", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  sqlite.exec("CREATE TEMP TABLE operation_budget_test(value TEXT)");
  const budget = watchOperationBudget(db, 3);
  await budget.db.prepare("SELECT 1").first();
  await assert.rejects(budget.db.batch([1, 2, 3].map(value => budget.db.prepare("INSERT INTO operation_budget_test VALUES(?)").bind(value))), WatchOperationBudgetError);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM operation_budget_test").get()?.n, 0);
  assert.equal(budget.used, 1);
  await budget.db.batch([1, 2].map(value => budget.db.prepare("INSERT INTO operation_budget_test VALUES(?)").bind(value)));
  assert.equal(budget.used, 3);
  await assert.rejects(budget.db.prepare("SELECT 1").all(), WatchOperationBudgetError);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM operation_budget_test").get()?.n, 2);
  assert.throws(() => watchOperationBudget(db, 751), /invalid-operation-budget/);
});

test("Watch queue advances past held records, wraps fairly, and releases its lease", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  for (const suffix of ["a", "b"]) {
    const fixture = await syntheticFixture("policy");
    fixture.draft.id = "queue-policy-" + suffix; fixture.draft.slug = "queue-policy-" + suffix;
    await stageEditorialProposal(db, { externalKey: "queue:" + suffix, draft: fixture.draft,
      facts: [...fixture.facts.values()].map(({ verification: _v, evidenceDigests: _d, ...fact }) => ({ ...fact, subjectId: fixture.draft.id })),
      evidence: [...fixture.evidence.values()] }, new Date(NOW));
  }
  const results = [];
  for (let i = 0; i < 3; i++) results.push(await runScheduledWatchPublication(db, { enabled: true, now: new Date(NOW) }));
  assert.ok(results.every(result => result.outcome === "held"));
  assert.notEqual(results[0].draftId, results[1].draftId);
  assert.equal(results[0].draftId, results[2].draftId);
  assert.equal(sqlite.prepare("SELECT lease_owner FROM watch_source_rule_dispatch").get()?.lease_owner, null);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_decisions").get()?.n, 0);
});

test("Watch publication dispatch excludes a live competing lease and an empty queue stays idle", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  sqlite.exec("UPDATE watch_source_rule_dispatch SET lease_owner='other',lease_expires_at='2099-01-01T00:00:00.000Z'");
  assert.equal((await runScheduledWatchPublication(db, { enabled: true, now: new Date(NOW) })).outcome, "locked");
  sqlite.exec("UPDATE watch_source_rule_dispatch SET lease_owner=NULL,lease_expires_at=NULL");
  assert.equal((await runScheduledWatchPublication(db, { enabled: true, now: new Date(NOW) })).outcome, "idle");
});

test("Watch phases have separate invocations and disabled phases perform no D1 work", async () => {
  const db = { prepare() { throw Error("unexpected D1"); }, async batch() { throw Error("unexpected D1"); } };
  assert.equal((await runScheduledWatchCollection(db, { enabled: false })).outcome, "disabled");
  assert.equal((await runScheduledWatchPublication(db, { enabled: false })).outcome, "disabled");
  assert.equal(watchSchedulePhase(Date.parse("2026-09-15T15:02:00.000Z")), "collection");
  assert.equal(watchSchedulePhase(Date.parse("2026-09-15T15:07:00.000Z")), "publication");
  assert.throws(() => watchSchedulePhase(NaN), /invalid-scheduled-time/);
  assert.throws(() => watchSchedulePhase(Date.parse("2026-09-15T15:00:00.000Z")), /invalid-scheduled-time/);
});

test("the production schedule runs retention cleanup without starting editorial ingest", () => {
  const worker = readFileSync(new URL("../worker.js", import.meta.url), "utf8");
  const scheduled = worker.slice(worker.indexOf("  async scheduled("), worker.indexOf("  async fetch("));
  assert.match(scheduled, /cleanupEmailDiscoveries/);
  assert.match(scheduled, /resolvePendingEmailAuthentication/);
  assert.doesNotMatch(scheduled, /runAutomation|sendAutomationAlerts|runScheduledWatch/);
  const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(config.triggers.crons, ["*/15 * * * *"]);
});
