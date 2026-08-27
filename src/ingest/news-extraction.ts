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
  NEWS_ARTICLE_MAX_BYTES,
  NEWS_ARTICLE_MAX_REDIRECTS,
  NEWS_ARTICLE_MIN_CHARS,
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

export type NewsArticleOverlayOptions = {
  fetchImpl: typeof fetch;
  entities?: readonly EntityRow[];
  allowedHosts?: ReadonlySet<string>;
  knownSourceUrls?: ReadonlySet<string>;
  candidateCap?: number;
  concurrency?: number;
};

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

function redirectLocation(current: string, location: string | null): string | undefined {
  if (!location) return undefined;
  try {
    return new URL(location, current).toString();
  } catch {
    return undefined;
  }
}

export async function fetchAllowlistedArticlePage(options: {
  url: string;
  fetchImpl: typeof fetch;
  allowedHosts: ReadonlySet<string>;
}): Promise<{ url: string; body: string } | undefined> {
  let current = isEligibleNewsArticleUrl(options.url, options.allowedHosts);
  if (!current) return undefined;
  for (let hop = 0; hop <= NEWS_ARTICLE_MAX_REDIRECTS; hop += 1) {
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
    } catch {
      return undefined;
    }
    if (response.status >= 300 && response.status < 400) {
      const next = redirectLocation(current, response.headers.get("location"));
      await response.body?.cancel().catch(() => undefined);
      const eligible = isEligibleNewsArticleUrl(next, options.allowedHosts);
      if (!eligible) return undefined;
      current = eligible;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    if (!contentTypeLooksLikeHtml(response.headers.get("content-type"))) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    try {
      const body = await readBoundedText(response, NEWS_ARTICLE_MAX_BYTES);
      return { url: current, body };
    } catch {
      return undefined;
    }
  }
  return undefined;
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

export async function overlayNewsArticles(
  items: ContentItem[],
  options: NewsArticleOverlayOptions,
): Promise<ContentItem[]> {
  if (items.length === 0) return items;
  const allowedHosts = options.allowedHosts ?? rssArticleHostAllowlist();
  const cap = options.candidateCap ?? NEWS_ARTICLE_CANDIDATE_CAP;
  const concurrency = options.concurrency ?? NEWS_ARTICLE_CONCURRENCY;
  const entities = options.entities ?? seedEntities;
  const eligible = items
    .map((item, index) => {
      const url = isEligibleNewsArticleUrl(item.source.url, allowedHosts, options.knownSourceUrls);
      return url ? { item, index, url, publishedAt: Date.parse(item.publishedAt ?? "") } : undefined;
    })
    .filter((row): row is { item: ContentItem; index: number; url: string; publishedAt: number } => Boolean(row))
    .sort((left, right) => {
      const leftDate = Number.isFinite(left.publishedAt) ? left.publishedAt : 0;
      const rightDate = Number.isFinite(right.publishedAt) ? right.publishedAt : 0;
      return rightDate - leftDate || left.index - right.index;
    })
    .slice(0, Math.max(0, cap));
  if (eligible.length === 0) return items;

  const overlays = await mapWithConcurrency(eligible, concurrency, async (row) => {
    try {
      const page = await fetchAllowlistedArticlePage({
        url: row.url,
        fetchImpl: options.fetchImpl,
        allowedHosts,
      });
      if (!page) return undefined;
      const extracted = extractArticleText(page.body);
      if (!extracted) return undefined;
      return { index: row.index, item: applyExtractedText(row.item, extracted, entities) };
    } catch {
      return undefined;
    }
  });

  const next = items.slice();
  for (const overlay of overlays) {
    if (!overlay) continue;
    next[overlay.index] = overlay.item;
  }
  return next;
}
