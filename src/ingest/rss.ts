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
import { institutionIdsForOrgIds } from "./coverage-pack";
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

function decodeHtml(value: string) {
  return decodeXml(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function htmlText(value: string) {
  return decodeHtml(value.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
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

const COOPER_NEWSROOM_URL = "https://www.cooperhealth.org/about-us/newsroom";
const COOPER_BLOG_HOST = "blogs.cooperhealth.org";
const COOPER_INDEPENDENT_HOST = "phillyvoice.com";
const COOPER_INDEPENDENT_PATH = "/tags/cooperuniversity-health-care";
const COOPER_INDEPENDENT_ITEM_CAP = 40;
const MONTH_DATE = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+\d{4}\b/i;
const NUMERIC_DATE = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/;
const GENERIC_LINK_TEXT = /^(?:read more|learn more|more|view|details|click here|continue reading)$/i;

/**
 * Cooper's public newsroom is the authority page for releases, while the
 * linked blog remains the canonical article URL. Keep this adapter narrow so
 * an arbitrary HTML page cannot be mistaken for a successful source.
 */
export function parseCooperNewsroomItems(html: string, baseUrl = COOPER_NEWSROOM_URL): ParsedFeedItem[] {
  if (!/\b(?:cooper university health care|cooperhealth)\b/i.test(html)) return [];
  const headings: Array<{ end: number; text: string }> = [];
  for (const match of html.matchAll(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/gi)) {
    headings.push({ end: match.index ?? 0, text: htmlText(match[1] ?? "") });
  }
  const items: ParsedFeedItem[] = [];
  const seen = new Set<string>();
  const anchors = /<a\b([^>]*?)href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchors)) {
    const href = decodeHtml(match[2] ?? "");
    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== COOPER_BLOG_HOST) continue;
    if (url.pathname === "/" || url.pathname.length < 2) continue;
    const canonicalUrl = normalizeSourceUrl(url.toString()) ?? url.toString();
    if (seen.has(canonicalUrl)) continue;
    const end = (match.index ?? 0) + match[0].length;
    const surrounding = html.slice(Math.max(0, (match.index ?? 0) - 1800), Math.min(html.length, end + 900));
    const rawAnchorText = htmlText(match[3] ?? "");
    const heading = [...headings].reverse().find((row) => row.end <= (match.index ?? 0))?.text ?? "";
    const title = rawAnchorText && !GENERIC_LINK_TEXT.test(rawAnchorText) ? rawAnchorText : heading;
    if (!title || GENERIC_LINK_TEXT.test(title) || title.length < 8 || title.length > 240) continue;
    const dateMatch = surrounding.match(MONTH_DATE) ?? surrounding.match(NUMERIC_DATE);
    const pubDate = dateMatch?.[0] ?? "";
    seen.add(canonicalUrl);
    items.push({
      title,
      link: canonicalUrl,
      description: "",
      pubDate,
      guid: canonicalUrl,
    });
  }
  return items;
}

/**
 * Parse only the current, explicit PhillyVoice Cooper tag page. This is a
 * discovery safety net, not a source of authority: the resulting origin is
 * intentionally non-official and the editor requires first-party
 * corroboration before publication. Article pages from this host are not
 * added to the article-fetch allowlist, so a blocked Cooper newsroom cannot
 * turn a third-party snippet into authoritative copy.
 */
export function parseCooperIndependentItems(
  html: string,
  baseUrl = "https://www.phillyvoice.com/tags/cooperuniversity-health-care/",
): ParsedFeedItem[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const baseHost = base.hostname.replace(/^www\./i, "").toLowerCase();
  const basePath = base.pathname.replace(/\/+$/, "").toLowerCase();
  if (base.protocol !== "https:" || baseHost !== COOPER_INDEPENDENT_HOST || basePath !== COOPER_INDEPENDENT_PATH) {
    return [];
  }
  if (!/\b(?:cooper university health care|cooperhealth\.org)\b/i.test(htmlText(html))) return [];

  const items: ParsedFeedItem[] = [];
  const seen = new Set<string>();
  const anchors = /<a\b([^>]*?)href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchors)) {
    let url: URL;
    try {
      url = new URL(decodeHtml(match[2] ?? ""), baseUrl);
    } catch {
      continue;
    }
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    const path = url.pathname.replace(/\/+$/, "").toLowerCase();
    if (url.protocol !== "https:" || host !== COOPER_INDEPENDENT_HOST) continue;
    if (!path || path === COOPER_INDEPENDENT_PATH || path.startsWith("/tags/")) continue;
    const canonicalUrl = normalizeSourceUrl(url.toString()) ?? url.toString();
    if (seen.has(canonicalUrl)) continue;
    const rawTitle = htmlText(match[3] ?? "");
    if (!rawTitle || GENERIC_LINK_TEXT.test(rawTitle) || rawTitle.length < 8 || rawTitle.length > 240) continue;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const surrounding = htmlText(html.slice(Math.max(0, start - 700), Math.min(html.length, end + 900)));
    if (!/\b(?:cooper university health care|cooper health|cooperhealth\.org)\b/i.test(`${rawTitle} ${surrounding}`)) continue;
    const dateMatch = surrounding.match(MONTH_DATE) ?? surrounding.match(NUMERIC_DATE);
    seen.add(canonicalUrl);
    items.push({
      title: rawTitle,
      link: canonicalUrl,
      description: "",
      pubDate: dateMatch?.[0] ?? "",
      guid: canonicalUrl,
    });
    if (items.length >= COOPER_INDEPENDENT_ITEM_CAP) break;
  }
  return items;
}

export function rssItemToContent(
  raw: ParsedFeedItem,
  feedName: string,
  fetchedAt: string,
  _index = 0,
  entities: readonly EntityRow[] = seedEntities,
  options: { origin?: string; fixedOrgIds?: readonly string[]; authorityUrl?: string; authorityName?: string } = {},
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
    citations: [
      { name: feedName, url: canonicalUrl },
      ...(options.authorityUrl && options.authorityUrl !== canonicalUrl
        ? [{ name: options.authorityName ?? `${feedName} official newsroom`, url: options.authorityUrl }]
        : []),
    ],
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
  authorityUrl?: string;
  authorityName?: string;
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
    institutionIds: institutionIdsForOrgIds(source.orgIds ?? []),
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

async function readCooperNewsroom(url: string, fetchImpl: typeof fetch) {
  const response = await fetchUpstream({
    url,
    fetchImpl,
    maxBytes: RSS_MAX_BYTES,
    timeoutMs: SOURCE_TIMEOUT_MS,
    headers: { "user-agent": SOURCE_USER_AGENT, accept: "text/html,application/xhtml+xml" },
  });
  const items = parseCooperNewsroomItems(response.body, url);
  if (!items.length) throw new UpstreamError("parser-failed", "Cooper official newsroom had no recognized release links");
  return { ...response, items };
}

async function readCooperIndependent(url: string, fetchImpl: typeof fetch) {
  const response = await fetchUpstream({
    url,
    fetchImpl,
    maxBytes: RSS_MAX_BYTES,
    timeoutMs: SOURCE_TIMEOUT_MS,
    headers: { "user-agent": SOURCE_USER_AGENT, accept: "text/html,application/xhtml+xml" },
  });
  const items = parseCooperIndependentItems(response.body, url);
  if (!items.length) throw new UpstreamError("parser-failed", "Independent Cooper discovery had no recognized article links");
  return { ...response, items };
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
    const candidates: Array<{ url: string; adapter?: "cooper-newsroom" | "cooper-independent" }> = [
      ...[source.url, ...(source.fallbacks ?? [])].map((url) => ({ url })),
      ...(source.htmlFallbacks ?? []),
      ...(source.independentFallbacks ?? []),
    ];
    const readCandidate = async (candidate: typeof candidates[number]) => {
      const feed = candidate.adapter === "cooper-newsroom"
        ? await readCooperNewsroom(candidate.url, fetchImpl)
        : candidate.adapter === "cooper-independent"
          ? await readCooperIndependent(candidate.url, fetchImpl)
          : await readFeed(candidate.url, fetchImpl);
      // A syntactically valid but empty Cooper feed is not useful coverage;
      // continue to the authoritative newsroom adapter instead of stopping
      // with a misleading healthy-empty result.
      if (source.id === "cooper-newsroom" && !candidate.adapter && feed.items.length === 0) {
        throw new UpstreamError("parser-failed", "Cooper RSS feed returned no items; trying official newsroom fallback");
      }
      return feed;
    };
    const prior = sourceHealth?.get(source.id);
    if (sourceIsInBackoff(prior, new Date(checkedAt))) {
      // A primary cooldown must not take a configured fallback out of service.
      // Keep the primary failure streak/timer intact while serving any healthy
      // fallback snapshot found during this run.
      let fallback: WorkingRss | undefined;
      for (const candidate of candidates.slice(1)) {
        try {
          const feed = await readCandidate(candidate);
          const independent = candidate.adapter === "cooper-independent";
          fallback = {
            url: candidate.url,
            name: source.name,
            origin: independent ? "cooper-independent-discovery" : source.origin,
            orgIds: source.orgIds,
            ...(candidate.adapter === "cooper-newsroom" ? { authorityUrl: candidate.url } : {}),
            ...(independent ? {
              authorityUrl: COOPER_NEWSROOM_URL,
              authorityName: "Cooper University Health Care official newsroom (corroboration required)",
            } : {}),
            status: feed.status,
            items: feed.items,
          };
          break;
        } catch {
          // The primary error remains the durable source-health error. A
          // failed fallback simply leaves the source in its existing cooldown.
        }
      }
      if (fallback) {
        working.push(fallback);
        sources.push(sourceNote({
          id: source.id,
          origin: source.origin ?? source.name,
          type: "rss",
          state: "backoff",
          checkedAt,
          itemCount: fallback.items.length,
          completeness: "partial",
          url: source.url,
          error: prior?.lastError ?? "Primary source is in retry backoff; fallback is serving",
          nextAttemptAt: prior?.nextAttemptAt,
          httpStatus: prior?.lastHttpStatus ?? undefined,
          requiresAuth: prior?.requiresAuth,
          fallbackUrl: fallback.url,
          consecutiveFailures: prior?.consecutiveFailures ?? 0,
          lastSuccessAt: prior?.lastSuccessAt ?? null,
          institutionIds: institutionIdsForOrgIds(source.orgIds ?? []),
        }));
      } else {
        sources.push({
          ...sourceBackoffNote(source.id, source.origin ?? source.name, "rss", checkedAt, prior, source.url),
          institutionIds: institutionIdsForOrgIds(source.orgIds ?? []),
        });
      }
      continue;
    }
    let success: WorkingRss | undefined;
    let lastError: UpstreamError | undefined;
    for (const candidate of candidates) {
      try {
        const feed = await readCandidate(candidate);
        const independent = candidate.adapter === "cooper-independent";
        success = {
          url: candidate.url,
          name: source.name,
          origin: independent ? "cooper-independent-discovery" : source.origin,
          orgIds: source.orgIds,
          ...(candidate.adapter === "cooper-newsroom" ? { authorityUrl: candidate.url } : {}),
          ...(independent ? {
            authorityUrl: COOPER_NEWSROOM_URL,
            authorityName: "Cooper University Health Care official newsroom (corroboration required)",
          } : {}),
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
        institutionIds: institutionIdsForOrgIds(source.orgIds ?? []),
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
      institutionIds: institutionIdsForOrgIds(source.orgIds ?? []),
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
          authorityUrl: feed.authorityUrl,
          authorityName: feed.authorityName,
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
