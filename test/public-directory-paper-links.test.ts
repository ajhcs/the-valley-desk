import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import worker from "../worker.js";

const origin = "https://thevalleydesk.org";
const paper = "pmid:990000001";
const paperPath = "/discover/publication/" + encodeURIComponent(paper);
const project = "565526";
const released = "617168725";

test("paper-to-repository links show on both pages and respect removals", async () => {
  const dir = mkdtempSync(join(process.cwd(), "node_modules", ".paper-links-"));
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
  const get = (path: string) => worker.fetch(new Request(origin + path), env, {});
  const text = async (path: string) => {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    return response.text();
  };
  try {
    sqlite.exec(readFileSync("ops/directory-removals.sql", "utf8"));
    sqlite.exec(readFileSync("migrations/0046_research_directory.sql", "utf8"));
    const input = join(dir, "papers.jsonl"), refs = join(dir, "refs.json");
    writeFileSync(input, execFileSync("python3", ["ops/research-fixture.py", "--count", "8"]));
    writeFileSync(refs, execFileSync("python3", ["ops/research-fixture.py", "--institutions"]));
    sqlite.exec(execFileSync("python3", ["ops/load-research.py", "--publications", input, "--institutions", refs], { encoding: "utf8", maxBuffer: 1 << 26 }));

    // Before the migration the pages render without the new sections.
    assert.doesNotMatch(await text("/discover/work/" + project), /Papers that link to this repository/);
    assert.doesNotMatch(await text(paperPath), /Code linked from this paper/);

    sqlite.exec(readFileSync("migrations/0048_paper_repository_links.sql", "utf8"));
    const csv = join(dir, "links.csv");
    writeFileSync(csv, [
      "paper_id,resource_key,target_url,kind,relation,existing_project_id",
      `${paper},https://github.com/x/y,https://github.com/x/y,code,cited,${project}`,
      `${paper},https://github.com/x/y,https://github.com/x/y,code,cited,${project}`,
      `doi:10.9999/fixture/a(b);%2f?x#y,https://github.com/x/z,https://github.com/x/z,code,released,${released}`,
    ].join("\n") + "\n");
    const sql = execFileSync("python3", ["ops/load-paper-links.py", csv], { encoding: "utf8" });
    assert.equal(sql.trim().split("\n").length, 2, "duplicate rows collapse");
    sqlite.exec(sql);
    sqlite.exec(sql);
    assert.equal((sqlite.prepare("SELECT count(*) n FROM paper_repository_links").get() as { n: number }).n, 2, "replay is idempotent");

    const projectPage = await text("/discover/work/" + project);
    assert.match(projectPage, /<h2 id="mentions-title">Papers that link to this repository<\/h2>/);
    assert.ok(projectPage.includes(`href="${paperPath}"`));
    const publicationPage = await text(paperPath);
    assert.match(publicationPage, /Code linked from this paper/);
    assert.ok(publicationPage.includes(`href="/discover/work/${project}"`));
    const api = await (await get("/api/directory/publications/" + encodeURIComponent(paper))).json();
    assert.deepEqual(api.publication.linked_projects, [project]);

    // A link to a project the paper already releases is not repeated under the weaker heading.
    const releasing = await text("/discover/work/" + released);
    assert.match(releasing, /Publications in the directory/);
    assert.doesNotMatch(releasing, /Papers that link to this repository/);

    // Removals hide the link in both directions.
    sqlite.prepare("INSERT INTO publication_removals(id) VALUES(?)").run(paper);
    assert.doesNotMatch(await text("/discover/work/" + project), /Papers that link to this repository/);
    sqlite.prepare("DELETE FROM publication_removals WHERE id=?").run(paper);
    sqlite.prepare("INSERT INTO public_directory_removals(github_id) VALUES(?)").run(project);
    assert.doesNotMatch(await text(paperPath), /Code linked from this paper/);

    // The loader rejects rows it cannot trust and can replace the table.
    writeFileSync(csv, "paper_id,existing_project_id\nnot-an-id,1\n");
    assert.notEqual(spawnSync("python3", ["ops/load-paper-links.py", csv]).status, 0);
    writeFileSync(csv, `paper_id,existing_project_id\n${paper},0123\n`);
    assert.notEqual(spawnSync("python3", ["ops/load-paper-links.py", csv]).status, 0);
    writeFileSync(csv, `paper_id,existing_project_id\n${paper},${released}\n`);
    sqlite.exec(execFileSync("python3", ["ops/load-paper-links.py", "--replace", csv], { encoding: "utf8" }));
    assert.deepEqual(sqlite.prepare("SELECT project_id FROM paper_repository_links").all().map((r) => (r as { project_id: string }).project_id), [released]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
