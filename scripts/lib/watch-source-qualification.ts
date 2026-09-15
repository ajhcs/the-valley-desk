import { z } from "zod";
import { CanonicalInstant, WatchId, canonicalJson, sha256 } from "../../src/content/watch-schema";
import { QualificationReceipt, SourceEnrollment, sourceConfigurationDigest, type SnapshotInput } from "../../src/ingest/watch/source-enrollment";
import { parseFederalRegisterSnapshot } from "../../src/ingest/watch/policy-adapter";
import { parseWatchFeedSnapshot } from "../../src/ingest/watch/feed-adapter";
import { parseGitHubRepositorySnapshot } from "../../src/ingest/watch/github-adapter";

const Approval = z.object({ engineeringOwnerId: WatchId, editorialOwnerId: WatchId,
  statement: z.string().trim().min(40).max(4000), reviewedAt: CanonicalInstant, expiresAt: CanonicalInstant,
  rightsDecision: z.literal("accepted"), accessDecision: z.literal("public-or-authorized-read") }).strict();
export type QualificationSample = { endpoint: string; capturedAt: string; bytes: Uint8Array };

/** Operator-only evidence preparation. No fetch, database write, or publication. */
export async function qualifyCapturedWatchSource(input: unknown, samples: QualificationSample[], approvalInput: unknown) {
  const candidate = SourceEnrollment.parse(input), approval = Approval.parse(approvalInput);
  if (samples.length < 2 || samples.length > 10 || candidate.authority === "unqualified" || candidate.requiresAuth)
    throw Error("qualification-samples-or-authority-invalid");
  const parse = candidate.parserId === "watch-federal-register" ? parseFederalRegisterSnapshot :
    candidate.parserId === "watch-github" ? parseGitHubRepositorySnapshot :
    ["watch-rss", "watch-atom"].includes(candidate.parserId) ? parseWatchFeedSnapshot : null;
  if (!parse) throw Error("qualification-parser-unsupported");
  const configurationSha256 = await sourceConfigurationDigest(candidate);
  const id = "qualified-" + (await sha256(canonicalJson({ configurationSha256, approval }))).slice(0, 40);
  const source = SourceEnrollment.parse({ ...candidate, state: "qualified", qualificationReceiptId: id });
  const replay = [], qualifiedSamples = [];
  for (const sample of samples) {
    const snapshot: SnapshotInput = { source, finalUrl: sample.endpoint, fetchedAt: sample.capturedAt,
      body: new TextDecoder("utf-8", { fatal: true }).decode(sample.bytes), representationBytes: sample.bytes };
    const first = await parse(snapshot), second = await parse(snapshot);
    if (canonicalJson(first) !== canonicalJson(second) || first.truncated || first.rejectedItems ||
      first.health.state !== "healthy" || !first.observations.length || !first.representationSha256)
      throw Error("qualification-replay-not-healthy");
    replay.push(await sha256(canonicalJson(first)));
    qualifiedSamples.push({ endpoint: sample.endpoint, capturedAt: sample.capturedAt,
      representationSha256: first.representationSha256, parserVersion: source.parserVersion,
      itemCount: first.observations.length, outcome: "parsed" as const });
  }
  if (source.endpoints.some(endpoint => !samples.some(sample => sample.endpoint === endpoint)))
    throw Error("qualification-endpoint-unsampled");
  const negativeBody = "<invalid-source-payload";
  const negative = await parse({ source, finalUrl: samples[0]!.endpoint, fetchedAt: samples[0]!.capturedAt, body: negativeBody });
  if (negative.observations.length || negative.health.state !== "parser-failed") throw Error("qualification-negative-not-rejected");
  const { statement: _statement, ...approvalFields } = approval;
  const qualification = QualificationReceipt.parse({ id, sourceId: source.id, configurationSha256,
    ...approvalFields, reviewEvidenceId: id + "-review",
    negativeFixtureSha256: await sha256(negativeBody), replayFixtureSha256: await sha256(canonicalJson(replay)),
    samples: qualifiedSamples });
  return { source, qualification, review: { id: qualification.reviewEvidenceId,
    engineeringOwnerId: approval.engineeringOwnerId, editorialOwnerId: approval.editorialOwnerId,
    evidenceSha256: await sha256(canonicalJson({ approval, replay, negativeBody })),
    qualificationSha256: await sha256(canonicalJson(qualification)), acceptedAt: approval.reviewedAt },
    evidence: { approval, replay, negativeBody }, publicationAuthorized: false as const };
}
