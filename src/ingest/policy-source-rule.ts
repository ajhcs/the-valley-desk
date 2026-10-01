import { normalizeWatchRepresentation, PA_EXPORT_PARSER_ID, PA_EXPORT_NORMALIZER } from "./watch/pennsylvania-export";
import { parsePennsylvaniaExportSnapshot, validatedPennsylvaniaExport } from "./watch/pennsylvania-export-adapter";
import { canonicalJson, policyIdentityKey, sha256 } from "../content/watch-schema";
import type { D1DatabaseLike, D1StatementLike } from "./persistence";
import { NativePolicyCapture } from "./policy-watch-native";
import { WatchStorageError } from "./watch-persistence";
import { parseFederalRegisterSnapshot } from "./watch/policy-adapter";
import { parsePennsylvaniaSnapshot, validatedPennsylvaniaCapture, PENNSYLVANIA_PARSER_ID } from "./watch/pennsylvania-adapter";
import { SourceEnrollment, WatchObservation, SnapshotPageReceipt, snapshotPageDigest, sourceConfigurationDigest } from "./watch/source-enrollment";
import { resolveEnrolledCollectionSource } from "./watch/collection-storage";

/** The native ledger is derived data, not proof of collection. Bind acceptance
 * back to an acknowledged raw page and rerun the installed collector parser. */
export async function assertCollectedPolicySourceRule(db: D1DatabaseLike, capture: NativePolicyCapture, now: Date) {
  const pa = capture.parserVersion === "pa-bill-history-html-2", binary = capture.parserVersion === "pa-bill-history-xml-1";
  if (!pa && !binary && capture.parserVersion !== "federal-register-policy-json-1")
    throw new WatchStorageError("watch-source-rule-collector-required");
  const html = pa && capture.native && typeof capture.native === "object" && "html" in capture.native ? capture.native.html : null;
  if (pa && typeof html !== "string") throw new WatchStorageError("watch-source-rule-collector-required");
  const rawSha256 = typeof html === "string" ? await sha256(html) : null;
  const subjectId = await policyIdentityKey(capture.identity);
  const rows = await db.prepare(`SELECT o.id AS observation_id,o.observation_json,o.payload_sha256,r.id AS representation_id,
      r.representation,r.normalized_text AS body,r.normalizer_version,
      r.endpoint,r.representation_sha256,r.configuration_sha256,s.configuration_json,
      p.id AS page_id,p.page_json,p.page_sha256,p.persisted_at
    FROM watch_raw_observations o JOIN watch_raw_representations r ON r.id=o.representation_id AND r.source_id=o.source_id
    JOIN watch_collection_sources s ON s.id=o.source_id AND s.configuration_sha256=r.configuration_sha256
    JOIN watch_collection_pages p ON p.representation_id=r.id AND p.source_id=o.source_id
      AND p.id=(SELECT latest.id FROM watch_collection_pages latest WHERE latest.representation_id=r.id
        AND latest.source_id=o.source_id AND latest.persisted_at<=? ORDER BY latest.persisted_at DESC,latest.id LIMIT 1)
    WHERE o.source_id=? AND json_extract(o.observation_json,'$.externalKey')=?
      AND o.first_seen_at<=? AND (? IS NULL OR r.representation_sha256=?)
    ORDER BY o.first_seen_at DESC,o.id LIMIT 32`).bind(now.toISOString(),capture.source.sourceId,subjectId,now.toISOString(),rawSha256,rawSha256)
    .all<{ observation_id: string; observation_json: string; payload_sha256: string; representation_id: string;
      representation: ArrayBuffer | Uint8Array | number[]; body: string; normalizer_version: string; endpoint: string; representation_sha256: string;
      configuration_sha256: string; configuration_json: string; page_id: string; page_json: string; page_sha256: string; persisted_at: string }>();
  if (!Array.isArray(rows.results) || ("success" in rows && rows.success === false))
    throw new WatchStorageError("watch-source-rule-raw-evidence-unavailable", 503);
  const withoutRetrieval = (value: NativePolicyCapture) => ({ ...value, source: { ...value.source, retrievedAt: null } });
  for (const row of rows.results) {
    const source = SourceEnrollment.parse(JSON.parse(row.configuration_json));
    const bytes = row.representation instanceof Uint8Array ? row.representation : new Uint8Array(row.representation);
    if (source.authority !== "official" || source.parserId !== (binary ? PA_EXPORT_PARSER_ID : pa ? PENNSYLVANIA_PARSER_ID : "watch-federal-register") || source.parserVersion !== "1" ||
        source.id !== capture.source.sourceId || row.endpoint !== capture.source.sourceUrl ||
        await sourceConfigurationDigest(source) !== row.configuration_sha256 ||
        await sha256(bytes) !== row.representation_sha256 || (await normalizeWatchRepresentation(source,bytes)) !== row.body || row.normalizer_version !== (binary ? PA_EXPORT_NORMALIZER : "watch-utf8-v1")) continue;
    const observation = WatchObservation.parse(JSON.parse(row.observation_json));
    const page = SnapshotPageReceipt.parse(JSON.parse(row.page_json));
    if (observation.id !== row.observation_id || observation.sourceId !== source.id || observation.sourceUrl !== row.endpoint ||
        observation.fetchedAt > now.toISOString() || observation.representationSha256 !== row.representation_sha256 ||
        observation.payloadSha256 !== row.payload_sha256 || await sha256(canonicalJson(observation.payload)) !== row.payload_sha256 ||
        page.sourceId !== source.id || page.parserVersion !== source.parserVersion || page.state !== "healthy" ||
        page.truncated || page.rejectedItems || page.representationSha256 !== row.representation_sha256 ||
        !page.observationIds.includes(observation.id) || await snapshotPageDigest(page) !== row.page_sha256) continue;
    const input = { source, body: row.body, representationBytes: bytes, ...(binary ? {representationKind:"pa-zip-xml" as const} : {}), finalUrl: row.endpoint,
      fetchedAt: observation.fetchedAt, pageKey: page.pageKey };
    const parsed = await (binary ? parsePennsylvaniaExportSnapshot(input) : pa ? parsePennsylvaniaSnapshot(input) : parseFederalRegisterSnapshot(input));
    if (parsed.truncated || parsed.rejectedItems || parsed.health.state !== "healthy") continue;
    const matching = parsed.observations.find(item => item.id === observation.id);
    if (!matching || canonicalJson(matching) !== canonicalJson(observation)) continue;
    const payload = matching.payload as { nativeCapture: Omit<NativePolicyCapture, "source"> & { source: Omit<NativePolicyCapture["source"], "retrievedAt"> } };
    const rebuilt = binary ? (await validatedPennsylvaniaExport(input)).captures.find(item => item.identity.sourceInstrumentId === capture.identity.sourceInstrumentId) : pa ? validatedPennsylvaniaCapture(input).capture : NativePolicyCapture.parse({ ...payload.nativeCapture,
      source: { ...payload.nativeCapture.source, retrievedAt: matching.fetchedAt } });
    if (rebuilt && canonicalJson(withoutRetrieval(rebuilt)) === canonicalJson(withoutRetrieval(capture))) {
      const enrolled = await resolveEnrolledCollectionSource(db, source.id, now.toISOString());
      if (!enrolled || enrolled.configurationSha256 !== row.configuration_sha256)
        throw new WatchStorageError("watch-source-rule-permission-conflict");
      // The byte/replay proof and acknowledged page must survive the decision
      // transaction as well as the pre-read. Existing permission/native guards
      // independently fence current qualification and the current capture head.
      const acceptanceGuards = (decisionId: string): D1StatementLike[] => [
        db.prepare(`INSERT INTO watch_collection_acceptance_guards VALUES(?,?,?,?,CASE WHEN EXISTS(
          SELECT 1 FROM watch_raw_observations o JOIN watch_raw_representations r ON r.id=o.representation_id AND r.source_id=o.source_id
          JOIN watch_collection_pages p ON p.representation_id=r.id AND p.source_id=o.source_id
          WHERE o.id=? AND o.observation_json=? AND o.payload_sha256=? AND r.id=? AND r.endpoint=?
            AND r.representation=? AND r.representation_sha256=? AND r.configuration_sha256=? AND r.normalized_text=? AND r.normalizer_version=?
            AND p.id=? AND p.page_json=? AND p.page_sha256=? AND p.persisted_at=? AND p.persisted_at<=?
        ) THEN 1 ELSE 0 END)`).bind(crypto.randomUUID(),decisionId,source.id,now.toISOString(),
          row.observation_id,row.observation_json,row.payload_sha256,row.representation_id,row.endpoint,
          bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),row.representation_sha256,row.configuration_sha256,row.body,row.normalizer_version,
          row.page_id,row.page_json,row.page_sha256,row.persisted_at,now.toISOString()),
      ];
      return { permissions: new Map([[source.id, enrolled.permissionDigest]]), acceptanceGuards };
    }
  }
  throw new WatchStorageError("watch-source-rule-collector-required");
}
