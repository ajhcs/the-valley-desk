import { ingestEvents } from "../src/ingest/events.ts";
import { readQueue, writeQueue } from "./ingest-queue.mjs";

const fetchedAt = new Date().toISOString();
const items = await ingestEvents(new Date(fetchedAt));
const events = {
  adapter: "events",
  count: items.length,
  published: items.filter((i) => i.status === "published").length,
};
const itemsOut = writeQueue(readQueue(), items, { fetchedAt, events });
console.log("ingested events", events.count, "published", events.published);
console.log("wrote data/review-queue.json", itemsOut.length, "items");
