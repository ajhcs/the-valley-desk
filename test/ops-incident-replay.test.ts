import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { sendAutomationAlerts } from '../worker.js';
import { dispatchOperationalAlert, recordOperationalAlert, resolveOperationalAlertWithTransition } from '../src/lib/alerts.ts';
import type { D1DatabaseLike, D1StatementLike } from '../src/ingest/persistence.ts';
const time = (minute: number) => new Date(Date.parse('2026-10-06T10:00:00Z') + minute * 60_000);
function fixture() {
 const sql = new DatabaseSync(':memory:');
 for (const f of readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) sql.exec(readFileSync(`migrations/${f}`, 'utf8'));
 const statement = (query: string, values: unknown[] = []): D1StatementLike => ({
  bind: (...args: unknown[]) => statement(query, args),
  first: async <T>() => (sql.prepare(query).get(...values as never[]) as T) ?? null,
  all: async <T>() => ({ results: sql.prepare(query).all(...values as never[]) as T[] }),
  run: async () => sql.prepare(query).run(...values as never[]),
 });
 const db: D1DatabaseLike = { prepare: q => statement(q), batch: async ss => Promise.all(ss.map(s => s.run())) };
 const mail: string[] = [];
 const env = { VALLEY_DESK_DB: db, NOTIFY_OPS: { send: async (m: { text: string }) => { mail.push(m.text); return {}; } } };
 const row = (id: string) => Object.assign({}, sql.prepare('SELECT * FROM operational_alerts WHERE fingerprint=?').get(id)) as any;
 const source = (runId: string | undefined, minute: number, state: string, observed = minute) => sendAutomationAlerts(env, {
  ...(runId ? { runId } : {}), finishedAt: time(minute).toISOString(), notes: { sources: [{ id: 'fixture-replay-source', type: 'rss', state, checkedAt: time(observed).toISOString(), servingPath: state === 'healthy' ? 'primary' : 'unavailable', itemCount: state === 'healthy' ? 1 : 0 }] },
 }, time(minute + 120));
 return { sql, db, mail, env, row, source };
}
const fingerprint = 'valley-desk:source:fixture-replay-source';

test('three concurrent deliveries of one failure cannot satisfy a three-observation threshold', async () => {
 const f = fixture(); try {
  await Promise.all([f.source('same-failed-run', 1, 'upstream-failed'), f.source('same-failed-run', 1, 'upstream-failed'), f.source('same-failed-run', 1, 'upstream-failed')]);
  assert.equal(f.row(fingerprint).occurrence_count, 1);
  assert.equal(f.mail.length, 0);
  await f.source('real-failure-2', 2, 'upstream-failed');
  await f.source('real-failure-3', 3, 'upstream-failed');
  assert.equal(f.row(fingerprint).occurrence_count, 3);
  assert.equal(f.mail.length, 0, 'warning source failures remain digest-only');
  assert.equal(f.row(fingerprint).notification_attempt_count, 0);
 } finally { f.sql.close(); }
});

test('cached source success in a later run is not a second fresh recovery check', async () => {
 const f = fixture(); try {
  await f.source('failure', 0, 'upstream-failed');
  await f.source('success-1', 10, 'healthy');
  assert.equal(f.row(fingerprint).recovery_count, 1);
  await f.source('later-run-same-source-evidence', 15, 'healthy', 10);
  assert.equal(f.row(fingerprint).state, 'open');
  assert.equal(f.row(fingerprint).recovery_count, 1);
  await f.source('fresh-source-success', 20, 'healthy');
  assert.equal(f.row(fingerprint).state, 'resolved');
 } finally { f.sql.close(); }
});

test('legacy completion time dedupes replayed healthy runs without run IDs', async () => {
 const f = fixture(); try {
  const id = 'valley-desk:model-verifier';
  await recordOperationalAlert(f.db, { fingerprint: id, event: 'model-verifier-failed', severity: 'warning', notify: false, now: time(0) });
  const result = { finishedAt: time(10).toISOString(), verifierAttemptedCount: 1, verifierFailedCount: 0 };
  await sendAutomationAlerts(f.env, result, time(30));
  await sendAutomationAlerts(f.env, result, time(40));
  assert.equal(f.row(id).state, 'open');
  assert.equal(f.row(id).recovery_count, 1);
 } finally { f.sql.close(); }
});

test('distinct IDs at one recovery timestamp cannot invent a second check', async () => {
 const f = fixture(); try {
  await recordOperationalAlert(f.db, { fingerprint, event: 'source-degraded', severity: 'critical', notify: false, now: time(0) });
  for (const observationId of ['a', 'b', 'a']) await resolveOperationalAlertWithTransition(f.db, fingerprint, time(10), 2, { observationId });
  assert.equal(f.row(fingerprint).state, 'open');
  assert.equal(f.row(fingerprint).recovery_count, 1);
  await resolveOperationalAlertWithTransition(f.db, fingerprint, time(11), 2, { observationId: 'fresh' });
  assert.equal(f.row(fingerprint).state, 'resolved');
 } finally { f.sql.close(); }
});

test('real critical outage transitions and scheduled reminders survive replay deduplication', async () => {
 const f = fixture(); try {
  const failure = (id: string, minute: number, threshold = 3) => dispatchOperationalAlert(f.db, f.env.NOTIFY_OPS, { fingerprint, event: 'synthetic-critical-outage', severity: 'critical', threshold, now: time(minute), observationId: id });
  await Promise.all([failure('initial', 0), failure('initial', 0), failure('initial', 0)]);
  assert.equal(f.mail.length, 0); assert.equal(f.row(fingerprint).occurrence_count, 1);
  await failure('second', 1); await failure('third', 2);
  assert.equal(f.mail.length, 1);
  await failure('third', 2); assert.equal(f.mail.length, 1);
  await failure('six-hour-reminder', 362); assert.equal(f.mail.length, 2);
  await failure('too-early', 363); assert.equal(f.mail.length, 2);
  await failure('daily-reminder', 1802); assert.equal(f.mail.length, 3);
  for (const minute of [1803, 1804]) await resolveOperationalAlertWithTransition(f.db, fingerprint, time(minute), 2, { observationId: 'healthy-' + minute });
  assert.equal(f.row(fingerprint).state, 'resolved');
  await failure('new-real-outage', 1805, 1);
  assert.equal(f.row(fingerprint).state, 'open'); assert.equal(f.row(fingerprint).recovery_count, 0);
  assert.equal(f.row(fingerprint).occurrence_count, 1); assert.equal(f.mail.length, 4);
 } finally { f.sql.close(); }
});

test('explicit invalid or future source evidence cannot count as healthy recovery', async () => {
 for (const checkedAt of ['not-a-timestamp', '2027-01-01T00:00:00Z', '']) {
  const f = fixture(); try {
   await f.source('failure', 0, 'upstream-failed');
   for (const minute of [10, 20]) await sendAutomationAlerts(f.env, { runId: 'invalid-' + minute, finishedAt: time(minute).toISOString(), notes: { sources: [{ id: 'fixture-replay-source', type: 'rss', state: 'healthy', checkedAt, servingPath: 'primary', itemCount: 1 }] } }, time(minute + 1));
   assert.equal(f.row(fingerprint).state, 'open'); assert.equal(f.row(fingerprint).recovery_count, 0); assert.equal(f.mail.length, 0);
  } finally { f.sql.close(); }
 }
});

test('healthy receipt without run identity, completion time or source evidence cannot recover', async () => {
 const f = fixture(); try {
  const id = 'valley-desk:model-verifier';
  await recordOperationalAlert(f.db, { fingerprint: id, event: 'model-verifier-failed', severity: 'warning', notify: false, now: time(0) });
  for (const minute of [10, 20]) await sendAutomationAlerts(f.env, { verifierAttemptedCount: 1, verifierFailedCount: 0 }, time(minute));
  assert.equal(f.row(id).state, 'open'); assert.equal(f.row(id).recovery_count, 0); assert.equal(f.mail.length, 0);
 } finally { f.sql.close(); }
});

test('interleaved equal-time failure identities cannot manufacture threshold evidence', async () => {
 const f = fixture(); try {
  for (const observationId of ['a', 'b', 'a']) await dispatchOperationalAlert(f.db, f.env.NOTIFY_OPS, { fingerprint, event: 'synthetic-critical-outage', severity: 'critical', threshold: 3, now: time(0), observationId });
  assert.equal(f.row(fingerprint).occurrence_count, 1); assert.equal(f.mail.length, 0);
  for (const minute of [1, 2]) await dispatchOperationalAlert(f.db, f.env.NOTIFY_OPS, { fingerprint, event: 'synthetic-critical-outage', severity: 'critical', threshold: 3, now: time(minute), observationId: 'later-' + minute });
  assert.equal(f.mail.length, 1);
 } finally { f.sql.close(); }
});

test('explicit invalid completion clocks cannot be replaced by delivery time despite a run ID', async () => {
 for (const finishedAt of ['not-a-timestamp', '2027-01-01T00:00:00Z']) {
  const f = fixture(); try {
   const id = 'valley-desk:model-verifier';
   await recordOperationalAlert(f.db, { fingerprint: id, event: 'model-verifier-failed', severity: 'warning', notify: false, now: time(0) });
   for (const minute of [10, 20]) await sendAutomationAlerts(f.env, { runId: 'invalid-completion-' + minute, finishedAt, verifierAttemptedCount: 1, verifierFailedCount: 0 }, time(minute));
   assert.equal(f.row(id).state, 'open'); assert.equal(f.row(id).recovery_count, 0); assert.equal(f.mail.length, 0);
   for (const minute of [30, 40]) await sendAutomationAlerts(f.env, { runId: 'fresh-valid-' + minute, finishedAt: time(minute).toISOString(), verifierAttemptedCount: 1, verifierFailedCount: 0 }, time(minute));
   assert.equal(f.row(id).state, 'resolved'); assert.equal(f.mail.length, 1);
  } finally { f.sql.close(); }
 }
});
