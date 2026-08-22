import type { ContentItem, EventItem } from "./schema";

/** Published Event JSON-LD from the EventItem envelope. Never review. No second model. */
export function eventJsonLd(item: ContentItem): Record<string, unknown> | undefined {
  if (item.kind !== "event" || item.status !== "published") return undefined;
  const event = item as EventItem;
  const place = [event.venue, event.city].filter(Boolean).join(", ");
  const doc: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    startDate: event.startsAt,
    description: event.impactSentence || event.dek,
    organizer: event.orgs.map((id) => ({
      "@type": "Organization",
      identifier: id,
    })),
  };
  if (event.endsAt) doc.endDate = event.endsAt;
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
