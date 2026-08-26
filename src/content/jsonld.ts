import type { ContentItem, EventItem } from "./schema";
import type { Entity } from "./entity";
import { canonicalUrl } from "../lib/canonical";
import { eventPlace, listDek } from "../lib/format";
import { eventSchedule } from "../lib/calendar";
import { eventWhyCopy, isBoilerplateEventCopy } from "../lib/eventCopy";
import { primaryDisplayLabel } from "../lib/taxonomy";
import { entityIndex } from "./entity";

export const NEWS_ARTICLE_KINDS = new Set(["news", "policy", "ai", "interview"]);

function publisher() {
  return { "@type": "Organization", name: "The Valley Desk" };
}

function aboutOrgs(orgs: string[], entities: Entity[]) {
  const index = entityIndex(entities);
  return orgs.map((id) => {
    const hit = index.byId.get(id);
    return {
      "@type": "Organization",
      identifier: id,
      name: hit?.name ?? id,
    };
  });
}

function organizationFromHost(hostOrg: string, entities: Entity[]) {
  const hit = entityIndex(entities).match(hostOrg);
  const doc: Record<string, unknown> = {
    "@type": "Organization",
    name: hit?.name ?? hostOrg,
  };
  if (hit?.id) doc.identifier = hit.id;
  if (hit?.url) doc.url = hit.url;
  return doc;
}

/** JSON-LD from the ContentItem envelope. No new fields. Never review. */
export function itemJsonLd(
  item: ContentItem,
  entities: Entity[] = [],
): Record<string, unknown> | undefined {
  if (item.status !== "published") return undefined;
  if (item.kind === "event") return eventJsonLd(item, entities);
  if (!NEWS_ARTICLE_KINDS.has(item.kind)) return undefined;

  const url = canonicalUrl(item);
  const doc: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: item.title,
    description: item.impactSentence,
    datePublished: item.publishedAt,
    dateModified: item.updatedAt,
    author: item.authors.map((a) => ({
      "@type": "Person",
      name: a.name,
    })),
    publisher: publisher(),
    url,
    mainEntityOfPage: url,
    about: aboutOrgs(item.orgs, entities),
    isAccessibleForFree: true,
  };
  if (item.source.url) doc.isBasedOn = item.source.url;
  const keywords = [...new Set([primaryDisplayLabel(item), ...item.topics].filter(Boolean))];
  if (keywords.length) doc.keywords = keywords;
  return doc;
}

/** Published Event JSON-LD. organizer is hostOrg resolved to entity. orgs[] stay about[]. */
export function eventJsonLd(
  item: ContentItem,
  entities: Entity[] = [],
): Record<string, unknown> | undefined {
  if (item.kind !== "event" || item.status !== "published") return undefined;
  const event = item as EventItem;
  const place = eventPlace(event);
  const url = canonicalUrl(event);
  const schedule = eventSchedule(event);
  const description = event.impactSentence
    || eventWhyCopy(event)
    || listDek(event)
    || (event.body && !isBoilerplateEventCopy(event.body) ? event.body : undefined)
    || event.title;
  const doc: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    startDate: schedule.kind === "timed" ? event.startsAt : schedule.startDay,
    description,
    organizer: organizationFromHost(event.hostOrg, entities),
    url,
    mainEntityOfPage: url,
    eventTimezone: event.timezone,
    about: aboutOrgs(event.orgs, entities),
  };
  if (schedule.kind === "timed" && event.endsAt) doc.endDate = event.endsAt;
  else if (schedule.kind === "date-only") doc.endDate = schedule.endDay;
  if (place) {
    doc.location = {
      "@type": "Place",
      name: place,
      address: event.city || place,
    };
  }
  if (event.registrationUrl) {
    doc.offers = {
      "@type": "Offer",
      url: event.registrationUrl,
    };
  }
  return doc;
}
