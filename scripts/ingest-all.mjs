import { runIngestAll } from "../src/ingest/run-all.ts";
import { readQueue, writeQueue } from "./ingest-queue.mjs";

const fetchedAt = new Date().toISOString();
const env = {
  X_BEARER_TOKEN: process.env.X_BEARER_TOKEN,
  LINKEDIN_TOKEN: process.env.LINKEDIN_TOKEN,
};
const run = await runIngestAll(env, new Date(fetchedAt));
const incoming = [...run.rss, ...run.events, ...run.social];
const itemsOut = writeQueue(readQueue(), incoming, {
  fetchedAt: run.fetchedAt,
  working: { adapter: "rss", count: run.notes.rss },
  events: { adapter: "events", count: run.notes.events },
  social: { linkedin: run.notes.linkedin, x: run.notes.x },
});
console.log("ingest-all", JSON.stringify(run.notes));
console.log("wrote data/review-queue.json", itemsOut.length, "items");
