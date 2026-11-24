import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../worker.js";
import { modernVersion } from "../src/assistant/mcp";
import { regionalDataApi, regionalDataPath, type RegionalData } from "../src/ingest/regional-data-contract";

import { html } from "../src/ingest/public-directory-ui";

const origin = "https://thevalleydesk.org";
const seedPath = "scripts/regional-data/seed.json";
const summaryPath = "ops/research-summary.sql";

test("the reviewed seed reaches the public Worker surfaces with the same record fields", async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());

  sqlite.exec(readFileSync("ops/directory-removals.sql", "utf8"));
  for (const migration of [
    "0046_research_directory",
    "0047_clinical_studies",
    "0048_paper_repository_links",
    "0050_datasets",
    "0052_regional_data",
  ]) {
    sqlite.exec(readFileSync(`migrations/${migration}.sql`, "utf8"));
  }
  const load = execFileSync("python3", ["-B", "ops/load-research.py", "--regional-data", seedPath, "--respect-removals"], { encoding: "utf8" });
  sqlite.exec(load);
  const seed: RegionalData[] = JSON.parse(readFileSync(seedPath, "utf8"));
  const env = {
    DIRECTORY_PUBLIC_ENABLED: "true",
    PUBLICATIONS_PUBLIC_ENABLED: "true",
    VALLEY_DESK_DB: {
      prepare(sql: string) {
        const all = (...args: (string | number)[]) => ({ results: sqlite.prepare(sql).all(...args) });
        return { all: () => all(), bind: (...args: (string | number)[]) => ({ all: () => all(...args) }) };
      },
    },
  };
  const get = (path: string) => worker.fetch(new Request(origin + path), env, {});
  async function rpc(method: string, params: Record<string, unknown> = {}) {
    const headers: Record<string, string> = {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-method": method,
      "mcp-protocol-version": modernVersion,
    };
    if (typeof params.name === "string") headers["mcp-name"] = params.name;
    const body = JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method,
      params: {
        ...params,
        _meta: { "io.modelcontextprotocol/protocolVersion": modernVersion, "io.modelcontextprotocol/clientCapabilities": {} },
      },
    });
    const response = await worker.fetch(new Request(origin + "/mcp", { method: "POST", headers, body }), env, {});
    assert.equal(response.status, 200);
    return (await response.json()).result;
  }

  const [first] = seed;
  assert.ok(first);
  const detail = regionalDataPath(first.id);
  const apiDetail = regionalDataApi + "/" + encodeURIComponent(first.id);
  const searchTools = () => rpc("tools/list");
  const call = (name: string, args: Record<string, unknown>) => rpc("tools/call", { name, arguments: args });
  assert.equal((await get(detail)).status, 404);
  assert.equal((await get(apiDetail)).status, 404);
  assert.doesNotMatch(JSON.stringify(await searchTools()), /regional-data/);

  sqlite.exec("UPDATE regional_data_visibility SET enabled=1");
  sqlite.exec(readFileSync(summaryPath, "utf8"));
  assert.match(JSON.stringify(await searchTools()), /regional-data/);
  assert.match(await (await get("/")).text(), /<a href="\/discover\/datasets">Data<\/a>/);
  for (const record of seed) {
    const path = regionalDataPath(record.id);
    const response = await get(path);
    assert.equal(response.status, 200, record.id);
    const body = await response.text();
    assert.match(body, /How to use/i);
    for (const value of [
      record.title, record.summary, record.publisher, record.portal, record.checked, record.added,
      record.url, record.how_to_use.step, record.how_to_use.url, record.how_to_use.citation,
      ...record.counties, ...record.how_to_use.caveats, record.api?.url, record.api?.type,
    ]) {
      if (value) assert.ok(body.includes(html(value)), `${record.id}: ${value}`);
    }
    const script = /<script id="directory-schema" type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(body);
    assert.ok(script, record.id);
    const structured = JSON.parse(script[1]);
    const dataset = (structured["@graph"] ?? [structured]).find((item: Record<string, unknown>) => item["@type"] === "Dataset");
    assert.ok(dataset, record.id);
    assert.equal(dataset.identifier, record.id);
    assert.equal(dataset.name, record.title);
    assert.equal(dataset.description, record.summary);
    assert.equal(dataset.publisher.name, record.publisher);
    assert.equal(dataset.includedInDataCatalog.name, record.portal);
    assert.equal(dataset.sameAs, record.url);
    assert.deepEqual(dataset.spatialCoverage.map((place: { name: string }) => place.name), record.counties);
    const extra = new Map(dataset.additionalProperty.map(({ name, value }: { name: string; value: unknown }) => [name, value]));
    assert.equal(extra.get("metadata reviewed"), record.checked);
    assert.equal(extra.get("source availability checked"), record.checked);
    assert.equal(extra.get("how to use"), record.how_to_use.step);
    assert.equal(extra.get("guidance URL"), record.how_to_use.url);
    assert.equal(extra.get("citation guidance"), record.how_to_use.citation);
    assert.deepEqual(extra.get("caveats"), record.how_to_use.caveats);
    assert.equal(dataset.temporalCoverage ?? null, record.time_span);
    if (record.api) assert.ok(dataset.distribution.some((item: { contentUrl: string }) => item.contentUrl === record.api!.url));

    const json = await get(regionalDataApi + "/" + encodeURIComponent(record.id));
    assert.equal(json.status, 200, record.id);
    assert.deepEqual((await json.json()).regional_data, { ...record, metadata_reviewed: record.checked, papers: [] });
    const tool = await call("fetch", { id: origin + path });
    assert.equal(tool.isError, false, record.id);
    assert.deepEqual(tool.structuredContent.metadata, { ...record, metadata_reviewed: record.checked, papers: [], kind: "regional-data" });
  }

  const browse = await get("/discover/datasets?kind=regional-data");
  assert.equal(browse.status, 200);
  assert.match(await browse.text(), /Regional data/);
  const llms = await (await get("/llms.txt")).text();
  assert.match(llms, /\/discover\/datasets\?kind=regional-data/);
  for (const record of seed) assert.ok(llms.includes(origin + regionalDataPath(record.id)), record.id);
  assert.match(await (await get("/sitemap.xml")).text(), /regional-data-1\.xml/);
  assert.ok((await (await get("/discover/sitemap/regional-data-1.xml")).text()).includes(detail));
  assert.ok((await (await get("/discover/updates.xml?kind=regional-data")).text()).includes(detail));
  const search = await call("search", { kind: "regional-data" });
  assert.equal(search.isError, false);
  assert.equal(search.structuredContent.total_records, seed.length);

  // A stale summary must be safe immediately after the switch changes.
  sqlite.exec("UPDATE regional_data_visibility SET enabled=0");
  assert.equal((await get(detail)).status, 404);
  assert.equal((await get(apiDetail)).status, 404);
  assert.doesNotMatch(JSON.stringify(await searchTools()), /regional-data/);
  for (const path of ["/discover/datasets", "/api/directory/listings", "/llms.txt", "/sitemap.xml", "/discover/updates.xml"]) {
    assert.doesNotMatch(await (await get(path)).text(), /regional-data|regional:/, path);
  }
  // With no other datasets public, the masthead drops Data along with the regional records.
  assert.doesNotMatch(await (await get("/")).text(), /href="\/discover\/datasets"/);
});
