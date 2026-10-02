import { assertPaExportProgress, derivePaExport, normalizeWatchRepresentation, parsePennsylvaniaExportPolicy, PA_EXPORT_PARSER_ID } from "../../src/ingest/watch/pennsylvania-export";
import { parsePennsylvaniaExportSnapshot } from "../../src/ingest/watch/pennsylvania-export-adapter";
import { z } from "zod";
import { validateBrowserOriginal } from "./pa-original-import";
import { paSnapshotFreshness } from "../../src/content/pa-source-freshness";
import { CanonicalInstant, WatchId, canonicalJson, sha256 } from "../../src/content/watch-schema";
import { QualificationReceipt, SourceEnrollment, sourceConfigurationDigest, type SnapshotInput } from "../../src/ingest/watch/source-enrollment";
import { parseFederalRegisterSnapshot } from "../../src/ingest/watch/policy-adapter";
import { parseWatchFeedSnapshot } from "../../src/ingest/watch/feed-adapter";
import { parseGitHubRepositorySnapshot } from "../../src/ingest/watch/github-adapter";
import { parseRepresentativeRosterSnapshot } from "../../src/ingest/watch/representative-adapter";
import { parseTechnologyCaptureSnapshot } from "../../src/ingest/watch/technology-adapter";
import { parsePennsylvaniaSnapshot, PENNSYLVANIA_PARSER_ID } from "../../src/ingest/watch/pennsylvania-adapter";

const Approval = z.object({ engineeringOwnerId: WatchId, editorialOwnerId: WatchId,
  statement: z.string().trim().min(40).max(4000), reviewedAt: CanonicalInstant, expiresAt: CanonicalInstant,
  rightsDecision: z.literal("accepted"), accessDecision: z.literal("public-or-authorized-read"),
  browserProvenanceReviews: z.array(z.object({downloadReceiptSha256:z.string().regex(/^[a-f0-9]{64}$/),
    acquisitionSha256:z.string().regex(/^[a-f0-9]{64}$/), reviewerId:WatchId, reviewReceiptId:WatchId,
    reviewedAt:CanonicalInstant, accessReceiptId:WatchId}).strict()).max(10).optional(),
  receipts: z.object({ engineering: WatchId, editorial: WatchId, rights: WatchId, access: WatchId }).strict().optional() }).strict();
const UpstreamCaptureReceipt = z.object({ id: WatchId, origin: z.literal("upstream-original"), endpoint: z.string().url(),
  capturedAt: CanonicalInstant, representationSha256: z.string().regex(/^[a-f0-9]{64}$/), httpStatus: z.literal(200), accessReceiptId: WatchId }).strict();
export type QualificationSample = { endpoint: string; capturedAt: string; bytes: Uint8Array; upstreamReceipt?: unknown; downloadReceiptBytes?: Uint8Array };

/** Operator-only evidence preparation. No fetch, database write, or publication. */
export async function qualifyCapturedWatchSource(input: unknown, samples: QualificationSample[], approvalInput: unknown) {
  const candidate = SourceEnrollment.parse(input), approval = Approval.parse(approvalInput);
  if (samples.length < 2 || samples.length > 10 || candidate.authority === "unqualified" || candidate.requiresAuth || candidate.parserVersion !== "1")
    throw Error("qualification-samples-or-authority-invalid");
  const parse = candidate.parserId === PA_EXPORT_PARSER_ID ? parsePennsylvaniaExportSnapshot : candidate.parserId === PENNSYLVANIA_PARSER_ID ? parsePennsylvaniaSnapshot :
    candidate.parserId === "technology-capture-v1" ? parseTechnologyCaptureSnapshot :
    candidate.parserId === "watch-federal-roster" ? parseRepresentativeRosterSnapshot :
    candidate.parserId === "watch-federal-register" ? parseFederalRegisterSnapshot :
    candidate.parserId === "watch-github" ? parseGitHubRepositorySnapshot :
    candidate.parserId === "watch-rss" ? parseWatchFeedSnapshot : null;
  if (!parse) throw Error("qualification-parser-unsupported");
  const binary = candidate.parserId === PA_EXPORT_PARSER_ID;
  const captureReceipts = [], derivations = [];
  if (binary) {
    if (!approval.receipts || new Set(Object.values(approval.receipts)).size !== 4) throw Error("pa-qualification-named-receipts-required");
    for (const sample of samples) {
      const browser = z.object({origin:z.literal("browser-original")}).passthrough().safeParse(sample.upstreamReceipt);
      const receipt = browser.success
        ? await validateBrowserOriginal(candidate, sample.bytes, sample.upstreamReceipt, sample.downloadReceiptBytes ?? new Uint8Array())
        : UpstreamCaptureReceipt.parse(sample.upstreamReceipt);
      const endpoint = "requestedUrl" in receipt ? receipt.requestedUrl : receipt.endpoint;
      const capturedAt = "completedAt" in receipt ? receipt.completedAt : receipt.capturedAt;
      if (endpoint !== sample.endpoint || capturedAt !== sample.capturedAt ||
          receipt.representationSha256 !== await sha256(sample.bytes) || ("accessReceiptId" in receipt && receipt.accessReceiptId !== approval.receipts.access))
        throw Error("pa-qualification-original-capture-binding");
      if ("downloadReceiptSha256" in receipt) {
        const review = approval.browserProvenanceReviews?.find(value => value.downloadReceiptSha256 === receipt.downloadReceiptSha256);
        if (!review || review.acquisitionSha256 !== await sha256(canonicalJson(receipt)) ||
            review.accessReceiptId !== approval.receipts.access || review.reviewedAt < receipt.completedAt || review.reviewedAt > approval.reviewedAt)
          throw Error("pa-qualification-browser-provenance-review-required");
      }
      captureReceipts.push(receipt);
      const derived = await derivePaExport(candidate, sample.bytes);
      const previous = derivations.at(-1);
      if (previous) assertPaExportProgress(previous.normalizedText, derived.normalizedText);
      derivations.push(derived);
    }
    if (new Set(captureReceipts.map(receipt => "downloadReceiptSha256" in receipt ? receipt.downloadReceiptSha256 : receipt.id)).size !== samples.length ||
        new Set(samples.map(sample => sample.capturedAt)).size !== samples.length ||
        new Set(derivations.map(derived => derived.receipt.rawArchiveSha256)).size !== samples.length ||
        samples.some((sample,index) => index > 0 && (sample.capturedAt <= samples[index-1].capturedAt || derivations[index].receipt.exportDate.instant < derivations[index-1].receipt.exportDate.instant)))
      throw Error("pa-qualification-distinct-coherent-original-captures-required");
  }
  if (binary) {
    const policy = candidate.paExport?.freshnessPolicy;
    const latest = derivations.at(-1)!.receipt.exportDate.instant;
    const freshness = paSnapshotFreshness({exportAt:latest,lastCheckedAt:null,lastSuccessfulUpstreamCheckAt:null,currentFailure:null,origin:"unknown"},approval.reviewedAt,policy);
    if (!policy || freshness.freshness !== "fresh" || Date.parse(approval.reviewedAt)-Date.parse(latest) >= policy.reviewMaxAgeMs)
      throw Error("pa-qualification-reviewed-export-age-policy-required");
  }
  const configurationSha256 = await sourceConfigurationDigest(candidate);
  const id = "qualified-" + (await sha256(canonicalJson({ configurationSha256, approval }))).slice(0, 40);
  const source = SourceEnrollment.parse({ ...candidate, state: "qualified", qualificationReceiptId: id });
  const replay = [], qualifiedSamples = [];
  for (const [index, sample] of samples.entries()) {
    if (binary && "downloadReceiptSha256" in captureReceipts[index]) {
      const derived = derivations[index], second = await derivePaExport(source, sample.bytes);
      if (canonicalJson(derived) !== canonicalJson(second) || derived.receipt.exportDate.instant > sample.capturedAt)
        throw Error("qualification-browser-replay-not-coherent");
      const captures = derived.records.map(record => parsePennsylvaniaExportPolicy(record.document,
        {sourceId:source.id,sourceLabel:source.name,sourceUrl:sample.endpoint,retrievedAt:sample.capturedAt}));
      // Semantic replay of a successful browser download has no fabricated HTTP
      // response health or final URL. Its acquisition proof is reviewed separately.
      replay.push(await sha256(canonicalJson({derivation:derived.receipt,captures,acquisition:captureReceipts[index]})));
      qualifiedSamples.push({endpoint:sample.endpoint,capturedAt:sample.capturedAt,representationSha256:derived.receipt.rawArchiveSha256,
        parserVersion:source.parserVersion,itemCount:captures.length,outcome:"parsed" as const});
      continue;
    }
    const snapshot: SnapshotInput = { source, finalUrl: sample.endpoint, fetchedAt: sample.capturedAt,
      body: await normalizeWatchRepresentation(source,sample.bytes), representationBytes: sample.bytes, ...(source.transport === "official-zip-xml" ? {representationKind:"pa-zip-xml" as const} : {}) };
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
  const { statement: _statement, receipts: _receipts, browserProvenanceReviews: _browserReviews, ...approvalFields } = approval;
  const qualification = QualificationReceipt.parse({ id, sourceId: source.id, configurationSha256,
    ...approvalFields, reviewEvidenceId: id + "-review",
    negativeFixtureSha256: await sha256(negativeBody), replayFixtureSha256: await sha256(canonicalJson(replay)),
    samples: qualifiedSamples, ...(binary ? {paExportReview:{exportAt:derivations.at(-1)!.receipt.exportDate.instant,
      policyReceiptId:candidate.paExport!.freshnessPolicy!.evidenceReceiptId}} : {}) });
  return { source, qualification, review: { id: qualification.reviewEvidenceId,
    engineeringOwnerId: approval.engineeringOwnerId, editorialOwnerId: approval.editorialOwnerId,
    evidenceSha256: await sha256(canonicalJson({ approval, replay, negativeBody, ...(binary?{captureReceipts}: {}) })),
    qualificationSha256: await sha256(canonicalJson(qualification)), acceptedAt: approval.reviewedAt },
    evidence: { approval, replay, negativeBody, ...(binary?{captureReceipts}: {}) }, publicationAuthorized: false as const };
}
