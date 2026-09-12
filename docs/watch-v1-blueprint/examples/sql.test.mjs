import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  return db;
}
function generation(db) {
  return db.prepare("SELECT generation FROM example_read_state WHERE singleton = 1").get().generation;
}

// D1 implementation must use one db.batch with equivalent bound statements.
// BEGIN/COMMIT here exercise SQLite transaction semantics, not the D1 runtime.
function accept(db, { id, sortKey, payload = JSON.stringify({ id }), expected = generation(db), decision = `${id}-${expected + 1}` }) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO example_decisions VALUES (?, ?)").run(decision, expected);
    db.prepare("UPDATE example_read_state SET generation = generation + 1 WHERE singleton = 1").run();
    db.prepare(`UPDATE example_public_revisions
      SET valid_to = (SELECT generation FROM example_read_state WHERE singleton = 1)
      WHERE subject_id = ? AND valid_to IS NULL`).run(id);
    db.prepare(`INSERT INTO example_public_revisions
      (subject_id, valid_from, valid_to, sort_key, payload_json, decision_id)
      VALUES (?, (SELECT generation FROM example_read_state WHERE singleton = 1), NULL, ?, ?, ?)`)
      .run(id, sortKey, payload, decision);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function page(db, snapshot, limit, after = null) {
  return db.prepare(`SELECT subject_id, sort_key, payload_json
    FROM example_public_revisions r
    WHERE valid_from <= ?1 AND (valid_to IS NULL OR valid_to > ?1)
      AND (?2 IS NULL OR sort_key < ?2 OR (sort_key = ?2 AND subject_id < ?3))
      AND NOT EXISTS (SELECT 1 FROM example_delivery_tombstones t WHERE t.subject_id = r.subject_id)
    ORDER BY sort_key DESC, subject_id DESC LIMIT ?4`)
    .all(snapshot, after?.sort_key ?? null, after?.subject_id ?? null, limit);
}

test("legacy nullable uniqueness can admit duplicates; explicit non-null identity prevents it", () => {
  const db = database();
  try {
    db.exec("CREATE TABLE legacy_example (jurisdiction TEXT, session TEXT, native_id TEXT, UNIQUE(jurisdiction, session, native_id))");
    const legacy = db.prepare("INSERT INTO legacy_example VALUES (?, ?, ?)");
    legacy.run("PA", null, "DEMO-1");
    legacy.run("PA", null, "DEMO-1");
    assert.equal(db.prepare("SELECT count(*) AS n FROM legacy_example").get().n, 2);
    const insert = db.prepare("INSERT INTO example_policy_keys VALUES (?, ?, ?, ?, ?, ?)");
    assert.throws(() => insert.run("a", "PA", "assembly", null, "bill", "DEMO-1"), /NOT NULL/);
    assert.throws(() => insert.run("a", "PA", "assembly", "", "bill", "DEMO-1"), /CHECK/);
    insert.run("a", "PA", "assembly", "2025-2026", "bill", "DEMO-1");
    assert.throws(() => insert.run("b", "PA", "assembly", "2025-2026", "bill", "DEMO-1"), /UNIQUE/);
    insert.run("c", "NJ", "assembly", "2025-2026", "bill", "DEMO-1");
    insert.run("d", "PA", "assembly", "2027-2028", "bill", "DEMO-1");
  } finally { db.close(); }
});

test("snapshot keyset pagination survives an updated sort field and new publication", () => {
  const db = database();
  try {
    accept(db, { id: "a", sortKey: "2026-09-12-03" });
    accept(db, { id: "b", sortKey: "2026-09-12-02" });
    accept(db, { id: "c", sortKey: "2026-09-12-01" });
    const snapshot = generation(db);
    const first = page(db, snapshot, 1);
    assert.equal(first[0].subject_id, "a");
    accept(db, { id: "b", sortKey: "2026-09-13-01", payload: JSON.stringify({ id: "b", revision: 2 }) });
    accept(db, { id: "d", sortKey: "2026-09-14-01" });
    const rest = page(db, snapshot, 10, first[0]);
    assert.deepEqual(rest.map((row) => row.subject_id), ["b", "c"]);
    assert.deepEqual(JSON.parse(rest[0].payload_json), { id: "b" });
    assert.deepEqual(page(db, generation(db), 10).map((row) => row.subject_id), ["d", "b", "a", "c"]);
  } finally { db.close(); }
});

test("same-date ties have a strict deterministic keyset order", () => {
  const db = database();
  try {
    for (const id of ["a", "c", "b"]) accept(db, { id, sortKey: "2026-09-12" });
    const first = page(db, generation(db), 1);
    assert.equal(first[0].subject_id, "c");
    assert.deepEqual(page(db, generation(db), 10, first[0]).map((row) => row.subject_id), ["b", "a"]);
  } finally { db.close(); }
});

test("current tombstones prevent an older cursor from resurrecting withdrawn content", () => {
  const db = database();
  try {
    accept(db, { id: "a", sortKey: "2026-09-12" });
    const snapshot = generation(db);
    db.prepare("INSERT INTO example_delivery_tombstones VALUES (?, ?)").run("a", "editorial-retraction");
    assert.deepEqual(page(db, snapshot, 10), []);
  } finally { db.close(); }
});

test("failed projection insert rolls back generation, old revision closure, and decision", () => {
  const db = database();
  try {
    accept(db, { id: "a", sortKey: "2026-09-12" });
    const before = generation(db);
    assert.throws(() => accept(db, { id: "a", sortKey: "2026-09-13", payload: "invalid-json" }), /CHECK/);
    assert.equal(generation(db), before);
    assert.equal(page(db, generation(db), 10)[0].sort_key, "2026-09-12");
    assert.equal(db.prepare("SELECT count(*) AS n FROM example_decisions").get().n, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM example_public_revisions WHERE valid_to IS NULL").get().n, 1);
  } finally { db.close(); }
});

test("stale acceptance conflicts rather than overwriting newer public facts", () => {
  const db = database();
  try {
    const expected = generation(db);
    accept(db, { id: "a", sortKey: "2026-09-12", expected });
    assert.throws(() => accept(db, { id: "a", sortKey: "2026-09-13", expected, decision: "stale-decision" }), /stale-acceptance/);
    assert.equal(generation(db), 1);
    assert.equal(page(db, 1, 10)[0].sort_key, "2026-09-12");
  } finally { db.close(); }
});

test("decision replay cannot create an extra public revision", () => {
  const db = database();
  try {
    accept(db, { id: "a", sortKey: "2026-09-12", decision: "same-decision" });
    assert.throws(() => accept(db, { id: "a", sortKey: "2026-09-12", decision: "same-decision" }), /UNIQUE/);
    assert.equal(generation(db), 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM example_public_revisions").get().n, 1);
  } finally { db.close(); }
});
