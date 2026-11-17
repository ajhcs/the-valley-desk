import { legacyUtcDatetime } from "../lib/schema-compat";
import bundledSnapshot from "../../fixtures/regional-discovery-read-snapshot-v1.json";
import { z } from "zod";
import { REGIONAL_CHANNELS } from "./regional-contracts";
import { RegionalAgentResult, RegionalDiscoveryResult, RegionalDiscoveryRecordResult, RegionalSourceReadQuery,
  RegionalDiscoveryQuery, RegionalDiscoveryRecordQuery, safeRegionalAgentError } from "../agents/regional-agent-contract";

const PREFIX = "/ops/api/agent/";
const TTL = 15 * 60_000;
const endpoints = { "regional-source-inventory": "inventory", "regional-discovery-candidates": "candidates",
  "regional-discovery-record": "record" } as const;
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
  .map(byte => byte.toString(16).padStart(2, "0")).join("");
const Id = z.string().regex(/^[a-z][a-z0-9-]+$/).max(200);
const Tool = z.object({ name: z.enum(["regional_source_inventory", "regional_discovery_candidates", "regional_discovery_record"]),
  title: z.string().max(100), description: z.string().max(1000), inputSchema: z.record(z.string(), z.unknown()), outputSchema: z.record(z.string(), z.unknown()),
  annotations: z.object({ readOnlyHint: z.literal(true), destructiveHint: z.literal(false), idempotentHint: z.literal(true), openWorldHint: z.literal(false) }).strict() }).strict();
const Data = z.object({ schemaVersion: z.literal(1), preparedAt: legacyUtcDatetime(), provenancePolicy: z.string().max(600),
  tools: z.array(Tool).length(3), inventoryResult: RegionalAgentResult,
  inventoryInstitutionIds: z.array(Id).max(500), inventoryGaps: z.array(z.object({ institutionId: Id,
    channel: z.enum(REGIONAL_CHANNELS) }).strict()).max(2500),
  discoveryInstitutionIds: z.array(Id).max(500), discoveryBase: RegionalDiscoveryResult,
  records: z.array(RegionalDiscoveryRecordResult).max(100) }).strict();
function json(value: unknown, status = 200, cap = 131072) {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).length > cap) return json(safeRegionalAgentError(new Error("read-unavailable")), 503);
  return new Response(body, { status, headers: { "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
}
async function requestJson(request: Request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new Error("invalid-cursor-content-type");
  const reader = request.body?.getReader(); if (!reader) throw new Error("invalid-cursor-body");
  const parts: Uint8Array[] = []; let size = 0, expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}); }, 10000);
  try {
    while (true) { const part = await reader.read(); if (expired) throw new Error("read-unavailable"); if (part.done) break;
      size += part.value.length; if (size > 16384) { await reader.cancel(); throw new Error("invalid-cursor-body-size"); } parts.push(part.value); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new Error("invalid-cursor-json"); }
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
/** Only invoke AFTER trusted Ops identity and same-origin POST checks. No D1/fetch/model/SDK dependency. */
export async function createRegionalWorkerReadHandler(bundle: unknown = bundledSnapshot, clock: () => number = Date.now) {
  const envelope = z.object({ manifestSha256: z.string().regex(/^[a-f0-9]{64}$/), data: z.unknown() }).strict().parse(bundle);
  if (await hash(JSON.stringify(envelope.data)) !== envelope.manifestSha256) throw new Error("invalid-regional-worker-manifest");
  const data = Data.parse(envelope.data);
  if (new Set(data.records.map(row => row.record.recordId)).size !== data.records.length ||
      new Set(data.tools.map(row => row.name)).size !== 3) throw new Error("invalid-regional-worker-snapshot");
  const snapshot = async (kind: string) => {
    const now = clock(); if (!Number.isFinite(now) || now < Date.parse(data.preparedAt)) throw new Error("regional-view-expired-or-future");
    const asOf = new Date(Math.floor(now / TTL) * TTL).toISOString(), expiresAt = new Date(Math.floor(now / TTL) * TTL + TTL).toISOString();
    return { schemaVersion: 1 as const, asOf, expiresAt, snapshotId: await hash(JSON.stringify({ manifestSha256: envelope.manifestSha256, kind, asOf, expiresAt })) };
  };
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url), key = url.pathname.slice(PREFIX.length);
    if (!url.pathname.startsWith(PREFIX) || url.search || !(key === "tools" || Object.hasOwn(endpoints, key))) return json({ error: "not_found" }, 404);
    if (request.method !== (key === "tools" ? "GET" : "POST")) return json({ error: "method_not_allowed" }, 405);
    if (key === "tools") return json({ tools: data.tools }, 200, 65536);
    try {
      const args = await requestJson(request);
      if (key === "regional-source-inventory") {
        const query = RegionalSourceReadQuery.parse(args), view = await snapshot("inventory");
        if (query.institutionIds?.some(id => !data.inventoryInstitutionIds.includes(id))) throw new Error("unknown-read-view-institution");
        const ids = query.institutionIds ?? data.inventoryInstitutionIds;
        const rows = data.inventoryResult.results.filter(row => ids.includes(row.institutionId) && (!query.channels || query.channels.includes(row.channel)) &&
          (!query.configurations || query.configurations.includes(row.configuration)));
        const filterKey = JSON.stringify({ institutionIds: query.institutionIds ? [...query.institutionIds].sort() : null,
          channels: query.channels ? [...query.channels].sort() : null, configurations: query.configurations ? [...query.configurations].sort() : null });
        let start = 0;
        if (query.cursor) {
          if (query.cursor.snapshotId !== view.snapshotId) throw new Error("regional-view-expired-or-future");
          if (query.cursor.filterKey !== filterKey) throw new Error("invalid-cursor-context");
          const index = rows.findIndex(row => row.sourceId === query.cursor!.afterSourceId); if (index < 0) throw new Error("invalid-cursor-source"); start = index + 1;
        }
        const page = rows.slice(start, start + query.limit);
        return json(RegionalAgentResult.parse({ ...data.inventoryResult, snapshot: view,
          freshnessBasis: "Historical bundled registry projection; no live source-health receipts supplied. Snapshot timestamps bound pagination, not source observation freshness.",
          counts: { ...data.inventoryResult.counts, institutionsInFilter: ids.length, sourcesInFilter: rows.length,
            configuredSourcesInFilter: rows.filter(row => row.configuration === "configured").length,
            freshSourcesAtSnapshotInFilter: 0, unobservedSourcesAtSnapshotInFilter: rows.filter(row => row.configuration === "configured" && row.freshnessAtSnapshot === "unknown").length,
            registrationGapsInInstitutionChannelFilter: data.inventoryGaps.filter(row => ids.includes(row.institutionId) && (!query.channels || query.channels.includes(row.channel))).length },
          results: page, nextCursor: start + page.length < rows.length ? { snapshotId: view.snapshotId, afterSourceId: page[page.length - 1].sourceId, filterKey } : null }));
      }
      const view = await snapshot("discovery");
      if (key === "regional-discovery-candidates") {
        const query = RegionalDiscoveryQuery.parse(args);
        if (query.institutionIds?.some(id => !data.discoveryInstitutionIds.includes(id))) throw new Error("unknown-read-view-institution");
        const rows = data.records.map(row => row.record).filter(row => (!query.institutionIds || query.institutionIds.includes(row.institutionId)) && (!query.providers || query.providers.includes(row.provider)));
        const filterKey = JSON.stringify({ institutionIds: query.institutionIds ? [...query.institutionIds].sort() : null, providers: query.providers ? [...query.providers].sort() : null });
        let start = 0;
        if (query.cursor) {
          if (query.cursor.snapshotId !== view.snapshotId) throw new Error("regional-view-expired-or-future");
          if (query.cursor.filterKey !== filterKey) throw new Error("invalid-cursor-context");
          const index = rows.findIndex(row => row.recordId === query.cursor!.afterRecordId); if (index < 0) throw new Error("invalid-cursor-record"); start = index + 1;
        }
        const page = rows.slice(start, start + query.limit);
        return json(RegionalDiscoveryResult.parse({ ...data.discoveryBase, snapshot: view,
          scopeDescription: data.discoveryBase.scopeDescription + " Retained representation checks occurred offline at build time; runtime performs no upstream verification. Pagination times describe this read window.",
          counts: { ...data.discoveryBase.counts, recordsInFilter: rows.length, snapshotsInFilter: new Set(rows.map(row => row.provider + ":" + row.sourceId)).size,
            inventoryInstitutionsWithoutDiscoverySnapshotInFilter: (query.institutionIds ?? data.discoveryInstitutionIds).filter(id => !rows.some(row => row.institutionId === id)).length },
          results: page, nextCursor: start + page.length < rows.length ? { snapshotId: view.snapshotId, afterRecordId: page[page.length - 1].recordId, filterKey } : null }));
      }
      const query = RegionalDiscoveryRecordQuery.parse(args);
      if (query.snapshotId !== view.snapshotId) throw new Error("regional-view-expired-or-future");
      const row = data.records.find(row => row.record.recordId === query.recordId); if (!row) throw new Error("invalid-cursor-record");
      const authors = row.details.authors.slice(0, query.authorLimit);
      return json(RegionalDiscoveryRecordResult.parse({ ...row, snapshot: view, details: { ...row.details, authors,
        authorsReturned: authors.length, authorsTruncated: row.details.authorsTruncated || row.details.authors.length > authors.length } }));
    } catch (error) { return json(safeRegionalAgentError(error)); }
  };
}
let handler: ReturnType<typeof createRegionalWorkerReadHandler> | undefined;
export async function handleRegionalWorkerRead(request: Request) {
  try { handler ??= createRegionalWorkerReadHandler(); return await (await handler)(request); }
  catch { return json(safeRegionalAgentError(new Error("read-unavailable")), 503); }
}
