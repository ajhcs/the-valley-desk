import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeReviewQueue, queueItemIds } from "../src/ingest/queue.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const queuePath = join(root, "data/review-queue.json");

function publishedIds() {
  try {
    const catalog = JSON.parse(readFileSync(join(root, "src/content/published-catalog.json"), "utf8"));
    return new Set(catalog.filter((i) => i.status === "published").map((i) => i.id));
  } catch {
    return new Set();
  }
}

export function readQueue() {
  try {
    return JSON.parse(readFileSync(queuePath, "utf8"));
  } catch {
    return { items: [] };
  }
}

export function writeQueue(doc, incoming, extra = {}) {
  mkdirSync(join(root, "data"), { recursive: true });
  const existing = queueItemIds(doc);
  const items = mergeReviewQueue(existing, incoming, publishedIds());
  const next = { ...doc, ...extra, items };
  writeFileSync(queuePath, JSON.stringify(next, null, 2) + "\n");
  return items;
}
