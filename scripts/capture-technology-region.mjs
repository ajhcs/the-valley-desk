import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { endpointRobotsPolicy } from "./lib/watch-source-preparation.ts";
import { technologyRegionalSources } from "../src/ingest/technology-source-plans.ts";
import { fetchUpstream, SOURCE_USER_AGENT, UpstreamError, sleep } from "../src/ingest/upstream.ts";
import { sha256 } from "../src/content/watch-schema.ts";

const [mode, flag, directory] = process.argv.slice(2);
if (mode !== "--capture" || flag !== "--out" || !directory || !isAbsolute(directory))
  throw Error("Use --capture --out /absolute/mounted/output");
await mkdir(directory, { recursive: true });
for (const [entityId, source] of Object.entries(technologyRegionalSources)) {
  const options = { fetchImpl: fetch, maxBytes: 1000000, timeoutMs: 15000, attempts: 1,
    allowedRedirectHosts: new Set(), maxRedirects: 0, requiresAuth: false,
    headers: { "user-agent": SOURCE_USER_AGENT, accept: "text/html" } };
  let access;
  try {
    const robots = await fetchUpstream({ ...options, url: new URL("/robots.txt", source.url).href, maxBytes: 256000 });
    access = { ...endpointRobotsPolicy(robots.body, source.url), robotsStatus: robots.status,
      robotsSha256: await sha256(robots.body), robotsText: robots.body };
  } catch (error) {
    access = { disposition: error instanceof UpstreamError && error.httpStatus === 404 ? "robots-not-found" : "robots-unavailable",
      robotsStatus: error instanceof UpstreamError ? error.httpStatus ?? null : null, delayMs: 1000 };
  }
  if (!["robots-endpoint-allowed", "robots-not-found"].includes(access.disposition)) {
    await writeFile(resolve(directory, entityId + ".held.json"), JSON.stringify({ source, access }, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ entityId, outcome: access.disposition }));
    continue;
  }
  for (let index = 1; index <= 2; index++) {
    await sleep(access.delayMs);
    const response = await fetchUpstream({ ...options, url: source.url });
    if (!response.body.includes(source.quote)) throw Error("regional-location-evidence-changed:" + entityId);
    const capture = { url: source.url, checkedAt: new Date().toISOString(), body: response.body };
    await writeFile(resolve(directory, entityId + "." + index + ".capture.json"), JSON.stringify(capture, null, 2), { flag: "wx" });
    await writeFile(resolve(directory, entityId + "." + index + ".receipt.json"),
      JSON.stringify({ entityId, access, representationSha256: await sha256(response.body), checkedAt: capture.checkedAt }, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ entityId, capture: index, checkedAt: capture.checkedAt, bytes: Buffer.byteLength(response.body) }));
  }
}
