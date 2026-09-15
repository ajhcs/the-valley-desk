import { githubRepositoryKey } from "../../content/watch-schema";
import { technologyRegionalSources, technologySourcePlans, prepareTechnologySourceDraft, type TechnologyCapture } from "../technology-source-plans";
import { persistTechnologySourceRepresentation, prepareTechnologyEditorialProposal } from "../technology-editorial-adapter";
import { persistTechnologyDossierDraft, readTechnologyDossierDraft } from "../technology-dossiers";
import { stageEditorialProposal, decideSourceRuleProposal } from "../watch-editorial";
import { createWatchEditorialRuntime } from "../watch-editorial-runtime";
import { WatchStorageError } from "../watch-persistence";
import { WatchProjectionError } from "../../content/watch-projection";
import { WatchDeliveryError } from "../../content/watch-delivery";
import type { D1DatabaseLike } from "../persistence";
import { checkedSnapshot, snapshotRepresentationDigest, snapshotHealth, failedSnapshot, makeObservation,
  type SnapshotInput, type WatchSnapshotResult } from "./source-enrollment";

type Role = "repository" | "commit" | "readme" | "license" | "releases" | "regional";
export function technologyCaptureRole(endpoint: string) {
  for (const plan of technologySourcePlans) {
    const api = "https://api.github.com/repos/" + plan.fullName;
    const fixed: Partial<Record<Role, string>> = { repository: api, commit: api + "/commits/" + plan.branch,
      releases: api + "/releases?per_page=10", regional: technologyRegionalSources[plan.entityId].url };
    for (const [role, url] of Object.entries(fixed)) if (url === endpoint) return { plan, role: role as Role };
    const prefix = "https://raw.githubusercontent.com/" + plan.fullName + "/";
    if (endpoint.startsWith(prefix)) {
      const path = endpoint.slice(prefix.length), slash = path.indexOf("/");
      if (/^[a-f0-9]{40}$/.test(path.slice(0, slash))) {
        if (path.slice(slash + 1) === plan.readme) return { plan, role: "readme" as const };
        if (path.slice(slash + 1) === plan.license) return { plan, role: "license" as const };
      }
    }
  }
  throw Error("technology-capture-endpoint-not-installed");
}

export async function parseTechnologyCaptureSnapshot(input: SnapshotInput): Promise<WatchSnapshotResult> {
  const source = checkedSnapshot(input, ["github-json", "html", "batch"]);
  const digest = await snapshotRepresentationDigest(input);
  try {
    if (source.parserId !== "technology-capture-v1" || source.parserVersion !== "1" ||
        source.desk !== "technology" || source.family !== "technology" ||
        !["official", "first-party"].includes(source.authority)) throw Error("technology-capture-source-conflict");
    const { plan, role } = technologyCaptureRole(input.finalUrl);
    if (role === "readme" && (digest !== plan.readmeSha256 || !input.body.includes(plan.quote)))
      throw Error("technology-reviewed-readme-changed");
    if (role === "license" && digest !== plan.licenseSha256) throw Error("technology-reviewed-license-changed");
    if (role === "regional" && !input.body.includes(technologyRegionalSources[plan.entityId].quote))
      throw Error("technology-regional-location-changed");
    if (["repository", "commit", "releases"].includes(role)) {
      const value = JSON.parse(input.body);
      if (role === "repository" && (String(value.id) !== plan.numericId || value.full_name !== plan.fullName || value.private !== false))
        throw Error("technology-repository-identity-conflict");
      if (role === "commit" && !/^[a-f0-9]{40}$/.test(value.sha)) throw Error("technology-commit-conflict");
      if (role === "releases" && (!Array.isArray(value) || value.length > 10)) throw Error("technology-release-cap");
    }
    const subjectId = await githubRepositoryKey(plan.numericId);
    const observation = await makeObservation(source, { externalKey: subjectId + ":" + role,
      sourceUrl: input.finalUrl, fetchedAt: input.fetchedAt, representationSha256: digest,
      payload: { subjectId, role, slug: plan.slug } });
    return { observations: [observation], candidates: [], representationSha256: digest, truncated: false, rejectedItems: 0,
      health: snapshotHealth(source, input, 1, { completeness: "partial" }),
      pagination: { pageKey: input.pageKey ?? "1", nextPageKey: null, terminal: true } };
  } catch { return failedSnapshot(source, input, digest, "invalid-technology-capture"); }
}

/** Use the caller's permission/lease-guarded D1 wrapper after raw-page retention. */
export async function stageCollectedTechnologyCapture(db: D1DatabaseLike, input: SnapshotInput, now: Date, publishVerified = false) {
  const source = checkedSnapshot(input, ["github-json", "html", "batch"]);
  const parsed = await parseTechnologyCaptureSnapshot(input);
  if (parsed.observations.length !== 1 || parsed.rejectedItems || parsed.truncated)
    throw Error("technology-native-capture-invalid");
  const selected = technologyCaptureRole(input.finalUrl);
  // One official location representation may support multiple installed resources.
  const plans = selected.role === "regional"
    ? technologySourcePlans.filter(plan => plan.entityId === selected.plan.entityId) : [selected.plan];
  const staged: string[] = [];
  for (const plan of plans) {
    const subjectId = await githubRepositoryKey(plan.numericId);
    await persistTechnologySourceRepresentation(db, subjectId, source.id,
      { url: input.finalUrl, checkedAt: input.fetchedAt, body: input.body });
    const rows = await db.prepare("SELECT h.source_url,r.representation,h.checked_at FROM technology_source_heads h JOIN technology_source_representations r ON r.id=h.observation_id WHERE h.subject_id=? ORDER BY h.checked_at DESC,h.source_url")
      .bind(subjectId).all<{ source_url: string; representation: string; checked_at: string }>();
    const captures: Partial<Record<Role, TechnologyCapture>> = {};
    for (const row of rows.results ?? []) {
      const match = technologyCaptureRole(row.source_url);
      if (match.role !== "regional" && match.plan.numericId !== plan.numericId) continue;
      if (!captures[match.role]) captures[match.role] = { url: row.source_url, body: row.representation, checkedAt: row.checked_at };
    }
    if (Object.keys(captures).length !== 6) continue;
    const draft = await prepareTechnologySourceDraft(plan, captures as Record<Role, TechnologyCapture>);
    const previous = await readTechnologyDossierDraft(db, subjectId);
    await persistTechnologyDossierDraft(db, draft.input, previous?.revision ?? 0);
    const { proposal } = await prepareTechnologyEditorialProposal(db, subjectId);
    const editorial = await stageEditorialProposal(db, proposal, now);
    if (publishVerified) {
      try { await decideSourceRuleProposal(db, { id: editorial.id, sha256: editorial.sha256 }, createWatchEditorialRuntime(db), now); }
      catch (error) {
        if (!(error instanceof WatchStorageError || error instanceof WatchProjectionError || error instanceof WatchDeliveryError)) throw error;
        console.warn(JSON.stringify({ event: "watch-source-rule-held", subjectId, reason: error.message }));
      }
    }
    staged.push(subjectId);
  }
  return staged;
}
