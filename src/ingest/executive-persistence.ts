import {
  coveragePack,
  officialSourceCoverage,
  type CoveragePackDocument,
} from "./coverage-pack";
import {
  applyRoleChange,
  normalizePersonName,
  normalizeTitle,
  type ExecutiveRole,
  type RoleApplyRequest,
  type RoleApplyResult,
} from "./executive-history";
import type { LeadershipObservation, LeadershipSnapshot, ScheduledLeadershipState } from "./leadership-monitor";
import type { D1DatabaseLike } from "./persistence";

function json(value: unknown) {
  return JSON.stringify(value);
}

export async function seedCoveragePack(
  db: D1DatabaseLike,
  pack: CoveragePackDocument = coveragePack,
  now = new Date(),
) {
  const at = now.toISOString();
  const sourceCoverage = new Map(officialSourceCoverage(pack).map((row) => [row.institutionId, row]));
  const institutions = pack.institutions.map((institution) => db.prepare(`
    INSERT INTO covered_institutions (
      id, name, short_name, org_ids_json, regions_json, coverage_tier,
      covered, in_box, edge, aliases_json, website, official_source_status,
      official_source_note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      short_name = excluded.short_name,
      org_ids_json = excluded.org_ids_json,
      regions_json = excluded.regions_json,
      coverage_tier = excluded.coverage_tier,
      covered = excluded.covered,
      in_box = excluded.in_box,
      edge = excluded.edge,
      aliases_json = excluded.aliases_json,
      website = excluded.website,
      official_source_status = excluded.official_source_status,
      official_source_note = excluded.official_source_note,
      updated_at = excluded.updated_at
  `).bind(
    institution.id,
    institution.name,
    institution.shortName,
    json(institution.orgIds),
    json(institution.regions),
    institution.coverageTier,
    institution.covered ? 1 : 0,
    institution.inBox ? 1 : 0,
    institution.edge ? 1 : 0,
    json(institution.aliases),
    institution.website ?? null,
    institution.covered
      ? (sourceCoverage.get(institution.id)?.status ?? "degraded")
      : "inventory-only",
    institution.covered && !sourceCoverage.get(institution.id)?.sourceIds.length
      ? "No verified first-party leadership source is registered; LinkedIn inventory remains non-fetchable."
      : null,
    at,
    at,
  ));
  const sources = pack.sources.map((source) => db.prepare(`
    INSERT INTO coverage_sources (
      id, institution_id, kind, url, host, precedence, monitor, cadence, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      institution_id = excluded.institution_id,
      kind = excluded.kind,
      url = excluded.url,
      host = excluded.host,
      precedence = excluded.precedence,
      monitor = excluded.monitor,
      cadence = excluded.cadence,
      status = excluded.status
  `).bind(
    source.id,
    source.institutionId,
    source.kind,
    source.url,
    source.host,
    source.precedence,
    source.monitor ? 1 : 0,
    source.cadence,
    source.status,
    at,
  ));
  const people = pack.people.map((person) => db.prepare(`
    INSERT INTO covered_people (
      id, display_name, normalized_name, aliases_json, known_title, source_ids_json,
      linkedin_url, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      normalized_name = excluded.normalized_name,
      aliases_json = excluded.aliases_json,
      known_title = excluded.known_title,
      source_ids_json = excluded.source_ids_json,
      linkedin_url = excluded.linkedin_url
  `).bind(
    person.id,
    person.displayName,
    normalizePersonName(person.displayName),
    json(person.aliases),
    person.knownTitle ?? null,
    json(person.sourceIds ?? []),
    person.linkedinUrl ?? null,
    at,
  ));
  const scheduled = pack.sources.filter((source) => (
    source.monitor && source.status === "enabled" && !source.kind.startsWith("linkedin")
  )).map((source) => db.prepare(`
    INSERT INTO scheduled_source_state (
      source_id, state, next_attempt_at, consecutive_failures
    ) VALUES (?, 'pending', ?, 0)
    ON CONFLICT(source_id) DO NOTHING
  `).bind(source.id, at));
  for (const group of [institutions, sources, people, scheduled]) {
    for (let index = 0; index < group.length; index += 40) {
      await db.batch(group.slice(index, index + 40));
    }
  }
}

export async function persistLeadershipSnapshots(
  db: D1DatabaseLike,
  snapshots: readonly LeadershipSnapshot[],
) {
  if (snapshots.length === 0) return 0;
  const statements = snapshots.map((snapshot) => db.prepare(`
    INSERT INTO source_snapshots (
      id, source_id, fetched_at, final_url, content_hash, normalized_text,
      byte_count, extracted_json, state, error, extraction_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    snapshot.id,
    snapshot.sourceId,
    snapshot.fetchedAt,
    snapshot.finalUrl,
    snapshot.contentHash,
    snapshot.normalizedText || null,
    snapshot.byteCount,
    json(snapshot.extracted),
    snapshot.state,
    snapshot.error ?? null,
    snapshot.extractionStatus,
  ));
  for (let index = 0; index < statements.length; index += 40) {
    await db.batch(statements.slice(index, index + 40));
  }
  return statements.length;
}

export async function persistLeadershipObservations(
  db: D1DatabaseLike,
  observations: readonly LeadershipObservation[],
) {
  if (observations.length === 0) return 0;
  const statements = observations.map((observation) => {
    if (observation.status !== "review" && observation.status !== "ignored") {
      throw new Error("executive observations cannot leave review without an explicit ignore");
    }
    return db.prepare(`
      INSERT INTO source_observations (
        id, source_id, snapshot_id, institution_id, person_id, kind, status,
        payload_json, instruction_like, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      observation.id,
      observation.sourceId,
      observation.snapshotId ?? null,
      observation.institutionId,
      observation.personId ?? null,
      observation.kind,
      observation.status,
      json(observation.payload),
      observation.instructionLike ? 1 : 0,
      observation.createdAt,
    );
  });
  for (let index = 0; index < statements.length; index += 40) {
    await db.batch(statements.slice(index, index + 40));
  }
  return statements.length;
}

export async function persistScheduledSourceState(
  db: D1DatabaseLike,
  rows: readonly ScheduledLeadershipState[],
) {
  if (rows.length === 0) return 0;
  const statements = rows.map((row) => db.prepare(`
    INSERT INTO scheduled_source_state (
      source_id, state, last_hash, last_extracted_json, last_attempted_at,
      last_success_at, next_attempt_at, consecutive_failures, last_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      state = excluded.state,
      last_hash = COALESCE(excluded.last_hash, scheduled_source_state.last_hash),
      last_extracted_json = COALESCE(excluded.last_extracted_json, scheduled_source_state.last_extracted_json),
      last_attempted_at = excluded.last_attempted_at,
      last_success_at = COALESCE(excluded.last_success_at, scheduled_source_state.last_success_at),
      next_attempt_at = excluded.next_attempt_at,
      consecutive_failures = excluded.consecutive_failures,
      last_error = excluded.last_error
  `).bind(
    row.sourceId,
    row.state,
    row.lastHash ?? null,
    row.lastExtracted ? json(row.lastExtracted) : null,
    row.lastAttemptedAt ?? null,
    row.lastSuccessAt ?? null,
    row.nextAttemptAt,
    row.consecutiveFailures,
    row.lastError ?? null,
  ));
  for (let index = 0; index < statements.length; index += 40) {
    await db.batch(statements.slice(index, index + 40));
  }
  return statements.length;
}

type ScheduledSourceRow = {
  source_id: string;
  state: ScheduledLeadershipState["state"];
  last_hash: string | null;
  last_extracted_json: string | null;
  last_attempted_at: string | null;
  last_success_at: string | null;
  next_attempt_at: string;
  consecutive_failures: number;
  last_error: string | null;
};

function parseExtracted(raw: string | null) {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value as LeadershipSnapshot["extracted"] : undefined;
  } catch {
    return undefined;
  }
}

export async function readScheduledSourceStates(db: D1DatabaseLike) {
  const rows = await db.prepare(`
    SELECT source_id, state, last_hash, last_extracted_json, last_attempted_at,
           last_success_at, next_attempt_at, consecutive_failures, last_error
    FROM scheduled_source_state
  `).all<ScheduledSourceRow>();
  const states = new Map<string, ScheduledLeadershipState>();
  for (const row of rows.results ?? []) {
    states.set(row.source_id, {
      sourceId: row.source_id,
      state: row.state,
      lastHash: row.last_hash,
      lastExtracted: parseExtracted(row.last_extracted_json),
      lastAttemptedAt: row.last_attempted_at,
      lastSuccessAt: row.last_success_at,
      nextAttemptAt: row.next_attempt_at,
      consecutiveFailures: Number(row.consecutive_failures ?? 0),
      lastError: row.last_error,
    });
  }
  return states;
}

type RoleRow = {
  id: string;
  person_id: string;
  institution_id: string;
  title: string;
  normalized_title: string;
  source_id: string | null;
  evidence_url: string | null;
  effective_from: string;
  effective_to: string | null;
  verification_status: "unverified" | "verified";
  verified_at: string | null;
  verified_by: string | null;
  verification_note: string | null;
  created_at: string;
};

function asRole(row: RoleRow): ExecutiveRole {
  return {
    id: row.id,
    personId: row.person_id,
    institutionId: row.institution_id,
    title: row.title,
    normalizedTitle: row.normalized_title,
    sourceId: row.source_id ?? undefined,
    evidenceUrl: row.evidence_url ?? undefined,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    verificationStatus: row.verification_status,
    verifiedAt: row.verified_at,
    verifiedBy: row.verified_by,
    verificationNote: row.verification_note,
    createdAt: row.created_at,
  };
}

export async function readExecutiveRoles(
  db: D1DatabaseLike,
  personId?: string,
  institutionId?: string,
): Promise<ExecutiveRole[]> {
  const rows = personId && institutionId
    ? await db.prepare(`
        SELECT id, person_id, institution_id, title, normalized_title, source_id,
               evidence_url, effective_from, effective_to, verification_status,
               verified_at, verified_by, verification_note, created_at
        FROM executive_roles
        WHERE person_id = ? AND institution_id = ?
        ORDER BY effective_from ASC, id ASC
      `).bind(personId, institutionId).all<RoleRow>()
    : await db.prepare(`
        SELECT id, person_id, institution_id, title, normalized_title, source_id,
               evidence_url, effective_from, effective_to, verification_status,
               verified_at, verified_by, verification_note, created_at
        FROM executive_roles
        ORDER BY effective_from ASC, id ASC
      `).all<RoleRow>();
  return (rows.results ?? []).map(asRole);
}

/**
 * Insert or supersede a role without mutating the previous title in place.
 */
export async function persistExecutiveRoleChange(
  db: D1DatabaseLike,
  request: RoleApplyRequest,
  now = new Date(),
): Promise<RoleApplyResult> {
  if (request.verificationStatus === "verified") {
    if (!request.sourceId || !request.evidenceUrl || !request.evidenceUrl.startsWith("https://")) {
      throw new Error("Verified executive roles require an HTTPS evidence URL and source");
    }
    if (!Number.isFinite(Date.parse(request.effectiveFrom))) {
      throw new Error("Executive role effectiveFrom must be an ISO date");
    }
    let evidence: URL;
    try {
      evidence = new URL(request.evidenceUrl);
    } catch {
      throw new Error("Verified executive roles require a valid HTTPS evidence URL");
    }
    const source = await db.prepare(
      "SELECT host FROM coverage_sources WHERE id = ?",
    ).bind(request.sourceId).first<{ host: string }>();
    if (!source) throw new Error("Verified executive role source is not registered");
    const sourceHost = source.host.replace(/^www\./, "").replace(/\.$/, "").toLowerCase();
    const evidenceHost = evidence.hostname.replace(/^www\./, "").replace(/\.$/, "").toLowerCase();
    if (evidence.protocol !== "https:" || evidence.username || evidence.password || evidenceHost !== sourceHost) {
      throw new Error("Verified executive evidence must remain on the registered source host");
    }
  }
  const existing = await readExecutiveRoles(db, request.personId, request.institutionId);
  const result = applyRoleChange(existing, request);
  if (result.applied === "unchanged") {
    if (request.verificationStatus === "verified") {
      const normalizedTitle = normalizeTitle(request.title);
      const same = existing.find((role) => (
        role.normalizedTitle === normalizedTitle
        && role.effectiveTo == null
      ));
      if (same && same.verificationStatus !== "verified") {
        const upgrade = await db.prepare(`
          UPDATE executive_roles
          SET verification_status = 'verified', verified_at = ?, verified_by = ?,
              verification_note = ?, source_id = COALESCE(?, source_id),
              evidence_url = COALESCE(?, evidence_url)
          WHERE id = ? AND effective_to IS NULL
        `).bind(
          request.verifiedAt ?? now.toISOString(),
          request.verifiedBy ?? null,
          request.verificationNote ?? null,
          request.sourceId ?? null,
          request.evidenceUrl ?? null,
          same.id,
        ).run();
        if (resultChanges(upgrade) === 0) throw new Error("Executive role verification affected no open role");
        return { ...result, roles: await readExecutiveRoles(db, request.personId, request.institutionId) };
      }
    }
    return result;
  }
  const incoming = result.roles.at(-1);
  if (!incoming) return result;
  const createdAt = now.toISOString();
  if (result.applied === "superseded" && result.closedRoleId) {
    const replacementTitle = normalizeTitle(request.replacesNormalizedTitle ?? "");
    const closedResult = await db.prepare(`
      UPDATE executive_roles
      SET effective_to = ?
      WHERE id = ? AND effective_to IS NULL AND normalized_title = ?
    `).bind(incoming.effectiveFrom, result.closedRoleId, replacementTitle).run();
    const changes = (closedResult as { meta?: { changes?: number }; changes?: number } | null | undefined)?.meta?.changes
      ?? (closedResult as { changes?: number } | null | undefined)?.changes;
    if (changes !== undefined && Number(changes) === 0) {
      throw new Error("Executive role replacement affected no open prior role");
    }
    if (changes === undefined) {
      const closed = await db.prepare(
        "SELECT effective_to FROM executive_roles WHERE id = ?",
      ).bind(result.closedRoleId).first<{ effective_to: string | null }>();
      if (closed?.effective_to !== incoming.effectiveFrom) {
        throw new Error("Executive role replacement could not be verified");
      }
    }
  }
  await db.prepare(`
    INSERT INTO executive_roles (
      id, person_id, institution_id, title, normalized_title, source_id,
      evidence_url, effective_from, effective_to, created_at
      , verification_status, verified_at, verified_by, verification_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
  `).bind(
    incoming.id,
    incoming.personId,
    incoming.institutionId,
    incoming.title,
    incoming.normalizedTitle,
    incoming.sourceId ?? null,
    incoming.evidenceUrl ?? null,
    incoming.effectiveFrom,
    createdAt,
    request.verificationStatus ?? "unverified",
    request.verificationStatus === "verified" ? (request.verifiedAt ?? createdAt) : null,
    request.verificationStatus === "verified" ? (request.verifiedBy ?? null) : null,
    request.verificationStatus === "verified" ? (request.verificationNote ?? null) : null,
  ).run();
  return {
    ...result,
    roles: await readExecutiveRoles(db, request.personId, request.institutionId),
  };
}

type ObservationRow = {
  id: string;
  source_id: string;
  snapshot_id: string | null;
  institution_id: string;
  person_id: string | null;
  kind: LeadershipObservation["kind"];
  status: "review" | "ignored";
  verification_status: "unverified" | "verified" | "ignored";
  payload_json: string;
  instruction_like: number;
  created_at: string;
  snapshot_state: string | null;
  extraction_status: string | null;
  final_url: string | null;
};

function parseLeader(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const normalizedName = normalizePersonName(name);
  const normalizedTitle = normalizeTitle(title);
  if (!name || !title || !normalizedName || !normalizedTitle) return undefined;
  return { name, title, normalizedName, normalizedTitle };
}

function observationPayload(row: ObservationRow) {
  try {
    const value = JSON.parse(row.payload_json) as Record<string, unknown>;
    if (row.kind === "title-changed") {
      const previous = parseLeader(value.previous);
      const next = parseLeader(value.next);
      return previous && next ? { previous, next } : undefined;
    }
    const leader = parseLeader(value.leader);
    return leader ? { leader } : undefined;
  } catch {
    return undefined;
  }
}

function resultChanges(value: unknown) {
  const row = value as { meta?: { changes?: number | bigint }; changes?: number | bigint } | null | undefined;
  const changes = row?.meta?.changes ?? row?.changes;
  return changes === undefined ? undefined : Number(changes);
}

export type LeadershipObservationReviewResult = {
  observationId: string;
  decision: "verified" | "ignored";
  idempotent?: boolean;
  role?: RoleApplyResult;
};

/** Verify one review observation and, only then, mutate role history. */
export async function reviewLeadershipObservation(
  db: D1DatabaseLike,
  observationId: string,
  decision: "verified" | "ignored",
  reviewer: string,
  note?: string,
  now = new Date(),
): Promise<LeadershipObservationReviewResult> {
  const row = await db.prepare(`
    SELECT o.id, o.source_id, o.snapshot_id, o.institution_id, o.person_id, o.kind,
           o.status, o.verification_status, o.payload_json, o.instruction_like, o.created_at,
           s.state AS snapshot_state, s.extraction_status, s.final_url
    FROM source_observations o
    LEFT JOIN source_snapshots s ON s.id = o.snapshot_id
    WHERE o.id = ?
  `).bind(observationId).first<ObservationRow>();
  if (!row) throw new Error("Executive observation was not found");
  if (row.verification_status !== "unverified" || row.status !== "review") {
    return { observationId, decision: row.verification_status === "verified" ? "verified" : "ignored", idempotent: true };
  }
  const reviewedAt = now.toISOString();
  const boundedNote = note?.trim().slice(0, 1_000) || null;
  if (decision === "ignored") {
    const ignored = await db.prepare(`
      UPDATE source_observations
      SET status = 'ignored', verification_status = 'ignored', reviewed_at = ?,
          reviewed_by = ?, review_note = ?
      WHERE id = ? AND status = 'review' AND verification_status = 'unverified'
    `).bind(reviewedAt, reviewer, boundedNote, observationId).run();
    if (resultChanges(ignored) === 0) throw new Error("Executive observation was already reviewed");
    return { observationId, decision };
  }

  if (row.instruction_like || row.snapshot_state !== "success" || row.extraction_status !== "complete") {
    throw new Error("Only complete, non-hostile leadership snapshots can be verified");
  }
  if (!row.final_url?.startsWith("https://")) throw new Error("Verified observation requires HTTPS evidence");
  const payload = observationPayload(row);
  if (!payload) throw new Error("Executive observation payload is invalid");
  let role: RoleApplyResult | undefined;
  if (row.kind === "person-appeared" || row.kind === "title-changed") {
    if (!row.person_id) throw new Error("Executive observation has no uniquely resolved person");
    const leader = row.kind === "title-changed" ? payload.next : payload.leader;
    if (!leader) throw new Error("Executive observation has no valid leader payload");
    const replacesNormalizedTitle = row.kind === "title-changed"
      ? payload.previous?.normalizedTitle
      : undefined;
    if (row.kind === "title-changed" && !replacesNormalizedTitle) {
      throw new Error("Executive title-change observation has no prior title");
    }
    role = await persistExecutiveRoleChange(db, {
      personId: row.person_id,
      institutionId: row.institution_id,
      title: leader.title,
      sourceId: row.source_id,
      evidenceUrl: row.final_url,
      effectiveFrom: row.created_at,
      replacesNormalizedTitle,
      verificationStatus: "verified",
      verifiedAt: reviewedAt,
      verifiedBy: reviewer,
      verificationNote: boundedNote,
    }, now);
    if (row.kind === "title-changed" && role.applied !== "superseded") {
      throw new Error("Executive title-change did not close the normalized prior role");
    }
  } else if (row.kind === "person-departed" && row.person_id) {
    if (!payload.leader) throw new Error("Executive departure observation has no valid leader payload");
    const roles = await readExecutiveRoles(db, row.person_id, row.institution_id);
    const current = roles.find((candidate) => (
      candidate.normalizedTitle === payload.leader.normalizedTitle
      && candidate.effectiveTo == null
      && candidate.effectiveFrom <= row.created_at
    ));
    if (current) {
      const closedResult = await db.prepare(`
        UPDATE executive_roles
        SET effective_to = ?
        WHERE id = ? AND effective_to IS NULL AND normalized_title = ?
      `).bind(row.created_at, current.id, current.normalizedTitle).run();
      const changes = resultChanges(closedResult);
      if (changes === 0) throw new Error("Executive departure affected no open role");
      if (changes === undefined) {
        const closed = await db.prepare(
          "SELECT effective_to FROM executive_roles WHERE id = ?",
        ).bind(current.id).first<{ effective_to: string | null }>();
        if (closed?.effective_to !== row.created_at) throw new Error("Executive departure could not be verified");
      }
    }
  }

  const reviewed = await db.prepare(`
    UPDATE source_observations
    SET verification_status = 'verified', reviewed_at = ?, reviewed_by = ?, review_note = ?
    WHERE id = ? AND status = 'review' AND verification_status = 'unverified'
  `).bind(reviewedAt, reviewer, boundedNote, observationId).run();
  if (resultChanges(reviewed) === 0) throw new Error("Executive observation was already reviewed");
  return { observationId, decision, role };
}
