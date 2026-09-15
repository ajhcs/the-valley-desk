import { z } from "zod";
import { AcceptedFactRecord, CalendarDay, CanonicalInstant, EvidenceIds, EvidenceReference, InterpretationDependencies,
  PolicyDossierDraft, Sha256, SubjectAcceptance, TechnologyProfileDraft, WatchId, WatchPublicRecord,
  acceptedFactDigest, canonicalJson, evidenceReferenceDigest, sha256, tupleKey } from "./watch-schema";
import { evidenceMatches, projectPolicyDossier, projectTechnologyProfile } from "./watch-projection";
import type { WatchProjectionContext } from "./watch-projection";

export const DeliveryDependencyKind = z.enum(["accepted-fact", "evidence", "source-permission", "verification-rule",
  "policy-interpretation", "policy-definition", "policy-exception", "policy-reference", "policy-amendment",
  "artifact", "artifact-license", "local-relationship", "regional-current", "regional-historical"]);
export type DeliveryDependencyKind = z.infer<typeof DeliveryDependencyKind>;
const Field = z.enum(["title", "identity", "lifecycle", "legal-effect", "topics", "summary", "latest-action", "interpretation", "timeline-action",
  "resource-type", "purpose", "intended-users", "workflow", "setup", "limitations", "artifact", "local-relationship", "license"]);
const Dependency = z.object({ key: WatchId, kind: DeliveryDependencyKind, expectedDigest: Sha256 }).strict();
const Local = z.object({ artifactId: WatchId, entityId: WatchId, relationshipId: WatchId,
  temporalStatus: z.enum(["current", "historical", "observed"]), checkedAt: CanonicalInstant, validFrom: CalendarDay.nullable(),
  validThrough: CanonicalInstant.nullable() }).strict();
const License = z.object({ artifactId: WatchId, artifactVersion: z.string().min(1).max(240),
  scope: z.enum(["code", "data", "weights"]), classification: z.enum(["osi-open-source", "restricted-source", "proprietary", "unknown", "not-applicable"]),
  licenseSha256: Sha256.nullable() }).strict();
const RegionalTerm = z.object({ factId: WatchId, factDigest: Sha256, validFrom: CalendarDay, validTo: CalendarDay.nullable() }).strict();
export const DeliveryGroup = z.object({ key: WatchId, field: Field,
  groupType: z.enum(["required", "optional", "artifact", "local", "license"]), factId: WatchId, factDigest: Sha256,
  valueDigest: Sha256, citationIds: EvidenceIds,
  dependencies: z.array(Dependency).min(1).max(400),
  artifact: z.object({ id: WatchId, version: z.string().min(1).max(240), availability: z.enum(["public", "restricted", "private-link", "unknown"]) }).strict().nullable(),
  local: Local.nullable(), license: License.nullable(), regionalTerm: RegionalTerm.nullable(),
}).strict().superRefine((group, context) => {
  if (new Set(group.dependencies.map(dependency => dependency.key)).size !== group.dependencies.length)
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate group dependency" });
  if ((group.field === "artifact") !== (group.groupType === "artifact" && group.artifact !== null) ||
      (group.field === "local-relationship") !== (group.groupType === "local" && group.local !== null) ||
      (group.field === "license") !== (group.groupType === "license" && group.license !== null) ||
      (group.field === "local-relationship") !== (group.regionalTerm !== null))
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Group metadata must match its finite field" });
});
export type DeliveryGroup = z.infer<typeof DeliveryGroup>;
export const WATCH_DELIVERY_MANIFEST_BYTES = 512_000;
export const WatchDeliveryManifest = z.object({ version: z.literal("watch-delivery-1"), subjectId: WatchId,
  kind: z.enum(["policy", "technology"]), inputRevision: z.number().int().positive().safe(),
  payloadSha256: Sha256, gateVersion: z.string().min(1).max(240), acceptedAt: CanonicalInstant,
  groups: z.array(DeliveryGroup).min(2).max(100),
}).strict().superRefine((manifest, context) => {
  if (new Set(manifest.groups.map(group => group.key)).size !== manifest.groups.length ||
      new TextEncoder().encode(canonicalJson(manifest)).byteLength > WATCH_DELIVERY_MANIFEST_BYTES)
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Manifest identity or byte bound violated" });
  for (const field of ["title", manifest.kind === "policy" ? "identity" : "resource-type"]) {
    if (manifest.groups.filter(group => group.field === field && group.groupType === "required").length !== 1)
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Required metadata group missing or duplicated" });
  }
  if (manifest.kind === "technology" && (!manifest.groups.some(group => group.groupType === "artifact") || !manifest.groups.some(group => group.groupType === "local")))
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Technology requires artifact and regional groups" });
});
export type WatchDeliveryManifest = z.infer<typeof WatchDeliveryManifest>;
export const RegionalEligibility = z.object({ relationshipId: WatchId, entityId: WatchId,
  geography: z.literal("delaware-valley"), temporalStatus: z.enum(["current", "historical", "observed"]),
  asOfDay: CalendarDay, validFrom: CalendarDay, validTo: CalendarDay.nullable() }).strict().refine(
  value => value.validFrom <= value.asOfDay && (value.validTo === null || value.asOfDay < value.validTo) &&
    (value.temporalStatus !== "observed" || (value.validFrom === value.asOfDay && value.validTo !== null)),
  "Region-at-time evidence must cover its asserted day; observation requires a bounded observation window");
function regionalHeadValue(value: z.infer<typeof RegionalEligibility>) {
  const { relationshipId: _relationship, asOfDay, ...membership } = value;
  // Current membership is shared across resources with different check dates.
  return value.temporalStatus === "current" ? membership : { ...membership, asOfDay };
}

// These are server-resolved approved source-policy digests and extra accepted
// regional facts, not request flags. No live resolver or review authorization is provided.
export type WatchDeliveryCompileContext = WatchProjectionContext & {
  sourcePermissionDigests: ReadonlyMap<string, string>;
  regionalFactIds: ReadonlyMap<string, string>;
};
export class WatchDeliveryError extends Error {
  constructor(readonly code: string) { super(code); this.name = "WatchDeliveryError"; }
}
const hold = (code: string): never => { throw new WatchDeliveryError(code); };
export async function deliveryDependencyKey(kind: DeliveryDependencyKind, identity: readonly string[]): Promise<string> {
  DeliveryDependencyKind.parse(kind);
  return tupleKey("watch-dependency-v1", [kind, ...identity]);
}
export function deliveryEasternDay(instant: string): string {
  CanonicalInstant.parse(instant);
  const parts = new Intl.DateTimeFormat("en", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}
export async function verificationRuleDigest(ruleId: string, ruleVersion: string) {
  return sha256(canonicalJson({ ruleId, ruleVersion }));
}
declare const compiledBrand: unique symbol;
export type CompiledWatchDelivery = { readonly [compiledBrand]: true };
const compiled = new WeakMap<CompiledWatchDelivery, { manifest: WatchDeliveryManifest; record: WatchPublicRecord }>();
export function compiledWatchDeliveryValue(value: CompiledWatchDelivery) {
  const found = compiled.get(value) ?? hold("server-compiled-delivery-required");
  return { manifest: WatchDeliveryManifest.parse(JSON.parse(canonicalJson(found.manifest))),
    record: WatchPublicRecord.parse(JSON.parse(canonicalJson(found.record))) };
}

export async function compileWatchDelivery(input: unknown, context: WatchDeliveryCompileContext): Promise<CompiledWatchDelivery> {
  const draft = z.union([PolicyDossierDraft, TechnologyProfileDraft]).parse(input);
  const record = draft.kind === "policy" ? await projectPolicyDossier(draft, context) : await projectTechnologyProfile(draft, context);
  const acceptance = SubjectAcceptance.parse(context.acceptance);
  const groups: DeliveryGroup[] = [];
  async function fact(id: string): Promise<AcceptedFactRecord> {
    const value = AcceptedFactRecord.parse(context.facts.get(id));
    if (value.id !== id || value.subjectId !== draft.id || value.verification.verifiedAt > acceptance.acceptedAt ||
        acceptance.factDigests.find(binding => binding.id === id)?.sha256 !== await acceptedFactDigest(value)) return hold("delivery-fact-binding-conflict");
    return value;
  }
  async function dependencies(value: AcceptedFactRecord): Promise<z.infer<typeof Dependency>[]> {
    const result = new Map<string, z.infer<typeof Dependency>>();
    const add = async (kind: DeliveryDependencyKind, identity: string[], expectedDigest: string) => {
      const key = await deliveryDependencyKey(kind, identity); result.set(key, Dependency.parse({ key, kind, expectedDigest }));
    };
    const digest = await acceptedFactDigest(value);
    await add("accepted-fact", [value.id, digest], digest);
    await add("verification-rule", [value.verification.ruleId], await verificationRuleDigest(value.verification.ruleId, value.verification.ruleVersion));
    for (const binding of value.evidenceDigests) {
      const evidence = EvidenceReference.parse(context.evidence.get(binding.id));
      const observation = context.observations.get(evidence.observationId);
      if (evidence.id !== binding.id || await evidenceReferenceDigest(evidence) !== binding.sha256 || !observation ||
          !context.enrolledSourceIds.has(evidence.sourceId) || !context.sourceUrlAllowed(evidence.sourceId, evidence.sourceUrl) ||
          !context.publicUrlAllowed(evidence.sourceUrl) || !await evidenceMatches(evidence, observation)) return hold("delivery-evidence-binding-conflict");
      await add("evidence", [evidence.id, binding.sha256], binding.sha256);
      const permission = context.sourcePermissionDigests.get(evidence.sourceId);
      if (!permission) return hold("delivery-source-permission-required");
      await add("source-permission", [evidence.sourceId], Sha256.parse(permission));
    }
    if (value.interpretationDependencies) {
      const frame = InterpretationDependencies.parse(value.interpretationDependencies);
      await add("policy-interpretation", [draft.id, value.id], await sha256(canonicalJson(frame)));
      for (const [field, kind] of [["definitions", "policy-definition"], ["exceptions", "policy-exception"], ["references", "policy-reference"], ["amendments", "policy-amendment"]] as const)
        for (const dependency of frame[field]) await add(kind, [draft.id, dependency.id], dependency.sha256);
    }
    return [...result.values()];
  }
  async function group(id: string, field: z.infer<typeof Field>, groupType: DeliveryGroup["groupType"], publicValue: unknown) {
    const value = await fact(id);
    const result: DeliveryGroup = { key: await tupleKey("watch-group-v1", [field, id]), field, groupType, factId: id,
      factDigest: await acceptedFactDigest(value), valueDigest: await sha256(canonicalJson(publicValue)), citationIds: [...value.evidenceIds],
      dependencies: await dependencies(value), artifact: null, local: null, license: null, regionalTerm: null };
    groups.push(result); return result;
  }
  const extra = async (group: DeliveryGroup, kind: DeliveryDependencyKind, identity: string[], value: unknown) => {
    group.dependencies.push({ key: await deliveryDependencyKey(kind, identity), kind, expectedDigest: await sha256(canonicalJson(value)) });
  };
  await group(draft.titleFactId, "title", "required", record.title);
  if (draft.kind === "policy" && record.kind === "policy") {
    await group(draft.identityFactId, "identity", "required", record.identity);
    for (const [field, reference, value] of [
      ["lifecycle", draft.lifecycle, record.lifecycleFact], ["legal-effect", draft.legalEffect, record.legalEffectFact],
      ["topics", draft.topics, record.topics], ["summary", draft.summary, record.summary], ["latest-action", draft.latestAction, record.latestAction],
      ["interpretation", draft.interpretation, record.interpretation.summary],
    ] as const) if (value !== null && "factId" in reference) await group(reference.factId, field, "optional", value);
    for (let index = 0; index < draft.timelineFactIds.length; index++) await group(draft.timelineFactIds[index]!, "timeline-action", "optional", record.timeline[index]);
  } else if (draft.kind === "technology" && record.kind === "technology") {
    await group(draft.resourceTypeFactId, "resource-type", "required", record.resourceType);
    for (const [field, reference, value] of [
      ["purpose", draft.purpose, record.purpose], ["intended-users", draft.intendedUsers, record.intendedUsers], ["workflow", draft.workflow, record.workflow],
      ["setup", draft.setup, record.setup], ["limitations", draft.limitations, record.limitations],
    ] as const) if (value !== null && "factId" in reference) await group(reference.factId, field, "optional", value);
    for (let index = 0; index < record.artifacts.length; index++) {
      const publicFact = record.artifacts[index]!, artifact = publicFact.value;
      const item = await group(draft.artifactFactIds[index]!, "artifact", "artifact", publicFact);
      item.artifact = { id: artifact.id, version: artifact.version, availability: artifact.availability };
      await extra(item, "artifact", [artifact.id], artifact);
    }
    for (let index = 0; index < record.localRelationships.length; index++) {
      const publicFact = record.localRelationships[index]!, relation = publicFact.value;
      const item = await group(draft.relationshipFactIds[index]!, "local-relationship", "local", publicFact);
      item.local = { artifactId: relation.artifactId, entityId: relation.entityId, relationshipId: relation.id,
        temporalStatus: relation.temporalStatus, checkedAt: relation.checkedAt, validFrom: relation.validFrom, validThrough: relation.validThrough };
      await extra(item, "local-relationship", [relation.id], relation);
      const regionalId = context.regionalFactIds.get(relation.id);
      if (!regionalId) return hold("delivery-regional-provenance-required");
      const regional = await fact(regionalId), eligibility = RegionalEligibility.parse(regional.value);
      const approvedRule = regional.verification.kind === "source-rule" &&
        regional.verification.ruleId === "watch-native-source-rule-v1" && regional.verification.ruleVersion === "1" &&
        eligibility.temporalStatus === "observed";
      if (regional.field !== "regional-eligibility" || (regional.verification.kind !== "human-review" && !approvedRule) ||
          eligibility.relationshipId !== relation.id || eligibility.entityId !== relation.entityId || eligibility.temporalStatus !== relation.temporalStatus ||
          (relation.temporalStatus === "historical" && (!relation.validFrom || eligibility.asOfDay !== relation.validFrom)) ||
          (relation.temporalStatus !== "historical" && eligibility.asOfDay !== deliveryEasternDay(relation.checkedAt)) ||
          regional.evidenceIds.some(id => !publicFact.evidenceIds.includes(id))) return hold("delivery-regional-provenance-conflict");
      const regionalDigest = await acceptedFactDigest(regional);
      item.regionalTerm = { factId: regional.id, factDigest: regionalDigest, validFrom: eligibility.validFrom, validTo: eligibility.validTo };
      item.dependencies.push(...await dependencies(regional));
      await extra(item, relation.temporalStatus === "current" ? "regional-current" : "regional-historical",
        relation.temporalStatus === "current" ? [relation.entityId] : [relation.entityId, regional.id, regionalDigest], regionalHeadValue(eligibility));
      item.dependencies = [...new Map(item.dependencies.map(dependency => [dependency.key, dependency])).values()];
    }
    for (const publicFact of record.licenses) {
      const value = publicFact.value;
      const id = draft.licenseFactIds.find(id => canonicalJson(AcceptedFactRecord.parse(context.facts.get(id)).value) === canonicalJson(value));
      if (!id) return hold("delivery-license-fact-required");
      const item = await group(id, "license", "license", publicFact);
      item.license = { artifactId: value.artifactId, artifactVersion: value.artifactVersion, scope: value.scope,
        classification: value.classification, licenseSha256: value.licenseSha256 };
      await extra(item, "artifact-license", [value.artifactId, value.scope], { artifactId: value.artifactId,
        artifactVersion: value.artifactVersion, scope: value.scope, licenseSha256: value.licenseSha256 });
    }
  }
  const manifest = WatchDeliveryManifest.parse({ version: "watch-delivery-1", subjectId: record.id, kind: record.kind,
    inputRevision: draft.subjectRevision, payloadSha256: await sha256(canonicalJson(record)), gateVersion: acceptance.gateVersion,
    acceptedAt: acceptance.acceptedAt, groups });
  const handle = Object.freeze({}) as CompiledWatchDelivery; compiled.set(handle, { manifest, record }); return handle;
}

function valuesByGroup(record: WatchPublicRecord, manifest: WatchDeliveryManifest): unknown[] {
  const counts = new Map<string, number>();
  return manifest.groups.map(group => {
    const index = counts.get(group.field) ?? 0; counts.set(group.field, index + 1);
    if (group.field === "title") return record.title;
    if (record.kind === "policy") {
      const fields = { identity: record.identity, lifecycle: record.lifecycleFact, "legal-effect": record.legalEffectFact,
        topics: record.topics, summary: record.summary, "latest-action": record.latestAction, interpretation: record.interpretation.summary,
        "timeline-action": record.timeline[index] };
      return fields[group.field as keyof typeof fields] ?? null;
    }
    const fields = { "resource-type": record.resourceType, purpose: record.purpose, "intended-users": record.intendedUsers,
      workflow: record.workflow, setup: record.setup, limitations: record.limitations, artifact: record.artifacts[index],
      "local-relationship": record.localRelationships[index], license: record.licenses[index] };
    return fields[group.field as keyof typeof fields] ?? null;
  });
}
export async function validateDeliveryBinding(record: WatchPublicRecord, manifestInput: unknown) {
  const manifest = WatchDeliveryManifest.parse(manifestInput);
  if (manifest.subjectId !== record.id || manifest.kind !== record.kind || manifest.payloadSha256 !== await sha256(canonicalJson(record))) return hold("delivery-payload-binding-conflict");
  const present = (value: unknown) => value === null ? 0 : 1;
  const expected: Record<string, number> = record.kind === "policy" ? {
    title: 1, identity: 1, lifecycle: present(record.lifecycleFact), "legal-effect": present(record.legalEffectFact),
    topics: present(record.topics), summary: present(record.summary), "latest-action": present(record.latestAction),
    interpretation: present(record.interpretation.summary), "timeline-action": record.timeline.length,
  } : { title: 1, "resource-type": 1, purpose: present(record.purpose), "intended-users": present(record.intendedUsers),
    workflow: present(record.workflow), setup: present(record.setup), limitations: present(record.limitations),
    artifact: record.artifacts.length, "local-relationship": record.localRelationships.length, license: record.licenses.length };
  const actual = new Map<string, number>();
  for (const group of manifest.groups) {
    actual.set(group.field, (actual.get(group.field) ?? 0) + 1);
    const type = ["title", "identity", "resource-type"].includes(group.field) ? "required" :
      group.field === "artifact" ? "artifact" : group.field === "local-relationship" ? "local" : group.field === "license" ? "license" : "optional";
    if (!(group.field in expected) || group.groupType !== type) return hold("delivery-group-coverage-conflict");
  }
  if (Object.entries(expected).some(([field, count]) => (actual.get(field) ?? 0) !== count)) return hold("delivery-group-coverage-conflict");
  const citations = new Set(record.sources.map(source => source.id));
  const values = valuesByGroup(record, manifest);
  for (let index = 0; index < manifest.groups.length; index++) {
    const group = manifest.groups[index]!, value = values[index];
    const factKey = await deliveryDependencyKey("accepted-fact", [group.factId, group.factDigest]);
    if (!group.dependencies.some(dependency => dependency.kind === "accepted-fact" && dependency.key === factKey && dependency.expectedDigest === group.factDigest))
      return hold("delivery-fact-binding-conflict");
    for (const citationId of group.citationIds) {
      const citation = record.sources.find(source => source.id === citationId);
      const evidenceBindings = await Promise.all(group.dependencies.filter(dependency => dependency.kind === "evidence")
        .map(async dependency => dependency.key === await deliveryDependencyKey("evidence", [citationId, dependency.expectedDigest])));
      const permissionKey = citation ? await deliveryDependencyKey("source-permission", [citation.sourceId]) : null;
      if (!citation || !evidenceBindings.some(Boolean) || !group.dependencies.some(dependency => dependency.kind === "source-permission" &&
          dependency.key === permissionKey))
        return hold("delivery-citation-binding-conflict");
    }
    if (value === null || group.valueDigest !== await sha256(canonicalJson(value)) || group.citationIds.some(id => !citations.has(id))) return hold("delivery-group-binding-conflict");
    if (value && typeof value === "object" && "evidenceIds" in value &&
        canonicalJson(group.citationIds) !== canonicalJson((value as { evidenceIds: string[] }).evidenceIds)) return hold("delivery-citation-binding-conflict");
    const fact = value as { value: Record<string, unknown> };
    const metadata = group.artifact ?? group.local ?? group.license;
    if (metadata) {
      const bound: Record<string, unknown> = {};
      for (const key of Object.keys(metadata)) bound[key] = fact.value[key === "relationshipId" ? "id" : key];
      if (canonicalJson(bound) !== canonicalJson(metadata)) return hold("delivery-filter-binding-conflict");
    }
    if (group.local && group.regionalTerm) {
      const local = group.local, term = group.regionalTerm;
      const regionalDigest = await sha256(canonicalJson(regionalHeadValue(RegionalEligibility.parse({ relationshipId: local.relationshipId,
        entityId: local.entityId, geography: "delaware-valley", temporalStatus: local.temporalStatus,
        asOfDay: local.temporalStatus !== "historical" ? deliveryEasternDay(local.checkedAt) : local.validFrom, validFrom: term.validFrom, validTo: term.validTo }))));
      const regionalKind = local.temporalStatus === "current" ? "regional-current" : "regional-historical";
      const regionalKey = await deliveryDependencyKey(regionalKind,
        local.temporalStatus === "current" ? [local.entityId] : [local.entityId, term.factId, term.factDigest]);
      const regionalFactKey = await deliveryDependencyKey("accepted-fact", [term.factId, term.factDigest]);
      if (!group.dependencies.some(dependency => dependency.kind === regionalKind && dependency.key === regionalKey && dependency.expectedDigest === regionalDigest) ||
          !group.dependencies.some(dependency => dependency.kind === "accepted-fact" && dependency.key === regionalFactKey && dependency.expectedDigest === term.factDigest))
        return hold("delivery-regional-provenance-conflict");
    }
  }
  return manifest;
}

export async function shapeWatchDelivery(record: WatchPublicRecord, input: unknown, validity: ReadonlyMap<string, boolean>, deliveryAsOf: string): Promise<WatchPublicRecord | null> {
  CanonicalInstant.parse(deliveryAsOf);
  const manifest = await validateDeliveryBinding(record, input);
  if (validity.size !== manifest.groups.length || manifest.groups.some(group => !validity.has(group.key))) return hold("delivery-validity-incomplete");
  const valid = (group: DeliveryGroup) => validity.get(group.key) === true && (!group.local ||
    (group.local.checkedAt <= deliveryAsOf && (!group.local.validFrom || group.local.validFrom <= deliveryEasternDay(deliveryAsOf)) &&
      (group.local.temporalStatus === "historical" || Boolean(group.local.validThrough && deliveryAsOf < group.local.validThrough &&
        group.regionalTerm && group.regionalTerm.validFrom <= deliveryEasternDay(deliveryAsOf) &&
        (!group.regionalTerm.validTo || deliveryEasternDay(deliveryAsOf) < group.regionalTerm.validTo)))));
  if (manifest.groups.some(group => ["required", "artifact"].includes(group.groupType) && !valid(group))) return null;
  const isValid = (field: string) => manifest.groups.some(group => group.field === field && valid(group));
  const groupsFor = (field: string) => manifest.groups.filter(group => group.field === field);
  const unknowns = record.unknowns.map(value => ({ field: value.field, reason: value.reason }));
  const unknown = (field: string) => { if (!unknowns.some(value => value.field === field)) unknowns.push({ field, reason: "Accepted evidence changed or expired; this field awaits review." }); };
  for (const group of manifest.groups) if (!valid(group)) unknown(group.license ? `license:${group.license.artifactId}:${group.license.scope}` : group.field);
  const citationIds = new Set(manifest.groups.filter(valid).flatMap(group => group.citationIds));
  const sources = record.sources.filter(source => citationIds.has(source.id)).map(source => ({ id: source.id, sourceId: source.sourceId,
    label: source.label, url: source.url, quote: source.quote, locator: source.locator }));
  const base = { id: record.id, slug: record.slug, title: record.title, verifiedAt: record.verifiedAt, sources,
    unknowns: unknowns.length <= 20 ? unknowns : [...unknowns.slice(0, 19), { field: "delivery", reason: "Additional evidence-bound fields are held for review." }] };
  if (record.kind === "policy") {
    return WatchPublicRecord.parse({ ...base, kind: "policy", jurisdiction: record.jurisdiction, identity: record.identity,
      lifecycle: isValid("lifecycle") ? record.lifecycle : "unknown", lifecycleFact: isValid("lifecycle") ? record.lifecycleFact : null,
      legalEffect: isValid("legal-effect") ? record.legalEffect : "unknown", legalEffectFact: isValid("legal-effect") ? record.legalEffectFact : null,
      topics: isValid("topics") ? record.topics : null, summary: isValid("summary") ? record.summary : null,
      latestAction: isValid("latest-action") ? record.latestAction : null,
      interpretation: record.interpretation.summary && !isValid("interpretation") ? { readiness: "evidence-changed", summary: null,
        reason: "Accepted interpretation dependencies changed; the prior meaning is historical and awaits review." } : record.interpretation,
      timeline: record.timeline.filter((_, index) => valid(groupsFor("timeline-action")[index]!)) });
  }
  const localRelationships = record.localRelationships.filter((_, index) => valid(groupsFor("local-relationship")[index]!));
  if (!localRelationships.length) return null;
  const licenses = record.licenses.filter((_, index) => valid(groupsFor("license")[index]!));
  const classes = [...new Set(licenses.map(fact => fact.value.classification))];
  if ((record.licenseClassifications.includes("unknown") || licenses.length < record.licenses.length) && !classes.includes("unknown")) classes.push("unknown");
  const oss = licenses.some(({ value }) => value.scope === "code" && value.classification === "osi-open-source" &&
    record.artifacts.some(({ value: artifact }) => artifact.id === value.artifactId && artifact.version === value.artifactVersion && artifact.availability === "public"));
  return WatchPublicRecord.parse({ ...base, kind: "technology", resourceType: record.resourceType,
    organizationIds: [...new Set(localRelationships.map(fact => fact.value.entityId))], licenseClassifications: classes, oss,
    purpose: isValid("purpose") ? record.purpose : null, intendedUsers: isValid("intended-users") ? record.intendedUsers : null,
    workflow: isValid("workflow") ? record.workflow : null, setup: isValid("setup") ? record.setup : null,
    limitations: isValid("limitations") ? record.limitations : null, artifacts: record.artifacts, localRelationships, licenses });
}
