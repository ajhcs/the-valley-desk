import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const items = JSON.parse(readFileSync(join(root, "fixtures/catalog.json"), "utf8"));

function citationUrl(item) {
  return item.source?.url || item.citations?.[0]?.url || "";
}

const publishedCited = items.filter(
  (item) => item.status === "published" && citationUrl(item),
);

const updated = publishedCited.reduce(
  (max, item) => (item.updatedAt > max ? item.updatedAt : max),
  "2026-08-22T20:14:00.000Z",
);

const doc = {
  product: "the-valley-desk",
  version: "1",
  generatedAt: updated,
  items: publishedCited,
};

function esc(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const rssItems = publishedCited
  .map((item) => {
    const link = citationUrl(item);
    const description = item.impactSentence || item.dek || "";
    const pub = item.publishedAt || item.updatedAt;
    return `    <item>
      <title>${esc(item.title)}</title>
      <link>${esc(link)}</link>
      <guid isPermaLink="true">${esc(link)}</guid>
      <description>${esc(description)}</description>
      <pubDate>${new Date(pub).toUTCString()}</pubDate>
    </item>`;
  })
  .join("\n");

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>The Valley Desk</title>
    <link>https://thevalleydesk.org/</link>
    <description>Local health-tech news for people and agents</description>
    <lastBuildDate>${new Date(updated).toUTCString()}</lastBuildDate>
${rssItems}
  </channel>
</rss>
`;

mkdirSync(join(root, "public"), { recursive: true });
writeFileSync(join(root, "public/feed.json"), JSON.stringify(doc, null, 2) + "\n");
writeFileSync(join(root, "public/feed.xml"), rss);
console.log("wrote public/feed.json and public/feed.xml (" + publishedCited.length + " cited published items)");
