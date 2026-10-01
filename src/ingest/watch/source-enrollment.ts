import { z } from "zod";
import { CanonicalInstant, HttpsUrl, Sha256, SourceDate, WatchId, WatchJurisdiction, canonicalJson, sha256, tupleKey } from "../../content/watch-schema";
import { normalizeSourceUrl } from "../identity";
import { SOURCE_RUN_STATES, classifyHttpStatus, sourceStateForItemCount, type SnapshotCompleteness, type SourceRunNote } from "../source-health";

const Label = z.string().trim().min(1).max(240);
export const ScopedUrl = HttpsUrl.refine(value => !/[\u0000-\u0020\u007f]/.test(value), "URL must not contain raw whitespace or controls");
const Endpoint = ScopedUrl.refine(value => { try { return !new URL(value).hash; } catch { return false; } }, "Fetch endpoints cannot contain fragments");
const Host = z.string().max(253).regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/).refine(value => !value.includes(".."));
const LinkScope = z.object({ host: Host, pathPrefix: z.string().min(1).max(1000).regex(/^\/(?:[^?#\s]*)$/) }).strict();
export const SourceEnrollment = z.object({ id: WatchId, name: Label, state: z.enum(["pending", "qualified", "disabled"]),
  desk: z.enum(["news", "events", "policy", "technology"]), jurisdiction: WatchJurisdiction,
  family: z.enum(["legislation", "regulation", "dockets", "members", "news", "events", "technology"]),
  transport: z.enum(["rss", "atom", "github-json", "official-json", "official-xml", "official-zip-xml", "html", "batch"]),
  parserId: WatchId, parserVersion: Label, endpoints: z.array(Endpoint).min(1).max(20),
  linkScopes: z.array(LinkScope).min(1).max(20), authority: z.enum(["official", "first-party", "secondary", "discovery-only", "unqualified"]),
  dateTimezone: Label.nullable(), requiresAuth: z.boolean(),
  collectionMode: z.enum(["rolling", "paged-inventory"]), maxBytes: z.number().int().min(1024).max(2_000_000),
  maxItems: z.number().int().min(1).max(100), qualificationReceiptId: WatchId.nullable(),
  paExport: z.object({ sessionYear: z.literal(2025), session: z.literal(0),
    selectedBills: z.array(z.enum(["HB1925", "HB1993", "SB1113", "HB2787"])).min(1).max(4),
    memberName: z.literal("PA-Bill-History-2025-RegularSession.xml"),
    maxExpandedBytes: z.literal(67108864), maxEntries: z.literal(100),
    normalizerVersion: z.literal("watch-pa-zip-xml-v1") }).strict().optional(),
}).strict().superRefine((value, context) => {
  if ((value.transport === "official-zip-xml") !== !!value.paExport ||
      (value.paExport && (new Set(value.paExport.selectedBills).size !== value.paExport.selectedBills.length || value.maxItems < value.paExport.selectedBills.length)))
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["paExport"], message: "Explicit bounded binary profile required" });
  if (new Set(value.endpoints).size !== value.endpoints.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["endpoints"], message: "Duplicate endpoint" });
  if (value.state === "qualified" && !value.qualificationReceiptId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["qualificationReceiptId"], message: "Qualification receipt required" });
  if (value.dateTimezone) try { new Intl.DateTimeFormat("en", { timeZone: value.dateTimezone }).format(); } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["dateTimezone"], message: "Unknown source time zone" });
  }
});
export type SourceEnrollment = z.infer<typeof SourceEnrollment>;
export const QualificationReceipt = z.object({ id: WatchId, sourceId: WatchId, configurationSha256: Sha256,
  reviewedAt: CanonicalInstant, expiresAt: CanonicalInstant, engineeringOwnerId: WatchId, editorialOwnerId: WatchId,
  reviewEvidenceId: WatchId, rightsDecision: z.literal("accepted"), accessDecision: z.literal("public-or-authorized-read"),
  negativeFixtureSha256: Sha256, replayFixtureSha256: Sha256,
  samples: z.array(z.object({ endpoint: Endpoint, representationSha256: Sha256, capturedAt: CanonicalInstant,
    parserVersion: Label, itemCount: z.number().int().nonnegative().max(100), outcome: z.literal("parsed") }).strict()).min(2).max(10),
}).strict().superRefine((value, context) => {
  if (value.expiresAt <= value.reviewedAt || value.samples.some(sample => sample.capturedAt > value.reviewedAt) ||
      new Set(value.samples.map(sample => `${sample.endpoint}:${sample.capturedAt}`)).size !== value.samples.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Receipt dates and distinct samples must be coherent" });
  }
});
export type QualificationReceipt = z.infer<typeof QualificationReceipt>;

export async function sourceConfigurationDigest(input: unknown): Promise<string> {
  const source = SourceEnrollment.parse(input);
  return sha256(canonicalJson({ id: source.id, name: source.name, desk: source.desk, jurisdiction: source.jurisdiction,
    family: source.family, transport: source.transport, parserId: source.parserId, parserVersion: source.parserVersion,
    endpoints: [...source.endpoints].sort(), linkScopes: [...source.linkScopes].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))),
    authority: source.authority, dateTimezone: source.dateTimezone, requiresAuth: source.requiresAuth,
    collectionMode: source.collectionMode, maxBytes: source.maxBytes, maxItems: source.maxItems,
    ...(source.paExport ? { paExport: source.paExport } : {}) }));
}

// Both collections are server-owned operational state, never config/model flags.
// This predicate has no fetch side effect and grants no publication authority.
export async function collectionReadiness(input: unknown, context: {
  now: string; activeSourceIds: ReadonlySet<string>; receipts: ReadonlyMap<string, unknown>;
}): Promise<{ ready: boolean; reason: string }> {
  const parsed = SourceEnrollment.safeParse(input);
  if (!parsed.success || !CanonicalInstant.safeParse(context.now).success) return { ready: false, reason: "invalid-source-contract" };
  const source = parsed.data;
  if (source.state !== "qualified") return { ready: false, reason: source.state === "disabled" ? "source-disabled" : "qualification-pending" };
  if (!context.activeSourceIds.has(source.id)) return { ready: false, reason: "activation-not-authorized" };
  const receipt = QualificationReceipt.safeParse(context.receipts.get(source.qualificationReceiptId!));
  if (!receipt.success || receipt.data.id !== source.qualificationReceiptId || receipt.data.sourceId !== source.id ||
      receipt.data.configurationSha256 !== await sourceConfigurationDigest(source) || receipt.data.reviewedAt > context.now ||
      context.now >= receipt.data.expiresAt || receipt.data.samples.some(sample => !source.endpoints.includes(sample.endpoint) || sample.parserVersion !== source.parserVersion)) {
    return { ready: false, reason: "qualification-receipt-missing-stale-or-conflicting" };
  }
  return { ready: true, reason: "qualified-and-separately-authorized" };
}

export function sourceEndpointAllowed(source: SourceEnrollment, raw: string): boolean {
  if (!Endpoint.safeParse(raw).success) return false;
  const url = new URL(raw);
  return source.endpoints.some(endpoint => new URL(endpoint).href === url.href);
}
export function sourceLinkAllowed(source: SourceEnrollment, raw: string): boolean {
  if (!ScopedUrl.safeParse(raw).success) return false;
  const url = new URL(raw);
  return source.linkScopes.some(scope => scope.host === url.hostname && (scope.pathPrefix === "/" ||
    url.pathname === scope.pathPrefix.replace(/\/+$/, "") || url.pathname.startsWith(`${scope.pathPrefix.replace(/\/+$/, "")}/`)));
}
export function watchUrlIdentity(raw: string): string {
  const source = new URL(ScopedUrl.parse(raw)), normalized = normalizeSourceUrl(source.href);
  if (!normalized) throw new Error("invalid-source-url");
  const identity = new URL(normalized);
  // Reuse existing host/path normalization without dropping a bill/document's
  // identity-bearing query or fragment. Transport still uses the original URL.
  identity.search = source.search; identity.hash = source.hash;
  return identity.href;
}

export const WatchObservation = z.object({ id: WatchId, sourceId: WatchId, externalKey: z.string().min(1).max(2048),
  parserId: WatchId, parserVersion: Label, sourceUrl: ScopedUrl, fetchedAt: CanonicalInstant,
  representationSha256: Sha256, payloadSha256: Sha256, payload: z.unknown(),
}).strict().superRefine((value, context) => {
  try { if (new TextEncoder().encode(canonicalJson(value.payload)).byteLength > 32_000) throw new Error(); } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["payload"], message: "Observation payload must be bounded JSON" });
  }
});
export type WatchObservation = z.infer<typeof WatchObservation>;
export async function observationKey(source: SourceEnrollment, externalKey: string, representationSha256: string): Promise<string> {
  z.string().min(1).max(2048).parse(externalKey); Sha256.parse(representationSha256);
  return tupleKey("watch-observation-v1", [source.id, await sha256(externalKey), source.parserId, source.parserVersion, representationSha256]);
}
export async function makeObservation(source: SourceEnrollment, input: {
  externalKey: string; representationSha256: string; sourceUrl: string; fetchedAt: string; payload: unknown;
}): Promise<WatchObservation> {
  const id = await observationKey(source, input.externalKey, input.representationSha256);
  return WatchObservation.parse({ id, sourceId: source.id, externalKey: input.externalKey, parserId: source.parserId,
    parserVersion: source.parserVersion, representationSha256: input.representationSha256, sourceUrl: input.sourceUrl,
    fetchedAt: input.fetchedAt, payloadSha256: await sha256(canonicalJson(input.payload)), payload: input.payload });
}
export const DiscoveryCandidate = z.object({ id: WatchId, observationId: WatchId, sourceId: WatchId,
  externalKey: z.string().min(1).max(2048), title: z.string().trim().min(1).max(500), url: ScopedUrl,
  description: z.string().max(8000), sourceOccurredAt: SourceDate,
  discoveryClass: z.enum(["feed-item", "repository-baseline", "release", "prerelease", "unpublished-draft", "undated-release", "tag", "commit"]),
  holds: z.array(z.enum(["source-date-unknown", "instruction-like-source", "unpublished-draft"])).max(3),
  publicationAuthorized: z.literal(false), regionalEligibility: z.literal("unverified"), licenseAuthority: z.literal("unreviewed"),
}).strict();
export type DiscoveryCandidate = z.infer<typeof DiscoveryCandidate>;
export type WatchAdapterHealth = Pick<SourceRunNote, "id" | "origin" | "state" | "checkedAt" | "itemCount" | "complete" | "completeness" | "url" | "error" | "httpStatus" | "requiresAuth">;
export type WatchSnapshotResult = {
  observations: WatchObservation[]; candidates: DiscoveryCandidate[]; health: WatchAdapterHealth;
  representationSha256: string | null; truncated: boolean; rejectedItems: number;
  pagination: { pageKey: string; nextPageKey: string | null; terminal: boolean };
};
export type SnapshotInput = { source: unknown; body: string; representationBytes?: Uint8Array; representationKind?: "pa-zip-xml"; finalUrl: string; fetchedAt: string; status?: number;
  pageKey?: string; nextPageKey?: string | null; terminal?: boolean };
export function snapshotHealth(source: SourceEnrollment, input: SnapshotInput, count: number, options: {
  error?: string; complete?: boolean; completeness?: SnapshotCompleteness; parserFailed?: boolean;
} = {}): WatchAdapterHealth {
  const status = input.status ?? 200;
  const state = status !== 200 ? classifyHttpStatus(status, { requiresAuth: source.requiresAuth })
    : options.parserFailed ? "parser-failed" : sourceStateForItemCount(count);
  return { id: source.id, origin: source.name, state, checkedAt: input.fetchedAt,
    itemCount: count, complete: options.complete ?? false, completeness: state === "healthy-empty" ? "empty-unverified" : options.completeness ?? "partial",
    url: input.finalUrl, httpStatus: status, requiresAuth: source.requiresAuth, ...(options.error ? { error: options.error } : {}) };
}
export function checkedSnapshot(input: SnapshotInput, transport: SourceEnrollment["transport"][]) {
  const source = SourceEnrollment.parse(input.source);
  CanonicalInstant.parse(input.fetchedAt);
  if (!transport.includes(source.transport) || !sourceEndpointAllowed(source, input.finalUrl)) throw new Error("snapshot-source-scope-conflict");
  if ((input.representationBytes?.byteLength ?? new TextEncoder().encode(input.body).byteLength) > source.maxBytes) throw new Error("snapshot-byte-limit");
  if (source.transport === "official-zip-xml") {
    if (input.representationKind !== "pa-zip-xml" || !input.representationBytes) throw new Error("snapshot-binary-contract-required");
  } else if (input.representationKind || (input.representationBytes && new TextDecoder("utf-8", { fatal: true }).decode(input.representationBytes) !== input.body)) throw new Error("snapshot-bytes-text-conflict");
  if (!input.body.trim() && (input.status ?? 200) === 200) throw new Error("empty-response-body");
  return source;
}
export function snapshotRepresentationDigest(input: SnapshotInput): Promise<string> {
  // Collectors provide retained bytes. The string fallback is an explicit UTF-8
  // representation for in-memory/offline inputs, not a hash of HTTP wire bytes.
  return sha256(input.representationBytes ?? input.body);
}
export function failedSnapshot(source: SourceEnrollment, input: SnapshotInput, representationSha256: string | null, error: string): WatchSnapshotResult {
  return { observations: [], candidates: [], health: snapshotHealth(source, input, 0, { error, parserFailed: true }),
    representationSha256, truncated: false, rejectedItems: 0, pagination: { pageKey: input.pageKey ?? "1", nextPageKey: null, terminal: false } };
}

export const PersistenceAcknowledgment = z.object({ observationId: WatchId, sourceId: WatchId,
  representationSha256: Sha256, payloadSha256: Sha256, firstSeenAt: CanonicalInstant, persistedAt: CanonicalInstant, receiptId: WatchId,
}).strict();
export type PersistenceAcknowledgment = z.infer<typeof PersistenceAcknowledgment>;

// Acknowledgments must be resolved from successful durable writes, not submitted
// by a collector. This only unlocks proposed inputs; ordinary editorial gates remain.
export async function proposedModelInputsAfterPersistence(result: WatchSnapshotResult, persisted: ReadonlyMap<string, unknown>): Promise<DiscoveryCandidate[]> {
  if (new Set(result.observations.map(item => item.id)).size !== result.observations.length) throw new Error("duplicate-observation-identity");
  for (const observation of result.observations) {
    WatchObservation.parse(observation);
    const ack = PersistenceAcknowledgment.safeParse(persisted.get(observation.id));
    if (!ack.success || ack.data.observationId !== observation.id || ack.data.sourceId !== observation.sourceId ||
        ack.data.representationSha256 !== observation.representationSha256 || ack.data.payloadSha256 !== observation.payloadSha256 ||
        ack.data.firstSeenAt > observation.fetchedAt || ack.data.persistedAt < ack.data.firstSeenAt ||
        await sha256(canonicalJson(observation.payload)) !== observation.payloadSha256) throw new Error("raw-persistence-acknowledgment-required");
  }
  const ids = new Set(result.observations.map(observation => observation.id));
  for (const candidate of result.candidates) {
    const observation = result.observations.find(item => item.id === candidate.observationId);
    if (!ids.has(candidate.observationId) || !observation || candidate.sourceId !== observation.sourceId || candidate.externalKey !== observation.externalKey ||
        typeof observation.payload !== "object" || !observation.payload ||
        canonicalJson((observation.payload as Record<string, unknown>).candidate) !== canonicalJson(candidate)) throw new Error("candidate-observation-binding-conflict");
  }
  return result.candidates.filter(candidate => !candidate.holds.includes("instruction-like-source") && !candidate.holds.includes("unpublished-draft"))
    .map(candidate => DiscoveryCandidate.parse(candidate));
}

export const SnapshotPageReceipt = z.object({ sourceId: WatchId, snapshotId: WatchId, parserVersion: Label,
  pageKey: Label, nextPageKey: Label.nullable(), terminal: z.boolean(), completeness: z.enum(["complete", "partial", "empty-unverified"]),
  state: z.enum(SOURCE_RUN_STATES), truncated: z.boolean(), rejectedItems: z.number().int().nonnegative(),
  observationIds: z.array(WatchId).max(100), representationSha256: Sha256,
}).strict();
export type SnapshotPageReceipt = z.infer<typeof SnapshotPageReceipt>;
export async function snapshotPageDigest(input: unknown): Promise<string> {
  return sha256(canonicalJson(SnapshotPageReceipt.parse(input)));
}
export const PagePersistenceAcknowledgment = z.object({ sourceId: WatchId, snapshotId: WatchId, pageKey: Label,
  pageReceiptSha256: Sha256, persistedAt: CanonicalInstant, receiptId: WatchId,
}).strict();
export type PagePersistenceAcknowledgment = z.infer<typeof PagePersistenceAcknowledgment>;

// Page acknowledgments include empty pages. Missing terminal pages and writes
// that failed after parsing cannot advance a durable checkpoint.
export async function checkpointAfterPersistence(input: {
  sourceId: string; snapshotId: string; parserVersion: string; firstPageKey: string; pages: unknown[];
  persisted: ReadonlyMap<string, unknown>; persistedPages: ReadonlyMap<string, unknown>;
}): Promise<{ sourceId: string; snapshotId: string; parserVersion: string; completedPageKeys: string[]; fullSnapshot: boolean }> {
  if (!input.pages.length || input.pages.length > 100) throw new Error("checkpoint-pages-required");
  const pages = input.pages.map(page => SnapshotPageReceipt.parse(page));
  let next: string | null = input.firstPageKey;
  const seen = new Set<string>();
  for (const page of pages) {
    if (page.sourceId !== input.sourceId || page.snapshotId !== input.snapshotId || page.parserVersion !== input.parserVersion ||
        page.pageKey !== next || seen.has(page.pageKey) || page.truncated || page.rejectedItems ||
        !["healthy", "healthy-empty"].includes(page.state) || page.terminal !== (page.nextPageKey === null) ||
        new Set(page.observationIds).size !== page.observationIds.length ||
        (page.state === "healthy-empty") !== (page.observationIds.length === 0)) throw new Error("checkpoint-incomplete-or-conflicting");
    const pageAck = PagePersistenceAcknowledgment.safeParse(input.persistedPages.get(page.pageKey));
    if (!pageAck.success || pageAck.data.sourceId !== page.sourceId || pageAck.data.snapshotId !== page.snapshotId ||
        pageAck.data.pageKey !== page.pageKey || pageAck.data.pageReceiptSha256 !== await snapshotPageDigest(page)) throw new Error("checkpoint-unpersisted-page");
    for (const id of page.observationIds) {
      const ack = PersistenceAcknowledgment.safeParse(input.persisted.get(id));
      if (!ack.success || ack.data.observationId !== id || ack.data.sourceId !== page.sourceId || ack.data.representationSha256 !== page.representationSha256) throw new Error("checkpoint-unpersisted-observation");
    }
    seen.add(page.pageKey); next = page.nextPageKey;
  }
  if (next !== null || !pages[pages.length - 1]!.terminal) throw new Error("checkpoint-terminal-page-required");
  return { sourceId: input.sourceId, snapshotId: input.snapshotId, parserVersion: input.parserVersion,
    completedPageKeys: pages.map(page => page.pageKey), fullSnapshot: pages.every(page => page.completeness === "complete" && page.observationIds.length > 0) };
}
