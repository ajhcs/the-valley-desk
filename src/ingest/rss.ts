import type { ContentItem } from "../content/schema";
import type { IngestBatch } from "./envelope";
import { toReviewQueue } from "./envelope";

export const RSS_SOURCES = [
  {
    id: "inquirer-health",
    name: "Inquirer Health",
    url: "https://www.inquirer.com/arc/outboundfeeds/rss/category/health/?outputType=xml",
  },
  {
    id: "inquirer-business",
    name: "Inquirer Business",
    url: "https://www.inquirer.com/arc/outboundfeeds/rss/category/business/?outputType=xml",
  },
  {
    id: "whyy",
    name: "WHYY",
    url: "https://whyy.org/feed/",
    fallbacks: ["https://whyy.org/topics/health/feed/"],
  },
  {
    id: "technically",
    name: "Technical.ly",
    url: "https://technical.ly/feed/",
    fallbacks: ["https://technical.ly/philadelphia/feed/"],
  },
] as const;

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function tag(block: string, name: string) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeXml(m[1]) : "";
}

function slugify(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "item";
}

export function looksLikeRss(body: string) {
  return /<rss[\s>]|<rdf:RDF|<feed[\s>]/i.test(body);
}

export function parseRssItems(xml: string) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => {
    const block = m[1];
    return {
      title: tag(block, "title"),
      link: tag(block, "link") || tag(block, "guid"),
      description: tag(block, "description"),
      pubDate: tag(block, "pubDate") || tag(block, "dc:date"),
      guid: tag(block, "guid"),
    };
  }).filter((item) => item.title && item.link);
}

export function rssItemToContent(
  raw: ReturnType<typeof parseRssItems>[number],
  feedName: string,
  fetchedAt: string,
  index: number,
): ContentItem {
  let publishedAt: string | undefined;
  const parsed = Date.parse(raw.pubDate);
  if (Number.isFinite(parsed)) publishedAt = new Date(parsed).toISOString();
  const slug = slugify(`${feedName}-${raw.title}`);
  return {
    id: `rss-${feedName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index}-${slugify(raw.guid || raw.link).slice(0, 24)}`,
    slug,
    kind: "news",
    title: raw.title,
    dek: raw.description.replace(/<[^>]+>/g, "").slice(0, 240),
    body: raw.description.replace(/<[^>]+>/g, "").slice(0, 2000),
    status: "review",
    publishedAt,
    updatedAt: fetchedAt,
    topics: [],
    orgs: [],
    region: "regional",
    authors: [],
    source: {
      kind: "ingest",
      origin: feedName,
      url: raw.link,
      fetchedAt,
      externalId: raw.guid || raw.link,
    },
    citations: [{ name: feedName, url: raw.link }],
    relatedEventIds: [],
    relatedVoiceIds: [],
  };
}

export async function fetchWorkingRss(
  fetchImpl: typeof fetch = fetch,
): Promise<{ url: string; name: string; status: number; items: ReturnType<typeof parseRssItems> }[]> {
  const working: { url: string; name: string; status: number; items: ReturnType<typeof parseRssItems> }[] = [];
  for (const source of RSS_SOURCES) {
    const urls = [source.url, ...("fallbacks" in source ? source.fallbacks : [])];
    for (const url of urls) {
      try {
        const res = await fetchImpl(url, {
          headers: { "user-agent": "TheValleyDesk/0.1 (+https://github.com/ajhcs/the-valley-desk)" },
        });
        const body = await res.text();
        if (res.status === 200 && looksLikeRss(body)) {
          working.push({ url, name: source.name, status: 200, items: parseRssItems(body) });
          break;
        }
      } catch {
        /* try next */
      }
    }
  }
  return working;
}

export async function ingestRss(now = new Date(), fetchImpl: typeof fetch = fetch): Promise<ContentItem[]> {
  const fetchedAt = now.toISOString();
  const feeds = await fetchWorkingRss(fetchImpl);
  const items: ContentItem[] = [];
  for (const feed of feeds) {
    feed.items.forEach((raw, index) => {
      items.push(rssItemToContent(raw, feed.name, fetchedAt, index));
    });
  }
  const batch: IngestBatch = { adapter: "rss", fetchedAt, items };
  return toReviewQueue(batch);
}
