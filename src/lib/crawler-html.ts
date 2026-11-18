import type { ContentItem } from "../content/schema";
import type { Entity } from "../content/entity";
import { itemJsonLd } from "../content/jsonld";
import {
  listCanonicalPath,
  listPagePath,
  pageFromSearch,
  paginate,
  type PageWindow,
} from "../content/pagination";
import { bindSeedOrgIds, latestNews, latestVoices, leadItem, upcomingEvents } from "../content/queries";
import { filteredEventsPage, filteredNewsPage, newsEventIndexState } from "../content/news-event-filters";
import { liveSeedOrgIds } from "../content/seed";
import { loadEntities } from "../content/store";
import { canonicalPath, canonicalUrl, publicUrl } from "./canonical";
import { runtimeItemsScript } from "../ingest/public-feed";
import type { WatchPublicRecord } from "../content/watch-schema";
import { watchDirectoryPath } from "../content/watch-query";
import { watchPageHead, type WatchPageResult } from "./watch-page";
import { normalizePublicFeatures, type PublicFeatures } from "./public-features";

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

type RouteList = { path: string; name: string; window: PageWindow<unknown>;
  index?: ReturnType<typeof newsEventIndexState>; errors?: string[] };
type ContentRouteList = Omit<RouteList, "window"> & { window: PageWindow<ContentItem> };

function listWindow(path: string, items: ContentItem[], search?: string): ContentRouteList | undefined {
  ensureQueriesBound();
  const p = stripSlash(path) || "/";
  if (p === "/news" || p === "/events") {
    const result = p === "/news" ? filteredNewsPage(items, search ?? "") : filteredEventsPage(items, search ?? "");
    return { path: p, name: p === "/news" ? "News" : "Events", window: result.page,
      index: newsEventIndexState(p, result.request, result.page), errors: result.request.errors };
  }
  if (p === "/voices") {
    return {
      path: p,
      name: "Voices",
      window: paginate(latestVoices(items, Number.MAX_SAFE_INTEGER), pageFromSearch(search)),
    };
  }
  return undefined;
}

function canonicalListPath(list: RouteList) {
  return list.index?.canonicalPath ?? listCanonicalPath(list.path, list.window);
}
function adjacentListPath(list: RouteList, direction: "prev" | "next") {
  if (list.index) return direction === "prev" ? list.index.prevPath : list.index.nextPath;
  const page = direction === "prev" ? list.window.prevPage : list.window.nextPage;
  return page == null ? undefined : listPagePath(list.path, page);
}

export function routeHead(
  path: string,
  origin: string,
  dynamicItem?: Pick<ContentItem, "kind" | "slug" | "title" | "impactSentence" | "dek" | "body">,
  list?: RouteList,
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
  } else if (p === "/policy") {
    title = `Healthcare policy watchlist · ${SITE}`;
    desc = "Observed Pennsylvania healthcare legislation, version-bound evidence and reviewed background—not new reporting.";
  }
  if (list?.window.indexable && list.window.page > 1) {
    title = `${list.name} · Page ${list.window.page} · ${SITE}`;
  }
  const url = list
    ? publicUrl(canonicalListPath(list), origin)
    : publicUrl(p, origin);
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

function paginationNav(list: RouteList, origin: string) {
  const { window, name: label } = list;
  if (window.totalPages <= 1 && window.indexable) return "";
  const prevPath = adjacentListPath(list, "prev"), nextPath = adjacentListPath(list, "next");
  const prev = prevPath
    ? `<a rel="prev" href="${esc(publicUrl(prevPath, origin))}">Previous</a>`
    : "";
  const next = nextPath
    ? `<a rel="next" href="${esc(publicUrl(nextPath, origin))}">Next</a>`
    : "";
  const status = window.indexable
    ? `Page ${window.page} of ${window.totalPages}`
    : "This page is not in the list.";
  return `<nav aria-label="${esc(label)} pagination">${prev}<p>${esc(status)}</p>${next}</nav>`;
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
  search?: string,
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
  const list = listWindow(p, items, search);
  if (list) {
    const loc = canonicalListPath(list);
    const name = list.window.indexable && list.window.page > 1
      ? `${list.name} · Page ${list.window.page}`
      : list.name;
    graph.push(collectionJsonLd(loc, origin, name));
    return graph;
  }
  if (p === "/policy") {
    graph.push(collectionJsonLd("/policy", origin, "Policy background"));
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
  search?: string,
  publicFeatures?: PublicFeatures,
) {
  ensureQueriesBound();
  const p = stripSlash(path) || "/";
  const feeds = `<p><a href="${esc(publicUrl("/feed.json", origin))}">JSON feed</a> · <a href="${esc(publicUrl("/feed.xml", origin))}">XML feed</a></p>`;
  if (p === "/policy") return `<h1>Healthcare policy watchlist</h1><p>Observed legislative background, not new reporting. Enable JavaScript for the evidence view, or read the <a href="/api/policy-watchlist">public baseline JSON</a>.</p>`;
  if (p === "/") {
    const rankedNews = latestNews(items, 7);
    const lead = rankedNews[0] ?? leadItem(items);
    const rest = rankedNews.filter((item) => item.id !== lead?.id).slice(0, 6);
    const events = upcomingEvents(items).slice(0, 4);
    return [
      `<h1>${esc(SITE)}</h1>`,
      `<p>${esc(DEFAULT_DESC)}</p>`,
      normalizePublicFeatures(publicFeatures).discovery
        ? '<form role="search" action="/discover/works" method="get"><label for="fallback-discovery">Find regional health-tech projects</label> <input id="fallback-discovery" name="q" type="search" maxlength="200"> <button type="submit">Search</button> <a href="/discover/works">Browse projects</a></form>'
        : "",
      lead
        ? `<article><p>Latest news</p><h2><a href="${esc(canonicalUrl(lead, origin))}">${esc(lead.title)}</a></h2><p>${esc(lead.impactSentence || lead.dek || lead.title)}</p></article>`
        : "",
      rest.length ? `<h2>News</h2><ul>${rest.map((item) => linkItem(item, origin)).join("")}</ul>` : "",
      events.length ? `<h2>Events</h2><ul>${events.map((item) => linkItem(item, origin)).join("")}</ul>` : "",
      normalizePublicFeatures(publicFeatures).watch ? `<nav aria-label="Watch sections"><h2><a href="${esc(publicUrl("/policy-watch", origin))}">Policy Watch</a></h2><h2><a href="${esc(publicUrl("/technology-watch", origin))}">Technology Watch</a></h2></nav>` : "",
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
  const list = listWindow(p, items, search);
  if (list) {
    const rows = list.window.items;
    const heading = list.window.indexable && list.window.page > 1
      ? `${list.name} · Page ${list.window.page} · ${esc(SITE)}`
      : `${list.name} · ${esc(SITE)}`;
    return [
      `<h1>${heading}</h1>`,
      list.errors?.length ? `<p role="alert">${esc(list.errors.join(" "))}</p>` : "",
      rows.length ? `<ul>${rows.map((item) => linkItem(item, origin)).join("")}</ul>` : "",
      !rows.length && !list.errors?.length && list.window.indexable ? "<p>No published items match this view.</p>" : "",
      paginationNav(list, origin),
      feeds,
    ].filter(Boolean).join("");
  }
  return [`<h1>${esc(SITE)}</h1>`, `<p>${esc(DEFAULT_DESC)}</p>`, feeds].join("");
}

function jsonLdTag(data: unknown, nonce: string) {
  return `<script type="application/ld+json" nonce="${esc(nonce)}">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`;
}

function watchContext(item: WatchPublicRecord) {
  return (item.kind === "policy" ? item.summary?.value : item.purpose?.value) ?? "Context not yet established.";
}

function watchSources(item: WatchPublicRecord, detail: boolean) {
  const contextIds = new Set((item.kind === "policy" ? item.summary : item.purpose)?.evidenceIds ?? []);
  const selected = detail ? item.sources : [...item.sources.filter(source => contextIds.has(source.id)),
    ...item.sources.filter(source => !contextIds.has(source.id))].slice(0, 3);
  return `<h${detail ? "2" : "3"}>${detail ? "Accepted sources" : "Selected sources"}</h${detail ? "2" : "3"}><ul>${selected.map(source =>
    `<li><a href="${esc(source.url)}" rel="noreferrer">${esc(source.label)}</a>${detail && source.locator ? `<p>${esc(source.locator)}</p>` : ""}${detail && source.quote ? `<blockquote>${esc(source.quote)}</blockquote>` : ""}</li>`).join("")}</ul>`;
}

function watchRecordContext(item: WatchPublicRecord) {
  if (item.kind === "policy") {
    const action = item.latestAction?.value;
    const occurred = action?.sourceOccurredAt;
    const sourceDate = occurred?.precision === "day" ? `${occurred.value} (date only${occurred.timezone ? `; ${occurred.timezone}` : "; timezone not established"})` :
      occurred?.precision === "instant" ? occurred.value : "Source action date not established.";
    return `<p>${esc(item.identity.value.sourceInstrumentId)} | ${esc(item.jurisdiction)}</p><dl><dt>Lifecycle</dt><dd>${esc(item.lifecycle)}</dd><dt>Legal effect</dt><dd>${esc(item.legalEffect)}</dd><dt>Interpretation</dt><dd>${esc(item.interpretation.readiness)}</dd></dl>` +
      (action ? `<h2>Latest action</h2><p>${esc(action.text)}</p><p>${esc(sourceDate)}</p>` : "<p>Latest action not yet established.</p>") +
      (item.interpretation.summary ? `<h2>Reviewed interpretation</h2><p>${esc(item.interpretation.summary.value)}</p>` :
        `<p>${esc(item.interpretation.reason ?? "Provision-level interpretation is not yet established.")}</p>`);
  }
  const connections = item.localRelationships.map(({ value }) => `<li>${esc(value.entityName)}: ${esc(value.type)} (${esc(value.temporalStatus)} connection; checked ${esc(value.checkedAt)})</li>`).join("");
  const artifacts = item.artifacts.map(({ value }) => `<li><a href="${esc(value.url)}" rel="noreferrer">${esc(value.artifactType)}: ${esc(value.nativeId)}</a> | ${esc(value.version)} | ${esc(value.availability)}</li>`).join("");
  const licenses = item.licenses.map(({ value }) => `<li>${esc(value.scope)} | ${esc(value.artifactVersion)} | ${esc(value.classification)}${value.spdxId ? ` (${esc(value.spdxId)})` : ""}${value.sourceUrl ? ` | <a href="${esc(value.sourceUrl)}" rel="noreferrer">License source</a>` : ""}${value.conditions.length ? `<ul>${value.conditions.map(condition => `<li>${esc(condition)}</li>`).join("")}</ul>` : ""}</li>`).join("");
  const workflow = item.workflow?.value;
  const setup = item.setup?.value;
  return `<p>Resource type: ${esc(item.resourceType)}</p><h2>Verified local connections</h2><ul>${connections}</ul>` +
    (item.intendedUsers ? `<h2>Intended users</h2><ul>${item.intendedUsers.value.map(user => `<li>${esc(user)}</li>`).join("")}</ul>` : "") +
    (workflow ? `<h2>Workflow</h2><dl><dt>Inputs</dt><dd>${workflow.inputs.map(esc).join("; ")}</dd><dt>Steps</dt><dd>${workflow.steps.map(esc).join("; ")}</dd><dt>Outputs</dt><dd>${workflow.outputs.map(esc).join("; ")}</dd></dl>` : "<p>Workflow not yet established.</p>") +
    (setup ? `<h2>Access and setup</h2><p>${esc(setup.verification)} | ${esc(setup.version ?? "Version not established")}</p>${setup.prerequisites ? `<ul>${setup.prerequisites.map(value => `<li>${esc(value)}</li>`).join("")}</ul>` : "<p>Prerequisites not established.</p>"}${setup.guideUrl ? `<p><a href="${esc(setup.guideUrl)}" rel="noreferrer">Setup guide</a></p>` : ""}` : "<p>Setup not yet established.</p>") +
    `<h2>Artifacts</h2><ul>${artifacts}</ul><h2>Artifact licenses</h2>${licenses ? `<ul>${licenses}</ul>` : "<p>License terms not yet established.</p>"}` +
    (item.limitations ? `<h2>Limitations</h2><ul>${item.limitations.value.map(value => `<li>${esc(value)}</li>`).join("")}</ul>` : "");
}

/** Watch is a separate accepted representation, never a v1 article or feed item. */
export function watchPrimaryNoscript(result: WatchPageResult, origin: string) {
  const head = watchPageHead(result);
  const base = watchDirectoryPath(result.route.kind);
  if (result.status !== 200 || !result.data) {
    const restart = result.status === 410 && !result.route.query.errors.length
      ? watchDirectoryPath(result.route.kind, result.route.query.values) : base;
    return `<h1>${esc(head.title.replace(/ \| The Valley Desk$/, ""))}</h1><p role="alert">${esc(head.desc)}</p><p><a href="${esc(publicUrl(result.status === 404 ? "/" : restart, origin))}">${result.status === 404 ? "Back to the desk" : "Start a new search"}</a></p>`;
  }
  const { response, stale } = result.data;
  const state = `${stale ? "<p>Showing the last accepted fallback. Current data may be delayed.</p>" : ""}<p>Source-check freshness is not reported.</p>` +
    `<p>Published projection as of: ${response.asOf ? `<time datetime="${esc(response.asOf)}">${esc(response.asOf)}</time>` : "not established"}.</p>`;
  if (response.version === "watch-detail-1") {
    const item = response.item;
    return `<h1>${esc(item.title)}</h1>${state}<p>${esc(watchContext(item))}</p>${watchRecordContext(item)}` +
      `<p>Oldest included fact verification: <time datetime="${esc(item.verifiedAt)}">${esc(item.verifiedAt)}</time>.</p>` +
      (item.unknowns.length ? `<h2>Not yet established</h2><ul>${item.unknowns.map(value => `<li>${esc(value.field)}: ${esc(value.reason)}</li>`).join("")}</ul>` : "") +
      `${watchSources(item, true)}<p><a href="${esc(publicUrl(base, origin))}">Back to ${result.route.kind === "policy" ? "Policy Watch" : "Technology Watch"}</a></p>`;
  }
  const rows = response.items.map(item => `<li><article><h2><a href="${esc(publicUrl(`${base}/${item.slug}`, origin))}">${esc(item.title)}</a></h2><p>${esc(watchContext(item).slice(0, 800))}${watchContext(item).length > 800 ? "..." : ""}</p>` +
    (item.kind === "policy" ? `<p>Jurisdiction: ${esc(item.jurisdiction)} | Lifecycle: ${esc(item.lifecycle)} | Legal effect: ${esc(item.legalEffect)} | Interpretation: ${esc(item.interpretation.readiness)}</p>` :
      `<p>Resource type: ${esc(item.resourceType)}</p><ul>${item.localRelationships.map(({ value }) => `<li>${esc(value.entityName)}: ${esc(value.type)} (${esc(value.temporalStatus)} connection)</li>`).join("")}</ul>`) +
    `${watchSources(item, false)}</article></li>`).join("");
  const first = result.route.query.values.cursor ? `<a href="${esc(publicUrl(watchDirectoryPath(result.route.kind, result.route.query.values), origin))}">First page</a>` : "";
  const next = response.nextCursor ? `<a rel="next" href="${esc(publicUrl(watchDirectoryPath(result.route.kind, result.route.query.values, response.nextCursor), origin))}">Next records</a>` : "";
  return `<h1>${result.route.kind === "policy" ? "Policy Watch" : "Technology Watch"}</h1>${state}<p>${response.items.length} records on this page.</p>` +
    (rows ? `<ul>${rows}</ul>` : `<p>${result.route.query.active ? "No records match these filters." : "No accepted records are listed yet."}</p>`) +
    (first || next ? `<nav aria-label="Watch pagination">${first}${next}</nav>` : "");
}

export function decorateWatchHtml(options: { html: string; result: WatchPageResult; origin: string; nonce: string; publicFeatures?: PublicFeatures }) {
  const { title, desc, canonicalPath } = watchPageHead(options.result);
  const url = publicUrl(canonicalPath, options.origin);
  const tags = [
    `<title>${esc(title)}</title>`, `<meta name="description" content="${esc(desc)}" />`,
    '<meta name="robots" content="noindex" />',
    `<meta property="og:title" content="${esc(title)}" />`, `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`, '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${SITE}" />`, '<meta property="og:locale" content="en_US" />',
    '<meta name="twitter:card" content="summary" />', `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(desc)}" />`, `<link rel="canonical" href="${esc(url)}" />`,
    `<script nonce="${esc(options.nonce)}">globalThis.__VALLEY_DESK_PUBLIC_ORIGIN__=${JSON.stringify(options.origin).replaceAll("<", "\\u003c")};globalThis.__VALLEY_DESK_PUBLIC_FEATURES__=${JSON.stringify(normalizePublicFeatures(options.publicFeatures))};</script>`,
  ].join("\n    ");
  return options.html.replace("<title>The Valley Desk</title>", () => tags).replace(
    /<noscript id="tvd-primary">[\s\S]*?<\/noscript>/,
    () => `<noscript id="tvd-primary">${watchPrimaryNoscript(options.result, options.origin)}</noscript>`,
  );
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
  search?: string;
  publicFeatures?: PublicFeatures;
}) {
  const features = normalizePublicFeatures(options.publicFeatures);
  const notFound = options.notFound || (stripSlash(options.path) === "/policy" && !features.policyBackground);
  const items = options.items ?? [];
  const list = notFound ? undefined : listWindow(options.path, items, options.search);
  const { title, desc, url, type, isLab } = notFound
    ? {
      title: `Not found · ${SITE}`,
      desc: "This page is not published.",
      url: publicUrl(stripSlash(options.path) || "/", options.origin),
      type: "website",
      isLab: false,
    }
    : routeHead(options.path, options.origin, options.item, list);
  const jsonLd = notFound
    ? []
    : routeJsonLd(options.path, options.origin, items, options.item, options.entities, options.search);
  const noscript = notFound
    ? `<h1>Not found</h1><p>This page is not published.</p><p><a href="${esc(publicUrl("/", options.origin))}">Back to the desk</a></p>`
    : primaryNoscript(options.path, options.origin, items, options.item, options.search, features);
  const noindex = notFound || isLab || (list != null && (!list.window.indexable || list.index?.noindex));
  const prevPath = list ? adjacentListPath(list, "prev") : undefined;
  const nextPath = list ? adjacentListPath(list, "next") : undefined;
  const prevHref = prevPath ? publicUrl(prevPath, options.origin) : undefined;
  const nextHref = nextPath ? publicUrl(nextPath, options.origin) : undefined;
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    ...(noindex ? [`<meta name="robots" content="${isLab ? "noindex, nofollow" : "noindex"}" />`] : []),
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:type" content="${esc(type)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(desc)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    ...(prevHref ? [`<link rel="prev" href="${esc(prevHref)}" />`] : []),
    ...(nextHref ? [`<link rel="next" href="${esc(nextHref)}" />`] : []),
    `<link rel="alternate" type="application/rss+xml" href="${esc(publicUrl("/feed.xml", options.origin))}" />`,
    `<link rel="alternate" type="application/json" href="${esc(publicUrl("/feed.json", options.origin))}" />`,
    `<script nonce="${esc(options.nonce)}">globalThis.__VALLEY_DESK_PUBLIC_ORIGIN__=${JSON.stringify(options.origin)};globalThis.__VALLEY_DESK_PUBLIC_FEATURES__=${JSON.stringify(features)};</script>`,
    ...jsonLd.map((doc) => jsonLdTag(doc, options.nonce)),
  ].join("\n    ");
  let html = options.html.replace("<title>The Valley Desk</title>", tags);
  html = html.replace(
    /<noscript id="tvd-primary">[\s\S]*?<\/noscript>/,
    `<noscript id="tvd-primary">${noscript}</noscript>`,
  );
  if (!notFound) {
    html = html.replace(
      "</head>",
      `${runtimeItemsScript(items, options.withdrawnIds ?? [], options.nonce)}\n  </head>`,
    );
  }
  return html;
}
