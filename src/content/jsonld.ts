import type { ContentItem, EventItem, VoiceItem } from "./schema";
import type { Entity } from "./entity";
import { canonicalUrl, publicOrigin } from "../lib/canonical";
import { eventPlace, listDek } from "../lib/format";
import { eventLifecycle, eventSchedule } from "../lib/calendar";
import { eventWhyCopy, isBoilerplateEventCopy } from "../lib/eventCopy";
import { isInstitutionalVoice } from "../lib/voiceCopy";
import { primaryDisplayLabel } from "../lib/taxonomy";
import { entityIndex } from "./entity";

export const NEWS_ARTICLE_KINDS = new Set(["news", "policy", "ai", "interview"]);

function publisher(origin = publicOrigin()) {
  return {
    "@type": "Organization",
    name: "The Valley Desk",
    url: `${origin}/`,
  };
}

function attendanceMode(format: EventItem["format"]) {
  if (format === "virtual") return "https://schema.org/OnlineEventAttendanceMode";
  if (format === "hybrid") return "https://schema.org/MixedEventAttendanceMode";
  if (format === "in-person") return "https://schema.org/OfflineEventAttendanceMode";
  return undefined;
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
  origin = publicOrigin(),
): Record<string, unknown> | undefined {
  if (item.status !== "published") return undefined;
  if (item.kind === "event") return eventJsonLd(item, entities, origin);
  if (item.kind === "voice") return voiceJsonLd(item, entities, origin);
  if (!NEWS_ARTICLE_KINDS.has(item.kind)) return undefined;

  const url = canonicalUrl(item, origin);
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
    publisher: publisher(origin),
    url,
    mainEntityOfPage: url,
    about: aboutOrgs(item.orgs, entities),
    isAccessibleForFree: true,
    inLanguage: "en-US",
  };
  if (item.source.url) doc.isBasedOn = item.source.url;
  const keywords = [...new Set([primaryDisplayLabel(item), ...item.topics].filter(Boolean))];
  if (keywords.length) doc.keywords = keywords;
  const section = primaryDisplayLabel(item);
  if (section) doc.articleSection = section;
  return doc;
}

/** Published Event JSON-LD. organizer is hostOrg resolved to entity. orgs[] stay about[]. */
export function eventJsonLd(
  item: ContentItem,
  entities: Entity[] = [],
  origin = publicOrigin(),
): Record<string, unknown> | undefined {
  if (item.kind !== "event" || item.status !== "published") return undefined;
  const event = item as EventItem;
  const place = eventPlace(event);
  const url = canonicalUrl(event, origin);
  const schedule = eventSchedule(event);
  const lifecycle = eventLifecycle(event);
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
    eventStatus: lifecycle === "cancelled"
      ? "https://schema.org/EventCancelled"
      : lifecycle === "completed"
        ? "https://schema.org/EventCompleted"
        : "https://schema.org/EventScheduled",
  };
  const mode = attendanceMode(event.format);
  if (mode) doc.eventAttendanceMode = mode;
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

function voiceJsonLd(item: VoiceItem, entities: Entity[], origin = publicOrigin()) {
  const url = canonicalUrl(item, origin);
  const doc: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "SocialMediaPosting",
    headline: item.title,
    description: item.impactSentence || item.dek,
    datePublished: item.publishedAt,
    dateModified: item.updatedAt,
    author: { "@type": "Person", name: item.person },
    publisher: publisher(origin),
    url,
    mainEntityOfPage: url,
    identifier: item.originalUrl,
    isBasedOn: item.originalUrl,
    about: aboutOrgs(item.orgs, entities),
    inLanguage: "en-US",
  };
  if (isInstitutionalVoice(item)) doc.genre = "Institutional note";
  return doc;
}
