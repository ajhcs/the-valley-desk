import { XMLValidator } from "fast-xml-parser";
import { regionalXmlDocument, xmlAttribute } from "./regional-xml";
import type { RegionalXmlElement } from "./regional-xml";
import { regionalHtmlElements } from "./regional-html";
import { isCalendarDay } from "../content/watch-schema";
import { looksInstructionLike } from "./untrusted-text";
import { permittedPublicUrl } from "./regional-contracts";
import type { RegionalSource } from "./regional-contracts";

const MAX_BYTES = 524_288;
const MAX_ITEMS = 100;
function bounded(body: string) {
  if (new TextEncoder().encode(body).byteLength > MAX_BYTES) throw new Error("regional-representation-too-large");
}
function linkAllowed(value: string, source: Pick<RegionalSource, "allowedHosts">) {
  return permittedPublicUrl(value, source.allowedHosts);
}

/** Parse only declared head links. Never guess /feed paths or follow arbitrary navigation. */
export function discoverDeclaredFeeds(body: string, pageUrl: string, allowedHosts: readonly string[]) {
  bounded(body);
  if (!permittedPublicUrl(pageUrl, allowedHosts)) throw new Error("regional-page-outside-allowlist");
  const links = regionalHtmlElements(body, ["link", "base"]).filter(element => element.ancestors.includes("head"));
  const declaredBases = links.filter(element => element.name === "base" && element.attributes.href !== undefined);
  if (declaredBases.length > 1) throw new Error("regional-page-ambiguous-base");
  const baseUrl = declaredBases.length ? new URL(declaredBases[0].attributes.href, pageUrl).href : pageUrl;
  if (!permittedPublicUrl(baseUrl, allowedHosts)) throw new Error("regional-page-base-outside-allowlist");
  const found = new Map<string, { url: string; transport: "rss" | "atom"; publicationAuthorized: false; collectionAuthorized: false }>();
  for (const element of links.filter(row => row.name === "link").slice(0, 100)) {
    const attributes = element.attributes, type = attributes.type?.toLowerCase();
    if (!attributes.rel?.toLowerCase().split(/\s+/).includes("alternate") || !attributes.href ||
        (type !== "application/rss+xml" && type !== "application/atom+xml")) continue;
    try {
      const url = new URL(attributes.href, baseUrl).href;
      if (permittedPublicUrl(url, allowedHosts)) found.set(url, { url, transport: type === "application/rss+xml" ? "rss" : "atom",
        publicationAuthorized: false, collectionAuthorized: false });
    } catch { /* malformed href is not a source */ }
  }
  return [...found.values()];
}
export type RegionalFeedCandidate = {
  title: string; url: string; externalId: string; description: string;
  sourcePublishedAt: string | null; sourceUpdatedAt: string | null;
  rawPublishedDate: string | null; rawUpdatedDate: string | null;
  dateBasis: "published" | "unknown"; sourceDateField: "rss.pubDate" | "rss.date" | "dc.date" | "atom.published" | null;
  originalWorkPublicationDate: null; holds: string[];
  publicationAuthorized: false;
};
function date(value: string, observedAt: number): string | null {
  const zones: Record<string, number> = { UT: 0, UTC: 0, GMT: 0, EST: -300, EDT: -240, CST: -360,
    CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420 };
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})$/i);
  const rfc = value.match(/^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(UT|UTC|GMT|EST|EDT|CST|CDT|MST|MDT|PST|PDT|[+-]\d{4})$/i);
  if (!iso && !rfc) return null; // No permissive Date.parse fallback or silent grammar expansion.
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const year = Number(iso ? iso[1] : rfc![3]), month = iso ? Number(iso[2]) : months.indexOf(rfc![2].toLowerCase()) + 1,
    day = Number(iso ? iso[3] : rfc![1]), hour = Number(iso ? iso[4] : rfc![4]), minute = Number(iso ? iso[5] : rfc![5]),
    second = Number(iso ? iso[6] : rfc![6] ?? "0"), millis = Number(iso?.[7]?.padEnd(3, "0").slice(0, 3) ?? "0");
  if (!isCalendarDay(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`) || hour > 23 || minute > 59 || second > 59) return null;
  const zone = (iso ? iso[8] : rfc![7]).toUpperCase(); let offset = 0;
  if (zone !== "Z" && !(zone in zones)) {
    const numeric = zone.match(/^([+-])(\d{2}):?(\d{2})$/); if (!numeric || Number(numeric[2]) > 23 || Number(numeric[3]) > 59) return null;
    offset = (Number(numeric[2]) * 60 + Number(numeric[3])) * (numeric[1] === "+" ? 1 : -1);
  } else offset = zones[zone] ?? 0;
  const instant = new Date(0); instant.setUTCFullYear(year, month - 1, day); instant.setUTCHours(hour, minute, second, millis);
  const parsed = instant.getTime() - offset * 60000;
  return Number.isFinite(parsed) && parsed <= observedAt ? new Date(parsed).toISOString() : null;
}
export function parseRegionalFeed(body: string, source: Pick<RegionalSource, "url" | "allowedHosts">, observedAt: string) {
  bounded(body);
  const parsedObservation = date(observedAt, Number.POSITIVE_INFINITY);
  const observed = parsedObservation ? Date.parse(parsedObservation) : Number.NaN;
  if (!Number.isFinite(observed) || !linkAllowed(source.url, source)) throw new Error("invalid-regional-feed-context");
  if (/<!DOCTYPE|<!ENTITY/i.test(body)) throw new Error("regional-feed-doctype-forbidden");
  if (XMLValidator.validate(body) !== true) throw new Error("regional-feed-invalid-xml");
  const document = regionalXmlDocument(body);
  if (document.length !== 1) throw new Error("regional-feed-unsupported-root");
  const documentRoot = document[0], ATOM = "http://www.w3.org/2005/Atom", RSS1 = "http://purl.org/rss/1.0/",
    RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#", DC = "http://purl.org/dc/elements/1.1/";
  const atom = documentRoot.name === "feed" && documentRoot.namespace === ATOM;
  const rss2 = documentRoot.name === "rss" && documentRoot.namespace === "";
  const rss1 = documentRoot.name === "RDF" && documentRoot.namespace === RDF;
  if (!atom && !rss2 && !rss1) throw new Error("regional-feed-unsupported-root");
  const vocabulary = atom ? ATOM : rss1 ? RSS1 : "";
  const fields = (element: RegionalXmlElement, name: string, namespace = vocabulary) => element.children.filter(child => child.name === name && child.namespace === namespace);
  const channels = rss2 ? fields(documentRoot, "channel") : [];
  if (rss2 && channels.length !== 1) throw new Error("regional-feed-unsupported-root");
  const root = rss2 ? channels[0] : documentRoot;
  const entries = fields(root, atom ? "entry" : "item");
  const usable = (element: RegionalXmlElement) => element.children.length > 0 || element.attributes.length > 0;
  if (entries.length && entries.every(element => !usable(element))) throw new Error("regional-feed-invalid-items");
  const base = (element: RegionalXmlElement, parent: string | null): string | null => {
    if (!parent) return null;
    const declared = xmlAttribute(element, "base", "http://www.w3.org/XML/1998/namespace"); if (declared === undefined) return parent;
    try { const resolved = new URL(declared, parent).href; return linkAllowed(resolved, source) ? resolved : null; } catch { return null; }
  };
  const documentBase = base(documentRoot, source.url);
  const rootBase = root === documentRoot ? documentBase : base(root, documentBase);
  const malformedItems = entries.filter(element => !usable(element)).length;
  const skippedByLimit = entries.slice(MAX_ITEMS).filter(usable).length;
  const candidates: RegionalFeedCandidate[] = [], seen = new Set<string>();
  let rejectedItems = malformedItems, duplicateItems = 0;
  for (const item of entries.slice(0, MAX_ITEMS)) {
    if (!usable(item)) continue;
    // Duplicate supported singleton fields are malformed, never silently coerced or selected.
    const names = atom ? ["title", "published", "updated", "id", "summary", "content"] : ["title", "link", "pubDate", "date", "guid", "description"];
    if (names.some(name => fields(item, name).length > 1) || (!atom && fields(item, "date", DC).length > 1)) { rejectedItems++; continue; }
    const value = (name: string, namespace = vocabulary) => fields(item, name, namespace)[0]?.text.trim() ?? "";
    const title = value("title");
    const atomLinks = fields(item, "link");
    const chosenLink = atomLinks.find(link => !xmlAttribute(link, "rel") || xmlAttribute(link, "rel") === "alternate");
    const rawLink = atom ? chosenLink ? xmlAttribute(chosenLink, "href") ?? "" : "" : value("link");
    const linkedElement = atom ? chosenLink : fields(item, "link")[0];
    const itemBase = base(item, rootBase), linkBase = linkedElement ? base(linkedElement, itemBase) : itemBase;
    let url: string;
    try { if (!linkBase) throw new Error("unsupported-feed-base"); url = new URL(rawLink, linkBase).href; } catch { rejectedItems++; continue; }
    if (!title || !rawLink || !linkAllowed(url, source)) { rejectedItems++; continue; }
    const rawPublishedDate = (atom ? value("published") : value("pubDate") || value("date") || value("date", DC)) || null;
    const rawUpdatedDate = (atom ? value("updated") : "") || null;
    const sourcePublishedAt = date(rawPublishedDate ?? "", observed), sourceUpdatedAt = date(rawUpdatedDate ?? "", observed);
    if (seen.has(url)) { duplicateItems++; continue; }
    seen.add(url);
    const holds = sourcePublishedAt ? [] : [rawPublishedDate ? "source-date-invalid-or-future" : "source-date-unknown"];
    if (rawUpdatedDate && !sourceUpdatedAt) holds.push("source-updated-date-invalid-or-future");
    const description = (atom ? value("summary") || value("content") : value("description")).slice(0, 8000);
    if (looksInstructionLike(title, description)) holds.push("instruction-like-source");
    candidates.push({ title, url, externalId: value(atom ? "id" : "guid") || url,
      description,
      sourcePublishedAt, sourceUpdatedAt, rawPublishedDate, rawUpdatedDate,
      dateBasis: sourcePublishedAt ? "published" : "unknown",
      sourceDateField: rawPublishedDate ? atom ? "atom.published" : value("pubDate") ? "rss.pubDate" : value("date") ? "rss.date" : "dc.date" : null,
      originalWorkPublicationDate: null, holds, publicationAuthorized: false });
  }
  return { candidates, rejectedItems, malformedItems, duplicateItems, skippedByLimit,
    rawItemCount: entries.length, processedItemCount: Math.min(entries.length, MAX_ITEMS), truncated: entries.length > MAX_ITEMS,
    state: rejectedItems ? "parser-failed" as const : candidates.length ? "healthy" as const : "healthy-empty" as const,
    completeness: "partial" as const, observedAt, publicationAuthorized: false };
}
