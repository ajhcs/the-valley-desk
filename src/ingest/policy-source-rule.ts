import { canonicalJson, policyIdentityKey, sha256 } from "../content/watch-schema";
import type { D1DatabaseLike } from "./persistence";
import { NativePolicyCapture } from "./policy-watch-native";
import { WatchStorageError } from "./watch-persistence";
import { parseFederalRegisterSnapshot } from "./watch/policy-adapter";
import { SourceEnrollment, WatchObservation, sourceConfigurationDigest } from "./watch/source-enrollment";
import { resolveEnrolledCollectionSource } from "./watch/collection-storage";

/** The native ledger is derived data, not proof of collection. Bind acceptance
 * back to an acknowledged raw page and rerun the installed collector parser. */
export async function assertCollectedPolicySourceRule(db: D1DatabaseLike, capture: NativePolicyCapture, now: Date) {
  if (capture.parserVersion !== "federal-register-policy-json-1")
    throw new WatchStorageError("watch-source-rule-collector-required");
  const subjectId = await policyIdentityKey(capture.identity);
  const rows = await db.prepare(`SELECT o.observation_json,CAST(r.representation AS TEXT) AS body,
      r.endpoint,r.representation_sha256,r.configuration_sha256,s.configuration_json
    FROM watch_raw_observations o JOIN watch_raw_representations r ON r.id=o.representation_id AND r.source_id=o.source_id
    JOIN watch_collection_sources s ON s.id=o.source_id AND s.configuration_sha256=r.configuration_sha256
    WHERE o.source_id=? AND json_extract(o.observation_json,'$.externalKey')=?
      AND o.first_seen_at<=? AND EXISTS(SELECT 1 FROM watch_collection_pages p
        WHERE p.representation_id=r.id AND p.source_id=o.source_id AND p.persisted_at<=?)
    ORDER BY o.first_seen_at DESC,o.id LIMIT 32`).bind(capture.source.sourceId, subjectId, now.toISOString(), now.toISOString())
    .all<{ observation_json: string; body: string; endpoint: string; representation_sha256: string;
      configuration_sha256: string; configuration_json: string }>();
  if (!Array.isArray(rows.results) || ("success" in rows && rows.success === false))
    throw new WatchStorageError("watch-source-rule-raw-evidence-unavailable", 503);
  const withoutRetrieval = (value: NativePolicyCapture) => ({ ...value, source: { ...value.source, retrievedAt: null } });
  for (const row of rows.results) {
    const source = SourceEnrollment.parse(JSON.parse(row.configuration_json));
    if (source.authority !== "official" || source.parserId !== "watch-federal-register" || source.parserVersion !== "1" ||
        await sourceConfigurationDigest(source) !== row.configuration_sha256 ||
        await sha256(row.body) !== row.representation_sha256) continue;
    const observation = WatchObservation.parse(JSON.parse(row.observation_json));
    const parsed = await parseFederalRegisterSnapshot({ source, body: row.body, finalUrl: row.endpoint, fetchedAt: observation.fetchedAt });
    if (parsed.truncated || parsed.rejectedItems || parsed.health.state !== "healthy") continue;
    const matching = parsed.observations.find(item => item.id === observation.id);
    if (!matching || canonicalJson(matching) !== canonicalJson(observation)) continue;
    const payload = matching.payload as { nativeCapture: Omit<NativePolicyCapture, "source"> & { source: Omit<NativePolicyCapture["source"], "retrievedAt"> } };
    const rebuilt = NativePolicyCapture.parse({ ...payload.nativeCapture,
      source: { ...payload.nativeCapture.source, retrievedAt: matching.fetchedAt } });
    if (canonicalJson(withoutRetrieval(rebuilt)) === canonicalJson(withoutRetrieval(capture))) {
      const enrolled = await resolveEnrolledCollectionSource(db, source.id, now.toISOString());
      if (!enrolled || enrolled.configurationSha256 !== row.configuration_sha256)
        throw new WatchStorageError("watch-source-rule-permission-conflict");
      return new Map([[source.id, enrolled.permissionDigest]]);
    }
  }
  throw new WatchStorageError("watch-source-rule-collector-required");
}
