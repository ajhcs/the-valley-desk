import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { CanonicalInstant, canonicalJson, sha256 } from "../content/watch-schema";
import { readBoundedText } from "./upstream";

export const HOUSE_ROSTER_URL = "https://clerk.house.gov/xml/lists/MemberData.xml";
export const HOUSE_ROSTER_MAX_BYTES = 1_000_000;
const Text = z.string().trim().min(1).max(240);
const Row = z.object({ statedistrict: z.string().regex(/^[A-Z]{2}[0-9]{2}$/),
  "member-info": z.object({ bioguideID: z.string(), "official-name": Text, party: z.string().max(20),
    state: z.object({ "@_postal-code": z.string().regex(/^[A-Z]{2}$/) }), district: Text }) });

/** Current roster observation only. Election/oath dates and committee assignments
 * remain retained source data, not interpreted membership intervals or roles. */
export async function parseHouseRoster(xml: string, retrievedAt: string) {
  CanonicalInstant.parse(retrievedAt);
  if (new TextEncoder().encode(xml).length > HOUSE_ROSTER_MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw Error("representative-roster-invalid");
  const parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: true,
    processEntities: false, isArray: name => name === "member" }).parse(xml)?.MemberData;
  const raw = parsed?.members?.member;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 500) throw Error("representative-roster-shape");
  const congress = z.string().regex(/^[1-9][0-9]{0,2}$/).parse(parsed?.["title-info"]?.["congress-num"]);
  const sourceLastUpdated = Text.parse(parsed["@_publish-date"]);
  const seats = new Set<string>(), ids = new Set<string>(), omittedSeats: string[] = [];
  const members = [];
  for (const input of raw) {
    const district = z.string().regex(/^[A-Z]{2}[0-9]{2}$/).parse(input?.statedistrict);
    if (seats.has(district)) throw Error("representative-seat-conflict");
    seats.add(district);
    if (!["PA", "NJ", "DE"].includes(district.slice(0, 2))) continue;
    const row = Row.parse(input), info = row["member-info"], state = district.slice(0, 2);
    if (info.state["@_postal-code"] !== state ||
        (district.endsWith("00") && info.district !== "At Large") ||
        (!district.endsWith("00") && (!/^[1-9][0-9]?(st|nd|rd|th)$/.test(info.district) ||
          Number.parseInt(info.district, 10) !== Number(district.slice(2)))))
      throw Error("representative-district-conflict");
    if (!info.bioguideID && /vacan/i.test(info["official-name"])) { omittedSeats.push(district); continue; }
    const nativeId = z.string().regex(/^[A-Z][0-9]{6}$/).parse(info.bioguideID);
    if (ids.has(nativeId)) throw Error("representative-duplicate-member");
    ids.add(nativeId);
    members.push({ nativeId, displayName: info["official-name"], state, party: info.party || null,
      districtCode: district.slice(2), districtLabel: info.district, officialProfileUrl: null,
      validFrom: null, validTo: null, source: input });
  }
  return { kind: "representative-roster-observation" as const, parserVersion: "house-clerk-members-1",
    sourceUrl: HOUSE_ROSTER_URL, retrievedAt, sourceLastUpdated, congress, rawSha256: await sha256(xml),
    representation: canonicalJson({ congress, sourceLastUpdated, members }), members, omittedSeats,
    acceptance: "unreviewed" as const, gaps: ["Election and oath dates have not been reviewed as service intervals.",
      "Committee assignments are retained but not interpreted.", "Missing or vacant entries do not create verified vacancies."] };
}

export async function collectHouseRoster(fetcher: typeof fetch = fetch, now = new Date()) {
  const response = await fetcher(HOUSE_ROSTER_URL, { redirect: "error", credentials: "omit",
    signal: AbortSignal.timeout(15_000), headers: { accept: "application/xml,text/xml" } });
  if (!response.ok) { await response.body?.cancel(); throw Error("representative-upstream-" + response.status); }
  const xml = await readBoundedText(response, HOUSE_ROSTER_MAX_BYTES);
  return { xml, observation: await parseHouseRoster(xml, now.toISOString()) };
}
