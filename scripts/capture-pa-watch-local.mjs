#!/usr/bin/env node
// Exact candidate pages only; no enrollment, database, model or publication.
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { captureLaunchCandidate } from "./lib/watch-source-preparation.ts";
import { sleep } from "../src/ingest/upstream.ts";

const { values } = parseArgs({ options: { out: { type: "string" } } });
if (!values.out) throw Error("--out requires an existing private task directory");
const directory = realpathSync(values.out), root = realpathSync("/workspace/build/builderbob");
if (!directory.startsWith(root + "/")) throw Error("Output must be outside the checkout in BuilderBob workspace build storage");
for (const bill of ["hb1925", "hb1993", "sb1113", "hb2787"]) {
  if (bill !== "hb1925") await sleep(1000);
  const startedAt = new Date().toISOString();
  const result = await captureLaunchCandidate("candidate-pa-" + bill);
  const stem = bill + "-" + randomUUID(), bodyFile = result.bytes ? stem + ".html" : null;
  if (bodyFile) writeFileSync(join(directory, bodyFile), result.bytes, { flag: "wx", mode: 0o600 });
  const { bytes: _bytes, ...receipt } = result;
  const path = join(directory, stem + ".json");
  writeFileSync(path, JSON.stringify({ ...receipt, startedAt, finishedAt: new Date().toISOString(), bodyFile }, null, 2) + "\n",
    { flag: "wx", mode: 0o600 });
  process.stdout.write(JSON.stringify({ sourceId: result.sourceId, outcome: result.outcome, httpStatus: result.httpStatus ?? null,
    access: result.access.disposition, receipt: path }) + "\n");
}
