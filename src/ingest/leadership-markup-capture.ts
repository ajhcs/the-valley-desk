import type { D1DatabaseLike } from "./persistence";
import type { LeadershipSnapshot } from "./leadership-monitor";
import type { ArticlePageFetchResult } from "./news-extraction";

// Review proposal only. No flag is set in wrangler.jsonc. Changing this bounded
// window or allowlist requires a new reviewed patch; missed windows stay missed.
export const MARKUP_CAPTURE_START = "2026-10-06T02:30:00.000Z";
export const MARKUP_CAPTURE_END = "2026-10-06T04:00:00.000Z";
export const MARKUP_CAPTURE_RETENTION_END = "2026-10-07T04:00:00.000Z";
export const MARKUP_CAPTURE_MAX_BYTES = 512_000;
export const MARKUP_CAPTURE_SOURCES: Readonly<Record<string, string>> = Object.freeze({
  "src-chop-leadership": "https://www.chop.edu/about-us/executive-leadership",
  "src-chop-desai": "https://www.chop.edu/doctors/desai-bimal",
  "src-chop-pennington": "https://www.chop.edu/administrative-staff/pennington-jeffrey",
  "src-chop-salmasian": "https://www.chop.edu/administrative-staff/salmasian-hojjat",
  "src-temple-leadership": "https://www.templehealth.org/about/leadership",
  "src-inspira-leadership": "https://www.inspirahealthnetwork.org/about-us/executive-management-and-senior-leadership-team",
  "src-nemours-leadership": "https://www.nemours.org/about/leadership.html",
});
export type LeadershipMarkupCapture = {
  configuredUrl: string; attemptedUrl: string; receivedAt: string;
  status: number; contentType: string; byteCount: number;
  rawSha256: string; decodedSha256: string; rawMarkupBase64: string;
  byteSemantics: "fetch-response-body";
  decoding: "utf-8-replacement-bom-stripped";
};
export function markupCaptureWindow(now: Date) {
  const ms = now.getTime();
  return Number.isFinite(ms) && ms >= Date.parse(MARKUP_CAPTURE_START) && ms < Date.parse(MARKUP_CAPTURE_END);
}
export async function selectMarkupCaptureSources(db: D1DatabaseLike, enabled: string | undefined, scheduledAt: Date, wallClock = new Date()): Promise<ReadonlySet<string>> {
  if (enabled !== "true" || !markupCaptureWindow(scheduledAt) || !markupCaptureWindow(wallClock)) return new Set();
  // A missing/unavailable diagnostic table never changes collection or holds.
  try {
    const rows = await db.prepare("SELECT source_id FROM leadership_markup_captures").all<{source_id: string}>();
    const captured = new Set((rows.results ?? []).map(row => row.source_id));
    return new Set(Object.keys(MARKUP_CAPTURE_SOURCES).filter(id => !captured.has(id)));
  } catch { return new Set(); }
}
async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
function base64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}
export async function makeMarkupCapture(sourceId: string, configuredUrl: string, attemptedUrl: string, page: ArticlePageFetchResult): Promise<LeadershipMarkupCapture | undefined> {
  if (MARKUP_CAPTURE_SOURCES[sourceId] !== configuredUrl || !page.ok || !page.markupResponse) return undefined;
  const response = page.markupResponse;
  if (!markupCaptureWindow(new Date(response.receivedAt)) || response.bytes.byteLength > MARKUP_CAPTURE_MAX_BYTES) return undefined;
  try {
    return { configuredUrl, attemptedUrl, receivedAt: response.receivedAt,
      status: response.status, contentType: response.contentType, byteCount: response.bytes.byteLength,
      rawSha256: await sha256(response.bytes), decodedSha256: await sha256(new TextEncoder().encode(page.body)),
      rawMarkupBase64: base64(response.bytes), byteSemantics: "fetch-response-body", decoding: "utf-8-replacement-bom-stripped" };
  } catch { return undefined; }
}
export async function persistMarkupCaptures(db: D1DatabaseLike, snapshots: readonly LeadershipSnapshot[], wallClock: () => Date = () => new Date()): Promise<{attempted: number; failed: number}> {
  let attempted = 0; let failed = 0;
  for (const snapshot of snapshots) {
    const capture = snapshot.markupCapture;
    if (!capture || MARKUP_CAPTURE_SOURCES[snapshot.sourceId] !== capture.configuredUrl
      || !markupCaptureWindow(new Date(snapshot.fetchedAt))
      || !markupCaptureWindow(new Date(capture.receivedAt)) || capture.byteCount > MARKUP_CAPTURE_MAX_BYTES) continue;
    // Recheck immediately before submission; the migration trigger also checks
    // the database clock at insert execution (including delayed submissions).
    if (!markupCaptureWindow(wallClock())) continue;
    try {
      await db.prepare(`INSERT INTO leadership_markup_captures
        (source_id,snapshot_id,scheduled_at,received_at,configured_url,attempted_url,final_url,http_status,content_type,byte_count,raw_sha256,decoded_sha256,byte_semantics,decoding,raw_markup_base64)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO NOTHING`)
        .bind(snapshot.sourceId,snapshot.id,snapshot.fetchedAt,capture.receivedAt,capture.configuredUrl,capture.attemptedUrl,snapshot.finalUrl,capture.status,capture.contentType,capture.byteCount,capture.rawSha256,capture.decodedSha256,capture.byteSemantics,capture.decoding,capture.rawMarkupBase64).run();
      // Attempt count only; ON CONFLICT deliberately never overwrites evidence.
      attempted += 1;
    } catch { failed += 1; }
  }
  return {attempted, failed};
}

/** Expiry cleanup uses the existing schedule; it is independent of enablement.
 * The DB clock prevents an early delete if the scheduler/app clock is ahead.
 * An unavailable table or failed cleanup cannot change leadership collection.
 */
export async function purgeExpiredMarkupCaptures(db: D1DatabaseLike, wallClock = new Date()): Promise<{attempted: boolean; failed: boolean}> {
  if (!Number.isFinite(wallClock.getTime()) || wallClock.getTime() < Date.parse(MARKUP_CAPTURE_RETENTION_END)) {
    return {attempted: false, failed: false};
  }
  try {
    await db.prepare("DELETE FROM leadership_markup_captures WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')").run();
    return {attempted: true, failed: false};
  } catch { return {attempted: true, failed: true}; }
}
