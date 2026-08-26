import type { Entity } from "../../content/entity";
import type { ContentItem, EventItem, NewsItem } from "../../content/schema";
import { citableFacts, displayFacts, paintSignedLabel } from "../../lib/entityFacts";
import { chipKind, kindChip } from "../../lib/kind";

export const ET = "America/New_York";
export const BRIEFING_CHECK_HOURS_ET = [6, 17] as const;

export const LAB_VIEWS = [
  { to: "/lab", label: "Index", blurb: "Switcher for the four lab prototypes." },
  { to: "/lab/briefing", label: "Briefing", blurb: "Chronological desk since 17:00 ET." },
  { to: "/lab/systems", label: "Systems", blurb: "Health-system command grid." },
  { to: "/lab/horizon", label: "Horizon", blurb: "Deadline timeline of clocks and events." },
  { to: "/lab/calendar", label: "Calendar", blurb: "Month grid of the same horizon." },
] as const;

export type LabPath = (typeof LAB_VIEWS)[number]["to"];

export function etParts(d: Date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

export function etWallToUtc(year: number, month: number, day: number, hour = 12, minute = 0) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const seen = etParts(guess);
  const asUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
  const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
  return new Date(guess.getTime() - (asUtc - wanted));
}

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function etYmd(d: Date | string) {
  const p = etParts(typeof d === "string" ? new Date(d) : d);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export function publishedOnly(items: readonly ContentItem[]) {
  return items.filter((item) => item.status === "published");
}

/** Desk chronology: when the row hit the catalog, not a future clock. */
export function deskInstant(item: ContentItem) {
  return item.publishedAt ?? item.updatedAt;
}

export function chronologicalDesk(items: readonly ContentItem[]) {
  return publishedOnly(items).slice().sort((a, b) => deskInstant(b).localeCompare(deskInstant(a)));
}

export type BriefingFilter = "all" | "news" | "event" | "voice" | "clock";

export function briefingFilterOptions(): { id: BriefingFilter; label: string }[] {
  return [
    { id: "all", label: "All" },
    { id: "news", label: "News" },
    { id: "event", label: "Events" },
    { id: "voice", label: "Voices" },
    { id: "clock", label: "Clocks" },
  ];
}

export function hasNewsClock(item: ContentItem): item is NewsItem {
  return item.kind === "news" && Boolean(item.clockAt);
}

export function filterBriefing(items: readonly ContentItem[], filter: BriefingFilter) {
  const rows = chronologicalDesk(items);
  if (filter === "all") return rows;
  if (filter === "clock") return rows.filter(hasNewsClock);
  if (filter === "news") return rows.filter((item) => item.kind === "news" || item.kind === "policy" || item.kind === "ai");
  return rows.filter((item) => item.kind === filter);
}

export function nextBriefingAt(now = new Date()) {
  const today = etParts(now);
  for (const hour of BRIEFING_CHECK_HOURS_ET) {
    const check = etWallToUtc(today.year, today.month, today.day, hour);
    if (now.getTime() < check.getTime()) return check;
  }
  const noon = etWallToUtc(today.year, today.month, today.day, 12);
  const tomorrow = etParts(new Date(noon.getTime() + 24 * 60 * 60 * 1000));
  return etWallToUtc(tomorrow.year, tomorrow.month, tomorrow.day, BRIEFING_CHECK_HOURS_ET[0]);
}

export function thisWeekStart(now = new Date()) {
  const today = etParts(now);
  const noon = etWallToUtc(today.year, today.month, today.day, 12);
  const weekday = etWeekday(noon);
  return new Date(noon.getTime() - weekday * 24 * 60 * 60 * 1000);
}

export function etWeekday(d: Date) {
  const label = new Intl.DateTimeFormat("en-US", { timeZone: ET, weekday: "short" }).format(d);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[label] ?? 0;
}

export function eventsThisWeek(items: readonly ContentItem[], now = new Date()) {
  const start = thisWeekStart(now).getTime();
  const end = start + 7 * 24 * 60 * 60 * 1000;
  return publishedOnly(items)
    .filter((item): item is EventItem => item.kind === "event")
    .filter((item) => {
      const t = Date.parse(item.startsAt);
      return Number.isFinite(t) && t >= start && t < end;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export type HorizonKind = "clock" | "event";

export type HorizonPoint = {
  id: string;
  at: string;
  end?: string;
  kind: HorizonKind;
  item: ContentItem;
};

/** Structured future markers only: news clockAt and published event startsAt. */
export function horizonPoints(items: readonly ContentItem[]): HorizonPoint[] {
  const points: HorizonPoint[] = [];
  for (const item of publishedOnly(items)) {
    if (item.kind === "news" && item.clockAt) {
      points.push({ id: item.id, at: item.clockAt, kind: "clock", item });
    }
    if (item.kind === "event") {
      points.push({
        id: item.id,
        at: item.startsAt,
        end: item.endsAt,
        kind: "event",
        item,
      });
    }
  }
  return points.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

export function upcomingHorizon(points: readonly HorizonPoint[], now = new Date()) {
  const iso = now.toISOString();
  return points.filter((point) => (point.end ?? point.at) >= iso);
}

export function horizonWindow(now = new Date(), days = 30) {
  const today = etParts(now);
  const start = etWallToUtc(today.year, today.month, today.day, 0);
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  return { start, end };
}

export function pointsInRange(points: readonly HorizonPoint[], start: Date, end: Date) {
  return points.filter((point) => {
    const from = Date.parse(point.at);
    const to = Date.parse(point.end ?? point.at);
    return to >= start.getTime() && from < end.getTime();
  });
}

export function eachEtDay(startIso: string, endIso?: string) {
  const start = etParts(new Date(startIso));
  const end = etParts(new Date(endIso ?? startIso));
  const days: string[] = [];
  let t = etWallToUtc(start.year, start.month, start.day, 12).getTime();
  const last = etWallToUtc(end.year, end.month, end.day, 12).getTime();
  while (t <= last + 1000) {
    days.push(etYmd(new Date(t)));
    t += 24 * 60 * 60 * 1000;
  }
  return days;
}

export function lastDayOfMonth(year: number, month: number) {
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const last = new Date(etWallToUtc(next.year, next.month, 1, 12).getTime() - 24 * 60 * 60 * 1000);
  return etParts(last).day;
}

export type CalendarCell = {
  key: string;
  year: number;
  month: number;
  day: number;
  inMonth: boolean;
};

export function monthCells(year: number, month: number): CalendarCell[] {
  const first = etWallToUtc(year, month, 1, 12);
  const lead = etWeekday(first);
  const last = lastDayOfMonth(year, month);
  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const prevLast = lastDayOfMonth(prev.year, prev.month);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < lead; i++) {
    const day = prevLast - lead + 1 + i;
    cells.push({
      key: `${prev.year}-${pad2(prev.month)}-${pad2(day)}`,
      year: prev.year,
      month: prev.month,
      day,
      inMonth: false,
    });
  }
  for (let day = 1; day <= last; day++) {
    cells.push({
      key: `${year}-${pad2(month)}-${pad2(day)}`,
      year,
      month,
      day,
      inMonth: true,
    });
  }
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  while (cells.length % 7 !== 0) {
    const day = cells.length - (lead + last) + 1;
    cells.push({
      key: `${next.year}-${pad2(next.month)}-${pad2(day)}`,
      year: next.year,
      month: next.month,
      day,
      inMonth: false,
    });
  }
  return cells;
}

export function shiftMonth(year: number, month: number, delta: number) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function pointsOnDay(points: readonly HorizonPoint[], key: string) {
  return points.filter((point) => eachEtDay(point.at, point.end).includes(key));
}

export function geoRegion(geo?: string): "PA" | "NJ" | "DE" | "regional" {
  if (!geo) return "regional";
  if (/\bDE\b|Delaware|Newark/i.test(geo) && !/NJ|PA/.test(geo)) return "DE";
  if (/\bNJ\b|New Jersey|Camden|Marlton|Vineland/i.test(geo)) return "NJ";
  if (/\bPA\b|Philadelphia|Bryn Mawr|West Reading|Pennsylvania/i.test(geo)) return "PA";
  return "regional";
}

export type SystemFilter = "all" | "PA" | "NJ" | "DE" | "moved" | "facts";

export function systemFilterOptions(): { id: SystemFilter; label: string }[] {
  return [
    { id: "all", label: "All systems" },
    { id: "PA", label: "PA" },
    { id: "NJ", label: "NJ" },
    { id: "DE", label: "DE" },
    { id: "moved", label: "With movement" },
    { id: "facts", label: "Signed facts" },
  ];
}

export function liveSystems(entities: readonly Entity[]) {
  return entities.filter((entity) => entity.kind === "system");
}

export function childIds(systemId: string, entities: readonly Entity[]) {
  const ids = new Set<string>([systemId]);
  for (const entity of entities) {
    if (entity.parentId === systemId) ids.add(entity.id);
    if (entity.orgs?.includes(systemId)) ids.add(entity.id);
  }
  return ids;
}

export function systemIdForOrg(orgId: string, byId: ReadonlyMap<string, Entity>) {
  const seen = new Set<string>();
  let id: string | undefined = orgId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const entity = byId.get(id);
    if (!entity) return undefined;
    if (entity.kind === "system") return entity.id;
    id = entity.parentId;
  }
  return undefined;
}

export function itemsForSystem(
  items: readonly ContentItem[],
  systemId: string,
  entities: readonly Entity[],
  byId: ReadonlyMap<string, Entity>,
) {
  const owned = childIds(systemId, entities);
  return chronologicalDesk(items).filter((item) =>
    item.orgs.some((org) => owned.has(org) || systemIdForOrg(org, byId) === systemId),
  );
}

export function signedSystemFacts(entity: Entity) {
  return displayFacts(citableFacts(entity.facts)).map((fact) => ({
    ...fact,
    painted: paintSignedLabel(fact.label),
  }));
}

export type SystemCard = {
  entity: Entity;
  region: "PA" | "NJ" | "DE" | "regional";
  hospitals: number;
  items: ContentItem[];
  latest?: ContentItem;
  facts: ReturnType<typeof signedSystemFacts>;
};

export function systemCards(items: readonly ContentItem[], entities: readonly Entity[]): SystemCard[] {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  return liveSystems(entities).map((entity) => {
    const rows = itemsForSystem(items, entity.id, entities, byId);
    return {
      entity,
      region: geoRegion(entity.geo),
      hospitals: entities.filter((row) => row.parentId === entity.id && row.kind === "hospital" && !row.outOfBox).length,
      items: rows,
      latest: rows[0],
      facts: signedSystemFacts(entity),
    };
  });
}

export function filterSystems(cards: readonly SystemCard[], filter: SystemFilter) {
  if (filter === "all") return cards;
  if (filter === "moved") return cards.filter((card) => card.items.length > 0);
  if (filter === "facts") return cards.filter((card) => card.facts.length > 0);
  return cards.filter((card) => card.region === filter);
}

export function topicLabel(item: ContentItem) {
  if (item.kind === "event") return "EVENT";
  if (item.kind === "voice") return "VOICE";
  const painted = chipKind(item);
  if (painted === "policy") return "POLICY";
  if (painted === "ai") return "AI";
  const topic = (item.topics[0] ?? "").toLowerCase();
  if (topic === "finance") return "FINANCE";
  if (topic === "contract") return "CONTRACT";
  if (topic === "ehr" || topic === "downtime") return "OPERATIONS";
  if (topic === "partnership") return "PARTNERSHIP";
  return kindChip(item);
}

export function formatEtClock(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatEtWeekday(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

export function formatEtMonthTitle(year: number, month: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    month: "long",
    year: "numeric",
  }).format(etWallToUtc(year, month, 1, 12));
}

export function daysUntil(iso: string, now = new Date()) {
  const target = etParts(new Date(iso));
  const today = etParts(now);
  const a = etWallToUtc(today.year, today.month, today.day, 0).getTime();
  const b = etWallToUtc(target.year, target.month, target.day, 0).getTime();
  return Math.round((b - a) / 86_400_000);
}
