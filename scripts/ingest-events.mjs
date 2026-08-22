import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "TheValleyDesk/0.1 (+https://github.com/ajhcs/the-valley-desk)";
const fetchedAt = new Date().toISOString();

function decode(value) {
  return String(value ?? "")
    .replace(/&#8211;/g, "\u2013")
    .replace(/&#038;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "event";
}

function toIso(value) {
  if (!value) return undefined;
  const withZ = String(value).includes("T") ? value : String(value).replace(" ", "T") + "Z";
  const t = Date.parse(withZ);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

const events = [];
const notes = [];

try {
  const res = await fetch("https://dvhimss.org/wp-json/tribe/events/v1/events?per_page=20", {
    headers: { "user-agent": UA },
  });
  notes.push({ url: "https://dvhimss.org/wp-json/tribe/events/v1/events?per_page=20", status: res.status });
  if (res.ok) {
    const data = await res.json();
    for (const e of data.events ?? []) {
      const title = decode(e.title);
      const start = toIso(e.utc_start_date || e.start_date);
      if (!title || !start) continue;
      const page = e.url || "https://dvhimss.org/events-calendar";
      const venue = e.venue && typeof e.venue === "object" ? decode(e.venue.venue) : undefined;
      events.push({
        id: `evt-dvhimss-${e.id}`,
        slug: slugify(title),
        kind: "event",
        title,
        dek: "Official DVHIMSS chapter calendar.",
        body: "Ingested from the DVHIMSS Events Calendar.",
        status: "published",
        publishedAt: start,
        updatedAt: fetchedAt,
        topics: ["chapter", "events"],
        orgs: ["DVHIMSS"],
        region: "regional",
        authors: [],
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
        endsAt: toIso(e.utc_end_date || e.end_date),
        timezone: e.timezone || "America/New_York",
        venue,
        hostOrg: "DVHIMSS",
        registrationUrl: typeof e.website === "string" && e.website.startsWith("http") ? e.website : page,
        partner: "dvhimss",
        autoPublish: true,
      });
    }
  }
} catch (err) {
  notes.push({ url: "dvhimss tec", error: err.message });
}

for (const url of ["https://dvhimss.org/events/", "https://dvhimss.org/events-calendar", "https://njdvhimssevent.com"]) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
    notes.push({ url, status: res.status });
    if (url.includes("njdvhimssevent") && res.ok) {
      const html = await res.text();
      if (/October\s+13,\s+2026|Tuesday,\s+October\s+13,\s+2026/i.test(html)) {
        events.push({
          id: "evt-njdvhimss-fall-2026",
          slug: "njdvhimss-fall-conference-2026",
          kind: "event",
          title: "NJ/DVHIMSS Fall Conference 2026",
          dek: "Scraped from njdvhimssevent.com \u2014 review before publish.",
          body: "Best-effort scrape of the NJ/DVHIMSS conference page.",
          status: "review",
          updatedAt: fetchedAt,
          topics: ["chapter", "conference"],
          orgs: ["NJDVHIMSS", "DVHIMSS"],
          region: "NJ",
          authors: [],
          source: { kind: "ingest", origin: "njdvhimssevent", url, fetchedAt, externalId: "njdvhimss-fall-2026" },
          citations: [{ name: "NJDVHIMSS", url }],
          geo: "Atlantic City, NJ",
          startsAt: "2026-10-13T20:30:00.000Z",
          endsAt: "2026-10-15T15:30:00.000Z",
          timezone: "America/New_York",
          venue: "Hard Rock Hotel & Casino",
          city: "Atlantic City",
          hostOrg: "NJDVHIMSS",
          registrationUrl: url,
          partner: "chapter",
          autoPublish: false,
        });
      }
    }
  } catch (err) {
    notes.push({ url, error: err.message });
  }
}

mkdirSync(join(root, "data"), { recursive: true });
const queuePath = join(root, "data/review-queue.json");
let queue = { items: [] };
try {
  queue = JSON.parse(readFileSync(queuePath, "utf8"));
} catch {
  queue = { items: [] };
}
const byId = new Map((queue.items || []).map((i) => [i.id, i]));
for (const item of events) {
  const prev = byId.get(item.id);
  if (prev && prev.status === "published" && item.status !== "published") continue;
  byId.set(item.id, item);
}
queue.fetchedAt = fetchedAt;
queue.events = { notes, count: events.length };
queue.items = [...byId.values()];
writeFileSync(queuePath, JSON.stringify(queue, null, 2) + "\n");
console.log("event notes", JSON.stringify(notes, null, 2));
console.log("ingested events", events.length, "published", events.filter((e) => e.status === "published").length);
