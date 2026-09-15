import { z } from "zod";
import { AcceptedFactRecord, EvidenceReference, CanonicalInstant, WatchId, Sha256, canonicalJson, sha256, acceptedFactDigest } from "../content/watch-schema";
import { RepresentativeQuery, RepresentativeSnapshotAcceptance, resolveRepresentativeDirectory, queryRepresentatives,
  representativeDirectoryUnavailable } from "../content/watch-representatives";
import type { RepresentativeResolutionContext } from "../content/watch-representatives";
import type { D1DatabaseLike, D1StatementLike } from "./persistence";

const Snapshot = RepresentativeSnapshotAcceptance.innerType();
const Observation = z.object({ id: WatchId, sourceId: WatchId, sourceUrl: z.string().url(), parserVersion: z.string().min(1).max(200),
  representation: z.string().max(500_000) }).strict();
const ProposedFact = AcceptedFactRecord.innerType().omit({ verification: true }).strict();
export const RepresentativeDraft = z.object({ id: WatchId, expectedRevision: z.number().int().nonnegative().safe(),
  scope: Snapshot.shape.scope, rosterFactId: WatchId, facts: z.array(z.union([ProposedFact, AcceptedFactRecord])).min(2).max(4000),
  evidence: z.array(EvidenceReference).min(1).max(4000), observations: z.array(Observation).min(1).max(4000) }).strict();
export type RepresentativeSourcePolicy = Pick<RepresentativeResolutionContext,
  "officialSources" | "sourceUrlAllowed" | "officialPublicUrlAllowed" | "maxRosterAgeHours"> & {
    acceptanceGuards?: (decisionId: string) => D1StatementLike[];
  };
export class RepresentativeStorageError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
const fail = (code: string, status = 409): never => { throw new RepresentativeStorageError(code, status); };
const scopeKey = (scope: z.infer<typeof Snapshot.shape.scope>) => canonicalJson(scope);
function unique<T extends { id: string }>(rows: T[]): Map<string, T> {
  const map = new Map(rows.map(row => [row.id, row]));
  if (map.size !== rows.length) return fail("representative-duplicate-identity");
  return map;
}
function bounded(input: unknown) {
  const payload = canonicalJson(RepresentativeDraft.parse(input));
  if (new TextEncoder().encode(payload).length > 2_000_000) return fail("representative-payload-too-large", 413);
  return payload;
}
type Row = { id: string; scope_key: string; expected_revision: number; payload_json: string; payload_sha256: string; created_at: string };
export async function readRepresentativeDraft(db: D1DatabaseLike, id: string) {
  WatchId.parse(id);
  const row = await db.prepare("SELECT * FROM representative_drafts WHERE id=?").bind(id).first<Row>();
  if (!row) return fail("representative-draft-not-found", 404);
  const draft = RepresentativeDraft.parse(JSON.parse(row.payload_json));
  if (bounded(draft) !== row.payload_json || await sha256(row.payload_json) !== row.payload_sha256 || draft.id !== row.id ||
    scopeKey(draft.scope) !== row.scope_key || draft.expectedRevision !== row.expected_revision) return fail("representative-storage-invalid", 503);
  return { row, draft };
}
/** Collection/review preparation only. The payload's fact labels are not authority. */
export async function stageRepresentativeDraft(db: D1DatabaseLike, input: unknown, now = new Date()) {
  const payload = bounded(input), draft = RepresentativeDraft.parse(input), digest = await sha256(payload);
  unique(draft.facts); unique(draft.evidence); unique(draft.observations);
  await db.prepare("INSERT OR IGNORE INTO representative_drafts VALUES(?,?,?,?,?,?)")
    .bind(draft.id, scopeKey(draft.scope), draft.expectedRevision, payload, digest, CanonicalInstant.parse(now.toISOString())).run();
  if ((await readRepresentativeDraft(db, draft.id)).row.payload_sha256 !== digest) return fail("representative-draft-id-conflict");
  return { id: draft.id, sha256: digest };
}
async function resolve(draft: z.infer<typeof RepresentativeDraft>, snapshot: z.infer<typeof RepresentativeSnapshotAcceptance>,
  policy: RepresentativeSourcePolicy, now: Date) {
  return resolveRepresentativeDirectory(snapshot.id, { ...policy, now: now.toISOString(),
    acceptedSnapshots: new Map([[snapshot.id, snapshot]]), currentRevisions: new Map([[snapshot.id, snapshot.revision]]),
    facts: unique(draft.facts), evidence: unique(draft.evidence), observations: unique(draft.observations) });
}
function reviewedDraft(draft: z.infer<typeof RepresentativeDraft>, reviewerId: string, verifiedAt: string, sourceRule = false) {
  return { ...draft, facts: draft.facts.map(fact => AcceptedFactRecord.parse({ ...fact,
    verification: { kind: sourceRule ? "source-rule" : "human-review",
      ruleId: sourceRule ? "official-federal-roster" : "representative-roster-review",
      ruleVersion: sourceRule ? "source-rule-roster-1" : "authenticated-review-1",
      verifierId: reviewerId, verifiedAt } })) };
}

/** Deterministic native-snapshot acceptance. Rebuild every proposed fact from
 * retained complete official XML; a caller cannot approve arbitrary draft values. */
export async function acceptFederalRosterSourceRule(db: D1DatabaseLike, input: {
  draftId: string; observationId: string; sourceId: string;
}, policy: RepresentativeSourcePolicy, now = new Date()) {
  WatchId.parse(input.draftId); WatchId.parse(input.observationId); WatchId.parse(input.sourceId);
  const { row, draft } = await readRepresentativeDraft(db, input.draftId);
  const raw = await db.prepare("SELECT source_url,retrieved_at,raw_sha256,raw_text FROM representative_roster_observations WHERE id=?")
    .bind(input.observationId).first<{ source_url: string; retrieved_at: string; raw_sha256: string; raw_text: string }>();
  if (!raw || await sha256(raw.raw_text) !== raw.raw_sha256) return fail("representative-raw-evidence-invalid");
  const { HOUSE_ROSTER_URL, parseHouseRoster } = await import("./house-representative-collection");
  const { SENATE_ROSTER_URL, parseSenateRoster } = await import("./representative-collection");
  const { prepareHouseRosterCaptures, prepareSenateRosterCaptures, buildRepresentativeRosterDraft } = await import("./representative-roster-drafts");
  if (![HOUSE_ROSTER_URL, SENATE_ROSTER_URL].includes(raw.source_url)) return fail("representative-endpoint-unsupported");
  const house = raw.source_url === HOUSE_ROSTER_URL;
  const parsed = await (house ? parseHouseRoster : parseSenateRoster)(raw.raw_text, raw.retrieved_at);
  const expected = house ? { PA: 17, NJ: 12, DE: 1 } : { PA: 2, NJ: 2, DE: 2 };
  if (Object.entries(expected).some(([state, count]) => parsed.members.filter(member => member.state === state).length !== count))
    return fail("representative-roster-incomplete");
  const captures = await (house ? prepareHouseRosterCaptures : prepareSenateRosterCaptures)(raw.raw_text, input.sourceId, raw.retrieved_at);
  const capture = captures.find(value => value.bodyId === draft.scope.bodyId && value.jurisdictionId === draft.scope.jurisdictionId);
  if (!capture || canonicalJson(await buildRepresentativeRosterDraft(capture, draft.expectedRevision)) !== row.payload_json)
    return fail("representative-source-rule-mismatch");
  return persistRepresentativeDecision(db, { id: draft.id, sha256: row.payload_sha256, decision: "accepted" },
    "source-rule:official-roster", policy, now, true);
}
/** Internal boundary: authenticate reviewer first. Approval refers to one stored
 * draft/hash, never a client supplied accepted snapshot. */
export async function decideRepresentativeDraft(db: D1DatabaseLike, input: unknown, reviewerId: string,
  policy: RepresentativeSourcePolicy, now = new Date()) {
  return persistRepresentativeDecision(db, input, reviewerId, policy, now, false);
}
async function persistRepresentativeDecision(db: D1DatabaseLike, input: unknown, reviewerId: string,
  policy: RepresentativeSourcePolicy, now: Date, sourceRule: boolean) {
  const decision = z.object({ id: WatchId, sha256: Sha256, decision: z.enum(["accepted", "rejected"]) }).strict().parse(input);
  WatchId.parse(reviewerId);
  const { row, draft } = await readRepresentativeDraft(db, decision.id);
  if (decision.sha256 !== row.payload_sha256) return fail("representative-review-hash-conflict");
  const decidedAt = CanonicalInstant.parse(now.toISOString());
  if (row.created_at > decidedAt) return fail("representative-review-time-conflict");
  const previous = await db.prepare("SELECT decision FROM representative_decisions WHERE draft_id=?").bind(decision.id).first<{ decision: string }>();
  if (previous) {
    if (previous.decision !== decision.decision) return fail("representative-decision-conflict");
    return { outcome: "unchanged" as const };
  }
  let snapshot = null;
  let guards: D1StatementLike[] = [];
  if (decision.decision === "accepted") {
    const reviewed = reviewedDraft(draft, reviewerId, decidedAt, sourceRule);
    const digests = [];
    for (const fact of reviewed.facts) digests.push({ id: fact.id, sha256: await acceptedFactDigest(fact) });
    snapshot = RepresentativeSnapshotAcceptance.parse({ id: draft.id, revision: draft.expectedRevision + 1, scope: draft.scope,
      rosterFactId: draft.rosterFactId, acceptedAt: decidedAt,
      reviewBindingVersion: sourceRule ? "source-rule-roster-1" : "authenticated-review-1", factDigests: digests });
    await resolve(reviewed, snapshot, policy, now);
    guards = policy.acceptanceGuards?.(draft.id) ?? [];
    if (!guards.length) return fail("representative-source-guards-required");
  }
  const writes = [...guards, db.prepare("INSERT INTO representative_decisions VALUES(?,?,?,?,?)")
    .bind(draft.id, decision.decision, reviewerId, decidedAt, snapshot ? canonicalJson(snapshot) : null)];
  if (snapshot) writes.push(db.prepare("INSERT INTO representative_heads VALUES(?,?,?) ON CONFLICT(scope_key) DO UPDATE SET revision=excluded.revision,draft_id=excluded.draft_id")
    .bind(scopeKey(draft.scope), snapshot.revision, draft.id));
  await db.batch(writes);
  return { outcome: decision.decision };
}
export async function readRepresentatives(db: D1DatabaseLike, input: unknown, policy: RepresentativeSourcePolicy, now = new Date()) {
  const query = RepresentativeQuery.parse(input);
  const key = scopeKey({ jurisdiction: query.jurisdiction, jurisdictionId: query.jurisdictionId, bodyId: query.bodyId });
  const head = await db.prepare("SELECT h.revision,h.draft_id,d.snapshot_json,d.reviewer_id,d.decided_at FROM representative_heads h JOIN representative_decisions d ON d.draft_id=h.draft_id WHERE h.scope_key=? AND d.decision='accepted'")
    .bind(key).first<{ revision: number; draft_id: string; snapshot_json: string; reviewer_id: string; decided_at: string }>();
  if (!head) return representativeDirectoryUnavailable(query, now.toISOString());
  const { draft } = await readRepresentativeDraft(db, head.draft_id);
  const snapshot = RepresentativeSnapshotAcceptance.parse(JSON.parse(head.snapshot_json));
  if (snapshot.revision !== head.revision || snapshot.id !== head.draft_id || scopeKey(snapshot.scope) !== key)
    return fail("representative-storage-invalid", 503);
  const sourceRule = snapshot.reviewBindingVersion === "source-rule-roster-1";
  if (sourceRule && head.reviewer_id !== "source-rule:official-roster") return fail("representative-storage-invalid", 503);
  const resolvedDraft = snapshot.reviewBindingVersion ? reviewedDraft(draft, head.reviewer_id, head.decided_at, sourceRule) : draft;
  if (snapshot.reviewBindingVersion && snapshot.acceptedAt !== head.decided_at) return fail("representative-storage-invalid", 503);
  const result = queryRepresentatives(await resolve(resolvedDraft, snapshot, policy, now), query);
  const current = await db.prepare("SELECT draft_id,revision FROM representative_heads WHERE scope_key=?").bind(key)
    .first<{ draft_id: string; revision: number }>();
  if (current?.draft_id !== head.draft_id || current.revision !== head.revision) return fail("representative-head-changed");
  return result;
}
