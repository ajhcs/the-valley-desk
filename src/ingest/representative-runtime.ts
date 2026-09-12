import { REPRESENTATIVE_LOOKUPS } from "../content/representative-sources";
import type { RepresentativeSourcePolicy } from "./representative-persistence";
import type { D1DatabaseLike } from "./persistence";
import { resolveEnrolledCollectionSource } from "./watch/collection-storage";
import { sourceEndpointAllowed, sourceLinkAllowed } from "./watch/source-enrollment";
import type { SourceEnrollment } from "./watch/source-enrollment";

export async function resolveRepresentativeSourcePolicy(db: D1DatabaseLike, now = new Date()): Promise<RepresentativeSourcePolicy> {
  const rows = (await db.prepare(`SELECT id FROM watch_collection_sources
    WHERE json_extract(configuration_json,'$.family')='members' AND activation_id IS NOT NULL ORDER BY id LIMIT 101`)
    .all<{ id: string }>()).results ?? [];
  if (rows.length > 100) throw new Error("representative-source-limit");
  const enrolled: SourceEnrollment[] = [];
  const officialSources = new Map<string, RepresentativeSourcePolicy["officialSources"] extends ReadonlyMap<string, infer V> ? V : never>();
  for (const row of rows) {
    const value = await resolveEnrolledCollectionSource(db, row.id, now.toISOString());
    if (!value || value.source.authority !== "official" || value.source.family !== "members") continue;
    const scopes = REPRESENTATIVE_LOOKUPS.filter(scope => scope.jurisdiction === value.source.jurisdiction);
    if (!scopes.length) continue;
    enrolled.push(value.source);
    officialSources.set(row.id, { jurisdictionIds: new Set(scopes.map(scope => scope.jurisdictionId)),
      bodyIds: new Set(scopes.map(scope => scope.bodyId)), purposes: new Set(["person", "office", "membership", "roster"]) });
  }
  return { officialSources, maxRosterAgeHours: 168,
    sourceUrlAllowed: (id, url) => enrolled.some(source => source.id === id && sourceEndpointAllowed(source, url)),
    officialPublicUrlAllowed: url => enrolled.some(source => sourceLinkAllowed(source, url)) };
}
