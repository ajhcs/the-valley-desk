import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { bySlug } from "../content/queries";
import { catalog } from "../lib/catalog";
import { SITE_ORIGIN } from "../lib/canonical";

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
    const item =
      parts.length === 2 && (parts[0] === "news" || parts[0] === "events" || parts[0] === "voices" || parts[0] === "briefing")
        ? bySlug(catalog, parts[1])
        : undefined;
    let title = SITE;
    let desc = DEFAULT_DESC;
    if (item) {
      title = `${item.title} · ${SITE}`;
      desc = item.impactSentence?.trim() || item.title;
    } else if (path === "/news") title = `News · ${SITE}`;
    else if (path === "/events") title = `Events · ${SITE}`;
    else if (path === "/briefing") title = `Briefing · ${SITE}`;
    const url = path === "/" ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path}`;
    document.title = title;
    upsertMeta("name", "description", desc);
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", desc);
    upsertMeta("property", "og:url", url);
    upsertMeta("property", "og:type", item && item.kind !== "event" ? "article" : "website");
    upsertMeta("name", "twitter:card", "summary");
    upsertMeta("name", "twitter:title", title);
    upsertMeta("name", "twitter:description", desc);
    upsertLink("canonical", url);
    upsertLink("alternate", `${SITE_ORIGIN}/feed.xml`, "application/rss+xml");
    upsertLink("alternate", `${SITE_ORIGIN}/feed.json`, "application/json");
  }, [pathname]);
  return null;
}
