import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import worker from "../worker.js";
import { supportOpen } from "../src/ingest/public-support-data";

const origin = "https://thevalleydesk.org";
const fixture = "test/fixtures/research-datasets/datasets.jsonl";
const geo = "geo:GSE990001";
const page = (id: string) => "/discover/dataset/" + encodeURIComponent(id);
const pubPage = (id: string) => "/discover/publication/" + encodeURIComponent(id);

/** An in-memory directory with the fixture publications, the institution and the six invented datasets. */
function directory() {
  const sqlite = new DatabaseSync(":memory:");
  const queries: string[] = [];
  const env = {
    DIRECTORY_PUBLIC_ENABLED: "true",
    PUBLICATIONS_PUBLIC_ENABLED: "true",
    VALLEY_DESK_DB: {
      prepare(sql: string) {
        queries.push(sql);
        const all = (...args: (number | string)[]) => ({ results: sqlite.prepare(sql).all(...args) });
        return { all: () => all(), bind: (...args: (number | string)[]) => ({ all: () => all(...args) }) };
      },
    },
  };
  const dir = mkdtempSync(join(process.cwd(), "node_modules", ".datasets-test-"));
  const load = (...args: string[]) =>
    sqlite.exec(execFileSync("python3", ["ops/load-research.py", ...args], { encoding: "utf8", maxBuffer: 1 << 26 }));
  sqlite.exec(readFileSync("ops/directory-removals.sql", "utf8"));
  for (const m of ["0046_research_directory", "0047_clinical_studies", "0048_paper_repository_links", "0050_datasets"])
    sqlite.exec(readFileSync(`migrations/${m}.sql`, "utf8"));
  const papers = join(dir, "papers.jsonl"), refs = join(dir, "refs.json");
  writeFileSync(papers, execFileSync("python3", ["ops/research-fixture.py", "--count", "8"]));
  writeFileSync(refs, execFileSync("python3", ["ops/research-fixture.py", "--institutions"]));
  load("--publications", papers, "--institutions", refs, "--datasets", fixture);
  const refresh = () => sqlite.exec(readFileSync("ops/research-summary.sql", "utf8"));
  refresh();
  const get = (path: string) => worker.fetch(new Request(origin + path), env, {});
  const text = async (path: string) => (await get(path)).text();
  const json = async (path: string) => (await get(path)).json() as Promise<any>;
  return { sqlite, queries, env, load, refresh, get, text, json, dir, close: () => rmSync(dir, { recursive: true, force: true }) };
}

function schemaOf(html: string) {
  const match = /<script id="directory-schema" type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, "JSON-LD present");
  const value = JSON.parse(match[1]);
  return (value["@graph"] ?? [value]) as Record<string, any>[];
}
const cardTitles = (html: string) => [...html.matchAll(/<li class="record record-dataset">[\s\S]*?<h3 class="record-title"><a href="[^"]+">([^<]+)<\/a>/g)].map((m) => m[1]);

test("datasets stay hidden while the switch is off", async () => {
  const d = directory();
  try {
    for (const path of ["/discover/datasets", page(geo), "/api/directory/datasets", "/api/directory/datasets/" + encodeURIComponent(geo)])
      assert.equal((await d.get(path)).status, 404, path);
    const works = await d.text("/discover/works");
    assert.doesNotMatch(works, /value="dataset"|Datasets|record-dataset/);
    assert.match(await d.text("/discover/works?kind=dataset"), /No matching listings/);
    assert.doesNotMatch(await d.text(pubPage("doi:10.9999/fixture/4")), /Data from this paper/);
    assert.doesNotMatch(await d.text("/"), /datasets/);
    assert.doesNotMatch(await d.text(pubPage("doi:10.9999/fixture/4")), /discover\/datasets/);
    assert.doesNotMatch(await d.text("/llms.txt"), /discover\/datasets/);
    assert.doesNotMatch(await d.text("/sitemap.xml"), /datasets-1/);
    assert.equal((await d.get("/discover/sitemap/datasets-1.xml")).status, 404);
    assert.doesNotMatch(await d.text("/discover/updates.xml?kind=dataset"), /discover\/dataset\//);
    assert.doesNotMatch(await d.text("/discover/methodology"), /api\/directory\/datasets/);
    assert.equal((await d.json("/api/directory/listings?kind=dataset")).listings.length, 0);
    assert.doesNotMatch(await d.text("/discover/institution/fixture-institute"), /dataset/i);
    // A removal recorded while the collection is hidden reveals nothing either.
    d.sqlite.prepare("INSERT INTO dataset_removals(id) VALUES(?)").run(geo);
    assert.equal((await d.get(page(geo))).status, 404);
  } finally {
    d.close();
  }
});

test("datasets page lists the newest releases first and filters by access, data type and repository", async () => {
  const d = directory();
  try {
    d.sqlite.exec("UPDATE dataset_visibility SET enabled=1");
    d.refresh();
    const landing = await d.text("/discover/datasets");
    assert.match(landing, /<h1>Datasets<\/h1>/);
    assert.match(landing, /<p class="lede">6 datasets from regional research/);
    assert.match(landing, /<link rel="canonical" href="https:\/\/thevalleydesk.org\/discover\/datasets">/);
    assert.deepEqual(cardTitles(landing), [
      "Structures from tissue study 4",
      "Estuary scanner phantom series",
      "Fictional Estuary tissue expression atlas",
      "Invented Estuary cohort survey",
      "Estuary plasma proteome reference",
      "Estuary tumour sequencing panel",
    ]);
    for (const [name, values] of [
      ["access", ["open", "registration", "controlled"]],
      ["datatype", ["clinical-and-survey", "gene-expression", "imaging", "proteomics", "sequencing", "structure"]],
      ["repository", ["dbgap", "european-genome-phenome-archive", "fictional-imaging-archive", "gene-expression-omnibus", "pride", "protein-data-bank"]],
      ["institution", ["fixture-institute"]],
      ["county", ["camden"]],
      ["topic", ["biomedical-and-life-sciences", "disease-research", "medical-imaging", "public-health"]],
    ] as const) {
      const select = new RegExp(`<select form="research-form" name="${name}">([\\s\\S]*?)</select>`).exec(landing);
      assert.ok(select, name);
      assert.deepEqual([...select[1].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]), values, name);
    }
    assert.doesNotMatch(landing, /name="kind"/);
    assert.match(landing, /<option value="activity">Release date<\/option>/);
    assert.match(landing, /href="\/discover\/updates.xml\?kind=dataset"/);

    const titles = async (query: string) => cardTitles(await d.text("/discover/datasets?" + query));
    assert.deepEqual(await titles("access=controlled"), ["Invented Estuary cohort survey", "Estuary tumour sequencing panel"]);
    assert.deepEqual(await titles("datatype=imaging"), ["Estuary scanner phantom series"]);
    assert.deepEqual(await titles("repository=protein-data-bank"), ["Structures from tissue study 4"]);
    assert.deepEqual(await titles("access=open&county=camden"), ["Structures from tissue study 4", "Fictional Estuary tissue expression atlas"]);
    assert.deepEqual(await titles("topic=disease-research&sort=name"), ["Estuary plasma proteome reference", "Estuary tumour sequencing panel"]);
    assert.deepEqual(await titles("q=proteome"), ["Estuary plasma proteome reference"]);
    assert.deepEqual(await titles("q=PXD990005"), ["Estuary plasma proteome reference"]);
    const filtered = await d.text("/discover/datasets?access=controlled&datatype=sequencing");
    assert.match(filtered, /<h1 class="sr-only">Datasets of sequencing data with controlled access<\/h1>/);
    assert.match(filtered, /<meta name="robots" content="noindex, follow">/);

    // The mixed search offers the kind, and the other surfaces count and list datasets.
    assert.match(await d.text("/discover/works"), /<option value="dataset">Datasets<\/option>/);
    assert.match(await d.text("/"), /6 datasets/);
    assert.match(await d.text("/"), /<nav class="desk-primary"[^>]*>[\s\S]*?<a href="\/discover\/datasets">Data<\/a>/);
    assert.match(landing, /<a href="\/discover\/datasets" aria-current="page">Data<\/a>/);
    assert.match(await d.text("/discover/institution/fixture-institute"), /6 datasets/);
    assert.match(await d.text("/llms.txt"), /discover\/datasets/);
    assert.match(await d.text("/discover/methodology"), /api\/directory\/datasets/);
    assert.match(await d.text("/discover/updates.xml?kind=dataset"), /<link>https:\/\/thevalleydesk.org\/discover\/dataset\/geo%3AGSE990001<\/link>/);
    // What's new lists datasets by full release date; a month-only release is not dated to a day.
    const whatsNew = await d.text("/discover/new?kind=dataset");
    assert.match(whatsNew, /Fictional Estuary tissue expression atlas/);
    assert.doesNotMatch(whatsNew, /Estuary plasma proteome reference/);
  } finally {
    d.close();
  }
});

test("dataset cards and pages show how to get the data and describe it as a schema.org Dataset", async () => {
  const d = directory();
  try {
    d.sqlite.exec("UPDATE dataset_visibility SET enabled=1");
    d.refresh();
    const landing = await d.text("/discover/datasets?repository=gene-expression-omnibus");
    const card = /<li class="record record-dataset">[\s\S]*?<\/li>/.exec(landing)![0];
    assert.match(card, /<span class="kind"><svg class="glyph glyph-dataset"[^>]*>[\s\S]*?<\/svg>Gene expression data<\/span>/);
    // One meta line: repository and ID, year, access in words, institution, Verified, topic.
    assert.match(card, /<p class="record-meta">[\s\S]*?<span class="record-repository">Gene Expression Omnibus GSE990001<\/span>/);
    assert.match(card, /<time datetime="2026">2026<\/time>/);
    assert.match(card, /aria-hidden="true"> · <\/span>Open access<span/);
    assert.match(card, /<a href="\/discover\/dataset\/geo%3AGSE990001">Fictional Estuary tissue expression atlas<\/a>/);
    assert.match(card, /<p class="record-summary">Bulk RNA profiles/);
    assert.match(card, /<a class="verified-word" href="\/discover\/methodology#verified">Verified<\/a>/);
    // Cards name institutions from the bundled registry; the invented institute is not in it.
    assert.match(card, /<a href="\/discover\/institution\/fixture-institute">fixture-institute<\/a>/);
    // The source link and the connection sentence move to the dataset's page (asserted below).
    assert.doesNotMatch(card, /example.org\/datasets\/geo-990001|The GEO series names|Added /);
    assert.match(card, /<a href="\/discover\/topic\/medical-imaging">Medical imaging<\/a>/);
    assert.match(await d.text("/discover/datasets?repository=protein-data-bank"), /Protein Data Bank 9ZZ1 <span class="meta-more">\+2<\/span>/);

    const html = await d.text(page(geo));
    assert.match(html, /<h1>Fictional Estuary tissue expression atlas<\/h1>/);
    assert.match(html, /<a href="https:\/\/www.ncbi.nlm.nih.gov\/geo\/query\/acc.cgi\?acc=GSE990001" rel="noreferrer" class="button primary">View on Gene Expression Omnibus ↗<\/a>/);
    const panel = /<section class="record-section get-data"[\s\S]*?<\/section>/.exec(html)![0];
    assert.match(panel, /<h2 id="get-title">How to get it<\/h2>/);
    assert.match(panel, /<dt>Access<\/dt><dd><span class="access-tag access-open"[\s\S]*?<span class="access-explain">Anyone can download the files/);
    assert.match(panel, /<dt>ID<\/dt><dd><a href="https:\/\/www.ncbi.nlm.nih.gov\/geo\/query\/acc.cgi\?acc=GSE990001" rel="noreferrer">GSE990001<\/a><\/dd>/);
    assert.match(panel, /<dt>Contents<\/dt><dd>24 samples · Counts matrix \(TSV\)<\/dd>/);
    assert.match(panel, /<dt>License<\/dt><dd><span class="muted">Not stated in the record<\/span>/);
    assert.match(panel, /<dt>How to cite<\/dt><dd><ol class="cite-list"><li><a href="\/discover\/publication\/doi%3A10.9999%2Ffixture%2F4">Imaging methods for tissue maps 4<\/a><\/li><li>Gene Expression Omnibus GSE990001<\/li><\/ol>/);
    assert.match(html, /<h2 id="connection-title">Regional connection<\/h2>\s*<p class="record-evidence"><a class="evidence evidence-verified"[\s\S]*?Verified<\/a> The GEO series names[^<]*<a href="https:\/\/example.org\/datasets\/geo-990001" rel="noreferrer">Regional source<\/a>/);
    // Bookkeeping folds into one line with "Record details"; the date added stays on the page.
    assert.match(html, /<details class="record-details"><summary><span>Source checked <time datetime="[0-9-]+">[^<]+<\/time><\/span><span class="record-details-label">Record details<\/span><\/summary><dl class="facts"><div><dt>Added to directory<\/dt><dd><time datetime="[0-9-]+">/);
    assert.match(html, /<dt>County<\/dt><dd><a href="\/discover\/county\/camden">Camden County<\/a>/);
    assert.match(html, /<h2 id="papers-title">Paper that produced it<\/h2><ul class="plain-list"><li><a href="\/discover\/publication\/doi%3A10.9999%2Ffixture%2F4">Imaging methods for tissue maps 4<\/a>/);
    assert.match(html, /id="feedback"/);
    const [dataset, crumbs] = schemaOf(html);
    assert.equal(dataset["@type"], "Dataset");
    assert.equal(dataset.name, "Fictional Estuary tissue expression atlas");
    assert.equal(dataset.url, origin + page(geo));
    assert.deepEqual(dataset.identifier, [geo, "GSE990001"]);
    assert.equal(dataset.isAccessibleForFree, true);
    assert.equal(dataset.license, undefined);
    assert.deepEqual(dataset.creator, [{ "@type": "Organization", name: "Fictional Estuary Research Institute" }]);
    assert.deepEqual(dataset.citation, [origin + pubPage("doi:10.9999/fixture/4")]);
    assert.equal(dataset.distribution.contentUrl, "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE990001");
    assert.equal(dataset.datePublished, "2026-03-14");
    assert.deepEqual(crumbs.itemListElement.map((c: { name: string }) => c.name), ["Directory", "Datasets", "Fictional Estuary tissue expression atlas"]);

    // Controlled access: no free-access claim, the committee explained, the paper found by its PubMed ID.
    const survey = await d.text(page("dbgap:phs990002"));
    assert.match(survey, /access-controlled[\s\S]*?Controlled<\/span><span class="access-explain">You apply for access/);
    assert.match(survey, /class="evidence"[^>]*>[\s\S]*?Listed<\/a>/);
    // A Listed card shows no evidence word; the label stays on the page above.
    const listedCard = (await d.text("/discover/datasets?access=controlled")).split("</li>").find((li) => li.includes("Invented Estuary cohort survey"))!;
    assert.doesNotMatch(listedCard, /verified-word|Listed/);
    const surveySchema = schemaOf(survey)[0];
    assert.equal(surveySchema.isAccessibleForFree, undefined);
    assert.match(surveySchema.conditionsOfAccess, /data access committee/);
    assert.match(survey, /<a href="\/discover\/publication\/pmid%3A990000001">Regional imaging atlas 1<\/a>/);

    // A DataCite DOI with registration, a license and its contents.
    const scans = await d.text(page("doi:10.99999/fictional.estuary.scans"));
    assert.match(scans, /access-registration[\s\S]*?Registration<\/span>/);
    assert.match(scans, /<a href="https:\/\/doi.org\/10.99999\/fictional.estuary.scans" rel="noreferrer">10.99999\/fictional.estuary.scans<\/a>/);
    assert.match(scans, /<dt>License<\/dt><dd>CC BY-NC 4.0<\/dd>/);
    assert.match(scans, /<dt>Contents<\/dt><dd>12 GB · DICOM<\/dd>/);
    assert.doesNotMatch(scans, /papers-title/);
    assert.equal(schemaOf(scans)[0].license, "CC BY-NC 4.0");

    // A structure set named for its paper links each PDB entry.
    const pdb = await d.text(page("pdb-set:doi:10.9999/fixture/4"));
    assert.match(pdb, /<dt>IDs<\/dt><dd><a href="https:\/\/www.rcsb.org\/structure\/9ZZ1" rel="noreferrer">9ZZ1<\/a>, <a href="https:\/\/www.rcsb.org\/structure\/9ZZ2"/);
    assert.match(pdb, /Protein Data Bank 9ZZ1, 9ZZ2, 9ZZ3<\/li>/);

    for (const bad of ["/discover/dataset/geo%3Anot-an-id", "/discover/dataset/geo%3AGSE1", "/discover/dataset/" + encodeURIComponent("doi:10.9999/fixture/4")])
      assert.equal((await d.get(bad)).status, 404, bad);
  } finally {
    d.close();
  }
});

test("publication pages list the datasets their paper produced", async () => {
  const d = directory();
  try {
    d.sqlite.exec("UPDATE dataset_visibility SET enabled=1");
    d.refresh();
    const html = await d.text(pubPage("doi:10.9999/fixture/4"));
    const section = /<section class="record-section related" aria-labelledby="paper-data-title">[\s\S]*?<\/section>/.exec(html)![0];
    assert.match(section, /<h2 id="paper-data-title">Data from this paper<\/h2>/);
    assert.deepEqual([...section.matchAll(/<a href="(\/discover\/dataset\/[^"]+)">/g)].map((m) => m[1]), [
      page("pdb-set:doi:10.9999/fixture/4"),
      page(geo),
    ]);
    assert.match(section, /Structural data<\/span><span class="record-repository">Protein Data Bank 9ZZ1<\/span>[\s\S]*?Open access<\/span>/);
    const atlas = await d.text(pubPage("pmid:990000001"));
    assert.match(atlas, /Data from this paper[\s\S]*Invented Estuary cohort survey/);
    assert.doesNotMatch(atlas, /Estuary plasma proteome reference/);
    const linked = await d.text(page("pride:PXD990005"));
    assert.match(linked, /Linked paper/);
    assert.doesNotMatch(linked, /Paper that produced it/);
    assert.doesNotMatch(await d.text(pubPage("doi:10.9999/fixture/5")), /Data from this paper/);
    const pub = await d.json("/api/directory/publications/" + encodeURIComponent("doi:10.9999/fixture/4"));
    assert.deepEqual(pub.publication.datasets, ["pdb-set:doi:10.9999/fixture/4", geo]);
    d.sqlite.exec("UPDATE dataset_visibility SET enabled=0");
    d.queries.length = 0;
    assert.equal((await d.json("/api/directory/publications/" + encodeURIComponent("doi:10.9999/fixture/4"))).publication.datasets, undefined);
    assert.doesNotMatch(await d.text("/"), /datasets/);
    assert.doesNotMatch(await d.text("/discover/institution/fixture-institute"), /dataset/i);
    assert.ok(!d.queries.some((sql) => sql.includes("count(DISTINCT v.group_id)") && sql.includes("research_visible")), "switching off uses refreshed non-dataset facet counts");
  } finally {
    d.close();
  }
});

test("dataset JSON, sitemap and removals", async () => {
  const d = directory();
  try {
    d.sqlite.exec("UPDATE dataset_visibility SET enabled=1");
    d.refresh();
    const all = await d.json("/api/directory/datasets");
    assert.equal(all.datasets.length, 6);
    assert.equal(all.total, 6);
    assert.equal(all.page, 1);
    assert.equal(all.page_size, 24);
    assert.deepEqual(Object.keys(all.datasets[0]).filter((key) => key !== "paper_provenance").sort(), [
      "access", "accessions", "added", "checked", "connection", "counties", "data_type", "format", "id", "institutions",
      "label", "license", "papers", "released", "repository", "size", "source", "summary", "title", "topic", "url",
    ]);
    assert.deepEqual((await d.json("/api/directory/datasets?access=open&sort=name")).datasets.map((x: { id: string }) => x.id), [
      "pride:PXD990005", geo, "pdb-set:doi:10.9999/fixture/4",
    ]);
    assert.equal((await d.json("/api/directory/datasets/" + encodeURIComponent(geo))).dataset.id, geo);
    const listings = await d.json("/api/directory/listings?kind=dataset");
    assert.equal(listings.listings.length, 6);
    assert.ok(listings.listings.every((l: { kind: string }) => l.kind === "dataset"));

    assert.match(await d.text("/sitemap.xml"), /<loc>https:\/\/thevalleydesk.org\/discover\/sitemap\/datasets-1.xml<\/loc>/);
    const part = await d.text("/discover/sitemap/datasets-1.xml");
    assert.match(part, /<url><loc>https:\/\/thevalleydesk.org\/discover\/dataset\/geo%3AGSE990001<\/loc><lastmod>2026-11-20<\/lastmod><\/url>/);
    assert.equal([...part.matchAll(/<url>/g)].length, 6);

    d.sqlite.prepare("INSERT INTO dataset_removals(id) VALUES(?)").run(geo);
    d.refresh();
    assert.equal((await d.get(page(geo))).status, 410);
    assert.match(await d.text(page(geo)), /Dataset removed/);
    const gone = await d.get("/api/directory/datasets/" + encodeURIComponent(geo));
    assert.equal(gone.status, 410);
    assert.deepEqual(await gone.json(), { error: "dataset_removed" });
    assert.doesNotMatch(await d.text("/discover/sitemap/datasets-1.xml"), /GSE990001/);
    assert.equal((await d.json("/api/directory/datasets")).total, 5);
    assert.doesNotMatch(await d.text("/discover/datasets"), /tissue expression atlas/);
    assert.doesNotMatch(await d.text(pubPage("doi:10.9999/fixture/4")), /tissue expression atlas/);

    // The loader keeps a recorded removal out at write time and validates removal IDs.
    const removals = join(d.dir, "removals.json");
    writeFileSync(removals, JSON.stringify(["pride:PXD990005"]));
    d.load("--dataset-removals", removals);
    assert.equal((await d.get(page("pride:PXD990005"))).status, 410);
    writeFileSync(removals, JSON.stringify(["NCT00000001"]));
    assert.throws(() => execFileSync("python3", ["ops/load-research.py", "--dataset-removals", removals], { stdio: "pipe" }));
    const replay = execFileSync("python3", ["ops/load-research.py", "--datasets", fixture, "--respect-removals"], { encoding: "utf8" });
    assert.match(replay, /NOT EXISTS\(SELECT 1 FROM dataset_removals WHERE id IN \('geo:GSE990001'\)\)/);
  } finally {
    d.close();
  }
});

test("the loader emits dataset facets and rejects records outside the contract", () => {
  const sql = execFileSync("python3", ["ops/load-research.py", "--datasets", fixture], { encoding: "utf8" });
  const first = sql.split("\n")[0];
  assert.match(first, /VALUES\('geo:GSE990001','dataset','Fictional Estuary tissue expression atlas','2026-11-20','2026-03-14','Medical imaging','geo:GSE990001'/);
  assert.match(first, /"access":\["open"\],"county":\["camden"\],"datatype":\["gene-expression"\],"institution":\["fixture-institute"\],"label":\["verified"\],"paper":\["doi:10.9999\/fixture\/4"\],"project":\[\],"repository":\["gene-expression-omnibus"\],"topic":\["medical-imaging"\]/);
  assert.match(first, /GSE990001 Gene Expression Omnibus gene expression/);
  const base = JSON.parse(readFileSync(fixture, "utf8").split("\n")[0]);
  const dir = mkdtempSync(join(process.cwd(), "node_modules", ".datasets-loader-"));
  try {
    for (const [why, change] of [
      ["unknown access", { access: "public" }],
      ["unknown data type", { data_type: "genomics" }],
      ["uppercase DOI", { id: "doi:10.99999/Fictional" }],
      ["unsupported prefix", { id: "zenodo:123" }],
      ["plain http", { url: "http://example.org/x" }],
      ["no institution", { institutions: [] }],
      ["bad release", { released: "March 2026" }],
      ["extra field", { doi: "10.1/x" }],
    ] as const) {
      const file = join(dir, "bad.jsonl");
      writeFileSync(file, JSON.stringify({ ...base, ...change }) + "\n");
      assert.throws(() => execFileSync("python3", ["ops/load-research.py", "--datasets", file], { stdio: "pipe" }), undefined, why);
    }
    const missing = { ...base };
    delete missing.license;
    writeFileSync(join(dir, "missing.jsonl"), JSON.stringify(missing) + "\n");
    assert.throws(() => execFileSync("python3", ["ops/load-research.py", "--datasets", join(dir, "missing.jsonl")], { stdio: "pipe" }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const modern = "2026-07-28";
async function tool(env: unknown, name: string, args: Record<string, unknown>) {
  const response = await worker.fetch(
    new Request(origin + "/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": modern,
        "mcp-method": "tools/call",
        "mcp-name": name,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args, _meta: { "io.modelcontextprotocol/protocolVersion": modern, "io.modelcontextprotocol/clientCapabilities": {} } },
      }),
    }),
    env,
    {},
  );
  assert.equal(response.status, 200);
  return (await response.json()).result as { isError?: boolean; structuredContent: any };
}

test("assistant tools search and fetch datasets", async () => {
  const d = directory();
  try {
    assert.equal((await tool(d.env, "search", { kind: "dataset" })).structuredContent.results.length, 0);
    d.sqlite.exec("UPDATE dataset_visibility SET enabled=1");
    d.refresh();
    const found = (await tool(d.env, "search", { kind: "dataset", query: "proteome" })).structuredContent.results;
    assert.deepEqual(found.map((r: { id: string }) => r.id), ["pride:PXD990005"]);
    assert.equal(found[0].access, "Open");
    assert.equal(found[0].repository, "PRIDE");
    assert.equal(found[0].dates.released, "2024-06");
    const byUrl = (await tool(d.env, "fetch", { id: origin + page(geo) })).structuredContent;
    assert.equal(byUrl.id, geo);
    assert.equal(byUrl.metadata.connection_source, "https://example.org/datasets/geo-990001");
    // A bare DOI that is not a publication falls through to the dataset with that DOI.
    assert.equal((await tool(d.env, "fetch", { id: "doi:10.99999/fictional.estuary.scans" })).structuredContent.metadata.access, "Registration");
    assert.equal((await tool(d.env, "fetch", { id: "doi:10.9999/fixture/4" })).structuredContent.metadata.kind, "publication");
  } finally {
    d.close();
  }
});


test("empty enabled dataset collection records the visible-dataset marker", () => {
  const d = directory();
  try {
    d.sqlite.exec("DELETE FROM research_listings WHERE kind='dataset'; UPDATE dataset_visibility SET enabled=1");
    d.refresh();
    const row = d.sqlite.prepare("SELECT first FROM research_summary_kinds WHERE scope_field='visibility' AND kind='dataset'").get() as { first: string };
    assert.equal(row.first, "0");
  } finally { d.close(); }
});

test("pages outside the directory handler offer the same masthead, and a hidden kind leaves it", async () => {
  const d = directory();
  // A path no route claims falls through to the static assets and then the directory's 404 page.
  const missing = async () => (await worker.fetch(new Request(origin + "/no-such-page"), { ...d.env, ASSETS: { fetch: async () => new Response(null, { status: 404 }) } }, {})).text();
  const nav = (html: string) => [...html.match(/<nav class="desk-primary"[^>]*>([\s\S]*?)<\/nav>/)![1].matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]);
  try {
    // The dataset switch is off; the fixture has publications but no clinical studies.
    const off = ["Publications", "Software", "About"];
    assert.deepEqual(nav(await d.text("/discover/works")), off);
    d.queries.length = 0;
    const suggest = await d.text("/discover/suggest");
    assert.deepEqual(nav(suggest), off);
    // The suggest page reads only the per-kind probes, never a listing scan.
    assert.ok(d.queries.length <= 4 && d.queries.every((q) => /LIMIT 1|EXISTS|_visibility WHERE id=1/.test(q)), d.queries.join("\n"));
    assert.deepEqual(nav(await d.text("/discover/connect")), off);
    assert.deepEqual(nav(await missing()), off);

    d.sqlite.exec("UPDATE dataset_visibility SET enabled=1");
    const on = ["Publications", "Software", "Data", "About"];
    for (const path of ["/discover/works", "/discover/suggest", "/discover/connect", ...(supportOpen() ? ["/support"] : [])])
      assert.deepEqual(nav(await d.text(path)), on, path);
    assert.deepEqual(nav(await missing()), on);
    // HEAD reads nothing for the masthead.
    d.queries.length = 0;
    await worker.fetch(new Request(origin + "/discover/suggest", { method: "HEAD" }), d.env, {});
    assert.equal(d.queries.length, 0);
  } finally {
    d.close();
  }
});
