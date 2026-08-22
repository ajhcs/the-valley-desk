import type { ContentItem, EventItem } from "../content/schema";
import type { IngestBatch } from "./envelope";
import { toReviewQueue } from "./envelope";

const UA = "TheValleyDesk/0.1 (+https://github.com/ajhcs/the-valley-desk)";

function decode(value: string) {
  return value
    .replace(/&#8211;/g, "\u2013")
    .replace(/&#038;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function slugify(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "event";
}

function toIso(value: string) {
  const t = Date.parse(value.replace(" ", "T") + (value.includes("Z") || value.includes("+") ? "" : "Z"));
  if (Number.isFinite(t)) return new Date(t).toISOString();
  const local = Date.parse(value);
  return Number.isFinite(local) ? new Date(local).toISOString() : undefined;
}

function eventRow(partial: Omit<EventItem, "kind" | "status" | "authors" | "autoPublish" | "featured"> & {
  status?: EventItem["status"];
  autoPublish?: boolean;
}): EventItem {
  return {
    ...partial,
    kind: "event",
    status: partial.status ?? "review",
    authors: [],
    autoPublish: partial.autoPublish ?? false,
    featured: false,
  };
}

export async function fetchDvhimssCalendar(fetchImpl: typeof fetch = fetch, fetchedAt = new Date().toISOString()) {
  const url = "https://dvhimss.org/wp-json/tribe/events/v1/events?per_page=20";
  const res = await fetchImpl(url, { headers: { "user-agent": UA } });
  if (!res.ok) return [] as EventItem[];
  const data = (await res.json()) as { events?: Record<string, unknown>[] };
  const rows: EventItem[] = [];
  for (const e of data.events ?? []) {
    const title = decode(String(e.title ?? ""));
    const page = String(e.url ?? "https://dvhimss.org/events-calendar");
    const start = toIso(String(e.utc_start_date ?? e.start_date ?? ""));
    if (!title || !start) continue;
    const end = toIso(String(e.utc_end_date ?? e.end_date ?? ""));
    const venueObj = e.venue && typeof e.venue === "object" ? (e.venue as { venue?: string; city?: string }) : {};
    const venue = venueObj.venue ? decode(String(venueObj.venue)) : undefined;
    rows.push(
      eventRow({
        id: `evt-dvhimss-${e.id}`,
        slug: slugify(title),
        title,
        dek: "Official DVHIMSS chapter calendar.",
        body: "Ingested from the DVHIMSS Events Calendar REST feed.",
        publishedAt: start,
        updatedAt: fetchedAt,
        topics: ["chapter", "events"],
        orgs: ["DVHIMSS"],
        region: "regional",
        source: {
          kind: "ingest",
          origin: "dvhimss-events",
          url: page,
          fetchedAt,
          externalId: String(e.id),
        },
        citations: [{ name: "DVHIMSS", url: page }],
        geo: venue,
        startsAt: start,
        endsAt: end,
        timezone: String(e.timezone ?? "America/New_York"),
        venue,
        city: venueObj.city,
        hostOrg: "DVHIMSS",
        registrationUrl: typeof e.website === "string" && e.website.startsWith("http") ? e.website : page,
        partner: "dvhimss",
        autoPublish: true,
        status: "published",
      }),
    );
  }
  return rows;
}

export async function scrapeNjdvhimss(fetchImpl: typeof fetch = fetch, fetchedAt = new Date().toISOString()) {
  const urls = ["https://njdvhimssevent.com/", "https://njdvhimssevent.com"];
  let html = "";
  let used = urls[0];
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, { headers: { "user-agent": UA } });
      if (res.ok) {
        html = await res.text();
        used = url;
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (!html) return [] as EventItem[];
  const rows: EventItem[] = [];
  const conference = /October\s+13,\s+2026[\s\S]{0,80}October\s+15,\s+2026|Tuesday,\s+October\s+13,\s+2026/i.test(html);
  if (conference) {
    rows.push(
      eventRow({
        id: "evt-njdvhimss-fall-2026",
        slug: "njdvhimss-fall-conference-2026",
        title: "NJ/DVHIMSS Fall Conference 2026",
        dek: "Scraped from njdvhimssevent.com \u2014 review before publish.",
        body: "Best-effort scrape of the NJ/DVHIMSS conference page.",
        updatedAt: fetchedAt,
        topics: ["chapter", "conference"],
        orgs: ["NJDVHIMSS", "DVHIMSS"],
        region: "NJ",
        source: {
          kind: "ingest",
          origin: "njdvhimssevent",
          url: used,
          fetchedAt,
          externalId: "njdvhimss-fall-2026",
        },
        citations: [{ name: "NJDVHIMSS", url: used }],
        geo: "Atlantic City, NJ",
        startsAt: "2026-10-13T20:30:00.000Z",
        endsAt: "2026-10-15T15:30:00.000Z",
        timezone: "America/New_York",
        venue: "Hard Rock Hotel & Casino",
        city: "Atlantic City",
        hostOrg: "NJDVHIMSS",
        registrationUrl: used,
        partner: "chapter",
        autoPublish: false,
        status: "review",
      }),
    );
  }
  if (/Golf/i.test(html) && /October\s+13/i.test(html)) {
    rows.push(
      eventRow({
        id: "evt-njdvhimss-golf-2026",
        slug: "njdvhimss-annual-golf-outing-2026",
        title: "NJDVHIMSS Annual Golf Outing",
        dek: "Scraped from njdvhimssevent.com \u2014 review before publish.",
        body: "Best-effort scrape of the golf outing listed on the conference site.",
        updatedAt: fetchedAt,
        topics: ["chapter", "networking"],
        orgs: ["NJDVHIMSS"],
        region: "NJ",
        source: {
          kind: "ingest",
          origin: "njdvhimssevent",
          url: used,
          fetchedAt,
          externalId: "njdvhimss-golf-2026",
        },
        citations: [{ name: "NJDVHIMSS", url: used }],
        geo: "Atlantic City, NJ",
        startsAt: "2026-10-13T13:30:00.000Z",
        endsAt: "2026-10-13T19:30:00.000Z",
        timezone: "America/New_York",
        city: "Atlantic City",
        hostOrg: "NJDVHIMSS",
        registrationUrl: used,
        partner: "chapter",
        autoPublish: false,
        status: "review",
      }),
    );
  }
  return rows;
}

export async function ingestEvents(now = new Date(), fetchImpl: typeof fetch = fetch): Promise<ContentItem[]> {
  const fetchedAt = now.toISOString();
  const [official, scraped] = await Promise.all([
    fetchDvhimssCalendar(fetchImpl, fetchedAt),
    scrapeNjdvhimss(fetchImpl, fetchedAt),
  ]);
  const batch: IngestBatch = {
    adapter: "events",
    fetchedAt,
    items: [...official, ...scraped],
  };
  return toReviewQueue(batch);
}
