import type { IngestBatch } from "./envelope";
import { toReviewQueue } from "./envelope";
import type { ContentItem } from "../content/schema";

export async function fetchPartnerEvents(now = new Date()): Promise<ContentItem[]> {
  const fetchedAt = now.toISOString();
  const batch: IngestBatch = {
    adapter: "events-stub",
    fetchedAt,
    items: [{
      id: "evt-stub-dvhimss-fall",
      slug: "dvhimss-fall-program-2026",
      kind: "event",
      title: "DVHIMSS Fall Program",
      dek: "Chapter program stub. Live adapter will replace this row.",
      body: "Stub ingest. Lands in review unless autoPublish is true.",
      status: "review",
      updatedAt: fetchedAt,
      topics: ["chapter", "events"],
      orgs: ["DVHIMSS"],
      region: "regional",
      authors: [],
      source: {
        kind: "ingest",
        origin: "dvhimss-events-stub",
        url: "https://dvhimss.org/events/",
        fetchedAt,
        externalId: "stub-dvhimss-fall-2026",
      },
      startsAt: "2026-10-15T17:00:00.000Z",
      endsAt: "2026-10-15T20:00:00.000Z",
      timezone: "America/New_York",
      venue: "TBD",
      city: "Philadelphia",
      hostOrg: "DVHIMSS",
      partner: "dvhimss",
      autoPublish: false,
    }],
  };
  return toReviewQueue(batch);
}
