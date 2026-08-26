import { ContentItem as ContentItemSchema, type ContentItem } from "../content/schema";
import { retainPublishedIdentity } from "../content/merge";
import type { IngestRun } from "./run-all";
import type { EditorDecision } from "./editor";
import { EditorEnrichment, EDITOR_PROMPT_VERSION } from "./editor-model";
import { EDITOR_POLICY_VERSION } from "./editor";
import type { EditorModelState } from "./editor-work";
import type { SourceRunNote } from "./source-health";

export type D1StatementLike = {
  bind(...values: unknown[]): D1StatementLike;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
};

export type D1DatabaseLike = {
  prepare(query: string): D1StatementLike;
  batch(statements: D1StatementLike[]): Promise<unknown[]>;
};

export type EnrichmentAttempt = {
  fingerprint: string;
  attemptedAt: string;
  outcome: "success" | "failure";
  error: string | null;
};

export type CandidateEnrichment = {
  item: ContentItem;
  enrichment: EditorEnrichment | null;
  attempt?: EnrichmentAttempt;
};

export type CandidateEditorialDecision = CandidateEnrichment & {
  decision: EditorDecision;
};

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function candidateFingerprint(item: ContentItem) {
  return sha256(JSON.stringify({
    editorPromptVersion: EDITOR_PROMPT_VERSION,
    id: item.id,
    kind: item.kind,
    slug: item.slug,
    title: item.title,
    dek: item.dek,
    body: item.body,
    orgs: [...item.orgs].sort(),
    topics: [...item.topics].sort(),
    region: item.region,
    ...(item.kind === "event" ? {
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      timezone: item.timezone,
      venue: item.venue,
      city: item.city,
      hostOrg: item.hostOrg,
      registrationUrl: item.registrationUrl,
      partner: item.partner,
    } : {}),
    source: {
      origin: item.source.origin,
      url: item.source.url,
      externalId: item.source.externalId,
    },
  }));
}

type CandidateModelRow = {
  id: string;
  fingerprint: string;
  enrichment_json: string | null;
  enrichment_fingerprint: string | null;
  enrichment_outcome: string | null;
  enrichment_attempted_at: string | null;
  enrichment_error: string | null;
  enrichment_attempt_count: number | null;
  first_seen_at: string;
  queue_status: string;
};

async function loadCandidateModelRows(db: D1DatabaseLike, items: ContentItem[]) {
  const byId = new Map<string, CandidateModelRow>();
  for (let index = 0; index < items.length; index += 50) {
    const chunk = items.slice(index, index + 50);
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = await db.prepare(`
      SELECT id, fingerprint, enrichment_json, enrichment_fingerprint, enrichment_outcome,
             enrichment_attempted_at, enrichment_error, enrichment_attempt_count,
             first_seen_at, queue_status
      FROM content_candidates
      WHERE id IN (${placeholders})
    `).bind(...chunk.map((item) => item.id)).all<CandidateModelRow>();
    for (const row of rows.results ?? []) byId.set(row.id, row);
  }
  return byId;
}

function parseCachedEnrichment(raw: string | null) {
  if (!raw) return null;
  try {
    const parsed = EditorEnrichment.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function readEditorModelCache(
  db: D1DatabaseLike,
  items: ContentItem[],
) {
  const rows = await loadCandidateModelRows(db, items);
  const states = new Map<string, EditorModelState>();
  const reusable = new Map<string, EditorEnrichment>();
  for (const item of items) {
    const row = rows.get(item.id);
    if (!row) continue;
    const cached = parseCachedEnrichment(row.enrichment_json);
    states.set(item.id, {
      id: row.id,
      fingerprint: row.fingerprint,
      enrichmentFingerprint: row.enrichment_fingerprint,
      outcome: row.enrichment_outcome,
      attemptedAt: row.enrichment_attempted_at,
      attemptCount: Number(row.enrichment_attempt_count ?? 0),
      firstSeenAt: row.first_seen_at,
      queueStatus: row.queue_status,
      hasSuccessfulEnrichment: Boolean(cached),
    });
    if (row.enrichment_outcome === "failure" || !cached) continue;
    const itemFingerprint = await candidateFingerprint(item);
    const cachedFingerprint = row.enrichment_fingerprint || row.fingerprint;
    if (cachedFingerprint === itemFingerprint) reusable.set(item.id, cached);
  }
  return { reusable, states };
}

export async function readEditorModelStates(
  db: D1DatabaseLike,
  items: ContentItem[],
) {
  return (await readEditorModelCache(db, items)).states;
}

export async function readReusableEnrichments(
  db: D1DatabaseLike,
  items: ContentItem[],
) {
  return (await readEditorModelCache(db, items)).reusable;
}

/** Sidecar enrichment happens only after the raw firehose is durably queued. */
export async function persistEnrichments(
  db: D1DatabaseLike,
  candidates: CandidateEnrichment[],
) {
  const statements = candidates.flatMap(({ item, enrichment, attempt }) => {
    if (!attempt) return [];
    const json = enrichment ? JSON.stringify(enrichment) : null;
    const score = enrichment?.relevanceScore ?? null;
    return [db.prepare(`
      UPDATE content_candidates
      SET
        enrichment_json = CASE WHEN ? IS NOT NULL THEN ? ELSE enrichment_json END,
        relevance_score = CASE WHEN ? IS NOT NULL THEN ? ELSE relevance_score END,
        enrichment_fingerprint = ?,
        enrichment_attempted_at = ?,
        enrichment_outcome = ?,
        enrichment_error = ?,
        enrichment_attempt_count = CASE
          WHEN enrichment_fingerprint IS NULL OR enrichment_fingerprint != ? THEN 1
          ELSE enrichment_attempt_count + 1
        END
      WHERE id = ? AND queue_status = 'review'
    `).bind(
      json,
      json,
      score,
      score,
      attempt.fingerprint,
      attempt.attemptedAt,
      attempt.outcome,
      attempt.error ? attempt.error.slice(0, 1000) : null,
      attempt.fingerprint,
      item.id,
    )];
  });
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
  return statements.length;
}

export async function persistIngestRun(
  db: D1DatabaseLike,
  run: IngestRun,
  candidates: CandidateEnrichment[],
) {
  const runId = crypto.randomUUID();
  const startedAt = run.fetchedAt;
  await db.prepare(
    "INSERT INTO ingest_runs (id, started_at, state, item_count, notes_json) VALUES (?, ?, 'running', ?, ?)",
  ).bind(runId, startedAt, candidates.length, JSON.stringify(run.notes)).run();

  try {
    const statements: D1StatementLike[] = [];
    for (const { item, enrichment } of candidates) {
      const fingerprint = await candidateFingerprint(item);
      statements.push(db.prepare(`
        INSERT INTO content_candidates (
          id, fingerprint, kind, title, source_origin, source_external_id, source_url,
          item_status, queue_status, content_json, enrichment_json, relevance_score,
          first_seen_at, last_seen_at, last_run_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'review', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          fingerprint = excluded.fingerprint,
          kind = excluded.kind,
          title = excluded.title,
          source_origin = excluded.source_origin,
          source_external_id = excluded.source_external_id,
          source_url = excluded.source_url,
          item_status = CASE
            WHEN content_candidates.queue_status = 'approved' THEN content_candidates.item_status
            ELSE excluded.item_status
          END,
          content_json = CASE
            WHEN content_candidates.queue_status = 'approved' THEN content_candidates.content_json
            ELSE excluded.content_json
          END,
          enrichment_json = CASE
            WHEN content_candidates.queue_status = 'approved' THEN content_candidates.enrichment_json
            ELSE COALESCE(excluded.enrichment_json, content_candidates.enrichment_json)
          END,
          relevance_score = CASE
            WHEN content_candidates.queue_status = 'approved' THEN content_candidates.relevance_score
            ELSE COALESCE(excluded.relevance_score, content_candidates.relevance_score)
          END,
          last_seen_at = excluded.last_seen_at,
          last_run_id = excluded.last_run_id,
          missing_count = 0,
          last_missing_at = NULL
        WHERE content_candidates.queue_status != 'rejected'
      `).bind(
        item.id,
        fingerprint,
        item.kind,
        item.title,
        item.source.origin,
        item.source.externalId ?? null,
        item.source.url ?? null,
        item.status,
        JSON.stringify(item),
        enrichment ? JSON.stringify(enrichment) : null,
        enrichment?.relevanceScore ?? null,
        run.fetchedAt,
        run.fetchedAt,
        runId,
      ));
    }
    for (let index = 0; index < statements.length; index += 50) {
      await db.batch(statements.slice(index, index + 50));
    }
    return { runId, itemCount: candidates.length };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Unknown persistence error";
    await db.prepare(
      "UPDATE ingest_runs SET state = 'failed', finished_at = ?, error = ? WHERE id = ?",
    ).bind(new Date().toISOString(), message, runId).run();
    throw error;
  }
}

export async function persistSourceHealth(
  db: D1DatabaseLike,
  runId: string,
  sources: SourceRunNote[],
) {
  const statements = sources.map((source) => db.prepare(`
    INSERT INTO source_health (
      source_id, origin, source_type, source_url, state, complete, item_count,
      consecutive_failures, last_checked_at, last_success_at, last_error, last_run_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      origin = excluded.origin,
      source_type = excluded.source_type,
      source_url = excluded.source_url,
      state = excluded.state,
      complete = excluded.complete,
      item_count = excluded.item_count,
      consecutive_failures = CASE
        WHEN excluded.state = 'success' THEN 0
        ELSE source_health.consecutive_failures + 1
      END,
      last_checked_at = excluded.last_checked_at,
      last_success_at = CASE
        WHEN excluded.state = 'success' THEN excluded.last_checked_at
        ELSE source_health.last_success_at
      END,
      last_error = CASE WHEN excluded.state = 'error' THEN excluded.last_error ELSE NULL END,
      last_run_id = excluded.last_run_id
  `).bind(
    source.id,
    source.origin,
    source.type,
    source.url ?? null,
    source.state,
    source.complete ? 1 : 0,
    source.itemCount,
    source.state === "error" ? 1 : 0,
    source.checkedAt,
    source.state === "success" ? source.checkedAt : null,
    source.error ?? null,
    runId,
  ));
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
  return statements.length;
}

export async function reconcileMissingPublishedEvents(
  db: D1DatabaseLike,
  runId: string,
  fetchedAt: string,
  sources: SourceRunNote[],
  missingThreshold = 2,
) {
  const threshold = Math.max(2, Math.trunc(missingThreshold));
  let missing = 0;
  let withdrawn = 0;
  for (const source of sources) {
    if (source.type !== "events" || source.state !== "success" || !source.complete) continue;
    const absent = await db.prepare(`
      SELECT c.id
      FROM content_candidates c
      JOIN published_content p ON p.candidate_id = c.id
      WHERE c.kind = 'event' AND c.source_origin = ? AND c.last_seen_at < ?
        AND c.queue_status = 'approved'
    `).bind(source.origin, fetchedAt).all<{ id: string }>();
    const ids = (absent.results ?? []).map((row) => row.id);
    missing += ids.length;
    for (let index = 0; index < ids.length; index += 50) {
      const chunk = ids.slice(index, index + 50);
      if (!chunk.length) continue;
      const placeholders = chunk.map(() => "?").join(", ");
      await db.prepare(`
        UPDATE content_candidates
        SET missing_count = missing_count + 1, last_missing_at = ?
        WHERE id IN (${placeholders})
      `).bind(fetchedAt, ...chunk).run();
      await db.prepare(`
        INSERT INTO publication_reconciliations (
          candidate_id, source_id, action, missing_count, reason, run_id, reconciled_at
        )
        SELECT id, ?, 'missing', missing_count, 'Absent from successful complete source check', ?, ?
        FROM content_candidates
        WHERE id IN (${placeholders})
      `).bind(source.id, runId, fetchedAt, ...chunk).run();
    }
    const expired = await db.prepare(`
      SELECT c.id, c.missing_count
      FROM content_candidates c
      JOIN published_content p ON p.candidate_id = c.id
      WHERE c.kind = 'event' AND c.source_origin = ? AND c.last_seen_at < ?
        AND c.queue_status = 'approved' AND c.missing_count >= ?
    `).bind(source.origin, fetchedAt, threshold).all<{ id: string; missing_count: number }>();
    for (const row of expired.results ?? []) {
      await db.batch([
        db.prepare(`
          UPDATE content_candidates
          SET queue_status = 'review', item_status = 'unpublished', reviewed_at = ?
          WHERE id = ?
        `).bind(fetchedAt, row.id),
        db.prepare("DELETE FROM published_content WHERE candidate_id = ?").bind(row.id),
        db.prepare(`
          INSERT INTO publication_reconciliations (
            candidate_id, source_id, action, missing_count, reason, run_id, reconciled_at
          ) VALUES (?, ?, 'withdrawn', ?, 'Absent from two successful complete source checks', ?, ?)
        `).bind(row.id, source.id, row.missing_count, runId, fetchedAt),
      ]);
      withdrawn += 1;
    }
  }
  return { missing, withdrawn };
}

export async function markIngestRunSucceeded(
  db: D1DatabaseLike,
  runId: string,
  finishedAt = new Date().toISOString(),
) {
  await db.prepare(
    "UPDATE ingest_runs SET state = 'succeeded', finished_at = ?, error = NULL WHERE id = ?",
  ).bind(finishedAt, runId).run();
  return finishedAt;
}

export async function markIngestRunFailed(
  db: D1DatabaseLike,
  runId: string,
  error: string,
  finishedAt = new Date().toISOString(),
) {
  await db.prepare(
    "UPDATE ingest_runs SET state = 'failed', finished_at = ?, error = ? WHERE id = ?",
  ).bind(finishedAt, error.slice(0, 1000), runId).run();
}

export async function acquireAutomationLock(
  db: D1DatabaseLike,
  owner: string,
  now = new Date(),
  leaseMinutes = 14,
) {
  const expiresAt = new Date(now.getTime() + leaseMinutes * 60_000).toISOString();
  await db.prepare(`
    INSERT INTO automation_locks (name, owner_run_id, expires_at)
    VALUES ('hourly-ingest', ?, ?)
    ON CONFLICT(name) DO UPDATE SET owner_run_id = excluded.owner_run_id, expires_at = excluded.expires_at
    WHERE automation_locks.expires_at <= ?
  `).bind(owner, expiresAt, now.toISOString()).run();
  const row = await db.prepare(
    "SELECT owner_run_id FROM automation_locks WHERE name = 'hourly-ingest'",
  ).first<{ owner_run_id: string }>();
  return row?.owner_run_id === owner;
}

export async function releaseAutomationLock(db: D1DatabaseLike, owner: string) {
  await db.prepare(
    "DELETE FROM automation_locks WHERE name = 'hourly-ingest' AND owner_run_id = ?",
  ).bind(owner).run();
}

export async function persistEditorialDecisions(
  db: D1DatabaseLike,
  candidates: CandidateEditorialDecision[],
  model: string,
  provider: string,
  now = new Date(),
) {
  const counts = { published: 0, review: 0, rejected: 0 };
  for (const { item, enrichment, decision } of candidates) {
    const countKey = decision.action === "publish"
      ? "published"
      : decision.action === "reject"
        ? "rejected"
        : "review";
    counts[countKey] += 1;
    const decidedAt = now.toISOString();
    try {
      if (decision.action === "publish") {
        let publication = decision.content;
        const existing = await db.prepare(
          "SELECT content_json FROM published_content WHERE candidate_id = ? LIMIT 1",
        ).bind(item.id).first<{ content_json: string }>();
        if (existing) {
          try {
            const parsed = ContentItemSchema.safeParse(JSON.parse(existing.content_json));
            if (parsed.success) {
              publication = ContentItemSchema.parse(retainPublishedIdentity(parsed.data, publication));
            }
          } catch {
            // Invalid old rows are replaced by the freshly validated publication.
          }
        }
        const storedDecision = { ...decision, content: publication };
        await db.batch([
        db.prepare(`
          UPDATE content_candidates
          SET item_status = 'published', queue_status = 'approved', content_json = ?,
              enrichment_json = ?, relevance_score = ?, reviewed_at = ?
          WHERE id = ? AND queue_status != 'rejected'
        `).bind(
          JSON.stringify(publication),
          enrichment ? JSON.stringify(enrichment) : null,
          enrichment?.relevanceScore ?? Math.round(decision.confidence * 100),
          decidedAt,
          item.id,
        ),
        db.prepare(`
          INSERT INTO published_content (
            candidate_id, id, kind, slug, content_json, policy_version, decision_json,
            first_published_at, updated_at
          )
          SELECT id, id, ?, ?, ?, ?, ?, ?, ? FROM content_candidates
          WHERE id = ? AND queue_status != 'rejected'
          ON CONFLICT(candidate_id) DO UPDATE SET
            kind = excluded.kind,
            slug = published_content.slug,
            content_json = excluded.content_json,
            policy_version = excluded.policy_version,
            decision_json = excluded.decision_json,
            updated_at = excluded.updated_at
        `).bind(
          publication.kind,
          publication.slug,
          JSON.stringify(publication),
          EDITOR_POLICY_VERSION,
          JSON.stringify(storedDecision),
          publication.publishedAt ?? decidedAt,
          decidedAt,
          item.id,
        ),
        db.prepare(`
          INSERT INTO candidate_decisions (
            candidate_id, decision, note, reviewer, decided_at, method, provider,
            model, policy_version, confidence, evidence_json, metadata_json
          )
          SELECT ?, 'approved', ?, 'editor-in-chief', ?, 'automatic', ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM candidate_decisions
            WHERE candidate_id = ? AND decision = 'approved' AND method = 'automatic'
              AND policy_version = ? AND metadata_json = ?
          )
        `).bind(
          item.id,
          `${decision.rule}: ${decision.reasons.join("; ")}`.slice(0, 1000),
          decidedAt,
          provider,
          model,
          EDITOR_POLICY_VERSION,
          decision.confidence,
          JSON.stringify(enrichment?.evidenceSpans ?? []),
          JSON.stringify({ action: decision.action, rule: decision.rule }),
          item.id,
          EDITOR_POLICY_VERSION,
          JSON.stringify({ action: decision.action, rule: decision.rule }),
        ),
        ]);
        continue;
      }
      if (decision.action === "reject") {
        await db.batch([
        db.prepare(`
          UPDATE content_candidates SET queue_status = 'rejected', reviewed_at = ?, item_status = 'unpublished'
          WHERE id = ? AND queue_status != 'rejected'
        `).bind(decidedAt, item.id),
        db.prepare("DELETE FROM published_content WHERE candidate_id = ?").bind(item.id),
        db.prepare(`
          INSERT INTO candidate_decisions (
            candidate_id, decision, note, reviewer, decided_at, method, provider,
            model, policy_version, confidence, evidence_json, metadata_json
          )
          SELECT ?, 'rejected', ?, 'editor-in-chief', ?, 'automatic', ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM candidate_decisions
            WHERE candidate_id = ? AND decision = 'rejected' AND method = 'automatic'
              AND policy_version = ? AND metadata_json = ?
          )
        `).bind(
          item.id,
          `${decision.rule}: ${decision.reasons.join("; ")}`.slice(0, 1000),
          decidedAt,
          provider,
          model,
          EDITOR_POLICY_VERSION,
          decision.confidence,
          JSON.stringify(enrichment?.evidenceSpans ?? []),
          JSON.stringify({ action: decision.action, rule: decision.rule }),
          item.id,
          EDITOR_POLICY_VERSION,
          JSON.stringify({ action: decision.action, rule: decision.rule }),
        ),
        ]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown D1 error";
      throw new Error(
        `Editorial persistence failed for ${item.id} (${decision.action}/${decision.rule}): ${message}`,
        { cause: error },
      );
    }
  }
  return counts;
}

export async function readPublishedContent(db: D1DatabaseLike, limit = 200): Promise<ContentItem[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  const rows = await db.prepare(
    "SELECT content_json FROM published_content ORDER BY updated_at DESC LIMIT ?",
  ).bind(safeLimit).all<{ content_json: string }>();
  const out: ContentItem[] = [];
  for (const row of rows.results ?? []) {
    try {
      const parsed = ContentItemSchema.safeParse(JSON.parse(row.content_json));
      if (parsed.success && parsed.data.status === "published" && parsed.data.source.url) out.push(parsed.data);
    } catch {
      console.error("published-content-invalid-row");
    }
  }
  return out;
}

/**
 * Withdrawals must suppress a matching bundled ingest row as well as its D1
 * publication. Only current withdrawals without a live publication qualify;
 * a later re-publication automatically clears the public tombstone.
 */
export async function readPublicationTombstones(db: D1DatabaseLike, limit = 500): Promise<string[]> {
  const safeLimit = Math.max(1, Math.min(1000, Math.trunc(limit)));
  const rows = await db.prepare(`
    SELECT DISTINCT c.id
    FROM content_candidates c
    JOIN publication_reconciliations r ON r.candidate_id = c.id AND r.action = 'withdrawn'
    LEFT JOIN published_content p ON p.candidate_id = c.id
    WHERE c.item_status = 'unpublished' AND p.candidate_id IS NULL
    ORDER BY r.reconciled_at DESC
    LIMIT ?
  `).bind(safeLimit).all<{ id: string }>();
  return (rows.results ?? []).map((row) => row.id);
}

export async function findPublishedContent(
  db: D1DatabaseLike,
  kind: string,
  slug: string,
): Promise<ContentItem | undefined> {
  const row = await db.prepare(
    `SELECT content_json FROM published_content
     WHERE slug = ? AND (kind = ? OR (? = 'news' AND kind IN ('policy', 'ai', 'interview')))
     LIMIT 1`,
  ).bind(slug, kind, kind).first<{ content_json: string }>();
  if (!row) return undefined;
  try {
    const parsed = ContentItemSchema.safeParse(JSON.parse(row.content_json));
    return parsed.success && parsed.data.status === "published" && parsed.data.source.url
      ? parsed.data
      : undefined;
  } catch {
    return undefined;
  }
}
