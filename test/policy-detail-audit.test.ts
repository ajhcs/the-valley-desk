import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function applyMigrations(database: DatabaseSync) {
  for (const name of readdirSync(join(root, "migrations")).filter((file) => file.endsWith(".sql")).sort()) {
    database.exec(readFileSync(join(root, "migrations", name), "utf8"));
  }
}

function auditStatements() {
  const sql = readFileSync(join(root, "docs/evidence/policy-detail-failure-audit.sql"), "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  return sql.match(/SELECT[\s\S]*?;/gi) ?? [];
}

function seedCandidate(
  database: DatabaseSync,
  values: { id: string; sourceId: string; disposition: "active" | "filtered"; reason?: string },
) {
  database.prepare(`
    INSERT INTO official_source_candidates (
      id, source_id, category, region, title, url, source_page_url, source_name,
      trust, discovered_at, last_seen_at, status, instruction_like,
      detail_fetched_at, detail_state, detail_error, detail_attempt_count,
      detail_next_attempt_at, detail_disposition, detail_disposition_reason
    ) VALUES (?, ?, 'policy', 'PA', ?, ?, ?, ?, 'regulatory', ?, ?, 'review', 0,
      ?, 'failed', 'HTTP 403', 2, ?, ?, ?)
  `).run(
    values.id,
    values.sourceId,
    values.id,
    `https://palegis.us/${values.id}`,
    "https://palegis.us/legislation",
    values.sourceId,
    "2026-09-01T12:00:00.000Z",
    "2026-09-06T12:00:00.000Z",
    "2026-09-06T11:59:59.000Z",
    values.disposition === "active" ? "2026-09-06T18:00:00.000Z" : null,
    values.disposition,
    values.reason ?? null,
  );
}

test("policy detail audit matches the schema 0027 timestamp and disposition contract", () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  seedCandidate(database, { id: "active-failure", sourceId: "ofs-pa-legislature-hb1925", disposition: "active" });
  seedCandidate(database, {
    id: "filtered-failure",
    sourceId: "ofs-de-newsroom",
    disposition: "filtered",
    reason: "outside-registered-policy-path",
  });

  const statements = auditStatements();
  assert.equal(statements.length, 2);
  const active = database.prepare(statements[0]!).all().map((row) => ({ ...row }));
  assert.deepEqual(active, [{
    source_id: "ofs-pa-legislature-hb1925",
    detail_state: "failed",
    detail_error: "HTTP 403",
    detail_disposition: "active",
    detail_disposition_reason: null,
    affected_records: 1,
    earliest_discovered_at: "2026-09-01T12:00:00.000Z",
    latest_listing_seen_at: "2026-09-06T12:00:00.000Z",
    latest_retained_detail_attempt_at: "2026-09-06T11:59:59.000Z",
    first_detail_attempt_at: null,
  }]);

  const detail = database.prepare(statements[1]!).all().map((row) => ({ ...row }));
  assert.equal(detail.length, 2);
  assert.equal(detail.find((row) => row.id === "active-failure")?.detail_disposition, "active");
  assert.equal(detail.find((row) => row.id === "filtered-failure")?.detail_disposition, "filtered");
  assert.equal(detail.find((row) => row.id === "filtered-failure")?.detail_disposition_reason, "outside-registered-policy-path");
  assert.ok(detail.every((row) => row.first_detail_attempt_at === null));
  assert.ok(detail.every((row) => row.latest_retained_detail_attempt_at === "2026-09-06T11:59:59.000Z"));
  database.close();
});
