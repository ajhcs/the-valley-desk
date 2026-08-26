import type { ContentItem } from "../content/schema";
import { Entity, type Entity as EntityRow } from "../content/entity";
import entityFixtures from "../../fixtures/entities.json";
import type { IngestBatch } from "./envelope";
import { toReviewQueue } from "./envelope";
import { collapseBySourceIdentity, normalizeSourceUrl, withCanonicalSource } from "./identity";
import { mapSeedOrgIds } from "./org-map";
import type { IngestSourceResult, SourceRunNote } from "./source-health";

const seedEntities = Entity.array().parse(entityFixtures);
const SOURCE_TIMEOUT_MS = 12_000;

export const RSS_SOURCES = [
  {
    id: "christianacare-information-technology",
    name: "ChristianaCare News · Information Technology",
    origin: "christianacare-newsroom",
    url: "https://news.christianacare.org/category/information-technology/feed/",
    orgIds: ["org-christianacare"],
  },
  {
    id: "cooper-newsroom",
    name: "Cooper University Health Care News",
    origin: "cooper-newsroom",
    url: "https://blogs.cooperhealth.org/news/feed/",
    orgIds: ["org-cooper"],
  },
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
  _index = 0,
  entities: readonly EntityRow[] = seedEntities,
  options: { origin?: string; fixedOrgIds?: readonly string[] } = {},
): ContentItem {
  let publishedAt: string | undefined;
  const parsed = Date.parse(raw.pubDate);
  if (Number.isFinite(parsed)) publishedAt = new Date(parsed).toISOString();
  const slug = slugify(`${feedName}-${raw.title}`);
  const canonicalUrl = normalizeSourceUrl(raw.link) ?? raw.link;
  const externalId = raw.guid || canonicalUrl;
  const text = `${raw.title} ${raw.description}`;
  return withCanonicalSource({
    id: `rss-${slugify(feedName)}-${slugify(externalId).slice(0, 48)}`,
    slug,
    kind: "news",
    title: raw.title,
    dek: raw.description.replace(/<[^>]+>/g, "").slice(0, 240),
    body: raw.description.replace(/<[^>]+>/g, "").slice(0, 2000),
    status: "review",
    publishedAt,
    updatedAt: fetchedAt,
    topics: [],
    orgs: [...new Set([...(options.fixedOrgIds ?? []), ...mapSeedOrgIds(text, entities)])],
    region: "regional",
    authors: [],
    source: {
      kind: "ingest",
      origin: options.origin ?? feedName,
      url: canonicalUrl,
      fetchedAt,
      externalId,
    },
    citations: [{ name: feedName, url: canonicalUrl }],
    relatedEventIds: [],
    relatedVoiceIds: [],
    featured: false,
  });
}

type WorkingRss = { url: string; name: string; origin?: string; orgIds?: readonly string[]; status: number; items: ReturnType<typeof parseRssItems> };

async function fetchRssSources(
  fetchImpl: typeof fetch,
  checkedAt: string,
): Promise<{ working: WorkingRss[]; sources: SourceRunNote[] }> {
  const working: { url: string; name: string; origin?: string; orgIds?: readonly string[]; status: number; items: ReturnType<typeof parseRssItems> }[] = [];
  const sources: SourceRunNote[] = [];
  for (const source of RSS_SOURCES) {
    const urls = [source.url, ...("fallbacks" in source ? source.fallbacks : [])];
    let success: WorkingRss | undefined;
    let lastError = "No usable RSS response";
    for (const url of urls) {
      try {
        const res = await fetchImpl(url, {
          headers: { "user-agent": "TheValleyDesk/0.1 (+https://github.com/ajhcs/the-valley-desk)" },
          signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
        });
        const body = await res.text();
        if (res.status === 200 && looksLikeRss(body)) {
          success = {
            url,
            name: source.name,
            origin: "origin" in source ? source.origin : undefined,
            orgIds: "orgIds" in source ? source.orgIds : undefined,
            status: 200,
            items: parseRssItems(body),
          };
          break;
        }
        lastError = `HTTP ${res.status} or invalid RSS document`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        /* try next */
      }
    }
    if (success) working.push(success);
    sources.push({
      id: source.id,
      origin: "origin" in source && source.origin ? source.origin : source.name,
      type: "rss",
      state: success ? "success" : "error",
      checkedAt,
      itemCount: success?.items.length ?? 0,
      complete: false,
      url: success?.url ?? source.url,
      ...(success ? {} : { error: lastError }),
    });
  }
  return { working, sources };
}

export async function fetchWorkingRss(
  fetchImpl: typeof fetch = fetch,
): Promise<WorkingRss[]> {
  return (await fetchRssSources(fetchImpl, new Date().toISOString())).working;
}

export async function ingestRssWithHealth(
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<IngestSourceResult<ContentItem>> {
  const fetchedAt = now.toISOString();
  const { working: feeds, sources } = await fetchRssSources(fetchImpl, fetchedAt);
  const items: ContentItem[] = [];
  for (const feed of feeds) {
    feed.items.forEach((raw, index) => {
      items.push(rssItemToContent(raw, feed.name, fetchedAt, index, seedEntities, {
        origin: feed.origin,
        fixedOrgIds: feed.orgIds,
      }));
    });
  }
  const collapsed = collapseBySourceIdentity(items).map((group) => group.item);
  const batch: IngestBatch = { adapter: "rss", fetchedAt, items: collapsed };
  return { items: toReviewQueue(batch), sources };
}

export async function ingestRss(now = new Date(), fetchImpl: typeof fetch = fetch): Promise<ContentItem[]> {
  return (await ingestRssWithHealth(now, fetchImpl)).items;
}
