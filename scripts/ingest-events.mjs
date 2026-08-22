import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "TheValleyDesk/0.1 (+https://github.com/ajhcs/the-valley-desk)";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const TZ = "America/New_York";
const fetchedAt = new Date().toISOString();
const now = Date.now();

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

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

function htmlToText(html) {
  return decode(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function zonedToIso(year, month, day, hour, minute) {
  const candidates = ["-04:00", "-05:00"];
  for (const off of candidates) {
    const stamp = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${off}`;
    const t = Date.parse(stamp);
    if (!Number.isFinite(t)) continue;
    const d = new Date(t);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(d)
        .map((p) => [p.type, p.value]),
    );
    if (+parts.year === year && +parts.month === month && +parts.day === day && +parts.hour === hour && +parts.minute === minute) {
      return d.toISOString();
    }
  }
  return new Date(Date.UTC(year, month - 1, day, hour + 4, minute)).toISOString();
}

function toMinutes24(h, min, pm) {
  let hour = h % 12;
  if (h === 12) hour = 12;
  else if (pm) hour += 12;
  return hour * 60 + min;
}

function parseClockTimes(block) {
  const found = [];
  const re = /(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?(?:\s*[\u2013\u2014\-]\s*(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?)?/gi;
  let m;
  while ((m = re.exec(block))) {
    found.push({
      h: +m[1],
      min: +m[2],
      mer: m[3] ? m[3][0].toLowerCase() : "",
      endH: m[4] ? +m[4] : undefined,
      endMin: m[5] ? +m[5] : undefined,
      endMer: m[6] ? m[6][0].toLowerCase() : "",
    });
  }
  return found;
}

function pickMinutes(h, min, mer, last) {
  if (mer === "p") return toMinutes24(h, min, true);
  if (mer === "a") return toMinutes24(h, min, false);
  const am = toMinutes24(h, min, false);
  const pm = toMinutes24(h, min, true);
  if (last < 0) return h >= 7 && h !== 12 ? am : pm;
  if (am >= last - 90) return am;
  return pm;
}

function dayWindow(block) {
  const times = parseClockTimes(block);
  if (!times.length) return {};
  const first = times[0];
  const last = times[times.length - 1];
  const start = pickMinutes(first.h, first.min, first.mer, -1);
  const endH = last.endH ?? last.h;
  const endM = last.endMin ?? last.min;
  const endMer = last.endMer || last.mer;
  const eveningEnd = /reception|dinner|cocktail/i.test(block) && endH <= 10;
  let end;
  if (endMer === "p" || eveningEnd) end = toMinutes24(endH, endM, true);
  else if (endMer === "a") end = toMinutes24(endH, endM, false);
  else if (endH >= 1 && endH <= 6) end = toMinutes24(endH, endM, true);
  else end = toMinutes24(endH, endM, false);
  if (end < start) end = toMinutes24(endH, endM, true);
  return {
    startH: Math.floor(start / 60),
    startM: start % 60,
    endH: Math.floor(end / 60),
    endM: end % 60,
  };
}

function extractVenue(pages) {
  const blob = pages.map((p) => p.text).join("\n");
  let venue;
  let city;
  const hard = blob.match(/Hard Rock Hotel\s*(?:&|and)\s*Casino(?:\s+Atlantic City)?/i);
  if (hard) {
    venue = "Hard Rock Hotel & Casino";
    city = "Atlantic City";
  }
  const ballamor = blob.match(/Ballamor Golf Club/);
  const egg = blob.match(/Egg Harbor Township,\s*NJ/i);
  return { venue, city, golfVenue: ballamor ? "Ballamor Golf Club" : undefined, golfCity: egg ? "Egg Harbor Township" : undefined };
}

function extractRegistration(pages) {
  for (const p of pages) {
    const m = p.html.match(/https:\/\/njdvhimssevent\.com\/(?:conference-registration-fees\/?|register\/?)/i);
    if (m) return m[0].replace(/\/?$/, "/");
  }
  return "https://njdvhimssevent.com/conference-registration-fees/";
}

function parseDatedEvents(pages) {
  const { venue, city, golfVenue, golfCity } = extractVenue(pages);
  const registrationUrl = extractRegistration(pages);
  const dated = [];
  for (const page of pages) {
    if (!page.ok) continue;
    const text = page.text;
    const dateRe =
      /(?:(Day\s+\d+\s*[\u2013\u2014-]\s*[A-Za-z]+)\s+)?(?:(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})/gi;
    const matches = [...text.matchAll(dateRe)];
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const idx = m.index ?? 0;
      const next = matches[i + 1]?.index ?? Math.min(text.length, idx + 900);
      const before = text.slice(Math.max(0, idx - 80), idx);
      const block = text.slice(idx, next);
      const year = +m[5];
      const month = MONTHS[m[3].toLowerCase()];
      const day = +m[4];
      const dayLabel = (m[1] || "").replace(/\s+/g, " ").trim();
      const weekday = m[2] || "";
      const labeled = Boolean(dayLabel || weekday || /\bDate\s*:/i.test(before));
      const priceOnly = /after|changes to|\$/i.test(before) && !labeled;
      if (!labeled || priceOnly) continue;
      const win = dayWindow(block);
      const startH = win.startH ?? 9;
      const startM = win.startM ?? 0;
      const startsAt = zonedToIso(year, month, day, startH, startM);
      const endsAt = win.endH != null ? zonedToIso(year, month, day, win.endH, win.endM) : undefined;
      if (!startsAt || Date.parse(startsAt) < now - 2 * 86400000) continue;
      let title;
      if (/golf outing/i.test(text) && /golf-event/i.test(page.url)) {
        title = "NJ/DVHIMSS Annual Conference Golf Outing";
      } else if (dayLabel) {
        title = `NJ/DVHIMSS Fall Conference \u2014 ${dayLabel}`;
      } else if (/golf/i.test(page.url)) {
        title = "NJ/DVHIMSS Golf Event";
      } else {
        title = `NJ/DVHIMSS Fall Conference \u2014 ${weekday} ${m[3]} ${day}, ${year}`;
      }
      const useGolfVenue = /golf/i.test(title) && golfVenue && !/Fall Conference \u2014 Day 2|Day 3/i.test(title);
      dated.push({
        ymd: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        title,
        startsAt,
        endsAt,
        pageUrl: page.url,
        venue: useGolfVenue ? golfVenue : venue,
        city: useGolfVenue ? golfCity : city,
        registrationUrl,
        year,
        dayLabel,
      });
    }
  }
  const byKey = new Map();
  for (const row of dated) {
    const key = `${row.ymd}:${row.title}`;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  const unique = [...byKey.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const confDays = unique.filter((r) => /Fall Conference/i.test(r.title));
  const items = [];
  if (confDays.length) {
    const first = confDays[0];
    const last = confDays[confDays.length - 1];
    items.push({
      id: `evt-njdvhimss-fall-${first.year}`,
      slug: `njdvhimss-fall-conference-${first.year}`,
      title: `NJ/DVHIMSS Fall Conference ${first.year}`,
      dek: "Parsed from njdvhimssevent.com agenda \u2014 review before publish.",
      body: `Dated ${confDays.map((d) => d.ymd).join(", ")} from the NJ/DVHIMSS conference site.`,
      startsAt: first.startsAt,
      endsAt: last.endsAt || last.startsAt,
      venue: first.venue,
      city: first.city,
      url: "https://njdvhimssevent.com/",
      registrationUrl: first.registrationUrl,
      externalId: `njdvhimss-fall-${first.year}`,
    });
  }
  for (const row of unique) {
    items.push({
      id: `evt-njdvhimss-${row.ymd}-${slugify(row.title).replace(/^nj-dvhimss-/, "").slice(0, 40)}`,
      slug: slugify(row.title),
      title: row.title,
      dek: "Parsed from njdvhimssevent.com \u2014 review before publish.",
      body: `Session window scraped from ${row.pageUrl}.`,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      venue: row.venue,
      city: row.city,
      url: row.pageUrl,
      registrationUrl: row.registrationUrl,
      externalId: `${row.ymd}-${slugify(row.title).slice(0, 32)}`,
    });
  }
  return items;
}

function asNjReview(row) {
  return {
    id: row.id,
    slug: row.slug,
    kind: "event",
    title: row.title,
    dek: row.dek,
    body: row.body,
    status: "review",
    updatedAt: fetchedAt,
    topics: ["chapter", "conference"],
    orgs: ["NJDVHIMSS", "DVHIMSS"],
    region: "NJ",
    authors: [],
    source: {
      kind: "ingest",
      origin: "njdvhimssevent",
      url: row.url,
      fetchedAt,
      externalId: row.externalId,
    },
    citations: [{ name: "NJDVHIMSS", url: row.url }],
    geo: [row.venue, row.city].filter(Boolean).join(", ") || undefined,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    timezone: TZ,
    venue: row.venue,
    city: row.city,
    hostOrg: "NJDVHIMSS",
    registrationUrl: row.registrationUrl,
    partner: "chapter",
    autoPublish: false,
  };
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
        timezone: e.timezone || TZ,
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

for (const url of ["https://dvhimss.org/events/", "https://dvhimss.org/events-calendar"]) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
    notes.push({ url, status: res.status });
  } catch (err) {
    notes.push({ url, error: err.message });
  }
}

const njUrls = [
  "https://njdvhimssevent.com/",
  "https://njdvhimssevent.com/agenda/",
  "https://njdvhimssevent.com/2024-agenda/",
  "https://njdvhimssevent.com/register",
  "https://njdvhimssevent.com/schedule",
  "https://njdvhimssevent.com/hotel/",
  "https://njdvhimssevent.com/golf-event/",
  "https://njdvhimssevent.com/conference-registration-fees/",
];

const njPages = [];
for (const url of njUrls) {
  try {
    const res = await fetch(url, { headers: { "user-agent": BROWSER_UA }, redirect: "follow" });
    notes.push({ url, status: res.status });
    const html = res.ok ? await res.text() : "";
    njPages.push({ url, status: res.status, ok: res.ok, html, text: html ? htmlToText(html) : "" });
  } catch (err) {
    notes.push({ url, error: err.message });
    njPages.push({ url, status: 0, ok: false, html: "", text: "" });
  }
}

for (const row of parseDatedEvents(njPages)) {
  events.push(asNjReview(row));
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
const freshNj = new Set(events.filter((e) => e.source?.origin === "njdvhimssevent").map((e) => e.id));
for (const [id, item] of [...byId.entries()]) {
  if (item?.source?.origin === "njdvhimssevent" && !freshNj.has(id)) byId.delete(id);
}
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
console.log(
  "nj review",
  events.filter((e) => e.source?.origin === "njdvhimssevent" && e.status === "review").length,
);
