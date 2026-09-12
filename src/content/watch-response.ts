import { z } from "zod";
import { WATCH_CURSOR_LIMIT, WATCH_PAGE_LIMIT, type WatchKind } from "./watch-query";
import { CanonicalInstant, MAX_PUBLIC_WATCH_BYTES, WatchPublicRecord } from "./watch-schema";

export const WatchDirectoryResponse = z.object({
  version: z.literal("watch-directory-1"), generation: z.number().int().nonnegative().safe(),
  asOf: CanonicalInstant.nullable(), items: z.array(WatchPublicRecord).max(WATCH_PAGE_LIMIT),
  nextCursor: z.string().min(1).max(WATCH_CURSOR_LIMIT).refine(value => !/[\u0000-\u001f\u007f]/.test(value)).nullable(),
}).strict();
export const WatchDetailResponse = z.object({
  version: z.literal("watch-detail-1"), item: WatchPublicRecord, asOf: CanonicalInstant.nullable(),
}).strict();
export type WatchDirectoryResponse = z.infer<typeof WatchDirectoryResponse>;
export type WatchDetailResponse = z.infer<typeof WatchDetailResponse>;
export type WatchReadData = { response: WatchDirectoryResponse | WatchDetailResponse; stale: boolean };
export type WatchReadErrorCode = "not-found" | "held" | "unavailable" | "invalid-query" | "cursor-expired" | "invalid-response" | "network" | "timeout";

export class WatchReadError extends Error {
  constructor(public readonly code: WatchReadErrorCode) { super(code); this.name = "WatchReadError"; }
}

function evidenceComplete(item: WatchPublicRecord): boolean {
  const ids = new Set(item.sources.map(source => source.id));
  if (ids.size !== item.sources.length) return false;
  const bound = (fact: { evidenceIds: string[] } | null) => !fact || fact.evidenceIds.every(id => ids.has(id));
  if (item.kind === "policy") {
    const actions = [...item.timeline, ...(item.latestAction ? [item.latestAction] : [])];
    return new Set(item.timeline.map(action => action.value.id)).size === item.timeline.length &&
      item.jurisdiction === item.identity.value.jurisdiction &&
      item.lifecycle === (item.lifecycleFact?.value ?? "unknown") &&
      item.legalEffect === (item.legalEffectFact?.value ?? "unknown") &&
      (item.interpretation.readiness === "reviewed" ? item.interpretation.summary !== null : item.interpretation.summary === null) &&
      [item.identity, item.summary, item.lifecycleFact, item.legalEffectFact, item.interpretation.summary, ...actions].every(bound) &&
      actions.every(action => action.value.sourceOccurredAt.precision === "unknown" ||
        action.value.sourceOccurredAt.evidenceIds.every(id => action.evidenceIds.includes(id)));
  }
  const artifacts = new Map(item.artifacts.map(artifact => [artifact.value.id, artifact.value]));
  return artifacts.size === item.artifacts.length &&
    new Set(item.localRelationships.map(relation => relation.value.id)).size === item.localRelationships.length &&
    [item.purpose, item.intendedUsers, item.workflow, item.setup, item.limitations, ...item.artifacts, ...item.localRelationships, ...item.licenses].every(bound) &&
    item.artifacts.every(artifact => artifact.value.resourceId === item.id) &&
    item.localRelationships.every(relation => relation.value.resourceId === item.id && artifacts.has(relation.value.artifactId) && item.organizationIds.includes(relation.value.entityId)) &&
    item.organizationIds.every(id => item.localRelationships.some(relation => relation.value.entityId === id)) &&
    item.licenses.every(license => artifacts.get(license.value.artifactId)?.version === license.value.artifactVersion);
}

/** Transport validation does not grant publication authority; only server projection does. */
export function parseWatchResponse(value: unknown, kind: WatchKind, slug?: string) {
  const parsed = slug === undefined ? WatchDirectoryResponse.safeParse(value) : WatchDetailResponse.safeParse(value);
  if (!parsed.success) throw new WatchReadError("invalid-response");
  const response = parsed.data;
  const items = response.version === "watch-directory-1" ? response.items : [response.item];
  if (items.some(item => item.kind !== kind || !evidenceComplete(item)) ||
      new Set(items.map(item => item.id)).size !== items.length ||
      new Set(items.map(item => item.slug)).size !== items.length ||
      (slug !== undefined && (response.version !== "watch-detail-1" || response.item.slug !== slug))) {
    throw new WatchReadError("invalid-response");
  }
  return response;
}

async function boundedJson(response: Response, maximum: number): Promise<unknown> {
  const length = Number(response.headers.get("content-length"));
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "") ||
      (Number.isFinite(length) && length > maximum)) {
    await response.body?.cancel().catch(() => undefined);
    throw new WatchReadError("invalid-response");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new WatchReadError("invalid-response");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new WatchReadError("invalid-response");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof WatchReadError) throw error;
    throw new WatchReadError("invalid-response");
  } finally { reader.releaseLock(); }
}

/** Decode the identical bounded envelope for browser reads and internal page reads. */
export async function decodeWatchResponse(response: Response, kind: WatchKind, slug?: string): Promise<WatchReadData> {
  if (!response.ok) {
    const code: WatchReadErrorCode = response.status === 404 ? "not-found" : response.status === 409 ? "held" :
      response.status === 400 ? "invalid-query" : response.status === 410 ? "cursor-expired" : "unavailable";
    await response.body?.cancel().catch(() => undefined);
    throw new WatchReadError(code);
  }
  const maximum = MAX_PUBLIC_WATCH_BYTES * (slug === undefined ? WATCH_PAGE_LIMIT : 1) + 16_384;
  return { response: parseWatchResponse(await boundedJson(response, maximum), kind, slug),
    stale: response.headers.get("X-Watch-Data-State") === "stale" };
}
