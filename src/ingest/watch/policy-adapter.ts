import { z } from "zod";
import { sha256, policyIdentityKey } from "../../content/watch-schema";
import { parseFederalRegisterPolicy, NativePolicyCapture } from "../policy-watch-native";
import { persistPolicyWatchCapture, buildPolicyEditorialProposal } from "../policy-watch-workflow";
import { decideSourceRulePolicyProposal, stageEditorialProposal } from "../watch-editorial";
import { createWatchEditorialRuntime } from "../watch-editorial-runtime";
import { WatchStorageError } from "../watch-persistence";
import { WatchProjectionError } from "../../content/watch-projection";
import { WatchDeliveryError } from "../../content/watch-delivery";
import type { D1DatabaseLike } from "../persistence";
import { checkedSnapshot, snapshotRepresentationDigest, snapshotHealth, failedSnapshot, makeObservation, WatchObservation,
  type SnapshotInput, type WatchSnapshotResult } from "./source-enrollment";

/** A rolling API inventory is discovery, not a complete regulatory history. */
export async function parseFederalRegisterSnapshot(input: SnapshotInput): Promise<WatchSnapshotResult> {
  const source = checkedSnapshot(input, ["official-json"]);
  const digest = await snapshotRepresentationDigest(input);
  try {
    const endpoint = new URL(input.finalUrl);
    if (source.parserId !== "watch-federal-register" || source.parserVersion !== "1" ||
      source.desk !== "policy" || source.jurisdiction !== "federal" || source.family !== "regulation" ||
      endpoint.hostname !== "www.federalregister.gov" || endpoint.pathname !== "/api/v1/documents.json")
      throw Error("federal-register-source-conflict");
    const envelope = z.object({ results: z.array(z.record(z.unknown())).max(1000),
      next_page_url: z.string().nullable().optional() }).passthrough().parse(JSON.parse(input.body));
    const observations: WatchObservation[] = [], seen = new Set<string>();
    let rejectedItems = 0;
    const truncated = envelope.results.length > source.maxItems;
    for (const row of envelope.results.slice(0, source.maxItems)) {
      // Notices and presidential documents are not rules. Unknown types fail visibly.
      if (row.type === "Notice" || row.type === "Presidential Document") continue;
      try {
        const capture = parseFederalRegisterPolicy(row, { sourceId: source.id, sourceUrl: input.finalUrl,
          sourceLabel: source.name, retrievedAt: input.fetchedAt });
        const externalKey = await policyIdentityKey(capture.identity);
        if (seen.has(externalKey)) throw Error("duplicate-native-policy");
        seen.add(externalKey);
        const { retrievedAt: _retrievedAt, ...sourceMetadata } = capture.source;
        const payload = { nativeCapture: { ...capture, source: sourceMetadata } };
        observations.push(await makeObservation(source, { externalKey,
          sourceUrl: input.finalUrl, fetchedAt: input.fetchedAt, representationSha256: digest, payload }));
      } catch { rejectedItems++; }
    }
    return { observations, candidates: [], representationSha256: digest, truncated, rejectedItems,
      health: snapshotHealth(source, input, observations.length, { completeness: "partial",
        ...(rejectedItems ? { parserFailed: true, error: "native-policy-record-rejected" } : {}) }),
      // Continuations must be explicitly enrolled before the collector can follow them.
      pagination: { pageKey: input.pageKey ?? "1", nextPageKey: envelope.next_page_url ?? null,
        terminal: !envelope.next_page_url && !truncated } };
  } catch { return failedSnapshot(source, input, digest, "invalid-federal-register-inventory"); }
}

/** Called only after durable raw-page acknowledgment. Publication requires the
 * explicit server-controlled option and a separate deterministic verification. */
export async function stageCollectedPolicyObservations(db: D1DatabaseLike, observations: WatchObservation[], now: Date,
  publishVerified = false) {
  for (const observation of observations) {
    const payload = z.object({ nativeCapture: z.record(z.unknown()) }).strict().parse(observation.payload);
    const capture = NativePolicyCapture.parse({ ...payload.nativeCapture,
      source: { ...z.record(z.unknown()).parse(payload.nativeCapture.source), retrievedAt: observation.fetchedAt } });
    if (capture.source.sourceId !== observation.sourceId || capture.source.sourceUrl !== observation.sourceUrl ||
      capture.source.retrievedAt !== observation.fetchedAt ||
      await policyIdentityKey(capture.identity) !== observation.externalKey) throw Error("native-policy-observation-conflict");
    const stored = await persistPolicyWatchCapture(db, capture);
    const subjectId = await policyIdentityKey(capture.identity);
    const existing = await db.prepare("SELECT slug,input_revision,input_sha256 FROM watch_subjects WHERE id=?").bind(subjectId)
      .first<{ slug: string; input_revision: number; input_sha256: string }>();
    if (!publishVerified && stored.outcome === "unchanged" && existing?.input_revision === stored.revision &&
        await db.prepare("SELECT id FROM watch_editorial_drafts WHERE subject_id=? AND subject_revision=? AND input_sha256=?")
          .bind(subjectId, stored.revision, existing.input_sha256).first()) continue;
    const slug = existing?.slug ?? `federal-register-${capture.identity.sourceInstrumentId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${(await sha256(subjectId)).slice(0, 12)}`;
    const { proposal } = await buildPolicyEditorialProposal(db, stored.id, slug, now);
    const staged = await stageEditorialProposal(db, proposal, now);
    if (publishVerified) {
      try {
        await decideSourceRulePolicyProposal(db, { id: staged.id, sha256: staged.sha256 }, createWatchEditorialRuntime(db), now);
      } catch (error) {
        if (!(error instanceof WatchStorageError || error instanceof WatchProjectionError || error instanceof WatchDeliveryError)) throw error;
        console.warn(JSON.stringify({ event: "watch-source-rule-held", subjectId, reason: error.message }));
      }
    }
  }
}
