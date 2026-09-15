import { z } from "zod";
import { developmentIdentityKey, githubRepositoryKey, sha256, tupleKey, type SourceDate } from "../../content/watch-schema";
import { stripHtml } from "../event-parser";
import { INSTRUCTION_LIKE_RE } from "../untrusted-text";
import { parseSourcePublicationDate } from "./feed-adapter";
import { DiscoveryCandidate, SourceEnrollment, checkedSnapshot, failedSnapshot, makeObservation, observationKey,
  snapshotHealth, snapshotRepresentationDigest, sourceLinkAllowed, type SnapshotInput, type WatchObservation, type WatchSnapshotResult } from "./source-enrollment";

const NumericId = z.string().regex(/^[1-9][0-9]{0,19}$/);
const FullName = z.string().max(240).regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const CommitSha = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i).transform(value => value.toLowerCase());
export const GitHubRepositoryBinding = z.object({ repositoryId: NumericId, fullName: FullName }).strict();
export type GitHubRepositoryBinding = z.infer<typeof GitHubRepositoryBinding>;
type JsonObject = Record<string, unknown>;
type GitHubMode = "repository" | "releases" | "tags" | "commits";

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("unexpected-github-object");
  return value as JsonObject;
}
function string(value: unknown, maximum = 8000): string { return z.string().max(maximum).parse(value); }
function optionalString(value: unknown, maximum = 8000): string | null { return value == null ? null : string(value, maximum); }
function numericId(value: unknown): string {
  // Do not round IDs received as JSON numbers beyond JavaScript's safe range.
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value <= 0)) throw new Error("unsafe-github-numeric-id");
  return NumericId.parse(typeof value === "number" ? String(value) : value);
}
function apiPath(input: SnapshotInput, expectedPath: string): void {
  const url = new URL(input.finalUrl);
  if (url.hostname !== "api.github.com" || url.pathname.toLowerCase() !== expectedPath.toLowerCase()) throw new Error("github-api-identity-conflict");
}
function repositoryLink(source: SourceEnrollment, raw: unknown, binding: GitHubRepositoryBinding, suffix: string): string {
  const href = string(raw, 2048);
  if (!sourceLinkAllowed(source, href)) throw new Error("github-link-outside-source-scope");
  const url = new URL(href);
  const repositoryPath = `/${binding.fullName}`;
  if (url.hostname !== "github.com" || url.search || url.hash ||
      url.pathname.slice(0, repositoryPath.length).toLowerCase() !== repositoryPath.toLowerCase() ||
      url.pathname.slice(repositoryPath.length) !== suffix) throw new Error("github-repository-link-conflict");
  return href;
}
function unknownDate(reason: string): SourceDate { return { precision: "unknown", reason }; }

async function parseGitHubSnapshot(input: SnapshotInput, mode: GitHubMode, suppliedBinding?: unknown,
  expectedRepositoryId?: string): Promise<WatchSnapshotResult & { repository: GitHubRepositoryBinding | null }> {
  const source = SourceEnrollment.parse(input.source);
  const fail = (hash: string | null, message: string) => ({ ...failedSnapshot(source, input, hash, message), repository: null });
  try { checkedSnapshot(input, ["github-json"]); } catch (error) {
    return fail(null, error instanceof Error ? error.message : "invalid-snapshot");
  }
  const representationSha256 = await snapshotRepresentationDigest(input);
  if ((input.status ?? 200) !== 200) return fail(representationSha256,
    input.status === 304 ? "not-modified-without-retained-representation" : `upstream-http-${input.status}`);
  try {
    const parsed: unknown = JSON.parse(input.body);
    let binding: GitHubRepositoryBinding;
    if (mode === "repository") {
      const repo = object(parsed);
      binding = GitHubRepositoryBinding.parse({ repositoryId: numericId(repo.id), fullName: repo.full_name });
      if (repo.private !== false || (repo.visibility !== undefined && repo.visibility !== "public")) throw new Error("nonpublic-github-repository");
      if (`${string(object(repo.owner).login, 100)}/${string(repo.name, 100)}` !== binding.fullName) throw new Error("github-owner-name-conflict");
      if (expectedRepositoryId && binding.repositoryId !== NumericId.parse(expectedRepositoryId)) throw new Error("github-repository-id-conflict");
      apiPath(input, `/repos/${binding.fullName}`);
    } else {
      // The caller resolves this from its persisted repository observation; an
      // owner/name search result is not evidence for a numeric repository ID.
      binding = GitHubRepositoryBinding.parse(suppliedBinding);
      apiPath(input, `/repos/${binding.fullName}/${mode}`);
      if (!Array.isArray(parsed)) throw new Error("github-list-required");
    }
    const repositoryKey = await githubRepositoryKey(binding.repositoryId);
    const rows = mode === "repository" ? [parsed] : parsed as unknown[];
    const observations: WatchObservation[] = [], candidates: DiscoveryCandidate[] = [];
    const seen = new Map<string, string>(), conflicts = new Set<string>();
    let rejectedItems = 0;
    for (const row of rows.slice(0, source.maxItems)) {
      try {
        const item = object(row), metadata: JsonObject = { repositoryId: binding.repositoryId, repositoryKey, repositoryAlias: binding.fullName };
        let externalKey: string, title: string, url: string, description = "", rawPublished: string | null = null;
        let discoveryClass: DiscoveryCandidate["discoveryClass"], dateField: string | null = null;
        if (mode === "repository") {
          externalKey = `github:repository:${binding.repositoryId}`;
          title = binding.fullName; url = repositoryLink(source, item.html_url, binding, "");
          description = stripHtml(optionalString(item.description) ?? ""); discoveryClass = "repository-baseline";
          metadata.createdAt = optionalString(item.created_at, 100); metadata.updatedAt = optionalString(item.updated_at, 100);
          metadata.pushedAt = optionalString(item.pushed_at, 100); metadata.archived = z.boolean().parse(item.archived);
          metadata.fork = z.boolean().parse(item.fork);
          metadata.licenseHint = item.license == null ? null : optionalString(object(item.license).spdx_id, 100);
        } else if (mode === "releases") {
          const releaseId = numericId(item.id), tag = string(item.tag_name, 500);
          if (!tag) throw new Error("github-release-tag-required");
          const draft = z.boolean().parse(item.draft), prerelease = z.boolean().parse(item.prerelease);
          externalKey = `github:repository:${binding.repositoryId}:release:${releaseId}`;
          title = optionalString(item.name, 500) || tag;
          // GitHub draft URLs may not be public. Retain metadata but do not emit
          // a proposed model input for drafts or infer a publication timestamp.
          url = repositoryLink(source, item.html_url, binding, `/releases/tag/${encodeURIComponent(tag)}`);
          description = stripHtml(optionalString(item.body) ?? "");
          rawPublished = optionalString(item.published_at, 100); dateField = "published_at";
          discoveryClass = draft ? "unpublished-draft" : prerelease ? "prerelease" : rawPublished ? "release" : "undated-release";
          metadata.releaseId = releaseId; metadata.tagName = tag; metadata.draft = draft; metadata.prerelease = prerelease;
          metadata.createdAt = optionalString(item.created_at, 100);
          metadata.targetCommitish = optionalString(item.target_commitish, 500);
        } else if (mode === "tags") {
          const tag = z.string().min(1).max(500).parse(item.name), commitSha = CommitSha.parse(object(item.commit).sha);
          externalKey = `github:repository:${binding.repositoryId}:tag:${await sha256(tag)}:commit:${commitSha}`;
          title = tag; discoveryClass = "tag";
          url = repositoryLink(source, `https://github.com/${binding.fullName}/tree/${encodeURIComponent(tag)}`, binding, `/tree/${encodeURIComponent(tag)}`);
          metadata.tagName = tag; metadata.commitSha = commitSha;
          metadata.tagIdentity = await tupleKey("github-tag-v1", [binding.repositoryId, await sha256(tag)]);
        } else {
          const commitSha = CommitSha.parse(item.sha), commit = object(item.commit);
          externalKey = `github:repository:${binding.repositoryId}:commit:${commitSha}`;
          const message = string(commit.message);
          description = stripHtml(message); title = stripHtml(message.split(/\r?\n/, 1)[0] || commitSha);
          url = repositoryLink(source, item.html_url, binding, `/commit/${commitSha}`); discoveryClass = "commit";
          rawPublished = optionalString(object(commit.committer).date, 100); dateField = "commit.committer.date";
          metadata.commitSha = commitSha; metadata.authorDate = optionalString(object(commit.author).date, 100);
        }
        const id = await observationKey(source, externalKey, representationSha256);
        metadata.developmentKey = await developmentIdentityKey(repositoryKey,
          mode === "repository" ? "baseline" : mode === "releases" ? "software-release" : mode === "tags" ? "tag" : "commit", await sha256(externalKey));
        const sourceOccurredAt = discoveryClass === "repository-baseline" ? unknownDate("Repository inventory is not a newly published release.")
          : discoveryClass === "tag" ? unknownDate("The repository tags response contains no tag publication date.")
            : discoveryClass === "unpublished-draft" ? unknownDate("Draft releases have not been publicly published.")
              : parseSourcePublicationDate(rawPublished, `${id}:date`, source.dateTimezone);
        if (discoveryClass === "release" && sourceOccurredAt.precision === "unknown") discoveryClass = "undated-release";
        const holds: DiscoveryCandidate["holds"] = [];
        if (sourceOccurredAt.precision === "unknown") holds.push("source-date-unknown");
        if (INSTRUCTION_LIKE_RE.test(`${title} ${description}`)) holds.push("instruction-like-source");
        if (discoveryClass === "unpublished-draft") holds.push("unpublished-draft");
        const candidate = DiscoveryCandidate.parse({ id: await tupleKey("watch-candidate-v1", [source.id, await sha256(externalKey)]),
          observationId: id, sourceId: source.id, externalKey, title, url, description, sourceOccurredAt, discoveryClass, holds,
          publicationAuthorized: false, regionalEligibility: "unverified", licenseAuthority: "unreviewed" });
        const observation = await makeObservation(source, { externalKey, representationSha256, sourceUrl: input.finalUrl,
          fetchedAt: input.fetchedAt, payload: { candidate, metadata, rawPublished, dateField, dateEvidenceId: `${id}:date` } });
        if (seen.has(id)) {
          if (seen.get(id) !== observation.payloadSha256) { conflicts.add(id); rejectedItems += 1; }
          continue;
        }
        seen.set(id, observation.payloadSha256); observations.push(observation); candidates.push(candidate);
      } catch { rejectedItems += 1; }
    }
    const acceptedObservations = observations.filter(item => !conflicts.has(item.id));
    const acceptedCandidates = candidates.filter(item => !conflicts.has(item.observationId));
    const truncated = rows.length > source.maxItems;
    const nextPageKey = input.nextPageKey ?? null;
    const terminal = mode === "repository" || (input.terminal === true && nextPageKey === null && !truncated);
    return { observations: acceptedObservations, candidates: acceptedCandidates, representationSha256,
      repository: mode === "repository" && !acceptedObservations.length ? null : binding,
      truncated, rejectedItems: rejectedItems + conflicts.size,
      health: snapshotHealth(source, input, acceptedObservations.length, { parserFailed: rejectedItems > 0,
        ...(rejectedItems ? { error: "github-items-rejected" } : truncated ? { error: "github-item-cap-partial" } : {}) }),
      // A successful API page is not proof of a complete repository inventory.
      pagination: { pageKey: input.pageKey ?? "1", nextPageKey, terminal } };
  } catch (error) { return fail(representationSha256, error instanceof Error ? error.message : "github-parser-failed"); }
}

export function parseGitHubRepositorySnapshot(input: SnapshotInput, expectedRepositoryId?: string) {
  return parseGitHubSnapshot(input, "repository", undefined, expectedRepositoryId);
}
export function parseGitHubReleasesSnapshot(input: SnapshotInput, repository: GitHubRepositoryBinding) {
  return parseGitHubSnapshot(input, "releases", repository);
}
export function parseGitHubTagsSnapshot(input: SnapshotInput, repository: GitHubRepositoryBinding) {
  return parseGitHubSnapshot(input, "tags", repository);
}
export function parseGitHubCommitsSnapshot(input: SnapshotInput, repository: GitHubRepositoryBinding) {
  return parseGitHubSnapshot(input, "commits", repository);
}
