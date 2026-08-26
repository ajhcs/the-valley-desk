import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { byPreviousSlug, bySlug } from "../content/queries";
import { catalog } from "../lib/catalog";
import { canonicalUrl, publicOrigin, publicUrl } from "../lib/canonical";

const SITE = "The Valley Desk";
const DEFAULT_DESC = "Local health-tech news for people and agents";

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

function upsertLink(rel: string, href: string, type?: string) {
  const sel = type ? `link[rel="${rel}"][type="${type}"]` : `link[rel="${rel}"]:not([type])`;
  let el = document.head.querySelector(sel);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    if (type) el.setAttribute("type", type);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

export function DocumentHead() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    const path = pathname.replace(/\/+$/, "") || "/";
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
    let title = SITE;
    let desc = DEFAULT_DESC;
    if (item) {
      title = `${item.title} · ${SITE}`;
      desc = item.impactSentence?.trim() || item.dek?.trim() || item.title;
    } else if (path === "/news") {
      title = `News · ${SITE}`;
      desc = DEFAULT_DESC;
    } else if (path === "/events") {
      title = `Events · ${SITE}`;
      desc = "Upcoming Delaware Valley health-tech events";
    } else if (path === "/voices") {
      title = `Voices · ${SITE}`;
      desc = "Named local health-tech voices and institutional notes";
    } else if (path === "/lab" || path.startsWith("/lab/")) {
      title = `Lab · ${SITE}`;
      desc = "Prototype views of the same published desk.";
    }
    const origin = publicOrigin();
    const url = item ? canonicalUrl(item, origin) : publicUrl(path, origin);
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
    } else {
      document.head.querySelector('meta[name="robots"]')?.remove();
    }
    upsertLink("canonical", url);
    upsertLink("alternate", publicUrl("/feed.xml", origin), "application/rss+xml");
    upsertLink("alternate", publicUrl("/feed.json", origin), "application/json");
  }, [pathname]);
  return null;
}
