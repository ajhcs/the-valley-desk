import { canonicalJson, sha256 } from "../content/watch-schema";
import type { D1DatabaseLike } from "./persistence";
import type { EditorialProposal } from "./watch-editorial";
import { WatchStorageError } from "./watch-persistence";
import { resolveEnrolledCollectionSource } from "./watch/collection-storage";
import { sourceEndpointAllowed, sourceConfigurationDigest, WatchObservation } from "./watch/source-enrollment";
import { parseTechnologyCaptureSnapshot } from "./watch/technology-adapter";
import { readTechnologyDossierDraft } from "./technology-dossiers";
import { prepareTechnologyEditorialProposal, type TechnologySourceHeadAssertion } from "./technology-editorial-adapter";
import { prepareTechnologySourceDraft, technologyRegionalSources, technologySourcePlans,
  type TechnologyCapture } from "./technology-source-plans";

/** Rebuild from retained server-owned representations, never trust a staged
 * dossier merely because each quotation exists somewhere in its source. */
export async function assertTechnologySourceRuleProposal(db: D1DatabaseLike,
  proposal: EditorialProposal, now = new Date()) {
  const stored = await readTechnologyDossierDraft(db, proposal.draft.id);
  const plan = technologySourcePlans.find(item => item.numericId === stored?.draft.input.repository.numericId);
  if (!stored || !plan || !stored.draft.input.regionalEligibility)
    throw new WatchStorageError("technology-source-rule-plan-required");
  const api = "https://api.github.com/repos/" + plan.fullName;
  const raw = "https://raw.githubusercontent.com/" + plan.fullName + "/" + stored.draft.input.repository.commitSha + "/";
  const urls = { repository: api, commit: api + "/commits/" + plan.branch,
    readme: raw + plan.readme, license: raw + plan.license, releases: api + "/releases?per_page=10",
    regional: technologyRegionalSources[plan.entityId].url };
  const captures = {} as Record<keyof typeof urls, TechnologyCapture>;
  const permissions = new Map<string, string>();
  const sourceHeadAssertions: TechnologySourceHeadAssertion[] = [];
  for (const [key, url] of Object.entries(urls)) {
    const row = await db.prepare("SELECT h.observation_id,h.source_id,r.representation,h.checked_at,r.representation_sha256 FROM technology_source_heads h JOIN technology_source_representations r ON r.id=h.observation_id AND r.subject_id=h.subject_id AND r.source_url=h.source_url AND r.source_id=h.source_id AND r.representation_sha256=h.representation_sha256 WHERE h.subject_id=? AND h.source_url=?")
      .bind(proposal.draft.id, url).first<{ observation_id: string; source_id: string; representation: string; checked_at: string; representation_sha256: string }>();
    if (!row || await sha256(row.representation) !== row.representation_sha256)
      throw new WatchStorageError("technology-source-rule-representation-required");
    const enrolled = await resolveEnrolledCollectionSource(db, row.source_id, now.toISOString());
    if (!enrolled || enrolled.source.desk !== "technology" || enrolled.source.family !== "technology" ||
        !["official", "first-party"].includes(enrolled.source.authority) ||
        enrolled.source.parserId !== "technology-capture-v1" || enrolled.source.parserVersion !== "1" ||
        !sourceEndpointAllowed(enrolled.source, url))
      throw new WatchStorageError("technology-source-rule-enrollment-conflict");
    if (permissions.has(row.source_id) && permissions.get(row.source_id) !== enrolled.permissionDigest)
      throw new WatchStorageError("technology-source-rule-enrollment-conflict");
    permissions.set(row.source_id, enrolled.permissionDigest);
    sourceHeadAssertions.push({ subjectId: proposal.draft.id, sourceId: row.source_id, url,
      observationId: row.observation_id, representationSha256: row.representation_sha256 });
    const collected = await db.prepare(`SELECT o.observation_json,CAST(r.representation AS TEXT) AS body FROM watch_raw_observations o
      JOIN watch_raw_representations r ON r.id=o.representation_id AND r.source_id=o.source_id
      WHERE o.source_id=? AND r.endpoint=? AND r.representation_sha256=? AND r.configuration_sha256=?
        AND EXISTS(SELECT 1 FROM watch_collection_pages p WHERE p.source_id=o.source_id
          AND p.representation_id=r.id AND p.persisted_at>=? AND p.persisted_at<=?)
      ORDER BY o.first_seen_at DESC,o.id LIMIT 1`)
      .bind(row.source_id, url, row.representation_sha256, await sourceConfigurationDigest(enrolled.source), row.checked_at, now.toISOString())
      .first<{ observation_json: string; body: string }>();
    if (!collected || collected.body !== row.representation) throw new WatchStorageError("technology-source-rule-collector-required");
    const observation = WatchObservation.parse(JSON.parse(collected.observation_json));
    const reparsed = await parseTechnologyCaptureSnapshot({ source: enrolled.source, body: row.representation,
      finalUrl: url, fetchedAt: observation.fetchedAt });
    if (reparsed.health.state !== "healthy" || reparsed.rejectedItems || reparsed.truncated ||
        reparsed.observations.length !== 1 || canonicalJson(reparsed.observations[0]) !== canonicalJson(observation))
      throw new WatchStorageError("technology-source-rule-collector-conflict");
    captures[key as keyof typeof urls] = { url, checkedAt: row.checked_at, body: row.representation };
  }
  const rebuilt = await prepareTechnologySourceDraft(plan, captures);
  if (canonicalJson(rebuilt.input) !== canonicalJson(stored.draft.input) ||
      canonicalJson((await prepareTechnologyEditorialProposal(db, proposal.draft.id)).proposal) !== canonicalJson(proposal))
    throw new WatchStorageError("technology-source-rule-proposal-conflict");
  return { permissions, sourceHeadAssertions };
}
