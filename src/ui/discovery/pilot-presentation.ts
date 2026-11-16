import type { DiscoveryPilotRecord } from "../../content/discovery-pilot";

/** Display deposited XML ampersands as text; the retained source value stays exact. */
export function pilotAffiliationLabel(value: string) {
  return value.replaceAll("&amp;", "&");
}

export function pilotRecordPath(record: Pick<DiscoveryPilotRecord, "kind" | "nativeId">) {
  return `/discover?${new URLSearchParams({ kind: record.kind, q: record.nativeId })}`;
}

/** A preview changes display order only; the complete source roster stays intact. */
export function pilotAuthorPreview(authors: DiscoveryPilotRecord["authors"], query: string) {
  const terms = query.normalize("NFKC").toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matching = terms.length ? authors.filter(author => {
    const text = [author.name, ...author.affiliations].join(" ").normalize("NFKC").toLowerCase();
    return terms.every(term => text.includes(term));
  }) : [];
  return { authors: (matching.length ? matching : authors).slice(0, 3), matchesSearch: matching.length > 0 };
}

export function pilotDateLabel(value: string) {
  if (/^\d{4}$/.test(value)) return value;
  const monthOnly = /^\d{4}-\d{2}$/.test(value);
  const instant = new Date(monthOnly ? `${value}-01T00:00:00Z` : value.length === 10 ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(instant.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", ...(monthOnly ? {} : { day: "numeric" }), year: "numeric", timeZone: "UTC" }).format(instant);
}
