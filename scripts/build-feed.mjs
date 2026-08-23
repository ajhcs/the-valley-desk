import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const items = JSON.parse(readFileSync(join(root, "fixtures/catalog.json"), "utf8"));

const SITE = "https://thevalleydesk.org";
const NEWS_PERMALINK_KINDS = new Set(["news", "policy", "ai", "interview"]);

function canonicalPath(item) {
  if (item.kind === "event") return "/events/" + item.slug;
  if (NEWS_PERMALINK_KINDS.has(item.kind)) return "/news/" + item.slug;
  if (item.kind === "voice") return "/voices/" + item.slug;
  if (item.kind === "briefing") return "/briefing/" + item.slug;
  return "/" + item.kind + "/" + item.slug;
}

function canonicalUrl(item) {
  return SITE + canonicalPath(item);
}

function hasCite(item) {
  const cited = Array.isArray(item.citations) && item.citations.some((c) => c && c.url);
  return Boolean((item.source && item.source.url) || cited);
}

const published = items.filter((item) => item.status === "published" && hasCite(item));
const generatedAt = new Date().toISOString();

const doc = {
  product: "the-valley-desk",
  version: "1",
  generatedAt,
  items: published,
};

function esc(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Reed lock: RSS <link> and <guid> are our canonical permalink only.
// source.url stays on the JSON item as citation. Never the RSS link.
const rssItems = published
  .map((item) => {
    const link = canonicalUrl(item);
    const desc = item.impactSentence || item.dek || "";
    const pub = item.publishedAt || item.updatedAt;
    return `    <item>
      <title>${esc(item.title)}</title>
      <link>${esc(link)}</link>
      <guid isPermaLink="true">${esc(link)}</guid>
      <description>${esc(desc)}</description>
      <pubDate>${new Date(pub).toUTCString()}</pubDate>
    </item>`;
  })
  .join("\n");

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>The Valley Desk</title>
    <link>${SITE}/</link>
    <description>Local health-tech news for people and agents</description>
    <lastBuildDate>${new Date(generatedAt).toUTCString()}</lastBuildDate>
${rssItems}
  </channel>
</rss>
`;

const sitemapPaths = [
  "/",
  "/news",
  "/events",
  ...published.map(canonicalPath),
  "/feed.json",
  "/feed.xml",
];
const seen = new Set();
const loc = [...sitemapPaths].filter((p) => (seen.has(p) ? false : seen.add(p)));
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${loc.map((path) => `  <url><loc>${SITE}${path === "/" ? "/" : path}</loc></url>`).join("\n")}
</urlset>
`;

mkdirSync(join(root, "public"), { recursive: true });
writeFileSync(join(root, "public/feed.json"), JSON.stringify(doc, null, 2) + "\n");
writeFileSync(join(root, "public/feed.xml"), rss);
writeFileSync(join(root, "public/sitemap.xml"), sitemap);
console.log("wrote public/feed.json (" + published.length + "), public/feed.xml, public/sitemap.xml");
