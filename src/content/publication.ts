import { citationUrl, itemCitations, type ContentItem, type EventItem, type VoiceItem } from "./schema";
import { hasDefensiveEditorialAside, hasInternalProcessLanguage } from "../lib/editorialCopy";
import { isBoilerplateEventCopy } from "../lib/eventCopy";
import entityFixtures from "../../fixtures/entities.json";

export const PUBLICATION_POLICY_VERSION = "tvd-publication-v1";

export const OFFICIAL_CHAPTER_ORIGINS = new Set(["dvhimss-events", "njhimss-events"]);

export type PublicationMode = "strict" | "compat" | "delivery";
export type PublicationSurface =
  | "automatic"
  | "human-approval"
  | "catalog"
  | "merge"
  | "feed"
  | "route";

export type PublicationIssue = {
  code: string;
  path: Array<string | number>;
  message: string;
  overridable: boolean;
};

export type PublicationOverride = {
  codes: string[];
  note: string;
  reviewer?: string;
};

export type PublicationEnrichment = {
  whyAttend?: string | null;
  whoYoullMeet?: readonly string[];
  evidenceSpans?: readonly string[];
  whyAttendEvidenceSpans?: readonly string[];
  whoYoullMeetEvidenceSpans?: readonly string[];
  bodyEvidenceSpans?: readonly string[];
  affectedOrgIds?: readonly string[];
  changeType?: string;
};

export type PublicationContext = {
  now?: Date;
  mode?: PublicationMode;
  surface?: PublicationSurface;
  catalog?: readonly ContentItem[];
  knownOrgIds?: ReadonlySet<string>;
  enrichment?: PublicationEnrichment | null;
  overrides?: PublicationOverride | null;
};

export type PublicationVerdict = {
  ok: boolean;
  issues: PublicationIssue[];
  blocking: PublicationIssue[];
  overridden: PublicationIssue[];
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HIGH_STAKES = /\b(outage|ransomware|breach|recall|cyberattack|patient (?:death|harm)|cms (?:enforcement|penalty)|downtime)\b/i;
const INSTITUTIONAL_VOICE = /\b(official account|newsroom|communications team|media relations)\b/i;
const PLACEHOLDER = /^(tbd|n\/?a|none|unknown|speakers? tba|to be announced)$/i;
const SUPPORTED_REGIONS = new Set(["PA", "NJ", "DE", "regional", "federal"]);

const KNOWN_ORG_IDS = new Set(
  (entityFixtures as Array<{ id: string }>).map((entity) => entity.id),
);

export const SAFETY_CODES = new Set([
  "identity-id",
  "identity-slug",
  "source-https",
  "citation-https",
  "time-invalid",
  "time-order",
  "region-unsupported",
  "reader-copy-exposes-ingestion",
  "reader-copy-defensive",
  "dedupe-id",
  "dedupe-slug",
  "org-unknown",
  "event-cancelled",
  "event-registration-https",
  "event-invented-field",
]);

export const OVERRIDABLE_CODES = new Set([
  "region-rationale",
  "time-future",
  "news-what-happened",
  "news-why-it-matters",
  "news-context",
  "news-verified-at",
  "news-stale",
  "news-single-source",
  "news-conflation",
  "voice-speaker",
  "voice-role",
  "voice-topics",
  "voice-body-depth",
  "event-not-future",
  "event-location-or-format",
  "event-host",
  "event-why-attend-evidence",
  "event-who-youll-meet-evidence",
  "event-regional-relevance",
]);

function issue(
  issues: PublicationIssue[],
  code: string,
  message: string,
  path: Array<string | number> = [],
  overridable = OVERRIDABLE_CODES.has(code),
): void {
  issues.push({ code, path, message, overridable });
}

function httpsUrl(value?: string) {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function parseTime(value: string | undefined) {
  if (!value) return Number.NaN;
  return Date.parse(value);
}

export function isOfficialChapterEvent(item: { kind: string; source: { origin: string } }) {
  return item.kind === "event" && OFFICIAL_CHAPTER_ORIGINS.has(item.source.origin);
}

export function publicCopyFields(item: ContentItem): Array<string | undefined> {
  return [
    item.title,
    item.dek,
    item.body,
    item.impactSentence,
    item.contextSentence,
    item.kind === "event" ? item.whyAttend : undefined,
    item.kind === "event" ? item.healthSystemRelevance : undefined,
  ];
}

function uniqueCiteUrls(item: ContentItem) {
  const urls = new Set<string>();
  for (const cite of itemCitations(item)) {
    if (cite.url) urls.add(cite.url);
  }
  return [...urls];
}

function knownOrgs(context: PublicationContext) {
  return context.knownOrgIds ?? KNOWN_ORG_IDS;
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function isInstitutionalVoice(item: VoiceItem) {
  const person = item.person.trim();
  const org = (item.org ?? "").trim();
  if (INSTITUTIONAL_VOICE.test(person)) return true;
  if (org && person.toLocaleLowerCase("en-US") === org.toLocaleLowerCase("en-US")) return true;
  if (org && person.toLocaleLowerCase("en-US").startsWith(`${org.toLocaleLowerCase("en-US")} (`)) return true;
  return false;
}

function eventCancelled(item: EventItem) {
  return /\b(cancelled|canceled|postponed)\b/i.test(`${item.title}\n${item.dek}\n${item.body}`);
}

function eventHasPlace(item: EventItem) {
  if (item.format === "virtual" || item.format === "hybrid" || item.format === "in-person") return true;
  return Boolean(item.venue?.trim() || item.city?.trim() || item.geo?.trim());
}

function evidenceHaystack(item: ContentItem) {
  return [item.title, item.dek, item.body, item.kind === "event" ? item.hostOrg : ""]
    .filter(Boolean)
    .join("\n")
    .toLocaleLowerCase("en-US");
}

function spansGrounded(spans: readonly string[] | undefined, haystack: string) {
  if (!spans?.length) return false;
  return spans.every((span) => haystack.includes(span.toLocaleLowerCase("en-US")));
}

function qualityEnabled(mode: PublicationMode) {
  return mode === "strict";
}

function overriddenCodes(overrides: PublicationOverride | null | undefined) {
  if (!overrides?.note.trim() || !overrides.codes.length) return new Set<string>();
  return new Set(overrides.codes);
}

function collectTimes(item: ContentItem): Array<{ path: string; value: string }> {
  const times: Array<{ path: string; value: string }> = [{ path: "updatedAt", value: item.updatedAt }];
  if (item.publishedAt) times.push({ path: "publishedAt", value: item.publishedAt });
  if (item.verifiedAt) times.push({ path: "verifiedAt", value: item.verifiedAt });
  if (item.source.fetchedAt) times.push({ path: "source.fetchedAt", value: item.source.fetchedAt });
  if (item.kind === "news" && item.clockAt) times.push({ path: "clockAt", value: item.clockAt });
  if (item.kind === "event") {
    times.push({ path: "startsAt", value: item.startsAt });
    if (item.endsAt) times.push({ path: "endsAt", value: item.endsAt });
    if (item.registrationDeadline) times.push({ path: "registrationDeadline", value: item.registrationDeadline });
  }
  if (item.kind === "ai") times.push({ path: "announcedAt", value: item.announcedAt });
  if (item.kind === "briefing") {
    times.push({ path: "windowStart", value: item.windowStart });
    times.push({ path: "windowEnd", value: item.windowEnd });
  }
  return times;
}

function checkUniversal(item: ContentItem, context: PublicationContext, issues: PublicationIssue[], now: Date) {
  if (!item.id.trim()) issue(issues, "identity-id", "Publication identity is missing", ["id"]);
  if (!item.slug.trim() || !SLUG_PATTERN.test(item.slug)) {
    issue(issues, "identity-slug", "Publication slug must be a stable lowercase identity", ["slug"]);
  }

  const cite = citationUrl(item);
  if (!httpsUrl(item.source.url) && !httpsUrl(cite)) {
    issue(issues, "source-https", "Authoritative HTTPS source or citation URL is required", ["source", "url"]);
  }
  for (const [index, citation] of (item.citations ?? []).entries()) {
    if (!httpsUrl(citation.url)) {
      issue(issues, "citation-https", "Citations must use HTTPS URLs", ["citations", index, "url"]);
    }
  }

  const skewMs = 2 * 60 * 60 * 1000;
  for (const stamp of collectTimes(item)) {
    const parsed = parseTime(stamp.value);
    if (!Number.isFinite(parsed)) {
      issue(issues, "time-invalid", "Timestamps must be valid ISO datetimes", [stamp.path]);
    } else if (
      qualityEnabled(context.mode ?? "strict")
      && stamp.path !== "clockAt"
      && stamp.path !== "startsAt"
      && stamp.path !== "endsAt"
      && stamp.path !== "registrationDeadline"
      && stamp.path !== "announcedAt"
      && parsed > now.getTime() + skewMs
    ) {
      issue(issues, "time-future", "Recorded times cannot be in the future", [stamp.path]);
    }
  }
  if (item.kind === "event" && item.endsAt) {
    const start = parseTime(item.startsAt);
    const end = parseTime(item.endsAt);
    if (Number.isFinite(start) && Number.isFinite(end) && end < start) {
      issue(issues, "time-order", "Event end must not precede start", ["endsAt"]);
    }
  }
  if (item.kind === "briefing") {
    const start = parseTime(item.windowStart);
    const end = parseTime(item.windowEnd);
    if (Number.isFinite(start) && Number.isFinite(end) && end < start) {
      issue(issues, "time-order", "Briefing window end must not precede start", ["windowEnd"]);
    }
  }

  if (!SUPPORTED_REGIONS.has(item.region)) {
    issue(issues, "region-unsupported", "Region must be a supported Valley Desk region", ["region"]);
  }

  for (const value of publicCopyFields(item)) {
    if (hasInternalProcessLanguage(value)) {
      issue(issues, "reader-copy-exposes-ingestion", "Reader-facing copy contains internal collection-process language");
      break;
    }
  }
  for (const value of publicCopyFields(item)) {
    if (hasDefensiveEditorialAside(value)) {
      issue(issues, "reader-copy-defensive", "Reader-facing copy contains defensive editorial filler");
      break;
    }
  }

  const catalog = context.catalog;
  if (catalog && item.status === "published") {
    if (catalog.filter((row) => row.id === item.id).length > 1) {
      issue(issues, "dedupe-id", "Published identity id must be unique", ["id"]);
    }
    if (catalog.filter((row) => row.kind === item.kind && row.slug === item.slug).length > 1) {
      issue(issues, "dedupe-slug", "Published kind and slug must be unique", ["slug"]);
    }
  }

  const allowedOrgs = knownOrgs(context);
  for (const [index, org] of item.orgs.entries()) {
    if (!allowedOrgs.has(org)) {
      issue(issues, "org-unknown", "Organization ids must match the verified entity seed", ["orgs", index]);
    }
  }
}

function checkNews(item: ContentItem, context: PublicationContext, issues: PublicationIssue[], now: Date) {
  if (item.kind !== "news" && item.kind !== "policy" && item.kind !== "ai" && item.kind !== "interview") return;
  if (!qualityEnabled(context.mode ?? "strict") || item.status !== "published") return;

  const happened = item.body.trim();
  if (wordCount(happened) < 8 || happened === item.dek.trim()) {
    issue(issues, "news-what-happened", "News must state what happened in a body richer than the dek", ["body"]);
  }
  if (!item.impactSentence?.trim()) {
    issue(issues, "news-why-it-matters", "News must state why it matters in impactSentence", ["impactSentence"]);
  }
  if (item.contextSentence && [item.title, item.dek, item.impactSentence].some((value) => value?.trim() === item.contextSentence?.trim())) {
    issue(issues, "news-context", "Context must add prior regional sequence, not repeat the dek", ["contextSentence"]);
  }
  const highStakes = HIGH_STAKES.test(`${item.title}\n${item.dek}\n${item.body}\n${item.impactSentence ?? ""}`);
  if (highStakes && !item.contextSentence?.trim()) {
    issue(issues, "news-context", "High-stakes news needs useful prior context or an explicit override", ["contextSentence"]);
  }
  if (!item.verifiedAt) {
    issue(issues, "news-verified-at", "News needs verifiedAt (or a freshness override) before publication", ["verifiedAt"]);
  } else if (item.kind !== "policy") {
    const verified = parseTime(item.verifiedAt);
    if (Number.isFinite(verified) && now.getTime() - verified > 180 * 24 * 60 * 60 * 1000) {
      issue(issues, "news-stale", "News facts look stale relative to verifiedAt", ["verifiedAt"]);
    }
  }
  const cites = uniqueCiteUrls(item);
  if (highStakes && cites.length <= 1 && item.singleSource !== true) {
    issue(issues, "news-single-source", "High-stakes single-source news must be labeled singleSource", ["singleSource"]);
  }
  if (item.kind === "news") {
    if (item.relatedEventIds.includes(item.id) || item.relatedVoiceIds.includes(item.id)) {
      issue(issues, "news-conflation", "Related ids must not point at the item itself", ["relatedEventIds"]);
    }
  }
}

function checkVoice(item: ContentItem, context: PublicationContext, issues: PublicationIssue[]) {
  if (item.kind !== "voice") return;
  if (isInstitutionalVoice(item)) {
    issue(issues, "voice-institutional-announcement", "Institutional announcements must be held or reclassified rather than labeled voice", ["person"]);
  }
  if (!qualityEnabled(context.mode ?? "strict") || item.status !== "published") return;
  const person = item.person.trim();
  if (!person || person.split(/\s+/).length < 2) {
    issue(issues, "voice-speaker", "Voice needs a verified named speaker", ["person"]);
  }
  if (!item.role?.trim()) {
    issue(issues, "voice-role", "Voice needs a verified speaker role", ["role"]);
  }
  if (!item.topics.length) {
    issue(issues, "voice-topics", "Voice needs topics", ["topics"]);
  }
  if (wordCount(item.body) <= wordCount(item.dek) && item.body.trim() === item.dek.trim()) {
    issue(issues, "voice-body-depth", "Voice body must be richer than the dek", ["body"]);
  }
}

function checkEvent(item: ContentItem, context: PublicationContext, issues: PublicationIssue[], now: Date) {
  if (item.kind !== "event") return;
  if (eventCancelled(item)) {
    issue(issues, "event-cancelled", "Source marks the event cancelled or postponed", ["title"]);
  }
  if (item.status === "published" && !httpsUrl(item.registrationUrl)) {
    issue(issues, "event-registration-https", "Published events need a verified HTTPS registration URL", ["registrationUrl"]);
  }
  const start = parseTime(item.startsAt);
  if (item.status === "published" && Number.isFinite(start) && start <= now.getTime() && context.surface === "automatic") {
    issue(issues, "event-not-future", "Automatic publication requires a future event", ["startsAt"]);
  }
  if (item.whoYoullMeet?.some((name) => PLACEHOLDER.test(name.trim())) || (item.whyAttend && PLACEHOLDER.test(item.whyAttend.trim()))) {
    issue(issues, "event-invented-field", "Event enrichment fields cannot be placeholders", ["whoYoullMeet"]);
  }
  if (item.whyAttend && (hasInternalProcessLanguage(item.whyAttend) || isBoilerplateEventCopy(item.whyAttend))) {
    issue(issues, "event-invented-field", "whyAttend cannot carry collection-process or empty provenance copy", ["whyAttend"]);
  }

  if (!qualityEnabled(context.mode ?? "strict") || item.status !== "published") return;
  if (!item.hostOrg.trim()) {
    issue(issues, "event-host", "Events need a host", ["hostOrg"]);
  }
  if (!eventHasPlace(item) && !isOfficialChapterEvent(item)) {
    issue(issues, "event-location-or-format", "Events need a location or virtual format", ["format"]);
  }
  if (!item.orgs.length && item.region === "federal") {
    issue(issues, "event-regional-relevance", "Events need regional relevance or a local host relationship", ["orgs"]);
  }
  const enrichment = context.enrichment;
  const haystack = evidenceHaystack(item);
  if (item.whyAttend?.trim() && enrichment) {
    const spans = enrichment.whyAttendEvidenceSpans?.length
      ? enrichment.whyAttendEvidenceSpans
      : enrichment.evidenceSpans;
    if (!spansGrounded(spans, haystack)) {
      issue(issues, "event-why-attend-evidence", "whyAttend must be grounded in source evidence spans", ["whyAttend"]);
    }
  }
  if ((item.whoYoullMeet?.length ?? 0) > 0 && enrichment) {
    const spans = enrichment.whoYoullMeetEvidenceSpans?.length
      ? enrichment.whoYoullMeetEvidenceSpans
      : enrichment.evidenceSpans;
    if (!spansGrounded(spans, haystack)) {
      issue(issues, "event-who-youll-meet-evidence", "whoYoullMeet must be grounded in source evidence spans", ["whoYoullMeet"]);
    }
  }
}

function regionRationale(item: ContentItem, context: PublicationContext, issues: PublicationIssue[]) {
  if (!qualityEnabled(context.mode ?? "strict") || item.status !== "published") return;
  if (item.region !== "federal") return;
  const hay = `${item.title}\n${item.dek}\n${item.body}\n${item.impactSentence ?? ""}`;
  if (!/\b(cms|federal|hhs|onc |astp|congress)\b/i.test(hay) && item.orgs.length === 0) {
    issue(issues, "region-rationale", "Federal items need a federal/CMS rationale or a local org relationship", ["region"]);
  }
}

export function parsePublicationOverride(input: unknown, fallbackNote?: string): PublicationOverride | null {
  if (!input || typeof input !== "object") return null;
  const record = input as { codes?: unknown; note?: unknown; reviewer?: unknown };
  if (!Array.isArray(record.codes) || record.codes.length === 0) return null;
  const codes = record.codes.filter((code): code is string => typeof code === "string" && code.length > 0);
  const note = typeof record.note === "string" && record.note.trim()
    ? record.note.trim()
    : (fallbackNote ?? "").trim();
  if (!codes.length || !note) return null;
  return {
    codes,
    note,
    reviewer: typeof record.reviewer === "string" ? record.reviewer : undefined,
  };
}

export function validateForPublication(
  item: ContentItem,
  context: PublicationContext = {},
): PublicationVerdict {
  const mode = context.mode ?? "strict";
  const now = context.now ?? new Date();
  const issues: PublicationIssue[] = [];
  checkUniversal(item, { ...context, mode }, issues, now);
  regionRationale(item, { ...context, mode }, issues);
  checkNews(item, { ...context, mode }, issues, now);
  checkVoice(item, { ...context, mode }, issues);
  checkEvent(item, { ...context, mode }, issues, now);

  const allowedOverrides = overriddenCodes(context.overrides);
  const overridden: PublicationIssue[] = [];
  const blocking: PublicationIssue[] = [];
  for (const row of issues) {
    const canOverride = row.overridable && OVERRIDABLE_CODES.has(row.code) && !SAFETY_CODES.has(row.code);
    if (mode === "compat" || mode === "delivery") {
      if (!SAFETY_CODES.has(row.code)) continue;
      blocking.push(row);
      continue;
    }
    if (canOverride && allowedOverrides.has(row.code) && context.surface === "human-approval") {
      overridden.push(row);
      continue;
    }
    if (context.surface === "human-approval" && canOverride && !allowedOverrides.has(row.code)) {
      blocking.push(row);
      continue;
    }
    blocking.push(row);
  }

  const visible = (mode === "compat" || mode === "delivery")
    ? issues.filter((row) => SAFETY_CODES.has(row.code))
    : issues;

  return {
    ok: blocking.length === 0,
    issues: visible,
    blocking,
    overridden,
  };
}

export function isDeliverySafe(item: ContentItem, now = new Date()) {
  if (item.status !== "published") return false;
  return validateForPublication(item, { mode: "delivery", surface: "feed", now }).ok;
}

export function filterForDelivery<T extends ContentItem>(items: readonly T[], now = new Date()) {
  return items.filter((item) => isDeliverySafe(item, now));
}

export function validateCatalog(
  items: readonly ContentItem[],
  context: Omit<PublicationContext, "catalog"> = { mode: "compat", surface: "catalog" },
) {
  const issuesById = new Map<string, PublicationIssue[]>();
  for (const item of items) {
    const verdict = validateForPublication(item, { ...context, catalog: items });
    if (!verdict.ok) issuesById.set(item.id, verdict.blocking);
  }
  return { ok: issuesById.size === 0, issuesById };
}
