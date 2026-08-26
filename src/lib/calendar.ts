import type { EventItem } from "../content/schema";

export type EventTimeKind = "date-only" | "timed" | "time-tbd";

export type EventSchedule = {
  kind: EventTimeKind;
  timeZone: string;
  start: string;
  end?: string;
  startDay: string;
  endDay: string;
};

function wallParts(iso: string, timeZone: string) {
  const map: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso))) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour ?? "00",
    minute: map.minute ?? "00",
    ymd: `${map.year}-${map.month}-${map.day}`,
  };
}

function isMidnightWall(iso: string, timeZone: string) {
  const parts = wallParts(iso, timeZone);
  return parts.hour === "00" && parts.minute === "00";
}

function addCivilDays(ymd: string, days: number) {
  const [year, month, day] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function compactUtc(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function compactDay(ymd: string) {
  return ymd.replaceAll("-", "");
}

/** Date-only, timed, or time-TBD. Midnight walls are never treated as 12:00 AM. */
export function eventSchedule(item: EventItem): EventSchedule {
  const timeZone = item.timezone || "America/New_York";
  const startMidnight = isMidnightWall(item.startsAt, timeZone);
  const startDay = wallParts(item.startsAt, timeZone).ymd;
  const endDay = item.endsAt ? wallParts(item.endsAt, timeZone).ymd : startDay;
  if (startMidnight) {
    const endMidnight = !item.endsAt || isMidnightWall(item.endsAt, timeZone);
    return {
      kind: item.endsAt && endMidnight ? "date-only" : "time-tbd",
      timeZone,
      start: item.startsAt,
      end: item.endsAt,
      startDay,
      endDay,
    };
  }
  return {
    kind: "timed",
    timeZone,
    start: item.startsAt,
    end: item.endsAt,
    startDay,
    endDay,
  };
}

function formatDay(ymd: string, timeZone: string, weekday = true) {
  const [year, month, day] = ymd.split("-").map(Number);
  const noon = new Date(Date.UTC(year, month - 1, day, 16));
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: weekday ? "short" : undefined,
    month: "short",
    day: "numeric",
  }).format(noon);
}

function formatClock(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** Public when-line. Never prints midnight unless the source is a real timed clock. */
export function formatEventWhen(item: EventItem) {
  const schedule = eventSchedule(item);
  const startDay = formatDay(schedule.startDay, schedule.timeZone);
  if (schedule.kind === "date-only") {
    if (schedule.endDay !== schedule.startDay) {
      return `${startDay}–${formatDay(schedule.endDay, schedule.timeZone)}`;
    }
    return startDay;
  }
  if (schedule.kind === "time-tbd") {
    return `${startDay} · Time not published`;
  }
  const startTime = formatClock(schedule.start, schedule.timeZone);
  if (!schedule.end) return `${startDay} · ${startTime} · End time not published`;
  if (schedule.endDay === schedule.startDay) {
    return `${startDay} · ${startTime}–${formatClock(schedule.end, schedule.timeZone)}`;
  }
  return `${startDay} · ${startTime} → ${formatDay(schedule.endDay, schedule.timeZone)} · ${formatClock(schedule.end, schedule.timeZone)}`;
}

export function googleCalendarDates(item: EventItem) {
  const schedule = eventSchedule(item);
  if (schedule.kind === "date-only" || schedule.kind === "time-tbd") {
    const exclusive = addCivilDays(schedule.endDay, 1);
    return `${compactDay(schedule.startDay)}/${compactDay(exclusive)}`;
  }
  if (schedule.end) return `${compactUtc(schedule.start)}/${compactUtc(schedule.end)}`;
  return `${compactUtc(schedule.start)}/${compactUtc(schedule.start)}`;
}

export function googleCalendarUrl(item: EventItem) {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: item.title,
    dates: googleCalendarDates(item),
    details: item.source.url ? `Source: ${item.source.url}` : item.body,
    location: item.venue ?? item.city ?? item.geo ?? "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function zonedWallToUtc(ymd: string, hour: number, minute: number, timeZone: string): Date {
  const [year, month, day] = ymd.split("-").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const seen = wallParts(guess.toISOString(), timeZone);
  const asUtc = Date.UTC(
    Number(seen.year),
    Number(seen.month) - 1,
    Number(seen.day),
    Number(seen.hour),
    Number(seen.minute),
    0,
  );
  const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
  return new Date(guess.getTime() - (asUtc - wanted));
}

/** First instant after the event is over, in UTC. Date-only and time-TBD use the next civil midnight. */
export function eventExclusiveEnd(item: EventItem): Date {
  const schedule = eventSchedule(item);
  if (schedule.kind === "timed" && schedule.end) return new Date(schedule.end);
  return zonedWallToUtc(addCivilDays(schedule.endDay, 1), 0, 0, schedule.timeZone);
}

export function eventHasEnded(item: EventItem, now = new Date()) {
  return now.getTime() >= eventExclusiveEnd(item).getTime();
}

export function eventCopyMarksCancelled(
  item: Pick<EventItem, "title" | "dek" | "body"> & { cancelled?: boolean },
) {
  if (item.cancelled) return true;
  return /\b(cancelled|canceled|postponed)\b/i.test(`${item.title}\n${item.dek}\n${item.body}`);
}

export type EventLifecycle = "upcoming" | "completed" | "cancelled" | "withdrawn";

/** Listing vs permalink: withdrawn ingest rows leave the catalog; cancelled/completed keep the URL. */
export function eventLifecycle(item: EventItem, now = new Date()): EventLifecycle {
  if (item.status === "unpublished") return "withdrawn";
  if (eventCopyMarksCancelled(item)) return "cancelled";
  if (eventHasEnded(item, now)) return "completed";
  return "upcoming";
}

export function eventIsUpcoming(item: EventItem, now = new Date()) {
  return eventLifecycle(item, now) === "upcoming";
}
