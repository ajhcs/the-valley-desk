#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import worker from "../worker.js";
import { handlePublicHealth } from "../src/lib/ops.ts";
import { resolvePublicOrigin, DEFAULT_PUBLIC_ORIGIN } from "../src/lib/canonical.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Qualify local migrations without loading production bindings, routes or schedules.
const smokeConfig = join(root, "test", "fixtures", "ops-smoke", "wrangler.jsonc");
const smokePersistence = join(root, ".wrangler", "ops-smoke");
const smokeDatabase = "valley-desk-local-smoke";
const localOptions = ["--local", "--config", smokeConfig, "--persist-to", smokePersistence];

function run(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
  });
}

const migrations = readdirSync(join(root, "migrations")).filter((file) => file.endsWith(".sql")).sort();
if (!migrations.length) throw new Error("No D1 migrations found");

run("npm", ["exec", "--", "wrangler", "d1", "migrations", "apply", smokeDatabase, ...localOptions]);
const tables = run("npm", ["exec", "--", "wrangler", "d1", "execute", smokeDatabase, ...localOptions, "--command", "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ingest_runs','published_content','automation_locks')"]);
if (!tables.includes("ingest_runs") || !tables.includes("automation_locks")) {
  throw new Error("Local D1 smoke did not see required tables");
}

class Statement {
  constructor(statement) {
    this.statement = statement;
    this.values = [];
  }
  bind(...values) {
    const next = new Statement(this.statement);
    next.values = values;
    return next;
  }
  async first() {
    return this.statement.get(...this.values) ?? null;
  }
  async run() {
    return this.statement.run(...this.values);
  }
  async all() {
    return { results: this.statement.all(...this.values) };
  }
}

const database = new DatabaseSync(":memory:");
for (const name of migrations) database.exec(readFileSync(join(root, "migrations", name), "utf8"));
const db = {
  prepare(query) {
    return new Statement(database.prepare(query));
  },
  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  },
};

const retention = [];
const reads = [];
const cleanupDb = {
  ...db,
  prepare(query) {
    reads.push(query);
    return db.prepare(query);
  },
};
await worker.scheduled({ cron: "*/15 * * * *" }, { VALLEY_DESK_DB: cleanupDb }, {
  waitUntil(promise) { retention.push(promise); },
});
await Promise.all(retention);
if (retention.length !== 4 || reads.some((sql) => /INSERT INTO ingest_runs|automation_locks/.test(sql))) {
  throw new Error("Expected a retention-only scheduled run");
}

const health = await handlePublicHealth(new Request("https://the-valley-desk.clyons.workers.dev/api/health"), {
  BUILD_SHA: "smoke",
});
if (health.status !== 200) throw new Error(`Health smoke failed: ${health.status}`);

if (resolvePublicOrigin(undefined) !== DEFAULT_PUBLIC_ORIGIN) {
  throw new Error("Preview origin default drifted");
}

if (existsSync(join(root, "dist", "index.html"))) {
  const html = readFileSync(join(root, "dist", "index.html"), "utf8");
  if (!html.includes("tvd-primary")) throw new Error("Built index.html is missing noscript primary content");
}

console.log("ops-smoke passed");
