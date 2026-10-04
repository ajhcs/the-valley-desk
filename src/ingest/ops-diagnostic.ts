import type { OpsJwtDenialReason } from "./ops-jwt";

export type OpsDiagnosticConfig = { OPS_DIAGNOSTIC_ENABLED?: string };
export const OPS_DIAGNOSTIC_MAX_WINDOW_MS = 30 * 60_000;
export const OPS_DIAGNOSTIC_HEADER = "x-tvd-ops-diagnostic";

// Build-bound review inputs. This candidate has no enablement window, so even
// a runtime switch cannot disclose a category. Changing these requires a new
// exact artifact review and specific approval, never request/env discovery.
export const OPS_DIAGNOSTIC_WINDOW_START_UTC = "";
export const OPS_DIAGNOSTIC_WINDOW_END_UTC = "";

const reasons: readonly OpsJwtDenialReason[] = Object.freeze([
  "configuration-unavailable", "assertion-missing", "header-rejected",
  "key-unavailable", "token-rejected", "identity-rejected",
]);

function reviewedTimestamp(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return undefined;
  const time = Date.parse(value);
  if (!Number.isSafeInteger(time) || time < 0 || new Date(time).toISOString() !== value) return undefined;
  return time;
}

/** Captures immutable primitive timestamps; request/env inputs cannot extend them. */
export function createOpsDenialDiagnostic(startUTC: string, endUTC: string) {
  const start = reviewedTimestamp(startUTC);
  const end = reviewedTimestamp(endUTC);
  const validWindow = start !== undefined && end !== undefined
    && end > start && end - start <= OPS_DIAGNOSTIC_MAX_WINDOW_MS;
  return (request: Request, enabled: unknown, reason: unknown, nowMs: number): OpsJwtDenialReason | undefined => {
    if (!validWindow || enabled !== "true" || !Number.isSafeInteger(nowMs)
      || nowMs < start! || nowMs >= end!) return undefined;
    // Match the canonical Request URL after standard URL normalization. This
    // also excludes an empty query delimiter, fragments, encoded path aliases,
    // nondefault ports, HEAD, mutation methods and every API route.
    if (request.method !== "GET" || (request.url !== "https://thevalleydesk.org/ops"
      && request.url !== "https://thevalleydesk.org/ops/")) return undefined;
    return reasons.includes(reason as OpsJwtDenialReason) ? reason as OpsJwtDenialReason : undefined;
  };
}

export const opsDenialDiagnostic = createOpsDenialDiagnostic(
  OPS_DIAGNOSTIC_WINDOW_START_UTC, OPS_DIAGNOSTIC_WINDOW_END_UTC,
);
