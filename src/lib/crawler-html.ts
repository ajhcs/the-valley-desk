import type { ContentItem } from "../content/schema";
import type { Entity } from "../content/entity";
import { itemJsonLd } from "../content/jsonld";
import { bindSeedOrgIds, latestNews, latestVoices, leadItem, publishedNewsList, upcomingEvents } from "../content/queries";
import { liveSeedOrgIds } from "../content/seed";
import { loadEntities } from "../content/store";
import { canonicalPath, canonicalUrl, publicUrl } from "./canonical";
import { runtimeItemsScript } from "../ingest/public-feed";

const SITE = "The Valley Desk";
const DEFAULT_DESC = "Local health-tech news for people and agents";

let queriesBound = false;

function ensureQueriesBound() {
  if (queriesBound) return;
  bindSeedOrgIds(liveSeedOrgIds(loadEntities()));
  queriesBound = true;
}

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stripSlash(path: string) {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

export function routeHead(
  path: string,
  origin: string,
  dynamicItem?: Pick<ContentItem, "kind" | "slug" | "title" | "impactSentence" | "dek" | "body">,
) {
  const p = stripSlash(path) || "/";
  const item = dynamicItem;
  let title = SITE;
  let desc = DEFAULT_DESC;
  if (item) {
    title = `${item.title} · ${SITE}`;
    desc = item.impactSentence || item.dek || item.title;
  } else if (p === "/news") title = `News · ${SITE}`;
  else if (p === "/events") title = `Events · ${SITE}`;
  else if (p === "/voices") {
    title = `Voices · ${SITE}`;
    desc = "Voices";
  }
  const url = publicUrl(p, origin);
  const articleKinds = new Set(["news", "policy", "ai", "interview"]);
  const type = item && articleKinds.has(item.kind) ? "article" : "website";
  return { title, desc, url, type, isLab: p.startsWith("/lab") };
}

function websiteJsonLd(origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE,
    url: publicUrl("/", origin),
    description: DEFAULT_DESC,
    inLanguage: "en-US",
  };
}

function collectionJsonLd(path: string, origin: string, name: string) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${name} · ${SITE}`,
    url: publicUrl(path, origin),
    isPartOf: { "@type": "WebSite", name: SITE, url: publicUrl("/", origin) },
  };
}

function webPageJsonLd(item: ContentItem, origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: item.title,
    description: item.impactSentence || item.dek || item.title,
    url: canonicalUrl(item, origin),
    isPartOf: { "@type": "WebSite", name: SITE, url: publicUrl("/", origin) },
  };
}

export function routeJsonLd(
  path: string,
  origin: string,
  items: ContentItem[],
  dynamicItem?: ContentItem,
  entities: Entity[] = [],
) {
  ensureQueriesBound();
  const p = stripSlash(path) || "/";
  if (p.startsWith("/lab")) return [];
  const graph: unknown[] = [websiteJsonLd(origin)];
  if (p === "/") {
    const rankedNews = latestNews(items, 7);
    const lead = rankedNews[0] ?? leadItem(items);
    if (lead) {
      const ld = itemJsonLd(lead, entities, origin);
      if (ld) graph.push(ld);
    }
    return graph;
  }
  if (p === "/news") {
    graph.push(collectionJsonLd("/news", origin, "News"));
    return graph;
  }
  if (p === "/events") {
    graph.push(collectionJsonLd("/events", origin, "Events"));
    return graph;
  }
  if (p === "/voices") {
    graph.push(collectionJsonLd("/voices", origin, "Voices"));
    return graph;
  }
  if (dynamicItem) {
    const ld = itemJsonLd(dynamicItem, entities, origin) ?? webPageJsonLd(dynamicItem, origin);
    graph.push(ld);
  }
  return graph;
}

function linkItem(item: ContentItem, origin: string) {
  return `<li><a href="${esc(canonicalUrl(item, origin))}">${esc(item.title)}</a></li>`;
}

export function primaryNoscript(
  path: string,
  origin: string,
  items: ContentItem[],
  dynamicItem?: ContentItem,
) {
  ensureQueriesBound();
  const p = stripSlash(path) || "/";
  const feeds = `<p><a href="${esc(publicUrl("/feed.json", origin))}">JSON feed</a> · <a href="${esc(publicUrl("/feed.xml", origin))}">XML feed</a></p>`;
  if (p === "/") {
    const rankedNews = latestNews(items, 7);
    const lead = rankedNews[0] ?? leadItem(items);
    const rest = rankedNews.filter((item) => item.id !== lead?.id).slice(0, 6);
    const events = upcomingEvents(items).slice(0, 4);
    const voices = latestVoices(items, 4);
    return [
      `<h1>${esc(SITE)}</h1>`,
      `<p>${esc(DEFAULT_DESC)}</p>`,
      lead
        ? `<article><p>Latest news</p><h2><a href="${esc(canonicalUrl(lead, origin))}">${esc(lead.title)}</a></h2><p>${esc(lead.impactSentence || lead.dek || lead.title)}</p></article>`
        : "",
      rest.length ? `<h2>News</h2><ul>${rest.map((item) => linkItem(item, origin)).join("")}</ul>` : "",
      events.length ? `<h2>Events</h2><ul>${events.map((item) => linkItem(item, origin)).join("")}</ul>` : "",
      voices.length ? `<h2>Voices</h2><ul>${voices.map((item) => linkItem(item, origin)).join("")}</ul>` : "",
      feeds,
    ].filter(Boolean).join("");
  }
  if (dynamicItem) {
    const citations = (dynamicItem.citations ?? [])
      .filter((citation) => citation.url)
      .slice(0, 6)
      .map((citation) => `<li><a href="${esc(citation.url)}">${esc(citation.name || citation.url)}</a></li>`)
      .join("");
    return [
      `<h1>${esc(dynamicItem.title)}</h1>`,
      `<p>${esc(dynamicItem.impactSentence || dynamicItem.dek || dynamicItem.title)}</p>`,
      dynamicItem.body ? `<p>${esc(dynamicItem.body.slice(0, 800))}</p>` : "",
      citations ? `<h2>Sources</h2><ul>${citations}</ul>` : "",
      `<p><a href="${esc(publicUrl(canonicalPath(dynamicItem).replace(/\/[^/]+$/, "") || "/", origin))}">More from ${esc(SITE)}</a></p>`,
      feeds,
    ].filter(Boolean).join("");
  }
  if (p === "/news") {
    const rows = publishedNewsList(items).slice(0, 12);
    return [`<h1>News · ${esc(SITE)}</h1>`, `<ul>${rows.map((item) => linkItem(item, origin)).join("")}</ul>`, feeds].join("");
  }
  if (p === "/events") {
    const rows = upcomingEvents(items, new Date(), 12);
    return [`<h1>Events · ${esc(SITE)}</h1>`, `<ul>${rows.map((item) => linkItem(item, origin)).join("")}</ul>`, feeds].join("");
  }
  if (p === "/voices") {
    const rows = latestVoices(items, 12);
    return [`<h1>Voices · ${esc(SITE)}</h1>`, `<ul>${rows.map((item) => linkItem(item, origin)).join("")}</ul>`, feeds].join("");
  }
  return [`<h1>${esc(SITE)}</h1>`, `<p>${esc(DEFAULT_DESC)}</p>`, feeds].join("");
}

function jsonLdTag(data: unknown, nonce: string) {
  return `<script type="application/ld+json" nonce="${esc(nonce)}">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`;
}

export function decorateHtml(options: {
  html: string;
  path: string;
  origin: string;
  nonce: string;
  item?: ContentItem;
  items?: ContentItem[];
  withdrawnIds?: readonly string[];
  notFound?: boolean;
  entities?: Entity[];
}) {
  const items = options.items ?? [];
  const { title, desc, url, type, isLab } = options.notFound
    ? {
      title: `Not found · ${SITE}`,
      desc: "This page is not published.",
      url: publicUrl(stripSlash(options.path) || "/", options.origin),
      type: "website",
      isLab: false,
    }
    : routeHead(options.path, options.origin, options.item);
  const jsonLd = options.notFound
    ? []
    : routeJsonLd(options.path, options.origin, items, options.item, options.entities);
  const noscript = options.notFound
    ? `<h1>Not found</h1><p>This page is not published.</p><p><a href="${esc(publicUrl("/", options.origin))}">Back to the desk</a></p>`
    : primaryNoscript(options.path, options.origin, items, options.item);
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    ...((options.notFound || isLab) ? [`<meta name="robots" content="${isLab ? "noindex, nofollow" : "noindex"}" />`] : []),
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:type" content="${esc(type)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(desc)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<link rel="alternate" type="application/rss+xml" href="${esc(publicUrl("/feed.xml", options.origin))}" />`,
    `<link rel="alternate" type="application/json" href="${esc(publicUrl("/feed.json", options.origin))}" />`,
    `<script nonce="${esc(options.nonce)}">globalThis.__VALLEY_DESK_PUBLIC_ORIGIN__=${JSON.stringify(options.origin)};</script>`,
    ...jsonLd.map((doc) => jsonLdTag(doc, options.nonce)),
  ].join("\n    ");
  let html = options.html.replace("<title>The Valley Desk</title>", tags);
  html = html.replace(
    /<noscript id="tvd-primary">[\s\S]*?<\/noscript>/,
    `<noscript id="tvd-primary">${noscript}</noscript>`,
  );
  if (!options.notFound) {
    html = html.replace(
      "</head>",
      `${runtimeItemsScript(items, options.withdrawnIds ?? [], options.nonce)}\n  </head>`,
    );
  }
  return html;
}
