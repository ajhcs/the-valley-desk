import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import worker from "../worker.js";

const origin = "https://thevalleydesk.org";

class MemoryCache {
  entries = new Map<string, Response>();
  puts = 0;
  async match(request: Request) {
    const hit = this.entries.get(request.url);
    return hit?.clone();
  }
  async put(request: Request, response: Response) {
    assert.match(response.headers.get("cache-control") ?? "", /^public, max-age=\d+$/);
    assert.equal(response.headers.get("vary"), null);
    this.puts++;
    this.entries.set(request.url, response.clone());
  }
}

test("directory responses are cached per data version and stay correct after removals", async () => {
  const dir = mkdtempSync(join(process.cwd(), "node_modules", ".directory-cache-"));
  const sqlite = new DatabaseSync(":memory:");
  let queries = 0;
  const env = {
    DIRECTORY_PUBLIC_ENABLED: "true",
    PUBLICATIONS_PUBLIC_ENABLED: "true",
    BUILD_SHA: "test-build",
    VALLEY_DESK_DB: {
      prepare(sql: string) {
        const all = (...args: (number | string)[]) => {
          queries++;
          return { results: sqlite.prepare(sql).all(...args) };
        };
        return { all: () => all(), bind: (...args: (number | string)[]) => ({ all: () => all(...args) }) };
      },
    },
  };
  const cache = new MemoryCache();
  const previous = (globalThis as { caches?: unknown }).caches;
  (globalThis as { caches?: unknown }).caches = { default: cache };
  const get = (path: string, init?: RequestInit) => worker.fetch(new Request(origin + path, init), env, {});
  try {
    sqlite.exec(readFileSync("ops/directory-removals.sql", "utf8"));
    sqlite.exec(readFileSync("migrations/0046_research_directory.sql", "utf8"));
    sqlite.exec(readFileSync("migrations/0047_clinical_studies.sql", "utf8"));
    sqlite.exec(readFileSync("migrations/0050_datasets.sql", "utf8"));
    sqlite.exec(readFileSync("migrations/0051_paper_data_reuse.sql", "utf8"));
    const input = join(dir, "papers.jsonl"), refs = join(dir, "refs.json");
    writeFileSync(input, execFileSync("python3", ["ops/research-fixture.py", "--count", "30"], { maxBuffer: 1 << 26 }));
    writeFileSync(refs, execFileSync("python3", ["ops/research-fixture.py", "--institutions"]));
    sqlite.exec(execFileSync("python3", ["ops/load-research.py", "--publications", input, "--institutions", refs], { encoding: "utf8", maxBuffer: 1 << 26 }));
    sqlite.exec(readFileSync("ops/research-summary.sql", "utf8"));

    // A miss renders and stores; a repeat is served from the cache with one small query.
    const first = await get("/discover/works?q=tissue");
    assert.equal(first.headers.get("x-directory-cache"), "miss");
    const firstHtml = await first.text();
    assert.equal(cache.puts, 1);
    queries = 0;
    const second = await get("/discover/works?q=tissue");
    assert.equal(second.headers.get("x-directory-cache"), "hit");
    assert.equal(queries, 1, "a hit reads only the data version");
    const secondHtml = await second.text();
    assert.equal(second.headers.get("cache-control"), "no-store", "visitors still get the original cache policy");

    // Each response carries its own nonce, in the CSP header and in the page.
    const nonceOf = (response: Response) => /'nonce-([^']+)'/.exec(response.headers.get("content-security-policy") ?? "")?.[1];
    const n1 = nonceOf(first), n2 = nonceOf(second);
    assert.ok(n1 && n2 && n1 !== n2);
    assert.ok(firstHtml.includes(`nonce="${n1}"`));
    assert.ok(secondHtml.includes(`nonce="${n2}"`) && !secondHtml.includes(n1));
    assert.equal(secondHtml.replaceAll(n2, "N"), firstHtml.replaceAll(n1, "N"));

    sqlite.exec("INSERT INTO paper_data_reuse VALUES('doi:10.9999/fixture/4','geo:GSE990001','GSE990001')");
    assert.equal((await get("/discover/works?q=tissue")).headers.get("x-directory-cache"), "miss", "reuse changes invalidate the cache");

    // A removal changes the version, so the next request renders without the removed record.
    const id = "doi:10.9999/fixture/4";
    const path = "/discover/publication/" + encodeURIComponent(id);
    assert.equal((await get(path)).status, 200);
    assert.equal((await get(path)).headers.get("x-directory-cache"), "hit");
    sqlite.prepare("INSERT INTO publication_removals(id) VALUES(?)").run(id);
    assert.equal((await get(path)).status, 410);
    const search = await get("/discover/works?q=tissue");
    assert.equal(search.headers.get("x-directory-cache"), "miss");
    assert.ok(!(await search.text()).includes(`/discover/publication/${encodeURIComponent(id)}"`));
    sqlite.prepare("INSERT INTO public_directory_removals(github_id) VALUES('474026')").run();
    assert.equal((await get("/discover/works?q=tissue")).headers.get("x-directory-cache"), "miss", "project removals change the version");

    // A data refresh changes the version too.
    await get("/discover/works?q=tissue");
    sqlite.exec("UPDATE research_summary_kinds SET n=n+1 WHERE scope_field='' AND kind='publication'");
    assert.equal((await get("/discover/works?q=tissue")).headers.get("x-directory-cache"), "miss");

    // Errors and HEAD requests are not cached; the fragment variant has its own entry.
    const before = cache.puts;
    assert.equal((await get("/discover/publication/doi%3A10.9999%2Fnope")).status, 404);
    await get("/discover/works?q=tissue", { method: "HEAD" });
    assert.equal(cache.puts, before);
    const fragment = await get("/discover/works?q=tissue", { headers: { "X-Valley-Desk-Fragment": "results" } });
    assert.equal(fragment.headers.get("x-directory-cache"), "miss");

    // Without a readable version the cache is skipped and the page still renders.
    sqlite.exec("DROP TABLE research_summary_kinds");
    const uncached = await get("/discover/works?q=tissue");
    assert.equal(uncached.status, 200);
    assert.equal(uncached.headers.get("x-directory-cache"), null);
  } finally {
    (globalThis as { caches?: unknown }).caches = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
