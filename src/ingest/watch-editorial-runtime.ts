import { RegionalEligibility } from "../content/watch-delivery";
import type { D1DatabaseLike } from "./persistence";
import type { EditorialRuntime } from "./watch-editorial";
import { resolveWatchCollectionEvidence, resolveWatchSourcePermissions } from "./watch/collection-storage";
import { prepareTechnologyEditorialProposal, technologyAcceptanceGuards } from "./technology-editorial-adapter";
import { resolvePolicyWatchEvidence } from "./policy-watch-workflow";
import { WatchStorageError } from "./watch-persistence";

export function createWatchEditorialRuntime(db: D1DatabaseLike): EditorialRuntime {
  return { async resolveContext(proposal, now) {
    const ids = [...new Set(proposal.evidence.map(item => item.observationId))];
    const collected = await resolveWatchCollectionEvidence(db, ids, now.toISOString());
    const permissions = await resolveWatchSourcePermissions(db, [...new Set(proposal.evidence.map(item => item.sourceId))], now.toISOString());
    const observations = new Map(collected.observations);
    const technology = proposal.draft.kind === "technology" ? await prepareTechnologyEditorialProposal(db, proposal.draft.id) : null;
    if (technology) for (const [id, observation] of technology.observations) observations.set(id, observation);
    const missing = ids.filter(id => !observations.has(id));
    const policy = proposal.draft.kind === "policy" && missing.length
      ? await resolvePolicyWatchEvidence(db, proposal.draft.id, missing) : null;
    if (policy) for (const [id, observation] of policy.observations) observations.set(id, observation);
    if (ids.some(id => !observations.has(id))) throw new WatchStorageError("watch-review-evidence-unavailable");
    const regionalFactIds = new Map<string, string>(), regionalEntityIds = new Set<string>();
    // These are proposed evidence-backed facts. The named review still creates
    // their acceptance; parsing here does not authorize regional publication.
    for (const fact of proposal.facts.filter(item => item.field === "regional-eligibility")) {
      const value = RegionalEligibility.parse(fact.value);
      if (regionalFactIds.has(value.relationshipId)) throw new WatchStorageError("watch-regional-fact-conflict");
      regionalFactIds.set(value.relationshipId, fact.id); regionalEntityIds.add(value.entityId);
    }
    return { ...permissions, observations, regionalFactIds, regionalEntityIds,
      currentArtifacts: technology?.currentArtifacts ?? new Map(),
      // Native metadata does not imply an accepted provision interpretation.
      currentInterpretations: new Map(),
      async acceptanceGuards(decisionId) {
        return [...permissions.acceptanceGuards(decisionId),
          ...(technology ? await technologyAcceptanceGuards(db, technology.sourceHeadAssertions, decisionId) : []),
          ...(policy ? policy.acceptanceGuards(decisionId) : [])];
      } };
  } };
}
