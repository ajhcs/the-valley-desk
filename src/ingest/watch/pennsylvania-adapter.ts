import { canonicalJson, policyIdentityKey } from "../../content/watch-schema";
import type { D1DatabaseLike } from "../persistence";
import { parsePennsylvaniaPolicy } from "../policy-watch-native";
import { stageNativePolicyCapture } from "./policy-adapter";
import { SourceEnrollment, checkedSnapshot, failedSnapshot, makeObservation, snapshotHealth,
  snapshotRepresentationDigest, proposedModelInputsAfterPersistence,
  type SnapshotInput, type WatchSnapshotResult, type PersistenceAcknowledgment } from "./source-enrollment";

export const PENNSYLVANIA_PARSER_ID = "watch-pa-bill-history";

function billEndpoint(raw: string) {
  const url = new URL(raw);
  const match = /^\/legislation\/bills\/2025\/(hb|sb)([1-9]\d*)$/.exec(url.pathname);
  if (url.protocol !== "https:" || !["www.palegis.us", "palegis.us"].includes(url.hostname) ||
      url.port || url.username || url.password || url.search || url.hash || !match)
    throw Error("pa-bill-endpoint-conflict");
  return { bill: `${match[1].toUpperCase()} ${match[2]}`, bodyId: match[1] === "hb" ? "pa-house" : "pa-senate" };
}

export function validatedPennsylvaniaCapture(input: SnapshotInput) {
  const source = checkedSnapshot(input, ["html"]);
  if (source.desk !== "policy" || source.jurisdiction !== "PA" || source.family !== "legislation" ||
      source.authority !== "official" || source.parserId !== PENNSYLVANIA_PARSER_ID || source.parserVersion !== "1")
    throw Error("pa-bill-source-conflict");
  // One source represents one exact bill; the collector does not sweep a list
  // of independent endpoint histories or discover bills from a topic index.
  if (source.endpoints.length !== 1) throw Error("pa-bill-single-endpoint-required");
  source.endpoints.forEach(billEndpoint);
  const expected = billEndpoint(input.finalUrl);
  if ((input.status ?? 200) !== 200) throw Error("pa-bill-source-http-failed");
  // A PDF association alone must not make a wrong/challenge page a bill page.
  const title = /<title\b[^>]*>([^<]*)<\/title>/i.exec(input.body)?.[1]?.trim();
  const identity = /^(House|Senate) Bill ([1-9]\d*) Information; (\d{4})-(\d{4}) Regular Session\b/.exec(title ?? "");
  if (!identity || `${identity[1] === "House" ? "HB" : "SB"} ${identity[2]}` !== expected.bill ||
      identity[3] !== "2025" || identity[4] !== "2026") throw Error("pa-bill-page-identity-conflict");
  const capture = parsePennsylvaniaPolicy(input.body, { sourceId: source.id, sourceUrl: input.finalUrl,
    sourceLabel: source.name, retrievedAt: input.fetchedAt });
  if (capture.identity.sourceInstrumentId !== expected.bill || capture.identity.sessionKey !== "2025-2026" ||
      capture.identity.bodyId !== expected.bodyId || !capture.version.nativeId || !capture.version.textUrl ||
      !capture.version.sourceDate) throw Error("pa-bill-native-identity-or-version-conflict");
  // Native gaps include unknown legal effect. Extractor blockers are failures,
  // rather than observations that could be mistaken for a healthy empty page.
  if (capture.gaps.some(gap => gap.startsWith("PA bill review blocker:"))) throw Error("pa-bill-version-evidence-conflict");
  return { source, capture };
}

export async function parsePennsylvaniaSnapshot(input: SnapshotInput): Promise<WatchSnapshotResult> {
  const source = SourceEnrollment.parse(input.source), digest = await snapshotRepresentationDigest(input);
  try {
    const { capture } = validatedPennsylvaniaCapture(input);
    // Full HTML is retained in raw storage and the native ledger, not duplicated
    // into the shared 32KB observation payload. Its byte hash binds this metadata.
    const observation = await makeObservation(source, { externalKey: await policyIdentityKey(capture.identity),
      sourceUrl: input.finalUrl, fetchedAt: input.fetchedAt, representationSha256: digest,
      payload: { nativeParserVersion: capture.parserVersion, identity: capture.identity, version: capture.version, gaps: capture.gaps } });
    return { observations: [observation], candidates: [], representationSha256: digest, truncated: false, rejectedItems: 0,
      health: snapshotHealth(source, input, 1, { completeness: "partial" }),
      pagination: { pageKey: input.pageKey ?? "1", nextPageKey: null, terminal: true } };
  } catch (error) {
    return failedSnapshot(source, input, digest, error instanceof Error ? error.message : "invalid-pa-bill-page");
  }
}

/** Durable raw acknowledgment and deterministic replay precede staging. The
 * explicit publication option still requires the separate source-rule proof. */
export async function stageCollectedPennsylvaniaPolicy(db: D1DatabaseLike, input: SnapshotInput,
  result: WatchSnapshotResult, persisted: ReadonlyMap<string, PersistenceAcknowledgment>, now: Date, publishVerified = false) {
  await proposedModelInputsAfterPersistence(result, persisted);
  const rebuilt = await parsePennsylvaniaSnapshot(input);
  if (rebuilt.health.state !== "healthy" || result.health.state !== "healthy" ||
      rebuilt.observations.length !== 1 || canonicalJson(rebuilt) !== canonicalJson(result))
    throw Error("pa-bill-acknowledged-observation-conflict");
  const { capture } = validatedPennsylvaniaCapture(input);
  await stageNativePolicyCapture(db, capture, now, publishVerified);
}
