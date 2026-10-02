import { z } from "zod";
import { CanonicalInstant, Sha256, canonicalJson, sha256 } from "../../src/content/watch-schema";
import { derivePaExport, parsePennsylvaniaExportPolicy, validatedPaExportSource } from "../../src/ingest/watch/pennsylvania-export";
import { launchCandidate } from "../../fixtures/watch-launch-candidates";

const Label = z.string().trim().min(1).max(500);
/** Private integrity envelope. The reviewer, not these hashes, authenticates tool provenance. */
export const BrowserOriginalAcquisition = z.object({
  schemaVersion: z.literal("pa-browser-original-1"), origin: z.literal("browser-original"),
  publisher: z.literal("Pennsylvania General Assembly"), session: z.literal("2025_0"),
  requestedUrl: z.string().url(), finalResponseUrl: z.string().url().nullable(),
  startedAt: CanonicalInstant, completedAt: CanonicalInstant, downloadSucceeded: z.literal(true),
  tool: Label, toolSession: Label.nullable(), downloadObservation: Label,
  representationSha256: Sha256, representationBytes: z.number().int().positive().max(2_000_000),
  downloadReceiptSha256: Sha256, downloadReceiptBytes: z.number().int().positive().max(64_000),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  responseHeaders: z.record(z.string().max(4000)).nullable(), redirectChain: z.array(z.string().url()).max(10).nullable(),
}).strict();
export type BrowserOriginalAcquisition = z.infer<typeof BrowserOriginalAcquisition>;

export async function validateBrowserOriginal(sourceInput: unknown, bytes: Uint8Array, input: unknown, receiptBytes: Uint8Array) {
  const source = validatedPaExportSource(sourceInput), acquisition = BrowserOriginalAcquisition.parse(input);
  if (bytes.byteLength > source.maxBytes || acquisition.requestedUrl !== source.endpoints[0] ||
      (acquisition.finalResponseUrl !== null && acquisition.finalResponseUrl !== acquisition.requestedUrl) ||
      (acquisition.httpStatus !== null && acquisition.httpStatus !== 200) ||
      (acquisition.redirectChain !== null && acquisition.redirectChain.length !== 0) ||
      acquisition.startedAt > acquisition.completedAt || acquisition.representationBytes !== bytes.byteLength ||
      acquisition.representationSha256 !== await sha256(bytes) || receiptBytes.byteLength > 64_000 ||
      acquisition.downloadReceiptBytes !== receiptBytes.byteLength || acquisition.downloadReceiptSha256 !== await sha256(receiptBytes))
    throw Error("pa-browser-original-binding-conflict");
  // Keep the genuine receipt unchanged. Compare only observations the existing
  // capture worker recorded; receipt export/PN/action assertions are never facts.
  const receipt = z.object({ publisher: z.literal("Pennsylvania General Assembly"), session_label: z.literal("2025-2026 Regular Session"),
    requested_download_url_observed: z.string(), download_started_at_utc: CanonicalInstant, download_completed_at_utc: CanonicalInstant,
    download_success: z.literal(true), size_bytes: z.number(), sha256: Sha256,
    http_status: z.number().nullable(), response_headers: z.record(z.string()).nullable(),
    final_download_response_url: z.string().nullable(), download_redirect_chain: z.array(z.string()).nullable(),
  }).passthrough().parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(receiptBytes)));
  if (receipt.requested_download_url_observed !== acquisition.requestedUrl || receipt.download_started_at_utc !== acquisition.startedAt ||
      receipt.download_completed_at_utc !== acquisition.completedAt || receipt.size_bytes !== bytes.byteLength || receipt.sha256 !== acquisition.representationSha256 ||
      canonicalJson([receipt.http_status, receipt.response_headers, receipt.final_download_response_url, receipt.download_redirect_chain]) !==
      canonicalJson([acquisition.httpStatus, acquisition.responseHeaders, acquisition.finalResponseUrl, acquisition.redirectChain]))
    throw Error("pa-browser-tool-observation-conflict");
  return acquisition;
}

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
