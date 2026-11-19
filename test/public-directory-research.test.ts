import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import worker from "../worker.js";

test("reviewed publication import, replay, relationships, feeds, flags and fresh removals", async () => {
  const dir = mkdtempSync(join(process.cwd(), "node_modules", ".research-test-"));
  const sqlite = new DatabaseSync(":memory:");
  const env = {
    DIRECTORY_PUBLIC_ENABLED: "true",
    PUBLICATIONS_PUBLIC_ENABLED: "true",
    VALLEY_DESK_DB: {
      prepare(sql: string) {
        const all = (...args: (number | string)[]) => ({ results: sqlite.prepare(sql).all(...args) });
        return { all: () => all(), bind: (...args: (number | string)[]) => ({ all: () => all(...args) }) };
      },
    },
  };
  const origin = "https://thevalleydesk.org";
  const get = (path: string, method = "GET") => worker.fetch(new Request(origin + path, { method }), env, {});
  const text = async (path: string) => (await get(path)).text();
  const input = join(dir, "papers.jsonl"),
    refs = join(dir, "refs.json");
  const load = () =>
    sqlite.exec(
      execFileSync("python3", ["ops/load-research.py", "--publications", input, "--institutions", refs], {
        encoding: "utf8",
      }),
    );
  try {
    sqlite.exec(readFileSync("ops/directory-removals.sql", "utf8"));
    env.PUBLICATIONS_PUBLIC_ENABLED = "false";
    assert.equal((await get("/discover/new")).status, 200);
    assert.doesNotMatch(await text("/"), />Publications</);
    assert.equal((await get("/api/directory/publications")).status, 404);
    assert.match(await text("/discover/updates.xml?topic=medical-imaging"), /<item>/);
    sqlite.exec(readFileSync("migrations/0046_research_directory.sql", "utf8"));
    env.PUBLICATIONS_PUBLIC_ENABLED = "true";
    assert.doesNotMatch(await text("/"), />Publications</);
    const fixture = execFileSync("python3", ["ops/research-fixture.py"], { encoding: "utf8" });
    const records = fixture
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    writeFileSync(input, fixture);
    writeFileSync(refs, execFileSync("python3", ["ops/research-fixture.py", "--institutions"]));
    load();
    const changes = () => sqlite.prepare("SELECT total_changes() n").get()!.n;
    const before = changes();
    load();
    assert.equal(changes(), before);
    const p = records[0],
      id = encodeURIComponent(p.id),
      detail = "/discover/publication/" + id;
    const api = "/api/directory/publications/" + id;
    const page = await text(detail);
    assert.match(page, /12 of 400 authors/);
    assert.match(page, /&lt;em&gt;methods&lt;\/em&gt;/);
    assert.match(page, /href="\/discover\/work\/617168725"/);
    assert.match(await text("/discover/work/617168725"), /Publications in the directory/);
    assert.match(await text("/discover/institution/fixture-institute"), /Estuary campus/);
    assert.match(await text("/discover/county/camden"), /Regional sites/);
    assert.match(await text("/discover/publication/arxiv%3A9901.00002"), /Regional imaging atlas/);
    assert.match(await text("/discover/publication/doi%3A10.9999%2Ffixture%2F3"), /Retracted publication/);
    const pub = async () => (await get(api)).json();
    assert.equal((await pub()).publication.id, p.id);
    p.title = "Revised imaging fixture";
    p.added = "2026-12-01";
    p.terms = ["replacement"];
    writeFileSync(input, JSON.stringify(p) + "\n");
    load();
    assert.equal((await pub()).publication.added, "2026-11-19");
    assert.equal((await pub()).publication.title, p.title);
    assert.equal((await (await get("/api/directory/publications?q=tomography")).json()).total, 0);
    const paths = [
      "/discover/works?q=replacement",
      "/discover/new",
      "/discover/updates.xml?institution=fixture-institute",
      "/api/directory/publications?county=camden",
      "/discover/sitemap/1.xml",
    ];
    for (const path of paths) {
      const body = await text(path);
      assert.ok(body.includes(id) || body.includes(p.id) || body.includes(p.title), path);
    }
    sqlite.prepare("INSERT INTO publication_removals(id) VALUES(?)").run(p.id);
    for (const path of [detail, api]) assert.equal((await get(path)).status, 410);
    for (const path of paths) {
      const body = await text(path);
      assert.ok(!body.includes(id) && !body.includes(p.id) && !body.includes(p.title), path);
    }
    sqlite.exec("DROP TABLE publication_removals");
    for (const path of [
      ...paths,
      detail,
      api,
      "/",
      "/sitemap.xml",
      "/discover/work/617168725",
      "/api/directory/projects",
    ])
      assert.equal((await get(path)).status, 503, path);
  } finally {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
