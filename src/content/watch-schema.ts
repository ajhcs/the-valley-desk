import { z } from "zod";

export const WatchId = z.string().min(1).max(240).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const MAX_PUBLIC_WATCH_BYTES = 150_000;
const Text = z.string().min(1).max(6000).refine(value => value.trim() === value, "Text must be trimmed");
const Label = Text.pipe(z.string().max(240));
export const HttpsUrl = z.string().max(2048).url().refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443");
  } catch { return false; }
}, "Public links must use credential-free HTTPS");
export const CanonicalInstant = z.string().datetime().refine(value => {
  const date = new Date(value);
  return !value.startsWith("0000-") && Number.isFinite(date.getTime()) && date.toISOString() === value;
}, "Use a real canonical UTC instant with milliseconds");

export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}
export const CalendarDay = z.string().refine(isCalendarDay, "Use a real YYYY-MM-DD calendar day");
const TimeZone = Label.refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
}, "Unknown time zone");
export const EvidenceIds = z.array(WatchId).min(1).max(20).refine(ids => new Set(ids).size === ids.length, "Duplicate evidence ID");
export const SourceDate = z.discriminatedUnion("precision", [
  z.object({ precision: z.literal("instant"), value: CanonicalInstant, evidenceIds: EvidenceIds }).strict(),
  z.object({ precision: z.literal("day"), value: CalendarDay, timezone: TimeZone.nullable(),
    timezoneReason: Label.nullable(), evidenceIds: EvidenceIds }).strict(),
  z.object({ precision: z.literal("unknown"), reason: Label }).strict(),
]).superRefine((value, context) => {
  if (value.precision === "day" && ((value.timezone === null) !== (value.timezoneReason !== null))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["timezoneReason"],
      message: "Unknown time zone requires a reason; known time zone must not carry an unknown reason" });
  }
});
export type SourceDate = z.infer<typeof SourceDate>;
export const WatchJurisdiction = z.enum(["federal", "PA", "NJ", "DE", "regional"]);
export const PolicyInstrumentType = z.enum(["bill", "resolution", "proposal-memo", "proposed-rule", "rule", "guidance", "enforcement", "ordinance"]);
export const PolicyLifecycle = z.enum(["proposed", "active", "adopted", "failed", "withdrawn", "vetoed", "expired", "superseded", "rescinded", "unknown"]);
export const PolicyLegalEffect = z.enum(["not-in-effect", "future-effective", "in-effect", "stayed", "ceased", "unknown"]);
export const InterpretationReadiness = z.enum(["metadata-only", "text-pending", "extraction-pending", "review-pending", "reviewed", "evidence-changed"]);
export const TechnologyResourceType = z.enum(["software", "paper", "dataset", "database-engine", "data-platform", "standard", "commercial-product"]);
export const LicenseClassification = z.enum(["osi-open-source", "restricted-source", "proprietary", "unknown", "not-applicable"]);
export const PolicyIdentity = z.object({ jurisdiction: WatchJurisdiction, jurisdictionId: WatchId, bodyId: WatchId,
  sessionKey: Label, instrumentType: PolicyInstrumentType, sourceInstrumentId: Label }).strict().superRefine((value, context) => {
  if (["bill", "resolution", "proposal-memo"].includes(value.instrumentType) && value.sessionKey === "standing") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["sessionKey"], message: "A legislative session must be verified" });
  }
});
export type PolicyIdentity = z.infer<typeof PolicyIdentity>;

// Canonical JSON is used for immutable bindings, not for source ID normalization.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new TypeError("Expected finite plain JSON data");
}
export async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function tupleKey(namespace: string, parts: readonly string[]): Promise<string> {
  WatchId.parse(namespace);
  z.array(Label).min(1).max(12).parse(parts);
  return `${namespace}:${await sha256(canonicalJson([1, namespace, ...parts]))}`;
}
export async function policyIdentityKey(input: unknown): Promise<string> {
  const value = PolicyIdentity.parse(input);
  return tupleKey("policy-v1", [value.jurisdiction, value.jurisdictionId, value.bodyId, value.sessionKey, value.instrumentType, value.sourceInstrumentId]);
}
export async function githubRepositoryKey(numericId: string): Promise<string> {
  z.string().regex(/^[1-9]\d{0,19}$/).parse(numericId);
  return tupleKey("repository-v1", ["github.com", numericId]);
}
export const DevelopmentType = z.enum(["policy-action", "software-release", "tag", "commit", "paper-publication", "dataset-release", "product-release", "baseline", "indexing"]);
export async function developmentIdentityKey(subjectId: string, type: z.infer<typeof DevelopmentType>, authoritativeEventKey: string): Promise<string> {
  WatchId.parse(subjectId); DevelopmentType.parse(type);
  return tupleKey("development-v1", [subjectId, type, authoritativeEventKey]);
}

const EvidenceBase = { id: WatchId, observationId: WatchId, sourceId: WatchId, sourceUrl: HttpsUrl,
  sourceLabel: Label, representationSha256: Sha256, parserVersion: Label };
const Quote = { quote: z.string().min(3).max(2000), start: z.number().int().min(0).max(2_000_000),
  end: z.number().int().min(3).max(2_000_000), normalizerVersion: Label, normalizedTextSha256: Sha256 };
const JsonPointer = z.string().max(1000).regex(/^(?:\/(?:[^~]|~[01])*)+$/);
export const EvidenceReference = z.discriminatedUnion("kind", [
  z.object({ ...EvidenceBase, kind: z.literal("text"), ...Quote }).strict(),
  z.object({ ...EvidenceBase, kind: z.literal("structured"), pointer: JsonPointer,
    valueJson: z.string().max(12_000).refine(value => { try { canonicalJson(JSON.parse(value)); return true; } catch { return false; } }) }).strict(),
  z.object({ ...EvidenceBase, kind: z.literal("pdf"), ...Quote, artifactSha256: Sha256,
    extractionSha256: Sha256, pageNumber: z.number().int().min(1).max(100), pageRenderSha256: Sha256 }).strict(),
]).superRefine((value, context) => {
  if (value.kind !== "structured" && value.end - value.start !== value.quote.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["end"], message: "Quote offsets use exact UTF-16 string positions" });
  }
});
export type EvidenceReference = z.infer<typeof EvidenceReference>;
export async function evidenceReferenceDigest(input: unknown): Promise<string> {
  return sha256(canonicalJson(EvidenceReference.parse(input)));
}
const Dependency = z.object({ id: WatchId, sha256: Sha256 }).strict();
export const InterpretationDependencies = z.object({ instrumentId: WatchId, policyVersionId: WatchId,
  artifactSha256: Sha256, extractionSha256: Sha256, extractionVersion: Label, provisionEvidenceSha256: Sha256,
  definitions: z.array(Dependency).max(80), exceptions: z.array(Dependency).max(80), references: z.array(Dependency).max(80),
  amendments: z.array(Dependency).max(80), reviewDecisionId: WatchId, ruleVersion: Label,
}).strict().superRefine((value, context) => {
  for (const key of ["definitions", "exceptions", "references", "amendments"] as const) {
    if (new Set(value[key].map(item => item.id)).size !== value[key].length) context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Duplicate dependency identity" });
  }
});
export type InterpretationDependencies = z.infer<typeof InterpretationDependencies>;
export const AcceptedFactRecord = z.object({ id: WatchId, subjectId: WatchId, field: Label, value: z.unknown(),
  evidenceIds: EvidenceIds, evidenceDigests: z.array(z.object({ id: WatchId, sha256: Sha256 }).strict()).min(1).max(20),
  verification: z.object({ kind: z.enum(["source-rule", "human-review"]),
    ruleId: WatchId, ruleVersion: Label, verifierId: WatchId, verifiedAt: CanonicalInstant }),
  interpretationDependencies: InterpretationDependencies.nullable(),
}).superRefine((value, context) => {
  if (value.evidenceDigests.length !== value.evidenceIds.length ||
      new Set(value.evidenceDigests.map(evidence => evidence.id)).size !== value.evidenceIds.length ||
      value.evidenceDigests.some(evidence => !value.evidenceIds.includes(evidence.id))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["evidenceDigests"], message: "Every evidence ID needs exactly one immutable binding" });
  }
  try { if (new TextEncoder().encode(canonicalJson(value.value)).byteLength > 24_000) throw new Error(); } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "Fact must be bounded plain JSON" });
  }
});
export type AcceptedFactRecord = z.infer<typeof AcceptedFactRecord>;
// These records must be loaded from server-owned acceptance storage after the
// existing gates. Parsing a receipt or supplying an accepted flag is not authority.
export const SubjectAcceptance = z.object({ id: WatchId, subjectId: WatchId, kind: z.enum(["policy", "technology"]),
  subjectRevision: z.number().int().positive().safe(), draftSha256: Sha256, acceptedAt: CanonicalInstant, gateVersion: Label,
  factDigests: z.array(z.object({ id: WatchId, sha256: Sha256 }).strict()).min(1).max(80),
}).strict().refine(value => new Set(value.factDigests.map(fact => fact.id)).size === value.factDigests.length, "Duplicate accepted fact identity");
export type SubjectAcceptance = z.infer<typeof SubjectAcceptance>;
export async function acceptedFactDigest(input: unknown): Promise<string> {
  return sha256(canonicalJson(AcceptedFactRecord.parse(input)));
}

export const FactReference = z.union([z.object({ factId: WatchId }).strict(), z.object({ unavailableReason: Label }).strict()]);
const Slug = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).refine(value => value !== "updates", "Reserved route slug");
const DraftBase = { id: WatchId, slug: Slug, titleFactId: WatchId, subjectRevision: z.number().int().positive().safe() };
export const PolicyDossierDraft = z.object({ ...DraftBase, kind: z.literal("policy"), identityFactId: WatchId,
  lifecycle: FactReference, legalEffect: FactReference, latestAction: FactReference, topics: FactReference,
  summary: FactReference, interpretation: z.union([
    z.object({ factId: WatchId }).strict(),
    z.object({ readiness: InterpretationReadiness.exclude(["reviewed"]), reason: Label }).strict(),
  ]), timelineFactIds: z.array(WatchId).max(20),
}).strict();
export type PolicyDossierDraft = z.infer<typeof PolicyDossierDraft>;
export const TechnologyProfileDraft = z.object({ ...DraftBase, kind: z.literal("technology"), resourceTypeFactId: WatchId,
  purpose: FactReference, intendedUsers: FactReference, workflow: FactReference, setup: FactReference, limitations: FactReference,
  artifactFactIds: z.array(WatchId).min(1).max(12), relationshipFactIds: z.array(WatchId).min(1).max(20),
  licenseFactIds: z.array(WatchId).max(24),
}).strict();
export type TechnologyProfileDraft = z.infer<typeof TechnologyProfileDraft>;
export async function watchDraftDigest(input: unknown): Promise<string> {
  const draft = z.union([PolicyDossierDraft, TechnologyProfileDraft]).parse(input);
  return sha256(canonicalJson(draft));
}

export const PolicyAction = z.object({ id: WatchId, nativeCode: Label, text: Text, bodyId: WatchId,
  sourceOccurredAt: SourceDate, sourceOrder: z.number().int().nonnegative().safe().nullable() }).strict();
export const TechnologyWorkflow = z.object({ inputs: z.array(Label).max(20), steps: z.array(Text).min(1).max(12), outputs: z.array(Label).max(20) }).strict();
export const TechnologySetup = z.object({ verification: z.enum(["maintainer-documented", "desk-tested", "not-verified"]),
  version: Label.nullable(), prerequisites: z.array(Label).max(20).nullable(), guideUrl: HttpsUrl.nullable() }).strict().superRefine((value, context) => {
  if (value.verification !== "not-verified" && (!value.version || !value.guideUrl)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Documented or tested setup must identify its version and guide" });
});
export const TechnologyArtifact = z.object({ id: WatchId, resourceId: WatchId,
  artifactType: z.enum(["repository", "release", "paper", "dataset", "documentation", "product"]),
  host: Label, nativeId: Label, version: Label, url: HttpsUrl,
  availability: z.enum(["public", "restricted", "private-link", "unknown"]),
  sourceOccurredAt: SourceDate.optional() }).strict();
export type TechnologyArtifact = z.infer<typeof TechnologyArtifact>;
export const TechnologyRelationship = z.object({ id: WatchId, resourceId: WatchId, artifactId: WatchId,
  entityId: WatchId, entityName: Label, type: z.enum(["created-by", "maintained-by", "research-affiliation", "piloted-at", "used-at"]),
  temporalStatus: z.enum(["historical", "current", "observed"]), validFrom: CalendarDay.nullable(), validTo: CalendarDay.nullable(),
  checkedAt: CanonicalInstant, validThrough: CanonicalInstant.nullable(),
}).strict().superRefine((value, context) => {
  if (value.validFrom && value.validTo && value.validTo <= value.validFrom) context.addIssue({ code: z.ZodIssueCode.custom, path: ["validTo"], message: "Relationship period is half-open and must be increasing" });
  if (value.temporalStatus !== "historical" && (!value.validThrough || value.validThrough <= value.checkedAt || value.validTo)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["validThrough"], message: "Current relationship requires bounded fresh verification, not an unknown end alone" });
  if (value.temporalStatus === "observed" && (value.validFrom !== null || value.validTo !== null)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["validFrom"], message: "Observation does not establish a historical relationship period" });
});
export type TechnologyRelationship = z.infer<typeof TechnologyRelationship>;
export const TechnologyLicense = z.object({ artifactId: WatchId, artifactVersion: Label, scope: z.enum(["code", "data", "weights"]),
  classification: LicenseClassification, spdxId: Label.nullable(), licenseSha256: Sha256.nullable(),
  sourceUrl: HttpsUrl.nullable(), conditions: z.array(Text).max(12),
}).strict().superRefine((value, context) => {
  if (!["unknown", "not-applicable"].includes(value.classification) && (!value.licenseSha256 || !value.sourceUrl)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A known license classification requires reviewed bytes and a source" });
  }
  if (value.classification === "osi-open-source" && (!value.spdxId || !value.licenseSha256 || !value.sourceUrl)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Open-source classification requires reviewed SPDX, license bytes and source" });
});
export type TechnologyLicense = z.infer<typeof TechnologyLicense>;

export function PublicFact<T extends z.ZodTypeAny>(value: T) {
  return z.object({ value, evidenceIds: EvidenceIds, verifiedAt: CanonicalInstant }).strict();
}
export const PublicCitation = z.object({ id: WatchId, sourceId: WatchId, label: Label, url: HttpsUrl,
  quote: z.string().min(3).max(2000).nullable(), locator: Label.nullable() }).strict();
const UnknownField = z.object({ field: Label, reason: Label }).strict();
const PublicBase = { id: WatchId, slug: Slug, title: Label, verifiedAt: CanonicalInstant,
  sources: z.array(PublicCitation).min(1).max(20), unknowns: z.array(UnknownField).max(20) };
export const PublicPolicyDossier = z.object({ ...PublicBase, kind: z.literal("policy"), jurisdiction: WatchJurisdiction,
  lifecycle: PolicyLifecycle, legalEffect: PolicyLegalEffect, topics: z.array(Label).max(12).nullable(),
  identity: PublicFact(PolicyIdentity), summary: PublicFact(Text).nullable(), latestAction: PublicFact(PolicyAction).nullable(),
  lifecycleFact: PublicFact(PolicyLifecycle).nullable(), legalEffectFact: PublicFact(PolicyLegalEffect).nullable(),
  interpretation: z.object({ readiness: InterpretationReadiness, summary: PublicFact(Text).nullable(), reason: Label.nullable() }).strict(),
  timeline: z.array(PublicFact(PolicyAction)).max(20),
}).strict();
export type PublicPolicyDossier = z.infer<typeof PublicPolicyDossier>;
export const PublicTechnologyProfile = z.object({ ...PublicBase, kind: z.literal("technology"), resourceType: TechnologyResourceType,
  organizationIds: z.array(WatchId).min(1).max(20), licenseClassifications: z.array(LicenseClassification).max(5), oss: z.boolean(),
  purpose: PublicFact(Text).nullable(), intendedUsers: PublicFact(z.array(Label).max(20)).nullable(),
  workflow: PublicFact(TechnologyWorkflow).nullable(), setup: PublicFact(TechnologySetup).nullable(),
  limitations: PublicFact(z.array(Text).max(20)).nullable(), artifacts: z.array(PublicFact(TechnologyArtifact)).min(1).max(12),
  localRelationships: z.array(PublicFact(TechnologyRelationship)).min(1).max(20), licenses: z.array(PublicFact(TechnologyLicense)).max(24),
}).strict();
export type PublicTechnologyProfile = z.infer<typeof PublicTechnologyProfile>;
export const WatchPublicRecord = z.discriminatedUnion("kind", [PublicPolicyDossier, PublicTechnologyProfile]).refine(
  value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_PUBLIC_WATCH_BYTES, "Public Watch record exceeds byte limit");
export type WatchPublicRecord = z.infer<typeof WatchPublicRecord>;
