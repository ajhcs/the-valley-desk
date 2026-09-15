import { z } from "zod";
import { CanonicalInstant, PublicCitation, SourceDate, WatchId } from "./watch-schema";
import { isWatchSlug, WATCH_CURSOR_LIMIT, WATCH_PAGE_LIMIT, type WatchKind } from "./watch-query";

const Label = z.string().trim().min(1).max(240);
export const WatchUpdate = z.object({
  id: WatchId, subjectId: WatchId, subjectSlug: z.string().refine(isWatchSlug),
  subjectTitle: Label, title: Label, summary: z.string().trim().min(1).max(6000).nullable(),
  type: z.enum(["policy-action", "software-release", "paper-publication", "dataset-release", "product-release"]),
  sourceOccurredAt: SourceDate.refine(value => value.precision !== "unknown", "Latest requires a source date"),
  sources: z.array(PublicCitation).min(1).max(20),
}).strict().superRefine((item, context) => {
  const ids = new Set(item.sources.map(source => source.id));
  if (ids.size !== item.sources.length ||
      item.sourceOccurredAt.evidenceIds.some(id => !ids.has(id))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Update source-date evidence must be complete" });
  }
});
export type WatchUpdate = z.infer<typeof WatchUpdate>;
export const WatchUpdatesResponse = z.object({
  version: z.literal("watch-updates-1"), kind: z.enum(["policy", "technology"]),
  generation: z.number().int().nonnegative().safe(), asOf: CanonicalInstant.nullable(),
  items: z.array(WatchUpdate).max(WATCH_PAGE_LIMIT),
  nextCursor: z.string().min(1).max(WATCH_CURSOR_LIMIT).refine(value => !/[\u0000-\u001f\u007f]/.test(value)).nullable(),
}).strict().superRefine((value, context) => {
  if (new Set(value.items.map(item => item.id)).size !== value.items.length ||
      value.items.some(item => value.kind === "policy" ? item.type !== "policy-action" : item.type === "policy-action") ||
      (value.items.length > 0 && (value.generation === 0 || value.asOf === null))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Update kind, identities and snapshot must agree" });
  }
});
export type WatchUpdatesResponse = z.infer<typeof WatchUpdatesResponse>;
export const MAX_WATCH_UPDATES_BYTES = 1000000;
export function parseWatchUpdates(value: unknown, kind: WatchKind) {
  const result = WatchUpdatesResponse.parse(value);
  if (result.kind !== kind) throw new TypeError("Wrong Watch update desk");
  return result;
}
