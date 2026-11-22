import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { summarize, type ScopeField } from "../src/ingest/public-directory-entity";

test("stored summaries equal direct counts and are what the pages read", async () => {
  const dir = mkdtempSync(join(process.cwd(), "node_modules", ".research-summary-"));
  const sqlite = new DatabaseSync(":memory:");
  const queries: string[] = [];
  const db = {
    prepare(sql: string) {
      const all = (...args: (number | string)[]) => {
        queries.push(sql);
        return { results: sqlite.prepare(sql).all(...args) };
      };
      return { all: () => all(), bind: (...args: (number | string)[]) => ({ all: () => all(...args) }) };
    },
  } as never;
  try {
    sqlite.exec(readFileSync("ops/directory-removals.sql", "utf8"));
    sqlite.exec(readFileSync("migrations/0046_research_directory.sql", "utf8"));
    const input = join(dir, "papers.jsonl"), refs = join(dir, "refs.json");
    writeFileSync(input, execFileSync("python3", ["ops/research-fixture.py", "--count", "60"]));
    writeFileSync(refs, execFileSync("python3", ["ops/research-fixture.py", "--institutions"]));
    sqlite.exec(execFileSync("python3", ["ops/load-research.py", "--publications", input, "--institutions", refs], { encoding: "utf8" }));

    const scopes = [
      undefined,
      ...(sqlite
        .prepare("SELECT DISTINCT field,value FROM research_facets WHERE field IN ('institution','topic','county')")
        .all() as { field: ScopeField; value: string }[]),
    ];
    assert.ok(scopes.length > 3, "fixture has institutions, topics and counties");

    // Without the tables the pages count directly.
    const direct = [];
    for (const scope of scopes) direct.push(await summarize(db, scope));
    assert.ok(direct[0].kinds.publication!.works > 0);
    assert.ok(queries.some((sql) => sql.includes("FROM research_visible")));

    const refresh = readFileSync("ops/research-summary.sql", "utf8");
    sqlite.exec(refresh);
    queries.length = 0;
    for (const [i, scope] of scopes.entries()) assert.deepEqual(await summarize(db, scope), direct[i], JSON.stringify(scope ?? "all"));
    assert.ok(queries.every((sql) => !sql.includes("research_visible") && !sql.includes("research_facets ")), "reads only the summary tables");

    // The refresh is replayable and picks up removals.
    const [removed] = sqlite.prepare("SELECT id FROM research_listings WHERE kind='publication' ORDER BY id LIMIT 1").all() as { id: string }[];
    sqlite.prepare("INSERT INTO publication_removals(id) VALUES(?)").run(removed.id);
    assert.deepEqual(await summarize(db), direct[0], "counts wait for the next refresh");
    sqlite.exec(refresh);
    const after = await summarize(db);
    assert.ok(after.kinds.publication!.works <= direct[0].kinds.publication!.works);
    sqlite.exec("DROP TABLE research_summary_kinds; DROP TABLE research_summary_facets");
    assert.deepEqual(await summarize(db), after, "direct count agrees after the removal");

    // An unfinished refresh has no whole-directory row, so pages count directly.
    sqlite.exec(refresh);
    sqlite.exec("DELETE FROM research_summary_kinds WHERE scope_field=''");
    queries.length = 0;
    assert.deepEqual(await summarize(db, scopes[1]), await summarize(db, scopes[1]));
    assert.ok(queries.some((sql) => sql.includes("FROM research_visible")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
