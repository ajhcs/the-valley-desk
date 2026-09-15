import { z } from "zod";
import { AcceptedFactRecord, CanonicalInstant, EvidenceReference, InterpretationDependencies, MAX_PUBLIC_WATCH_BYTES, PolicyAction,
  PolicyDossierDraft, PolicyIdentity, PolicyLegalEffect, PolicyLifecycle, PublicPolicyDossier, PublicTechnologyProfile,
  SubjectAcceptance, TechnologyArtifact, TechnologyLicense, TechnologyProfileDraft, TechnologyRelationship,
  TechnologyResourceType, TechnologySetup, TechnologyWorkflow, acceptedFactDigest, canonicalJson,
  evidenceReferenceDigest, sha256, watchDraftDigest } from "./watch-schema";
import type { FactReference, PublicCitation } from "./watch-schema";

export type StoredObservation = {
  id: string; sourceId: string; sourceUrl: string; parserVersion: string; representation: string | Uint8Array;
  normalizedText?: string; normalizerVersion?: string;
  pdf?: { artifactSha256: string; extractionSha256: string; pageNumber: number; pageRenderSha256: string };
};
export type CurrentArtifact = {
  resourceId: string; version: string;
  licenseSha256s: { code: string | null; data: string | null; weights: string | null };
};
// This is a server-owned snapshot, not an HTTP request contract. Authentication,
// source enrollment and publication gates must precede its construction; the
// persistence transaction must recheck the current subject revision before commit.
export type WatchProjectionContext = {
  acceptance: unknown; currentSubjectRevision: number; asOf: string;
  facts: ReadonlyMap<string, unknown>; evidence: ReadonlyMap<string, unknown>;
  observations: ReadonlyMap<string, StoredObservation>; enrolledSourceIds: ReadonlySet<string>;
  sourceUrlAllowed: (sourceId: string, url: string) => boolean;
  publicUrlAllowed: (url: string) => boolean;
  regionalEntityIds: ReadonlySet<string>;
  currentInterpretations: ReadonlyMap<string, unknown>;
  currentArtifacts: ReadonlyMap<string, CurrentArtifact>;
};
export class WatchProjectionError extends Error {
  constructor(readonly code: string) { super(code); this.name = "WatchProjectionError"; }
}
const hold = (code: string): never => { throw new WatchProjectionError(code); };
const Text = z.string().min(1).max(6000).refine(value => value.trim() === value);
const Label = z.string().min(1).max(240).refine(value => value.trim() === value);
function boundedPublic<T>(value: T): T {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_PUBLIC_WATCH_BYTES) hold("public-record-byte-limit");
  return value;
}

function pointerValue(document: unknown, pointer: string): unknown {
  let value = document;
  for (const encoded of pointer.slice(1).split("/")) {
    const key = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined;
    if (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

// Literal/structured binding only. A matching quotation is not semantic review.
export async function evidenceMatches(input: unknown, stored: StoredObservation): Promise<boolean> {
  const parsed = EvidenceReference.safeParse(input);
  if (!parsed.success) return false;
  const evidence = parsed.data;
  try {
    if (evidence.observationId !== stored.id || evidence.sourceId !== stored.sourceId ||
        evidence.sourceUrl !== stored.sourceUrl || evidence.parserVersion !== stored.parserVersion ||
        evidence.representationSha256 !== await sha256(stored.representation)) return false;
    if (evidence.kind === "structured") {
      const text = typeof stored.representation === "string" ? stored.representation : new TextDecoder("utf-8", { fatal: true }).decode(stored.representation);
      return canonicalJson(pointerValue(JSON.parse(text), evidence.pointer)) === canonicalJson(JSON.parse(evidence.valueJson));
    }
    if (stored.normalizedText === undefined || evidence.normalizerVersion !== stored.normalizerVersion ||
        evidence.normalizedTextSha256 !== await sha256(stored.normalizedText) ||
        stored.normalizedText.slice(evidence.start, evidence.end) !== evidence.quote) return false;
    if (evidence.kind === "pdf") return Boolean(stored.pdf &&
      stored.pdf.artifactSha256 === evidence.artifactSha256 && stored.pdf.artifactSha256 === evidence.representationSha256 &&
      stored.pdf.extractionSha256 === evidence.extractionSha256 && stored.pdf.pageNumber === evidence.pageNumber &&
      stored.pdf.pageRenderSha256 === evidence.pageRenderSha256);
    return true;
  } catch { return false; }
}

export function interpretationApplies(reviewed: unknown, current: unknown): boolean {
  const left = InterpretationDependencies.safeParse(reviewed), right = InterpretationDependencies.safeParse(current);
  if (!left.success || !right.success) return false;
  const normalized = (value: InterpretationDependencies) => canonicalJson({
    instrumentId: value.instrumentId, policyVersionId: value.policyVersionId, artifactSha256: value.artifactSha256,
    extractionSha256: value.extractionSha256, extractionVersion: value.extractionVersion,
    provisionEvidenceSha256: value.provisionEvidenceSha256, reviewDecisionId: value.reviewDecisionId, ruleVersion: value.ruleVersion,
    definitions: [...value.definitions].sort((a, b) => a.id.localeCompare(b.id)),
    exceptions: [...value.exceptions].sort((a, b) => a.id.localeCompare(b.id)),
    references: [...value.references].sort((a, b) => a.id.localeCompare(b.id)),
    amendments: [...value.amendments].sort((a, b) => a.id.localeCompare(b.id)),
  });
  return normalized(left.data) === normalized(right.data);
}

function easternDay(instant: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}

// Values passed here must already be resolved accepted facts. This is an
// eligibility predicate, not a publication decision or a trust assignment.
export function technologyEligible(input: {
  resourceId: string; artifacts: readonly TechnologyArtifact[]; relationships: readonly TechnologyRelationship[];
  regionalEntityIds: ReadonlySet<string>; asOf: string;
}): boolean {
  if (!CanonicalInstant.safeParse(input.asOf).success) return false;
  const day = easternDay(input.asOf);
  return input.relationships.some(raw => {
    const parsed = TechnologyRelationship.safeParse(raw);
    if (!parsed.success) return false;
    const relation = parsed.data;
    return relation.resourceId === input.resourceId && input.regionalEntityIds.has(relation.entityId) &&
      input.artifacts.some(artifact => artifact.id === relation.artifactId && artifact.resourceId === input.resourceId) &&
      relation.checkedAt <= input.asOf && (!relation.validFrom || relation.validFrom <= day) &&
      (relation.temporalStatus === "historical" || Boolean(relation.validThrough && input.asOf < relation.validThrough));
  });
}

export function includeInOssFilter(input: unknown, artifact: TechnologyArtifact, current: CurrentArtifact | undefined): boolean {
  const parsed = TechnologyLicense.safeParse(input);
  if (!parsed.success || !current) return false;
  const license = parsed.data;
  return license.scope === "code" && license.classification === "osi-open-source" &&
    artifact.availability === "public" &&
    license.artifactId === artifact.id && license.artifactVersion === artifact.version && current.resourceId === artifact.resourceId &&
    current.version === artifact.version && license.licenseSha256 !== null && license.licenseSha256 === current.licenseSha256s.code;
}

type ProjectedFact<T> = { value: T; evidenceIds: string[]; verifiedAt: string };
class Projection {
  readonly sources = new Map<string, z.infer<typeof PublicCitation>>();
  readonly verifiedEvidence = new Map<string, EvidenceReference>();
  readonly unknowns: Array<{ field: string; reason: string }> = [];
  readonly usedFacts: AcceptedFactRecord[] = [];
  constructor(readonly context: WatchProjectionContext, readonly acceptance: SubjectAcceptance) {}

  static async start(draft: PolicyDossierDraft | TechnologyProfileDraft, context: WatchProjectionContext) {
    const result = SubjectAcceptance.safeParse(context.acceptance);
    if (!result.success || !CanonicalInstant.safeParse(context.asOf).success) return hold("accepted-snapshot-required");
    const acceptance = result.data;
    if (acceptance.subjectId !== draft.id || acceptance.kind !== draft.kind ||
        acceptance.subjectRevision !== draft.subjectRevision || context.currentSubjectRevision !== draft.subjectRevision ||
        acceptance.draftSha256 !== await watchDraftDigest(draft) || acceptance.acceptedAt > context.asOf) return hold("acceptance-binding-conflict");
    return new Projection(context, acceptance);
  }

  async fact(id: string, field: string): Promise<AcceptedFactRecord> {
    const parsed = AcceptedFactRecord.safeParse(this.context.facts.get(id));
    const result = parsed.success ? AcceptedFactRecord.safeParse(JSON.parse(canonicalJson(parsed.data))) : parsed;
    const bound = this.acceptance.factDigests.find(fact => fact.id === id);
    if (!result.success || !bound || result.data.id !== id || result.data.subjectId !== this.acceptance.subjectId ||
        result.data.field !== field || result.data.verification.verifiedAt > this.acceptance.acceptedAt ||
        bound.sha256 !== await acceptedFactDigest(result.data)) return hold("accepted-fact-binding-conflict");
    const fact = result.data;
    if (fact.interpretationDependencies && fact.interpretationDependencies.instrumentId !== fact.subjectId) return hold("interpretation-subject-conflict");
    for (const binding of fact.evidenceDigests) {
      const evidence = EvidenceReference.safeParse(this.context.evidence.get(binding.id));
      if (!evidence.success || evidence.data.id !== binding.id || binding.sha256 !== await evidenceReferenceDigest(evidence.data)) return hold("evidence-binding-conflict");
      const observed = this.context.observations.get(evidence.data.observationId);
      if (!observed || !this.context.enrolledSourceIds.has(evidence.data.sourceId) ||
          !this.context.sourceUrlAllowed(evidence.data.sourceId, evidence.data.sourceUrl) ||
          !this.context.publicUrlAllowed(evidence.data.sourceUrl) || !await evidenceMatches(evidence.data, observed)) return hold("evidence-unavailable-or-untrusted");
      this.verifiedEvidence.set(binding.id, evidence.data);
    }
    return fact;
  }

  current(fact: AcceptedFactRecord): boolean {
    return fact.interpretationDependencies === null || interpretationApplies(fact.interpretationDependencies, this.context.currentInterpretations.get(fact.id));
  }

  present<T>(fact: AcceptedFactRecord, value: T): ProjectedFact<T> {
    this.usedFacts.push(fact);
    for (const id of fact.evidenceIds) {
      const evidence = this.verifiedEvidence.get(id) ?? hold("evidence-not-resolved");
      this.sources.set(id, { id, sourceId: evidence.sourceId, label: evidence.sourceLabel, url: evidence.sourceUrl,
        quote: evidence.kind === "structured" ? null : evidence.quote,
        locator: evidence.kind === "structured" ? evidence.pointer : evidence.kind === "pdf" ? `Page ${evidence.pageNumber}` : null });
    }
    if (this.sources.size > 20) return hold("public-citation-limit");
    return { value, evidenceIds: [...fact.evidenceIds], verifiedAt: fact.verification.verifiedAt };
  }

  async required<T extends z.ZodTypeAny>(id: string, field: string, schema: T): Promise<ProjectedFact<z.infer<T>>> {
    const fact = await this.fact(id, field);
    if (!this.current(fact)) return hold("required-evidence-changed");
    return this.present(fact, schema.parse(fact.value));
  }

  async optional<T extends z.ZodTypeAny>(reference: z.infer<typeof FactReference>, field: string, schema: T): Promise<ProjectedFact<z.infer<T>> | null> {
    if ("unavailableReason" in reference) { this.unknowns.push({ field, reason: reference.unavailableReason }); return null; }
    const fact = await this.fact(reference.factId, field);
    if (!this.current(fact)) { this.unknowns.push({ field, reason: "Evidence changed; this field awaits review." }); return null; }
    return this.present(fact, schema.parse(fact.value));
  }

  verifiedAt(): string {
    // The oldest contributing verification is conservative; acceptance/check time
    // must not make a collection of older facts look newly verified.
    return this.usedFacts.map(fact => fact.verification.verifiedAt).sort()[0] ?? hold("no-public-facts");
  }

  checkUrl(url: string | null) { if (url && !this.context.publicUrlAllowed(url)) hold("public-link-not-enrolled"); }
}

function actionDatesBound(fact: ProjectedFact<z.infer<typeof PolicyAction>> | null) {
  if (fact && fact.value.sourceOccurredAt.precision !== "unknown" && fact.value.sourceOccurredAt.evidenceIds.some(id => !fact.evidenceIds.includes(id))) hold("date-evidence-not-bound");
}

export async function projectPolicyDossier(input: unknown, context: WatchProjectionContext): Promise<PublicPolicyDossier> {
  const draft = PolicyDossierDraft.parse(input), projection = await Projection.start(draft, context);
  const title = await projection.required(draft.titleFactId, "title", Label);
  const identity = await projection.required(draft.identityFactId, "policy-identity", PolicyIdentity);
  const lifecycle = await projection.optional(draft.lifecycle, "lifecycle", PolicyLifecycle);
  const legalEffect = await projection.optional(draft.legalEffect, "legal-effect", PolicyLegalEffect);
  const topics = await projection.optional(draft.topics, "topics", z.array(Label).max(12));
  const summary = await projection.optional(draft.summary, "summary", Text);
  const latestAction = await projection.optional(draft.latestAction, "latest-action", PolicyAction);
  actionDatesBound(latestAction);
  let interpretation: PublicPolicyDossier["interpretation"];
  if ("factId" in draft.interpretation) {
    const fact = await projection.fact(draft.interpretation.factId, "interpretation");
    if (!fact.interpretationDependencies || fact.verification.kind !== "human-review") return hold("interpretation-review-required");
    interpretation = projection.current(fact)
      ? { readiness: "reviewed", summary: projection.present(fact, Text.parse(fact.value)), reason: null }
      : { readiness: "evidence-changed", summary: null, reason: "Evidence changed; the prior interpretation is historical and awaits review." };
  } else interpretation = { readiness: draft.interpretation.readiness, summary: null, reason: draft.interpretation.reason };
  const timeline = [];
  for (const id of draft.timelineFactIds) {
    const action = await projection.required(id, "timeline-action", PolicyAction);
    actionDatesBound(action); timeline.push(action);
  }
  return boundedPublic(PublicPolicyDossier.parse({ kind: "policy", id: draft.id, slug: draft.slug, title: title.value,
    verifiedAt: projection.verifiedAt(), sources: [...projection.sources.values()], unknowns: projection.unknowns,
    jurisdiction: identity.value.jurisdiction, identity, lifecycle: lifecycle?.value ?? "unknown", lifecycleFact: lifecycle,
    legalEffect: legalEffect?.value ?? "unknown", legalEffectFact: legalEffect, topics: topics?.value ?? null,
    summary, latestAction, interpretation, timeline }));
}

export async function projectTechnologyProfile(input: unknown, context: WatchProjectionContext): Promise<PublicTechnologyProfile> {
  const draft = TechnologyProfileDraft.parse(input), projection = await Projection.start(draft, context);
  const title = await projection.required(draft.titleFactId, "title", Label);
  const resourceType = await projection.required(draft.resourceTypeFactId, "resource-type", TechnologyResourceType);
  const purpose = await projection.optional(draft.purpose, "purpose", Text);
  const intendedUsers = await projection.optional(draft.intendedUsers, "intended-users", z.array(Label).max(20));
  const workflow = await projection.optional(draft.workflow, "workflow", TechnologyWorkflow);
  const setup = await projection.optional(draft.setup, "setup", TechnologySetup);
  const limitations = await projection.optional(draft.limitations, "limitations", z.array(Text).max(20));
  projection.checkUrl(setup?.value.guideUrl ?? null);
  const artifacts: Array<ProjectedFact<TechnologyArtifact>> = [];
  for (const id of draft.artifactFactIds) {
    const artifact = await projection.required(id, "artifact", TechnologyArtifact);
    const sourceDate = artifact.value.sourceOccurredAt;
    if (sourceDate && sourceDate.precision !== "unknown" && sourceDate.evidenceIds.some(id => !artifact.evidenceIds.includes(id))) {
      return hold("date-evidence-not-bound");
    }
    const current = context.currentArtifacts.get(artifact.value.id);
    if (artifact.value.resourceId !== draft.id || !current || current.resourceId !== draft.id || current.version !== artifact.value.version ||
        new URL(artifact.value.url).hostname !== artifact.value.host) return hold("artifact-binding-conflict");
    projection.checkUrl(artifact.value.url); artifacts.push(artifact);
  }
  if (new Set(artifacts.map(artifact => artifact.value.id)).size !== artifacts.length) return hold("duplicate-artifact");
  const localRelationships = [];
  for (const id of draft.relationshipFactIds) {
    const fact = await projection.fact(id, "local-relationship"), relation = TechnologyRelationship.parse(fact.value);
    if (!projection.current(fact)) return hold("relationship-evidence-changed");
    if (!technologyEligible({ resourceId: draft.id, artifacts: artifacts.map(artifact => artifact.value),
      relationships: [relation], regionalEntityIds: context.regionalEntityIds, asOf: context.asOf })) return hold("verified-local-artifact-relationship-required");
    localRelationships.push(projection.present(fact, relation));
  }
  if (new Set(localRelationships.map(relation => relation.value.id)).size !== localRelationships.length) return hold("duplicate-relationship");
  const licenses = [];
  const seenLicenses = new Set<string>();
  for (const id of draft.licenseFactIds) {
    const fact = await projection.fact(id, "license"), license = TechnologyLicense.parse(fact.value);
    const artifact = artifacts.find(item => item.value.id === license.artifactId)?.value;
    const current = context.currentArtifacts.get(license.artifactId);
    if (!artifact || license.artifactVersion !== artifact.version || !current) return hold("license-artifact-conflict");
    const key = `${license.artifactId}:${license.scope}`;
    if (seenLicenses.has(key)) return hold("conflicting-license-assessments");
    seenLicenses.add(key);
    if (!projection.current(fact) || license.licenseSha256 !== current.licenseSha256s[license.scope]) {
      projection.unknowns.push({ field: `license:${license.artifactId}:${license.scope}`, reason: "License evidence changed; classification awaits review." });
      continue;
    }
    const pinnedNativeLicenseRule = fact.verification.kind === "source-rule" &&
      fact.verification.ruleId === "watch-native-source-rule-v1" && fact.verification.ruleVersion === "1";
    if (license.classification !== "unknown" && license.classification !== "not-applicable" &&
      fact.verification.kind !== "human-review" && !pinnedNativeLicenseRule) return hold("license-review-required");
    projection.checkUrl(license.sourceUrl); licenses.push(projection.present(fact, license));
  }
  const oss = licenses.some(license => {
    const artifact = artifacts.find(item => item.value.id === license.value.artifactId)!.value;
    return includeInOssFilter(license.value, artifact, context.currentArtifacts.get(artifact.id));
  });
  for (const artifact of artifacts) {
    if (["repository", "release"].includes(artifact.value.artifactType) && !licenses.some(license => license.value.artifactId === artifact.value.id && license.value.scope === "code") &&
        !projection.unknowns.some(item => item.field === `license:${artifact.value.id}:code`)) {
      projection.unknowns.push({ field: `license:${artifact.value.id}:code`, reason: "No current accepted code-license assessment is available." });
    }
  }
  const licenseClassifications = [...new Set(licenses.map(license => license.value.classification))];
  if (projection.unknowns.some(item => item.field.startsWith("license:")) && !licenseClassifications.includes("unknown")) licenseClassifications.push("unknown");
  return boundedPublic(PublicTechnologyProfile.parse({ kind: "technology", id: draft.id, slug: draft.slug, title: title.value,
    verifiedAt: projection.verifiedAt(), sources: [...projection.sources.values()], unknowns: projection.unknowns,
    resourceType: resourceType.value, organizationIds: [...new Set(localRelationships.map(relation => relation.value.entityId))],
    licenseClassifications, oss,
    purpose, intendedUsers, workflow, setup, limitations, artifacts, localRelationships, licenses }));
}
