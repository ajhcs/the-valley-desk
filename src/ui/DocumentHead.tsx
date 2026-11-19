import { useEffect, useSyncExternalStore } from "react";
import { useRouterState } from "@tanstack/react-router";
import { listCanonicalPath, listPagePath, pageFromSearch, paginate } from "../content/pagination";
import { byPreviousSlug, bySlug, latestVoices } from "../content/queries";
import { filteredEventsPage, filteredNewsPage, newsEventIndexState } from "../content/news-event-filters";
import { catalog } from "../lib/catalog";
import { canonicalUrl, publicOrigin, publicUrl } from "../lib/canonical";
import { parseWatchPageRoute, watchPageHead } from "../lib/watch-page";
import { watchHeadStore } from "./watch/watch-head-state";
import { publicFeatures } from "../lib/public-features";

const SITE = "The Valley Desk";
const DEFAULT_DESC = "A public directory of health technology, biomedicine and life science software connected to the Delaware Valley.";

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  const sel = `meta[${attr}="${key}"]`;
  let el = document.head.querySelector(sel);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertLink(rel: string, href: string) {
  const sel = `link[rel="${rel}"]:not([type])`;
  let el = document.head.querySelector(sel);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function upsertOrRemoveLink(rel: "prev" | "next", href?: string) {
  if (!href) {
    document.head.querySelector(`link[rel="${rel}"]:not([type])`)?.remove();
    return;
  }
  upsertLink(rel, href);
}

export function DocumentHead() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const watchSnapshot = useSyncExternalStore(watchHeadStore.subscribe, watchHeadStore.getSnapshot, watchHeadStore.getServerSnapshot);
  useEffect(() => {
    if (/^\/discover\/?$/.test(pathname)) {
      const title = `Health-tech research · ${SITE}`;
      const description = "A selected metadata-and-link research directory. Source-reported affiliations are historical; current employment is not established.";
      const url = publicUrl("/discover", publicOrigin());
      document.title = title;
      upsertMeta("name", "description", description);
      upsertMeta("name", "robots", "noindex");
      for (const [key, value] of Object.entries({ title, description, url, type: "website", site_name: SITE })) upsertMeta("property", `og:${key}`, value);
      upsertMeta("name", "twitter:title", title);
      upsertMeta("name", "twitter:description", description);
      upsertLink("canonical", url);
      upsertOrRemoveLink("prev"); upsertOrRemoveLink("next");
      document.head.querySelectorAll('meta[property^="article:"],script[type="application/ld+json"],link[rel="alternate"][type="application/rss+xml"],link[rel="alternate"][type="application/json"]').forEach(el => el.remove());
      return;
    }
    const watchRoute = parseWatchPageRoute(pathname, searchStr);
    if (watchRoute) {
      const head = watchSnapshot?.key === watchRoute.key ? watchSnapshot.head : watchPageHead({ route: watchRoute, status: watchRoute.status });
      const url = publicUrl(head.canonicalPath, publicOrigin());
      document.title = head.title;
      upsertMeta("name", "description", head.desc);
      upsertMeta("name", "robots", "noindex");
      for (const [key, value] of Object.entries({ title: head.title, description: head.desc, url, type: "website", site_name: SITE, locale: "en_US" })) {
        upsertMeta("property", `og:${key}`, value);
      }
      upsertMeta("name", "twitter:card", "summary");
      upsertMeta("name", "twitter:title", head.title);
      upsertMeta("name", "twitter:description", head.desc);
      upsertLink("canonical", url);
      upsertOrRemoveLink("prev"); upsertOrRemoveLink("next");
      document.head.querySelectorAll('meta[property^="article:"],script[type="application/ld+json"],link[rel="alternate"][type="application/rss+xml"],link[rel="alternate"][type="application/json"]').forEach(el => el.remove());
      return;
    }
    const path = pathname.replace(/\/+$/, "") || "/";
    const policyBackgroundHidden = path === "/policy" && !publicFeatures().policyBackground;
    const parts = path.split("/").filter(Boolean);
    const section = parts[0];
    const raw =
      parts.length === 2 && (section === "news" || section === "events" || section === "voices")
        ? bySlug(catalog, parts[1]) ?? byPreviousSlug(catalog, parts[1])
        : undefined;
    const item =
      raw &&
      ((section === "voices" && raw.kind === "voice") ||
        (section === "events" && raw.kind === "event") ||
        (section === "news" && (raw.kind === "news" || raw.kind === "policy" || raw.kind === "ai" || raw.kind === "interview")))
        ? raw
        : undefined;
    const filtered = path === "/news" ? filteredNewsPage(catalog, searchStr)
      : path === "/events" ? filteredEventsPage(catalog, searchStr) : undefined;
    const index = filtered && (path === "/news" || path === "/events")
      ? newsEventIndexState(path, filtered.request, filtered.page) : undefined;
    const list = filtered?.page ?? (!item && path === "/voices"
      ? paginate(latestVoices(catalog, Number.MAX_SAFE_INTEGER), pageFromSearch(searchStr))
      : undefined);
    const adjacent = (direction: "prev" | "next") => {
      if (index) return direction === "prev" ? index.prevPath : index.nextPath;
      const page = direction === "prev" ? list?.prevPage : list?.nextPage;
      return page == null ? undefined : listPagePath(path, page);
    };
    let title = SITE;
    let desc = DEFAULT_DESC;
    if (item) {
      title = `${item.title} · ${SITE}`;
      desc = item.impactSentence?.trim() || item.dek?.trim() || item.title;
    } else if (path === "/news") {
      title = list?.indexable && list.page > 1 ? `News · Page ${list.page} · ${SITE}` : `News · ${SITE}`;
      desc = DEFAULT_DESC;
    } else if (path === "/policy") {
      title = policyBackgroundHidden ? `Not found · ${SITE}` : `Healthcare policy watchlist · ${SITE}`;
      desc = policyBackgroundHidden ? "This page is not published." : "Observed Pennsylvania healthcare legislation, version-bound evidence and reviewed background—not new reporting.";
    } else if (path === "/events") {
      title = list?.indexable && list.page > 1 ? `Events · Page ${list.page} · ${SITE}` : `Events · ${SITE}`;
      desc = "Upcoming Delaware Valley health-tech events";
    } else if (path === "/voices") {
      title = list?.indexable && list.page > 1 ? `Voices · Page ${list.page} · ${SITE}` : `Voices · ${SITE}`;
      desc = "Named local health-tech voices and institutional notes";
    } else if (path === "/lab" || path.startsWith("/lab/")) {
      title = `Lab · ${SITE}`;
      desc = "Prototype views of the same published desk.";
    }
    const origin = publicOrigin();
    const url = item
      ? canonicalUrl(item, origin)
      : list
        ? publicUrl(index?.canonicalPath ?? listCanonicalPath(path, list), origin)
        : publicUrl(path, origin);
    const articleKinds = new Set(["news", "policy", "ai", "interview"]);
    const ogType = item && articleKinds.has(item.kind) ? "article" : "website";
    document.title = title;
    upsertMeta("name", "description", desc);
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", desc);
    upsertMeta("property", "og:url", url);
    upsertMeta("property", "og:type", ogType);
    upsertMeta("property", "og:site_name", SITE);
    upsertMeta("property", "og:locale", "en_US");
    upsertMeta("name", "twitter:card", "summary");
    upsertMeta("name", "twitter:title", title);
    upsertMeta("name", "twitter:description", desc);
    if (item && articleKinds.has(item.kind) && item.publishedAt) {
      upsertMeta("property", "article:published_time", item.publishedAt);
      upsertMeta("property", "article:modified_time", item.updatedAt || item.publishedAt);
    } else {
      document.head.querySelector('meta[property="article:published_time"]')?.remove();
      document.head.querySelector('meta[property="article:modified_time"]')?.remove();
    }
    if (path === "/lab" || path.startsWith("/lab/")) {
      upsertMeta("name", "robots", "noindex, nofollow");
    } else if (policyBackgroundHidden || index?.noindex || (list && !list.indexable)) {
      upsertMeta("name", "robots", "noindex");
    } else {
      document.head.querySelector('meta[name="robots"]')?.remove();
    }
    upsertLink("canonical", url);
    const prevPath = adjacent("prev"), nextPath = adjacent("next");
    upsertOrRemoveLink("prev", prevPath ? publicUrl(prevPath, origin) : undefined);
    upsertOrRemoveLink("next", nextPath ? publicUrl(nextPath, origin) : undefined);
    if (policyBackgroundHidden) document.head.querySelectorAll('meta[property^="article:"],script[type="application/ld+json"]').forEach(el => el.remove());
  }, [pathname, searchStr, watchSnapshot]);
  return null;
}
