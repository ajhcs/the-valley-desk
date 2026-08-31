import type { ContentItem } from "../content/schema";
import { Entity, type Entity as EntityRow } from "../content/entity";
import entityFixtures from "../../fixtures/entities.json";
import type { IngestBatch } from "./envelope";
import { toReviewQueue } from "./envelope";
import { collapseBySourceIdentity, normalizeSourceUrl, withCanonicalSource } from "./identity";
import {
  emptyNewsArticleExtractionMetrics,
  overlayNewsArticles,
  type NewsArticleExtractionAttempt,
  type NewsArticleExtractionMetrics,
  type NewsArticleExtractionState,
} from "./news-extraction";
import { mapSeedOrgIds } from "./org-map";
import { rssSources, type RssSource } from "./origins";
import {
  sourceBackoffNote,
  sourceIsInBackoff,
  sourceNote,
  sourceStateForItemCount,
  type IngestSourceResult,
  type SourceRunNote,
} from "./source-health";
import {
  RSS_MAX_BYTES,
  SOURCE_TIMEOUT_MS,
  SOURCE_USER_AGENT,
  UpstreamError,
  fetchUpstream,
} from "./upstream";

const seedEntities = Entity.array().parse(entityFixtures);

export const RSS_SOURCES = rssSources();

export type ParsedFeedItem = {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  guid: string;
};

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

/** Long titles from one newsroom commonly share their first 72 characters.
 * Add a deterministic source-identity suffix so two distinct articles can
 * never collapse onto the same public route. */
function rssSlug(feedName: string, title: string, externalId: string) {
  let hash = 0x811c9dc5;
  for (const character of externalId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const suffix = hash.toString(36).padStart(7, "0").slice(-7);
  const base = slugify(`${feedName}-${title}`);
  return `${base.slice(0, 64).replace(/-+$/g, "")}-${suffix}`;
}

export function looksLikeRss(body: string) {
  const head = body.slice(0, 4000);
  return /<rss[\s>]|<rdf:RDF/i.test(head);
}

export function looksLikeAtom(body: string) {
  const head = body.slice(0, 4000);
  return /<feed[\s>]/i.test(head) && !/<rss[\s>]/i.test(head);
}

export function looksLikeFeed(body: string) {
  return looksLikeRss(body) || looksLikeAtom(body);
}

function extractTaggedBlocks(xml: string, tagName: string) {
  const openRe = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  const closeTag = `</${tagName}>`;
  const blocks: string[] = [];
  let pos = 0;
  while (pos < xml.length) {
    openRe.lastIndex = pos;
    const open = openRe.exec(xml);
    if (!open) break;
    const start = open.index + open[0].length;
    openRe.lastIndex = start;
    const nextOpen = openRe.exec(xml);
    const closeAt = xml.toLowerCase().indexOf(closeTag.toLowerCase(), start);
    if (closeAt === -1) break;
    if (nextOpen && nextOpen.index < closeAt) {
      pos = nextOpen.index;
      continue;
    }
    blocks.push(xml.slice(start, closeAt));
    pos = closeAt + closeTag.length;
  }
  return blocks;
}

function parseOneRssItem(block: string): ParsedFeedItem | undefined {
  try {
    const title = tag(block, "title");
    const link = tag(block, "link") || tag(block, "guid");
    if (!title || !link) return undefined;
    return {
      title,
      link,
      description: tag(block, "description"),
      pubDate: tag(block, "pubDate") || tag(block, "dc:date"),
      guid: tag(block, "guid"),
    };
  } catch {
    return undefined;
  }
}

function atomLink(block: string) {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)];
  const alternate = links.find((row) => /rel\s*=\s*["']alternate["']/i.test(row[1] ?? ""));
  const hrefFrom = (attrs: string) => {
    const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
    return href ? decodeXml(href[1]) : "";
  };
  if (alternate) return hrefFrom(alternate[1] ?? "");
  for (const row of links) {
    const href = hrefFrom(row[1] ?? "");
    if (href) return href;
  }
  return tag(block, "link");
}

function parseOneAtomEntry(block: string): ParsedFeedItem | undefined {
  try {
    const title = tag(block, "title");
    const link = atomLink(block) || tag(block, "id");
    if (!title || !link) return undefined;
    return {
      title,
      link,
      description: tag(block, "summary") || tag(block, "content"),
      pubDate: tag(block, "updated") || tag(block, "published"),
      guid: tag(block, "id"),
    };
  } catch {
    return undefined;
  }
}

export function parseRssItems(xml: string): ParsedFeedItem[] {
  return extractTaggedBlocks(xml, "item")
    .map(parseOneRssItem)
    .filter((item): item is ParsedFeedItem => Boolean(item));
}

export function parseAtomItems(xml: string): ParsedFeedItem[] {
  return extractTaggedBlocks(xml, "entry")
    .map(parseOneAtomEntry)
    .filter((item): item is ParsedFeedItem => Boolean(item));
}

export function parseFeedItems(xml: string): ParsedFeedItem[] {
  if (looksLikeAtom(xml)) return parseAtomItems(xml);
  return parseRssItems(xml);
}

export function rssItemToContent(
  raw: ParsedFeedItem,
  feedName: string,
  fetchedAt: string,
  _index = 0,
  entities: readonly EntityRow[] = seedEntities,
  options: { origin?: string; fixedOrgIds?: readonly string[] } = {},
): ContentItem {
  let publishedAt: string | undefined;
  const parsed = Date.parse(raw.pubDate);
  if (Number.isFinite(parsed)) publishedAt = new Date(parsed).toISOString();
  const canonicalUrl = normalizeSourceUrl(raw.link) ?? raw.link;
  const externalId = raw.guid || canonicalUrl;
  const slug = rssSlug(feedName, raw.title, externalId);
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

type WorkingRss = {
  url: string;
  name: string;
  origin?: string;
  orgIds?: readonly string[];
  status: number;
  items: ParsedFeedItem[];
};

function configNote(source: RssSource, checkedAt: string, state: "disabled" | "misconfigured"): SourceRunNote {
  return sourceNote({
    id: source.id,
    origin: source.origin ?? source.name,
    type: "rss",
    state,
    checkedAt,
    url: source.url,
    error: source.reason ?? (state === "disabled" ? "Source is disabled" : "Source is misconfigured"),
  });
}

async function readFeed(url: string, fetchImpl: typeof fetch) {
  const response = await fetchUpstream({
    url,
    fetchImpl,
    maxBytes: RSS_MAX_BYTES,
    timeoutMs: SOURCE_TIMEOUT_MS,
    headers: { "user-agent": SOURCE_USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
  });
  if (!looksLikeFeed(response.body)) {
    throw new UpstreamError("parser-failed", "Response was not a usable RSS or Atom document");
  }
  return { ...response, items: parseFeedItems(response.body) };
}

async function fetchRssSources(
  fetchImpl: typeof fetch,
  checkedAt: string,
  sourceHealth?: ReadonlyMap<string, import("./source-health").PersistedSourceHealth>,
): Promise<{ working: WorkingRss[]; sources: SourceRunNote[] }> {
  const working: WorkingRss[] = [];
  const sources: SourceRunNote[] = [];
  for (const source of RSS_SOURCES) {
    if (source.status === "disabled" || source.status === "misconfigured") {
      sources.push(configNote(source, checkedAt, source.status));
      continue;
    }
    const prior = sourceHealth?.get(source.id);
    if (sourceIsInBackoff(prior, new Date(checkedAt))) {
      sources.push(sourceBackoffNote(source.id, source.origin ?? source.name, "rss", checkedAt, prior, source.url));
      continue;
    }
    const urls = [source.url, ...(source.fallbacks ?? [])];
    let success: WorkingRss | undefined;
    let lastError: UpstreamError | undefined;
    for (const url of urls) {
      try {
        const feed = await readFeed(url, fetchImpl);
        success = {
          url,
          name: source.name,
          origin: source.origin,
          orgIds: source.orgIds,
          status: feed.status,
          items: feed.items,
        };
        break;
      } catch (error) {
        lastError = error instanceof UpstreamError
          ? error
          : new UpstreamError("upstream-failed", error instanceof Error ? error.message : String(error));
      }
    }
    if (success) {
      working.push(success);
      sources.push(sourceNote({
        id: source.id,
        origin: source.origin ?? source.name,
        type: "rss",
        state: sourceStateForItemCount(success.items.length),
        checkedAt,
        itemCount: success.items.length,
        url: success.url,
        ...(success.url !== source.url ? { fallbackUrl: success.url } : {}),
      }));
      continue;
    }
    sources.push(sourceNote({
      id: source.id,
      origin: source.origin ?? source.name,
      type: "rss",
      state: lastError?.code ?? "upstream-failed",
      checkedAt,
      url: source.url,
      error: lastError?.message ?? "No usable RSS response",
      ...(lastError?.httpStatus === undefined ? {} : { httpStatus: lastError.httpStatus }),
      requiresAuth: false,
    }));
  }
  return { working, sources };
}

export async function fetchWorkingRss(
  fetchImpl: typeof fetch = fetch,
): Promise<WorkingRss[]> {
  return (await fetchRssSources(fetchImpl, new Date().toISOString())).working;
}

export type RssIngestOptions = {
  knownSourceUrls?: ReadonlySet<string>;
  newsExtractions?: ReadonlyMap<string, NewsArticleExtractionState>;
  sourceHealth?: ReadonlyMap<string, import("./source-health").PersistedSourceHealth>;
};

export type RssIngestResult = IngestSourceResult<ContentItem> & {
  newsExtraction: {
    attempts: NewsArticleExtractionAttempt[];
    metrics: NewsArticleExtractionMetrics;
  };
};

export async function ingestRssWithHealth(
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
  options: RssIngestOptions = {},
): Promise<RssIngestResult> {
  const fetchedAt = now.toISOString();
  const { working: feeds, sources } = await fetchRssSources(fetchImpl, fetchedAt, options.sourceHealth);
  const items: ContentItem[] = [];
  for (const feed of feeds) {
    for (const [index, raw] of feed.items.entries()) {
      try {
        items.push(rssItemToContent(raw, feed.name, fetchedAt, index, seedEntities, {
          origin: feed.origin,
          fixedOrgIds: feed.orgIds,
        }));
      } catch {
        /* one malformed mapped item must not discard valid siblings */
      }
    }
  }
  const collapsed = collapseBySourceIdentity(items).map((group) => group.item);
  let extracted = collapsed;
  let newsExtraction = {
    attempts: [] as NewsArticleExtractionAttempt[],
    metrics: emptyNewsArticleExtractionMetrics(),
  };
  try {
    // Article fetches are best-effort. Failures keep RSS items and must not change source-health.
    const overlay = await overlayNewsArticles(collapsed, {
      fetchImpl,
      entities: seedEntities,
      knownSourceUrls: options.knownSourceUrls,
      newsExtractions: options.newsExtractions,
      now,
    });
    extracted = overlay.items;
    newsExtraction = { attempts: overlay.attempts, metrics: overlay.metrics };
  } catch {
    extracted = collapsed;
  }
  const batch: IngestBatch = { adapter: "rss", fetchedAt, items: extracted };
  return { items: toReviewQueue(batch), sources, newsExtraction };
}

export async function ingestRss(now = new Date(), fetchImpl: typeof fetch = fetch, options: RssIngestOptions = {}): Promise<ContentItem[]> {
  return (await ingestRssWithHealth(now, fetchImpl, options)).items;
}
