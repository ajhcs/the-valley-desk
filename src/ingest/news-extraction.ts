import { Entity, type Entity as EntityRow } from "../content/entity";
import type { ContentItem } from "../content/schema";
import entityFixtures from "../../fixtures/entities.json";
import { normalizeSourceUrl } from "./identity";
import { mapSeedOrgIds } from "./org-map";
import { rssSources } from "./origins";
import {
  NEWS_ARTICLE_BODY_MAX_CHARS,
  NEWS_ARTICLE_CANDIDATE_CAP,
  NEWS_ARTICLE_CONCURRENCY,
  NEWS_ARTICLE_ERROR_MAX_CHARS,
  NEWS_ARTICLE_FAILURE_BASE_MS,
  NEWS_ARTICLE_FAILURE_MAX_MS,
  NEWS_ARTICLE_MAX_BYTES,
  NEWS_ARTICLE_MAX_REDIRECTS,
  NEWS_ARTICLE_MIN_CHARS,
  NEWS_ARTICLE_SUCCESS_REFRESH_MS,
  NEWS_ARTICLE_TIMEOUT_MS,
} from "./news-extraction-config";
import { SOURCE_USER_AGENT, readBoundedText } from "./upstream";

const seedEntities = Entity.array().parse(entityFixtures);

const ARTICLE_LD_TYPES = new Set([
  "article",
  "newsarticle",
  "blogposting",
  "reportagenewsarticle",
]);

export type ArticleExtractionMethod = "json-ld" | "article" | "main";

export type ArticleExtraction = {
  text: string;
  method: ArticleExtractionMethod;
};

export type NewsArticleExtractionStateName = "success" | "failed" | "no-content";

export type NewsArticleExtractionState = {
  url: string;
  state: NewsArticleExtractionStateName;
  cachedText?: string | null;
  method?: ArticleExtractionMethod | null;
  attemptCount: number;
  lastAttemptedAt: string;
  lastSuccessAt?: string | null;
  nextAttemptAt: string;
  error?: string | null;
};

export type NewsArticleExtractionAttempt = NewsArticleExtractionState & {
  attemptedAt: string;
};

export type NewsArticleExtractionMetrics = {
  eligible: number;
  due: number;
  fetched: number;
  reused: number;
  success: number;
  failed: number;
  noContent: number;
  preserved: number;
  capped: number;
  selectedOriginCounts: Record<string, number>;
};

export type NewsArticleOverlayResult = {
  items: ContentItem[];
  attempts: NewsArticleExtractionAttempt[];
  metrics: NewsArticleExtractionMetrics;
};

export type NewsArticleOverlayOptions = {
  fetchImpl: typeof fetch;
  entities?: readonly EntityRow[];
  allowedHosts?: ReadonlySet<string>;
  knownSourceUrls?: ReadonlySet<string>;
  candidateCap?: number;
  concurrency?: number;
  now?: Date;
  newsExtractions?: ReadonlyMap<string, NewsArticleExtractionState>;
};

export type ArticlePageFetchResult =
  | { ok: true; url: string; body: string }
  | { ok: false; error: string };

function decodeHtml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(Number.parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();
}

function clipText(value: string, max = NEWS_ARTICLE_BODY_MAX_CHARS) {
  return value.replace(/\s+/g, " ").trim().slice(0, max).trim();
}

function clipError(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, NEWS_ARTICLE_ERROR_MAX_CHARS).trim();
}

function htmlToText(html: string) {
  const withBreaks = html
    .replace(/<\/(p|div|h[1-6]|li|tr|section|blockquote)[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  return clipText(decodeHtml(withBreaks.replace(/<[^>]+>/g, " ")));
}

function ldTypeName(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  const slash = trimmed.lastIndexOf("/");
  return (slash >= 0 ? trimmed.slice(slash + 1) : trimmed).toLowerCase();
}

function ldTypes(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(ldTypes);
  const name = ldTypeName(value);
  return name ? [name] : [];
}

function textFromLd(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFromLd).filter(Boolean).join("\n\n");
  if (value && typeof value === "object" && "@value" in value) {
    return textFromLd((value as { "@value"?: unknown })["@value"]);
  }
  return "";
}

function findJsonLdArticleBody(node: unknown, depth = 0): string {
  if (depth > 8 || node == null) return "";
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJsonLdArticleBody(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof node !== "object") return "";
  const record = node as Record<string, unknown>;
  if (record["@graph"]) {
    const found = findJsonLdArticleBody(record["@graph"], depth + 1);
    if (found) return found;
  }
  if (record.mainEntity) {
    const found = findJsonLdArticleBody(record.mainEntity, depth + 1);
    if (found) return found;
  }
  const types = ldTypes(record["@type"]);
  if (types.some((type) => ARTICLE_LD_TYPES.has(type))) {
    const body = htmlToText(textFromLd(record.articleBody));
    if (body) return body;
  }
  return "";
}

function parseJsonLdDocument(raw: string): unknown {
  const trimmed = decodeHtml(
    raw
      .replace(/^\s*<!--/, "")
      .replace(/-->\s*$/, "")
      .replace(/\/\/<!\[CDATA\[/, "")
      .replace(/\]\]>/, "")
      .trim(),
  );
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function extractJsonLdArticleBody(html: string): string {
  const re = /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const parsed = parseJsonLdDocument(match[1] ?? "");
    const body = findJsonLdArticleBody(parsed);
    if (body) return body;
  }
  return "";
}

function stripNonContent(html: string) {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, "");
}

function firstElementInner(html: string, tag: string): string | undefined {
  const open = new RegExp(`<${tag}\\b[^>]*>`, "i").exec(html);
  if (!open) return undefined;
  const start = open.index + open[0].length;
  const closeAt = html.toLowerCase().indexOf(`</${tag}>`, start);
  if (closeAt === -1) return undefined;
  return html.slice(start, closeAt);
}

export function extractArticleText(html: string): ArticleExtraction | undefined {
  const jsonLd = extractJsonLdArticleBody(html);
  if (jsonLd.length >= NEWS_ARTICLE_MIN_CHARS) {
    return { text: jsonLd.slice(0, NEWS_ARTICLE_BODY_MAX_CHARS), method: "json-ld" };
  }
  const cleaned = stripNonContent(html);
  const article = firstElementInner(cleaned, "article");
  if (article) {
    const text = htmlToText(article);
    if (text.length >= NEWS_ARTICLE_MIN_CHARS) {
      return { text: text.slice(0, NEWS_ARTICLE_BODY_MAX_CHARS), method: "article" };
    }
  }
  const main = firstElementInner(cleaned, "main");
  if (main) {
    const text = htmlToText(main);
    if (text.length >= NEWS_ARTICLE_MIN_CHARS) {
      return { text: text.slice(0, NEWS_ARTICLE_BODY_MAX_CHARS), method: "main" };
    }
  }
  return undefined;
}

export function rssArticleHostAllowlist(sources = rssSources()): ReadonlySet<string> {
  const hosts = new Set<string>();
  for (const source of sources) {
    for (const url of [source.url, ...(source.fallbacks ?? [])]) {
      const normalized = normalizeSourceUrl(url);
      if (!normalized) continue;
      try {
        hosts.add(new URL(normalized).hostname);
      } catch {
        /* ignore unparseable registry rows */
      }
    }
  }
  return hosts;
}

export function looksLikeFeedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (/(?:^|\/)(?:feed|rss|atom)(?:\/|$)/.test(path)) return true;
    if (/\.(?:xml|rss|atom)$/.test(path)) return true;
    if (parsed.searchParams.get("outputType")?.toLowerCase() === "xml") return true;
    return false;
  } catch {
    return true;
  }
}

export function isEligibleNewsArticleUrl(
  raw: string | undefined,
  allowedHosts: ReadonlySet<string>,
  knownSourceUrls?: ReadonlySet<string>,
): string | undefined {
  const normalized = normalizeSourceUrl(raw);
  if (!normalized) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") return undefined;
  if (!allowedHosts.has(parsed.hostname)) return undefined;
  if (looksLikeFeedUrl(normalized)) return undefined;
  if (knownSourceUrls?.has(normalized)) return undefined;
  return normalized;
}

function contentTypeLooksLikeHtml(value: string | null) {
  if (!value) return true;
  const type = value.toLowerCase();
  if (/(?:rss|atom)\+xml/.test(type)) return false;
  if (/xml/.test(type) && !/html|xhtml|xml\+html/.test(type)) return false;
  return /html|xhtml|text\/plain|json/.test(type) || type.startsWith("text/");
}

const ARTICLE_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function articleHostAllowed(hostname: string, allowedHosts: ReadonlySet<string>) {
  const host = normalizedArticleHostname(hostname);
  const withoutWww = host.replace(/^www\./, "");
  return allowedHosts.has(host) || allowedHosts.has(withoutWww);
}

function normalizedArticleHostname(hostname: string) {
  return hostname.replace(/\.$/, "").toLowerCase();
}

function allowlistedRedirectLocation(
  current: string,
  location: string | null,
  allowedHosts: ReadonlySet<string>,
): string | undefined {
  if (!location) return undefined;
  try {
    const next = new URL(location, current);
    if (next.username || next.password) return undefined;
    if (next.protocol === "http:") {
      const currentUrl = new URL(current);
      if (normalizedArticleHostname(next.hostname) !== normalizedArticleHostname(currentUrl.hostname)) {
        return undefined;
      }
      if (next.port && next.port !== "80") return undefined;
      // Some legacy publishers emit an http Location from an HTTPS page and
      // immediately redirect it back to HTTPS. Upgrade it in memory so the
      // Worker never sends a cleartext request, while preserving path/query.
      next.protocol = "https:";
      next.port = "";
    } else if (next.protocol !== "https:") {
      return undefined;
    }
    if (next.port && next.port !== "443") return undefined;
    if (!articleHostAllowed(next.hostname, allowedHosts)) return undefined;
    next.hash = "";
    const href = next.toString();
    if (looksLikeFeedUrl(href)) return undefined;
    return href;
  } catch {
    return undefined;
  }
}

function articleFetchError(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError" || /timeout|timed out|aborted/i.test(error.message)) {
      return "Timed out";
    }
    return clipError(error.message) || "Request failed";
  }
  return "Request failed";
}

export async function fetchAllowlistedArticlePage(options: {
  url: string;
  fetchImpl: typeof fetch;
  allowedHosts: ReadonlySet<string>;
}): Promise<ArticlePageFetchResult> {
  let current = isEligibleNewsArticleUrl(options.url, options.allowedHosts);
  if (!current) return { ok: false, error: "URL is not an allowlisted article page" };
  const seen = new Set<string>();
  for (let hop = 0; hop <= NEWS_ARTICLE_MAX_REDIRECTS; hop += 1) {
    if (seen.has(current)) return { ok: false, error: "Too many redirects" };
    seen.add(current);
    let response: Response;
    try {
      response = await options.fetchImpl(current, {
        headers: {
          "user-agent": SOURCE_USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.1",
        },
        signal: AbortSignal.timeout(NEWS_ARTICLE_TIMEOUT_MS),
        redirect: "manual",
      });
    } catch (error) {
      return { ok: false, error: articleFetchError(error) };
    }
    if (ARTICLE_REDIRECT_STATUSES.has(response.status)) {
      const next = allowlistedRedirectLocation(current, response.headers.get("location"), options.allowedHosts);
      await response.body?.cancel().catch(() => undefined);
      if (!next) return { ok: false, error: "Redirect left allowlist" };
      if (hop >= NEWS_ARTICLE_MAX_REDIRECTS || seen.has(next)) {
        return { ok: false, error: "Too many redirects" };
      }
      // Preserve the validated server target exactly. Identity/cache keys remain
      // canonical, but removing a trailing slash or www here can recreate the
      // redirect we just followed and turn a one-hop redirect into a loop.
      current = next;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, error: `HTTP ${response.status}` };
    }
    if (!contentTypeLooksLikeHtml(response.headers.get("content-type"))) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, error: "Unsupported content type" };
    }
    try {
      const body = await readBoundedText(response, NEWS_ARTICLE_MAX_BYTES);
      return { ok: true, url: current, body };
    } catch (error) {
      return { ok: false, error: articleFetchError(error) };
    }
  }
  return { ok: false, error: "Too many redirects" };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]!);
    }
  }));
  return results;
}

function applyExtractedText(
  item: ContentItem,
  extracted: ArticleExtraction,
  entities: readonly EntityRow[],
): ContentItem {
  const body = extracted.text;
  const orgs = [...new Set([...item.orgs, ...mapSeedOrgIds(`${item.title} ${item.dek} ${body}`, entities)])];
  if (body === item.body && orgs.length === item.orgs.length && orgs.every((id, index) => id === item.orgs[index])) {
    return item;
  }
  return { ...item, body, orgs };
}

export function emptyNewsArticleExtractionMetrics(): NewsArticleExtractionMetrics {
  return {
    eligible: 0,
    due: 0,
    fetched: 0,
    reused: 0,
    success: 0,
    failed: 0,
    noContent: 0,
    preserved: 0,
    capped: 0,
    selectedOriginCounts: {},
  };
}

export function newsArticleBackoffMs(
  state: NewsArticleExtractionStateName,
  attemptCount: number,
) {
  if (state === "success") return NEWS_ARTICLE_SUCCESS_REFRESH_MS;
  const safeCount = Math.max(1, Math.trunc(attemptCount) || 1);
  return Math.min(NEWS_ARTICLE_FAILURE_MAX_MS, NEWS_ARTICLE_FAILURE_BASE_MS * (2 ** (safeCount - 1)));
}

export function isNewsExtractionDue(
  record: NewsArticleExtractionState | undefined,
  now: Date,
) {
  if (!record) return true;
  const next = Date.parse(record.nextAttemptAt);
  if (!Number.isFinite(next)) return true;
  return now.getTime() >= next;
}

export type FairNewsArticleCandidate = {
  origin: string;
  publishedAt: number;
  index: number;
};

export function selectFairNewsArticleCandidates<T extends FairNewsArticleCandidate>(
  rows: readonly T[],
  cap: number,
): T[] {
  const limit = Math.max(0, Math.trunc(cap) || 0);
  if (limit === 0 || rows.length === 0) return [];
  const byOrigin = new Map<string, T[]>();
  const originOrder: string[] = [];
  for (const row of rows) {
    const origin = row.origin || "unknown";
    let list = byOrigin.get(origin);
    if (!list) {
      list = [];
      byOrigin.set(origin, list);
      originOrder.push(origin);
    }
    list.push(row);
  }
  for (const list of byOrigin.values()) {
    list.sort((left, right) => {
      const leftDate = Number.isFinite(left.publishedAt) ? left.publishedAt : 0;
      const rightDate = Number.isFinite(right.publishedAt) ? right.publishedAt : 0;
      return rightDate - leftDate || left.index - right.index;
    });
  }
  const selected: T[] = [];
  let round = 0;
  while (selected.length < limit) {
    let added = false;
    for (const origin of originOrder) {
      const item = byOrigin.get(origin)?.[round];
      if (!item) continue;
      selected.push(item);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
    round += 1;
  }
  return selected;
}

function cachedArticleExtraction(record: NewsArticleExtractionState | undefined): ArticleExtraction | undefined {
  const text = record?.cachedText?.trim();
  if (!text) return undefined;
  const method = record?.method === "json-ld" || record?.method === "article" || record?.method === "main"
    ? record?.method
    : "article";
  return { text: text.slice(0, NEWS_ARTICLE_BODY_MAX_CHARS), method };
}

function applyCachedExtraction(
  item: ContentItem,
  record: NewsArticleExtractionState | undefined,
  entities: readonly EntityRow[],
): ContentItem {
  const extracted = cachedArticleExtraction(record);
  return extracted ? applyExtractedText(item, extracted, entities) : item;
}

function nextAttemptCount(
  previous: NewsArticleExtractionState | undefined,
  state: NewsArticleExtractionStateName,
) {
  if (state === "success") return 1;
  if (previous && previous.state !== "success") return Math.max(1, previous.attemptCount) + 1;
  return 1;
}

function buildNewsArticleAttempt(options: {
  url: string;
  state: NewsArticleExtractionStateName;
  previous?: NewsArticleExtractionState;
  extracted?: ArticleExtraction;
  error?: string | null;
  now: Date;
}): NewsArticleExtractionAttempt {
  const attemptedAt = options.now.toISOString();
  const attemptCount = nextAttemptCount(options.previous, options.state);
  const cachedText = options.state === "success"
    ? (options.extracted?.text ?? options.previous?.cachedText ?? null)
    : (options.previous?.cachedText ?? options.extracted?.text ?? null);
  const method = options.state === "success"
    ? (options.extracted?.method ?? options.previous?.method ?? null)
    : (options.previous?.method ?? options.extracted?.method ?? null);
  const lastSuccessAt = options.state === "success"
    ? attemptedAt
    : (options.previous?.lastSuccessAt ?? null);
  return {
    url: options.url,
    state: options.state,
    cachedText: cachedText ? cachedText.slice(0, NEWS_ARTICLE_BODY_MAX_CHARS) : null,
    method: method === "json-ld" || method === "article" || method === "main" ? method : null,
    attemptCount,
    lastAttemptedAt: attemptedAt,
    lastSuccessAt,
    nextAttemptAt: new Date(options.now.getTime() + newsArticleBackoffMs(options.state, attemptCount)).toISOString(),
    error: options.state === "success" ? null : clipError(options.error ?? "") || null,
    attemptedAt,
  };
}

type EligibleArticle = {
  item: ContentItem;
  index: number;
  url: string;
  origin: string;
  publishedAt: number;
};

export async function overlayNewsArticles(
  items: ContentItem[],
  options: NewsArticleOverlayOptions,
): Promise<NewsArticleOverlayResult> {
  const metrics = emptyNewsArticleExtractionMetrics();
  if (items.length === 0) return { items, attempts: [], metrics };
  const allowedHosts = options.allowedHosts ?? rssArticleHostAllowlist();
  const cap = options.candidateCap ?? NEWS_ARTICLE_CANDIDATE_CAP;
  const concurrency = options.concurrency ?? NEWS_ARTICLE_CONCURRENCY;
  const entities = options.entities ?? seedEntities;
  const now = options.now ?? new Date();
  const states = options.newsExtractions ?? new Map<string, NewsArticleExtractionState>();
  const eligible: EligibleArticle[] = [];
  for (const [index, item] of items.entries()) {
    const url = isEligibleNewsArticleUrl(item.source.url, allowedHosts, options.knownSourceUrls);
    if (!url) continue;
    eligible.push({
      item,
      index,
      url,
      origin: item.source.origin,
      publishedAt: Date.parse(item.publishedAt ?? ""),
    });
  }
  metrics.eligible = eligible.length;
  if (eligible.length === 0) return { items, attempts: [], metrics };

  const reused: EligibleArticle[] = [];
  const due: EligibleArticle[] = [];
  for (const row of eligible) {
    if (isNewsExtractionDue(states.get(row.url), now)) due.push(row);
    else reused.push(row);
  }
  metrics.due = due.length;
  metrics.reused = reused.length;

  const selected = selectFairNewsArticleCandidates(due, cap);
  const selectedSet = new Set(selected);
  const capped = due.filter((row) => !selectedSet.has(row));
  metrics.capped = capped.length;
  metrics.fetched = selected.length;
  for (const row of selected) {
    metrics.selectedOriginCounts[row.origin] = (metrics.selectedOriginCounts[row.origin] ?? 0) + 1;
  }

  const next = items.slice();
  for (const row of [...reused, ...capped]) {
    next[row.index] = applyCachedExtraction(row.item, states.get(row.url), entities);
  }

  const attempts: NewsArticleExtractionAttempt[] = [];
  const overlays = await mapWithConcurrency(selected, concurrency, async (row) => {
    const previous = states.get(row.url);
    try {
      const page = await fetchAllowlistedArticlePage({
        url: row.url,
        fetchImpl: options.fetchImpl,
        allowedHosts,
      });
      if (!page.ok) {
        return {
          attempt: buildNewsArticleAttempt({
            url: row.url,
            state: "failed",
            previous,
            error: page.error,
            now,
          }),
        };
      }
      const extracted = extractArticleText(page.body);
      if (!extracted) {
        return {
          attempt: buildNewsArticleAttempt({
            url: row.url,
            state: "no-content",
            previous,
            error: "No usable article body",
            now,
          }),
        };
      }
      return {
        item: applyExtractedText(row.item, extracted, entities),
        attempt: buildNewsArticleAttempt({
          url: row.url,
          state: "success",
          previous,
          extracted,
          now,
        }),
      };
    } catch (error) {
      return {
        attempt: buildNewsArticleAttempt({
          url: row.url,
          state: "failed",
          previous,
          error: articleFetchError(error),
          now,
        }),
      };
    }
  });

  for (const [index, overlay] of overlays.entries()) {
    const row = selected[index]!;
    attempts.push(overlay.attempt);
    if (overlay.attempt.state === "success") metrics.success += 1;
    else if (overlay.attempt.state === "no-content") metrics.noContent += 1;
    else metrics.failed += 1;
    if (overlay.item) {
      next[row.index] = overlay.item;
      continue;
    }
    const preserved = applyCachedExtraction(row.item, overlay.attempt, entities);
    if (preserved !== row.item) {
      next[row.index] = preserved;
      metrics.preserved += 1;
    }
  }

  return { items: next, attempts, metrics };
}
