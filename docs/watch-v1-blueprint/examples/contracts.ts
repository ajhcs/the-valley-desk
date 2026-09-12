import { z } from "zod";

// Reference algorithms only. These do not replace publication or source-trust gates.
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const EvidenceIds = z.array(z.string().min(1)).min(1);
const CanonicalInstant = z.string().datetime().refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}, "Use a real canonical UTC ISO instant with milliseconds");

export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const SourceDate = z.discriminatedUnion("precision", [
  z.object({ precision: z.literal("instant"), value: CanonicalInstant, evidenceIds: EvidenceIds }).strict(),
  z.object({ precision: z.literal("day"), value: z.string().refine(isCalendarDay),
    timezone: z.literal("America/New_York"), evidenceIds: EvidenceIds }).strict(),
  z.object({ precision: z.literal("unknown"), reason: z.string().min(1) }).strict(),
]);
export type SourceDate = z.infer<typeof SourceDate>;

export async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function tupleKey(namespace: string, parts: readonly string[]): Promise<string> {
  z.string().min(1).parse(namespace);
  z.array(z.string().min(1)).min(1).parse(parts);
  return `${namespace}:${await sha256(JSON.stringify([1, namespace, ...parts]))}`;
}

export const PolicyIdentity = z.object({
  jurisdictionId: z.string().min(1),
  bodyId: z.string().min(1),
  sessionKey: z.string().min(1),
  instrumentType: z.enum(["bill", "resolution", "proposal-memo", "rule", "guidance", "ordinance"]),
  sourceInstrumentId: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.sessionKey === "standing" && ["bill", "resolution", "proposal-memo"].includes(value.instrumentType)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["sessionKey"],
      message: "Legislative records require a verified session" });
  }
});

export async function policyIdentityKey(input: unknown): Promise<string> {
  const value = PolicyIdentity.parse(input);
  return tupleKey("policy-v1", [value.jurisdictionId, value.bodyId, value.sessionKey,
    value.instrumentType, value.sourceInstrumentId]);
}

export const TextEvidence = z.object({
  observationId: z.string().min(1),
  sourceId: z.string().min(1),
  representationSha256: Sha256,
  normalizerVersion: z.string().min(1),
  quote: z.string().min(3),
}).strict();
export type TextEvidence = z.infer<typeof TextEvidence>;

export type StoredText = {
  id: string;
  sourceId: string;
  normalizerVersion: string;
  text: string;
};

export async function evidenceMatches(input: unknown, stored: StoredText): Promise<boolean> {
  const result = TextEvidence.safeParse(input);
  if (!result.success) return false;
  const evidence = result.data;
  return evidence.observationId === stored.id && evidence.sourceId === stored.sourceId
    && evidence.normalizerVersion === stored.normalizerVersion
    && evidence.representationSha256 === await sha256(stored.text)
    && stored.text.includes(evidence.quote);
}

const Dependencies = z.object({
  policyVersionId: z.string().min(1),
  artifactSha256: Sha256,
  extractionSha256: Sha256,
  provisionEvidenceSha256: Sha256,
  dependencySha256s: z.array(Sha256),
  ruleVersion: z.string().min(1),
}).strict().refine((value) => new Set(value.dependencySha256s).size === value.dependencySha256s.length,
  "Dependency hashes must be unique");
export type InterpretationDependencies = z.infer<typeof Dependencies>;

// Both values must come from authenticated, persisted review/evidence records.
export function interpretationApplies(reviewed: unknown, current: unknown): boolean {
  const left = Dependencies.safeParse(reviewed);
  const right = Dependencies.safeParse(current);
  if (!left.success || !right.success) return false;
  const normalized = (value: InterpretationDependencies) => JSON.stringify([
    value.policyVersionId, value.artifactSha256, value.extractionSha256,
    value.provisionEvidenceSha256, [...value.dependencySha256s].sort(), value.ruleVersion,
  ]);
  return normalized(left.data) === normalized(right.data);
}

export const Relationship = z.object({
  resourceId: z.string().min(1),
  entityId: z.string().min(1),
  type: z.enum(["created-by", "maintained-by", "research-affiliation", "piloted-at", "used-at"]),
  evidenceIds: EvidenceIds,
}).strict();
export type Relationship = z.infer<typeof Relationship>;

export type AcceptedRelationshipEvidence = {
  resourceId: string;
  entityId: string;
  relationshipType: Relationship["type"];
};

// Eligibility only: the map/set must be server-resolved accepted records. Publication
// additionally requires source grounding, temporal validity, licenses and editorial gates.
export function technologyEligible(input: {
  resourceId: string;
  healthcareRelevant: boolean;
  relationships: unknown[];
  regionalEntityIds: ReadonlySet<string>;
  acceptedEvidence: ReadonlyMap<string, AcceptedRelationshipEvidence>;
}): boolean {
  if (!input.healthcareRelevant) return false;
  return input.relationships.some((raw) => {
    const result = Relationship.safeParse(raw);
    if (!result.success) return false;
    const relationship = result.data;
    return relationship.resourceId === input.resourceId
      && input.regionalEntityIds.has(relationship.entityId)
      && relationship.evidenceIds.some((id) => {
        const evidence = input.acceptedEvidence.get(id);
        return evidence?.resourceId === input.resourceId
          && evidence.entityId === relationship.entityId
          && evidence.relationshipType === relationship.type;
      });
  });
}

export type LicenseAssessment = {
  classification: "osi-open-source" | "restricted-source" | "proprietary" | "unknown" | "not-applicable";
  artifactId: string;
  artifactVersion: string;
  reviewedLicenseHash: string | null;
};

// Input classification is from a reviewed license record, never a GitHub visibility flag.
export function includeInOssFilter(license: LicenseAssessment, currentLicenseHash: string | null): boolean {
  return license.classification === "osi-open-source"
    && currentLicenseHash !== null
    && Sha256.safeParse(currentLicenseHash).success
    && license.reviewedLicenseHash === currentLicenseHash;
}

export function includeInLatest(input: {
  baseline: boolean;
  material: boolean;
  publicAccepted: boolean;
  sourceDate: unknown;
}): boolean {
  const date = SourceDate.safeParse(input.sourceDate);
  return !input.baseline && input.material && input.publicAccepted
    && date.success && date.data.precision !== "unknown";
}

export const LEGACY_KINDS = new Set(["news", "event", "voice", "policy", "ai", "briefing", "interview"]);

// Kind filtering is only a first screen. Production must run the frozen full v1
// schema and delivery validator, including nested policy/event fields.
export function legacyKindSupported(kind: string): boolean {
  return LEGACY_KINDS.has(kind);
}
