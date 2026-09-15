import type { SourceDate } from "../../content/watch-schema";

export const JURISDICTION_LABELS = { federal: "Federal", PA: "Pennsylvania", NJ: "New Jersey", DE: "Delaware", regional: "Local / regional" };
export const LIFECYCLE_LABELS = {
  proposed: "Proposed", active: "Active", adopted: "Adopted", failed: "Failed", withdrawn: "Withdrawn", vetoed: "Vetoed",
  expired: "Expired", superseded: "Superseded", rescinded: "Rescinded", unknown: "Not established",
};
export const LEGAL_EFFECT_LABELS = { "not-in-effect": "Not in effect", "future-effective": "Future effective", "in-effect": "In effect", stayed: "Stayed", ceased: "Ceased", unknown: "Not established" };
export const RESOURCE_LABELS = { software: "Software", paper: "Paper", dataset: "Dataset", "database-engine": "Database engine", "data-platform": "Data platform", standard: "Standard", "commercial-product": "Commercial product" };
export const LICENSE_LABELS = { "osi-open-source": "OSI open source", "restricted-source": "Restricted source", proprietary: "Proprietary", unknown: "Not established", "not-applicable": "Not applicable" };
export const READINESS_LABELS = { "metadata-only": "Metadata only", "text-pending": "Source text pending", "extraction-pending": "Text extraction pending", "review-pending": "Interpretation review pending", reviewed: "Reviewed interpretation", "evidence-changed": "Interpretation held: evidence changed" };
export const RELATIONSHIP_LABELS = { "created-by": "Created by", "maintained-by": "Maintained by", "research-affiliation": "Research affiliation", "piloted-at": "Piloted at", "used-at": "Used at" };
export const SETUP_LABELS = { "maintainer-documented": "Maintainer documented", "desk-tested": "Desk tested", "not-verified": "Setup not verified" };

export function watchLabel(value: string) {
  const words = value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function instantLabel(value: string) {
  return value.replace("T", " ").replace(/\.000Z$/, " UTC").replace(/Z$/, " UTC");
}

export function sourceDateLabel(date: SourceDate): string {
  if (date.precision === "unknown") return `Date not established: ${date.reason}`;
  if (date.precision === "instant") return instantLabel(date.value);
  return `${date.value} (date only; ${date.timezone ?? `time zone not established: ${date.timezoneReason}`})`;
}
