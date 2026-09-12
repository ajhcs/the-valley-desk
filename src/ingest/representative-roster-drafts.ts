import { z } from "zod";
import { CanonicalInstant, Sha256, WatchId, HttpsUrl, EvidenceReference, canonicalJson, sha256, evidenceReferenceDigest } from "../content/watch-schema";
import { RepresentativeDraft, stageRepresentativeDraft } from "./representative-persistence";
import { REPRESENTATIVE_LOOKUPS } from "../content/representative-sources";
import { parseSenateRoster, SENATE_ROSTER_URL } from "./representative-collection";
import type { D1DatabaseLike } from "./persistence";

const Label = z.string().trim().min(1).max(240);
const Member = z.object({ nativeId: Label, displayName: Label, party: Label.nullable(), districtId: WatchId,
  districtLabel: Label, profileUrl: HttpsUrl.nullable(), sourcePointer: z.string().min(1).max(200) }).strict();
const Capture = z.object({ sourceId: WatchId, sourceUrl: HttpsUrl, observedAt: CanonicalInstant, parserVersion: Label,
  rawSha256: Sha256, bodyId: WatchId, jurisdictionId: WatchId, rows: z.array(Member).min(1).max(203),
  representation: z.string().min(1).max(500_000) }).strict();
export type RepresentativeRosterCapture = z.infer<typeof Capture>;
const NJ_URL = "https://pub.njleg.state.nj.us/leg-databases/2026data/DB2026_TEXT.zip";

/** Parse an offline standard-library CSV extraction; the original archive is
 * retained separately and its exact digest travels with the representation. */
export function prepareNjRosterCaptures(input: unknown, sourceId: string, observedAt: string): RepresentativeRosterCapture[] {
  const extracted = z.object({ rawSha256: Sha256, tables: z.object({ "ROSTER.TXT": z.array(z.record(z.string().nullable())).min(1).max(150),
    "LEGBIO.TXT": z.array(z.record(z.string().nullable())).min(1).max(150) }).strict() }).strict().parse(input);
  const biographies = new Map(extracted.tables["LEGBIO.TXT"].map(row => [row["Roster Key"], row]));
  if (biographies.size !== extracted.tables["LEGBIO.TXT"].length) throw Error("representative-duplicate-biography");
  return (["S", "A"] as const).map(chamber => Capture.parse({ sourceId, sourceUrl: NJ_URL, observedAt,
    parserVersion: "nj-roster-csv-1", rawSha256: extracted.rawSha256, bodyId: chamber === "S" ? "nj-senate" : "nj-assembly",
    jurisdictionId: "nj", representation: canonicalJson(extracted), rows: extracted.tables["ROSTER.TXT"].flatMap((row, index) => {
      if (row.House !== chamber || row.LegStatus !== "Active") return [];
      const id = row["Roster Key"], biography = biographies.get(id);
      if (!id || !/^\d+$/.test(id) || !biography || biography.Last_Name !== row.LastName || biography.First_Name !== row.Firstname)
        throw Error("representative-roster-biography-conflict");
      const district = z.coerce.number().int().min(1).max(40).parse(row.District);
      return [{ nativeId: id, displayName: [row.Firstname, row.MidName, row.LastName, row.Suffix].filter(Boolean).join(" "),
        party: row.Party ?? null, districtId: "nj-" + district, districtLabel: "District " + district,
        profileUrl: null, sourcePointer: "/tables/ROSTER.TXT/" + index }];
    }) }));
}

export function preparePaRosterCapture(input: unknown, sourceId: string, observedAt: string, chamber: "house" | "senate") {
  const extracted = z.object({ rawSha256: Sha256, rows: z.array(z.object({ district: z.string(), party: Label,
    displayName: Label, profile: Label }).strict()).min(1).max(203) }).strict().parse(input);
  return Capture.parse({ sourceId, sourceUrl: "https://www.palegis.us/" + chamber + "/members", observedAt,
    parserVersion: "pa-member-cards-1", rawSha256: extracted.rawSha256, bodyId: "pa-" + chamber,
    jurisdictionId: "pa", representation: canonicalJson(extracted), rows: extracted.rows.map((row, index) => {
      const district = z.coerce.number().int().min(1).max(chamber === "house" ? 203 : 50).parse(row.district);
      const url = new URL(row.profile, "https://www.palegis.us");
      const match = new RegExp("^/" + chamber + "/members/bio/(\\d+)/[a-z0-9'-]+$").exec(url.pathname);
      if (url.origin !== "https://www.palegis.us" || !match || url.search || url.hash) throw Error("representative-profile-url-invalid");
      return { nativeId: match[1], displayName: row.displayName, party: row.party, districtId: "pa-" + district,
        districtLabel: "District " + district, profileUrl: url.href, sourcePointer: "/rows/" + index };
    }) });
}

export async function prepareSenateRosterCaptures(xml: string, sourceId: string, observedAt: string) {
  const parsed = await parseSenateRoster(xml, observedAt);
  const representation = canonicalJson({ rawSha256: parsed.rawSha256, members: parsed.members });
  return ["PA", "NJ", "DE"].flatMap(state => {
    const rows = parsed.members.flatMap((member, index) => member.state !== state ? [] : [{ nativeId: member.nativeId,
      displayName: member.displayName, party: member.party, districtId: "us-" + state.toLowerCase(),
      districtLabel: state + " statewide", profileUrl: member.officialProfileUrl, sourcePointer: "/members/" + index }]);
    return rows.length ? [Capture.parse({ sourceId, sourceUrl: SENATE_ROSTER_URL, observedAt, parserVersion: "senate-contact-1",
      rawSha256: parsed.rawSha256, bodyId: "us-senate", jurisdictionId: "us-" + state.toLowerCase(), representation, rows })] : [];
  });
}

/** Produces proposed facts only. Review authenticates the actor and binds source
 * qualification; this function never produces accepted facts or a public head. */
export async function buildRepresentativeRosterDraft(input: unknown, expectedRevision: number) {
  const capture = Capture.parse(input);
  const scope = REPRESENTATIVE_LOOKUPS.find(item => item.bodyId === capture.bodyId && item.jurisdictionId === capture.jurisdictionId);
  if (!scope) throw Error("representative-scope-unsupported");
  const sourceLabel = scope.label + " official roster";
  const nativeIds = new Set(capture.rows.map(row => row.nativeId));
  if (nativeIds.size !== capture.rows.length) throw Error("representative-duplicate-member");
  const digest = await sha256(capture.representation);
  const id = "roster-" + (await sha256(canonicalJson(["roster-draft-1", capture.sourceId, scope.bodyId, scope.jurisdictionId,
    capture.observedAt, capture.parserVersion, digest, expectedRevision]))).slice(0, 32);
  const observation = { id: id + ":source", sourceId: capture.sourceId, sourceUrl: capture.sourceUrl,
    parserVersion: capture.parserVersion, representation: capture.representation };
  const representation = JSON.parse(capture.representation);
  const facts: Array<Record<string, unknown>> = [], evidence: z.infer<typeof EvidenceReference>[] = [];
  async function fact(field: string, value: { id: string; [key: string]: unknown }, pointer: string) {
    if (new TextEncoder().encode(canonicalJson(value)).length > 24_000) throw Error("representative-fact-value-bound");
    let sourceValue: unknown = representation;
    for (const token of pointer.slice(1).split("/")) sourceValue = (sourceValue as Record<string, unknown>)[token];
    const evidenceId = id + ":e" + evidence.length;
    const ref = EvidenceReference.parse({ id: evidenceId, kind: "structured", observationId: observation.id,
      sourceId: capture.sourceId, sourceUrl: capture.sourceUrl, sourceLabel,
      representationSha256: digest, parserVersion: capture.parserVersion, pointer, valueJson: canonicalJson(sourceValue) });
    evidence.push(ref);
    const factId = id + ":f" + facts.length;
    facts.push({ id: factId, subjectId: value.id, field: "representative-" + field, value,
      evidenceIds: [evidenceId], evidenceDigests: [{ id: evidenceId, sha256: await evidenceReferenceDigest(ref) }], interpretationDependencies: null });
    return factId;
  }
  const term = { validFrom: null, validTo: null, datePrecision: "observation", observedAt: capture.observedAt };
  const offices = new Map<string, { officeId: string; membershipIds: string[]; committeeRoleIds: string[]; vacancyIds: string[] }>();
  for (const row of capture.rows) {
    const officeId = scope.bodyId + ":" + row.districtId;
    if (!offices.has(officeId)) {
      await fact("office", { id: officeId, jurisdiction: scope.jurisdiction, jurisdictionId: scope.jurisdictionId,
        bodyId: scope.bodyId, bodyName: scope.label, officeType: "legislative",
        district: { type: scope.bodyId === "us-senate" ? "at-large" : "district", id: row.districtId, label: row.districtLabel },
        seatCapacity: scope.bodyId === "us-senate" || scope.bodyId === "nj-assembly" ? 2 : 1, officialLookupUrl: scope.lookupUrl, ...term } as { id: string }, row.sourcePointer);
      offices.set(officeId, { officeId, membershipIds: [], committeeRoleIds: [], vacancyIds: [] });
    }
    const personId = capture.sourceId + ":" + row.nativeId, membershipId = scope.bodyId + ":" + row.nativeId;
    await fact("person", { id: personId, displayName: row.displayName, sourceIdentities: [{ sourceId: capture.sourceId, nativeId: row.nativeId }] } as { id: string }, row.sourcePointer);
    await fact("membership", { id: membershipId, personId, officeId, role: "member", displayNameAtTerm: row.displayName,
      party: row.party, officialProfileUrl: row.profileUrl, ...term } as { id: string }, row.sourcePointer);
    offices.get(officeId)!.membershipIds.push(membershipId);
  }
  const rosterFactId = await fact("roster", { id: id + ":roster", scope: { jurisdiction: scope.jurisdiction,
    jurisdictionId: scope.jurisdictionId, bodyId: scope.bodyId }, asOf: capture.observedAt, offices: [...offices.values()] } as { id: string },
    "/rawSha256");
  return RepresentativeDraft.parse({ id, expectedRevision, scope: { jurisdiction: scope.jurisdiction, jurisdictionId: scope.jurisdictionId,
    bodyId: scope.bodyId }, rosterFactId, facts, evidence, observations: [observation] });
}
export async function stageRepresentativeRosterCapture(db: D1DatabaseLike, capture: unknown, expectedRevision: number, now = new Date()) {
  return stageRepresentativeDraft(db, await buildRepresentativeRosterDraft(capture, expectedRevision), now);
}
