import { z } from "zod";
import { DISCOVERY_PROVIDERS, DISCOVERY_COUNTY_KEYS, DiscoveryId as Id, DiscoverySubject, ProviderIdentity, RevisionRef } from "../content/discovery-schema";

const Text = z.string().trim().min(1).max(4000);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Instant = z.string().datetime();
const Ref = z.object({ id: Id, sha256: Hash }).strict();
const Label = z.enum(["eligible", "ineligible", "ambiguous"]);
const Dimension = z.enum(["supported", "refuted", "ambiguous"]);
const Labels = z.object({ overall: Label, identity: Dimension, professionalBasis: Dimension,
  relevance: Dimension, currentPresence: Dimension, regionalCreation: Dimension, creatorRole: Dimension,
  rights: Dimension }).strict();
export const DiscoveryEvaluationFamilies = z.object({ people: z.array(Id).max(200), projects: z.array(Id).max(200),
  origins: z.array(Id).min(1).max(200), equivalences: z.array(Id).max(200) }).strict();
export type DiscoveryEvaluationFamilies = z.infer<typeof DiscoveryEvaluationFamilies>;
const Annotation = z.object({ reviewerId: Id, labels: Labels, rationale: Text, confidence: z.enum(["low", "medium", "high"]),
  sourceIds: z.array(Id).min(1).max(128), rubric: RevisionRef, recordedAt: Instant, blindedBatch: Ref, receipt: Ref }).strict();
const Adjudication = z.object({ reviewerId: Id, labels: Labels, rationale: Text, sourceIds: z.array(Id).min(1).max(128),
  rubric: RevisionRef, recordedAt: Instant, receipt: Ref }).strict();
const Source = z.object({ id: Id, revision: RevisionRef, identity: ProviderIdentity, originFamilyId: Id,
  observedAt: Instant, representationSha256: Hash, evidence: Ref, permission: Ref }).strict();
export const DiscoveryReferenceCase = z.object({ id: Id, partition: z.enum(["development", "heldout", "challenge", "recall", "audit"]),
  claimMode: z.enum(["creator-current", "creator-historical", "work-regional-at-creation", "identity-relationship"]),
  subject: DiscoverySubject, primaryRoute: z.enum(DISCOVERY_PROVIDERS), appearances: z.array(z.enum(DISCOVERY_PROVIDERS)).min(1).max(6),
  counties: z.array(z.enum(DISCOVERY_COUNTY_KEYS)).max(9), countyUnknown: z.boolean(), families: DiscoveryEvaluationFamilies,
  sourceIds: z.array(Id).min(1).max(128), familyReview: Ref, annotations: z.array(Annotation).max(10), adjudication: Adjudication.nullable(),
  selectionReceipt: Ref, challenges: z.array(z.enum(["ambiguous-name", "account-person", "expired-affiliation", "adoption-only", "generic-ai",
    "repository-free-paper", "creator-without-work", "partial-date", "retraction", "mirror", "unsupported-project-join"])).max(11) }).strict();
export type DiscoveryReferenceCase = z.infer<typeof DiscoveryReferenceCase>;
const Sampling = z.object({ frame: Ref, method: Text, selectedAt: Instant, sourceScopes: z.array(Id).min(1).max(100),
  from: Instant, until: Instant, assembly: Ref }).strict().refine(x => Date.parse(x.from) < Date.parse(x.until), "sampling-window");
const AuditPlan = z.object({ frameDefinition: Text, selectionMethod: Text, intervalRule: Text,
  minimumIndependentItems: z.literal(100), procedure: Ref }).strict();
const History = z.object({ receipt: Ref, previous: z.array(z.object({ revision: RevisionRef, rubric: RevisionRef,
  heldoutCaseIds: z.array(Id).max(10000), heldoutFamilyKeys: z.array(Text).max(50000),
  exposedAt: Instant.nullable() }).strict()).max(100),
  exposures: z.array(z.object({ caseIds: z.array(Id).min(1).max(10000), at: Instant,
    reason: z.enum(["tuning", "label-access", "evaluation", "rubric-change"]), receipt: Ref }).strict()).max(100) }).strict();

/** Preparatory inventory only. This module cannot issue an authenticated freeze. */
export const DiscoveryReferenceManifest = z.object({ schemaVersion: z.literal("discovery-reference-v1"), status: z.literal("not_frozen"),
  revision: RevisionRef, policy: RevisionRef, rubric: RevisionRef, design: z.literal("wp03-evaluation-design-v1"), createdAt: Instant,
  reviewers: z.array(z.object({ id: Id, authority: Ref }).strict()).max(100), sources: z.array(Source).max(20000),
  sampling: z.object({ heldout: Sampling.nullable(), recall: Sampling.nullable(), audit: AuditPlan.nullable() }).strict(),
  history: History.nullable(), cases: z.array(DiscoveryReferenceCase).max(10000) }).strict();
export type DiscoveryReferenceManifest = z.infer<typeof DiscoveryReferenceManifest>;

type ReceiptRef = z.infer<typeof Ref>;
type ReceiptPurpose = "reviewer-authority" | "evidence" | "permission" | "sampling" | "family-review" | "independent-annotation" | "blinding" | "adjudication" | "selection" | "history" | "exposure";
export type ReceiptExpectation = { purpose: ReceiptPurpose; subjectId: string; contentSha256: string; principalId: string | null };
const VerifiedReceipt = z.object({ status: z.literal("verified"), receiptSha256: Hash, purpose: Text, subjectId: Id,
  contentSha256: Hash, principalId: Id.nullable(), method: Text }).strict();
/** Caller must supply an independently authenticated resolver, never request-body assertions. */
export type DiscoveryReceiptVerifier = (receipt: ReceiptRef, expectation: ReceiptExpectation) => Promise<unknown>;
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
export async function discoveryEvaluationDigest(value: unknown): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)))))
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export function discoveryFamilyKeys(families: DiscoveryEvaluationFamilies): string[] {
  const parsed = DiscoveryEvaluationFamilies.parse(families);
  return Object.entries(parsed).flatMap(([kind, ids]) => ids.map(id => `${kind}:${id}`));
}
const duplicate = (values: string[]) => new Set(values).size !== values.length;
const sameRevision = (a: z.infer<typeof RevisionRef>, b: z.infer<typeof RevisionRef>) => a.id === b.id && a.revision === b.revision;

/** Structural/evidence-reference readiness is not source truth, human acceptance, or a freeze. */
export async function assessDiscoveryReferenceReadiness(input: unknown, verify?: DiscoveryReceiptVerifier) {
  const parsed = DiscoveryReferenceManifest.safeParse(input);
  if (!parsed.success) return { status: "not_frozen" as const, readiness: "blocked" as const, findings: parsed.error.issues.map(x => `schema:${x.path.join(".")}:${x.message}`) };
  const m = parsed.data, findings: string[] = [];
  const add = (message: string) => { findings.push(message); };
  const verifyReceipt = async (receipt: ReceiptRef, purpose: ReceiptPurpose, subjectId: string, payload: unknown, principalId: string | null = null) => {
    if (!verify) { add(`unverified:${purpose}:${subjectId}`); return; }
    const expectation: ReceiptExpectation = { purpose, subjectId, contentSha256: await discoveryEvaluationDigest(payload), principalId };
    try {
      const checked = VerifiedReceipt.safeParse(await verify(receipt, expectation));
      if (!checked.success || checked.data.receiptSha256 !== receipt.sha256 || checked.data.purpose !== purpose ||
          checked.data.subjectId !== subjectId || checked.data.contentSha256 !== expectation.contentSha256 || checked.data.principalId !== principalId)
        add(`unverified:${purpose}:${subjectId}`);
    } catch { add(`unverified:${purpose}:${subjectId}`); }
  };
  if (!verify) add("missing-independent-receipt-verifier");
  for (const [kind, rows] of [["case", m.cases], ["source", m.sources], ["reviewer", m.reviewers]] as const)
    if (duplicate(rows.map(x => x.id))) add(`duplicate-${kind}-id`);
  const reviewers = new Set(m.reviewers.map(x => x.id));
  if (reviewers.size < 2) add("two-independent-reviewers-required");
  for (const reviewer of m.reviewers) await verifyReceipt(reviewer.authority, "reviewer-authority", reviewer.id, { reviewerId: reviewer.id, policy: m.policy }, reviewer.id);
  const sources = new Map(m.sources.map(x => [x.id, x]));
  for (const source of m.sources) {
    const { evidence, permission, ...payload } = source;
    await verifyReceipt(evidence, "evidence", source.id, payload);
    await verifyReceipt(permission, "permission", source.id, { ...payload, uses: ["fetch", "retain", "annotate", "evaluate"] });
  }
  if (!m.sampling.audit) add("missing-audit-selection-plan");
  else {
    const { procedure, ...payload } = m.sampling.audit;
    await verifyReceipt(procedure, "sampling", `${m.revision.id}/audit-plan`, { ...payload, revision: m.revision, rubric: m.rubric });
  }
  for (const kind of ["heldout", "recall"] as const) {
    const sampling = m.sampling[kind];
    if (!sampling) { add(`missing-${kind}-sampling`); continue; }
    const { frame, assembly, ...payload } = sampling;
    await verifyReceipt(frame, "sampling", `${m.revision.id}/${kind}`, { ...payload, revision: m.revision, rubric: m.rubric });
    await verifyReceipt(assembly, "sampling", `${m.revision.id}/${kind}/assembly`, {
      ...payload, frame, independence: kind === "recall" ? "assembled-without-system-retrieved-or-published-output" : "independent-route-balanced-selection" });
  }
  const familyPartitions = new Map<string, Set<string>>();
  const allKeys = new Map<string, string[]>();
  for (const item of m.cases) {
    if (item.claimMode.startsWith("creator-") && !["person", "organization"].includes(item.subject.kind)) add(`claim-subject-kind:${item.id}`);
    if (item.claimMode === "work-regional-at-creation" && !["project", "artifact"].includes(item.subject.kind)) add(`claim-subject-kind:${item.id}`);
    if (duplicate(item.sourceIds) || duplicate(item.appearances) || duplicate(item.counties) || duplicate(discoveryFamilyKeys(item.families))) add(`duplicate-case-members:${item.id}`);
    if (!item.appearances.includes(item.primaryRoute)) add(`primary-route-not-in-appearances:${item.id}`);
    if (item.counties.length === 0 && !item.countyUnknown) add(`missing-county-disposition:${item.id}`);
    const keys = [...discoveryFamilyKeys(item.families), `subject:${item.subject.kind}:${item.subject.id}`];
    const observedRoutes = new Set<string>();
    for (const sourceId of item.sourceIds) {
      const source = sources.get(sourceId);
      if (!source) { add(`unknown-source:${item.id}:${sourceId}`); continue; }
      if (!item.families.origins.includes(source.originFamilyId)) add(`missing-origin-family:${item.id}:${sourceId}`);
      observedRoutes.add(source.identity.provider);
      keys.push(`bytes:${source.representationSha256}`, `native:${canonical(source.identity)}`);
    }
    if (!observedRoutes.has(item.primaryRoute) || item.appearances.some(route => !observedRoutes.has(route))) add(`unsupported-route-appearance:${item.id}`);
    allKeys.set(item.id, keys);
    for (const key of keys) {
      if (item.partition === "development" || item.partition === "heldout") {
        const partitions = familyPartitions.get(key) ?? new Set<string>(); partitions.add(item.partition); familyPartitions.set(key, partitions);
      }
    }
    await verifyReceipt(item.familyReview, "family-review", item.id, { subject: item.subject, families: item.families, sourceIds: item.sourceIds });
    await verifyReceipt(item.selectionReceipt, "selection", item.id, { revision: m.revision, partition: item.partition, claimMode: item.claimMode, primaryRoute: item.primaryRoute, sampling: item.partition in m.sampling ? m.sampling[item.partition as keyof typeof m.sampling] : null });
    if (item.annotations.length < 2 || duplicate(item.annotations.map(x => x.reviewerId))) add(`independent-annotations-required:${item.id}`);
    for (const annotation of item.annotations) {
      const { receipt, blindedBatch, ...payload } = annotation;
      if (!reviewers.has(annotation.reviewerId)) add(`unknown-reviewer:${item.id}`);
      if (!sameRevision(annotation.rubric, m.rubric)) add(`stale-annotation-rubric:${item.id}`);
      if (annotation.sourceIds.some(id => !item.sourceIds.includes(id))) add(`annotation-source-outside-case:${item.id}`);
      await verifyReceipt(receipt, "independent-annotation", item.id, payload, annotation.reviewerId);
      await verifyReceipt(blindedBatch, "blinding", item.id, { reviewerId: annotation.reviewerId, rubric: annotation.rubric, annotation: receipt }, annotation.reviewerId);
    }
    if (!item.adjudication) add(`missing-adjudication:${item.id}`);
    else {
      const { receipt, ...payload } = item.adjudication;
      if (!reviewers.has(payload.reviewerId)) add(`unknown-adjudicator:${item.id}`);
      if (!sameRevision(payload.rubric, m.rubric)) add(`stale-adjudication-rubric:${item.id}`);
      if (payload.sourceIds.some(id => !item.sourceIds.includes(id))) add(`adjudication-source-outside-case:${item.id}`);
      if (item.annotations.some(a => Date.parse(a.recordedAt) > Date.parse(payload.recordedAt))) add(`adjudication-before-annotation:${item.id}`);
      await verifyReceipt(receipt, "adjudication", item.id, { ...payload, annotations: item.annotations }, payload.reviewerId);
      if (item.partition === "recall" && payload.labels.overall !== "eligible") add(`recall-not-independently-eligible:${item.id}`);
    }
  }
  // Shared families must stay on one side of the development/heldout boundary.
  // Recall/audit sampling may deliberately overlap those sets; do not invent disjoint quotas.
  for (const [key, partitions] of familyPartitions) if (partitions.size > 1) add(`partition-leakage:${key}`);
  const heldout = m.cases.filter(x => x.partition === "heldout");
  const byCaseId = new Map(m.cases.map(x => [x.id, x]));
  const allComponents = connectedGroups(m.cases.map(x => ({ id: x.id, keys: allKeys.get(x.id)! })));
  for (const ids of allComponents) if (ids.some(id => byCaseId.get(id)!.partition === "development") && ids.some(id => byCaseId.get(id)!.partition === "heldout"))
    add(`partition-leakage:connected-component:${ids[0]}`);
  const heldoutConnectedIds = new Set(allComponents.filter(ids => ids.some(id => byCaseId.get(id)!.partition === "heldout")).flat());
  const heldoutConnectedKeys = new Set([...heldoutConnectedIds].flatMap(id => allKeys.get(id)!));
  if (heldout.length !== 360) add(`heldout-total:${heldout.length}:expected-360`);
  for (const route of DISCOVERY_PROVIDERS) {
    const count = heldout.filter(x => x.primaryRoute === route).length;
    if (count !== 60) add(`heldout-route:${route}:${count}:expected-60`);
    for (const label of ["eligible", "ineligible", "ambiguous"] as const)
      if (!heldout.some(x => x.primaryRoute === route && x.adjudication?.labels.overall === label)) add(`missing-route-label:${route}:${label}`);
  }
  for (const label of ["eligible", "ineligible", "ambiguous"] as const)
    if (!heldout.some(x => x.adjudication?.labels.overall === label)) add(`missing-heldout-label:${label}`);
  if (!m.cases.some(x => x.partition === "development")) add("missing-development-set");
  for (const challenge of ["ambiguous-name", "account-person", "expired-affiliation", "adoption-only", "generic-ai", "repository-free-paper", "creator-without-work", "partial-date", "retraction", "mirror", "unsupported-project-join"])
    if (!m.cases.some(x => x.challenges.includes(challenge as DiscoveryReferenceCase["challenges"][number]))) add(`missing-challenge:${challenge}`);
  const canonicalKeys = (item: DiscoveryReferenceCase) => allKeys.get(item.id)!.filter(key => !key.startsWith("people:") && !key.startsWith("projects:"));
  const canonicalComponentById = new Map(connectedGroups(m.cases.map(x => ({ id: x.id, keys: canonicalKeys(x) }))).flatMap((ids, group) => ids.map(id => [id, group] as const)));
  const uniqueOrigins = (items: DiscoveryReferenceCase[]) => new Set(items.map(x => canonicalComponentById.get(x.id))).size;
  if (uniqueOrigins(heldout) !== heldout.length) add("heldout-cross-route-or-family-duplicates");
  for (const kind of ["recall"] as const) {
    const count = uniqueOrigins(m.cases.filter(x => x.partition === kind));
    if (count < 100) add(`${kind}-independent-count:${count}:minimum-100`);
  }
  if (!m.history) add("missing-authenticated-exposure-history");
  else {
    const { receipt, ...payload } = m.history;
    await verifyReceipt(receipt, "history", m.revision.id, { revision: m.revision, ...payload });
    for (const exposure of m.history.exposures) {
      await verifyReceipt(exposure.receipt, "exposure", m.revision.id, { caseIds: exposure.caseIds, at: exposure.at, reason: exposure.reason });
      if (heldout.some(x => exposure.caseIds.includes(x.id))) add("heldout-already-exposed");
      for (const id of exposure.caseIds) {
        const keys = allKeys.get(id);
        if (!keys) add(`unknown-exposure-case:${id}`);
        else if (heldoutConnectedIds.has(id)) add(`heldout-family-already-exposed:${id}`);
      }
    }
    for (const old of m.history.previous) {
      if (sameRevision(old.revision, m.revision)) add("revision-reused");
      if (old.exposedAt !== null || !sameRevision(old.rubric, m.rubric)) {
        if (old.heldoutCaseIds.some(id => heldoutConnectedIds.has(id)) || old.heldoutFamilyKeys.some(key => heldoutConnectedKeys.has(key)))
          add("fresh-holdout-required-after-exposure-or-rubric-change");
      }
    }
  }
  return { status: "not_frozen" as const, readiness: findings.length ? "blocked" as const : "ready_for_accountable_freeze_review" as const,
    findings, counts: { heldout: heldout.length, recall: m.cases.filter(x => x.partition === "recall").length, audit: m.cases.filter(x => x.partition === "audit").length },
    heldoutHistory: { caseIds: [...heldoutConnectedIds].sort(), familyKeys: [...heldoutConnectedKeys].sort() },
    claimScope: "Selected structure and externally resolved receipt bindings only; no authentication implementation or source-truth verdict." };
}

function connectedGroups(rows: { id: string; keys: string[] }[]): string[][] {
  const parent = new Map(rows.map(x => [x.id, x.id]));
  const find = (id: string): string => { let at = id; while (parent.get(at) !== at) at = parent.get(at)!; return at; };
  const owners = new Map<string, string>();
  for (const row of rows) for (const key of row.keys) {
    const owner = owners.get(key);
    if (owner) parent.set(find(row.id), find(owner)); else owners.set(key, row.id);
  }
  const groups = new Map<string, string[]>();
  for (const row of rows) { const key = find(row.id); groups.set(key, [...(groups.get(key) ?? []), row.id]); }
  return [...groups.values()];
}

export function wilson95(successes: number, trials: number) {
  if (!Number.isSafeInteger(successes) || !Number.isSafeInteger(trials) || trials < 0 || successes < 0 || successes > trials) throw Error("invalid-binomial-counts");
  if (trials === 0) return null;
  const z = 1.96, p = successes / trials, denominator = 1 + z * z / trials;
  const center = (p + z * z / (2 * trials)) / denominator;
  const margin = z * Math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials)) / denominator;
  return { method: "Wilson two-sided nominal 95%" as const, z, lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}
const MetricObservation = z.object({ caseId: Id, families: DiscoveryEvaluationFamilies, truth: Label,
  cohorts: z.array(z.enum(["admitted-audit", "recall-roster", "candidate-evaluation"])).min(1).max(3).refine(x => !duplicate(x), "duplicate-cohort"),
  predictedPositive: z.boolean(), captured: z.boolean(), admitted: z.boolean(), published: z.boolean().optional(),
  criticalErrors: z.array(z.enum(["person-account-merge", "fabricated-regional-link", "false-current-affiliation"])).max(3) }).strict();
export type DiscoveryMetricObservation = z.infer<typeof MetricObservation>;

/** Conservative connected-family summaries. Intervals do not establish population representativeness. */
export function summarizeDiscoveryEvaluation(input: unknown) {
  const rows = z.array(MetricObservation).max(10000).parse(input);
  if (duplicate(rows.map(x => x.caseId))) throw Error("duplicate-metric-case");
  if (rows.some(x => x.cohorts.includes("admitted-audit") && !x.admitted)) throw Error("audit-cohort-requires-admission-at-sampling");
  if (rows.some(x => x.admitted && !x.captured)) throw Error("admitted-without-capture");
  if (rows.some(x => x.published && !x.admitted)) throw Error("published-without-admission");
  const byId = new Map(rows.map(x => [x.caseId, x]));
  const groups = connectedGroups(rows.map(x => ({ id: x.caseId, keys: discoveryFamilyKeys(x.families).filter(key => !key.startsWith("people:") && !key.startsWith("projects:")) })));
  const clusters = connectedGroups(rows.map(x => ({ id: x.caseId, keys: discoveryFamilyKeys(x.families) })));
  const makeTrials = (sets: string[][]) => sets.map(ids => {
    const items = ids.map(id => byId.get(id)!);
    const positive = items.filter(x => x.cohorts.includes("admitted-audit") && x.admitted);
    const candidates = items.filter(x => x.cohorts.includes("candidate-evaluation") && x.predictedPositive);
    const potentiallyEligible = items.filter(x => x.cohorts.includes("recall-roster") && x.truth !== "ineligible");
    return { caseIds: ids, precisionTrial: positive.length > 0,
      precisionSuccess: positive.length > 0 && positive.every(x => x.truth === "eligible"),
      candidateTrial: candidates.length > 0, candidateSuccess: candidates.length > 0 && candidates.every(x => x.truth === "eligible"),
      recallTrial: potentiallyEligible.length > 0,
      recallSuccess: potentiallyEligible.length > 0 && potentiallyEligible.every(x => x.truth === "eligible" && x.captured),
      admittedRecallSuccess: potentiallyEligible.length > 0 && potentiallyEligible.every(x => x.truth === "eligible" && x.admitted),
      publishedRecallSuccess: potentiallyEligible.length > 0 && potentiallyEligible.every(x => x.truth === "eligible" && x.published === true),
      unresolvedPositiveCases: positive.filter(x => x.truth === "ambiguous").map(x => x.caseId),
      unresolvedRecallCases: potentiallyEligible.filter(x => x.truth === "ambiguous").map(x => x.caseId) };
  });
  const trials = makeTrials(groups), clusterTrials = makeTrials(clusters);
  const metric = (numerator: number, denominator: number, pointGate: number, lowerGate: number, minimum: number) => {
    const interval = wilson95(numerator, denominator), value = denominator ? numerator / denominator : null;
    return { numerator, denominator, value, interval, numericalGate: value !== null && denominator >= minimum && value >= pointGate && interval!.lower >= lowerGate };
  };
  const precision = metric(trials.filter(x => x.precisionSuccess).length, trials.filter(x => x.precisionTrial).length, .95, .90, 100);
  const recall = metric(trials.filter(x => x.recallSuccess).length, trials.filter(x => x.recallTrial).length, .80, .70, 100);
  const admittedRecall = metric(trials.filter(x => x.admittedRecallSuccess).length, trials.filter(x => x.recallTrial).length, .80, .70, 100);
  const candidate = metric(trials.filter(x => x.candidateSuccess).length, trials.filter(x => x.candidateTrial).length, .95, .90, 100);
  const candidatePrecision = { numerator: candidate.numerator, denominator: candidate.denominator, value: candidate.value, interval: candidate.interval };
  const recallRows = rows.filter(x => x.cohorts.includes("recall-roster"));
  const publishedRecall = recallRows.length && recallRows.every(x => x.published !== undefined)
    ? { status: "available" as const, ...metric(trials.filter(x => x.publishedRecallSuccess).length, trials.filter(x => x.recallTrial).length, .80, .70, 100) }
    : { status: "unavailable" as const, reason: "Explicit publication observations were not supplied for every case." };
  const clusteringPresent = clusters.length !== groups.length;
  const precisionClustered = clusterTrials.filter(x => x.precisionTrial).length !== trials.filter(x => x.precisionTrial).length;
  const recallClustered = clusterTrials.filter(x => x.recallTrial).length !== trials.filter(x => x.recallTrial).length;
  if (precisionClustered) precision.numericalGate = false;
  if (recallClustered) { recall.numericalGate = false; admittedRecall.numericalGate = false; if (publishedRecall.status === "available") publishedRecall.numericalGate = false; }
  return { status: rows.length ? "scoped_descriptive_summary" : "no_observations", rawCases: rows.length, canonicalCaseComponents: groups.length, correlatedFamilyComponents: clusters.length,
    precision, admissionPrecision: precision, candidatePrecision, recall, admittedRecall, publishedRecall,
    clustering: { present: clusteringPresent, admissionPrecisionAffected: precisionClustered, recallAffected: recallClustered, trials: clusterTrials, conservativeAdmissionPrecision: metric(clusterTrials.filter(x => x.precisionSuccess).length, clusterTrials.filter(x => x.precisionTrial).length, .95, .90, 100) },
    criticalErrorCount: rows.reduce((sum, x) => sum + x.criticalErrors.length, 0),
    criticalIdentityGate: false,
    criticalIdentityStatus: "not_evaluated: metric rows do not authenticate a qualified public-output audit",
    unresolvedPositiveCases: trials.flatMap(x => x.unresolvedPositiveCases), unresolvedRecallCases: trials.flatMap(x => x.unresolvedRecallCases),
    recallExclusions: recallRows.filter(x => x.truth === "ineligible").map(x => ({ caseId: x.caseId, reason: "explicitly-ineligible-reference" })), trials,
    acceptance: "not_evaluated", intervalScope: "Admission precision counts audited admitted cases, with origin-equivalent duplicates collapsed. Shared creator/project clustering is reported separately and blocks an independent-binomial gate. Descriptive Wilson bounds and candidate precision establish neither population inference nor empirical acceptance." };
}
