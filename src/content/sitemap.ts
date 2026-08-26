import type { ContentItem } from "./schema";
import { publicOrigin } from "../lib/canonical";
const NEWS_KINDS = new Set(["news", "policy", "ai", "interview"]);

export function sitemapLastmod(iso?: string) {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return undefined;
  return new Date(t).toISOString().slice(0, 10);
}

export type SitemapEntry = { loc: string; lastmod?: string };

function esc(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function sitemapUrlset(entries: readonly SitemapEntry[]) {
  const seen = new Set<string>();
  const rows: SitemapEntry[] = [];
  for (const entry of entries) {
    if (!entry.loc || seen.has(entry.loc)) continue;
    seen.add(entry.loc);
    rows.push(entry);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows
  .map((entry) => {
    const lastmod = entry.lastmod ? `<lastmod>${esc(entry.lastmod)}</lastmod>` : "";
    return `  <url><loc>${esc(entry.loc)}</loc>${lastmod}</url>`;
  })
  .join("\n")}
</urlset>
`;
}

export function canonicalSitemapPath(item: Pick<ContentItem, "kind" | "slug">) {
  if (item.kind === "event") return `/events/${item.slug}`;
  if (item.kind === "voice") return `/voices/${item.slug}`;
  if (NEWS_KINDS.has(item.kind)) return `/news/${item.slug}`;
  return `/${item.kind}/${item.slug}`;
}

export function sitemapEntriesForFeed(
  items: readonly ContentItem[],
  generatedAt?: string,
  origin = publicOrigin(),
) {
  const indexLastmod = sitemapLastmod(generatedAt);
  const entries: SitemapEntry[] = [
    { loc: `${origin}/`, lastmod: indexLastmod },
    { loc: `${origin}/news`, lastmod: indexLastmod },
    { loc: `${origin}/events`, lastmod: indexLastmod },
    { loc: `${origin}/voices`, lastmod: indexLastmod },
  ];
  for (const item of items) {
    entries.push({
      loc: `${origin}${canonicalSitemapPath(item)}`,
      lastmod: sitemapLastmod(item.updatedAt || item.publishedAt) ?? indexLastmod,
    });
  }
  entries.push(
    { loc: `${origin}/feed.json`, lastmod: indexLastmod },
    { loc: `${origin}/feed.xml`, lastmod: indexLastmod },
  );
  return entries;
}
