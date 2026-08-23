import { publishedEventSlugs, publishedNewsSlugs } from "./worker-published.js";

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
const SPA_PATH = /^\/(?:(?:news|events|voices|briefing)(?:\/[^/]+)?)?\/?$/;

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
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/org" || path.startsWith("/org/")) {
      return notFound();
    }
    if (publishedItemPath(path) === false) {
      return notFound();
    }
    if (SPA_PATH.test(path)) {
      return env.ASSETS.fetch(new URL("/index.html", url.origin));
    }
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return asset;
    return notFound();
  },
};
