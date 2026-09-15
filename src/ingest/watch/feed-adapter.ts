import { XMLParser, XMLValidator } from "fast-xml-parser";
import { CanonicalInstant, SourceDate, isCalendarDay, sha256, tupleKey } from "../../content/watch-schema";
import { stripHtml } from "../event-parser";
import { INSTRUCTION_LIKE_RE } from "../untrusted-text";
import { DiscoveryCandidate, SourceEnrollment, checkedSnapshot, failedSnapshot, makeObservation, observationKey,
  snapshotHealth, snapshotRepresentationDigest, sourceEndpointAllowed, sourceLinkAllowed, watchUrlIdentity, type SnapshotInput, type WatchSnapshotResult } from "./source-enrollment";

const ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;
const RFC822 = /^(?:(Sun|Mon|Tue|Wed|Thu|Fri|Sat),\s*)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+(GMT|UT|UTC|[+-]\d{4})$/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// The accepted public contract is reused, but these are only proposed date facts.
// Unsupported precision/zone syntax stays unknown; Date.parse never gets a local
// or date-only string from this adapter.
export function parseSourcePublicationDate(raw: string | null, evidenceId: string, timezone: string | null): SourceDate {
  const text = raw?.trim();
  const unknown = (reason: string): SourceDate => ({ precision: "unknown", reason });
  if (!text) return unknown("No source publication date was supplied.");
  if (isCalendarDay(text)) return SourceDate.parse({ precision: "day", value: text, timezone,
    timezoneReason: timezone ? null : "Source time zone has not been established.", evidenceIds: [evidenceId] });
  const iso = ISO.exec(text);
  if (iso) {
    if (!isCalendarDay(iso[1]!) || Number(iso[2]) > 23 || Number(iso[3]) > 59 || Number(iso[4]) > 59) return unknown("Source timestamp contains an invalid date or clock value.");
    const parsed = new Date(text);
    if (!Number.isFinite(parsed.getTime()) || !CanonicalInstant.safeParse(parsed.toISOString()).success) return unknown("Source timestamp could not be normalized without guessing.");
    return { precision: "instant", value: parsed.toISOString(), evidenceIds: [evidenceId] };
  }
  const rfc = RFC822.exec(text);
  if (rfc) {
    const date = `${rfc[4]}-${String(MONTHS.indexOf(rfc[3]!.toLowerCase()) + 1).padStart(2, "0")}-${rfc[2]!.padStart(2, "0")}`;
    if (!isCalendarDay(date) || Number(rfc[5]) > 23 || Number(rfc[6]) > 59 || Number(rfc[7]) > 59 ||
        (rfc[1] && WEEKDAYS[new Date(`${date}T00:00:00.000Z`).getUTCDay()] !== rfc[1].toLowerCase())) return unknown("Source date or weekday is inconsistent.");
    const zone = /^[+-]/.test(rfc[8]!) ? `${rfc[8]!.slice(0, 3)}:${rfc[8]!.slice(3)}` : "Z";
    return parseSourcePublicationDate(`${date}T${rfc[5]}:${rfc[6]}:${rfc[7]}${zone}`, evidenceId, timezone);
  }
  return unknown("Publication date format or time-zone precision is not qualified.");
}

type XmlNode = Record<string, unknown>;
function object(value: unknown): XmlNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("unexpected-xml-structure");
  return value as XmlNode;
}
function list(value: unknown): unknown[] { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
function text(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  const node = object(value);
  if (Object.keys(node).some(key => !key.startsWith("@_") && key !== "#text" && key !== "#cdata")) throw new Error("unsupported-complex-feed-text");
  return [node["#text"], node["#cdata"]].filter(value => value !== undefined).map(value => {
    if (typeof value !== "string") throw new Error("unexpected-feed-text");
    return value;
  }).join("").trim();
}
function field(node: XmlNode, prefix: string, name: string): unknown {
  if (prefix && node[name] !== undefined && node[`${prefix}${name}`] !== undefined) throw new Error("ambiguous-feed-field");
  return node[`${prefix}${name}`] ?? (prefix ? node[name] : undefined);
}
function atomLink(entry: XmlNode, prefix: string): string {
  const links = list(field(entry, prefix, "link")).map(object);
  const alternate = links.filter(link => !link["@_rel"] || link["@_rel"] === "alternate");
  if (alternate.length !== 1 || typeof alternate[0]!["@_href"] !== "string") throw new Error("ambiguous-or-missing-atom-link");
  return alternate[0]!["@_href"] as string;
}

export async function parseWatchFeedSnapshot(input: SnapshotInput): Promise<WatchSnapshotResult> {
  const source = SourceEnrollment.parse(input.source);
  try { checkedSnapshot(input, ["rss", "atom"]); } catch (error) {
    return failedSnapshot(source, input, null, error instanceof Error ? error.message : "invalid-snapshot");
  }
  const representationSha256 = await snapshotRepresentationDigest(input);
  if ((input.status ?? 200) !== 200) return failedSnapshot(source, input, representationSha256,
    input.status === 304 ? "not-modified-without-retained-representation" : `upstream-http-${input.status}`);
  try {
    if (/<!DOCTYPE|<!ENTITY/i.test(input.body) || XMLValidator.validate(input.body) !== true) throw new Error("invalid-or-disallowed-feed-xml");
    const parser = new XMLParser({ ignoreAttributes: false, ignoreDeclaration: true, parseTagValue: false, parseAttributeValue: false,
      trimValues: false, cdataPropName: "#cdata", maxNestedTags: 40, processEntities: { enabled: true, maxTotalExpansions: 10_000, maxExpandedLength: source.maxBytes } });
    const document = object(parser.parse(input.body));
    const roots = Object.keys(document).filter(key => !key.startsWith("?"));
    if (roots.length !== 1) throw new Error("one-feed-root-required");
    const rootKey = roots[0]!, root = object(document[rootKey]);
    const isAtom = rootKey === "feed" || rootKey.endsWith(":feed");
    const prefix = isAtom && rootKey.includes(":") ? `${rootKey.split(":")[0]}:` : "";
    if ((!isAtom && (rootKey !== "rss" || root["@_version"] !== "2.0")) || (source.transport === "atom") !== isAtom) throw new Error("unexpected-feed-format");
    if (isAtom && root[prefix ? `@_xmlns:${prefix.slice(0, -1)}` : "@_xmlns"] !== "http://www.w3.org/2005/Atom") throw new Error("invalid-atom-namespace");
    const channel = isAtom ? root : object(root.channel);
    if (!text(field(channel, prefix, "title"))) throw new Error("feed-title-required");
    if (!isAtom && (!text(channel.link) || !text(channel.description))) throw new Error("rss-channel-metadata-required");
    if (isAtom && (!text(field(channel, prefix, "id")) || parseSourcePublicationDate(text(field(channel, prefix, "updated")), "feed-clock", null).precision !== "instant")) throw new Error("atom-feed-metadata-required");
    const nextLinks = isAtom ? list(field(channel, prefix, "link")).map(object).filter(link => link["@_rel"] === "next") : [];
    if (nextLinks.length > 1 || (nextLinks.length === 1 && (typeof nextLinks[0]!["@_href"] !== "string" || !sourceEndpointAllowed(source, nextLinks[0]!["@_href"] as string)))) throw new Error("unqualified-feed-continuation");
    const nextPageKey = nextLinks.length ? await tupleKey("watch-page-v1", [await sha256(nextLinks[0]!["@_href"] as string)]) : input.nextPageKey ?? null;
    const entries = list(field(channel, prefix, isAtom ? "entry" : "item"));
    const observations = [], candidates = [];
    const seen = new Map<string, string>();
    const conflicts = new Set<string>();
    let rejectedItems = 0;
    for (const raw of entries.slice(0, source.maxItems)) {
      try {
        const entry = object(raw);
        if (isAtom && entry["@_xmlns"] && entry["@_xmlns"] !== "http://www.w3.org/2005/Atom") throw new Error("invalid-entry-namespace");
        const title = stripHtml(text(field(entry, prefix, "title")));
        const url = isAtom ? atomLink(entry, prefix) : text(entry.link);
        if (!sourceLinkAllowed(source, url)) throw new Error("feed-link-outside-scope");
        const nativeId = text(field(entry, prefix, isAtom ? "id" : "guid"));
        if (isAtom && !nativeId) throw new Error("atom-id-required");
        if (isAtom && parseSourcePublicationDate(text(field(entry, prefix, "updated")), "entry-clock", null).precision !== "instant") throw new Error("atom-entry-update-required");
        const externalKey = nativeId ? `${isAtom ? "atom-id" : "rss-guid"}:${nativeId}` : `url:${watchUrlIdentity(url)}`;
        const id = await observationKey(source, externalKey, representationSha256);
        const description = stripHtml(text(field(entry, prefix, isAtom ? "summary" : "description")) || (isAtom ? text(field(entry, prefix, "content")) : ""));
        const rawPublished = text(field(entry, prefix, isAtom ? "published" : "pubDate"));
        const sourceOccurredAt = parseSourcePublicationDate(rawPublished || null, `${id}:date`, source.dateTimezone);
        const holds: DiscoveryCandidate["holds"] = [];
        if (sourceOccurredAt.precision === "unknown") holds.push("source-date-unknown");
        if (INSTRUCTION_LIKE_RE.test(`${title} ${description}`)) holds.push("instruction-like-source");
        const candidate = DiscoveryCandidate.parse({ id: await tupleKey("watch-candidate-v1", [source.id, await sha256(externalKey)]),
          observationId: id, sourceId: source.id, externalKey, title, url, description, sourceOccurredAt,
          discoveryClass: "feed-item", holds, publicationAuthorized: false, regionalEligibility: "unverified", licenseAuthority: "unreviewed" });
        const observation = await makeObservation(source, { externalKey, representationSha256, sourceUrl: input.finalUrl, fetchedAt: input.fetchedAt,
          payload: { candidate, rawPublished: rawPublished || null, rawUpdated: isAtom ? text(field(entry, prefix, "updated")) || null : null,
            dateField: isAtom ? "published" : "pubDate", dateEvidenceId: `${id}:date` } });
        if (seen.has(id)) {
          if (seen.get(id) !== observation.payloadSha256) { conflicts.add(id); rejectedItems += 1; }
          continue;
        }
        seen.set(id, observation.payloadSha256); observations.push(observation); candidates.push(candidate);
      } catch { rejectedItems += 1; }
    }
    const acceptedObservations = observations.filter(item => !conflicts.has(item.id));
    const acceptedCandidates = candidates.filter(item => !conflicts.has(item.observationId));
    const truncated = entries.length > source.maxItems;
    return { observations: acceptedObservations, candidates: acceptedCandidates, representationSha256, truncated,
      rejectedItems: rejectedItems + conflicts.size,
      health: snapshotHealth(source, input, acceptedObservations.length, { parserFailed: rejectedItems > 0,
        ...(rejectedItems ? { error: "feed-items-rejected" } : truncated ? { error: "feed-item-cap-partial" } : {}) }),
      // RSS/Atom are rolling discovery windows, never complete inventories.
      pagination: { pageKey: input.pageKey ?? "1", nextPageKey, terminal: nextPageKey === null && !truncated && input.terminal !== false } };
  } catch (error) {
    return failedSnapshot(source, input, representationSha256, error instanceof Error ? error.message : "feed-parser-failed");
  }
}
