import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
if (!process.env.TMPDIR) throw new Error("TMPDIR is required for screenshots and reports");
const output = path.join(process.env.TMPDIR, "tvd-watch-blueprint-qa-20260912");
await mkdir(output, { recursive: true });
const url = new URL("../mockups/index.html", import.meta.url).href;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
});
const report = { url, browser: await browser.version(), checks: [], errors: [], externalRequests: [], screenshots: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  await context.route(/^https?:/, async (request) => {
    report.externalRequests.push(request.request().url());
    await request.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(message.text());
  });
  async function check(name, action) {
    await action();
    report.checks.push({ name, passed: true });
  }
  async function go(hash) {
    await page.goto(`${url}#${hash}`);
    await page.waitForFunction(() => document.querySelector("main h1"));
    await settled();
  }
  async function settled() {
    await page.waitForFunction(() => document.querySelector("main").dataset.renderedRoute === location.hash);
  }
  async function screenshot(name, fullPage = true) {
    const file = path.join(output, `${name}.png`);
    await page.screenshot({ path: file, fullPage });
    report.screenshots.push(file);
  }
  const screens = [
    ["policy", "Policy Watch"], ["policy/pa-01", "Clinical AI disclosure proposal"],
    ["policy?view=representatives", "Policy Watch"], ["technology", "Technology Watch"],
    ["technology/orca", "ORCA"], ["news", "News"], ["events", "Events"],
  ];
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    for (const [hash, heading] of screens) {
      await check(`render ${hash} at ${width}px`, async () => {
        await go(hash);
        assert.equal(await page.locator("h1").innerText(), heading);
        assert.match(await page.title(), /The Valley Desk design fixtures/);
        assert.equal(await page.locator("main").evaluate((node) => node.innerText.length > 150), true);
        assert.equal(await page.locator("vite-error-overlay").count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await page.locator(".brand img").evaluate((img) => img.complete && img.naturalWidth > 0), true);
        const outside = await page.locator("main h1, main h2, main h3, main p, main label").evaluateAll((nodes) =>
          nodes.filter((node) => { const box = node.getBoundingClientRect(); return box.left < -1 || box.right > innerWidth + 1; })
            .map((node) => node.textContent));
        assert.deepEqual(outside, []);
      });
      if ([390, 1440].includes(width)) await screenshot(`${hash.replace(/[^a-z0-9]/gi, "-")}-${width}`);
      if (width === 1440 && ["policy", "technology/orca"].includes(hash)) {
        await screenshot(`${hash.replace(/[^a-z0-9]/gi, "-")}-preview`, false);
      }
    }
  }
  await check("PA filter changes results, URL, and survives reload", async () => {
    await go("policy");
    await page.locator('select[name="jurisdiction"]').selectOption("PA");
    await page.waitForURL(/jurisdiction=PA/);
    await settled();
    assert.equal(await page.locator(".result").count(), 1);
    await page.reload();
    await settled();
    assert.equal(await page.locator('select[name="jurisdiction"]').inputValue(), "PA");
    assert.equal(await page.locator(".result").count(), 1);
  });
  await check("search empty state and reset", async () => {
    await page.locator('input[name="q"]').fill("no-match-fixture");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.waitForURL(/q=no-match-fixture/);
    await settled();
    assert.equal(await page.getByRole("heading", { name: "No matching results" }).count(), 1);
    await page.getByRole("link", { name: "Reset filters" }).first().click();
    await settled();
    assert.equal(await page.locator(".result").count(), 5);
  });
  await check("active and agenda views have distinct membership", async () => {
    await page.getByRole("link", { name: "Active Measures", exact: true }).click();
    await settled();
    assert.equal(await page.locator(".result").count(), 4);
    await page.getByRole("link", { name: "Hearings & Deadlines", exact: true }).click();
    await settled();
    assert.equal(await page.locator(".result").count(), 3);
  });
  await check("detail evidence disclosure and browser back", async () => {
    await go("policy");
    await page.locator(".result h2 a").first().click();
    await settled();
    await page.locator("summary").first().click();
    assert.equal(await page.locator("details").first().getAttribute("open"), "");
    await page.goBack();
    await settled();
    assert.equal(await page.locator(".result").count(), 5);
  });
  await check("local saved preference survives reload", async () => {
    const control = page.getByRole("checkbox", { name: "Save Clinical AI disclosure proposal", exact: true });
    await control.check();
    await page.reload();
    await settled();
    assert.equal(await control.isChecked(), true);
    await control.uncheck();
  });
  await check("NJ Assembly has two members; jurisdiction change clears invalid chamber", async () => {
    await go("policy?view=representatives");
    assert.equal(await page.locator(".person").count(), 2);
    assert.equal(await page.locator('select[name="body"]').inputValue(), "Assembly");
    await page.locator('select[name="jurisdiction"]').selectOption("PA");
    await page.waitForURL(/jurisdiction=PA/);
    await settled();
    assert.equal(await page.locator('select[name="body"]').inputValue(), "House");
    assert.equal(await page.locator(".person").count(), 1);
  });
  await check("representative search actually filters", async () => {
    await go("policy?view=representatives");
    await page.locator('input[name="q"]').fill("member B");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.waitForURL(/q=member/);
    await settled();
    assert.equal(await page.locator(".person").count(), 1);
    assert.match(await page.locator(".person").innerText(), /Sample member B/);
  });
  await check("OSS filter excludes ORCA; ORCA has workflow and license links", async () => {
    await go("technology");
    await page.locator('select[name="license"]').selectOption("Open source");
    await page.waitForURL(/license=Open/);
    await settled();
    assert.equal(await page.locator(".result").count(), 1);
    assert.equal(await page.locator('.result a[href="#technology/orca"]').count(), 0);
    await go("technology/orca");
    assert.equal(await page.getByRole("heading", { name: "Documented workflow" }).count(), 1);
    assert.match(await page.getByRole("link", { name: "Primary license" }).getAttribute("href"), /LICENSE.md$/);
  });
  await check("baseline directory does not fabricate latest releases", async () => {
    await go("technology");
    await page.getByRole("link", { name: "Latest Releases", exact: true }).click();
    await settled();
    assert.equal(await page.locator(".result").count(), 0);
    assert.equal(await page.getByRole("heading", { name: "No verified new releases in these fixtures" }).count(), 1);
    await page.getByRole("link", { name: "Papers", exact: true }).click();
    await settled();
    assert.equal(await page.locator(".result").count(), 1);
  });
  await check("event format and cancellation filters", async () => {
    await go("events");
    await page.locator('select[name="format"]').selectOption("Virtual");
    await page.waitForURL(/format=Virtual/);
    await settled();
    assert.equal(await page.locator(".result").count(), 1);
    await go("events?status=Cancelled");
    assert.equal(await page.locator(".result").count(), 1);
    assert.match(await page.locator(".result").innerText(), /original event date/);
  });
  await check("stale, error, retry, and empty remain distinct", async () => {
    await go("policy");
    await page.locator("#fixture-state").selectOption("stale");
    await page.waitForURL(/state=stale/);
    await settled();
    assert.match(await page.locator(".notice").innerText(), /Last accepted sample/);
    assert.equal(await page.locator(".result").count(), 5);
    await screenshot("policy-stale-1440");
    await page.locator("#fixture-state").selectOption("error");
    await page.waitForURL(/state=error/);
    await settled();
    assert.equal(await page.getByRole("heading", { name: "Records unavailable" }).count(), 1);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await settled();
    assert.equal(await page.locator(".result").count(), 5);
    await page.locator("#fixture-state").selectOption("empty");
    await page.waitForURL(/state=empty/);
    await settled();
    assert.equal(await page.getByRole("heading", { name: "No matching results" }).count(), 1);
  });
  await check("skip link focuses main without breaking hash routing", async () => {
    await page.goto("about:blank");
    await go("policy");
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(".skip").evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("main").evaluate((node) => node === document.activeElement), true);
    assert.equal(await page.locator("h1").innerText(), "Policy Watch");
  });
  await check("no console errors or external requests", async () => {
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.externalRequests, []);
  });
  await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ passed: report.checks.length, browser: report.browser, report: path.join(output, "report.json"), screenshots: report.screenshots.length }));
} finally {
  await browser.close();
}
