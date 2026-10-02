import { z } from "zod";
const Instant = z.string().refine(value => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const Age = z.number().int().positive().max(7 * 86_400_000);
/** Explicit reviewed local bounds, not a claim about publisher weekend service. */
export const PaFreshnessPolicy = z.object({ weekdayMaxAgeMs: Age, weekendMaxAgeMs: Age,
  reviewMaxAgeMs: Age, evidenceReceiptId: z.string().min(1).max(240) }).strict();
export type PaFreshnessPolicy = z.infer<typeof PaFreshnessPolicy>;
export const PaSourceFreshness = z.object({ exportAt: Instant.nullable(), exportAgeMs: z.number().nonnegative().nullable(),
  billLastUpdateAt: Instant.nullable(), lastCheckedAt: Instant.nullable(), lastSuccessfulUpstreamCheckAt: Instant.nullable(),
  currentFailure: z.string().max(500).nullable(), origin: z.enum(["library-research", "browser-original", "upstream", "unknown"]),
  freshness: z.enum(["unknown", "fresh", "stale", "invalid", "regressed"]),
  boundMs: Age.nullable(), latestStatusVerified: z.literal(false),
}).strict();
export type PaSourceFreshness = z.infer<typeof PaSourceFreshness>;
export function paSnapshotFreshness(input: { exportAt: string | null; billLastUpdateAt?: string | null;
  lastCheckedAt: string | null; lastSuccessfulUpstreamCheckAt: string | null; currentFailure: string | null;
  origin: PaSourceFreshness["origin"]; previousExportAt?: string | null }, now: string, policy?: PaFreshnessPolicy | null): PaSourceFreshness {
  const valid = (value: string | null | undefined): value is string => Instant.safeParse(value).success;
  const clocks = [input.exportAt, input.billLastUpdateAt, input.lastCheckedAt, input.lastSuccessfulUpstreamCheckAt, input.previousExportAt].filter(value => value != null);
  const invalid = !valid(now) || clocks.some(value => !valid(value) || value > now) ||
    (!!input.billLastUpdateAt && !!input.exportAt && input.billLastUpdateAt > input.exportAt) ||
    (!!input.lastSuccessfulUpstreamCheckAt && !!input.lastCheckedAt && input.lastSuccessfulUpstreamCheckAt > input.lastCheckedAt);
  const reviewed = PaFreshnessPolicy.safeParse(policy);
  const weekend = valid(now) && ["Sat", "Sun"].includes(new Intl.DateTimeFormat("en-US", {timeZone:"America/New_York",weekday:"short"}).format(new Date(now)));
  const boundMs = reviewed.success ? (weekend ? reviewed.data.weekendMaxAgeMs : reviewed.data.weekdayMaxAgeMs) : null;
  const exportAgeMs = !invalid && valid(input.exportAt) ? Date.parse(now) - Date.parse(input.exportAt) : null;
  const regressed = !!input.previousExportAt && !!input.exportAt && input.exportAt < input.previousExportAt;
  return { exportAt: valid(input.exportAt) ? input.exportAt : null, exportAgeMs,
    billLastUpdateAt: valid(input.billLastUpdateAt) ? input.billLastUpdateAt : null,
    lastCheckedAt: valid(input.lastCheckedAt) ? input.lastCheckedAt : null,
    lastSuccessfulUpstreamCheckAt: input.origin === "upstream" && valid(input.lastSuccessfulUpstreamCheckAt) ? input.lastSuccessfulUpstreamCheckAt : null,
    currentFailure: input.currentFailure, origin: input.origin, boundMs,
    freshness: invalid ? "invalid" : regressed ? "regressed" : exportAgeMs === null || boundMs === null ? "unknown" : exportAgeMs >= boundMs ? "stale" : "fresh",
    latestStatusVerified: false };
}

export const PaHealthEntry = z.object({subjectId:z.string().min(1).max(240),sourceId:z.string().min(1).max(240),health:PaSourceFreshness}).strict();
export type PaHealthEntry = z.infer<typeof PaHealthEntry>;
