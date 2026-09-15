import { HOUSE_ROSTER_URL, parseHouseRoster } from "../house-representative-collection";
import { SENATE_ROSTER_URL, parseSenateRoster } from "../representative-collection";
import { stageFederalRosterXml } from "../representative-roster-intake";
import { acceptFederalRosterSourceRule } from "../representative-persistence";
import { resolveRepresentativeSourcePolicy } from "../representative-runtime";
import type { D1DatabaseLike } from "../persistence";
import { checkedSnapshot, snapshotRepresentationDigest, snapshotHealth, failedSnapshot, makeObservation,
  type SnapshotInput, type WatchSnapshotResult } from "./source-enrollment";

export async function parseRepresentativeRosterSnapshot(input: SnapshotInput): Promise<WatchSnapshotResult> {
  const source = checkedSnapshot(input, ["official-xml"]);
  const digest = await snapshotRepresentationDigest(input);
  try {
    if (source.parserId !== "watch-federal-roster" || source.parserVersion !== "1" ||
      source.desk !== "policy" || source.jurisdiction !== "federal" || source.family !== "members" ||
      source.authority !== "official" || ![HOUSE_ROSTER_URL, SENATE_ROSTER_URL].includes(input.finalUrl))
      throw Error("representative-source-conflict");
    const house = input.finalUrl === HOUSE_ROSTER_URL;
    const parsed = await (house ? parseHouseRoster : parseSenateRoster)(input.body, input.fetchedAt);
    const expected = house ? { PA: 17, NJ: 12, DE: 1 } : { PA: 2, NJ: 2, DE: 2 };
    const complete = Object.entries(expected).every(([state, count]) => parsed.members.filter(member => member.state === state).length === count);
    const truncated = parsed.members.length > source.maxItems;
    const observations = await Promise.all(parsed.members.slice(0, source.maxItems).map(member =>
      makeObservation(source, { externalKey: member.nativeId, sourceUrl: input.finalUrl, fetchedAt: input.fetchedAt,
        representationSha256: digest, payload: { bodyId: house ? "us-house" : "us-senate", member } })));
    return { observations, candidates: [], representationSha256: digest, truncated, rejectedItems: 0,
      health: snapshotHealth(source, input, observations.length, { completeness: complete && !truncated ? "complete" : "partial",
        ...(!complete ? { parserFailed: true, error: "representative-roster-incomplete" } : {}) }),
      pagination: { pageKey: input.pageKey ?? "1", nextPageKey: null, terminal: !truncated } };
  } catch { return failedSnapshot(source, input, digest, "invalid-official-representative-roster"); }
}

/** Called after acknowledged raw-page retention inside the collector's qualified
 * source/lease guard. Only exact complete native snapshots advance a directory. */
export async function publishCollectedRepresentativeRoster(db: D1DatabaseLike, input: SnapshotInput, now: Date, publishVerified = false) {
  const source = checkedSnapshot(input, ["official-xml"]);
  const staged = await stageFederalRosterXml(db, { sourceId: source.id, sourceUrl: input.finalUrl,
    xml: input.body, observedAt: input.fetchedAt }, now);
  if (publishVerified) {
    const policy = await resolveRepresentativeSourcePolicy(db, now);
    for (const draft of staged.drafts) await acceptFederalRosterSourceRule(db,
      { draftId: draft.id, observationId: staged.observationId, sourceId: source.id }, policy, now);
  }
  return staged;
}
