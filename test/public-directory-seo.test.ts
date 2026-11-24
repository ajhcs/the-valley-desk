import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import worker from "../worker.js";

const origin = "https://thevalleydesk.org";

function schemaOf(html: string) {
  const match = /<script id="directory-schema" type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, "JSON-LD present");
  const value = JSON.parse(match[1]);
  assert.equal(value["@context"], "https://schema.org");
  return (value["@graph"] ?? [value]) as Record<string, any>[];
}

test("landing pages answer in computed sentences and carry matching metadata", async () => {
  const dir = mkdtempSync(join(process.cwd(), "node_modules", ".research-seo-"));
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
  const text = async (path: string) => (await get(path)).text();
  try {
    sqlite.exec(readFileSync("ops/directory-removals.sql", "utf8"));
    sqlite.exec(readFileSync("migrations/0046_research_directory.sql", "utf8"));
    const input = join(dir, "papers.jsonl"), refs = join(dir, "refs.json");
    writeFileSync(input, execFileSync("python3", ["ops/research-fixture.py", "--count", "30"]));
    writeFileSync(refs, execFileSync("python3", ["ops/research-fixture.py", "--institutions"]));
    sqlite.exec(execFileSync("python3", ["ops/load-research.py", "--publications", input, "--institutions", refs], { encoding: "utf8" }));
    const works = sqlite.prepare("SELECT count(DISTINCT group_id) n FROM research_visible WHERE kind='publication'").get()!.n as number;

    const institution = await text("/discover/institution/fixture-institute");
    assert.match(institution, new RegExp(`Fictional Estuary Research Institute has ${works} publications`));
    assert.match(institution, /<link rel="canonical" href="https:\/\/thevalleydesk.org\/discover\/institution\/fixture-institute">/);
    assert.match(institution, /<link rel="alternate" type="application\/rss\+xml" title="Additions: Fictional Estuary Research Institute" href="\/discover\/updates.xml\?institution=fixture-institute">/);
    assert.doesNotMatch(institution, /<meta name="robots"/);
    const [collection, crumbs] = schemaOf(institution);
    assert.equal(collection["@type"], "CollectionPage");
    assert.equal(collection.about["@type"], "ResearchOrganization");
    assert.equal(collection.about.location[0].address.addressLocality, "Camden");
    assert.equal(collection.mainEntity.numberOfItems, works);
    assert.equal(collection.mainEntity.itemListElement.length, 24);
    assert.equal(crumbs["@type"], "BreadcrumbList");
    const description = /<meta name="description" content="([^"]+)"/.exec(institution)![1];
    assert.match(description, new RegExp(`has ${works} publications`));

    // An alias or name reaches the same page and names the reference ID as canonical.
    assert.match(await text("/discover/institution/fictional-estuary-research-institute"), /rel="canonical" href="https:\/\/thevalleydesk.org\/discover\/institution\/fixture-institute"/);

    const county = await text("/discover/county/camden");
    assert.match(county, /with a recorded connection to Camden County, New Jersey/);
    assert.equal(schemaOf(county)[0].about["@type"], "AdministrativeArea");

    for (const path of ["/discover/works?q=imaging", "/discover/institution/fixture-institute?page=2", "/discover/works?kind=publication"]) {
      const html = await text(path);
      assert.match(html, /<meta name="robots" content="noindex, follow">/, path);
      schemaOf(html);
    }
    const filtered = await text("/discover/works?q=imaging&county=camden&kind=publication");
    assert.match(filtered, /<h1 class="sr-only">Publications matching “imaging” in Camden County<\/h1>/);
    assert.match(filtered, /rel="canonical" href="https:\/\/thevalleydesk.org\/discover\/works\?county=camden&amp;kind=publication&amp;q=imaging"/);

    const record = JSON.parse(execFileSync("python3", ["ops/research-fixture.py", "--count", "4"], { encoding: "utf8" }).trim().split("\n")[3]);
    const publication = await text("/discover/publication/" + encodeURIComponent(record.id));
    assert.match(publication, /<meta name="citation_title" content="Retracted tissue study 3">/);
    assert.match(publication, /<meta name="citation_doi" content="10.9999\/fixture\/3">/);
    assert.match(publication, /<meta name="citation_publication_date" content="2026\/10">/);
    assert.equal((publication.match(/name="citation_author"/g) ?? []).length, record.authors.length);
    assert.match(publication, /<meta property="og:type" content="article">/);
    const [item, trail] = schemaOf(publication);
    assert.equal(item["@type"], "ItemPage");
    assert.equal(item.mainEntity["@type"], "ScholarlyArticle");
    assert.equal(item.mainEntity.author.length, record.authors.length);
    assert.deepEqual(item.mainEntity.identifier, [{ "@type": "PropertyValue", propertyID: "DOI", value: "10.9999/fixture/3" }]);
    assert.deepEqual(trail.itemListElement.map((c: { name: string }) => c.name), ["Directory", "Medical imaging", "Retracted tissue study 3"]);
    // Only terms that the page shows appear as keywords.
    for (const term of item.mainEntity.keywords ?? []) assert.ok(publication.includes(term), term);

    const home = await text("/");
    const [site, catalog] = schemaOf(home);
    assert.equal(site.potentialAction.target.urlTemplate, origin + "/discover/works?q={search_term_string}");
    assert.equal(catalog["@type"], "DataCatalog");
    assert.match(home, new RegExp(`tally-publication"><a href="/discover/works\\?kind=publication">[\\s\\S]*?<b>${works}</b></span> publications`));
    assert.match(home, /href="\/discover\/institution\/fixture-institute"/);

    const directory = await text("/discover/sitemap/directory.xml");
    assert.match(directory, /<loc>https:\/\/thevalleydesk.org\/discover\/institution\/fixture-institute<\/loc>/);
    assert.match(await text("/discover/sitemap/1.xml"), /<lastmod>2026-11-19<\/lastmod>/);

    const robots = await text("/robots.txt");
    for (const agent of ["*", "OAI-SearchBot", "ClaudeBot", "PerplexityBot", "Google-Extended"]) assert.match(robots, new RegExp(`^User-agent: ${agent.replace("*", "\\*")}$`, "m"));
    assert.doesNotMatch(robots, /^Disallow: \/$/m);
    assert.match(robots, /^Sitemap: https:\/\/thevalleydesk.org\/sitemap.xml$/m);
    const llms = await text("/llms.txt");
    assert.match(llms, /\[Medical imaging\]\(https:\/\/thevalleydesk.org\/discover\/topic\/medical-imaging\)/);
    assert.match(llms, /\[Camden County, NJ\]\(https:\/\/thevalleydesk.org\/discover\/county\/camden\)/);
    assert.match(llms, /Publication JSON/);
  } finally {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
