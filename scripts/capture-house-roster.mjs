import { realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { collectHouseRoster } from "../src/ingest/house-representative-collection.ts";

if (process.argv.length !== 3 || !isAbsolute(process.argv[2]))
  throw Error("Usage: node --import tsx/esm scripts/capture-house-roster.mjs EXISTING_ABSOLUTE_SCRATCH_DIRECTORY");
const root = await realpath("/mnt/d/tmp/plumbob"), directory = await realpath(process.argv[2]);
if (!directory.startsWith(root + "/")) throw Error("Capture directory must be mounted task scratch");
const { xml, observation } = await collectHouseRoster();
await writeFile(join(directory, "house.xml"), xml, { mode: 0o600, flag: "wx" });
await writeFile(join(directory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { mode: 0o600, flag: "wx" });
console.log(JSON.stringify({ directory, retrievedAt: observation.retrievedAt, rawSha256: observation.rawSha256,
  memberCount: observation.members.length, sourceLastUpdated: observation.sourceLastUpdated, acceptance: observation.acceptance }));
