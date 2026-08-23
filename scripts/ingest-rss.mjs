import { ingestRss } from "../src/ingest/rss.ts";
import { readQueue, writeQueue } from "./ingest-queue.mjs";

const fetchedAt = new Date().toISOString();
const items = await ingestRss(new Date(fetchedAt));
const working = { adapter: "rss", count: items.length };
const itemsOut = writeQueue(readQueue(), items, { fetchedAt, working });
console.log("working RSS", JSON.stringify(working));
console.log("wrote data/review-queue.json", itemsOut.length, "items");
