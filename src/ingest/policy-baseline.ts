import { legacyUtcDatetime, legacyUrl } from "../lib/schema-compat";
import { z } from "zod";
import policyBaselineJson from "../../fixtures/policy-baseline-v1.json";
import type { D1DatabaseLike } from "./persistence";

const HttpsUrl = legacyUrl().refine((value) => value.startsWith("https://"));
const Baseline = z.object({
  schemaVersion: z.literal(1),
  asOf: legacyUtcDatetime(),
  source: z.string().min(1),
  instruments: z.array(z.object({
    id: z.string().min(1), instrumentId: z.string().regex(/^(?:HB|SB) \d+$/),
    versionId: z.string().regex(/^PN \d+$/),
    stage: z.enum(["introduced", "committee", "hearing", "amended", "passed", "enacted"]),
    developmentAt: legacyUtcDatetime(), title: z.string().min(1),
    canonicalUrl: HttpsUrl, textUrl: HttpsUrl, evidenceSpans: z.array(z.string().min(3)).min(1),
  })),
  advocacy: z.array(z.object({
    id: z.string().min(1), instrumentId: z.string().min(1), organization: z.string().min(1),
    position: z.enum(["support", "oppose", "concerns", "neutral"]),
    publishedAt: legacyUtcDatetime(), sourceUrl: HttpsUrl,
    evidenceSpans: z.array(z.string().min(3)).min(1), provenance: z.array(z.string().min(1)).min(1),
  })),
  supportingEvidence: z.array(z.object({
    id: z.string().min(1), title: z.string().min(1), publishedAt: legacyUtcDatetime(),
    sourceUrl: HttpsUrl, artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
    pageEvidence: z.array(z.object({ pageNumber: z.number().int().positive(), evidenceSpans: z.array(z.string().min(3)).min(1) })).min(1),
    provenance: z.array(z.string().min(1)).min(1),
  })),
  benchmarks: z.array(z.object({
    id: z.string().min(1), instrumentId: z.string().regex(/^(?:HB|SB) \d+$/),
    firstPublicAt: legacyUtcDatetime(), correspondenceAt: legacyUtcDatetime(),
    detectedAt: legacyUtcDatetime().nullable(), briefOrBlockerAt: legacyUtcDatetime().nullable(),
    missReason: z.string().min(1).nullable(), sourceUrls: z.array(HttpsUrl).min(1),
  })),
});

export const policyBaseline = Baseline.parse(policyBaselineJson);

export function policyBaselinePlan() {
  const records = [
    ...policyBaseline.instruments.map((row) => ({
      type: "instrument" as const,
      id: row.id,
      effectiveAt: row.developmentAt,
      sourceUrl: row.canonicalUrl,
      textUrl: row.textUrl,
      disposition: "current-legislative-state" as const,
    })),
    ...policyBaseline.advocacy.map((row) => ({
      type: "advocacy" as const,
      id: row.id,
      effectiveAt: row.publishedAt,
      sourceUrl: row.sourceUrl,
      disposition: "background-unless-revised" as const,
    })),
    ...policyBaseline.supportingEvidence.map((row) => ({
      type: "supporting-evidence" as const,
      id: row.id,
      effectiveAt: row.publishedAt,
      sourceUrl: row.sourceUrl,
      artifactSha256: row.artifactSha256,
      disposition: "background" as const,
    })),
    ...policyBaseline.benchmarks.map((row) => ({
      type: "missed-lead-benchmark" as const,
      id: row.id,
      effectiveAt: row.correspondenceAt,
      sourceUrl: row.sourceUrls[0]!,
      disposition: "measurement-only" as const,
    })),
  ];
  const duplicateIds = records
    .map((row) => row.id)
    .filter((id, index, all) => all.indexOf(id) !== index);
  return {
    mode: "dry-run" as const,
    asOf: policyBaseline.asOf,
    counts: {
      instruments: policyBaseline.instruments.length,
      versions: policyBaseline.instruments.length,
      advocacy: policyBaseline.advocacy.length,
      supportingEvidence: policyBaseline.supportingEvidence.length,
      benchmarks: policyBaseline.benchmarks.length,
    },
    ids: [
      ...policyBaseline.instruments.map((row) => row.id),
      ...policyBaseline.advocacy.map((row) => row.id),
      ...policyBaseline.supportingEvidence.map((row) => row.id),
      ...policyBaseline.benchmarks.map((row) => row.id),
    ],
    records,
    duplicates: {
      withinManifest: [...new Set(duplicateIds)],
      production: "not-queried-by-read-only-manifest",
    },
    unresolvedClaims: [
      "The HIMSS/NCSL deck is supporting analysis; official SB 1113 history and text control legislative facts.",
      "No baseline row is represented as a newly published article; a later official action is required for freshness.",
    ],
    productionMutation: false,
  };
}

/** Idempotent D1 application. Callers own operational authorization. */
export async function applyPolicyBaseline(db: D1DatabaseLike, observedAt = policyBaseline.asOf) {
  const statements = [];
  for (const row of policyBaseline.instruments) {
    const versionId = `${row.id}-${row.versionId.toLowerCase().replace(/\s+/g, "-")}-${row.stage}-${row.developmentAt.slice(0, 10)}`;
    statements.push(
      db.prepare(`INSERT INTO policy_instruments (
        id, jurisdiction, session, instrument_id, title, canonical_url, current_version_id,
        current_stage, first_seen_at, last_seen_at
      ) VALUES (?, 'PA', '2025-2026', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(jurisdiction, session, instrument_id) DO UPDATE SET
        title = excluded.title, canonical_url = excluded.canonical_url,
        current_version_id = excluded.current_version_id, current_stage = excluded.current_stage,
        last_seen_at = MAX(policy_instruments.last_seen_at, excluded.last_seen_at)`
      ).bind(row.id, row.instrumentId, row.title, row.canonicalUrl, row.versionId, row.stage, observedAt, observedAt),
      db.prepare(`INSERT INTO policy_versions (
        id, instrument_row_id, version_id, stage, development_at, source_url, text_url,
        evidence_json, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(instrument_row_id, version_id, stage, development_at) DO UPDATE SET
        source_url = excluded.source_url, text_url = excluded.text_url,
        evidence_json = excluded.evidence_json,
        last_seen_at = MAX(policy_versions.last_seen_at, excluded.last_seen_at)`
      ).bind(versionId, row.id, row.versionId, row.stage, row.developmentAt, row.canonicalUrl, row.textUrl, JSON.stringify(row.evidenceSpans), observedAt, observedAt),
    );
  }
  for (const row of policyBaseline.advocacy) {
    statements.push(db.prepare(`INSERT INTO policy_advocacy_records (
      id, instrument_id, organization, position, published_at, source_url,
      evidence_json, provenance_json, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(instrument_id, organization, published_at, source_url) DO UPDATE SET
      evidence_json = excluded.evidence_json, provenance_json = excluded.provenance_json,
      last_seen_at = MAX(policy_advocacy_records.last_seen_at, excluded.last_seen_at)`
    ).bind(row.id, row.instrumentId, row.organization, row.position, row.publishedAt, row.sourceUrl, JSON.stringify(row.evidenceSpans), JSON.stringify(row.provenance), observedAt, observedAt));
  }
  for (const row of policyBaseline.supportingEvidence) {
    statements.push(db.prepare(`INSERT INTO policy_supporting_evidence (
      id, title, published_at, source_url, artifact_sha256, page_evidence_json,
      provenance_json, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_url, published_at, artifact_sha256) DO UPDATE SET
      title = excluded.title, page_evidence_json = excluded.page_evidence_json,
      provenance_json = excluded.provenance_json,
      last_seen_at = MAX(policy_supporting_evidence.last_seen_at, excluded.last_seen_at)`
    ).bind(row.id, row.title, row.publishedAt, row.sourceUrl, row.artifactSha256, JSON.stringify(row.pageEvidence), JSON.stringify(row.provenance), observedAt, observedAt));
  }
  for (const row of policyBaseline.benchmarks) {
    statements.push(db.prepare(`INSERT INTO policy_benchmark_leads (
      id, instrument_id, first_public_at, correspondence_at, detected_at,
      brief_or_blocker_at, miss_reason, source_urls_json, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      detected_at = COALESCE(excluded.detected_at, policy_benchmark_leads.detected_at),
      brief_or_blocker_at = COALESCE(excluded.brief_or_blocker_at, policy_benchmark_leads.brief_or_blocker_at),
      miss_reason = excluded.miss_reason,
      source_urls_json = excluded.source_urls_json,
      last_seen_at = MAX(policy_benchmark_leads.last_seen_at, excluded.last_seen_at)`
    ).bind(
      row.id, row.instrumentId, row.firstPublicAt, row.correspondenceAt,
      row.detectedAt, row.briefOrBlockerAt, row.missReason,
      JSON.stringify(row.sourceUrls), observedAt, observedAt,
    ));
  }
  for (let index = 0; index < statements.length; index += 40) await db.batch(statements.slice(index, index + 40));
  return { ...policyBaselinePlan(), mode: "apply" as const, statementCount: statements.length };
}
