import { ContentItem as ContentItemSchema, type ContentItem } from "../content/schema";
import { retainPublishedIdentity } from "../content/merge";
import { isDeliverySafe } from "../content/publication";
import type { IngestRun } from "./run-all";
import type { EditorDecision } from "./editor";
import { EditorEnrichment, EDITOR_PROMPT_VERSION } from "./editor-model";
import { EDITOR_POLICY_VERSION } from "./editor";
import type { EditorModelState } from "./editor-work";
import { VerificationResult, type VerificationResult as VerificationResultType } from "./verification";
import {
  collapseBySourceIdentity,
  normalizeSourceUrl,
  sourceIdentityKey,
  withCanonicalSource,
} from "./identity";
import type {
  NewsArticleExtractionAttempt,
  NewsArticleExtractionState,
} from "./news-extraction";
import {
  NEWS_ARTICLE_CLEANUP_BATCH,
  NEWS_ARTICLE_MAX_ROWS,
  NEWS_ARTICLE_RETENTION_DAYS,
} from "./news-extraction-config";
import {
  SOURCE_RUN_STATES,
  isFailureSourceState,
  isSuccessfulSourceState,
  snapshotCompleteness,
  sourceNextAttemptAt,
  sourceAuthorizesDisappearance,
  type PersistedSourceHealth,
  type SourceRunNote,
} from "./source-health";

export const DEFAULT_AUTOMATION_LEASE_MINUTES = 14;

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
  verification?: VerificationResultType | null;
};

export type CandidateEditorialDecision = CandidateEnrichment & {
  decision: EditorDecision;
};

export type EditorialCounts = {
  published: number;
  review: number;
  rejected: number;
  quarantined: number;
};

const PUBLIC_READ_PAGE_SIZE = 100;
const PUBLIC_READ_MAX_PAGES = 50;

function isConstraintError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /unique|constraint|SQLITE_CONSTRAINT/i.test(message);
}

function uniqueAliasSlugs(publication: ContentItem, incomingSlug?: string) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const slug of [...(publication.previousSlugs ?? []), incomingSlug ?? ""]) {
    if (!slug || slug === publication.slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function candidateFingerprint(item: ContentItem) {
  return sha256(JSON.stringify({
    editorPromptVersion: EDITOR_PROMPT_VERSION,
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
      cancelled: item.cancelled ?? false,
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
  last_seen_at: string;
  content_changed_at: string | null;
  queue_status: string;
  claim_ledger_json: string | null;
  verification_json: string | null;
  verification_at: string | null;
  source_identity?: string | null;
};

type ExistingCandidateRow = {
  id: string;
  source_identity: string | null;
  source_url: string | null;
  fingerprint: string;
  queue_status: string;
};

function preferExisting(next: ExistingCandidateRow, current?: ExistingCandidateRow) {
  if (!current) return true;
  const rank = (status: string) => (status === "approved" ? 0 : status === "review" ? 1 : 2);
  return rank(next.queue_status) < rank(current.queue_status);
}

async function loadRowsByValues<T>(
  db: D1DatabaseLike,
  sql: string,
  values: string[],
): Promise<T[]> {
  const out: T[] = [];
  for (let index = 0; index < values.length; index += 50) {
    const chunk = values.slice(index, index + 50);
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = await db.prepare(sql.replace("IN (?)", `IN (${placeholders})`))
      .bind(...chunk)
      .all<T>();
    out.push(...(rows.results ?? []));
  }
  return out;
}

async function loadCandidateModelRows(db: D1DatabaseLike, items: ContentItem[]) {
  const byId = new Map<string, CandidateModelRow>();
  const byIdentity = new Map<string, CandidateModelRow>();
  const ids = items.map((item) => item.id);
  const identities = [...new Set(items.map((item) => sourceIdentityKey(item)))];
  const select = `
    SELECT id, fingerprint, enrichment_json, enrichment_fingerprint, enrichment_outcome,
           enrichment_attempted_at, enrichment_error, enrichment_attempt_count,
           first_seen_at, last_seen_at, content_changed_at, queue_status,
           claim_ledger_json, verification_json, verification_at, source_identity
    FROM content_candidates
    WHERE id IN (?)
  `;
  const identitySelect = `
    SELECT id, fingerprint, enrichment_json, enrichment_fingerprint, enrichment_outcome,
           enrichment_attempted_at, enrichment_error, enrichment_attempt_count,
           first_seen_at, last_seen_at, content_changed_at, queue_status,
           claim_ledger_json, verification_json, verification_at, source_identity
    FROM content_candidates
    WHERE source_identity IN (?)
  `;
  for (const row of [
    ...await loadRowsByValues<CandidateModelRow>(db, select, ids),
    ...await loadRowsByValues<CandidateModelRow>(db, identitySelect, identities),
  ]) {
    byId.set(row.id, row);
    if (row.source_identity) byIdentity.set(row.source_identity, row);
  }
  return { byId, byIdentity };
}

async function loadExistingCandidates(db: D1DatabaseLike, items: ContentItem[]) {
  const byId = new Map<string, ExistingCandidateRow>();
  const byIdentity = new Map<string, ExistingCandidateRow>();
  const byUrl = new Map<string, ExistingCandidateRow>();
  const remember = (row: ExistingCandidateRow) => {
    if (preferExisting(row, byId.get(row.id))) byId.set(row.id, row);
    if (row.source_identity && preferExisting(row, byIdentity.get(row.source_identity))) {
      byIdentity.set(row.source_identity, row);
    }
    const urls = [row.source_url, normalizeSourceUrl(row.source_url)].filter((value): value is string => Boolean(value));
    for (const url of urls) {
      if (preferExisting(row, byUrl.get(url))) byUrl.set(url, row);
    }
  };
  const select = `
    SELECT id, source_identity, source_url, fingerprint, queue_status
    FROM content_candidates
    WHERE id IN (?)
  `;
  const identitySelect = `
    SELECT id, source_identity, source_url, fingerprint, queue_status
    FROM content_candidates
    WHERE source_identity IN (?)
  `;
  const urlSelect = `
    SELECT id, source_identity, source_url, fingerprint, queue_status
    FROM content_candidates
    WHERE source_url IN (?)
  `;
  const urls = [...new Set(items.flatMap((item) => (
    [item.source.url, normalizeSourceUrl(item.source.url)].filter((value): value is string => Boolean(value))
  )))];
  for (const row of [
    ...await loadRowsByValues<ExistingCandidateRow>(db, select, items.map((item) => item.id)),
    ...await loadRowsByValues<ExistingCandidateRow>(db, identitySelect, items.map((item) => sourceIdentityKey(item))),
    ...await loadRowsByValues<ExistingCandidateRow>(db, urlSelect, urls),
  ]) remember(row);
  return { byId, byIdentity, byUrl };
}

function existingForItem(
  item: ContentItem,
  existing: Awaited<ReturnType<typeof loadExistingCandidates>>,
) {
  const identity = sourceIdentityKey(item);
  const url = normalizeSourceUrl(item.source.url) ?? item.source.url;
  return existing.byIdentity.get(identity)
    ?? existing.byId.get(item.id)
    ?? (url ? existing.byUrl.get(url) : undefined);
}

async function quarantineIdentity(
  db: D1DatabaseLike,
  row: {
    candidateId?: string;
    sourceIdentity?: string | null;
    reason: string;
    content?: unknown;
    runId?: string;
    at?: string;
  },
) {
  try {
    await db.prepare(`
      INSERT INTO identity_quarantine (
        candidate_id, source_identity, reason, content_json, run_id, quarantined_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      row.candidateId ?? null,
      row.sourceIdentity ?? null,
      row.reason.slice(0, 1000),
      row.content ? JSON.stringify(row.content).slice(0, 8000) : null,
      row.runId ?? null,
      row.at ?? new Date().toISOString(),
    ).run();
  } catch (error) {
    console.error("identity-quarantine-write-failed", error instanceof Error ? error.message : "unknown");
  }
}

async function runStatementsOrQuarantine(
  db: D1DatabaseLike,
  rows: Array<{ statement: D1StatementLike; candidateId?: string; sourceIdentity?: string | null; content?: unknown }>,
  runId?: string,
) {
  let quarantined = 0;
  for (let index = 0; index < rows.length; index += 50) {
    const chunk = rows.slice(index, index + 50);
    try {
      await db.batch(chunk.map((row) => row.statement));
    } catch {
      for (const row of chunk) {
        try {
          await row.statement.run();
        } catch (error) {
          quarantined += 1;
          await quarantineIdentity(db, {
            candidateId: row.candidateId,
            sourceIdentity: row.sourceIdentity,
            reason: isConstraintError(error)
              ? `constraint: ${error instanceof Error ? error.message : "unique conflict"}`
              : error instanceof Error ? error.message : "persist failed",
            content: row.content,
            runId,
          });
        }
      }
    }
  }
  return quarantined;
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

function parseCachedVerification(raw: string | null) {
  if (!raw) return null;
  try {
    const parsed = VerificationResult.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Load review rows that were not present in the latest source snapshot. */
export async function readReviewBacklog(db: D1DatabaseLike, limit = 1000) {
  const rows = await db.prepare(`
    SELECT id, content_json
    FROM content_candidates
    WHERE queue_status = 'review'
    ORDER BY
      COALESCE(
        json_extract(content_json, '$.publishedAt'),
        content_changed_at,
        first_seen_at
      ) DESC,
      first_seen_at ASC,
      id ASC
    LIMIT ?
  `).bind(Math.max(1, Math.min(1000, Math.trunc(limit) || 1000))).all<{ id: string; content_json: string }>();
  const byIdentity = new Map<string, ContentItem>();
  for (const row of rows.results ?? []) {
    try {
      const item = ContentItemSchema.parse(JSON.parse(row.content_json));
      const identity = sourceIdentityKey(item);
      if (!byIdentity.has(identity)) byIdentity.set(identity, item);
    } catch {
      // A malformed historic row remains visible to the review API, but must
      // not be allowed to crash the automation scheduler.
    }
  }
  return [...byIdentity.values()];
}

export async function readEditorModelCache(
  db: D1DatabaseLike,
  items: ContentItem[],
) {
  const rows = await loadCandidateModelRows(db, items);
  const states = new Map<string, EditorModelState>();
  const reusable = new Map<string, EditorEnrichment>();
  const verifications = new Map<string, VerificationResultType>();
  for (const item of items) {
    const row = rows.byId.get(item.id) ?? rows.byIdentity.get(sourceIdentityKey(item));
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
      contentChangedAt: row.content_changed_at,
      lastSeenAt: row.last_seen_at,
      queueStatus: row.queue_status,
      hasSuccessfulEnrichment: Boolean(cached),
    });
    const verification = parseCachedVerification(row.verification_json);
    if (verification && row.enrichment_fingerprint === (await candidateFingerprint(item))) {
      verifications.set(item.id, verification);
    }
    if (row.enrichment_outcome === "failure" || !cached) continue;
    const itemFingerprint = await candidateFingerprint(item);
    const cachedFingerprint = row.enrichment_fingerprint || row.fingerprint;
    if (cachedFingerprint === itemFingerprint) reusable.set(item.id, cached);
  }
  return { reusable, states, verifications };
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

export async function readEditorVerifications(
  db: D1DatabaseLike,
  items: ContentItem[],
) {
  return (await readEditorModelCache(db, items)).verifications;
}

/** Sidecar enrichment happens only after the raw firehose is durably queued. */
export async function persistEnrichments(
  db: D1DatabaseLike,
  candidates: CandidateEnrichment[],
) {
  const existing = await loadExistingCandidates(db, candidates.map((row) => row.item));
  const statements = candidates.flatMap(({ item, enrichment, attempt, verification }) => {
    const candidateId = existingForItem(item, existing)?.id ?? item.id;
    if (attempt) {
      const successful = attempt.outcome === "success" && enrichment;
      const json = successful ? JSON.stringify(enrichment) : null;
      const ledger = successful ? JSON.stringify(enrichment.claimLedger ?? { claims: [] }) : null;
      const score = successful ? enrichment.relevanceScore : null;
      return [db.prepare(`
        UPDATE content_candidates
        SET
          enrichment_json = ?,
          relevance_score = ?,
          enrichment_fingerprint = ?,
          enrichment_attempted_at = ?,
          enrichment_outcome = ?,
          enrichment_error = ?,
          enrichment_attempt_count = CASE
            WHEN enrichment_fingerprint IS NULL OR enrichment_fingerprint != ? THEN 1
            ELSE COALESCE(enrichment_attempt_count, 0) + 1
          END,
          claim_ledger_json = ?,
          verification_json = ?,
          verification_at = ?
        WHERE id = ? AND queue_status = 'review'
      `).bind(
        json,
        score,
        attempt.fingerprint,
        attempt.attemptedAt,
        attempt.outcome,
        attempt.error ? attempt.error.slice(0, 1000) : null,
        attempt.fingerprint,
        ledger,
        verification ? JSON.stringify(verification) : null,
        verification ? verification.verifiedAt : null,
        candidateId,
      )];
    }
    if (verification !== undefined && verification !== null) {
      return [db.prepare(`
        UPDATE content_candidates
        SET verification_json = ?, verification_at = ?
        WHERE id = ? AND queue_status = 'review'
      `).bind(
        verification ? JSON.stringify(verification) : null,
        verification?.verifiedAt ?? null,
        candidateId,
      )];
    }
    return [];
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
  const groups = collapseBySourceIdentity(candidates.map((row) => row.item));
  await db.prepare(
    "INSERT INTO ingest_runs (id, started_at, state, item_count, notes_json) VALUES (?, ?, 'running', ?, ?)",
  ).bind(runId, startedAt, groups.length, JSON.stringify(run.notes)).run();

  try {
    const enrichmentById = new Map(candidates.map((row) => [row.item.id, row.enrichment]));
    const enrichmentByIdentity = new Map(
      candidates.map((row) => [sourceIdentityKey(row.item), row.enrichment] as const),
    );
    const existing = await loadExistingCandidates(db, groups.map((group) => group.item));
    const candidateRows: Array<{ statement: D1StatementLike; candidateId?: string; sourceIdentity?: string | null; content?: unknown }> = [];
    const discoveryRows: Array<{ statement: D1StatementLike; candidateId?: string; sourceIdentity?: string | null; content?: unknown }> = [];

    for (const group of groups) {
      const item = withCanonicalSource(group.item);
      const identity = group.identity;
      const found = existingForItem(item, existing);
      const candidateId = found?.id ?? item.id;
      const storedItem = candidateId === item.id ? item : { ...item, id: candidateId };
      const fingerprint = await candidateFingerprint(storedItem);
      const enrichment = enrichmentById.get(item.id) ?? enrichmentByIdentity.get(identity) ?? null;
      candidateRows.push({
        candidateId,
        sourceIdentity: identity,
        content: storedItem,
        statement: db.prepare(`
          INSERT INTO content_candidates (
            id, fingerprint, kind, title, source_origin, source_external_id, source_url,
            item_status, queue_status, content_json, enrichment_json, relevance_score,
            first_seen_at, last_seen_at, last_run_id, source_identity,
            content_changed_at, claim_ledger_json, verification_json, verification_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'review', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
          ON CONFLICT(id) DO UPDATE SET
            fingerprint = CASE
              WHEN content_candidates.queue_status = 'approved'
                OR (content_candidates.queue_status = 'rejected'
                  AND content_candidates.fingerprint = excluded.fingerprint)
                OR excluded.last_seen_at < content_candidates.last_seen_at
                THEN content_candidates.fingerprint
              ELSE excluded.fingerprint
            END,
            kind = CASE WHEN excluded.last_seen_at >= content_candidates.last_seen_at THEN excluded.kind ELSE content_candidates.kind END,
            title = CASE
              WHEN content_candidates.queue_status = 'approved' THEN content_candidates.title
              WHEN excluded.last_seen_at < content_candidates.last_seen_at THEN content_candidates.title
              ELSE excluded.title
            END,
            source_origin = CASE WHEN excluded.last_seen_at >= content_candidates.last_seen_at THEN excluded.source_origin ELSE content_candidates.source_origin END,
            source_external_id = CASE WHEN excluded.last_seen_at >= content_candidates.last_seen_at THEN excluded.source_external_id ELSE content_candidates.source_external_id END,
            source_url = CASE WHEN excluded.last_seen_at >= content_candidates.last_seen_at THEN excluded.source_url ELSE content_candidates.source_url END,
            source_identity = COALESCE(content_candidates.source_identity, excluded.source_identity),
            item_status = CASE
              WHEN content_candidates.queue_status = 'approved' THEN content_candidates.item_status
              WHEN excluded.last_seen_at < content_candidates.last_seen_at THEN content_candidates.item_status
              WHEN content_candidates.queue_status = 'rejected'
                AND content_candidates.fingerprint = excluded.fingerprint THEN content_candidates.item_status
              ELSE excluded.item_status
            END,
            queue_status = CASE
              WHEN content_candidates.queue_status = 'approved' THEN content_candidates.queue_status
              WHEN content_candidates.queue_status = 'rejected'
                AND content_candidates.fingerprint != excluded.fingerprint
                AND excluded.last_seen_at >= content_candidates.last_seen_at THEN 'review'
              ELSE content_candidates.queue_status
            END,
            content_json = CASE
              WHEN content_candidates.queue_status = 'approved' THEN content_candidates.content_json
              WHEN content_candidates.queue_status = 'rejected'
                AND content_candidates.fingerprint = excluded.fingerprint THEN content_candidates.content_json
              WHEN excluded.last_seen_at < content_candidates.last_seen_at THEN content_candidates.content_json
              ELSE excluded.content_json
            END,
            enrichment_json = CASE
              WHEN content_candidates.queue_status = 'approved' THEN content_candidates.enrichment_json
              WHEN content_candidates.fingerprint != excluded.fingerprint
                AND excluded.last_seen_at >= content_candidates.last_seen_at THEN excluded.enrichment_json
              ELSE content_candidates.enrichment_json
            END,
            relevance_score = CASE
              WHEN content_candidates.queue_status = 'approved' THEN content_candidates.relevance_score
              WHEN content_candidates.fingerprint != excluded.fingerprint
                AND excluded.last_seen_at >= content_candidates.last_seen_at THEN excluded.relevance_score
              ELSE content_candidates.relevance_score
            END,
            enrichment_fingerprint = CASE
              WHEN content_candidates.queue_status != 'approved'
                AND content_candidates.fingerprint != excluded.fingerprint
                AND excluded.last_seen_at >= content_candidates.last_seen_at THEN NULL
              ELSE content_candidates.enrichment_fingerprint
            END,
            enrichment_attempted_at = CASE
              WHEN content_candidates.queue_status != 'approved'
                AND content_candidates.fingerprint != excluded.fingerprint
                AND excluded.last_seen_at >= content_candidates.last_seen_at THEN NULL
              ELSE content_candidates.enrichment_attempted_at
            END,
            enrichment_outcome = CASE
              WHEN content_candidates.queue_status != 'approved'
                AND content_candidates.fingerprint != excluded.fingerprint
                AND excluded.last_seen_at >= content_candidates.last_seen_at THEN NULL
              ELSE content_candidates.enrichment_outcome
            END,
            enrichment_error = CASE
              WHEN content_candidates.queue_status != 'approved'
                AND content_candidates.fingerprint != excluded.fingerprint
                AND excluded.last_seen_at >= content_candidates.last_seen_at THEN NULL
              ELSE content_candidates.enrichment_error
            END,
            enrichment_attempt_count = CASE
              WHEN content_candidates.queue_status != 'approved'
                AND content_candidates.fingerprint != excluded.fingerprint
                AND excluded.last_seen_at >= content_candidates.last_seen_at THEN 0
              ELSE content_candidates.enrichment_attempt_count
            END,
            claim_ledger_json = CASE
              WHEN content_candidates.queue_status != 'approved'
                AND content_candidates.fingerprint != excluded.fingerprint
                AND excluded.last_seen_at >= content_candidates.last_seen_at THEN NULL
              ELSE content_candidates.claim_ledger_json
            END,
            verification_json = CASE
              WHEN content_candidates.queue_status != 'approved'
                AND content_candidates.fingerprint != excluded.fingerprint
                AND excluded.last_seen_at >= content_candidates.last_seen_at THEN NULL
              ELSE content_candidates.verification_json
            END,
            verification_at = CASE
              WHEN content_candidates.queue_status != 'approved'
                AND content_candidates.fingerprint != excluded.fingerprint
                AND excluded.last_seen_at >= content_candidates.last_seen_at THEN NULL
              ELSE content_candidates.verification_at
            END,
            content_changed_at = CASE
              WHEN content_candidates.queue_status != 'approved'
                AND content_candidates.fingerprint != excluded.fingerprint
                AND excluded.last_seen_at >= content_candidates.last_seen_at THEN excluded.last_seen_at
              ELSE content_candidates.content_changed_at
            END,
            last_seen_at = CASE WHEN excluded.last_seen_at > content_candidates.last_seen_at THEN excluded.last_seen_at ELSE content_candidates.last_seen_at END,
            last_run_id = CASE WHEN excluded.last_seen_at >= content_candidates.last_seen_at THEN excluded.last_run_id ELSE content_candidates.last_run_id END,
            missing_count = 0,
            last_missing_at = NULL
        `).bind(
          candidateId,
          fingerprint,
          storedItem.kind,
          storedItem.title,
          storedItem.source.origin,
          storedItem.source.externalId ?? null,
          storedItem.source.url ?? null,
          storedItem.status,
          JSON.stringify(storedItem),
          enrichment ? JSON.stringify(enrichment) : null,
          enrichment?.relevanceScore ?? null,
          run.fetchedAt,
          run.fetchedAt,
          runId,
          identity,
        ),
      });
      for (const discovery of group.discoveries) {
        discoveryRows.push({
          candidateId,
          sourceIdentity: identity,
          content: discovery,
          statement: db.prepare(`
            INSERT INTO candidate_discoveries (
              candidate_id, origin, source_url, first_seen_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(candidate_id, origin) DO UPDATE SET
              source_url = COALESCE(excluded.source_url, candidate_discoveries.source_url),
              last_seen_at = CASE WHEN excluded.last_seen_at > candidate_discoveries.last_seen_at
                THEN excluded.last_seen_at ELSE candidate_discoveries.last_seen_at END
          `).bind(
            candidateId,
            discovery.origin,
            discovery.url ?? storedItem.source.url ?? null,
            run.fetchedAt,
            run.fetchedAt,
          ),
        });
      }
    }

    const quarantined = await runStatementsOrQuarantine(db, candidateRows, runId)
      + await runStatementsOrQuarantine(db, discoveryRows, runId);
    return { runId, itemCount: groups.length, quarantinedCount: quarantined };
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
  const previous = await readSourceHealth(db);
  const statements = sources.map((source) => db.prepare(`
    INSERT INTO source_health (
      source_id, origin, source_type, source_url, state, complete, completeness, item_count,
      consecutive_failures, last_checked_at, last_success_at, last_error, last_run_id,
      next_attempt_at, last_http_status, requires_auth, last_fallback_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      origin = excluded.origin,
      source_type = excluded.source_type,
      source_url = excluded.source_url,
      state = excluded.state,
      complete = excluded.complete,
      completeness = excluded.completeness,
      item_count = excluded.item_count,
      consecutive_failures = excluded.consecutive_failures,
      last_checked_at = excluded.last_checked_at,
      last_success_at = CASE
        WHEN excluded.state IN ('healthy', 'healthy-empty') THEN excluded.last_checked_at
        ELSE source_health.last_success_at
      END,
      last_error = CASE
        WHEN excluded.state IN ('healthy', 'healthy-empty') THEN NULL
        ELSE excluded.last_error
      END,
      last_run_id = excluded.last_run_id,
      next_attempt_at = excluded.next_attempt_at,
      last_http_status = excluded.last_http_status,
      requires_auth = excluded.requires_auth,
      last_fallback_url = CASE
        WHEN excluded.state IN ('healthy', 'healthy-empty') THEN excluded.last_fallback_url
        ELSE source_health.last_fallback_url
      END
  `).bind(
    ...(() => {
      const prior = previous.get(source.id);
      const deliberateBackoff = source.state === "backoff";
      const consecutiveFailures = isSuccessfulSourceState(source.state)
        ? 0
        : isFailureSourceState(source.state)
          ? (prior?.consecutiveFailures ?? 0) + 1
          : prior?.consecutiveFailures ?? 0;
      const nextAttemptAt = source.nextAttemptAt
        ?? (source.state === "disabled" || source.state === "misconfigured"
          ? source.checkedAt
          : sourceNextAttemptAt(source.state, source.checkedAt, consecutiveFailures, prior?.nextAttemptAt && deliberateBackoff ? prior.nextAttemptAt : undefined));
      return [
        source.id,
        source.origin,
        source.type,
        source.url ?? null,
        source.state,
        snapshotCompleteness(source) === "complete" ? 1 : 0,
        snapshotCompleteness(source),
        source.itemCount,
        consecutiveFailures,
        source.checkedAt,
        isSuccessfulSourceState(source.state) ? source.checkedAt : null,
        source.error ?? (deliberateBackoff ? prior?.lastError ?? "Source is in retry backoff" : null),
        runId,
        nextAttemptAt,
        source.httpStatus ?? (deliberateBackoff ? prior?.lastHttpStatus ?? null : null),
        source.requiresAuth ? 1 : (deliberateBackoff && prior?.requiresAuth ? 1 : 0),
        source.fallbackUrl ?? (deliberateBackoff ? prior?.lastFallbackUrl ?? null : null),
      ];
    })(),
  ));
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
  return statements.length;
}

type SourceHealthRow = {
  source_id: string;
  state: string;
  item_count: number;
  complete: number;
  completeness: string | null;
  consecutive_failures: number;
  last_checked_at: string;
  last_success_at: string | null;
  last_error: string | null;
  next_attempt_at: string;
  last_http_status: number | null;
  requires_auth: number;
  last_fallback_url: string | null;
};

export async function readSourceHealth(db: D1DatabaseLike): Promise<Map<string, PersistedSourceHealth>> {
  try {
    const result = await db.prepare(`SELECT source_id, state, item_count, complete, completeness,
        consecutive_failures, last_checked_at, last_success_at, last_error, next_attempt_at,
        last_http_status, requires_auth, last_fallback_url
      FROM source_health`).all<SourceHealthRow>();
    return new Map((result.results ?? []).flatMap((row) => {
      if (!(SOURCE_RUN_STATES as readonly string[]).includes(row.state)) return [];
      const completeness = row.completeness === "complete" || row.completeness === "partial" || row.completeness === "empty-unverified"
        ? row.completeness
        : undefined;
      return [[row.source_id, {
        sourceId: row.source_id,
        state: row.state as PersistedSourceHealth["state"],
        itemCount: Number(row.item_count) || 0,
        complete: Boolean(row.complete),
        ...(completeness ? { completeness } : {}),
        consecutiveFailures: Number(row.consecutive_failures) || 0,
        lastCheckedAt: row.last_checked_at,
        lastSuccessAt: row.last_success_at,
        lastError: row.last_error,
        nextAttemptAt: row.next_attempt_at,
        lastHttpStatus: row.last_http_status == null ? null : Number(row.last_http_status),
        requiresAuth: Boolean(row.requires_auth),
        lastFallbackUrl: row.last_fallback_url,
      } satisfies PersistedSourceHealth]] as const;
    }));
  } catch {
    return new Map();
  }
}

type NewsExtractionRow = {
  url: string;
  state: string;
  cached_text: string | null;
  method: string | null;
  attempt_count: number | null;
  last_attempted_at: string;
  last_success_at: string | null;
  next_attempt_at: string;
  error: string | null;
};

function parseNewsExtractionRow(row: NewsExtractionRow): NewsArticleExtractionState | undefined {
  if (row.state !== "success" && row.state !== "failed" && row.state !== "no-content") return undefined;
  const method = row.method === "json-ld" || row.method === "article" || row.method === "main"
    ? row.method
    : null;
  return {
    url: row.url,
    state: row.state,
    cachedText: row.cached_text,
    method,
    attemptCount: Number(row.attempt_count ?? 0),
    lastAttemptedAt: row.last_attempted_at,
    lastSuccessAt: row.last_success_at,
    nextAttemptAt: row.next_attempt_at,
    error: row.error,
  };
}

const NEWS_EXTRACTION_SELECT = `
  SELECT url, state, cached_text, method, attempt_count,
         last_attempted_at, last_success_at, next_attempt_at, error
  FROM news_article_extractions
`;

export async function readNewsArticleExtractions(
  db: D1DatabaseLike,
  urls?: readonly string[],
): Promise<Map<string, NewsArticleExtractionState>> {
  const out = new Map<string, NewsArticleExtractionState>();
  const remember = (row: NewsExtractionRow) => {
    const parsed = parseNewsExtractionRow(row);
    if (parsed) out.set(parsed.url, parsed);
  };
  if (urls?.length) {
    for (const row of await loadRowsByValues<NewsExtractionRow>(
      db,
      `${NEWS_EXTRACTION_SELECT} WHERE url IN (?)`,
      [...new Set(urls)],
    )) remember(row);
    return out;
  }
  const pageSize = 200;
  let offset = 0;
  while (true) {
    const rows = await db.prepare(`${NEWS_EXTRACTION_SELECT} ORDER BY url LIMIT ? OFFSET ?`)
      .bind(pageSize, offset)
      .all<NewsExtractionRow>();
    const results = rows.results ?? [];
    for (const row of results) remember(row);
    if (results.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

export async function persistNewsArticleExtractions(
  db: D1DatabaseLike,
  attempts: readonly NewsArticleExtractionAttempt[],
) {
  if (attempts.length === 0) return 0;
  const statements = attempts.map((attempt) => db.prepare(`
    INSERT INTO news_article_extractions (
      url, state, cached_text, method, attempt_count,
      last_attempted_at, last_success_at, next_attempt_at, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      state = excluded.state,
      cached_text = CASE
        WHEN excluded.cached_text IS NOT NULL AND length(excluded.cached_text) > 0 THEN excluded.cached_text
        ELSE news_article_extractions.cached_text
      END,
      method = CASE
        WHEN excluded.method IS NOT NULL THEN excluded.method
        ELSE news_article_extractions.method
      END,
      attempt_count = excluded.attempt_count,
      last_attempted_at = excluded.last_attempted_at,
      last_success_at = COALESCE(excluded.last_success_at, news_article_extractions.last_success_at),
      next_attempt_at = excluded.next_attempt_at,
      error = excluded.error
  `).bind(
    attempt.url,
    attempt.state,
    attempt.cachedText || null,
    attempt.method ?? null,
    attempt.attemptCount,
    attempt.lastAttemptedAt,
    attempt.lastSuccessAt ?? null,
    attempt.nextAttemptAt,
    attempt.error ?? null,
  ));
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
  return statements.length;
}

export async function cleanupNewsArticleExtractions(db: D1DatabaseLike, now = new Date()) {
  const nowIso = now.toISOString();
  const retentionCutoff = new Date(now.getTime() - NEWS_ARTICLE_RETENTION_DAYS * 86_400_000).toISOString();
  await db.prepare(`
    DELETE FROM news_article_extractions
    WHERE url IN (
      SELECT url FROM news_article_extractions
      WHERE last_attempted_at < ?
        AND next_attempt_at < ?
        AND (last_success_at IS NULL OR last_success_at < ?)
      ORDER BY COALESCE(last_success_at, last_attempted_at) ASC, url ASC
      LIMIT ?
    )
  `).bind(retentionCutoff, nowIso, retentionCutoff, NEWS_ARTICLE_CLEANUP_BATCH).run();

  const counted = await db.prepare("SELECT COUNT(*) AS count FROM news_article_extractions").first<{ count: number }>();
  const count = Number(counted?.count ?? 0);
  if (!Number.isFinite(count) || count <= NEWS_ARTICLE_MAX_ROWS) return;
  const excess = Math.min(NEWS_ARTICLE_CLEANUP_BATCH, count - NEWS_ARTICLE_MAX_ROWS);
  if (excess <= 0) return;
  await db.prepare(`
    DELETE FROM news_article_extractions
    WHERE url IN (
      SELECT url FROM news_article_extractions
      ORDER BY
        CASE WHEN next_attempt_at >= ? THEN 1 ELSE 0 END ASC,
        CASE WHEN last_success_at IS NOT NULL AND last_success_at >= ? THEN 1 ELSE 0 END ASC,
        COALESCE(last_success_at, last_attempted_at) ASC,
        url ASC
      LIMIT ?
    )
  `).bind(nowIso, retentionCutoff, excess).run();
}

export const EVENT_CATASTROPHIC_DROP_RATIO = 0.5;
export const EVENT_CATASTROPHIC_DROP_MIN_BASELINE = 4;

export type KnownIngestEvent = {
  id: string;
  origin: string;
  title?: string;
  content?: ContentItem;
};

async function markEventsMissing(
  db: D1DatabaseLike,
  source: SourceRunNote,
  runId: string,
  fetchedAt: string,
  ids: string[],
) {
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
}

async function withdrawMissingEvent(
  db: D1DatabaseLike,
  source: SourceRunNote,
  runId: string,
  fetchedAt: string,
  id: string,
  missingCount: number,
) {
  await db.batch([
    db.prepare(`
      UPDATE content_candidates
      SET queue_status = 'review', item_status = 'unpublished', reviewed_at = ?
      WHERE id = ?
    `).bind(fetchedAt, id),
    db.prepare("DELETE FROM published_content WHERE candidate_id = ?").bind(id),
    db.prepare(`
      INSERT INTO publication_reconciliations (
        candidate_id, source_id, action, missing_count, reason, run_id, reconciled_at
      ) VALUES (?, ?, 'withdrawn', ?, 'Absent from two successful complete source checks', ?, ?)
    `).bind(id, source.id, missingCount, runId, fetchedAt),
  ]);
}

async function ensureBundledCandidate(
  db: D1DatabaseLike,
  runId: string,
  fetchedAt: string,
  event: KnownIngestEvent,
) {
  const existing = await db.prepare(
    "SELECT id, last_seen_at FROM content_candidates WHERE id = ?",
  ).bind(event.id).first<{ id: string; last_seen_at: string }>();
  if (existing) return existing;
  const content = event.content ?? {
    id: event.id,
    kind: "event",
    title: event.title ?? event.id,
    source: { kind: "ingest", origin: event.origin },
  };
  await db.prepare(`
    INSERT INTO content_candidates (
      id, fingerprint, kind, title, source_origin, source_url, item_status, queue_status,
      content_json, first_seen_at, last_seen_at, last_run_id, missing_count
    ) VALUES (?, ?, 'event', ?, ?, ?, 'unpublished', 'review', ?, ?, ?, ?, 0)
  `).bind(
    event.id,
    `bundled:${event.id}`,
    event.title ?? event.id,
    event.origin,
    event.content && "source" in event.content ? event.content.source.url ?? null : null,
    JSON.stringify(content),
    fetchedAt,
    "1970-01-01T00:00:00.000Z",
    runId,
  ).run();
  return { id: event.id, last_seen_at: "1970-01-01T00:00:00.000Z" };
}

export async function reconcileMissingPublishedEvents(
  db: D1DatabaseLike,
  runId: string,
  fetchedAt: string,
  sources: SourceRunNote[],
  missingThreshold = 2,
  knownEvents: readonly KnownIngestEvent[] = [],
) {
  const threshold = Math.max(2, Math.trunc(missingThreshold));
  let missing = 0;
  let withdrawn = 0;
  for (const source of sources) {
    if (!sourceAuthorizesDisappearance(source)) continue;
    const live = await db.prepare(`
      SELECT COUNT(*) AS count
      FROM content_candidates c
      JOIN published_content p ON p.candidate_id = c.id
      WHERE c.kind = 'event' AND c.source_origin = ? AND c.queue_status = 'approved'
    `).bind(source.origin).first<{ count: number }>();
    const liveCount = Number(live?.count ?? 0);
    if (
      liveCount >= EVENT_CATASTROPHIC_DROP_MIN_BASELINE
      && source.itemCount < liveCount * EVENT_CATASTROPHIC_DROP_RATIO
    ) {
      continue;
    }
    const absent = await db.prepare(`
      SELECT c.id
      FROM content_candidates c
      JOIN published_content p ON p.candidate_id = c.id
      WHERE c.kind = 'event' AND c.source_origin = ? AND c.last_seen_at < ?
        AND c.queue_status = 'approved'
    `).bind(source.origin, fetchedAt).all<{ id: string }>();
    const ids = (absent.results ?? []).map((row) => row.id);
    const handled = new Set(ids);
    missing += ids.length;
    await markEventsMissing(db, source, runId, fetchedAt, ids);
    const expired = await db.prepare(`
      SELECT c.id, c.missing_count
      FROM content_candidates c
      JOIN published_content p ON p.candidate_id = c.id
      WHERE c.kind = 'event' AND c.source_origin = ? AND c.last_seen_at < ?
        AND c.queue_status = 'approved' AND c.missing_count >= ?
    `).bind(source.origin, fetchedAt, threshold).all<{ id: string; missing_count: number }>();
    for (const row of expired.results ?? []) {
      await withdrawMissingEvent(db, source, runId, fetchedAt, row.id, row.missing_count);
      withdrawn += 1;
    }
    for (const known of knownEvents) {
      if (known.origin !== source.origin || handled.has(known.id)) continue;
      const row = await ensureBundledCandidate(db, runId, fetchedAt, known);
      if (row.last_seen_at >= fetchedAt) continue;
      await markEventsMissing(db, source, runId, fetchedAt, [known.id]);
      missing += 1;
      const counted = await db.prepare(
        "SELECT missing_count FROM content_candidates WHERE id = ?",
      ).bind(known.id).first<{ missing_count: number }>();
      if (Number(counted?.missing_count ?? 0) >= threshold) {
        await withdrawMissingEvent(db, source, runId, fetchedAt, known.id, Number(counted?.missing_count ?? 0));
        withdrawn += 1;
      }
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

export async function failStrandedIngestRuns(
  db: D1DatabaseLike,
  now = new Date(),
  error = "Stranded running ingest after lock expiry",
) {
  await db.prepare(
    "UPDATE ingest_runs SET state = 'failed', finished_at = ?, error = ? WHERE state = 'running'",
  ).bind(now.toISOString(), error.slice(0, 1000)).run();
}

export async function acquireAutomationLock(
  db: D1DatabaseLike,
  owner: string,
  now = new Date(),
  leaseMinutes = DEFAULT_AUTOMATION_LEASE_MINUTES,
) {
  const expiresAt = new Date(now.getTime() + leaseMinutes * 60_000).toISOString();
  await db.prepare(`
    INSERT INTO automation_locks (name, owner_run_id, expires_at)
    VALUES ('hourly-ingest', ?, ?)
    ON CONFLICT(name) DO UPDATE SET owner_run_id = excluded.owner_run_id, expires_at = excluded.expires_at
    WHERE automation_locks.expires_at <= ?
  `).bind(owner, expiresAt, now.toISOString()).run();
  const row = await db.prepare(
    "SELECT owner_run_id, expires_at FROM automation_locks WHERE name = 'hourly-ingest'",
  ).first<{ owner_run_id: string; expires_at: string }>();
  const owned = row?.owner_run_id === owner;
  if (owned) await failStrandedIngestRuns(db, now);
  return owned;
}

export async function renewAutomationLock(
  db: D1DatabaseLike,
  owner: string,
  now = new Date(),
  leaseMinutes = DEFAULT_AUTOMATION_LEASE_MINUTES,
) {
  const expiresAt = new Date(now.getTime() + leaseMinutes * 60_000).toISOString();
  await db.prepare(`
    UPDATE automation_locks
    SET expires_at = ?
    WHERE name = 'hourly-ingest' AND owner_run_id = ?
  `).bind(expiresAt, owner).run();
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

function slugAliasStatements(
  db: D1DatabaseLike,
  candidateId: string,
  publication: ContentItem,
  incomingSlug: string | undefined,
  decidedAt: string,
) {
  return uniqueAliasSlugs(publication, incomingSlug).map((alias) => db.prepare(`
    INSERT INTO content_slug_aliases (alias_slug, kind, content_id, candidate_id, created_at)
    SELECT ?, p.kind, p.id, p.candidate_id, ?
    FROM published_content p
    WHERE p.candidate_id = ?
      AND p.slug != ?
      AND NOT EXISTS (
        SELECT 1 FROM published_content other
        WHERE other.kind = p.kind AND other.slug = ?
      )
    ON CONFLICT(kind, alias_slug) DO UPDATE SET
      content_id = excluded.content_id,
      candidate_id = excluded.candidate_id
    WHERE content_slug_aliases.content_id = excluded.content_id
  `).bind(alias, decidedAt, candidateId, alias, alias));
}

export async function persistEditorialDecisions(
  db: D1DatabaseLike,
  candidates: CandidateEditorialDecision[],
  model: string,
  provider: string,
  now = new Date(),
  persistedCandidateIds?: Set<string>,
) {
  const counts: EditorialCounts = { published: 0, review: 0, rejected: 0, quarantined: 0 };
  const existingCandidates = await loadExistingCandidates(db, candidates.map((row) => row.item));
  for (const { item, enrichment, decision } of candidates) {
    const decidedAt = now.toISOString();
    const existingRow = existingForItem(item, existingCandidates);
    const candidateId = existingRow?.id ?? item.id;
    if (existingRow?.queue_status === "rejected") {
      const fingerprint = await candidateFingerprint(withCanonicalSource({ ...item, id: candidateId }));
      if (fingerprint === existingRow.fingerprint) {
        counts.rejected += 1;
        persistedCandidateIds?.add(candidateId);
        continue;
      }
    }
    try {
      if (decision.rule === "event-cancelled") {
        const existing = await db.prepare(
          "SELECT content_json FROM published_content WHERE candidate_id = ? LIMIT 1",
        ).bind(candidateId).first<{ content_json: string }>();
        if (!existing) {
          counts.review += 1;
          persistedCandidateIds?.add(candidateId);
          continue;
        }
        let publication = decision.content;
        try {
          const parsed = ContentItemSchema.safeParse(JSON.parse(existing.content_json));
          if (parsed.success) {
            publication = ContentItemSchema.parse(retainPublishedIdentity(parsed.data, {
              ...parsed.data,
              title: item.title,
              dek: item.dek,
              body: item.body,
              updatedAt: item.updatedAt,
              status: "published",
              featured: false,
              ...(parsed.data.kind === "event" ? { cancelled: true } : {}),
            }));
          }
        } catch {
          // Keep the live row; mark cancelled on a parsed event when possible.
        }
        if (publication.kind === "event") {
          publication = ContentItemSchema.parse({
            ...publication,
            status: "published",
            cancelled: true,
            featured: false,
          });
        }
        await db.batch([
          db.prepare(`
            UPDATE content_candidates
            SET item_status = 'published', queue_status = 'approved', content_json = ?, reviewed_at = ?
            WHERE id = ?
          `).bind(JSON.stringify(publication), decidedAt, candidateId),
          db.prepare(`
            UPDATE published_content
            SET content_json = ?, updated_at = ?
            WHERE candidate_id = ?
          `).bind(JSON.stringify(publication), decidedAt, candidateId),
        ]);
        counts.published += 1;
        persistedCandidateIds?.add(candidateId);
        continue;
      }
      if (decision.action === "publish") {
        let publication = withCanonicalSource(decision.content);
        if (publication.id !== candidateId) publication = { ...publication, id: candidateId };
        const incomingSlug = publication.slug;
        const existing = await db.prepare(
          "SELECT content_json, id, first_published_at FROM published_content WHERE candidate_id = ? LIMIT 1",
        ).bind(candidateId).first<{ content_json: string; id: string; first_published_at: string }>();
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
        const fingerprint = await candidateFingerprint(publication);
        const metadata = JSON.stringify({ action: decision.action, rule: decision.rule, fingerprint });
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
            candidateId,
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
            existing?.first_published_at ?? publication.publishedAt ?? decidedAt,
            decidedAt,
            candidateId,
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
            candidateId,
            `${decision.rule}: ${decision.reasons.join("; ")}`.slice(0, 1000),
            decidedAt,
            provider,
            model,
            EDITOR_POLICY_VERSION,
            decision.confidence,
            JSON.stringify(enrichment?.evidenceSpans ?? []),
            metadata,
            candidateId,
            EDITOR_POLICY_VERSION,
            metadata,
          ),
          ...slugAliasStatements(db, candidateId, publication, incomingSlug, decidedAt),
        ]);
        counts.published += 1;
        persistedCandidateIds?.add(candidateId);
        continue;
      }
      if (decision.action === "reject") {
        const fingerprint = await candidateFingerprint(item);
        const metadata = JSON.stringify({ action: decision.action, rule: decision.rule, fingerprint });
        await db.batch([
          db.prepare(`
            UPDATE content_candidates SET queue_status = 'rejected', reviewed_at = ?, item_status = 'unpublished'
            WHERE id = ? AND queue_status != 'rejected'
          `).bind(decidedAt, candidateId),
          db.prepare("DELETE FROM published_content WHERE candidate_id = ?").bind(candidateId),
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
            candidateId,
            `${decision.rule}: ${decision.reasons.join("; ")}`.slice(0, 1000),
            decidedAt,
            provider,
            model,
            EDITOR_POLICY_VERSION,
            decision.confidence,
            JSON.stringify(enrichment?.evidenceSpans ?? []),
            metadata,
            candidateId,
            EDITOR_POLICY_VERSION,
            metadata,
          ),
        ]);
        counts.rejected += 1;
        persistedCandidateIds?.add(candidateId);
        continue;
      }
      counts.review += 1;
      persistedCandidateIds?.add(candidateId);
    } catch (error) {
      counts.quarantined += 1;
      await quarantineIdentity(db, {
        candidateId,
        sourceIdentity: sourceIdentityKey(item),
        reason: `editorial ${decision.action}/${decision.rule}: ${error instanceof Error ? error.message : "Unknown D1 error"}`,
        content: decision.content,
      });
    }
  }
  return counts;
}

async function readPagedRows<T>(
  db: D1DatabaseLike,
  sql: string,
  pageSize = PUBLIC_READ_PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < PUBLIC_READ_MAX_PAGES; page += 1) {
    const rows = await db.prepare(sql).bind(pageSize, page * pageSize).all<T>();
    const batch = rows.results ?? [];
    if (!batch.length) break;
    out.push(...batch);
    if (batch.length < pageSize) break;
  }
  if (out.length === PUBLIC_READ_PAGE_SIZE * PUBLIC_READ_MAX_PAGES) {
    console.error("published-content-page-cap-reached", JSON.stringify({ pages: PUBLIC_READ_MAX_PAGES }));
  }
  return out;
}

/** Complete published overlay. Pages the updated_at index instead of silently truncating at 100/200. */
export async function readPublishedContent(db: D1DatabaseLike): Promise<ContentItem[]> {
  const rows = await readPagedRows<{ content_json: string }>(
    db,
    "SELECT content_json FROM published_content ORDER BY updated_at DESC, candidate_id DESC LIMIT ? OFFSET ?",
  );
  const out: ContentItem[] = [];
  for (const row of rows) {
    try {
      const parsed = ContentItemSchema.safeParse(JSON.parse(row.content_json));
      if (parsed.success && parsed.data.status === "published" && parsed.data.source.url && isDeliverySafe(parsed.data)) {
        out.push(parsed.data);
      }
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
export async function readPublicationTombstones(db: D1DatabaseLike): Promise<string[]> {
  const rows = await readPagedRows<{ id: string }>(
    db,
    `SELECT c.id
     FROM content_candidates c
     JOIN publication_reconciliations r ON r.candidate_id = c.id AND r.action = 'withdrawn'
     LEFT JOIN published_content p ON p.candidate_id = c.id
     WHERE c.item_status = 'unpublished' AND p.candidate_id IS NULL
     GROUP BY c.id
     ORDER BY MAX(r.reconciled_at) DESC, c.id DESC
     LIMIT ? OFFSET ?`,
  );
  return rows.map((row) => row.id);
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
    return parsed.success && parsed.data.status === "published" && parsed.data.source.url && isDeliverySafe(parsed.data)
      ? parsed.data
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Ops hook: D1-only previous slugs 301 here after static publishedSlugRedirects.
 * Apply migration 0007. Do not serve the alias as 200.
 */
export async function findPublishedSlugAlias(
  db: D1DatabaseLike,
  section: string,
  slug: string,
): Promise<{ kind: string; slug: string } | undefined> {
  const row = await db.prepare(`
    SELECT p.kind, p.slug
    FROM content_slug_aliases a
    JOIN published_content p ON p.id = a.content_id
    WHERE a.alias_slug = ?
      AND p.slug != a.alias_slug
      AND (
        (? = 'event' AND p.kind = 'event')
        OR (? = 'voice' AND p.kind = 'voice')
        OR (? = 'news' AND p.kind IN ('news', 'policy', 'ai', 'interview'))
      )
    LIMIT 1
  `).bind(slug, section, section, section).first<{ kind: string; slug: string }>();
  return row?.slug ? row : undefined;
}
