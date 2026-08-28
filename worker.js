import {
  publishedEventSlugs,
  publishedHead,
  publishedNewsSlugs,
  publishedSlugRedirects,
  publishedVoiceSlugs,
} from "./worker-published.js";
import { runAutomation } from "./src/ingest/automation.ts";
import { cleanupEmailDiscoveries, handleInboundEmail } from "./src/ingest/email.ts";
import { handleReviewApi, isReviewApiPath } from "./src/ingest/review-api.ts";
import { handleOpsRequest, isOpsPath } from "./src/ingest/ops-access.ts";
import { FeedDocument } from "./src/ingest/feed-contract.ts";
import { feedXml, mergePublishedContent, mergedFeed, sitemapXml } from "./src/ingest/public-feed.ts";
import {
  cleanupNewsArticleExtractions,
  findPublishedContent,
  findPublishedSlugAlias,
  readPublicationTombstones,
  readPublishedContent,
} from "./src/ingest/persistence.ts";
import { loadEntities } from "./src/content/store.ts";
import { llmsTxt, resolvePublicOrigin, robotsTxt } from "./src/lib/canonical.ts";
import { decorateHtml } from "./src/lib/crawler-html.ts";
import { applySecurityHeaders, asHeadResponse, canonicalHostRedirect, handlePublicHealth, logOps } from "./src/lib/ops.ts";
import { dispatchOperationalAlert, dispatchOperationalDigest } from "./src/lib/alerts.ts";

const PUBLIC_MACHINE_PATHS = new Set([
  "/feed.json",
  "/api/content",
  "/feed.xml",
  "/sitemap.xml",
  "/robots.txt",
  "/llms.txt",
]);

function notFoundHeaders() {
  return {
    "content-type": "text/html; charset=utf-8",
    "x-robots-tag": "noindex",
    "cache-control": "no-store",
  };
}

async function notFound(env, request, path, origin, nonce) {
  const url = new URL(request.url);
  const asset = await env.ASSETS.fetch(new URL("/index.html", url.origin));
  const html = decorateHtml({
    html: await asset.text(),
    path,
    origin,
    nonce,
    notFound: true,
  });
  return new Response(html, {
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

/** Ops: migration 0007 content_slug_aliases. Static redirects stay first; D1 aliases 301 after. */
async function lookupPublishedSlugAlias(env, path) {
  const match = /^\/(news|events|voices)\/([^/]+)$/.exec(stripSlash(path));
  if (!match) return null;
  try {
    const dest = await findPublishedSlugAlias(env.VALLEY_DESK_DB, match[1] === "events" ? "event" : match[1] === "voices" ? "voice" : "news", match[2]);
    if (!dest?.slug || dest.slug === match[2]) return null;
    const section = dest.kind === "event" ? "events" : dest.kind === "voice" ? "voices" : "news";
    return `/${section}/${dest.slug}`;
  } catch (error) {
    console.error("published-slug-alias-fallback", JSON.stringify({
      message: error instanceof Error ? error.message : "D1 slug alias unavailable",
    }));
    return null;
  }
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

async function dynamicOverlay(env) {
  try {
    const [items, withdrawnIds] = await Promise.all([
      readPublishedContent(env.VALLEY_DESK_DB),
      readPublicationTombstones(env.VALLEY_DESK_DB),
    ]);
    return { items, withdrawnIds };
  } catch (error) {
    logOps("published-content-fallback", {
      message: error instanceof Error ? error.message : "D1 public content unavailable",
    }, "error");
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

function compactAutomation(result) {
  if (!result || typeof result !== "object") return {};
  const {
    notes,
    ...rest
  } = result;
  return {
    ...rest,
    sourceCount: Array.isArray(notes?.sources) ? notes.sources.length : undefined,
    rssCount: notes?.rss,
    eventCount: notes?.events,
  };
}

function safeAlertError(error) {
  const raw = error instanceof Error ? error.message : "Unknown automation failure";
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\bauthorization\b\s*[:=]\s*bearer\s+\S+/gi, "authorization=[redacted]")
    .replace(/\b(bearer|authorization|token|secret|password|api[-_]?key)\b\s*[:=]?\s*\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240) || "Unknown automation failure";
}

async function sendAutomationAlerts(env, result, now = new Date()) {
  if (result?.skipped) {
    await dispatchOperationalAlert(env.VALLEY_DESK_DB, env.NOTIFY_OPS, {
      fingerprint: "valley-desk:automation-lock-busy",
      event: "automation-lock-busy",
      severity: "warning",
      threshold: 3,
      now,
      details: { reason: "automation-already-running" },
    });
    return;
  }
  const sourceNotes = Array.isArray(result?.notes?.sources) ? result.notes.sources : [];
  for (const source of sourceNotes) {
    if (!source || source.state === "disabled" || source.state === "healthy" || source.state === "healthy-empty") continue;
    const sourceId = typeof source.id === "string" ? source.id.slice(0, 100) : "unknown";
    await dispatchOperationalAlert(env.VALLEY_DESK_DB, env.NOTIFY_OPS, {
      fingerprint: `valley-desk:source:${sourceId}:${source.state}`,
      event: "source-degraded",
      severity: source.state === "auth-failed" ? "critical" : "warning",
      threshold: 3,
      now,
      details: { sourceId, state: source.state, failures: source.consecutiveFailures },
    });
  }
}

async function sendDailyOpsDigest(env, now = new Date()) {
  // Run once at a predictable UTC hour; D1 claim state makes retries and
  // duplicate cron deliveries safe.
  if (now.getUTCHours() !== 8) return;
  await dispatchOperationalDigest(env.VALLEY_DESK_DB, env.NOTIFY_OPS, now);
}

async function handleFetch(request, env, origin, nonce, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === "/api/health") {
    return handlePublicHealth(request, env);
  }
  if (isOpsPath(path)) {
    return handleOpsRequest(
      request,
      env,
      ctx,
      origin,
      async () => {
        const asset = await env.ASSETS.fetch(new URL("/index.html", url.origin));
        return decorateHtml({
          html: await asset.text(),
          path: "/ops",
          origin,
          nonce,
        });
      },
    );
  }
  if (isReviewApiPath(path)) {
    return handleReviewApi(request, env);
  }
  if ((method === "GET" || method === "HEAD") && PUBLIC_MACHINE_PATHS.has(path)) {
    if (path === "/robots.txt") {
      return new Response(robotsTxt(origin), {
        headers: { ...PUBLIC_HEADERS, "content-type": "text/plain; charset=utf-8" },
      });
    }
    if (path === "/llms.txt") {
      return new Response(llmsTxt(origin), {
        headers: { ...PUBLIC_HEADERS, "content-type": "text/plain; charset=utf-8" },
      });
    }
    const seed = await staticFeed(env, request);
    let feed = seed;
    try {
      feed = await mergedFeed(env.VALLEY_DESK_DB, seed);
    } catch (error) {
      logOps("dynamic-feed-fallback", {
        message: error instanceof Error ? error.message : "D1 feed unavailable",
      }, "error");
    }
    if (path === "/feed.xml") {
      return new Response(feedXml(feed, origin), {
        headers: { ...PUBLIC_HEADERS, "content-type": "application/rss+xml; charset=utf-8" },
      });
    }
    if (path === "/sitemap.xml") {
      return new Response(sitemapXml(feed, origin), {
        headers: { ...PUBLIC_HEADERS, "content-type": "application/xml; charset=utf-8" },
      });
    }
    return new Response(JSON.stringify(feed), {
      headers: { ...PUBLIC_HEADERS, "content-type": "application/json; charset=utf-8" },
    });
  }
  if (path === "/org" || path.startsWith("/org/")) {
    return notFound(env, request, path, origin, nonce);
  }
  if (path === "/briefing" || path.startsWith("/briefing/")) {
    return notFound(env, request, path, origin, nonce);
  }
  const redirected = permalinkRedirect(path) || await lookupPublishedSlugAlias(env, path);
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
    // Resolve signed seed items as well as D1-only items so crawler HTML for
    // every permalink receives article metadata, JSON-LD, and noscript copy.
    let dynamicItem = section && slug
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
      return notFound(env, request, path, origin, nonce);
    }
    const asset = await env.ASSETS.fetch(new URL("/index.html", url.origin));
    const html = decorateHtml({
      html: await asset.text(),
      path,
      search: url.search,
      origin,
      nonce,
      item: dynamicItem,
      items: published,
      withdrawnIds: overlay.withdrawnIds,
      entities: loadEntities(),
    });
    return new Response(html, {
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
  return notFound(env, request, path, origin, nonce);
}

export default {
  async email(message, env) {
    const result = await handleInboundEmail(message, env);
    if (result.outcome === "failed") {
      throw new Error(`Inbound email discovery failed: ${result.reason || "unknown error"}`);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      cleanupEmailDiscoveries(env.VALLEY_DESK_DB).catch((error) => {
        logOps("email-cleanup", {
          outcome: "failed",
          message: error instanceof Error ? error.message : "Unknown email cleanup failure",
        }, "warn");
      }),
    );
    ctx.waitUntil(
      cleanupNewsArticleExtractions(env.VALLEY_DESK_DB).catch((error) => {
        logOps("news-extraction-cleanup", {
          outcome: "failed",
          message: error instanceof Error ? error.message : "Unknown news extraction cleanup failure",
        }, "warn");
      }),
    );
    ctx.waitUntil(
      runAutomation(env).then((result) => {
        logOps("cron", {
          outcome: result.skipped ? "skipped" : "succeeded",
          ...compactAutomation(result),
        });
        return sendAutomationAlerts(env, result).then(() => sendDailyOpsDigest(env));
      }).catch((error) => {
        logOps("ingest-scheduled-failed", {
          message: safeAlertError(error),
        }, "error");
        return dispatchOperationalAlert(env.VALLEY_DESK_DB, env.NOTIFY_OPS, {
          fingerprint: "valley-desk:automation-run-failed",
          event: "automation-run-failed",
          severity: "critical",
          threshold: 2,
          details: { stage: "scheduled", reason: safeAlertError(error) },
        }).catch((alertError) => {
          logOps("ops-alert", { outcome: "dispatch-failed", message: safeAlertError(alertError) }, "warn");
        });
      }),
    );
  },
  async fetch(request, env, ctx) {
    const origin = resolvePublicOrigin(env.PUBLIC_ORIGIN);
    const nonce = crypto.randomUUID();
    const response = canonicalHostRedirect(request, origin) ?? await handleFetch(request, env, origin, nonce, ctx);
    const contentType = response.headers.get("content-type") || "";
    const html = contentType.includes("text/html");
    const secured = applySecurityHeaders(response, {
      request,
      publicOrigin: origin,
      html,
      nonce: html ? nonce : undefined,
    });
    if (request.method.toUpperCase() === "HEAD") return asHeadResponse(secured);
    return secured;
  },
};
