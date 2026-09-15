import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SENATE_ROSTER_URL, parseSenateRoster } from "../src/ingest/representative-collection.ts";
import { readBoundedText } from "../src/ingest/upstream.ts";
if (process.argv.length !== 3) throw new Error("Usage: node --import tsx/esm scripts/capture-representative-roster.mjs OUTPUT_DIRECTORY");
const directory = resolve(process.argv[2]);
const response = await fetch(SENATE_ROSTER_URL, { redirect: "error", signal: AbortSignal.timeout(15000) });
if (!response.ok) throw new Error("Official Senate HTTP " + response.status);
const xml = await readBoundedText(response, 500000);
const capturedAt = new Date().toISOString();
const observation = await parseSenateRoster(xml, capturedAt);
await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(resolve(directory, "senate.xml"), xml, { mode: 0o600, flag: "wx" });
await writeFile(resolve(directory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { mode: 0o600, flag: "wx" });
console.log(JSON.stringify({ capturedAt, rawSha256: observation.rawSha256, memberCount: observation.members.length,
  sourceLastUpdated: observation.sourceLastUpdated, acceptance: observation.acceptance, directory }));
