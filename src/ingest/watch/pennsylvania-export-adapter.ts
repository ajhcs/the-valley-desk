import { validateBrowserOriginal } from "./pa-browser-original";
import { canonicalJson, policyIdentityKey } from "../../content/watch-schema";
import type { D1DatabaseLike } from "../persistence";
import { stageNativePolicyCapture } from "./policy-adapter";
import { derivePaExport, parsePennsylvaniaExportPolicy } from "./pennsylvania-export";
import { SourceEnrollment, checkedSnapshot, failedSnapshot, makeObservation, snapshotHealth, snapshotRepresentationDigest,
  proposedModelInputsAfterPersistence, type SnapshotInput, type WatchSnapshotResult, type PersistenceAcknowledgment } from "./source-enrollment";

export type PaExportSnapshotInput = SnapshotInput & { browserOriginal?: { acquisition: unknown; receiptBytes: Uint8Array } };

export async function validatedPennsylvaniaExport(input: PaExportSnapshotInput) {
  const source = checkedSnapshot(input, ["official-zip-xml"]);
  const browser = input.browserOriginal ? await validateBrowserOriginal(source, input.representationBytes!, input.browserOriginal.acquisition, input.browserOriginal.receiptBytes) : null;
  if (browser && (input.status !== undefined || input.fetchedAt !== browser.completedAt || input.finalUrl !== browser.requestedUrl)) throw Error("pa-browser-snapshot-binding-conflict");
  if (!browser && (input.status ?? 200) !== 200) throw Error("pa-export-http-failed");
  const derived = await derivePaExport(source, input.representationBytes!);
  if (derived.normalizedText !== input.body) throw Error("pa-export-derivation-conflict");
  if (derived.receipt.exportDate.instant > input.fetchedAt) throw Error("pa-export-after-capture");
  return { source, derived, browser, captures: derived.records.map(record => parsePennsylvaniaExportPolicy(record.document,
    { sourceId: source.id, sourceLabel: source.name, sourceUrl: input.finalUrl, retrievedAt: input.fetchedAt })) };
}
export async function parsePennsylvaniaExportSnapshot(input: PaExportSnapshotInput): Promise<WatchSnapshotResult> {
  const source = SourceEnrollment.parse(input.source), digest = await snapshotRepresentationDigest(input);
  try {
    const { derived, captures, browser } = await validatedPennsylvaniaExport(input);
    const observations = await Promise.all(captures.map(async (capture, index) => makeObservation(source, {
      externalKey: await policyIdentityKey(capture.identity), representationSha256: digest, sourceUrl: input.finalUrl, fetchedAt: input.fetchedAt,
      payload: { nativeParserVersion: capture.parserVersion, identity: capture.identity, version: capture.version, gaps: capture.gaps,
        derivation: { ...derived.receipt, records: [derived.receipt.records[index]] } } })));
    const health = browser ? {
      id: source.id, origin: "browser-original", state: "healthy" as const, checkedAt: browser.completedAt,
      itemCount: observations.length, complete: false, completeness: "partial" as const,
      url: browser.requestedUrl, requiresAuth: source.requiresAuth,
      ...(browser.httpStatus === null ? {} : { httpStatus: browser.httpStatus }),
    } : snapshotHealth(source, input, observations.length, { completeness: "partial" });
    return { observations, candidates: [], representationSha256: digest, truncated: false, rejectedItems: 0,
      health,
      pagination: { pageKey: input.pageKey ?? "1", nextPageKey: null, terminal: true } };
  } catch (error) {
    const failed = failedSnapshot(source, input, digest, error instanceof Error ? error.message : "pa-export-invalid");
    if (input.browserOriginal) { failed.health.origin = "browser-original"; delete failed.health.httpStatus; }
    return failed;
  }
}
export async function stageCollectedPennsylvaniaExport(db: D1DatabaseLike, input: PaExportSnapshotInput, result: WatchSnapshotResult,
  persisted: ReadonlyMap<string, PersistenceAcknowledgment>, now: Date, publishVerified = false) {
  await proposedModelInputsAfterPersistence(result, persisted);
  const replay = await parsePennsylvaniaExportSnapshot(input);
  if (result.health.state !== "healthy" || replay.health.state !== "healthy" || canonicalJson(replay) !== canonicalJson(result)) throw Error("pa-export-acknowledged-replay-conflict");
  for (const capture of (await validatedPennsylvaniaExport(input)).captures) await stageNativePolicyCapture(db, capture, now, publishVerified);
}
