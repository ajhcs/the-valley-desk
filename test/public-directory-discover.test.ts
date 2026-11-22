import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import worker from "../worker.js";
import { similarMatch } from "../src/ingest/public-directory-discover";

const origin = "https://thevalleydesk.org";

test("similarity queries keep distinctive words and drop generic ones", () => {
  const match = similarMatch(
    "Consensus Recommendations on Sickle Cell Disease Health Maintenance",
    ["Humans", "Anemia, Sickle Cell", "Adolescent", "Child, Preschool"],
  )!;
  assert.match(match, /"sickle"/);
  assert.match(match, /"anemia"/);
  for (const generic of ["cell", "disease", "health", "humans", "adolescent", "preschool"]) {
    assert.doesNotMatch(match, new RegExp(`"${generic}"`), generic);
  }
  assert.ok(match.split(" OR ").length <= 8);
  assert.equal(similarMatch("A study of the data", ["Humans"]), undefined);
  // Quotes keep FTS syntax inert.
  assert.doesNotMatch(similarMatch('Tumour "NEAR" -OR- grading AND staging', [])!, /(^|\s)(NEAR|AND)(\s|$)/);
});

test("pages offer similar research, who works on a search, partners and recent publications", async () => {
  const dir = mkdtempSync(join(process.cwd(), "node_modules", ".discover-"));
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
  const text = async (path: string) => {
    const response = await worker.fetch(new Request(origin + path), env, {});
    assert.equal(response.status, 200, path);
    return response.text();
  };
  try {
    sqlite.exec(readFileSync("ops/directory-removals.sql", "utf8"));
    sqlite.exec(readFileSync("migrations/0046_research_directory.sql", "utf8"));
    const input = join(dir, "papers.jsonl"), refs = join(dir, "refs.json");
    writeFileSync(input, execFileSync("python3", ["ops/research-fixture.py", "--count", "30"], { maxBuffer: 1 << 26 }));
    writeFileSync(refs, execFileSync("python3", ["ops/research-fixture.py", "--institutions"]));
    sqlite.exec(execFileSync("python3", ["ops/load-research.py", "--publications", input, "--institutions", refs], { encoding: "utf8", maxBuffer: 1 << 26 }));
    sqlite.exec(readFileSync("ops/research-summary.sql", "utf8"));

    const id = "doi:10.9999/fixture/4";
    const publication = await text("/discover/publication/" + encodeURIComponent(id));
    assert.match(publication, /Similar research in the Delaware Valley/);
    const similar = publication.slice(publication.indexOf('id="similar-title"'));
    assert.ok(!similar.split("Recent ")[0].includes(`/discover/publication/${encodeURIComponent(id)}"`), "a record is not similar to itself");

    const search = await text("/discover/works?q=tissue");
    assert.match(search, /Who works on this in the region/);
    assert.match(search, /href="\/discover\/institution\/fixture-institute\?q=tissue"/);
    assert.doesNotMatch(await text("/discover/works"), /Who works on this in the region/);

    // A search is ordered by relevance by default and lists exactly the listings the date order does.
    const ids = async (path: string) => {
      const all: string[] = [];
      let total = 0;
      for (let page = 1; ; page++) {
        const body = await (await worker.fetch(new Request(origin + path + "&page=" + page), env, {})).json();
        total = body.total_pages ? body.record_total : 0;
        all.push(...(body.listings as { record: { id: string } }[]).map((l) => l.record.id));
        if (page >= body.total_pages) break;
      }
      return { total, ids: all };
    };
    for (const filter of ["", "&kind=publication", "&county=camden", "&label=listed", "&added_from=2026"]) {
      const relevance = await ids("/api/directory/listings?q=tissue" + filter);
      const dated = await ids("/api/directory/listings?q=tissue&sort=added" + filter);
      assert.equal(relevance.total, dated.total, filter);
      assert.equal(relevance.ids.length, relevance.total, "every page is full and nothing repeats " + filter);
      assert.deepEqual([...relevance.ids].sort(), [...dated.ids].sort(), filter);
    }
    assert.match(search, /<option value="relevance">Relevance<\/option>/);

    // Partner institutions come from the stored refresh and link to the partner's page.
    sqlite.prepare("INSERT INTO research_summary_partners VALUES('fixture-institute','upenn',12)").run();
    const institution = await text("/discover/institution/fixture-institute");
    assert.match(institution, /Shares the most research with/);
    assert.match(institution, /href="\/discover\/institution\/upenn"/);

    const home = await text("/");
    assert.match(home, /Recently published/);
    assert.match(home, /Looking for collaborators or related work\?/);
    assert.doesNotMatch(home, /Publication dates run from/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
