import { legacyUrl } from "../lib/schema-compat";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { CanonicalInstant, canonicalJson, sha256 } from "../content/watch-schema";
import { readBoundedText } from "./upstream";
import type { D1DatabaseLike } from "./persistence";
import { parseHouseRoster } from "./house-representative-collection";

export const REPRESENTATIVE_RAW_MAX_BYTES = 1_000_000;

export const SENATE_ROSTER_URL = "https://www.senate.gov/general/contact_information/senators_cfm.xml";
const Member = z.object({ first_name: z.string().min(1).max(160), last_name: z.string().min(1).max(160),
  state: z.string().regex(/^[A-Z]{2}$/), party: z.string().min(1).max(20), bioguide_id: z.string().regex(/^[A-Z][0-9]{6}$/),
  website: legacyUrl(), email: z.string().optional(), class: z.string().min(1).max(30) });
function senateLink(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !(url.hostname === "senate.gov" || url.hostname.endsWith(".senate.gov")))
    throw new Error("representative-profile-url-invalid");
  return url.href;
}
/** A roster observation is not a term record or accepted directory. Missing seats
 * never establish vacancy; the feed does not supply service start/end dates. */
export async function parseSenateRoster(xml: string, retrievedAt: string) {
  CanonicalInstant.parse(retrievedAt);
  if (new TextEncoder().encode(xml).length > 500_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new Error("representative-roster-invalid");
  const parsed = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true, processEntities: false }).parse(xml);
  const raw = parsed?.contact_information?.member;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) throw new Error("representative-roster-shape");
  const ids = new Set<string>();
  const members = raw.map((input: unknown) => {
    const member = Member.parse(input);
    if (ids.has(member.bioguide_id)) throw new Error("representative-duplicate-member");
    ids.add(member.bioguide_id);
    return member;
  }).filter(member => ["PA", "NJ", "DE"].includes(member.state)).map(member => ({
    nativeId: member.bioguide_id, displayName: member.first_name + " " + member.last_name, state: member.state,
    party: member.party, senateClass: member.class, officialProfileUrl: senateLink(member.website),
    officialContactUrl: member.email?.startsWith("https:") ? senateLink(member.email) : null,
    validFrom: null, validTo: null,
  }));
  for (const state of ["PA", "NJ", "DE"]) if (members.filter(member => member.state === state).length > 2)
    throw new Error("representative-seat-conflict");
  return { kind: "representative-roster-observation" as const, parserVersion: "senate-contact-1", sourceUrl: SENATE_ROSTER_URL,
    retrievedAt, sourceLastUpdated: typeof parsed.contact_information.last_updated === "string" ? parsed.contact_information.last_updated : null,
    rawSha256: await sha256(xml), representation: canonicalJson(parsed.contact_information), members,
    acceptance: "unreviewed" as const, gaps: ["Service dates require separate official evidence.", "Committee roles are not supplied.", "Missing entries are not verified vacancies."] };
}
export async function collectSenateRoster(fetcher: typeof fetch = fetch, now = new Date()) {
  const response = await fetcher(SENATE_ROSTER_URL, { redirect: "error", credentials: "omit", signal: AbortSignal.timeout(15_000),
    headers: { accept: "application/xml,text/xml" } });
  if (!response.ok) { await response.body?.cancel(); throw new Error("representative-upstream-" + response.status); }
  return parseSenateRoster(await readBoundedText(response, 500_000), now.toISOString());
}

/** Durable evidence only; no accepted facts, head changes or model calls. */
export async function persistSenateRosterObservation(db: D1DatabaseLike, xml: string, retrievedAt: string) {
  const observation = await parseSenateRoster(xml, retrievedAt);
  return persistRosterObservation(db, xml, observation);
}

export async function persistHouseRosterObservation(db: D1DatabaseLike, xml: string, retrievedAt: string) {
  return persistRosterObservation(db, xml, await parseHouseRoster(xml, retrievedAt));
}

async function persistRosterObservation(db: D1DatabaseLike, xml: string,
  observation: Awaited<ReturnType<typeof parseSenateRoster>> | Awaited<ReturnType<typeof parseHouseRoster>>) {
  const retrievedAt = observation.retrievedAt;
  const id = await sha256(canonicalJson([observation.sourceUrl, observation.rawSha256, retrievedAt]));
  const payload = canonicalJson(observation);
  if (new TextEncoder().encode(xml).length > REPRESENTATIVE_RAW_MAX_BYTES || new TextEncoder().encode(payload).length > 1_000_000)
    throw new Error("representative-observation-size");
  await db.prepare("INSERT OR IGNORE INTO representative_roster_observations VALUES(?,?,?,?,?,?)")
    .bind(id, observation.sourceUrl, retrievedAt, observation.rawSha256, xml, payload).run();
  const stored = await db.prepare("SELECT raw_sha256,payload_json FROM representative_roster_observations WHERE id=?")
    .bind(id).first<{ raw_sha256: string; payload_json: string }>();
  if (stored?.raw_sha256 !== observation.rawSha256 || stored.payload_json !== payload) throw new Error("representative-observation-conflict");
  return { id, observation };
}
