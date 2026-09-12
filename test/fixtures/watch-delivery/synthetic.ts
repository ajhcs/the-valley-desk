import { AcceptedFactRecord, WatchPublicRecord, acceptedFactDigest, canonicalJson, sha256 } from "../../../src/content/watch-schema";
import { compileWatchDelivery, compiledWatchDeliveryValue, deliveryEasternDay } from "../../../src/content/watch-delivery";
import { persistCompiledWatchDelivery, recordWatchDependencyHead } from "../../../src/ingest/watch-delivery";
import type { D1DatabaseLike } from "../../../src/ingest/persistence";
import type { CompiledWatchDelivery, WatchDeliveryCompileContext } from "../../../src/content/watch-delivery";
import { syntheticFixture, VERIFIED } from "../watch-contracts/synthetic";

// Synthetic approvals/heads only. Never import into app, ingestion or real review.
export async function syntheticDeliveryForRecord(input: WatchPublicRecord, inputRevision = 1, gateVersion = "synthetic-qualified-gates-v1") {
  const record = WatchPublicRecord.parse(structuredClone(input));
  const fixture = await syntheticFixture(record.kind);
  fixture.draft.id = record.id; fixture.draft.slug = record.slug; fixture.draft.subjectRevision = inputRevision;
  fixture.context.currentSubjectRevision = inputRevision;
  fixture.context.asOf = VERIFIED;
  for (const fact of fixture.facts.values()) fact.subjectId = record.id;
  fixture.facts.get("f-title")!.value = record.title;
  if (record.kind === "policy" && fixture.draft.kind === "policy") {
    for (const [id, value] of [["f-identity", record.identity.value], ["f-lifecycle", record.lifecycleFact?.value],
      ["f-effect", record.legalEffectFact?.value], ["f-topics", record.topics], ["f-summary", record.summary?.value],
      ["f-action", record.latestAction?.value], ["f-interpretation", record.interpretation.summary?.value]] as const) {
      if (value !== undefined && value !== null) fixture.facts.get(id)!.value = value;
    }
    const frame = fixture.facts.get("f-interpretation")!.interpretationDependencies!;
    frame.instrumentId = record.id;
    fixture.currentInterpretations.set("f-interpretation", frame);
  } else if (record.kind === "technology" && fixture.draft.kind === "technology") {
    fixture.context.regionalEntityIds = new Set(record.localRelationships.map(fact => fact.value.entityId));
    for (const [id, value] of [["f-resource-type", record.resourceType], ["f-purpose", record.purpose?.value],
      ["f-users", record.intendedUsers?.value], ["f-workflow", record.workflow?.value], ["f-setup", record.setup?.value],
      ["f-limitations", record.limitations?.value]] as const) if (value !== undefined) fixture.facts.get(id)!.value = value;
    fixture.draft.artifactFactIds = []; fixture.draft.relationshipFactIds = []; fixture.draft.licenseFactIds = [];
    const add = (id: string, field: string, value: unknown) => {
      const fact = structuredClone(fixture.facts.get("f-artifact")!);
      Object.assign(fact, { id, subjectId: record.id, field, value, evidenceIds: [`evidence-${id}`] });
      fact.verification.kind = "human-review"; fixture.facts.set(id, fact); return id;
    };
    for (let index = 0; index < record.artifacts.length; index++) {
      const artifact = { ...record.artifacts[index]!.value, resourceId: record.id };
      fixture.draft.artifactFactIds.push(add(index === 0 ? "f-artifact" : `f-artifact-${index}`, "artifact", artifact));
      fixture.currentArtifacts.set(artifact.id, { resourceId: record.id, version: artifact.version,
        licenseSha256s: Object.fromEntries(["code", "data", "weights"].map(scope => [scope,
          record.licenses.find(fact => fact.value.artifactId === artifact.id && fact.value.scope === scope)?.value.licenseSha256 ?? null])) as { code: string | null; data: string | null; weights: string | null } });
    }
    for (let index = 0; index < record.localRelationships.length; index++) {
      const relation = { ...record.localRelationships[index]!.value, resourceId: record.id };
      fixture.draft.relationshipFactIds.push(add(index === 0 ? "f-relationship" : `f-relationship-${index}`, "local-relationship", relation));
    }
    for (let index = 0; index < record.licenses.length; index++) fixture.draft.licenseFactIds.push(add(index === 0 ? "f-license" : `f-license-${index}`, "license", record.licenses[index]!.value));
  }
  await fixture.refresh();
  const acceptance = fixture.context.acceptance as { subjectId: string; acceptedAt: string; gateVersion: string; factDigests: Array<{ id: string; sha256: string }> };
  acceptance.subjectId = record.id; acceptance.acceptedAt = VERIFIED; acceptance.gateVersion = gateVersion;
  const context: WatchDeliveryCompileContext = { ...fixture.context,
    sourcePermissionDigests: new Map([["synthetic-source", await sha256("SYNTHETIC accepted public source permission; not a real qualification")]]), regionalFactIds: new Map() };
  if (fixture.draft.kind === "technology") for (const relationId of fixture.draft.relationshipFactIds) {
    const relationFact = fixture.facts.get(relationId)!, relation = relationFact.value as { id: string; entityId: string; temporalStatus: "historical" | "current"; validFrom: string | null; checkedAt: string };
    const day = relation.temporalStatus === "historical" ? relation.validFrom! : deliveryEasternDay(relation.checkedAt);
    const regional = AcceptedFactRecord.parse({ ...relationFact, id: `${relationId}-regional`, field: "regional-eligibility",
      value: { relationshipId: relation.id, entityId: relation.entityId, geography: "delaware-valley", temporalStatus: relation.temporalStatus,
        asOfDay: day, validFrom: relation.temporalStatus === "current" ? "2020-01-01" : day, validTo: null },
      verification: { ...relationFact.verification, kind: "human-review" } });
    fixture.facts.set(regional.id, regional); acceptance.factDigests.push({ id: regional.id, sha256: await acceptedFactDigest(regional) });
    (context.regionalFactIds as Map<string, string>).set(relation.id, regional.id);
  }
  const handle = await compileWatchDelivery(fixture.draft, context);
  return { handle, ...compiledWatchDeliveryValue(handle), fixture, context };
}

export async function seedSyntheticDeliveryHeads(db: D1DatabaseLike, handle: CompiledWatchDelivery) {
  const { manifest } = compiledWatchDeliveryValue(handle);
  const dependencies = new Map(manifest.groups.flatMap(group => group.dependencies.map(dependency => [dependency.key, dependency] as const)));
  for (const dependency of dependencies.values()) {
    const current = await db.prepare("SELECT revision,digest FROM watch_dependency_heads WHERE dependency_key=?")
      .bind(dependency.key).first<{ revision: number; digest: string | null }>();
    if (current?.digest === dependency.expectedDigest) continue;
    const revision = (current?.revision ?? 0) + 1;
    await recordWatchDependencyHead(db, { key: dependency.key, kind: dependency.kind, revision,
      digest: dependency.expectedDigest, immutableRecordId: `synthetic-head:${await sha256(canonicalJson([dependency.key, revision, dependency.expectedDigest]))}`,
      changedAt: VERIFIED });
  }
}
export async function stageSyntheticDelivery(db: D1DatabaseLike, decisionId: string, handle: CompiledWatchDelivery) {
  await seedSyntheticDeliveryHeads(db, handle);
  await persistCompiledWatchDelivery(db, decisionId, handle);
}
