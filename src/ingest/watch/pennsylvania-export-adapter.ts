import { canonicalJson, policyIdentityKey } from "../../content/watch-schema";
import type { D1DatabaseLike } from "../persistence";
import { stageNativePolicyCapture } from "./policy-adapter";
import { derivePaExport, parsePennsylvaniaExportPolicy } from "./pennsylvania-export";
import { SourceEnrollment, checkedSnapshot, failedSnapshot, makeObservation, snapshotHealth, snapshotRepresentationDigest,
  proposedModelInputsAfterPersistence, type SnapshotInput, type WatchSnapshotResult, type PersistenceAcknowledgment } from "./source-enrollment";

export async function validatedPennsylvaniaExport(input: SnapshotInput) {
  const source = checkedSnapshot(input, ["official-zip-xml"]);
  if ((input.status ?? 200) !== 200) throw Error("pa-export-http-failed");
  const derived = await derivePaExport(source, input.representationBytes!);
  if (derived.normalizedText !== input.body) throw Error("pa-export-derivation-conflict");
  if (derived.receipt.exportDate.instant > input.fetchedAt) throw Error("pa-export-after-capture");
  return { source, derived, captures: derived.records.map(record => parsePennsylvaniaExportPolicy(record.document,
    { sourceId: source.id, sourceLabel: source.name, sourceUrl: input.finalUrl, retrievedAt: input.fetchedAt })) };
}
export async function parsePennsylvaniaExportSnapshot(input: SnapshotInput): Promise<WatchSnapshotResult> {
  const source = SourceEnrollment.parse(input.source), digest = await snapshotRepresentationDigest(input);
  try {
    const { derived, captures } = await validatedPennsylvaniaExport(input);
    const observations = await Promise.all(captures.map(async (capture, index) => makeObservation(source, {
      externalKey: await policyIdentityKey(capture.identity), representationSha256: digest, sourceUrl: input.finalUrl, fetchedAt: input.fetchedAt,
      payload: { nativeParserVersion: capture.parserVersion, identity: capture.identity, version: capture.version, gaps: capture.gaps,
        derivation: { ...derived.receipt, records: [derived.receipt.records[index]] } } })));
    return { observations, candidates: [], representationSha256: digest, truncated: false, rejectedItems: 0,
      health: snapshotHealth(source, input, observations.length, { completeness: "partial" }),
      pagination: { pageKey: input.pageKey ?? "1", nextPageKey: null, terminal: true } };
  } catch (error) { return failedSnapshot(source, input, digest, error instanceof Error ? error.message : "pa-export-invalid"); }
}
export async function stageCollectedPennsylvaniaExport(db: D1DatabaseLike, input: SnapshotInput, result: WatchSnapshotResult,
  persisted: ReadonlyMap<string, PersistenceAcknowledgment>, now: Date, publishVerified = false) {
  await proposedModelInputsAfterPersistence(result, persisted);
  const replay = await parsePennsylvaniaExportSnapshot(input);
  if (result.health.state !== "healthy" || replay.health.state !== "healthy" || canonicalJson(replay) !== canonicalJson(result)) throw Error("pa-export-acknowledged-replay-conflict");
  for (const capture of (await validatedPennsylvaniaExport(input)).captures) await stageNativePolicyCapture(db, capture, now, publishVerified);
}
