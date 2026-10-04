import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { sendAutomationAlerts } from "../worker.js";
import { recordOperationalAlert, interruptOperationalAlertRecovery, resolveOperationalAlertWithTransition } from "../src/lib/alerts.ts";
import type { D1DatabaseLike, D1StatementLike } from "../src/ingest/persistence.ts";

const sourceId = "fixture-cooper-ordering";
const availability = `valley-desk:source:${sourceId}`;
const primary = `valley-desk:source-fallback:${sourceId}`;
const timestamp = (minutes: number) => new Date(Date.parse("2026-10-04T07:00:00.000Z") + minutes * 60_000).toISOString();
type Event = { id: string; minute: number; kind: "healthy" | "failed" | "unavailable" };

function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").filter(x => x.endsWith(".sql")).sort()) sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  const statement = (query: string, values: unknown[] = []): D1StatementLike => ({
    bind: (...args: unknown[]) => statement(query, args),
    first: async <T>() => (sqlite.prepare(query).get(...values as never[]) as T) ?? null,
    all: async <T>() => ({ results: sqlite.prepare(query).all(...values as never[]) as T[] }),
    run: async () => sqlite.prepare(query).run(...values as never[]),
  });
  const db: D1DatabaseLike = { prepare: query => statement(query), batch: async statements => Promise.all(statements.map(s => s.run())) };
  const mail: string[] = [];
  const env = { VALLEY_DESK_DB: db, NOTIFY_OPS: { send: async (message: { text: string }) => { mail.push(message.text); return {}; } } };
  const row = (fingerprint = availability) => Object.assign({}, sqlite.prepare("SELECT * FROM operational_alerts WHERE fingerprint=?").get(fingerprint)) as any;
  let delivery = 0;
  const deliver = async (event: Event) => {
    const healthy = event.kind === "healthy";
    const source = {
      id: sourceId, origin: "synthetic", type: "rss", institutionIds: ["inst-cooper"],
      state: healthy ? "healthy" : event.kind === "failed" ? "upstream-failed" : "backoff",
      checkedAt: timestamp(event.minute), complete: false, itemCount: healthy ? 1 : 0,
      servingPath: healthy ? "primary" : "unavailable", primaryState: healthy ? "healthy" : "backoff",
      primaryLastSuccessAt: healthy ? timestamp(event.minute) : null, fallbackLastSuccessAt: null,
      ...(healthy ? { lastSuccessAt: timestamp(event.minute) } : { error: "synthetic failure", nextAttemptAt: "2026-10-09T00:00:00.000Z" }),
    };
    await sendAutomationAlerts(env, { runId: event.id, finishedAt: timestamp(event.minute), notes: { sources: [source] } }, new Date(timestamp(120 + delivery++)));
  };
  const seed = async () => {
    await deliver({ id: "initial-failure", minute: 0, kind: "failed" });
    await recordOperationalAlert(db, { fingerprint: primary, event: "source-fallback-active", severity: "warning", conditionState: "degraded", subsystem: "rss", notify: false, now: new Date(timestamp(0)) });
  };
  return { sqlite, db, env, mail, row, deliver, seed };
}

const boundary = (row: any) => Math.max(Date.parse(row.last_seen_at), Date.parse(row.last_recovered_at ?? "") || -Infinity);

test("stale unavailable replay preserves the newer pending recovery and condition count", async () => {
  const f = database();
  try {
    await f.seed();
    const old: Event = { id: "unavailable-0730", minute: 30, kind: "unavailable" };
    await f.deliver(old);
    await f.deliver({ id: "healthy-0745", minute: 45, kind: "healthy" });
    const before = [f.row(), f.row(primary)], mailCount = f.mail.length;
    assert.equal(before[0].recovery_count, 1); assert.equal(before[0].condition_state, "healthy");
    await f.deliver(old);
    assert.deepEqual([f.row(), f.row(primary)], before);
    assert.equal(f.mail.length, mailCount);
  } finally { f.sqlite.close(); }
});

test("stale ordinary failure cannot reset pending recovery or reopen a resolved incident", async () => {
  for (const resolved of [false, true]) {
    const f = database();
    try {
      await f.seed();
      const old: Event = { id: "old-failure", minute: 30, kind: "failed" };
      await f.deliver(old);
      await f.deliver({ id: "healthy-1", minute: 45, kind: "healthy" });
      if (resolved) await f.deliver({ id: "healthy-2", minute: 50, kind: "healthy" });
      const before = [f.row(), f.row(primary)], mailCount = f.mail.length;
      assert.equal(before[0].state, resolved ? "resolved" : "open");
      await f.deliver(old);
      assert.deepEqual([f.row(), f.row(primary)], before); assert.equal(f.mail.length, mailCount);
      await f.deliver({ id: "fresh-failure", minute: 60, kind: "failed" });
      assert.equal(f.row().state, "open"); assert.equal(f.row().condition_state, "failed"); assert.equal(f.row().recovery_count, 0);
    } finally { f.sqlite.close(); }
  }
});

test("failure wins equal-time ordering and success must follow its boundary", async () => {
  for (const kind of ["failed", "unavailable"] as const) {
    for (const successFirst of [false, true]) {
      const f = database();
      try {
        await f.seed();
        const success: Event = { id: "same-time-success", minute: 45, kind: "healthy" };
        const failure: Event = { id: "same-time-failure", minute: 45, kind };
        for (const event of successFirst ? [success, failure] : [failure, success]) await f.deliver(event);
        assert.equal(f.row().recovery_count, 0); assert.notEqual(f.row().condition_state, "healthy");
        assert.equal(f.row(primary).recovery_count, 0); assert.notEqual(f.row(primary).condition_state, "healthy");
        await f.deliver({ id: "later-success", minute: 46, kind: "healthy" });
        assert.equal(f.row().recovery_count, 1); assert.equal(f.row(primary).recovery_count, 1);
      } finally { f.sqlite.close(); }
    }
  }
});

function permutations<T>(values: T[]): T[][] {
  return values.length ? values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index)).map(rest => [value, ...rest])) : [[]];
}

test("48 success/failure/interruption orderings preserve newer evidence at every stale delivery", async t => {
  for (const interruption of ["failed", "unavailable"] as const) {
    const events: Event[] = [
      { id: "older-failure", minute: 10, kind: "failed" },
      { id: "interruption", minute: 15, kind: interruption },
      { id: "first-success", minute: 20, kind: "healthy" },
      { id: "second-success", minute: 25, kind: "healthy" },
    ];
    for (const order of permutations(events)) {
      await t.test(`${interruption}: ${order.map(e => e.id).join(" -> ")}`, async () => {
        const f = database();
        try {
          await f.seed();
          // Replaying the same original events never invents a new completion time.
          for (const event of [...order, ...order.slice().reverse()]) {
            const before = [f.row(), f.row(primary)]; const mailCount = f.mail.length;
            await f.deliver(event);
            const after = [f.row(), f.row(primary)];
            for (let i = 0; i < before.length; i++) {
              if (Date.parse(timestamp(event.minute)) < boundary(before[i])) {
                assert.deepEqual(after[i], before[i], `${event.id} changed newer evidence for ${i}`);
              }
              assert.ok(boundary(after[i]) >= boundary(before[i]), "evidence boundary regressed");
              if (after[i].condition_state !== "healthy" && after[i].state === "open") assert.equal(after[i].recovery_count, 0);
            }
            if (before.every(row => Date.parse(timestamp(event.minute)) < boundary(row))) assert.equal(f.mail.length, mailCount);
          }
          // A genuinely newer failure still interrupts; two new healthy runs recover.
          await f.deliver({ id: "new-failure", minute: 30, kind: "failed" });
          assert.equal(f.row().recovery_count, 0); assert.equal(f.row().state, "open");
          await f.deliver({ id: "new-success-1", minute: 35, kind: "healthy" });
          assert.equal(f.row().recovery_count, 1); assert.equal(f.row().state, "open");
          await f.deliver({ id: "new-success-2", minute: 40, kind: "healthy" });
          assert.equal(f.row().state, "resolved"); assert.equal(f.row().recovery_count, 2);
        } finally { f.sqlite.close(); }
      });
    }
  }
});

test("atomic guards preserve later recovery in both competing failure invocation orders", async () => {
  for (const ordinaryFailure of [false, true]) {
    for (const failureFirst of [false, true]) {
      const f = database();
      try {
        await f.seed();
        const success = () => resolveOperationalAlertWithTransition(f.db, availability, new Date(timestamp(45)), 2, { observationId: "later-run" });
        const stale = () => ordinaryFailure
          ? recordOperationalAlert(f.db, { fingerprint: availability, event: "source-degraded", severity: "critical", conditionState: "failed", now: new Date(timestamp(30)), notify: false })
          : interruptOperationalAlertRecovery(f.db, availability, "backoff", new Date(timestamp(30)), { reason: "old unavailable" });
        await Promise.all(failureFirst ? [stale(), success()] : [success(), stale()]);
        assert.equal(f.row().recovery_count, 1); assert.equal(f.row().condition_state, "healthy");
        assert.equal(f.row().last_recovered_at, timestamp(45));
      } finally { f.sqlite.close(); }
    }
  }
});

test("model failure uses the same completion clock and cannot reopen newer verifier recovery", async () => {
  const f = database();
  try {
    const fingerprint = "valley-desk:model-verifier";
    const deliver = (id: string, minute: number, failed: number) => sendAutomationAlerts(f.env, { runId: id, finishedAt: timestamp(minute), verifierAttemptedCount: 1, verifierFailedCount: failed }, new Date(timestamp(120)));
    await deliver("model-failed", 30, 1); await deliver("model-healthy-1", 45, 0);
    let before = f.row(fingerprint); assert.equal(before.recovery_count, 1);
    await deliver("model-failed", 30, 1); assert.deepEqual(f.row(fingerprint), before);
    await deliver("model-healthy-2", 50, 0); before = f.row(fingerprint); assert.equal(before.state, "resolved");
    await deliver("model-failed", 30, 1); assert.deepEqual(f.row(fingerprint), before);
    await deliver("model-new-failure", 60, 1); assert.equal(f.row(fingerprint).state, "open"); assert.equal(f.row(fingerprint).recovery_count, 0);
  } finally { f.sqlite.close(); }
});


test("source freshness diagnostics use completion time rather than delayed delivery time", async () => {
  const f = database();
  try {
    await sendAutomationAlerts(f.env, {
      runId: "delayed-failure", finishedAt: timestamp(30), notes: { sources: [{
        id: sourceId, type: "rss", state: "timed-out", servingPath: "unavailable", itemCount: 0,
        checkedAt: timestamp(30), lastSuccessAt: timestamp(0), institutionIds: ["inst-cooper"],
      }] },
    }, new Date(timestamp(240)));
    assert.equal(f.row().severity, "warning");
    const details = JSON.parse(f.row().detail_json);
    assert.equal(details.failureAgeMs, 30 * 60_000); assert.equal(details.coverageLost, false);
    assert.equal(f.row().last_seen_at, timestamp(30));
  } finally { f.sqlite.close(); }
});
