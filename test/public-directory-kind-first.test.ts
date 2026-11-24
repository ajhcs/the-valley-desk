import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../worker.js";
import { researchFeed, researchQuery } from "../src/ingest/public-directory-research";

const sizeLookup = "SELECT scope_field,scope_value,kind,n FROM research_summary_kinds";
const kindFirst = "INDEXED BY research_kind";

// The fields the datasets page reads from each data record.
const shape: Record<string, object> = {
  dataset: { summary: "Research dataset", data_type: "other", access: "open", repository: "GEO", accessions: ["GSE1"], url: "https://example.org/geo", institutions: [], label: "Verified", connection: "Regional paper", source: "https://example.org", papers: [], topic: "public-health", released: "2026-01-01", checked: "2026-01-01" },
  "regional-data": { summary: "Public health coverage", publisher: "Fixture agency", portal: "Fixture portal", url: "https://example.org/data", topic: "public-health", granularity: null, time_span: null, update_cadence: null, access: "open", license: null, formats: null, api: null, how_to_use: { step: "Download data", url: "https://example.org/help", caveats: [], citation: "Cite the agency" }, checked: "2026-01-02" },
};

/** A directory where one county holds most listings and datasets, regional data and studies are small kinds. */
function directory() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("ops/directory-removals.sql", "utf8"));
  for (const m of ["0046_research_directory", "0047_clinical_studies", "0048_paper_repository_links", "0050_datasets", "0052_regional_data"])
    sqlite.exec(readFileSync(`migrations/${m}.sql`, "utf8"));
  const insert = sqlite.prepare("INSERT INTO research_listings VALUES(?,?,?,?,?,?,?,?,?,?)");
  const add = (kind: string, i: number, facets: Record<string, string[]>) => {
    const id = `${kind}:${String(i).padStart(4, "0")}`;
    // Dates and titles repeat, so the id tiebreak in every order is exercised.
    const added = `2026-${String(1 + (i % 11)).padStart(2, "0")}-${String(1 + (i % 5)).padStart(2, "0")}`;
    const activity = i % 9 ? `20${String(10 + (i % 7)).padStart(2, "0")}-0${1 + (i % 3)}` : "";
    const title = `${["Alpha", "beta", "Gamma", "delta"][i % 4]} ${kind} ${i % 6}`;
    insert.run(id, kind, title, added, activity, facets.topic[0], id, title, JSON.stringify({ ...shape[kind], id, title, added, counties: facets.county }), JSON.stringify(facets));
  };
  for (let i = 0; i < 900; i++)
    add("publication", i, { county: ["philadelphia"], topic: [i % 2 ? "clinical-care" : "public-health"], institution: i ? ["upenn"] : ["tiny"] });
  for (let i = 0; i < 40; i++)
    add("dataset", i, {
      county: i % 4 ? ["philadelphia"] : ["camden"],
      topic: [i % 3 ? "clinical-care" : "public-health"],
      institution: i < 2 ? ["tiny"] : i % 2 ? ["upenn"] : [],
      access: [i % 5 ? "open" : "controlled"],
      datatype: ["other"],
      repository: [i % 2 ? "geo" : "zenodo"],
    });
  for (let i = 0; i < 6; i++)
    add("regional-data", i, { county: i % 3 ? ["philadelphia", "camden"] : ["camden"], topic: ["public-health"], access: ["open"] });
  for (let i = 0; i < 50; i++) add("study", i, { county: i % 5 ? ["philadelphia"] : ["camden"], topic: ["clinical-care"], institution: ["upenn"] });
  sqlite.exec("UPDATE study_visibility SET enabled=1; UPDATE dataset_visibility SET enabled=1; UPDATE regional_data_visibility SET enabled=1");
  sqlite.prepare("INSERT INTO dataset_removals(id) VALUES(?)").run("dataset:0001");
  sqlite.exec(readFileSync("ops/research-summary.sql", "utf8"));
  const queries: string[] = [];
  // `sized: false` fails the size lookup, which leaves every listing on the facet-first form.
  const db = (sized: boolean) =>
    ({
      prepare(sql: string) {
        const all = (...args: (number | string)[]) => {
          if (!sized && sql.startsWith(sizeLookup)) throw new Error("no sizes");
          queries.push(sql);
          return { results: sqlite.prepare(sql).all(...args) };
        };
        return { all: () => all(), bind: (...args: (number | string)[]) => ({ all: () => all(...args) }) };
      },
    }) as never;
  return { sqlite, queries, db };
}

test("a small kind within a large facet is read from the kind and lists the same rows in the same order", async () => {
  const { sqlite, queries, db } = directory();
  const cases: [query: string, byKind: boolean][] = [
    ["county=philadelphia&kind=dataset", true],
    ["county=philadelphia&kind=regional-data", true],
    ["county=philadelphia&kind=__datasets", true],
    ["topic=clinical-care&kind=dataset", true],
    ["institution=upenn&kind=dataset", true],
    ["county=philadelphia&topic=clinical-care&kind=dataset", true],
    ["county=philadelphia&county=camden&kind=dataset", true],
    ["county=philadelphia&access=open&kind=__datasets", true],
    ["repository=geo&kind=dataset", true],
    ["county=philadelphia&kind=dataset&date_from=2012&added_to=2026-08", true],
    ["county=philadelphia&kind=study&page=2", true],
    // The kind is larger than the facet, or there is no facet or no kind: unchanged.
    ["institution=tiny&kind=dataset", false],
    ["county=philadelphia&kind=publication", false],
    ["county=camden&kind=study", false],
    ["county=philadelphia", false],
    ["kind=dataset", false],
    ["q=alpha&county=philadelphia&kind=dataset&sort=added", false],
  ];
  for (const [query, byKind] of cases) {
    for (const sort of ["", "activity", "name", "added"]) {
      for (const page of ["", "2"]) {
        const params = () => new URLSearchParams(query + (sort && !query.includes("sort=") ? "&sort=" + sort : "") + (page && !query.includes("page=") ? "&page=" + page : ""));
        const label = params().toString();
        queries.length = 0;
        const found = await researchQuery(db(true), params(), []);
        assert.equal(queries.some((sql) => sql.includes(kindFirst)), byKind, label);
        assert.deepEqual(found, await researchQuery(db(false), params(), []), label);
      }
    }
    queries.length = 0;
    const feed = await researchFeed(db(true), new URLSearchParams(query), []);
    assert.equal(queries.some((sql) => sql.includes(kindFirst)), byKind, "feed " + query);
    assert.deepEqual(feed, await researchFeed(db(false), new URLSearchParams(query), []), "feed " + query);
  }

  const philadelphia = await researchQuery(db(true), new URLSearchParams("county=philadelphia&kind=dataset"), []);
  assert.equal(philadelphia.total, 29, "30 Philadelphia datasets less the removed one");
  assert.equal(philadelphia.items.length, 24);
  assert.ok(philadelphia.items.every((item) => item.kind === "dataset" && item.record.id !== "dataset:0001"));
  const both = await researchQuery(db(true), new URLSearchParams("county=philadelphia&kind=__datasets&sort=name"), []);
  assert.deepEqual(both.counts.map((row) => [row.kind, row.n]), [["dataset", 29], ["regional-data", 4]]);

  // Without stored totals the facet form stays.
  sqlite.exec("DELETE FROM research_summary_kinds");
  queries.length = 0;
  await researchQuery(db(true), new URLSearchParams("county=philadelphia&kind=dataset"), []);
  assert.ok(!queries.some((sql) => sql.includes(kindFirst)));
  sqlite.close();
});

test("datasets page filter choices are read from the two data kinds", async () => {
  const { sqlite, queries, db } = directory();
  const env = { DIRECTORY_PUBLIC_ENABLED: "true", PUBLICATIONS_PUBLIC_ENABLED: "true", VALLEY_DESK_DB: db(true) };
  const page = await (await worker.fetch(new Request("https://thevalleydesk.org/discover/datasets?county=philadelphia"), env, {})).text();
  const choices = queries.filter((sql) => sql.includes("json_extract(v.record,'$.repository')"));
  assert.equal(choices.length, 1);
  assert.match(choices[0], /FROM \(SELECT id,record FROM research_visible WHERE kind='dataset' UNION ALL SELECT id,record FROM research_visible WHERE kind='regional-data'\) v CROSS JOIN research_facets f/);
  assert.ok(queries.some((sql) => sql.includes(kindFirst)), "the county-filtered datasets listing is read by kind");
  assert.deepEqual(
    sqlite.prepare(choices[0]).all(),
    sqlite
      .prepare(
        "SELECT f.field,f.value,max(CASE f.field WHEN 'repository' THEN json_extract(v.record,'$.repository') WHEN 'datatype' THEN json_extract(v.record,'$.data_type') WHEN 'topic' THEN json_extract(v.record,'$.topic') END) name FROM research_facets f JOIN research_visible v ON v.id=f.id WHERE v.kind IN ('dataset','regional-data') AND f.field IN ('access','datatype','repository','institution','county','topic') GROUP BY f.field,f.value",
      )
      .all(),
    "same rows in the same order as the facet-first statement",
  );
  for (const option of ['<option value="camden"', '<option value="philadelphia" selected', '<option value="controlled"', '<option value="geo"'])
    assert.ok(page.includes(option), option);
  sqlite.close();
});
