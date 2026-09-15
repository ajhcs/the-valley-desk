import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readBoundedText } from "../src/ingest/upstream.ts";
import { parseDelawareIntroducedPolicy, parseFederalRegisterPolicy, materializePolicyCapture } from "../src/ingest/policy-watch-native.ts";
const [kind, directory] = process.argv.slice(2);
const definitions = {
  de: { url: "https://legis.delaware.gov/json/JsonFeed/IntroducedLegislation", sourceId: "de-introduced-native", label: "Delaware General Assembly introduced legislation" },
  fr: { url: "https://www.federalregister.gov/api/v1/documents/2025-15492.json", sourceId: "federal-register-native", label: "Federal Register API" },
};
const config = definitions[kind];
if (!config || !directory || process.argv.length !== 4) throw new Error("Usage: node --import tsx/esm scripts/capture-policy-native.mjs de|fr OUTPUT_DIRECTORY");
const response = await fetch(config.url, { redirect: "error", signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error("Official native source HTTP " + response.status);
const raw = await readBoundedText(response, 3_000_000);
const data = JSON.parse(raw), retrievedAt = new Date().toISOString();
const source = { sourceId: config.sourceId, sourceUrl: config.url, sourceLabel: config.label, retrievedAt };
const selected = kind === "de" ? data.Items?.find(item => item.Title === "SB 360") : data;
if (!selected) throw new Error("Selected source record unavailable");
const parsed = kind === "de" ? parseDelawareIntroducedPolicy(selected, source) : parseFederalRegisterPolicy(selected, source);
const material = await materializePolicyCapture(parsed);
await mkdir(resolve(directory), { recursive: true, mode: 0o700 });
await writeFile(resolve(directory, "source.json"), raw, { flag: "wx", mode: 0o600 });
await writeFile(resolve(directory, "capture.json"), JSON.stringify(parsed, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ sourceUrl: config.url, retrievedAt, identity: parsed.identity, evidenceCount: material.evidence.length,
  acceptance: "unreviewed", directory: resolve(directory) }));
