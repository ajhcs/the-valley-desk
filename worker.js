import {
  publishedEventSlugs,
  publishedHead,
  publishedNewsSlugs,
  publishedVoiceSlugs,
} from "./worker-published.js";
import { runScheduledIngest } from "./src/ingest/run-all.ts";

const SITE = "The Valley Desk";
const ORIGIN = "https://thevalleydesk.org";
const DEFAULT_DESC = "Local health-tech news for people and agents";

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-robots-tag": "noindex",
      "cache-control": "no-store",
    },
  });
}

const newsSlugs = new Set(publishedNewsSlugs);
const eventSlugs = new Set(publishedEventSlugs);
const voiceSlugs = new Set(publishedVoiceSlugs);
const SPA_PATH = /^\/(?:(?:news|events|voices)(?:\/[^/]+)?)?\/?$/;

function stripSlash(path) {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
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

function routeHead(path) {
  const p = stripSlash(path) || "/";
  const news = /^\/news\/([^/]+)$/.exec(p);
  const events = /^\/events\/([^/]+)$/.exec(p);
  const voices = /^\/voices\/([^/]+)$/.exec(p);
  const slug = (news && news[1]) || (events && events[1]) || (voices && voices[1]);
  const item = slug ? publishedHead[slug] : undefined;
  let title = SITE;
  let desc = DEFAULT_DESC;
  if (item) {
    title = `${item.title} · ${SITE}`;
    desc = item.description || item.title;
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

function withHead(html, path) {
  const { title, desc, url, type } = routeHead(path);
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
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

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      runScheduledIngest({
        X_BEARER_TOKEN: env.X_BEARER_TOKEN,
        LINKEDIN_TOKEN: env.LINKEDIN_TOKEN,
      }).then((run) => {
        console.log("ingest-scheduled", JSON.stringify(run.notes));
      }),
    );
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/org" || path.startsWith("/org/")) {
      return notFound();
    }
    if (path === "/briefing" || path.startsWith("/briefing/")) {
      return notFound();
    }
    if (publishedItemPath(path) === false) {
      return notFound();
    }
    if (SPA_PATH.test(path)) {
      const asset = await env.ASSETS.fetch(new URL("/index.html", url.origin));
      const html = await asset.text();
      return new Response(withHead(html, path), {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return asset;
    return notFound();
  },
};
