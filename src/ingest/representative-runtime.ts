import { REPRESENTATIVE_LOOKUPS, REPRESENTATIVE_ROSTER_ENDPOINTS } from "../content/representative-sources";
import type { RepresentativeSourcePolicy } from "./representative-persistence";
import type { D1DatabaseLike } from "./persistence";
import { resolveEnrolledCollectionSource, resolveWatchSourcePermissions } from "./watch/collection-storage";
import { sourceEndpointAllowed, sourceLinkAllowed } from "./watch/source-enrollment";
import type { SourceEnrollment } from "./watch/source-enrollment";

export async function resolveRepresentativeSourcePolicy(db: D1DatabaseLike, now = new Date()): Promise<RepresentativeSourcePolicy> {
  const rows = (await db.prepare(`SELECT id FROM watch_collection_sources
    WHERE json_extract(configuration_json,'$.family')='members' AND activation_id IS NOT NULL ORDER BY id LIMIT 101`)
    .all<{ id: string }>()).results ?? [];
  if (rows.length > 100) throw new Error("representative-source-limit");
  const enrolled: SourceEnrollment[] = [];
  const permissionDigests = new Map<string, string>();
  const officialSources = new Map<string, RepresentativeSourcePolicy["officialSources"] extends ReadonlyMap<string, infer V> ? V : never>();
  for (const row of rows) {
    const value = await resolveEnrolledCollectionSource(db, row.id, now.toISOString());
    if (!value || value.source.authority !== "official" || value.source.family !== "members") continue;
    const bodyIds = new Set<string>(REPRESENTATIVE_ROSTER_ENDPOINTS.filter(endpoint => value.source.endpoints.includes(endpoint.url))
      .flatMap(endpoint => [...endpoint.bodyIds]));
    const scopes = REPRESENTATIVE_LOOKUPS.filter(scope => scope.jurisdiction === value.source.jurisdiction && bodyIds.has(scope.bodyId));
    if (!scopes.length) continue;
    enrolled.push(value.source);
    permissionDigests.set(row.id, value.permissionDigest);
    officialSources.set(row.id, { jurisdictionIds: new Set(scopes.map(scope => scope.jurisdictionId)),
      bodyIds: new Set(scopes.map(scope => scope.bodyId)), purposes: new Set(["person", "office", "membership", "roster"]) });
  }
  const permissions = await resolveWatchSourcePermissions(db, [...officialSources.keys()], now.toISOString());
  if ([...permissionDigests].some(([id, digest]) => permissions.sourcePermissionDigests.get(id) !== digest))
    throw new Error("representative-source-changed-during-resolution");
  return { officialSources, maxRosterAgeHours: 168, acceptanceGuards: permissions.acceptanceGuards,
    sourceUrlAllowed: (id, url) => enrolled.some(source => source.id === id && sourceEndpointAllowed(source, url)),
    officialPublicUrlAllowed: url => enrolled.some(source => sourceLinkAllowed(source, url)) };
}
