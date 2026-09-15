import { z } from "zod";
import { AcceptedFactRecord, CalendarDay, CanonicalInstant, EvidenceReference, HttpsUrl, PublicCitation,
  Sha256, WatchId, acceptedFactDigest, canonicalJson, evidenceReferenceDigest, sha256, tupleKey } from "./watch-schema";
import { evidenceMatches } from "./watch-projection";
import type { StoredObservation } from "./watch-projection";

const Label = z.string().min(1).max(240).refine(value => value.trim() === value);
const UniqueIds = z.array(WatchId).max(100).refine(ids => new Set(ids).size === ids.length);
export const RepresentativeJurisdiction = z.enum(["federal", "PA", "NJ", "DE"]);
const PeriodFields = { validFrom: CalendarDay, validTo: CalendarDay.nullable(), datePrecision: z.literal("day") };
const ObservedPeriodFields = { validFrom: CalendarDay.nullable(), validTo: CalendarDay.nullable(),
  datePrecision: z.enum(["day", "observation"]), observedAt: CanonicalInstant.optional() };
function observedPeriod(value: { validFrom: string | null; validTo: string | null; datePrecision: string; observedAt?: string }, context: z.RefinementCtx) {
  if (value.datePrecision === "observation") {
    if (value.validFrom !== null || value.validTo !== null || !value.observedAt)
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Observation mode requires an observation instant and unknown term boundaries" });
  } else if (!value.validFrom || value.observedAt !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Term mode requires a known start and no observation substitution" });
  } else increasingPeriod({ validFrom: value.validFrom, validTo: value.validTo }, context);
}
function increasingPeriod(value: { validFrom: string; validTo: string | null }, context: z.RefinementCtx) {
  if (value.validTo !== null && value.validTo <= value.validFrom) context.addIssue({ code: z.ZodIssueCode.custom,
    path: ["validTo"], message: "Membership periods are nonempty and half-open [from, to)" });
}
export const RepresentativePerson = z.object({ id: WatchId, displayName: Label,
  sourceIdentities: z.array(z.object({ sourceId: WatchId, nativeId: Label }).strict()).min(1).max(12),
}).strict().refine(value => new Set(value.sourceIdentities.map(id => canonicalJson(id))).size === value.sourceIdentities.length,
  "Duplicate person source identity");
export const RepresentativeOffice = z.object({ id: WatchId, jurisdiction: RepresentativeJurisdiction,
  jurisdictionId: WatchId, bodyId: WatchId, bodyName: Label, officeType: z.enum(["legislative", "executive"]),
  district: z.object({ type: z.enum(["district", "at-large"]), id: WatchId, label: Label }).strict(),
  seatCapacity: z.number().int().min(1).max(50), officialLookupUrl: HttpsUrl, ...ObservedPeriodFields,
}).strict().superRefine(observedPeriod);
export const RepresentativeMembership = z.object({ id: WatchId, personId: WatchId, officeId: WatchId,
  role: z.enum(["member", "elected-member", "appointed-member"]), displayNameAtTerm: Label,
  party: Label.nullable(), officialProfileUrl: HttpsUrl.nullable(), ...ObservedPeriodFields,
}).strict().superRefine(observedPeriod);
export const RepresentativeCommitteeRole = z.object({ id: WatchId, membershipId: WatchId, bodyId: WatchId,
  bodyName: Label, role: z.enum(["committee-member", "committee-chair", "committee-vice-chair", "leadership"]),
  ...PeriodFields,
}).strict().superRefine(increasingPeriod);
export const RepresentativeVacancy = z.object({ id: WatchId, officeId: WatchId,
  vacantSeats: z.number().int().min(1).max(50), ...PeriodFields,
}).strict().superRefine(increasingPeriod);
export const HistoricalPolicyRole = z.object({ id: WatchId, policyId: WatchId, actionId: WatchId,
  actionDate: CalendarDay, datePrecision: z.literal("day"), personId: WatchId, membershipId: WatchId,
  displayNameAtAction: Label, role: z.enum(["sponsor", "co-sponsor", "committee-role"]),
}).strict();
const Scope = z.object({ jurisdiction: RepresentativeJurisdiction, jurisdictionId: WatchId, bodyId: WatchId }).strict();
export const RepresentativeRoster = z.object({ id: WatchId, scope: Scope, asOf: CanonicalInstant,
  offices: z.array(z.object({ officeId: WatchId, membershipIds: UniqueIds, committeeRoleIds: UniqueIds,
    vacancyIds: UniqueIds }).strict()).min(1).max(500),
}).strict().refine(value => new Set(value.offices.map(office => office.officeId)).size === value.offices.length,
  "Duplicate roster office");
export const RepresentativeSnapshotAcceptance = z.object({ id: WatchId, revision: z.number().int().positive().safe(),
  scope: Scope, rosterFactId: WatchId, acceptedAt: CanonicalInstant,
  reviewBindingVersion: z.literal("authenticated-review-1").optional(),
  factDigests: z.array(z.object({ id: WatchId, sha256: Sha256 }).strict()).min(2).max(4000),
}).strict().refine(value => new Set(value.factDigests.map(fact => fact.id)).size === value.factDigests.length,
  "Duplicate accepted fact binding");

type Person = z.infer<typeof RepresentativePerson>;
type Office = z.infer<typeof RepresentativeOffice>;
type Membership = z.infer<typeof RepresentativeMembership>;
type CommitteeRole = z.infer<typeof RepresentativeCommitteeRole>;
type Vacancy = z.infer<typeof RepresentativeVacancy>;
type PolicyRole = z.infer<typeof HistoricalPolicyRole>;
type Roster = z.infer<typeof RepresentativeRoster>;
type Snapshot = z.infer<typeof RepresentativeSnapshotAcceptance>;
const Purpose = z.enum(["person", "office", "membership", "committee-role", "vacancy", "policy-role", "roster"]);
type Purpose = z.infer<typeof Purpose>;
type Bound<T> = { value: T; evidenceIds: string[]; verifiedAt: string };

export type OfficialRepresentativeSource = {
  jurisdictionIds: ReadonlySet<string>; bodyIds: ReadonlySet<string>; purposes: ReadonlySet<Purpose>;
};
// Server-only dependency injection. Load these stores after authentication/source
// enrollment; never deserialize a request body into this context. It is not a gate.
export type RepresentativeResolutionContext = {
  now: string; maxRosterAgeHours: number;
  acceptedSnapshots: ReadonlyMap<string, unknown>; currentRevisions: ReadonlyMap<string, number>;
  facts: ReadonlyMap<string, unknown>; evidence: ReadonlyMap<string, unknown>;
  observations: ReadonlyMap<string, StoredObservation>;
  officialSources: ReadonlyMap<string, OfficialRepresentativeSource>;
  sourceUrlAllowed: (sourceId: string, url: string) => boolean;
  officialPublicUrlAllowed: (url: string) => boolean;
};
export class RepresentativeContractError extends Error {
  constructor(readonly code: string) { super(code); this.name = "RepresentativeContractError"; }
}
const fail = (code: string): never => { throw new RepresentativeContractError(code); };
const dateContains = (period: { validFrom: string | null; validTo: string | null }, day: string) =>
  period.validFrom !== null && period.validFrom <= day && (period.validTo === null || day < period.validTo);
const rosterContains = (period: { validFrom: string | null; validTo: string | null; observedAt?: string }, asOf: string) =>
  period.observedAt ? period.observedAt === asOf : dateContains(period, easternDay(asOf));
function easternDay(instant: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(instant));
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}
function sameScope(left: z.infer<typeof Scope>, right: z.infer<typeof Scope>): boolean {
  return left.jurisdiction === right.jurisdiction && left.jurisdictionId === right.jurisdictionId && left.bodyId === right.bodyId;
}
function officeNaturalKey(office: Office): string {
  return canonicalJson([office.jurisdictionId, office.bodyId, office.officeType, office.district.type, office.district.id]);
}
export async function representativeOfficeKey(input: unknown): Promise<string> {
  const office = z.object({ jurisdictionId: WatchId, bodyId: WatchId,
    officeType: RepresentativeOffice.innerType().shape.officeType,
    district: z.object({ type: z.enum(["district", "at-large"]), id: WatchId }) }).parse(input);
  return tupleKey("office-v1", [office.jurisdictionId, office.bodyId, office.officeType, office.district.type, office.district.id]);
}
export async function representativePersonSourceKey(sourceId: string, nativeId: string): Promise<string> {
  WatchId.parse(sourceId); Label.parse(nativeId);
  return tupleKey("person-source-v1", [sourceId, nativeId]);
}

type DirectoryData = {
  snapshot: Snapshot; snapshotSha256: string; now: string; today: string; fresh: boolean; roster: Bound<Roster>;
  people: Map<string, Bound<Person>>; offices: Map<string, Bound<Office>>;
  memberships: Map<string, Bound<Membership>>; roles: Map<string, Bound<CommitteeRole>>;
  vacancies: Map<string, Bound<Vacancy>>; policyRoles: Map<string, Bound<PolicyRole>>;
  citations: Map<string, z.infer<typeof PublicCitation>>;
};
declare const resolvedDirectoryBrand: unique symbol;
export type ResolvedRepresentativeDirectory = { readonly [resolvedDirectoryBrand]: true };
const resolvedDirectories = new WeakMap<ResolvedRepresentativeDirectory, DirectoryData>();

// The only constructor resolves accepted rows and immutable evidence. JSON flags
// and structurally similar objects cannot manufacture a queryable directory.
export async function resolveRepresentativeDirectory(snapshotId: string, context: RepresentativeResolutionContext): Promise<ResolvedRepresentativeDirectory> {
  WatchId.parse(snapshotId); CanonicalInstant.parse(context.now);
  z.number().int().min(1).max(24 * 31).parse(context.maxRosterAgeHours);
  const parsed = RepresentativeSnapshotAcceptance.safeParse(context.acceptedSnapshots.get(snapshotId));
  if (!parsed.success) return fail("accepted-snapshot-unavailable");
  const snapshot = parsed.data;
  if (snapshot.id !== snapshotId || snapshot.acceptedAt > context.now || context.currentRevisions.get(snapshotId) !== snapshot.revision)
    return fail("snapshot-binding-conflict");
  const data: DirectoryData = { snapshot, snapshotSha256: await sha256(canonicalJson(snapshot)), now: context.now,
    today: easternDay(context.now), fresh: false, roster: undefined as unknown as Bound<Roster>,
    people: new Map(), offices: new Map(), memberships: new Map(), roles: new Map(), vacancies: new Map(),
    policyRoles: new Map(), citations: new Map() };
  const schemas = { person: RepresentativePerson, office: RepresentativeOffice, membership: RepresentativeMembership,
    "committee-role": RepresentativeCommitteeRole, vacancy: RepresentativeVacancy, "policy-role": HistoricalPolicyRole, roster: RepresentativeRoster };
  const allIds = new Set<string>();
  let rosterCount = 0;
  for (const binding of snapshot.factDigests) {
    const candidate = AcceptedFactRecord.safeParse(context.facts.get(binding.id));
    if (!candidate.success) return fail("accepted-fact-unavailable");
    const fact = AcceptedFactRecord.parse(JSON.parse(canonicalJson(candidate.data)));
    const purpose = Purpose.safeParse(fact.field.replace(/^representative-/, ""));
    if (!purpose.success || fact.field !== `representative-${purpose.data}` || fact.id !== binding.id ||
        fact.verification.verifiedAt > snapshot.acceptedAt || fact.interpretationDependencies !== null ||
        await acceptedFactDigest(fact) !== binding.sha256) return fail("accepted-fact-binding-conflict");
    const value = schemas[purpose.data].parse(fact.value);
    if ("observedAt" in value && value.observedAt && value.observedAt > fact.verification.verifiedAt)
      return fail("observation-after-verification");
    if (fact.subjectId !== value.id || allIds.has(value.id)) return fail("duplicate-or-conflicting-identity");
    allIds.add(value.id);
    for (const digest of fact.evidenceDigests) {
      const parsedEvidence = EvidenceReference.safeParse(context.evidence.get(digest.id));
      if (!parsedEvidence.success || parsedEvidence.data.id !== digest.id || await evidenceReferenceDigest(parsedEvidence.data) !== digest.sha256)
        return fail("evidence-binding-conflict");
      const evidence = parsedEvidence.data, source = context.officialSources.get(evidence.sourceId);
      const observed = context.observations.get(evidence.observationId);
      if (!source || !source.jurisdictionIds.has(snapshot.scope.jurisdictionId) || !source.bodyIds.has(snapshot.scope.bodyId) ||
          !source.purposes.has(purpose.data) || !context.sourceUrlAllowed(evidence.sourceId, evidence.sourceUrl) ||
          !context.officialPublicUrlAllowed(evidence.sourceUrl) || !observed || !await evidenceMatches(evidence, observed))
        return fail("official-evidence-unavailable");
      data.citations.set(evidence.id, { id: evidence.id, sourceId: evidence.sourceId, label: evidence.sourceLabel,
        url: evidence.sourceUrl, quote: evidence.kind === "structured" ? null : evidence.quote,
        locator: evidence.kind === "structured" ? evidence.pointer : evidence.kind === "pdf" ? `Page ${evidence.pageNumber}` : null });
    }
    const bound = { value, evidenceIds: [...fact.evidenceIds], verifiedAt: fact.verification.verifiedAt };
    switch (purpose.data) {
      case "person": data.people.set(value.id, bound as Bound<Person>); break;
      case "office": data.offices.set(value.id, bound as Bound<Office>); break;
      case "membership": data.memberships.set(value.id, bound as Bound<Membership>); break;
      case "committee-role": data.roles.set(value.id, bound as Bound<CommitteeRole>); break;
      case "vacancy": data.vacancies.set(value.id, bound as Bound<Vacancy>); break;
      case "policy-role": data.policyRoles.set(value.id, bound as Bound<PolicyRole>); break;
      case "roster":
        if (fact.id !== snapshot.rosterFactId) return fail("roster-binding-conflict");
        data.roster = bound as Bound<Roster>; rosterCount += 1; break;
    }
  }
  if (rosterCount !== 1 || !sameScope(data.roster.value.scope, snapshot.scope) || data.roster.value.asOf > data.roster.verifiedAt ||
      data.roster.value.asOf > context.now) return fail("roster-binding-conflict");
  data.fresh = Date.parse(context.now) - Date.parse(data.roster.value.asOf) < context.maxRosterAgeHours * 3_600_000;
  const naturalKeys = new Set<string>(), sourceIdentities = new Set<string>();
  for (const { value: person } of data.people.values()) for (const identity of person.sourceIdentities) {
    const key = canonicalJson(identity);
    if (sourceIdentities.has(key) || !context.officialSources.has(identity.sourceId)) return fail("person-source-identity-conflict");
    sourceIdentities.add(key);
  }
  for (const { value: office } of data.offices.values()) {
    const key = officeNaturalKey(office);
    if (!sameScope(office, snapshot.scope) || naturalKeys.has(key) || !context.officialPublicUrlAllowed(office.officialLookupUrl))
      return fail("office-identity-or-link-conflict");
    naturalKeys.add(key);
  }
  for (const { value: membership } of data.memberships.values()) {
    const office = data.offices.get(membership.officeId)?.value;
    if (!data.people.has(membership.personId) || !office ||
        (membership.observedAt ? !rosterContains(office, membership.observedAt) :
          membership.validFrom === null || office.validFrom === null || membership.validFrom < office.validFrom) ||
        (office.validTo !== null && (membership.validTo === null || membership.validTo > office.validTo)) ||
        (membership.officialProfileUrl !== null && !context.officialPublicUrlAllowed(membership.officialProfileUrl)))
      return fail("membership-identity-or-link-conflict");
  }
  for (const { value: role } of data.roles.values()) {
    const membership = data.memberships.get(role.membershipId)?.value;
    if (!membership || membership.validFrom === null || role.validFrom < membership.validFrom ||
        (membership.validTo !== null && (role.validTo === null || role.validTo > membership.validTo))) return fail("committee-term-conflict");
  }
  for (const { value: vacancy } of data.vacancies.values()) {
    const office = data.offices.get(vacancy.officeId)?.value;
    if (!office || office.validFrom === null || vacancy.vacantSeats > office.seatCapacity || vacancy.validFrom < office.validFrom ||
        (office.validTo !== null && (vacancy.validTo === null || vacancy.validTo > office.validTo))) return fail("vacancy-office-conflict");
  }
  const rosterDay = easternDay(data.roster.value.asOf);
  for (const entry of data.roster.value.offices) {
    const office = data.offices.get(entry.officeId)?.value;
    if (!office || !rosterContains(office, data.roster.value.asOf)) return fail("roster-office-conflict");
    const people = new Set<string>();
    for (const id of entry.membershipIds) {
      const membership = data.memberships.get(id)?.value;
      if (!membership || membership.officeId !== office.id || !rosterContains(membership, data.roster.value.asOf) || people.has(membership.personId))
        return fail("roster-membership-conflict");
      people.add(membership.personId);
    }
    let vacantSeats = 0;
    for (const id of entry.vacancyIds) {
      const vacancy = data.vacancies.get(id)?.value;
      if (!vacancy || vacancy.officeId !== office.id || !dateContains(vacancy, rosterDay)) return fail("roster-vacancy-conflict");
      vacantSeats += vacancy.vacantSeats;
    }
    if (people.size + vacantSeats > office.seatCapacity) return fail("roster-seat-capacity-conflict");
    for (const id of entry.committeeRoleIds) {
      const role = data.roles.get(id)?.value;
      if (!role || !entry.membershipIds.includes(role.membershipId) || !dateContains(role, rosterDay)) return fail("roster-committee-conflict");
    }
  }
  for (const { value: role } of data.policyRoles.values()) {
    const membership = data.memberships.get(role.membershipId)?.value;
    if (!membership || membership.personId !== role.personId || !dateContains(membership, role.actionDate) || role.actionDate > data.today)
      return fail("historical-role-membership-conflict");
  }
  const handle = Object.freeze({}) as ResolvedRepresentativeDirectory;
  resolvedDirectories.set(handle, data);
  return handle;
}

export const RepresentativeQuery = z.object({ jurisdiction: RepresentativeJurisdiction,
  jurisdictionId: WatchId, bodyId: WatchId, districtId: WatchId.optional(), asOf: CalendarDay,
  limit: z.number().int().min(1).max(50).default(20), cursor: z.string().min(1).max(2048).optional(),
}).strict();
const MembershipState = z.enum(["verified-current", "verified-historical", "observed-current", "last-known"]);
const PublicRole = z.object({ id: WatchId, bodyId: WatchId, bodyName: Label,
  role: RepresentativeCommitteeRole.innerType().shape.role, state: MembershipState,
  validFrom: CalendarDay, validTo: CalendarDay.nullable(), evidenceIds: UniqueIds }).strict();
const PublicMember = z.object({ personId: WatchId, membershipId: WatchId, displayName: Label,
  role: RepresentativeMembership.innerType().shape.role, party: Label.nullable(), officialProfileUrl: HttpsUrl.nullable(),
  state: MembershipState, ...ObservedPeriodFields,
  committeeRoles: z.array(PublicRole).max(100), evidenceIds: UniqueIds }).strict().superRefine(observedPeriod);
export const PublicRepresentativeOffice = z.object({ id: WatchId, jurisdiction: RepresentativeJurisdiction,
  jurisdictionId: WatchId, bodyId: WatchId, bodyName: Label, officeType: RepresentativeOffice.innerType().shape.officeType,
  district: RepresentativeOffice.innerType().shape.district, officialLookupUrl: HttpsUrl,
  state: z.enum(["verified-membership", "verified-vacancy", "partially-verified", "unverified"]),
  seats: z.object({ capacity: z.number().int().min(1).max(50), verifiedFilled: z.number().int().nonnegative(),
    verifiedVacant: z.number().int().nonnegative(), unverified: z.number().int().nonnegative(),
    lastKnownFilled: z.number().int().nonnegative(), lastKnownVacant: z.number().int().nonnegative() }).strict(),
  members: z.array(PublicMember).max(50), vacancies: z.array(z.object({ id: WatchId,
    vacantSeats: z.number().int().positive(), state: MembershipState, validFrom: CalendarDay, validTo: CalendarDay.nullable(),
    evidenceIds: UniqueIds }).strict()).max(50),
  sources: z.array(PublicCitation).min(1).max(1000),
}).strict();
export type PublicRepresentativeOffice = z.infer<typeof PublicRepresentativeOffice>;
export const PublicRepresentativeResult = z.object({ schemaVersion: z.literal(1), mode: z.enum(["current", "historical"]),
  dataState: z.enum(["current", "stale", "unavailable"]), dataAsOf: CanonicalInstant.nullable(),
  selectedAsOf: CalendarDay, selectionMeaning: z.literal("selected-district-not-verified-residency"),
  unavailableReason: z.enum(["accepted-directory-unavailable", "scope-not-enrolled", "historical-coverage-unavailable"]).nullable(),
  offices: z.array(PublicRepresentativeOffice).max(50), nextCursor: z.string().max(2048).nullable(),
}).strict();
export type PublicRepresentativeResult = z.infer<typeof PublicRepresentativeResult>;

function dataFor(handle: ResolvedRepresentativeDirectory): DirectoryData {
  return resolvedDirectories.get(handle) ?? fail("server-resolved-directory-required");
}
function sourcesFor(data: DirectoryData, bindings: Array<{ evidenceIds: string[] }>): z.infer<typeof PublicCitation>[] {
  return [...new Set(bindings.flatMap(binding => binding.evidenceIds))].sort().map(id => {
    const source = data.citations.get(id) ?? fail("public-evidence-unavailable");
    return { id: source.id, sourceId: source.sourceId, label: source.label, url: source.url, quote: source.quote, locator: source.locator };
  });
}
function selectedState(period: { validFrom: string | null; validTo: string | null; observedAt?: string }, listed: boolean,
  day: string, data: DirectoryData): z.infer<typeof MembershipState> | null {
  if (period.observedAt) return day === data.today && listed && period.observedAt === data.roster.value.asOf
    ? data.fresh ? "observed-current" : "last-known" : null;
  if (!dateContains(period, day)) return null;
  if (day === data.today) return listed ? data.fresh ? "verified-current" : "last-known" : null;
  const rosterDay = easternDay(data.roster.value.asOf);
  // A future scheduled term end cannot fill a gap after the last observed roster.
  return (period.validTo !== null && period.validTo <= rosterDay) || (listed && day <= rosterDay) ? "verified-historical" : null;
}
function projectOffice(boundOffice: Bound<Office>, day: string, data: DirectoryData): PublicRepresentativeOffice {
  const office = boundOffice.value, rosterEntry = data.roster.value.offices.find(entry => entry.officeId === office.id);
  const bindings: Array<{ evidenceIds: string[] }> = [boundOffice, data.roster];
  const members: z.infer<typeof PublicMember>[] = [];
  const seenPeople = new Set<string>();
  for (const bound of data.memberships.values()) {
    const membership = bound.value;
    if (membership.officeId !== office.id) continue;
    const state = selectedState(membership, rosterEntry?.membershipIds.includes(membership.id) ?? false, day, data);
    if (!state) continue;
    if (seenPeople.has(membership.personId)) return fail("overlapping-person-memberships");
    seenPeople.add(membership.personId);
    const person = data.people.get(membership.personId)!;
    bindings.push(bound, person);
    const committeeRoles: z.infer<typeof PublicRole>[] = [];
    for (const roleBound of data.roles.values()) {
      const role = roleBound.value;
      if (role.membershipId !== membership.id) continue;
      const roleState = selectedState(role, rosterEntry?.committeeRoleIds.includes(role.id) ?? false, day, data);
      if (!roleState) continue;
      bindings.push(roleBound);
      committeeRoles.push({ id: role.id, bodyId: role.bodyId, bodyName: role.bodyName, role: role.role, state: roleState,
        validFrom: role.validFrom, validTo: role.validTo, evidenceIds: [...roleBound.evidenceIds] });
    }
    members.push({ personId: membership.personId, membershipId: membership.id,
      displayName: state === "verified-historical" ? membership.displayNameAtTerm : person.value.displayName,
      role: membership.role, party: membership.party, officialProfileUrl: membership.officialProfileUrl,
      state, validFrom: membership.validFrom, validTo: membership.validTo, datePrecision: membership.datePrecision,
      ...(membership.observedAt ? { observedAt: membership.observedAt } : {}), committeeRoles,
      evidenceIds: [...bound.evidenceIds] });
  }
  members.sort((a, b) => a.displayName.localeCompare(b.displayName, "en") || a.personId.localeCompare(b.personId, "en"));
  const vacancies: PublicRepresentativeOffice["vacancies"] = [];
  for (const bound of data.vacancies.values()) {
    const vacancy = bound.value;
    if (vacancy.officeId !== office.id) continue;
    const state = selectedState(vacancy, rosterEntry?.vacancyIds.includes(vacancy.id) ?? false, day, data);
    if (!state) continue;
    bindings.push(bound);
    vacancies.push({ id: vacancy.id, vacantSeats: vacancy.vacantSeats, state,
      validFrom: vacancy.validFrom, validTo: vacancy.validTo, evidenceIds: [...bound.evidenceIds] });
  }
  const verifiedFilled = members.filter(member => member.state !== "last-known").length;
  const verifiedVacant = vacancies.filter(vacancy => vacancy.state !== "last-known").reduce((sum, vacancy) => sum + vacancy.vacantSeats, 0);
  const lastKnownFilled = members.length - verifiedFilled;
  const lastKnownVacant = vacancies.filter(vacancy => vacancy.state === "last-known").reduce((sum, vacancy) => sum + vacancy.vacantSeats, 0);
  if (verifiedFilled + verifiedVacant + lastKnownFilled + lastKnownVacant > office.seatCapacity) return fail("selected-date-seat-capacity-conflict");
  const unverified = office.seatCapacity - verifiedFilled - verifiedVacant;
  return PublicRepresentativeOffice.parse({ id: office.id, jurisdiction: office.jurisdiction, jurisdictionId: office.jurisdictionId,
    bodyId: office.bodyId, bodyName: office.bodyName, officeType: office.officeType,
    district: { type: office.district.type, id: office.district.id, label: office.district.label }, officialLookupUrl: office.officialLookupUrl,
    state: unverified === office.seatCapacity ? "unverified" : unverified > 0 ? "partially-verified" : verifiedFilled > 0 ? "verified-membership" : "verified-vacancy",
    seats: { capacity: office.seatCapacity, verifiedFilled, verifiedVacant, unverified, lastKnownFilled, lastKnownVacant },
    members, vacancies, sources: sourcesFor(data, bindings) });
}
const Cursor = z.object({ snapshotSha256: Sha256, jurisdiction: RepresentativeJurisdiction,
  jurisdictionId: WatchId, bodyId: WatchId, districtId: WatchId.nullable(), asOf: CalendarDay, afterOfficeId: WatchId }).strict();
function cursorFilters(query: { jurisdiction: z.infer<typeof RepresentativeJurisdiction>; jurisdictionId: string;
  bodyId: string; districtId?: string | null; asOf: string }) {
  return { jurisdiction: query.jurisdiction, jurisdictionId: query.jurisdictionId, bodyId: query.bodyId,
    districtId: query.districtId ?? null, asOf: query.asOf };
}
function boundedResult(result: PublicRepresentativeResult): PublicRepresentativeResult {
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 250_000) return fail("public-directory-byte-limit");
  return PublicRepresentativeResult.parse(result);
}
export function representativeDirectoryUnavailable(input: unknown, now: string): PublicRepresentativeResult {
  const query = RepresentativeQuery.parse(input); CanonicalInstant.parse(now);
  const today = easternDay(now);
  if (query.asOf > today) return fail("future-as-of-not-supported");
  return boundedResult({ schemaVersion: 1, mode: query.asOf === today ? "current" : "historical",
    dataState: "unavailable", dataAsOf: null, selectedAsOf: query.asOf,
    selectionMeaning: "selected-district-not-verified-residency", unavailableReason: "accepted-directory-unavailable",
    offices: [], nextCursor: null });
}
export function queryRepresentatives(directory: ResolvedRepresentativeDirectory, input: unknown): PublicRepresentativeResult {
  const data = dataFor(directory), query = RepresentativeQuery.parse(input);
  if (query.asOf > data.today) return fail("future-as-of-not-supported");
  const base = { schemaVersion: 1 as const, mode: query.asOf === data.today ? "current" as const : "historical" as const,
    selectedAsOf: query.asOf, selectionMeaning: "selected-district-not-verified-residency" as const };
  if (!sameScope(query, data.snapshot.scope)) return boundedResult({ ...base, dataState: "unavailable", dataAsOf: null,
    unavailableReason: "scope-not-enrolled", offices: [], nextCursor: null });
  if (query.asOf !== data.today && [...data.offices.values()].every(({ value }) => value.datePrecision === "observation"))
    return boundedResult({ ...base, dataState: "unavailable", dataAsOf: data.roster.value.asOf,
      unavailableReason: "historical-coverage-unavailable", offices: [], nextCursor: null });
  const offices = [...data.offices.values()].filter(({ value }) =>
    (value.datePrecision === "observation" ? query.asOf === data.today : dateContains(value, query.asOf)) &&
    (query.districtId === undefined || value.district.id === query.districtId)).sort((a, b) => a.value.id < b.value.id ? -1 : a.value.id > b.value.id ? 1 : 0);
  let after = -1;
  if (query.cursor) {
    let cursor: z.infer<typeof Cursor>;
    try { cursor = Cursor.parse(JSON.parse(atob(query.cursor.replace(/-/g, "+").replace(/_/g, "/")))); }
    catch { return fail("invalid-cursor"); }
    if (cursor.snapshotSha256 !== data.snapshotSha256 || canonicalJson(cursorFilters(cursor)) !== canonicalJson(cursorFilters(query)))
      return fail("cursor-snapshot-or-filter-conflict");
    after = offices.findIndex(office => office.value.id === cursor.afterOfficeId);
    if (after === -1) return fail("invalid-cursor-position");
  }
  const selected = offices.slice(after + 1, after + 1 + query.limit);
  const nextCursor = after + 1 + selected.length < offices.length
    ? btoa(canonicalJson({ snapshotSha256: data.snapshotSha256, ...cursorFilters(query), afterOfficeId: selected.at(-1)!.value.id }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : null;
  return boundedResult({ ...base, dataState: data.fresh ? "current" : "stale", dataAsOf: data.roster.value.asOf,
    unavailableReason: null, offices: selected.map(office => projectOffice(office, query.asOf, data)), nextCursor });
}

export function projectHistoricalPolicyRole(directory: ResolvedRepresentativeDirectory, roleId: string) {
  const data = dataFor(directory); WatchId.parse(roleId);
  const bound = data.policyRoles.get(roleId);
  if (!bound) return null;
  const role = bound.value, membership = data.memberships.get(role.membershipId)!, office = data.offices.get(membership.value.officeId)!;
  // Resolve the action's immutable membership ID, never the office's current occupant.
  return { id: role.id, policyId: role.policyId, actionId: role.actionId, actionDate: role.actionDate, datePrecision: "day" as const,
    personId: role.personId, membershipId: role.membershipId, displayName: role.displayNameAtAction, role: role.role,
    office: { id: office.value.id, bodyId: office.value.bodyId, bodyName: office.value.bodyName,
      district: { type: office.value.district.type, id: office.value.district.id, label: office.value.district.label } },
    term: { validFrom: membership.value.validFrom, validTo: membership.value.validTo, datePrecision: "day" as const },
    sources: sourcesFor(data, [bound, membership, office]) };
}
