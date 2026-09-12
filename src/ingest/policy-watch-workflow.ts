import { z } from "zod";
import { CanonicalInstant, EvidenceReference, PolicyDossierDraft, WatchId, canonicalJson, sha256, tupleKey, developmentIdentityKey, evidenceReferenceDigest } from "../content/watch-schema";
import { materializePolicyCapture } from "./policy-watch-native";
import { deliveryDependencyKey, deliveryEasternDay } from "../content/watch-delivery";
import type { D1DatabaseLike, D1StatementLike } from "./persistence";

type CaptureRow = { sequence: number; id: string; subject_id: string; payload_sha256: string; payload_json: string };
async function evidenceRetractions(db: D1DatabaseLike, subjectId: string, captureId: string, current: EvidenceReference[], at: string) {
  const table = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='watch_editorial_drafts'").first();
  if (!table) return [];
  const count = await db.prepare("SELECT count(*) AS count FROM watch_editorial_drafts WHERE subject_id=?").bind(subjectId).first<{ count: number }>();
  if (!count) throw new Error("policy-watch-draft-scan-unavailable");
  const rows = await db.prepare("SELECT DISTINCT e.value AS evidence_json FROM watch_editorial_drafts d,json_each(d.payload_json,'$.evidence') e JOIN policy_watch_captures c ON c.subject_id=d.subject_id AND c.observation_id=json_extract(e.value,'$.observationId') WHERE d.subject_id=? LIMIT 401")
    .bind(subjectId).all<{ evidence_json: string }>();
  if (!rows.results || rows.results.length > 400) throw new Error("policy-watch-retraction-bound-exceeded");
  const currentKeys = new Set<string>();
  for (const item of current) currentKeys.add(await deliveryDependencyKey("evidence", [item.id, await evidenceReferenceDigest(item)]));
  const statements: D1StatementLike[] = [
    db.prepare("INSERT INTO policy_watch_capture_scan_guards SELECT ?,CASE WHEN (SELECT count(*) FROM watch_editorial_drafts WHERE subject_id=?)=? THEN 1 ELSE 0 END")
      .bind(captureId, subjectId, count.count),
  ];
  const seen = new Set<string>();
  for (const row of rows.results) {
    const evidence = EvidenceReference.parse(JSON.parse(row.evidence_json));
    const key = await deliveryDependencyKey("evidence", [evidence.id, await evidenceReferenceDigest(evidence)]);
    if (seen.has(key) || currentKeys.has(key)) continue;
    seen.add(key);
    const recordId = await tupleKey("policy-watch-retraction-v1", [captureId, key]);
    // Read the head in the write transaction: an approval committed after the
    // pre-scan is still retracted. Never create missing heads or permissions.
    statements.push(db.prepare("INSERT INTO watch_dependency_records SELECT ?,dependency_key,kind,revision+1,NULL,MAX(changed_at,?) FROM watch_dependency_heads WHERE dependency_key=? AND kind='evidence' AND digest IS NOT NULL")
      .bind(recordId, at, key));
    statements.push(db.prepare("UPDATE watch_dependency_heads SET revision=(SELECT revision FROM watch_dependency_records WHERE immutable_record_id=?),digest=NULL,immutable_record_id=?,changed_at=(SELECT changed_at FROM watch_dependency_records WHERE immutable_record_id=?) WHERE dependency_key=? AND EXISTS(SELECT 1 FROM watch_dependency_records WHERE immutable_record_id=?)")
      .bind(recordId, recordId, recordId, key, recordId));
  }
  return statements;
}
/** Review-only ledger. No watch_subjects, public rows or model calls are written. */
export async function persistPolicyWatchCapture(db: D1DatabaseLike, input: unknown) {
  const material = await materializePolicyCapture(input), { parsed, subjectId } = material;
  const payload = canonicalJson(parsed), digest = await sha256(payload);
  // Retrieval time is not event identity and cannot turn a recheck into a development.
  const content = { ...parsed, source: { ...parsed.source, retrievedAt: null } };
  const id = await tupleKey("policy-watch-capture-v1", [subjectId, await sha256(canonicalJson(content))]);
  const prior = await db.prepare("SELECT sequence,id,subject_id,payload_sha256,payload_json FROM policy_watch_captures WHERE id=?")
    .bind(id).first<CaptureRow>();
  if (prior) return { id, revision: prior.sequence, outcome: "unchanged" as const };
  const statements = [
    db.prepare("INSERT OR IGNORE INTO policy_watch_instruments VALUES(?,?,?)").bind(subjectId, canonicalJson(parsed.identity), parsed.source.retrievedAt),
    db.prepare("INSERT INTO policy_watch_captures(id,subject_id,observation_id,payload_sha256,payload_json,retrieved_at,source_url) VALUES(?,?,?,?,?,?,?)")
      .bind(id, subjectId, material.observation.id, digest, payload, parsed.source.retrievedAt, parsed.source.sourceUrl),
  ];
  statements.push(...await evidenceRetractions(db, subjectId, id, material.evidence, parsed.source.retrievedAt));
  for (const action of material.actions) statements.push(db.prepare("INSERT INTO policy_watch_action_revisions VALUES(?,?,?,?)")
    .bind(action.value.id, id, await developmentIdentityKey(subjectId, "policy-action", await sha256(action.eventKey)), canonicalJson(action.value)));
  try { await db.batch(statements); }
  catch (error) {
    const replay = await db.prepare("SELECT sequence FROM policy_watch_captures WHERE id=?").bind(id).first<{ sequence: number }>();
    if (replay) return { id, revision: replay.sequence, outcome: "unchanged" as const };
    throw error;
  }
  const stored = await db.prepare("SELECT sequence FROM policy_watch_captures WHERE id=?").bind(id).first<{ sequence: number }>();
  if (!stored) throw new Error("policy-watch-write-unconfirmed");
  return { id, revision: stored.sequence, outcome: "staged" as const };
}
export async function readPolicyWatchCapture(db: D1DatabaseLike, id: string) {
  WatchId.parse(id);
  const row = await db.prepare("SELECT sequence,id,subject_id,payload_sha256,payload_json FROM policy_watch_captures WHERE id=?")
    .bind(id).first<CaptureRow>();
  if (!row) throw new Error("policy-watch-capture-not-found");
  if (new TextEncoder().encode(row.payload_json).length > 500_000 || await sha256(row.payload_json) !== row.payload_sha256)
    throw new Error("policy-watch-capture-corrupt");
  const material = await materializePolicyCapture(JSON.parse(row.payload_json));
  if (material.subjectId !== row.subject_id) throw new Error("policy-watch-capture-corrupt");
  return { row, material };
}

export async function resolvePolicyWatchEvidence(db: D1DatabaseLike, subjectId: string, observationIds: readonly string[]) {
  WatchId.parse(subjectId); z.array(WatchId).min(1).max(100).parse(observationIds);
  const head = await db.prepare("SELECT id,sequence FROM policy_watch_captures WHERE subject_id=? ORDER BY sequence DESC LIMIT 1")
    .bind(subjectId).first<{ id: string; sequence: number }>();
  if (!head) throw new Error("policy-watch-current-capture-unavailable");
  const { row, material } = await readPolicyWatchCapture(db, head.id);
  if (row.subject_id !== subjectId || row.sequence !== head.sequence ||
    observationIds.some(id => id !== material.observation.id)) throw new Error("policy-watch-observation-not-current");
  const acceptanceGuards = (decisionId: string): D1StatementLike[] => {
    WatchId.parse(decisionId);
    return [db.prepare("INSERT INTO policy_watch_acceptance_guards SELECT ?,?,CASE WHEN (SELECT id FROM policy_watch_captures WHERE subject_id=? ORDER BY sequence DESC LIMIT 1)=? AND (SELECT sequence FROM policy_watch_captures WHERE id=?)=? THEN 1 ELSE 0 END")
      .bind(decisionId, row.id, subjectId, row.id, row.id, row.sequence)];
  };
  return { observations: new Map([[material.observation.id, material.observation]]), acceptanceGuards,
    captureId: row.id, revision: row.sequence };
}
/** Linking old PA persistence is identity/version corroboration, not source evidence.
 * The new capture must independently retain its official source representation. */
export async function linkPaPolicyVersion(db: D1DatabaseLike, captureId: string, versionRowId: string) {
  WatchId.parse(versionRowId);
  const { material } = await readPolicyWatchCapture(db, captureId), capture = material.parsed;
  const row = await db.prepare("SELECT p.jurisdiction,p.session,p.instrument_id,v.version_id,v.text_url FROM policy_versions v JOIN policy_instruments p ON p.id=v.instrument_row_id WHERE v.id=?")
    .bind(versionRowId).first<{ jurisdiction: string; session: string; instrument_id: string; version_id: string | null; text_url: string | null }>();
  if (!row || row.jurisdiction !== "PA" || capture.identity.jurisdiction !== "PA" || row.session !== capture.identity.sessionKey ||
    row.instrument_id !== capture.identity.sourceInstrumentId || row.version_id !== capture.version.nativeId || row.text_url !== capture.version.textUrl)
    throw new Error("policy-watch-pa-version-conflict");
  await db.prepare("INSERT OR IGNORE INTO policy_watch_version_links VALUES(?,?)").bind(captureId, versionRowId).run();
  const stored = await db.prepare("SELECT version_row_id FROM policy_watch_version_links WHERE capture_id=?").bind(captureId).first<{ version_row_id: string }>();
  if (stored?.version_row_id !== versionRowId) throw new Error("policy-watch-pa-version-conflict");
}
/** Structural EditorialProposal bridge. Root's stageEditorialProposal validates
 * this value; no accepted facts or verification receipts are manufactured. */
export async function buildPolicyEditorialProposal(db: D1DatabaseLike, captureId: string, slug: string, now = new Date()) {
  const { row, material } = await readPolicyWatchCapture(db, captureId), { parsed, subjectId } = material;
  const resolved = await resolvePolicyWatchEvidence(db, subjectId, [material.observation.id]);
  if (resolved.captureId !== captureId) throw new Error("policy-watch-capture-not-current");
  CanonicalInstant.parse(now.toISOString());
  if (parsed.source.retrievedAt > now.toISOString()) throw new Error("policy-watch-future-capture");
  const fact = (field: string, value: unknown, evidenceIds: string[], suffix = field) => ({
    id: subjectId + ":" + suffix, subjectId, field, value, evidenceIds, interpretationDependencies: null });
  const facts = [fact("title", parsed.title, [material.titleEvidenceId]), fact("policy-identity", parsed.identity, [material.identityEvidenceId])];
  // Native action ordering is not universally chronological. All unknown/future
  // dates remain in the ledger; no guessed latest action enters the public draft.
  const day = deliveryEasternDay(now.toISOString());
  const ordered = material.actions.filter(action => {
    const date = action.value.sourceOccurredAt;
    return date.precision === "instant" ? date.value <= now.toISOString() : date.precision === "day" && date.value <= day;
  }).sort((a, b) => {
      const left = a.value.sourceOccurredAt, right = b.value.sourceOccurredAt;
      if (left.precision === "unknown" || right.precision === "unknown") return 0;
      return left.value.localeCompare(right.value) || (a.value.sourceOrder ?? 0) - (b.value.sourceOrder ?? 0) || a.value.id.localeCompare(b.value.id);
    });
  const selected = ordered.slice(-20), timelineFactIds = [];
  for (const action of selected) {
    const item = fact("timeline-action", action.value, [action.evidenceId], "action-" + await sha256(action.eventKey));
    timelineFactIds.push(item.id); facts.push(item);
  }
  const last = selected.at(-1), previous = selected.at(-2);
  const tied = last && previous && last.value.sourceOccurredAt.precision !== "unknown" && previous.value.sourceOccurredAt.precision !== "unknown" &&
    last.value.sourceOccurredAt.value === previous.value.sourceOccurredAt.value &&
    (last.value.sourceOrder === null || previous.value.sourceOrder === null || last.value.sourceOrder === previous.value.sourceOrder);
  const latest = parsed.historyComplete && last && !tied && ordered.length === material.actions.length ? fact("latest-action", last.value, [last.evidenceId]) : null;
  if (latest) facts.push(latest);
  const unavailable = { unavailableReason: "No reviewed source-bound fact is available." };
  const draft = PolicyDossierDraft.parse({ id: subjectId, slug, subjectRevision: row.sequence, kind: "policy",
    titleFactId: facts[0].id, identityFactId: facts[1].id, lifecycle: unavailable, legalEffect: unavailable,
    latestAction: latest ? { factId: latest.id } : { unavailableReason: "Complete unambiguous native action ordering is not established." },
    topics: unavailable, summary: unavailable, interpretation: { readiness: "review-pending",
      reason: "Native metadata awaits source and applicability review." }, timelineFactIds });
  const used = new Set(facts.flatMap(item => item.evidenceIds));
  const proposal = { externalKey: "policy-native:" + subjectId, draft, facts,
    evidence: material.evidence.filter(item => used.has(item.id)) };
  if (new TextEncoder().encode(canonicalJson(proposal)).length > 500_000) throw new Error("policy-watch-proposal-limit");
  return { proposal, observations: [material.observation], gaps: parsed.gaps, captureId, acceptance: "unreviewed" as const,
    acceptanceGuards: resolved.acceptanceGuards };
}
export async function listPolicyWatchCaptures(db: D1DatabaseLike, afterSequence = 0, limit = 20) {
  z.number().int().nonnegative().safe().parse(afterSequence); z.number().int().min(1).max(50).parse(limit);
  const result = await db.prepare("SELECT sequence,id,subject_id,retrieved_at,source_url FROM policy_watch_captures WHERE sequence>? ORDER BY sequence LIMIT ?")
    .bind(afterSequence, limit).all();
  if (!result.results || ("success" in result && result.success === false)) throw new Error("policy-watch-unavailable");
  return result.results;
}
