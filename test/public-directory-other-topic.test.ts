import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import worker from "../worker.js";

// No reviewed record carries the ninth topic value yet. A fixture stands in for the contract change.
test("Other science publications are searchable and listed but have no topic page, feed, filter or sitemap entry", async () => {
  const dir = mkdtempSync(join(process.cwd(), "node_modules", ".research-other-"));
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
  const get = (path: string) => worker.fetch(new Request(origin + path), env, {});
  const text = async (path: string) => (await get(path)).text();
  try {
    sqlite.exec(readFileSync("ops/directory-removals.sql", "utf8"));
    sqlite.exec(readFileSync("migrations/0046_research_directory.sql", "utf8"));
    const records = execFileSync("python3", ["ops/research-fixture.py", "--count", "6"], { encoding: "utf8" })
      .trim().split("\n").map((line) => JSON.parse(line));
    const other = { ...records[4], topic: "Other science", title: "Lattice models of estuary sediment 4" };
    records[4] = other;
    const input = join(dir, "papers.jsonl"), refs = join(dir, "refs.json");
    writeFileSync(input, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    writeFileSync(refs, execFileSync("python3", ["ops/research-fixture.py", "--institutions"]));
    sqlite.exec(execFileSync("python3", ["ops/load-research.py", "--publications", input, "--institutions", refs], { encoding: "utf8" }));
    const detail = "/discover/publication/" + encodeURIComponent(other.id);

    // Searchable, and listed on its institution and county pages with the label on the card.
    for (const path of ["/discover/works?q=sediment", "/discover/institution/fixture-institute", "/discover/county/camden"]) {
      const html = await text(path);
      assert.ok(html.includes(">Lattice models of estuary sediment 4</a>"), path);
      assert.match(html, /<span class="meta-topic"><span><span class="meta-sep" aria-hidden="true"> · <\/span><span>Other science<\/span><\/span><\/span>/, path);
    }
    // The detail page shows the label without a topic link or a topic breadcrumb.
    const page = await text(detail);
    assert.match(page, /<dt>Topic<\/dt><dd><span>Other science<\/span><\/dd>/);
    assert.doesNotMatch(page, /href="\/discover\/topic\/other-science"/);
    assert.doesNotMatch(page, /"name":"Other science","item"/);
    // The API carries the value.
    assert.equal((await (await get("/api/directory/publications/" + encodeURIComponent(other.id))).json()).publication.topic, "Other science");
    const listing = await (await get("/api/directory/publications?q=sediment")).json();
    assert.deepEqual(listing.publications.map((p: { topic: string }) => p.topic), ["Other science"]);

    // No landing page, topic feed, filter option, home topic entry or sitemap entry.
    for (const path of ["/discover/topic/other-science", "/discover/topic/Other-science", "/discover/updates.xml?topic=other-science", "/discover/updates.xml?topic=Other+science"])
      assert.equal((await get(path)).status, 404, path);
    for (const path of ["/", "/discover/works", "/discover/institution/fixture-institute", "/discover/county/camden", "/discover/new"]) {
      const html = await text(path);
      assert.doesNotMatch(html, /<option value="other-science"|>Other science<\/option>/, path);
      assert.doesNotMatch(html, /href="\/discover\/topic\/other-science"/, path);
    }
    for (const path of ["/", "/discover/institution/fixture-institute", "/discover/county/camden"]) {
      const topics = /<section class="tally"><h2>Topics<\/h2>[\s\S]*?<\/section>/.exec(await text(path));
      assert.ok(topics, path);
      assert.doesNotMatch(topics[0], /Other science/, path);
    }
    assert.doesNotMatch(await text("/discover/institution/fixture-institute"), /largest topics are[^.]*Other science/);
    assert.doesNotMatch(await text("/discover/sitemap/directory.xml"), /other-science/);
    assert.match(await text("/discover/sitemap/1.xml"), new RegExp(encodeURIComponent(other.id).replaceAll("%", "%")));
    // A hand-written topic filter does not turn search into a topic page; the record is still listed.
    const filtered = await text("/discover/works?topic=other-science&q=sediment");
    assert.ok(filtered.includes(">Lattice models of estuary sediment 4</a>"));
    assert.doesNotMatch(filtered, /<h1>[^<]*Other science/);
    // The health topics keep their pages and feeds.
    assert.equal((await get("/discover/topic/medical-imaging")).status, 200);
    assert.equal((await get("/discover/updates.xml?topic=medical-imaging")).status, 200);
  } finally {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
