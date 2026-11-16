import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../worker.js";
import { createCatalogNavigationBoundary } from "../src/lib/catalog-navigation";

const template = '<!doctype html><html lang="en"><head><title>The Valley Desk</title></head><body><noscript id="tvd-primary">Legacy fallback</noscript><div id="root"></div></body></html>';
function fixture(flag: unknown = undefined) {
  const assets: string[] = [];
  const env = { DISCOVERY_PILOT_ENABLED: flag, PUBLIC_ORIGIN: "https://thevalleydesk.org", ASSETS: {
    async fetch(input: URL | Request) {
      const path = new URL(input instanceof Request ? input.url : input).pathname;
      assets.push(path);
      return new Response(path === "/index.html" ? template : "Missing asset", { status: path === "/index.html" ? 200 : 404 });
    },
  }, VALLEY_DESK_DB: new Proxy({}, { get() { throw new Error("Pilot must not read D1"); } }) };
  return { assets, env };
}
const invoke = (path: string, env: ReturnType<typeof fixture>["env"], method = "GET") => worker.fetch(new Request(`https://thevalleydesk.org${path}`, { method }), env, {});

test("pilot Worker routes default closed for page/API, methods and aliases", async () => {
  for (const flag of [undefined, false, true, "false", "TRUE", " true "]) {
    const { env, assets } = fixture(flag);
    for (const path of ["/discover", "/discover/", "/api/discovery-pilot", "/api/discovery-pilot/"]) {
      for (const method of ["GET", "HEAD", "POST"]) {
        const response = await invoke(`${path}?unknown=1`, env, method);
        assert.equal(response.status, 404, `${String(flag)} ${method} ${path}`);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.match(response.headers.get("x-robots-tag") ?? "", /\bnoindex\b/);
        const text = await response.text();
        assert.doesNotMatch(text, /catalogSha256|PennLINC|AutoGVP|Crossref/);
        if (method === "HEAD") assert.equal(text, "");
      }
    }
    assert.deepEqual(assets, []);
  }
  const { env } = fixture();
  for (const path of ["/%64iscover", "/discover%2f", "/api/%64iscovery-pilot", "/api/discovery-pilot%2f", "/%61pi/discovery-pilot"]) {
    const response = await invoke(path, env);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(await response.text(), /catalogSha256|PennLINC|AutoGVP|Crossref/);
  }
});

test("enabled pilot page is noindex/no-store and uses only its finite metadata API", async () => {
  const { env, assets } = fixture("true");
  const response = await invoke("/discover?kind=publication&q=Naqvi", env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
  assert.equal(response.headers.get("x-robots-tag"), "noindex");
  const html = await response.text();
  assert.match(html, /Health-tech research · The Valley Desk/);
  assert.match(html, /1 of 28 selected records/);
  assert.match(html, /doi\.org\/10\.1093\/bioinformatics\/btae114/);
  assert.match(html, /current employment is not established/);
  assert.doesNotMatch(html, /Legacy fallback|application\/ld\+json|__VALLEY_DESK_RUNTIME_ITEMS__|\.discovery-work|\/workspace\//);
  assert.deepEqual(assets, ["/index.html"]);
  assert.match(response.headers.get("content-security-policy") ?? "", /script-src/);
  for (const path of ["/discover/", "/api/discovery-pilot/"]) {
    const head = await invoke(path, env, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  }
});

test("pilot methods and invalid filters fail before reading HTML assets", async () => {
  const { env, assets } = fixture("true");
  for (const path of ["/discover", "/api/discovery-pilot"]) {
    const response = await invoke(path, env, "POST");
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
    for (const search of ["?unknown=1", "?q=one&q=two", "?sort=relevance", "?kind=person", "?q=" + "a".repeat(161)]) {
      const bad = await invoke(path + search, env);
      assert.equal(bad.status, 400, path + search.slice(0, 70));
      assert.doesNotMatch(await bad.text(), /catalogSha256|PennLINC|AutoGVP|one|two|aaaaaa/);
    }
  }
  assert.deepEqual(assets, []);
});

test("pilot shell failure is a fixed unavailable response instead of a successful blank page", async () => {
  const { env } = fixture("true");
  env.ASSETS.fetch = async () => new Response("private-sentinel", { status: 503 });
  const response = await invoke("/discover", env);
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Directory unavailable/);
});

test("returning from pilot to the legacy catalog refreshes its document", () => {
  const boundary = createCatalogNavigationBoundary("/discover");
  assert.equal(boundary.shouldReload("/news"), true);
  assert.equal(boundary.shouldReload("/events"), true);
  assert.equal(boundary.shouldReload("/discover"), false);
  assert.equal(boundary.shouldReload("/news", true), false);
});
