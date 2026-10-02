export { BrowserOriginalAcquisition, validateBrowserOriginal } from "../../src/ingest/watch/pa-browser-original";
import { validateBrowserOriginal } from "../../src/ingest/watch/pa-browser-original";
import { derivePaExport, parsePennsylvaniaExportPolicy, validatedPaExportSource } from "../../src/ingest/watch/pennsylvania-export";
import { launchCandidate } from "../../fixtures/watch-launch-candidates";

export async function importPaOriginal(id: string, bytes: Uint8Array, input: unknown, receiptBytes: Uint8Array) {
  const candidate = launchCandidate(id), source = validatedPaExportSource(candidate.source);
  const acquisition = await validateBrowserOriginal(source, bytes, input, receiptBytes);
  const derived = await derivePaExport(source, bytes);
  if (derived.receipt.exportDate.instant > acquisition.completedAt) throw Error("pa-export-after-acquisition");
  return { schemaVersion: "pa-original-import-1" as const, sourceId: id, acquisition,
    derivation: derived.receipt,
    captures: derived.records.map(record => parsePennsylvaniaExportPolicy(record.document, {
      sourceId: id, sourceLabel: source.name, sourceUrl: acquisition.requestedUrl, retrievedAt: acquisition.completedAt })),
    originAuthenticity: "requires-named-provenance-review" as const,
    qualificationStatus: "candidate-only" as const, successfulUpstreamCheckRenewed: false as const,
    publicationAuthorized: false as const, activationAuthorized: false as const, blockers: candidate.blockers };
}
