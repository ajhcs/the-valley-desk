import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const items = JSON.parse(readFileSync(join(root, "fixtures/catalog.json"), "utf8"));
const published = items.filter((item) => item.status === "published");
const updated = published.reduce((max, item) => (item.updatedAt > max ? item.updatedAt : max), "2026-08-22T20:14:00.000Z");
const doc = {
  product: "the-valley-desk",
  version: "1",
  generatedAt: updated,
  items: published,
};
mkdirSync(join(root, "public"), { recursive: true });
writeFileSync(join(root, "public/feed.json"), JSON.stringify(doc, null, 2) + "\n");
console.log("wrote public/feed.json (" + published.length + " published items)");
