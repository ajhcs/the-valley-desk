import { z } from "zod";
import { CanonicalInstant, HttpsUrl, Sha256, WatchId, canonicalJson, sha256 } from "./watch-schema";

// Mirrors the approved coverage pack and blueprint source plan, not collection status.
export const WATCH_COUNTIES = Object.freeze([
  { id: "pa-philadelphia", state: "PA", name: "Philadelphia" },
  { id: "pa-bucks", state: "PA", name: "Bucks" },
  { id: "pa-montgomery", state: "PA", name: "Montgomery" },
  { id: "pa-chester", state: "PA", name: "Chester" },
  { id: "pa-delaware", state: "PA", name: "Delaware" },
  { id: "nj-camden", state: "NJ", name: "Camden" },
  { id: "nj-burlington", state: "NJ", name: "Burlington" },
  { id: "nj-gloucester", state: "NJ", name: "Gloucester" },
  { id: "nj-salem", state: "NJ", name: "Salem" },
  { id: "nj-atlantic", state: "NJ", name: "Atlantic" },
  { id: "de-new-castle", state: "DE", name: "New Castle" },
] as const);
WATCH_COUNTIES.forEach(county => Object.freeze(county));
export const WATCH_REQUIRED_FAMILIES = Object.freeze([
  "federal-legislation", "federal-regulation", "federal-dockets", "federal-members",
  "pa-legislation", "pa-regulation", "pa-members", "nj-legislation", "nj-regulation", "nj-members",
  "de-legislation", "de-regulation", "de-members",
] as const);
export type WatchCountyId = typeof WATCH_COUNTIES[number]["id"];
export type WatchRequiredFamily = typeof WATCH_REQUIRED_FAMILIES[number];
const CountyId = z.custom<WatchCountyId>(value => typeof value === "string" && WATCH_COUNTIES.some(county => county.id === value));
const FamilyId = z.enum(WATCH_REQUIRED_FAMILIES);
const Label = z.string().min(1).max(240).refine(value => value.trim() === value);
const Text = z.string().min(1).max(1000).refine(value => value.trim() === value);
const Bodies = z.array(z.object({ id: WatchId, label: Label }).strict()).min(1).max(100)
  .refine(bodies => new Set(bodies.map(body => body.id)).size === bodies.length);
const Sources = z.array(z.object({ sourceId: WatchId, url: HttpsUrl }).strict()).min(1).max(50)
  .refine(sources => new Set(sources.map(source => canonicalJson(source))).size === sources.length);
const MunicipalScope = z.object({ status: z.enum(["not-enumerated", "named-bodies-only"]),
  knownGaps: z.array(Text).min(1).max(50) }).strict();
const RecordBase = { id: WatchId, monitoredBodies: Bodies, officialSources: Sources,
  publicScopeText: Text, evidenceLogLocation: Label, lastCheckedAt: CanonicalInstant, nextReviewAt: CanonicalInstant,
  evidenceReceiptId: WatchId, evidenceReceiptSha256: Sha256 };
export const ManualCountyAssignment = z.object({ ...RecordBase, kind: z.literal("manual"), countyId: CountyId,
  namedEditorId: WatchId, backupEditorId: WatchId, checkCadenceHours: z.number().int().min(1).max(168),
  coverageHours: Text, assignmentReviewedAt: CanonicalInstant, municipalScope: MunicipalScope,
}).strict().superRefine((value, context) => {
  if (value.namedEditorId === value.backupEditorId) context.addIssue({ code: z.ZodIssueCode.custom,
    path: ["backupEditorId"], message: "Primary and backup must be distinct enrolled people" });
  if (value.nextReviewAt <= value.assignmentReviewedAt || value.lastCheckedAt < value.assignmentReviewedAt)
    context.addIssue({ code: z.ZodIssueCode.custom, message: "An assignment needs a check after review and a future review date" });
});
export const QualifiedSourceCoverage = z.object({ ...RecordBase, kind: z.literal("source"),
  obligation: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("county"), countyId: CountyId, municipalScope: MunicipalScope }).strict(),
    z.object({ kind: z.literal("family"), familyId: FamilyId }).strict(),
  ]), checkCadenceHours: z.number().int().min(1).max(168), qualificationReviewedAt: CanonicalInstant,
}).strict().superRefine((value, context) => {
  if (value.nextReviewAt <= value.qualificationReviewedAt || value.lastCheckedAt < value.qualificationReviewedAt)
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Source qualification needs a subsequent check and future review" });
});
const CoverageRecord = z.union([ManualCountyAssignment, QualifiedSourceCoverage]);
const Acceptance = z.object({ recordId: WatchId, recordSha256: Sha256, approvedAt: CanonicalInstant, reviewerId: WatchId }).strict();
const StaffMember = z.object({ id: WatchId, displayName: Label, availableThrough: CanonicalInstant }).strict();
export type CoverageRecord = z.infer<typeof CoverageRecord>;
export type CoverageStaffMember = z.infer<typeof StaffMember>;

// Authenticated editorial/source qualification storage is the authority here.
// A request-supplied approved/qualified flag, URL or editor name is not enrollment.
export type WatchCoverageContext = {
  now: string;
  records: ReadonlyMap<string, unknown>; acceptedRecords: ReadonlyMap<string, unknown>;
  evidenceReceipts: ReadonlyMap<string, { bytes: string | Uint8Array; recordId: string; recordedAt: string }>;
  staffDirectory: ReadonlyMap<string, unknown>; authorizedReviewerIds: ReadonlySet<string>;
  enrolledSourceIds: ReadonlySet<string>;
  enrolledSourceObligations: ReadonlyMap<string, ReadonlySet<string>>;
  sourceUrlAllowed: (sourceId: string, url: string) => boolean;
};
export async function coverageRecordDigest(input: unknown): Promise<string> {
  return sha256(canonicalJson(CoverageRecord.parse(input)));
}
type CoverageState = "unassigned" | "qualified-source" | "manual-ready" | "stale" | "unavailable";
type Issue = "missing-acceptance" | "invalid-record" | "acceptance-binding-conflict" | "qualification-evidence-unavailable" |
  "source-not-enrolled" | "staff-unassigned" | "review-expired" | "check-overdue";
type Assessment = { record: CoverageRecord; status: "qualified-source" | "manual-ready" | "stale" | "unavailable"; reason: Issue | null };
export type PublicCoverageEntry = {
  id: string; status: CoverageState; dataAsOf: string | null; nextReviewAt: string | null;
  reason: Issue | "not-enrolled" | null; publicScopeText: string;
  monitoredBodies: Array<{ id: string; label: string }>; officialSources: Array<{ sourceId: string; url: string }>;
  checkCadenceHours: number | null; coverageHours: string | null;
  municipalScope: { status: "not-enumerated" | "named-bodies-only"; knownGaps: string[] } | null;
};
function obligationId(record: CoverageRecord): string {
  return record.kind === "manual" ? record.countyId : record.obligation.kind === "county" ? record.obligation.countyId : record.obligation.familyId;
}
function enrolledStaff(id: string, context: WatchCoverageContext): CoverageStaffMember | null {
  const parsed = StaffMember.safeParse(context.staffDirectory.get(id));
  return parsed.success && parsed.data.id === id && context.now < parsed.data.availableThrough ? parsed.data : null;
}
async function assess(record: CoverageRecord, context: WatchCoverageContext): Promise<Assessment> {
  const result = (status: Assessment["status"], reason: Assessment["reason"]): Assessment => ({ record, status, reason });
  const approval = Acceptance.safeParse(context.acceptedRecords.get(record.id));
  if (!approval.success) return result("unavailable", "missing-acceptance");
  if (approval.data.recordId !== record.id || approval.data.approvedAt > context.now ||
      !context.authorizedReviewerIds.has(approval.data.reviewerId) ||
      approval.data.recordSha256 !== await coverageRecordDigest(record)) return result("unavailable", "acceptance-binding-conflict");
  const reviewedAt = record.kind === "manual" ? record.assignmentReviewedAt : record.qualificationReviewedAt;
  if (reviewedAt > approval.data.approvedAt || record.lastCheckedAt > approval.data.approvedAt || record.lastCheckedAt > context.now)
    return result("unavailable", "acceptance-binding-conflict");
  const receipt = context.evidenceReceipts.get(record.evidenceReceiptId);
  if (!receipt || receipt.recordId !== record.id || !CanonicalInstant.safeParse(receipt.recordedAt).success ||
      receipt.recordedAt !== record.lastCheckedAt || receipt.recordedAt < reviewedAt ||
      await sha256(receipt.bytes) !== record.evidenceReceiptSha256) return result("unavailable", "qualification-evidence-unavailable");
  if (record.officialSources.some(source => !context.enrolledSourceIds.has(source.sourceId) ||
      !context.enrolledSourceObligations.get(source.sourceId)?.has(obligationId(record)) || !context.sourceUrlAllowed(source.sourceId, source.url)))
    return result("unavailable", "source-not-enrolled");
  if (record.kind === "manual" && (!enrolledStaff(record.namedEditorId, context) || !enrolledStaff(record.backupEditorId, context)))
    return result("unavailable", "staff-unassigned");
  if (context.now >= record.nextReviewAt) return result("stale", "review-expired");
  if (Date.parse(context.now) - Date.parse(record.lastCheckedAt) >= record.checkCadenceHours * 3_600_000)
    return result("stale", "check-overdue");
  return result(record.kind === "manual" ? "manual-ready" : "qualified-source", null);
}
function emptyEntry(id: string, county: boolean, invalid: boolean): PublicCoverageEntry {
  return { id, status: invalid ? "unavailable" : "unassigned", dataAsOf: null, nextReviewAt: null,
    reason: invalid ? "invalid-record" : "not-enrolled", publicScopeText: "No accepted monitoring scope is enrolled.",
    monitoredBodies: [], officialSources: [], checkCadenceHours: null, coverageHours: null,
    municipalScope: county ? { status: "not-enumerated", knownGaps: ["Municipal coverage has not been enumerated."] } : null };
}
function publicEntry(id: string, county: boolean, assessments: Assessment[], invalid: boolean): PublicCoverageEntry {
  const order = { "qualified-source": 0, "manual-ready": 1, stale: 2, unavailable: 3 };
  const chosen = [...assessments].sort((a, b) => order[a.status] - order[b.status] ||
    b.record.lastCheckedAt.localeCompare(a.record.lastCheckedAt) || a.record.id.localeCompare(b.record.id))[0];
  if (!chosen) return emptyEntry(id, county, invalid);
  if (chosen.status === "unavailable") return { ...emptyEntry(id, county, false), status: "unavailable", reason: chosen.reason };
  const record = chosen.record;
  const municipalScope = record.kind === "manual" ? record.municipalScope : record.obligation.kind === "county" ? record.obligation.municipalScope : null;
  return { id, status: chosen.status, dataAsOf: record.lastCheckedAt, nextReviewAt: record.nextReviewAt,
    reason: chosen.reason, publicScopeText: record.publicScopeText,
    monitoredBodies: record.monitoredBodies.map(body => ({ id: body.id, label: body.label })),
    officialSources: record.officialSources.map(source => ({ sourceId: source.sourceId, url: source.url })),
    checkCadenceHours: record.checkCadenceHours, coverageHours: record.kind === "manual" ? record.coverageHours : null,
    municipalScope: municipalScope ? { status: municipalScope.status, knownGaps: [...municipalScope.knownGaps] } : null };
}

export async function assessWatchCoverage(context: WatchCoverageContext) {
  CanonicalInstant.parse(context.now);
  if (context.records.size > 500 || context.acceptedRecords.size > 500) throw new RangeError("Coverage snapshot exceeds record limit");
  const grouped = new Map<string, Assessment[]>(), invalid = new Set<string>();
  for (const [id, input] of context.records) {
    const parsed = CoverageRecord.safeParse(input);
    if (!parsed.success || parsed.data.id !== id) {
      // Invalid documentary records never produce public names, scope or links.
      if (input && typeof input === "object") {
        const raw = input as { countyId?: unknown; obligation?: { countyId?: unknown; familyId?: unknown } };
        const key = raw.countyId ?? raw.obligation?.countyId ?? raw.obligation?.familyId;
        if (typeof key === "string") invalid.add(key);
      }
      continue;
    }
    const record = CoverageRecord.parse(JSON.parse(canonicalJson(parsed.data)));
    const key = obligationId(record), entries = grouped.get(key) ?? [];
    entries.push(await assess(record, context)); grouped.set(key, entries);
  }
  const counties = WATCH_COUNTIES.map(county => ({ ...publicEntry(county.id, true, grouped.get(county.id) ?? [], invalid.has(county.id)),
    state: county.state, name: county.name }));
  const families = WATCH_REQUIRED_FAMILIES.map(id => publicEntry(id, false, grouped.get(id) ?? [], invalid.has(id)));
  const countiesSatisfied = counties.filter(county => county.status === "qualified-source" || county.status === "manual-ready").length;
  const familiesSatisfied = families.filter(family => family.status === "qualified-source").length;
  const dates = [...counties, ...families].flatMap(entry => entry.dataAsOf ? [entry.dataAsOf] : []).sort();
  const output = { schemaVersion: 1 as const, dataAsOf: dates[0] ?? null,
    requiredJurisdictions: ["federal", "PA", "NJ", "DE"] as const,
    counties, families, totals: { countiesRequired: 11 as const, countiesSatisfied, familiesRequired: 13 as const, familiesSatisfied },
    requiredCoverageSatisfied: countiesSatisfied === 11 && familiesSatisfied === 13,
    publicationAuthorized: false as const };
  if (new TextEncoder().encode(JSON.stringify(output)).byteLength > 250_000) throw new RangeError("Public coverage byte limit exceeded");
  return output;
}
