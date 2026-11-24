import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import worker from "../worker.js";
import { limits, toolDefinitions } from "../src/assistant/tools";
import { maxRequestBytes } from "../src/assistant/mcp";

const origin = "https://thevalleydesk.org";
const modern = "2026-07-28";
const meta = { "io.modelcontextprotocol/protocolVersion": modern, "io.modelcontextprotocol/clientCapabilities": {} };
const removedProject = "474026";
const keptProject = "565526";

function directory(study?: object) {
  const sqlite = new DatabaseSync(":memory:");
  const db = {
    prepare(sql: string) {
      const all = (...args: (number | string)[]) => ({ results: sqlite.prepare(sql).all(...args) });
      return { all: () => all(), bind: (...args: (number | string)[]) => ({ all: () => all(...args) }) };
    },
  };
  const env: Record<string, unknown> = {
    DIRECTORY_PUBLIC_ENABLED: "true",
    PUBLICATIONS_PUBLIC_ENABLED: "true",
    VALLEY_DESK_DB: db,
  };
  const dir = mkdtempSync(join(process.cwd(), "node_modules", ".assistant-test-"));
  const load = (...args: string[]) =>
    sqlite.exec(execFileSync("python3", ["ops/load-research.py", ...args], { encoding: "utf8", maxBuffer: 1 << 28 }));
  sqlite.exec(readFileSync("ops/directory-removals.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0046_research_directory.sql", "utf8"));
  const papers = join(dir, "papers.jsonl");
  const refs = join(dir, "refs.json");
  const fixture = execFileSync("python3", ["ops/research-fixture.py", "--count", "30"], { encoding: "utf8" });
  writeFileSync(papers, fixture);
  writeFileSync(refs, execFileSync("python3", ["ops/research-fixture.py", "--institutions"]));
  load("--publications", papers, "--institutions", refs, "--projects", "src/content/public-directory-projects.json");
  if (study) {
    sqlite.exec(readFileSync("migrations/0047_clinical_studies.sql", "utf8"));
    const studies = join(dir, "studies.jsonl");
    writeFileSync(studies, JSON.stringify(study) + "\n");
    load("--studies", studies);
  }
  const removePublication = (id: string) => {
    const file = join(dir, "removed.json");
    writeFileSync(file, JSON.stringify([id]));
    load("--removals", file);
  };
  const records = fixture.trim().split("\n").map((line) => JSON.parse(line));
  return { sqlite, env, records, removePublication, close: () => rmSync(dir, { recursive: true, force: true }) };
}

test("clinical studies honor staged visibility, show registry evidence and disappear on removal", async () => {
  const id = "NCT00000001";
  const source = "https://clinicaltrials.gov/study/" + id;
  const study = {
    id, title: "Example cardiac care study", type: "OBSERVATIONAL", status: "COMPLETED", phases: [],
    first_posted: "2026-01-05", last_updated: "2026-11-18", conditions: ["Cardiac disease"],
    sites: [{ facility: "Example clinic", city: "Philadelphia", state: "PA", zip: "19104",
              county: "Philadelphia", status: "ACTIVE_NOT_RECRUITING" }],
    institutions: [], counties: ["Philadelphia"], source, url: source, label: "Verified",
    connection: "ClinicalTrials.gov lists a study site in the Delaware Valley.",
    added: "2026-11-21", checked: "2026-11-21",
  };
  const { env, sqlite, close } = directory(study);
  try {
    const detail = "/discover/study/" + id;
    assert.equal((await get(env, detail)).status, 404);
    assert.match(await (await get(env, "/discover/works?kind=study")).text(), /No matching listings/);
    sqlite.exec("UPDATE study_visibility SET enabled=1");
    sqlite.exec(readFileSync("ops/research-summary.sql", "utf8"));
    const html = await (await get(env, detail)).text();
    assert.match(html, /Example clinic.*Philadelphia County.*Active not recruiting/);
    assert.match(html, /<dt>Overall status<\/dt><dd>Completed<\/dd>/);
    assert.match(html, /clinicaltrials\.gov\/study\/NCT00000001/);
    assert.equal((await (await get(env, "/api/directory/studies/" + id)).json()).study.id, id);
    assert.equal((await (await get(env, "/api/directory/studies?q=cardiac")).json()).total, 1);
    assert.match(await (await get(env, "/discover/new?kind=study")).text(), /Example cardiac care study/);
    assert.match(await (await get(env, "/discover/updates.xml?kind=study")).text(), new RegExp(detail));
    assert.match(await (await get(env, "/sitemap.xml")).text(), /studies-1.xml/);
    assert.match(await (await get(env, "/discover/sitemap/studies-1.xml")).text(), new RegExp(detail));
    assert.equal((await call(env, "search", { kind: "study" })).structuredContent.results[0].id, id);
    assert.equal((await call(env, "fetch", { id: origin + detail })).structuredContent.metadata.connection_source, source);
    sqlite.prepare("INSERT INTO study_removals(id) VALUES(?)").run(id);
    sqlite.exec(readFileSync("ops/research-summary.sql", "utf8"));
    assert.equal((await get(env, detail)).status, 410);
    assert.equal((await get(env, "/api/directory/studies/" + id)).status, 410);
    assert.doesNotMatch(await (await get(env, "/sitemap.xml")).text(), /studies-1.xml/);
    assert.equal((await call(env, "search", { kind: "study" })).structuredContent.results.length, 0);
  } finally {
    close();
  }
});

type Rpc = { status: number; body: any; headers: Headers };
async function post(env: unknown, body: unknown, headers: Record<string, string> = {}): Promise<Rpc> {
  const response = await worker.fetch(
    new Request(origin + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    env,
    {},
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}
const rpc = (env: unknown, method: string, params: Record<string, unknown> = {}) =>
  post(
    env,
    { jsonrpc: "2.0", id: 7, method, params: { ...params, _meta: meta } },
    { "mcp-protocol-version": modern, "mcp-method": method, ...(params.name ? { "mcp-name": String(params.name) } : {}) },
  );
async function call(env: unknown, name: string, args: Record<string, unknown> = {}) {
  const { status, body } = await rpc(env, "tools/call", { name, arguments: args });
  assert.equal(status, 200);
  assert.equal(body.result.resultType, "complete");
  const result = body.result;
  if (!result.isError) assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  return result as { isError: boolean; content: { text: string }[]; structuredContent: any };
}
const get = (env: unknown, path: string, method = "GET") => worker.fetch(new Request(origin + path, { method }), env, {});

test("protocol: stateless modern requests, legacy handshake and transport rules", async () => {
  const { env, close } = directory();
  try {
    const discover = await rpc(env, "server/discover");
    assert.equal(discover.status, 200);
    assert.deepEqual(discover.body.result.supportedVersions, [modern]);
    assert.equal(discover.body.result.resultType, "complete");
    assert.equal(discover.body.result._meta["io.modelcontextprotocol/serverInfo"].name, "the-valley-desk");
    assert.equal(discover.headers.get("cache-control"), "no-store");
    assert.equal(discover.headers.get("access-control-allow-origin"), "*");
    assert.equal(discover.headers.get("mcp-session-id"), null);

    const list = await rpc(env, "tools/list");
    assert.equal(list.body.result.cacheScope, "public");
    assert.equal(list.body.result.ttlMs, 0);
    assert.deepEqual(
      list.body.result.tools.map((tool: { name: string }) => tool.name),
      ["search", "fetch", "whats_new", "list_institutions", "list_topics_and_counties"],
    );
    for (const tool of list.body.result.tools) {
      assert.deepEqual(
        { ...tool.annotations, title: undefined },
        { title: undefined, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      );
      assert.deepEqual(tool._meta.securitySchemes, [{ type: "noauth" }]);
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert.ok(tool.outputSchema && tool.description && tool.title);
      // No tool gathers one person's work.
      assert.doesNotMatch(Object.keys(tool.inputSchema.properties).join(" "), /author|person|owner|orcid/i);
    }

    // Legacy clients: initialize, initialized notification, then calls without sessions.
    const init = await post(env, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    });
    assert.equal(init.body.result.protocolVersion, "2025-06-18");
    assert.equal(init.body.result.resultType, undefined);
    assert.equal(init.headers.get("mcp-session-id"), null);
    const future = await post(env, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01" } });
    assert.equal(future.body.result.protocolVersion, "2025-11-25");
    const notified = await post(env, { jsonrpc: "2.0", method: "notifications/initialized" });
    assert.equal(notified.status, 202);
    assert.equal(notified.body, null);
    const legacyList = await post(env, { jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-protocol-version": "2025-06-18" });
    assert.equal(legacyList.body.result.tools.length, 5);
    assert.equal(legacyList.body.result.ttlMs, undefined);
    assert.deepEqual((await post(env, { jsonrpc: "2.0", id: 3, method: "ping" })).body.result, {});
    const legacyUnknown = await post(env, { jsonrpc: "2.0", id: 4, method: "prompts/list" });
    assert.deepEqual([legacyUnknown.status, legacyUnknown.body.error.code], [200, -32601]);

    // Modern validation.
    const unknown = await rpc(env, "prompts/list");
    assert.deepEqual([unknown.status, unknown.body.error.code], [404, -32601]);
    const mismatch = await post(
      env,
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: {}, _meta: meta } },
      { "mcp-protocol-version": modern, "mcp-method": "tools/call", "mcp-name": "fetch" },
    );
    assert.deepEqual([mismatch.status, mismatch.body.error.code], [400, -32020]);
    const encoded = await post(
      env,
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: {}, _meta: meta } },
      { "mcp-protocol-version": modern, "mcp-method": "tools/call", "mcp-name": "=?base64?" + btoa("search") + "?=" },
    );
    assert.equal(encoded.status, 200);
    const noHeader = await post(env, { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: meta } });
    assert.deepEqual([noHeader.status, noHeader.body.error.code], [400, -32020]);
    const noMeta = await post(env, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { "mcp-protocol-version": modern, "mcp-method": "tools/list" });
    assert.deepEqual([noMeta.status, noMeta.body.error.code], [400, -32602]);
    const old = await post(
      env,
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: { ...meta, "io.modelcontextprotocol/protocolVersion": "1900-01-01" } } },
      { "mcp-protocol-version": "1900-01-01", "mcp-method": "tools/list" },
    );
    assert.deepEqual([old.status, old.body.error.code], [400, -32022]);
    assert.ok(old.body.error.data.supported.includes(modern));
    const unknownTool = await rpc(env, "tools/call", { name: "delete_everything", arguments: {} });
    assert.equal(unknownTool.body.error.code, -32602);

    // Transport rules.
    for (const method of ["GET", "DELETE", "PUT"]) {
      const response = await get(env, "/mcp", method);
      assert.equal(response.status, 405);
      assert.equal(response.headers.get("allow"), "POST, OPTIONS");
    }
    const preflight = await get(env, "/mcp", "OPTIONS");
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get("access-control-allow-headers")!, /mcp-protocol-version/);
    assert.equal((await post(env, "{", {})).body.error.code, -32700);
    assert.equal((await post(env, [{ jsonrpc: "2.0", id: 1, method: "ping" }])).status, 400);
    assert.equal((await post(env, { jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "not a url" })).status, 403);
    assert.equal((await post(env, { jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://claude.ai" })).status, 200);
    assert.equal((await post(env, { jsonrpc: "2.0", id: 1, method: "ping" }, { "content-type": "text/plain" })).status, 415);
    assert.equal((await post(env, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(maxRequestBytes) } }))).status, 413);

    // Optional rate limiter binding.
    let allowed = true;
    const limited = { ...env, MCP_RATE_LIMITER: { limit: async () => ({ success: allowed }) } };
    assert.equal((await rpc(limited, "tools/call", { name: "search", arguments: {} })).status, 200);
    allowed = false;
    assert.equal((await rpc(limited, "tools/call", { name: "search", arguments: {} })).status, 429);
  } finally {
    close();
  }
});

test("tools: search, fetch, whats_new and the list tools return labelled public records", async () => {
  const { env, records, close } = directory();
  try {
    const all = (await call(env, "search")).structuredContent;
    assert.equal(all.page_size, 24);
    assert.equal(all.results.length, 24);
    assert.equal(all.total_records, 3466 + 30);
    assert.equal(all.total_pages, Math.ceil(3496 / 24));
    for (const item of all.results) {
      assert.match(item.url, /^https:\/\/thevalleydesk\.org\/discover\/(work|publication)\//);
      assert.match(item.label, /^(Verified|Listed)$/);
      assert.deepEqual(Object.keys(item.dates).filter((key) => !["published", "pushed", "added"].includes(key)), []);
      assert.equal(item.authors, undefined);
      assert.equal(item.byline, undefined);
    }
    const papers = (await call(env, "search", { query: "imaging atlas", kind: "publication", county: "camden county", institution: "Fictional Estuary Research Institute", topic: "Medical imaging", label: "Verified", sort: "title" })).structuredContent;
    assert.ok(papers.results.length > 0);
    for (const item of papers.results) {
      assert.equal(item.kind, "publication");
      assert.equal(item.label, "Verified");
      assert.deepEqual(item.institutions, ["Fictional Estuary Research Institute"]);
      assert.deepEqual(item.counties, ["Camden"]);
      assert.ok(item.dates.published && item.dates.added && !item.dates.pushed);
    }
    assert.deepEqual(papers.results.map((item: { title: string }) => item.title), papers.results.map((item: { title: string }) => item.title).sort((a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" })));
    assert.match(papers.browse_url, /^https:\/\/thevalleydesk\.org\/discover\/works\?/);

    const projects = (await call(env, "search", { query: "gene ontology", kind: "project" })).structuredContent;
    const goatools = projects.results.find((item: { id: string }) => item.id === removedProject);
    assert.equal(goatools.title, "GOATOOLS");
    assert.equal(goatools.url, origin + "/discover/work/" + removedProject);
    assert.equal(goatools.label, "Verified");
    assert.ok(goatools.how_to_use.some((step: { command?: string }) => step.command === "git clone https://github.com/tanghaibao/goatools.git"));
    assert.deepEqual(goatools.dates, { pushed: "2026-11-02", added: "2026-11-18" });

    // Date ranges: published or pushed date, and date added.
    const october = (await call(env, "search", { kind: "publication", date_from: "2026-10", date_to: "2026-10" })).structuredContent;
    assert.ok(october.results.length > 0);
    assert.ok(october.results.every((item: any) => item.dates.published.startsWith("2026-10")));
    const year = (await call(env, "search", { kind: "publication", date_from: "2026", date_to: "2026", sort: "date" })).structuredContent;
    assert.equal(year.total_records, 30);
    const old = (await call(env, "search", { kind: "project", date_to: "2012", sort: "date" })).structuredContent;
    assert.ok(old.results.length > 0 && old.results.every((item: any) => item.dates.pushed < "2013"));
    assert.equal((await call(env, "search", { added_from: "2026-11-19", added_to: "2026-11-19" })).structuredContent.total_records, 30);
    assert.equal((await call(env, "search", { added_from: "2027" })).structuredContent.total_records, 0);

    const fresh = (await call(env, "whats_new", { since: "2026-11-19" })).structuredContent;
    assert.equal(fresh.total_records, 30);
    assert.ok(fresh.results.every((item: any) => item.dates.added >= "2026-11-19"));
    assert.match(fresh.browse_url, /\/discover\/new\?added_from=2026-11-19$/);
    assert.equal((await call(env, "whats_new", { since: "2026-11-18", kind: "project", page: 2 })).structuredContent.page, 2);
    assert.match((await call(env, "whats_new", {})).content[0].text, /since is required/);
    assert.match((await call(env, "whats_new", { since: "2026-11" })).content[0].text, /YYYY-MM-DD/);

    const long = records[0];
    const paper = (await call(env, "fetch", { id: long.id })).structuredContent;
    assert.equal(paper.id, long.id);
    assert.equal(paper.title, "Imaging methods for tissue maps 0");
    assert.equal(paper.url, origin + "/discover/publication/" + encodeURIComponent(long.id));
    assert.equal(paper.metadata.kind, "publication");
    assert.equal(paper.metadata.label, "Verified");
    assert.deepEqual(paper.metadata.dates, { published: "2026-10", added: "2026-11-19" });
    assert.deepEqual(paper.metadata.projects, [origin + "/discover/work/617168725"]);
    assert.equal(paper.metadata.author_count, 400);
    assert.match(paper.text, /label: Verified/);
    assert.equal((await call(env, "fetch", { id: paper.url })).structuredContent.id, long.id);
    const many = (await call(env, "fetch", { id: records[4].id })).structuredContent;
    assert.equal(many.metadata.byline.length, limits.bylineNames);
    assert.equal(many.metadata.author_count, 400);
    const preprint = (await call(env, "fetch", { id: "arxiv:9901.00002" })).structuredContent;
    assert.equal(preprint.metadata.published_as, origin + "/discover/publication/pmid%3A990000001");
    const project = (await call(env, "fetch", { id: removedProject })).structuredContent;
    assert.equal(project.metadata.kind, "project");
    assert.equal(project.metadata.code, "https://github.com/tanghaibao/goatools");
    assert.deepEqual(project.metadata.how_to_use, goatools.how_to_use);
    assert.deepEqual(project.metadata.dates, { pushed: "2026-11-02", added: "2026-11-18" });
    assert.equal(project.metadata.owner, undefined);
    assert.equal((await call(env, "fetch", { id: origin + "/discover/work/" + removedProject })).structuredContent.id, removedProject);
    assert.match((await call(env, "fetch", { id: "doi:10.0000/absent" })).content[0].text, /No directory record/);
    assert.match((await call(env, "fetch", { id: "https://example.org/discover/work/1" })).content[0].text, /thevalleydesk\.org/);
    assert.match((await call(env, "fetch", {})).content[0].text, /id is required/);

    const { institutions } = (await call(env, "list_institutions")).structuredContent;
    const estuary = institutions.find((entry: { id: string }) => entry.id === "fixture-institute");
    assert.deepEqual(estuary, {
      id: "fixture-institute",
      name: "Fictional Estuary Research Institute",
      counties: ["Camden"],
      url: origin + "/discover/institution/fixture-institute",
      listings: 30,
    });
    assert.ok(institutions.find((entry: { name: string }) => entry.name === "Drexel University").listings > 0);
    const places = (await call(env, "list_topics_and_counties")).structuredContent;
    assert.equal(places.counties.length, 9);
    assert.deepEqual(places.counties.find((county: { name: string }) => county.name === "Camden").state, "NJ");
    assert.ok(places.counties.find((county: { name: string }) => county.name === "Camden").listings >= 15);
    const imaging = places.topics.find((topic: { name: string }) => topic.name === "Medical imaging");
    assert.equal(imaging.url, origin + "/discover/topic/medical-imaging");
    assert.ok(imaging.listings > 30);
  } finally {
    close();
  }
});

test("removed records never appear and unreadable removal state fails closed", async () => {
  const { sqlite, env, records, removePublication, close } = directory();
  const everything = async () => {
    const outputs = [];
    for (const [name, args] of [
      ["search", {}],
      ["search", { query: "gene ontology enrichment" }],
      ["search", { query: "imaging", kind: "publication" }],
      ["whats_new", { since: "2026-01-01" }],
      ["whats_new", { since: "2026-11-19" }],
      ["fetch", { id: removedProject }],
      ["fetch", { id: keptProject }],
      ["fetch", { id: records[0].id }],
      ["fetch", { id: "arxiv:9901.00002" }],
      ["list_institutions", {}],
      ["list_topics_and_counties", {}],
    ] as const) outputs.push(await call(env, name, args));
    return outputs;
  };
  try {
    const before = JSON.stringify(await everything());
    assert.ok(before.includes("GOATOOLS") && before.includes("Imaging methods for tissue maps 0"));
    const countBefore = (await call(env, "search", {})).structuredContent.total_records;

    sqlite.prepare("INSERT INTO public_directory_removals(github_id) VALUES(?)").run(removedProject);
    removePublication(records[0].id);
    removePublication("pmid:990000001");
    const after = await everything();
    const serialized = JSON.stringify(after);
    after.forEach((result, index) => {
      const output = JSON.stringify(result);
      const leak = /GOATOOLS|goatools|Imaging methods for tissue maps 0\b/.exec(output);
      assert.ok(!leak, `call ${index} leaked: ${leak && output.slice(Math.max(0, leak.index - 200), leak.index + 100)}`);
    });
    assert.ok(!serialized.includes(records[0].id));
    assert.ok(!serialized.includes("pmid%3A990000001"), "a removed version is not linked from its preprint");
    assert.equal((await call(env, "search", {})).structuredContent.total_records, countBefore - 3);
    for (const id of [removedProject, records[0].id, origin + "/discover/work/" + removedProject]) {
      const gone = await call(env, "fetch", { id });
      assert.equal(gone.isError, true);
      assert.equal(gone.structuredContent, undefined);
      assert.match(gone.content[0].text, /removed from the directory/);
    }
    assert.equal((await call(env, "fetch", { id: keptProject })).isError, false);

    // Fail closed: every tool refuses, with no record data, when either removal table is unreadable.
    // Keep the visibility view pointing at the original table names while they are missing.
    sqlite.exec("PRAGMA legacy_alter_table=ON");
    for (const table of ["publication_removals", "public_directory_removals"]) {
      sqlite.exec(`ALTER TABLE ${table} RENAME TO ${table}_lost`);
      for (const result of await everything()) {
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent, undefined);
        assert.equal(result.content.length, 1);
        assert.match(result.content[0].text, /temporarily unavailable\. No records were returned/);
      }
      sqlite.exec(`ALTER TABLE ${table}_lost RENAME TO ${table}`);
      assert.equal((await call(env, "search", {})).isError, false);
    }
    const missing = { ...env, VALLEY_DESK_DB: undefined };
    for (const name of ["search", "list_institutions", "list_topics_and_counties"]) {
      assert.equal((await call(missing, name, {})).isError, true);
    }
    assert.equal((await call(missing, "fetch", { id: keptProject })).isError, true);
    const invalid = { ...env, VALLEY_DESK_DB: { prepare: () => ({ all: async () => ({ results: [{ github_id: 5 }] }) }) } };
    assert.match((await call(invalid, "search", {})).content[0].text, /temporarily unavailable/);
  } finally {
    close();
  }
});

test("caps on pages, inputs and response size", async () => {
  const { env, close } = directory();
  const saved = limits.resultBytes;
  try {
    const refused = async (name: string, args: Record<string, unknown>, pattern: RegExp) => {
      const result = await call(env, name, args);
      assert.equal(result.isError, true, JSON.stringify(args));
      assert.match(result.content[0].text, pattern);
    };
    await refused("search", { page: limits.maxPage + 1 }, /whole number from 1 to 1000/);
    await refused("search", { page: 0 }, /whole number/);
    await refused("search", { page: 1.5 }, /whole number/);
    await refused("search", { query: "x".repeat(limits.queryLength + 1) }, /at most 200 characters/);
    await refused("search", { institution: "x".repeat(limits.filterLength + 1) }, /at most 180/);
    await refused("search", { kind: "person" }, /must be one of: project, publication/);
    await refused("search", { county: "Kings" }, /must be one of: Bucks/);
    await refused("search", { sort: "stars" }, /must be one of/);
    await refused("search", { date_from: "last week" }, /YYYY, YYYY-MM or YYYY-MM-DD/);
    await refused("search", { date_to: "2026-13" }, /YYYY/);
    await refused("search", { author: "Invented Byline 1" }, /Unknown argument "author"/);
    await refused("search", { limit: 500 }, /Unknown argument "limit"/);
    await refused("search", { query: 12 }, /must be a string/);
    await refused("list_institutions", { q: "x" }, /Unknown argument/);
    assert.equal((await rpc(env, "tools/call", { name: "search", arguments: "imaging" })).body.result.isError, true);

    // Author names are not searchable.
    assert.equal((await call(env, "search", { query: "Invented Byline" })).structuredContent.total_records, 0);

    const last = (await call(env, "search", { page: limits.maxPage })).structuredContent;
    assert.equal(last.page, last.total_pages);
    assert.ok(last.results.length <= limits.pageSize);

    const full = await call(env, "search", {});
    assert.ok(new TextEncoder().encode(JSON.stringify(full.structuredContent)).length <= saved);
    assert.equal(full.structuredContent.truncated, undefined);
    limits.resultBytes = 3000;
    const small = (await call(env, "search", {})).structuredContent;
    assert.equal(small.truncated, true);
    assert.ok(small.results.length >= 1 && small.results.length < 24);
    assert.ok(new TextEncoder().encode(JSON.stringify(small)).length <= 3000 + 20);
    assert.equal((await call(env, "list_institutions")).structuredContent.truncated, true);
  } finally {
    limits.resultBytes = saved;
    close();
  }
});

test("publications switched off: projects only, catalog counts, no silent date filter", async () => {
  const { sqlite, env, close } = directory();
  try {
    env.PUBLICATIONS_PUBLIC_ENABLED = "false";
    const all = (await call(env, "search", {})).structuredContent;
    assert.equal(all.total_records, 3466);
    assert.ok(all.results.every((item: { kind: string }) => item.kind === "project"));
    assert.equal((await call(env, "search", { kind: "publication" })).structuredContent.total_records, 0);
    assert.equal((await call(env, "fetch", { id: "arxiv:9901.00002" })).isError, true);
    assert.match((await call(env, "search", { date_to: "2012" })).content[0].text, /Date filters are unavailable/);
    const { institutions } = (await call(env, "list_institutions")).structuredContent;
    assert.ok(!JSON.stringify(institutions).includes("Estuary"));
    assert.ok(institutions.find((entry: { name: string }) => entry.name === "Drexel University").listings > 0);
    const places = (await call(env, "list_topics_and_counties")).structuredContent;
    assert.equal(places.counties.length, 9);
    const imaging = places.topics.find((topic: { name: string }) => topic.name === "Medical imaging").listings;
    sqlite.prepare("INSERT INTO public_directory_removals(github_id) VALUES(?)").run("1655476");
    assert.equal((await call(env, "list_topics_and_counties")).structuredContent.topics.find((topic: { name: string }) => topic.name === "Medical imaging").listings, imaging - 1);
    assert.equal((await call(env, "fetch", { id: "1655476" })).isError, true);
  } finally {
    close();
  }
});

test("discovery: connect page, server card, llms.txt, sitemap, methodology and domain verification", async () => {
  const { env, close } = directory();
  try {
    const page = await get(env, "/discover/connect");
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy")!, /script-src 'self'/);
    const html = await page.text();
    assert.match(html, /<link rel="canonical" href="https:\/\/thevalleydesk\.org\/discover\/connect">/);
    assert.match(html, /claude mcp add --transport http valley-desk https:\/\/thevalleydesk\.org\/mcp/);
    for (const tool of toolDefinitions) assert.ok(html.includes(`<code>${tool.name}</code>`));
    assert.match(html, /id="privacy"/);
    assert.doesNotMatch(html.replace(/<script src="\/[a-z-]+\.js"( defer)?><\/script>/g, "").replace(/<script id="directory-schema"[^]*?<\/script>/, ""), /<script/);
    assert.equal((await get(env, "/discover/connect/")).status, 200);
    assert.equal(await (await get(env, "/discover/connect", "HEAD")).text(), "");
    assert.equal((await get(env, "/discover/connect", "POST")).status, 405);

    const card = await get(env, "/mcp/server-card");
    assert.equal(card.headers.get("content-type"), "application/mcp-server-card+json");
    assert.equal(card.headers.get("cache-control"), "public, max-age=3600");
    const cardBody = await card.json();
    assert.deepEqual(cardBody.remotes[0], { type: "streamable-http", url: origin + "/mcp", supportedProtocolVersions: [modern, "2025-11-25", "2025-06-18", "2025-03-26"] });
    assert.ok(cardBody.description.length <= 100);

    const llms = await (await get(env, "/llms.txt")).text();
    assert.match(llms, /\[MCP server\]\(https:\/\/thevalleydesk\.org\/mcp\)/);
    assert.match(llms, /https:\/\/thevalleydesk\.org\/discover\/connect/);
    assert.match(await (await get(env, "/discover/sitemap/directory.xml")).text(), /<loc>https:\/\/thevalleydesk\.org\/discover\/connect<\/loc>/);
    assert.match(await (await get(env, "/discover/methodology")).text(), /href="\/discover\/connect"/);
    assert.match(await (await get(env, "/discover/works")).text(), /<script src="\/webmcp\.js" defer><\/script>/);

    const terms = await get(env, "/discover/terms");
    assert.equal(terms.status, 200);
    assert.match(await terms.text(), /<h1>Terms of use<\/h1>/);
    assert.equal((await get(env, "/.well-known/openai-apps-challenge")).status, 404);
    const verified = await get({ ...env, OPENAI_APPS_CHALLENGE: " token-From_portal.123 " }, "/.well-known/openai-apps-challenge");
    assert.equal(verified.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(await verified.text(), "token-From_portal.123");
    assert.equal((await get({ ...env, OPENAI_APPS_CHALLENGE: "<script>" }, "/.well-known/openai-apps-challenge")).status, 404);
  } finally {
    close();
  }
});

test("WebMCP script registers the server's tools and is inert without the API", async () => {
  const { env, close } = directory();
  const source = readFileSync("public/webmcp.js", "utf8");
  try {
    assert.doesNotMatch(source, /https?:\/\/(?!thevalleydesk)/, "first-party only");
    let fetched = 0;
    const fetchWorker = (path: string, init: RequestInit) => {
      fetched += 1;
      return worker.fetch(new Request(origin + path, init), env, {});
    };
    vm.runInNewContext(source, { document: {}, navigator: {}, fetch: fetchWorker });
    assert.equal(fetched, 0);

    const registered: any[] = [];
    const done = new Promise<void>((resolve) => {
      const modelContext = {
        registerTool: async (tool: any) => {
          registered.push(tool);
          if (registered.length === toolDefinitions.length) resolve();
        },
      };
      vm.runInNewContext(source, { document: { modelContext }, navigator: {}, fetch: fetchWorker });
    });
    await done;
    assert.deepEqual(registered.map((tool) => tool.name), toolDefinitions.map((tool) => tool.name));
    for (const tool of registered) {
      assert.match(tool.name, /^[A-Za-z0-9_.-]{1,128}$/);
      assert.ok(tool.description && tool.inputSchema.type === "object");
      assert.equal(tool.annotations.readOnlyHint, true);
    }
    const search = registered.find((tool) => tool.name === "search");
    const output = await search.execute({ query: "GOATOOLS", kind: "project" }, { signal: new AbortController().signal });
    assert.equal(output.results[0].url, origin + "/discover/work/" + removedProject);
    await assert.rejects(registered.find((tool) => tool.name === "fetch").execute({ id: "doi:10.0000/absent" }, {}), /No directory record/);
  } finally {
    close();
  }
});

test("regional-data MCP discovery and input validation follow its visibility gate", async () => {
  const { env, sqlite, close } = directory();
  try {
    sqlite.exec("CREATE TABLE regional_data_visibility (id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL); INSERT INTO regional_data_visibility VALUES (1,0)");
    const searchDefinition = async () => (await rpc(env, "tools/list")).body.result.tools.find((t: {name: string}) => t.name === "search");
    assert.ok(!(await searchDefinition()).inputSchema.properties.kind.enum.includes("regional-data"));
    assert.equal((await call(env, "search", { kind: "regional-data" })).isError, true);
    sqlite.exec("UPDATE regional_data_visibility SET enabled=1");
    const enabled = await searchDefinition();
    assert.ok(enabled.inputSchema.properties.kind.enum.includes("regional-data"));
    assert.ok(enabled.outputSchema.properties.results.items.oneOf[1].properties.kind.const === "regional-data");
    assert.match(enabled.description, /regional data resources/);
    assert.match(enabled.description, /geographic coverage/);
    sqlite.exec("DROP TABLE regional_data_visibility");
    assert.ok(!(await searchDefinition()).inputSchema.properties.kind.enum.includes("regional-data"));
  } finally { close(); }
});

test("regional discovery metadata distinguishes the resource page and API", async () => {
  const { regionalDataLlms, regionalDataSchema } = await import("../src/ingest/regional-data-surfaces");
  const record = {
    id: "regional:example", title: "Example", summary: "Public data", publisher: "Agency", portal: "Portal",
    url: "https://example.org/query", topic: "Health", counties: ["Philadelphia"], granularity: "County",
    time_span: "2020/2025", update_cadence: "Annual", access: "open" as const, license: null,
    formats: ["CSV"], api: null, how_to_use: { step: "Query", url: "https://example.org/help", caveats: [], citation: "Cite agency" },
    added: "2026-11-01", checked: "2026-11-02",
  };
  const schema = regionalDataSchema(record, origin);
  assert.equal(schema.sameAs, record.url);
  assert.equal(schema.distribution, undefined);
  assert.ok(schema.additionalProperty.some((p) => p.name === "formats"));
  assert.equal(regionalDataSchema({ ...record, api: { url: "https://example.org/api", type: "JSON" } }, origin).distribution?.[0].contentUrl, "https://example.org/api");
  assert.match(regionalDataLlms(origin), /\/discover\/datasets\?kind=regional-data/);
  assert.match(regionalDataLlms(origin), /\/api\/directory\/regional-data/);
});
