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
  // Placeholder / passive filler never qualifies as professional attendance copy
  if (/^(join us|learn more|networking|details|tbd|tba|to be announced|coming soon)/i.test(n)) return true;
  if (/^(event details|more information|stay tuned)/i.test(title) && n.length < 24) return true;
  return false;
}

function isPlaceholderEventCopy(text: string) {
  const n = normalize(text);
  if (!n) return true;
  if (/\b(tbd|tba|to be announced|to be determined|coming soon|stay tuned|details to follow)\b/i.test(n)) return true;
  if (/^(join us|learn more|save the date)/i.test(n) && n.split(/\s+/).length < 8) return true;
  return false;
}

export function isBoilerplateEventCopy(text: string | undefined) {
  if (!text?.trim()) return false;
  if (hasInternalProcessLanguage(text)) return true;
  if (isPlaceholderEventCopy(text)) return true;
  // Defensive negative-disclaimer patterns also count as boilerplate for events
  if (/\bnot (?:a|an|the)\b/i.test(text) && /\b(not the same|not a filing|not audited)\b/i.test(text)) return true;
  return false;
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

export function eventLocationLine(item: EventItem) {
  return eventPlace(item) ?? "Location not yet published.";
}

export function eventHostLine(item: EventItem) {
  return item.hostOrg.trim() || "Host not yet published.";
}
