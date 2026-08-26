import type { ContentItem, EventItem } from "../content/schema";
import { mergePublishedOverlay } from "../content/merge";
import { canonicalPath as itemCanonicalPath, publicOrigin, publicUrl } from "../lib/canonical";
import { eventWhyCopy } from "../lib/eventCopy";
import { toFeed, type FeedDocument } from "./feed-contract";
import type { D1DatabaseLike } from "./persistence";
import { readPublicationTombstones, readPublishedContent } from "./persistence";

const NEWS_KINDS = new Set(["news", "policy", "ai", "interview"]);

export function mergePublishedContent(
  staticItems: ContentItem[],
  dynamicItems: ContentItem[],
  withdrawnIds: readonly string[] = [],
) {
  return mergePublishedOverlay(staticItems, dynamicItems, withdrawnIds);
}

export async function mergedFeed(
  db: D1DatabaseLike,
  staticFeed: FeedDocument,
  now = new Date(),
) {
  const [dynamicItems, withdrawnIds] = await Promise.all([
    readPublishedContent(db),
    readPublicationTombstones(db),
  ]);
  // Overlay is the complete published set (paged in persistence), not a 100/200 window.
  return toFeed(mergePublishedContent(staticFeed.items, dynamicItems, withdrawnIds), now.toISOString());
}

export function canonicalPath(item: ContentItem) {
  if (item.kind === "event") return `/events/${item.slug}`;
  if (item.kind === "voice") return `/voices/${item.slug}`;
  if (NEWS_KINDS.has(item.kind)) return `/news/${item.slug}`;
  return itemCanonicalPath(item);
}

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function feedXml(feed: FeedDocument, origin = publicOrigin()) {
  const feedGeneratedAt = new Date(feed.generatedAt);
  const items = feed.items.map((item) => {
    const link = `${origin}${canonicalPath(item)}`;
    const description = item.impactSentence
      || (item.kind === "event" ? eventWhyCopy(item as EventItem) : undefined)
      || item.dek
      || item.body
      || item.title;
    const published = item.publishedAt || item.updatedAt;
    const publishedAt = new Date(published);
    const safePublishedAt = Number.isNaN(publishedAt.valueOf()) || publishedAt > feedGeneratedAt
      ? feedGeneratedAt
      : publishedAt;
    return `    <item>\n      <title>${esc(item.title)}</title>\n      <link>${esc(link)}</link>\n      <guid isPermaLink="true">${esc(link)}</guid>\n      <description>${esc(description)}</description>\n      <pubDate>${safePublishedAt.toUTCString()}</pubDate>\n    </item>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>The Valley Desk</title>\n    <link>${origin}/</link>\n    <description>Local health-tech news for people and agents</description>\n    <lastBuildDate>${new Date(feed.generatedAt).toUTCString()}</lastBuildDate>\n${items}\n  </channel>\n</rss>\n`;
}

export function sitemapXml(feed: FeedDocument, origin = publicOrigin()) {
  const paths = ["/", "/news", "/events", "/voices", "/feed.json", "/feed.xml"];
  const seen = new Set(paths);
  for (const item of feed.items) seen.add(canonicalPath(item));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...seen].map((path) => `  <url><loc>${esc(publicUrl(path, origin))}</loc></url>`).join("\n")}\n</urlset>\n`;
}

export function runtimeItemsScript(
  items: ContentItem[],
  withdrawnIds: readonly string[] = [],
  nonce?: string,
) {
  const safe = JSON.stringify(items)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  const safeWithdrawn = JSON.stringify(withdrawnIds)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  const attr = nonce ? ` nonce="${nonce}"` : "";
  return `<script${attr}>globalThis.__VALLEY_DESK_DYNAMIC_ITEMS__=${safe};globalThis.__VALLEY_DESK_WITHDRAWN_IDS__=${safeWithdrawn};</script>`;
}
