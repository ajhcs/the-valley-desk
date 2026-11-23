import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { handleSupport, supportContent } from "../src/ingest/public-support";
import { supportersBand } from "../src/ingest/public-support-band";
import { isListed, listedSupporters, supportData, supportOpen, type SupportData } from "../src/ingest/public-support-data";
import worker from "../worker.js";

const origin = "https://thevalleydesk.org";
const closed = { personYear: null, personFounder: null, institutionYear: null, institutionFounder: null };
const base: SupportData = {
  checkout: {
    personYear: "https://buy.stripe.com/py", personFounder: "https://buy.stripe.com/pf",
    institutionYear: "https://buy.stripe.com/iy", institutionFounder: "https://buy.stripe.com/if",
  },
  prices: { personYear: 50, personFounder: 250, institutionYear: 500, institutionFounder: 2500 },
  inKindEmail: "clyons@ajhcs.org",
  supporters: [],
  unnamed: 0,
};
const now = new Date("2027-06-01T12:00:00Z");

test("support stays unpublished until a checkout link is set", async () => {
  assert.equal(supportOpen({ ...base, checkout: closed }), false);
  assert.equal(supportOpen({ ...base, checkout: { ...closed, personYear: "http://insecure.example/pay", institutionYear: "javascript:alert(1)" } }), false);
  assert.equal(supportOpen({ ...base, checkout: { ...closed, institutionFounder: "https://buy.stripe.com/x" } }), true);
  assert.equal(supportersBand({ ...base, checkout: closed, supporters: [{ name: "A B", tier: "founder", since: "2026-12-01" }] }, now), "");
});

test("the shipped checkout links are live Stripe Payment Links and publish the page", async () => {
  for (const link of Object.values(supportData.checkout)) assert.match(link ?? "", /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+$/);
  assert.equal(supportOpen(supportData), true);
  const env = { DIRECTORY_PUBLIC_ENABLED: "true", ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
  const response = await worker.fetch(new Request(origin + "/support"), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  const page = await response.text();
  for (const link of Object.values(supportData.checkout)) assert.ok(page.includes(`href="${link}"`));
});

test("founders stay listed; a 12-month gift ends on its anniversary", () => {
  assert.equal(isListed({ name: "A", tier: "founder", since: "2020-01-01" }, now), true);
  assert.equal(isListed({ name: "A", tier: "in-kind", since: "2020-01-01" }, now), true);
  assert.equal(isListed({ name: "A", tier: "year", since: "2026-06-02" }, now), true);
  assert.equal(isListed({ name: "A", tier: "year", since: "2026-06-01" }, now), false);
  assert.equal(isListed({ name: "A", tier: "year", since: "not a date" }, now), false);
  assert.equal(isListed({ name: "  ", tier: "founder", since: "2026-06-01" }, now), false);
});

test("people sort by surname and institutions by name, within each group", () => {
  const { founders, supporters, partners } = listedSupporters({
    ...base,
    supporters: [
      { name: "Zoe Adams", tier: "founder", since: "2026-12-01" },
      { name: "The Wistar Institute", kind: "institution", tier: "founder", since: "2026-12-01" },
      { name: "Ann Young", tier: "founder", since: "2026-12-01" },
      { name: "Drexel University", kind: "institution", tier: "year", since: "2026-12-01" },
      { name: "Data Co-op", kind: "institution", tier: "in-kind", since: "2026-12-01" },
    ],
  }, now);
  assert.deepEqual(founders.map((s) => s.name), ["Zoe Adams", "The Wistar Institute", "Ann Young"]);
  assert.deepEqual(supporters.map((s) => s.name), ["Drexel University"]);
  assert.deepEqual(partners.map((s) => s.name), ["Data Co-op"]);
});

test("the footer band escapes names, links only HTTPS, credits gifts and shows no amounts", () => {
  const band = supportersBand({
    ...base,
    supporters: [
      { name: "<b>Ann</b> Young", tier: "founder", since: "2026-12-01", url: "https://ann.example/" },
      { name: "Drexel University", kind: "institution", tier: "year", since: "2026-12-01", url: "javascript:alert(1)" },
      { name: "Grace Tobin", tier: "year", since: "2026-12-01", givenBy: "Sam & Lee" },
      { name: "Data Co-op", kind: "institution", tier: "in-kind", since: "2026-12-01" },
    ],
    unnamed: 4,
  }, now);
  assert.ok(band.includes("&lt;b&gt;Ann&lt;/b&gt; Young") && !band.includes("<b>Ann</b>"));
  assert.match(band, /<a class="patron-link" href="https:\/\/ann.example\/" rel="sponsored noopener">/);
  assert.doesNotMatch(band, /javascript:/);
  assert.match(band, /class="patron is-institution">Drexel University/);
  assert.match(band, /gift of Sam &amp; Lee/);
  assert.match(band, />Founding supporters</);
  assert.match(band, />Supporters</);
  assert.match(band, />In-kind partners</);
  assert.match(band, /…and 4 others who asked not to be named/);
  assert.doesNotMatch(band, /\$\d/);
  assert.match(supportersBand(base, now), /The first names will appear here/);
});

test("the support page offers each priced option with a link, and gifts in kind", () => {
  const page = supportContent({ ...base, checkout: { ...base.checkout, institutionYear: null } });
  assert.match(page, /\$2,500/);
  assert.match(page, /\$250/);
  assert.match(page, /\$50</);
  assert.doesNotMatch(page, /\$500</, "an option without a checkout link is not offered");
  assert.match(page, /aria-label="Give \$2,500 as an institution founding supporter"/);
  assert.match(page, /href="mailto:clyons@ajhcs.org\?subject=Gift%20in%20kind%20for%20The%20Valley%20Desk"/);
  assert.doesNotMatch(page, /Where it goes/);
});

test("support answers GET and HEAD only", async () => {
  const head = handleSupport(new Request(origin + "/support", { method: "HEAD" }), origin, undefined, base);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(handleSupport(new Request(origin + "/support", { method: "POST" }), origin, undefined, base).status, 405);
});

test("the committed skyline art matches its generator", () => {
  execFileSync(process.execPath, ["scripts/build-footer-art.mjs", "--check"], { stdio: "pipe" });
});
