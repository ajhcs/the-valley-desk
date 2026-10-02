import { z } from "zod";
import { CanonicalInstant, Sha256, canonicalJson, sha256 } from "../../content/watch-schema";
import { validatedPaExportSource } from "./pennsylvania-export";

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

const LegacyReceipt = z.object({
  publisher: z.literal("Pennsylvania General Assembly"), session_label: z.literal("2025-2026 Regular Session"),
  requested_download_url_observed: z.string(), download_started_at_utc: CanonicalInstant, download_completed_at_utc: CanonicalInstant,
  download_success: z.literal(true), size_bytes: z.number(), sha256: Sha256,
  http_status: z.number().nullable(), response_headers: z.record(z.string()).nullable(),
  final_download_response_url: z.string().nullable(), download_redirect_chain: z.array(z.string()).nullable(),
}).passthrough();
const SessionLinkReceipt = z.object({
  schema_version: z.literal(1), result: z.literal("success"),
  source: z.object({ page_url: z.literal("https://www.palegis.us/data"),
    offered_href: z.literal("/data/file?documentType=BillHistoryData&session=2025_0"),
    offered_resolved_url: z.string().url(),
  }).passthrough(),
  acquisition: z.object({ click_started_observed_utc: CanonicalInstant, download_completed_observed_utc: CanonicalInstant,
    attempts: z.literal(1), denial_or_captcha_observed: z.literal(false),
  }).passthrough(),
  transport: z.object({ http_status: BrowserOriginalAcquisition.shape.httpStatus,
    response_headers: BrowserOriginalAcquisition.shape.responseHeaders,
    response_final_url: z.string().url().nullable(),
    // This known receipt shape has no redirect observation. Never fabricate [].
    redirect_chain: z.null().optional(), request_headers: z.null().optional(),
    content_disposition_filename: z.null().optional(), reason_null: Label.optional(),
  }).strict(),
  original_archive: z.object({ byte_count: BrowserOriginalAcquisition.shape.representationBytes, sha256: Sha256 }).passthrough(),
  environment: z.object({ browser: Label, method: Label }).passthrough(),
}).passthrough();

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
  const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(receiptBytes));
  const legacy = LegacyReceipt.safeParse(parsed);
  let receipt;
  // Previously unknown passthrough metadata cannot select a different format.
  if (legacy.success) receipt = legacy.data;
  else {
    const nested = SessionLinkReceipt.parse(parsed);
    receipt = { requested_download_url_observed: nested.source.offered_resolved_url,
      download_started_at_utc: nested.acquisition.click_started_observed_utc,
      download_completed_at_utc: nested.acquisition.download_completed_observed_utc,
      size_bytes: nested.original_archive.byte_count, sha256: nested.original_archive.sha256,
      http_status: nested.transport.http_status, response_headers: nested.transport.response_headers,
      final_download_response_url: nested.transport.response_final_url, download_redirect_chain: null,
    };
  }
  if (receipt.requested_download_url_observed !== acquisition.requestedUrl || receipt.download_started_at_utc !== acquisition.startedAt ||
      receipt.download_completed_at_utc !== acquisition.completedAt || receipt.size_bytes !== bytes.byteLength || receipt.sha256 !== acquisition.representationSha256 ||
      canonicalJson([receipt.http_status, receipt.response_headers, receipt.final_download_response_url, receipt.download_redirect_chain]) !==
      canonicalJson([acquisition.httpStatus, acquisition.responseHeaders, acquisition.finalResponseUrl, acquisition.redirectChain]))
    throw Error("pa-browser-tool-observation-conflict");
  return acquisition;
}


/** Canonical bounded base64 of original bytes, shared by storage-proof replay. */
export function decodeBrowserOriginalBytes(text:string){
  if(text.length>85336||text.length%4!==0||! /^[A-Za-z0-9+/]*={0,2}$/.test(text))throw Error("pa-browser-original-encoding");
  const binary=atob(text);
  if(binary.length>64000||btoa(binary)!==text)throw Error("pa-browser-original-encoding");
  return Uint8Array.from(binary,char=>char.charCodeAt(0));
}
