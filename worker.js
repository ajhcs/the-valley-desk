import {
  publishedEventSlugs,
  publishedHead,
  publishedNewsSlugs,
  publishedSlugRedirects,
  publishedVoiceSlugs,
} from "./worker-published.js";
import { runAutomation } from "./src/ingest/automation.ts";
import { handleReviewApi } from "./src/ingest/review-api.ts";
import { FeedDocument } from "./src/ingest/feed-contract.ts";
import { feedXml, mergePublishedContent, mergedFeed, runtimeItemsScript, sitemapXml } from "./src/ingest/public-feed.ts";
import { findPublishedContent, readPublicationTombstones, readPublishedContent } from "./src/ingest/persistence.ts";

const SITE = "The Valley Desk";
const ORIGIN = "https://thevalleydesk.org";
const DEFAULT_DESC = "Local health-tech news for people and agents";

function notFoundHeaders() {
  return {
    "content-type": "text/html; charset=utf-8",
    "x-robots-tag": "noindex",
    "cache-control": "no-store",
  };
}

function withNotFoundHead(html, path) {
  const p = stripSlash(path) || "/";
  const url = p === "/" ? `${ORIGIN}/` : `${ORIGIN}${p}`;
  const title = `Not found · ${SITE}`;
  const desc = "This page is not published.";
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    `<meta name="robots" content="noindex" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(desc)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<link rel="alternate" type="application/rss+xml" href="${ORIGIN}/feed.xml" />`,
    `<link rel="alternate" type="application/json" href="${ORIGIN}/feed.json" />`,
  ].join("\n    ");
  return html.replace("<title>The Valley Desk</title>", tags);
}

async function notFound(env, request, path) {
  const url = new URL(request.url);
  const asset = await env.ASSETS.fetch(new URL("/index.html", url.origin));
  const html = await asset.text();
  return new Response(withNotFoundHead(html, path), {
    status: 404,
    headers: notFoundHeaders(),
  });
}

const newsSlugs = new Set(publishedNewsSlugs);
const eventSlugs = new Set(publishedEventSlugs);
const voiceSlugs = new Set(publishedVoiceSlugs);
const SPA_PATH = /^\/(?:(?:news|events|voices)(?:\/[^/]+)?|lab(?:\/(?:briefing|systems|horizon|calendar))?)?\/?$/;

function stripSlash(path) {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function permalinkRedirect(path) {
  const p = stripSlash(path);
  const match = /^\/(news|events|voices)\/([^/]+)$/.exec(p);
  if (!match) return null;
  const dest = publishedSlugRedirects?.[match[2]];
  if (!dest?.slug) return null;
  const section = dest.kind === "event" ? "events" : dest.kind === "voice" ? "voices" : "news";
  if (dest.slug === match[2]) return null;
  return `/${section}/${dest.slug}`;
}

/** false = unpublished or unknown item permalink. null = not an item permalink. */
function publishedItemPath(path) {
  const p = stripSlash(path);
  const news = /^\/news\/([^/]+)$/.exec(p);
  if (news) return newsSlugs.has(news[1]);
  const events = /^\/events\/([^/]+)$/.exec(p);
  if (events) return eventSlugs.has(events[1]);
  const voices = /^\/voices\/([^/]+)$/.exec(p);
  if (voices) return voiceSlugs.has(voices[1]);
  return null;
}

function esc(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function routeHead(path, dynamicItem) {
  const p = stripSlash(path) || "/";
  const news = /^\/news\/([^/]+)$/.exec(p);
  const events = /^\/events\/([^/]+)$/.exec(p);
  const voices = /^\/voices\/([^/]+)$/.exec(p);
  const slug = (news && news[1]) || (events && events[1]) || (voices && voices[1]);
  const item = dynamicItem || (slug ? publishedHead[slug] : undefined);
  let title = SITE;
  let desc = DEFAULT_DESC;
  if (item) {
    title = `${item.title} · ${SITE}`;
    desc = item.description || item.impactSentence || item.dek || item.title;
  } else if (p === "/news") title = `News · ${SITE}`;
  else if (p === "/events") title = `Events · ${SITE}`;
  else if (p === "/voices") {
    title = `Voices · ${SITE}`;
    desc = "Voices";
  }
  const url = p === "/" ? `${ORIGIN}/` : `${ORIGIN}${p}`;
  const articleKinds = new Set(["news", "policy", "ai", "interview"]);
  const type = item && articleKinds.has(item.kind) ? "article" : "website";
  return { title, desc, url, type };
}

function withHead(html, path, dynamicItem) {
  const { title, desc, url, type } = routeHead(path, dynamicItem);
  const isLab = stripSlash(path).startsWith("/lab");
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    ...(isLab ? [`<meta name="robots" content="noindex, nofollow" />`] : []),
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(desc)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<link rel="alternate" type="application/rss+xml" href="${ORIGIN}/feed.xml" />`,
    `<link rel="alternate" type="application/json" href="${ORIGIN}/feed.json" />`,
  ].join("\n    ");
  return html.replace("<title>The Valley Desk</title>", tags);
}

function sectionKind(path) {
  if (path.startsWith("/events/")) return "event";
  if (path.startsWith("/voices/")) return "voice";
  if (path.startsWith("/news/")) return "news";
  return undefined;
}

function itemMatchesSection(item, section) {
  if (section === "event") return item.kind === "event";
  if (section === "voice") return item.kind === "voice";
  return section === "news" && new Set(["news", "policy", "ai", "interview"]).has(item.kind);
}

async function dynamicOverlay(env, limit = 100) {
  try {
    const [items, withdrawnIds] = await Promise.all([
      readPublishedContent(env.VALLEY_DESK_DB, limit),
      readPublicationTombstones(env.VALLEY_DESK_DB),
    ]);
    return { items, withdrawnIds };
  } catch (error) {
    console.error("published-content-fallback", JSON.stringify({
      message: error instanceof Error ? error.message : "D1 public content unavailable",
    }));
    return { items: [], withdrawnIds: [] };
  }
}

async function staticFeed(env, request) {
  const url = new URL(request.url);
  const response = await env.ASSETS.fetch(new URL("/feed.json", url.origin));
  return FeedDocument.parse(await response.json());
}

const PUBLIC_HEADERS = {
  "cache-control": "public, max-age=60",
  "cdn-cache-control": "public, max-age=300",
  "access-control-allow-origin": "*",
};

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      runAutomation(env).then((result) => {
        console.log("ingest-scheduled", JSON.stringify(result));
      }).catch((error) => {
        console.error("ingest-scheduled-failed", JSON.stringify({
          message: error instanceof Error ? error.message : "Unknown automation failure",
        }));
      }),
    );
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.startsWith("/api/review-queue") || path === "/api/automation/status") {
      return handleReviewApi(request, env);
    }
    if (request.method === "GET" && (path === "/feed.json" || path === "/api/content" || path === "/feed.xml" || path === "/sitemap.xml")) {
      const seed = await staticFeed(env, request);
      let feed = seed;
      try {
        feed = await mergedFeed(env.VALLEY_DESK_DB, seed);
      } catch (error) {
        console.error("dynamic-feed-fallback", JSON.stringify({
          message: error instanceof Error ? error.message : "D1 feed unavailable",
        }));
      }
      if (path === "/feed.xml") {
        return new Response(feedXml(feed), { headers: { ...PUBLIC_HEADERS, "content-type": "application/rss+xml; charset=utf-8" } });
      }
      if (path === "/sitemap.xml") {
        return new Response(sitemapXml(feed), { headers: { ...PUBLIC_HEADERS, "content-type": "application/xml; charset=utf-8" } });
      }
      return new Response(JSON.stringify(feed), { headers: { ...PUBLIC_HEADERS, "content-type": "application/json; charset=utf-8" } });
    }
    if (path === "/org" || path.startsWith("/org/")) {
      return notFound(env, request, path);
    }
    if (path === "/briefing" || path.startsWith("/briefing/")) {
      return notFound(env, request, path);
    }
    const redirected = permalinkRedirect(path);
    if (redirected) {
      return Response.redirect(`${url.origin}${redirected}`, 301);
    }
    if (SPA_PATH.test(path)) {
      const overlay = await dynamicOverlay(env);
      const seed = await staticFeed(env, request);
      let published = mergePublishedContent(seed.items, overlay.items, overlay.withdrawnIds);
      const withdrawnIds = new Set(overlay.withdrawnIds);
      const section = sectionKind(path);
      const slug = stripSlash(path).split("/").at(-1);
      const staticPathState = publishedItemPath(path);
      const staticHead = slug ? publishedHead[slug] : undefined;
      const staticWithdrawn = Boolean(staticHead?.id && withdrawnIds.has(staticHead.id));
      let dynamicItem = staticPathState !== true && section && slug
        ? published.find((item) => item.slug === slug && itemMatchesSection(item, section))
        : undefined;
      if (!dynamicItem && staticPathState === false && section && slug) {
        const requested = await findPublishedContent(env.VALLEY_DESK_DB, section, slug).catch(() => undefined);
        if (requested && itemMatchesSection(requested, section)) {
          const safeSupplement = mergePublishedContent(seed.items, [requested], overlay.withdrawnIds);
          dynamicItem = safeSupplement.find((item) => item.id === requested.id);
          if (dynamicItem && !published.some((item) => item.id === dynamicItem.id)) published = [...published, dynamicItem];
        }
      }
      if ((staticPathState === false && !dynamicItem) || (staticPathState === true && staticWithdrawn && !dynamicItem)) {
        return notFound(env, request, path);
      }
      const asset = await env.ASSETS.fetch(new URL("/index.html", url.origin));
      const html = (await asset.text()).replace("</head>", `${runtimeItemsScript(published, overlay.withdrawnIds)}\n  </head>`);
      return new Response(withHead(html, path, dynamicItem), {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          ...(path.startsWith("/lab") ? { "x-robots-tag": "noindex, nofollow" } : {}),
        },
      });
    }
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return asset;
    return notFound(env, request, path);
  },
};
