import type { EventItem } from "../content/schema";
import { hasInternalProcessLanguage } from "./editorialCopy";
import { eventPlace } from "./format";

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isTrivialRestatement(text: string, item: EventItem) {
  const n = normalize(text);
  if (!n) return true;
  const title = normalize(item.title);
  const place = normalize(eventPlace(item) ?? item.city ?? item.venue ?? item.geo ?? "");
  if (n === title) return true;
  if (place && (n === place || n === `${title} ${place}` || n === `${title} in ${place}`)) return true;
  if (title && n === `${title} in ${normalize(item.city ?? "")}`) return true;
  return false;
}

export function isBoilerplateEventCopy(text: string | undefined) {
  return hasInternalProcessLanguage(text);
}

/** Genuine whyAttend / audience / fee / deadline copy only. Never adapter provenance. */
export function eventWhyCopy(item: EventItem) {
  const deadline = item.registrationDeadline
    ? `Registration deadline ${new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: item.timezone,
      }).format(new Date(item.registrationDeadline))}.`
    : undefined;
  for (const text of [item.whyAttend, item.healthSystemRelevance, deadline, item.body]) {
    const value = text?.trim();
    if (!value) continue;
    if (isBoilerplateEventCopy(value) || isTrivialRestatement(value, item)) continue;
    return value;
  }
  return undefined;
}

export function eventWhyLine(item: EventItem) {
  return eventWhyCopy(item) ?? "Details not yet published.";
}
