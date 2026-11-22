import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { summarize, type ScopeField } from "../src/ingest/public-directory-entity";
import { researchFeed, researchQuery, resultCount } from "../src/ingest/public-directory-research";

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

test("stored totals and ordered reads return the same search results as direct queries", async () => {
  const dir = mkdtempSync(join(process.cwd(), "node_modules", ".research-ordered-"));
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
    writeFileSync(input, execFileSync("python3", ["ops/research-fixture.py", "--count", "700"], { maxBuffer: 1 << 28 }));
    writeFileSync(refs, execFileSync("python3", ["ops/research-fixture.py", "--institutions"]));
    sqlite.exec(execFileSync("python3", ["ops/load-research.py", "--publications", input, "--institutions", refs], { encoding: "utf8", maxBuffer: 1 << 28 }));
    const institutions = (sqlite.prepare("SELECT record FROM research_institutions").all() as { record: string }[]).map((row) => JSON.parse(row.record));

    const facets = sqlite
      .prepare("SELECT field,value,count(*) n FROM research_facets WHERE field IN ('institution','topic','county') GROUP BY field,value ORDER BY n DESC")
      .all() as { field: string; value: string; n: number }[];
    const cases: string[] = ["", "kind=publication", "kind=project", "sort=name", "page=3"];
    for (const facet of [...facets.slice(0, 4), ...facets.slice(-2)]) {
      const scope = `${facet.field}=${encodeURIComponent(facet.value)}`;
      cases.push(scope, scope + "&sort=activity", scope + "&sort=name&page=2", scope + "&kind=publication&page=4", scope + "&page=9999");
    }
    // These keep the direct path: text, two facets, several values, a label and a date bound.
    cases.push("q=fixture", `${facets[0].field}=${facets[0].value}&label=verified`, `${facets[0].field}=${facets[0].value}&added_from=2020`);
    const run = async () => {
      const out = [];
      for (const query of cases) {
        const params = new URLSearchParams(query);
        out.push({ query, result: await researchQuery(db, params, institutions), feed: await researchFeed(db, params, institutions) });
      }
      return JSON.parse(JSON.stringify(out));
    };
    const direct = await run();
    assert.ok(direct[0].result.total > 600);
    assert.ok(queries.every((sql) => !sql.includes("f.id=+v.id")));

    sqlite.exec(readFileSync("ops/research-summary.sql", "utf8"));
    queries.length = 0;
    assert.deepEqual(await run(), direct);
    assert.ok(queries.some((sql) => sql.includes("f.id=+v.id")), "a large scope is read in listing order");
    assert.ok(queries.some((sql) => sql.includes("research_facets WHERE field=? AND value IN")), "a small scope is still collected");
    assert.ok(queries.some((sql) => sql.includes("count(DISTINCT group_id)")), "other searches still count directly");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("search counts stop at the cap and still page through the most relevant listings", async () => {
  const dir = mkdtempSync(join(process.cwd(), "node_modules", ".research-cap-"));
  const sqlite = new DatabaseSync(":memory:");
  const db = {
    prepare(sql: string) {
      const all = (...args: (number | string)[]) => ({ results: sqlite.prepare(sql).all(...args) });
      return { all: () => all(), bind: (...args: (number | string)[]) => ({ all: () => all(...args) }) };
    },
  } as never;
  try {
    sqlite.exec(readFileSync("ops/directory-removals.sql", "utf8"));
    sqlite.exec(readFileSync("migrations/0046_research_directory.sql", "utf8"));
    const input = join(dir, "papers.jsonl"), refs = join(dir, "refs.json");
    writeFileSync(input, execFileSync("python3", ["ops/research-fixture.py", "--count", "60"], { maxBuffer: 1 << 26 }));
    writeFileSync(refs, execFileSync("python3", ["ops/research-fixture.py", "--institutions"]));
    sqlite.exec(execFileSync("python3", ["ops/load-research.py", "--publications", input, "--institutions", refs], { encoding: "utf8", maxBuffer: 1 << 26 }));
    const institutions = (sqlite.prepare("SELECT record FROM research_institutions").all() as { record: string }[]).map((r) => JSON.parse(r.record));
    const full = await researchQuery(db, new URLSearchParams("q=tissue"), institutions);
    assert.ok(full.total > 30 && !full.more, "uncapped count is exact");
    const capped = await researchQuery(db, new URLSearchParams("q=tissue"), institutions, 30);
    assert.equal(capped.more, true);
    assert.equal(capped.total, 30);
    assert.equal(resultCount(capped), "More than 30 listings");
    assert.deepEqual(capped.items.map((i) => i.record.id), full.items.map((i) => i.record.id), "same most-relevant first page");
    const second = await researchQuery(db, new URLSearchParams("q=tissue&page=2"), institutions, 30);
    assert.equal(second.page, 2);
    assert.equal(second.items.length, 24);
    const narrow = await researchQuery(db, new URLSearchParams("q=tissue&county=camden"), institutions, 30);
    assert.ok(!narrow.more || narrow.total === 30);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
