import { z } from "zod";
import linkedinTargets from "../../fixtures/linkedin-notification-targets.json";
import type { ContentItem, NewsItem, VoiceItem } from "../content/schema";
import type { D1DatabaseLike } from "./persistence";
import { looksInstructionLike } from "./untrusted-text";
import { sourceNote, sourceStateForItemCount, type SourceRunNote } from "./source-health";
import { coveredInstitutions, coveragePack } from "./coverage-pack";

export const SOCIAL_EVIDENCE_PATH = "/api/signals/social";
export const SOCIAL_MANIFEST_PATH = `${SOCIAL_EVIDENCE_PATH}/manifest`;
export const SOCIAL_COLLECTOR_RUNS_PATH = `${SOCIAL_EVIDENCE_PATH}/runs`;
export const SOCIAL_EVIDENCE_SCHEMA_VERSION = 1;
export const SOCIAL_EVIDENCE_MAX_BYTES = 96 * 1024;
export const SOCIAL_EVIDENCE_MAX_BATCH = 25;

const HttpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:");
const LinkedSource = z.object({
  url: HttpsUrl,
  title: z.string().max(300).optional(),
  publisher: z.string().max(200).optional(),
  publishedAt: z.string().datetime().optional(),
  exactPassages: z.array(z.string().max(3000)).max(12).default([]),
});
const Packet = z.object({
  schemaVersion: z.literal(SOCIAL_EVIDENCE_SCHEMA_VERSION),
  platform: z.enum(["linkedin", "x"]),
  postUrl: HttpsUrl,
  postId: z.string().max(200).optional(),
  author: z.object({
    name: z.string().min(1).max(200),
    profileUrl: HttpsUrl,
    headline: z.string().max(500).optional(),
    accountType: z.enum(["organization", "person"]).optional(),
  }),
  post: z.object({
    text: z.string().max(20000).default(""),
    headline: z.string().max(500).optional(),
    postedAt: z.string().datetime().optional(),
    observedAt: z.string().datetime(),
    language: z.string().max(20).optional(),
  }),
  attachments: z.array(z.object({
    type: z.enum(["image", "video", "document", "link", "other"]),
    url: HttpsUrl.optional(),
    altText: z.string().max(3000).optional(),
    ocrText: z.string().max(10000).optional(),
    caption: z.string().max(3000).optional(),
  })).max(20).default([]),
  linkedSources: z.array(LinkedSource).max(20).default([]),
  entities: z.object({
    people: z.array(z.string().max(200)).max(50).default([]),
    organizations: z.array(z.string().max(200)).max(50).default([]),
    products: z.array(z.string().max(200)).max(50).default([]),
    places: z.array(z.string().max(200)).max(50).default([]),
  }).default({ people: [], organizations: [], products: [], places: [] }),
  collectorAnalysis: z.object({
    whyRelevant: z.string().max(3000).optional(),
    suggestedTopics: z.array(z.string().max(80)).max(20).default([]),
    possibleClaims: z.array(z.string().max(1000)).max(20).default([]),
  }).default({ suggestedTopics: [], possibleClaims: [] }),
});

export type SocialEvidencePacket = z.infer<typeof Packet>;
const PacketEnvelope = z.union([Packet, z.object({ packets: z.array(Packet).min(1).max(SOCIAL_EVIDENCE_MAX_BATCH) })]);

const CollectorPlatformReport = z.object({
  targetsChecked: z.number().int().min(0).max(10_000).default(0),
  postsSeen: z.number().int().min(0).max(50_000).default(0),
  accepted: z.number().int().min(0).max(50_000).default(0),
  duplicates: z.number().int().min(0).max(50_000).default(0),
  failures: z.number().int().min(0).max(10_000).default(0),
});
const CollectorRun = z.object({
  schemaVersion: z.literal(SOCIAL_EVIDENCE_SCHEMA_VERSION),
  collector: z.literal("vale"),
  runId: z.string().min(1).max(120),
  manifestVersion: z.string().min(1).max(120),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  outcome: z.enum(["success", "partial", "failed"]),
  accountsChecked: z.number().int().min(0).max(10_000).default(0),
  postsSeen: z.number().int().min(0).max(50_000).default(0),
  accepted: z.number().int().min(0).max(50_000).default(0),
  duplicates: z.number().int().min(0).max(50_000).default(0),
  failures: z.number().int().min(0).max(10_000).default(0),
  platforms: z.object({
    linkedin: CollectorPlatformReport.default({}),
    x: CollectorPlatformReport.default({}),
  }).default({ linkedin: {}, x: {} }),
  failureReasons: z.array(z.string().max(500)).max(20).default([]),
});
export type SocialCollectorRun = z.infer<typeof CollectorRun>;

type SocialEvidenceEnv = {
  VALLEY_DESK_DB: D1DatabaseLike;
  SOCIAL_INGEST_TOKEN?: string;
  /** Explicit operator gate: target rows stay inactive until connector access is proven. */
  SOCIAL_LINKEDIN_ACCESS_VERIFIED?: string;
  SOCIAL_X_ACCESS_VERIFIED?: string;
  REVIEW_API_TOKEN?: string;
  OPENROUTER_API_KEY?: string;
  EDITOR_MODEL_API_KEY?: string;
  X_BEARER_TOKEN?: string;
  LINKEDIN_TOKEN?: string;
};

function json(status: number, value: unknown, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

async function digest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function tokenMatches(expected: string | undefined, actual: string | null) {
  const a = await digest(expected?.trim() || `missing:${crypto.randomUUID()}`);
  const b = await digest(actual?.trim() || `missing:${crypto.randomUUID()}`);
  let different = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) different |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return Boolean(expected?.trim()) && different === 0;
}

async function socialAuthorized(request: Request, env: SocialEvidenceEnv) {
  const token = env.SOCIAL_INGEST_TOKEN?.trim();
  if (!token || [
    env.REVIEW_API_TOKEN,
    env.OPENROUTER_API_KEY,
    env.EDITOR_MODEL_API_KEY,
    env.X_BEARER_TOKEN,
    env.LINKEDIN_TOKEN,
  ].some((candidate) => candidate?.trim() === token)) {
    return false;
  }
  return tokenMatches(token, request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null);
}

async function boundedJson(request: Request) {
  const stated = Number(request.headers.get("content-length") || 0);
  if (stated > SOCIAL_EVIDENCE_MAX_BYTES) throw new Error("payload_too_large");
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > SOCIAL_EVIDENCE_MAX_BYTES) {
      await reader.cancel();
      throw new Error("payload_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function canonicalSocialUrl(value: string, platform: "linkedin" | "x", profile = false) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const allowed = platform === "linkedin"
    ? host === "linkedin.com"
    : host === "x.com" || host === "twitter.com";
  if (!allowed) throw new Error("platform_url_mismatch");
  if (platform === "linkedin" && profile && !/^\/(?:in|company|school)\//.test(url.pathname)) throw new Error("author_profile_url_invalid");
  if (platform === "linkedin" && !profile && !/^\/(?:posts|feed\/update|pulse)\//.test(url.pathname)) throw new Error("post_url_invalid");
  if (platform === "x" && !profile && !/\/status\/\d+/.test(url.pathname)) throw new Error("post_url_invalid");
  url.protocol = "https:";
  url.hostname = platform === "x" ? "x.com" : "www.linkedin.com";
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString();
}

function packetText(packet: SocialEvidencePacket) {
  return [
    packet.post.text,
    packet.post.headline,
    ...packet.attachments.flatMap((row) => [row.altText, row.ocrText, row.caption]),
    ...packet.linkedSources.flatMap((row) => [row.title, ...row.exactPassages]),
    packet.collectorAnalysis.whyRelevant,
    ...packet.collectorAnalysis.possibleClaims,
  ].filter((value): value is string => Boolean(value));
}

function validatePacketSemantics(packet: SocialEvidencePacket, now: Date) {
  canonicalSocialUrl(packet.postUrl, packet.platform);
  canonicalSocialUrl(packet.author.profileUrl, packet.platform, true);
  const observed = Date.parse(packet.post.observedAt);
  const posted = packet.post.postedAt ? Date.parse(packet.post.postedAt) : undefined;
  if (!Number.isFinite(observed) || observed > now.getTime() + 10 * 60_000 || observed < now.getTime() - 60 * 24 * 60 * 60_000) {
    throw new Error("observed_at_invalid");
  }
  if (posted !== undefined && (!Number.isFinite(posted) || posted > now.getTime() + 24 * 60 * 60_000)) {
    throw new Error("posted_at_invalid");
  }
}

async function persistPacket(db: D1DatabaseLike, input: SocialEvidencePacket, now: Date) {
  const postUrl = canonicalSocialUrl(input.postUrl, input.platform);
  const profileUrl = canonicalSocialUrl(input.author.profileUrl, input.platform, true);
  const packet = { ...input, postUrl, author: { ...input.author, profileUrl } };
  const evidenceHash = await digest(JSON.stringify(packet));
  const id = `social-${input.platform}-${(await digest(postUrl)).slice(0, 24)}`;
  const receivedAt = now.toISOString();
  const instructionLike = looksInstructionLike(...packetText(packet)) ? 1 : 0;
  await db.prepare(`INSERT INTO social_evidence_packets (
      id, schema_version, platform, post_url, post_id, author_name, author_profile_url,
      author_json, post_json, attachments_json, linked_sources_json, entities_json,
      collector_analysis_json, evidence_hash, status, instruction_like, receive_count,
      posted_at, observed_at, first_seen_at, last_seen_at
    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'review', ?, 1, ?, ?, ?, ?)
    ON CONFLICT(platform, post_url) DO UPDATE SET
      post_id = excluded.post_id, author_name = excluded.author_name,
      author_profile_url = excluded.author_profile_url, author_json = excluded.author_json,
      post_json = excluded.post_json, attachments_json = excluded.attachments_json,
      linked_sources_json = excluded.linked_sources_json, entities_json = excluded.entities_json,
      collector_analysis_json = excluded.collector_analysis_json,
      evidence_hash = excluded.evidence_hash, instruction_like = excluded.instruction_like,
      receive_count = social_evidence_packets.receive_count + 1,
      posted_at = COALESCE(excluded.posted_at, social_evidence_packets.posted_at),
      observed_at = excluded.observed_at, last_seen_at = excluded.last_seen_at`)
    .bind(
      id, packet.platform, postUrl, packet.postId ?? null, packet.author.name, profileUrl,
      JSON.stringify(packet.author), JSON.stringify(packet.post), JSON.stringify(packet.attachments),
      JSON.stringify(packet.linkedSources), JSON.stringify(packet.entities), JSON.stringify(packet.collectorAnalysis),
      evidenceHash, instructionLike, packet.post.postedAt ?? null, packet.post.observedAt, receivedAt, receivedAt,
    ).run();
  return { id, postUrl, instructionLike: Boolean(instructionLike) };
}

export function isSocialEvidencePath(pathname: string) { return pathname === SOCIAL_EVIDENCE_PATH; }
export function isSocialManifestPath(pathname: string) { return pathname === SOCIAL_MANIFEST_PATH; }
export function isSocialCollectorRunsPath(pathname: string) { return pathname === SOCIAL_COLLECTOR_RUNS_PATH; }

export async function handleSocialEvidence(request: Request, env: SocialEvidenceEnv) {
  if (!await socialAuthorized(request, env)) {
    return json(404, { error: "not_found" });
  }
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return json(200, {
      schemaVersion: SOCIAL_EVIDENCE_SCHEMA_VERSION,
      accepts: ["linkedin", "x"],
      maxBatch: SOCIAL_EVIDENCE_MAX_BATCH,
      maxBytes: SOCIAL_EVIDENCE_MAX_BYTES,
      publication: "editor_only",
    });
  }
  if (method !== "POST") return json(405, { error: "method_not_allowed" }, { allow: "GET, HEAD, POST" });
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return json(415, { error: "application_json_required" });
  try {
    const decoded = PacketEnvelope.safeParse(await boundedJson(request));
    if (!decoded.success) return json(422, { error: "invalid_packet", issues: decoded.error.issues.slice(0, 12).map(({ path, message }) => ({ path, message })) });
    const packets = "packets" in decoded.data ? decoded.data.packets : [decoded.data];
    const receivedAt = new Date();
    for (const packet of packets) validatePacketSemantics(packet, receivedAt);
    const stored = [];
    for (const packet of packets) stored.push(await persistPacket(env.VALLEY_DESK_DB, packet, receivedAt));
    return json(202, { accepted: stored.length, packets: stored });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_packet";
    if (message === "payload_too_large") return json(413, { error: message });
    if (/(?:url|_at)_invalid|platform_url_mismatch/.test(message)) return json(422, { error: message });
    if (error instanceof SyntaxError) return json(400, { error: "invalid_json" });
    console.error("social-evidence-intake", JSON.stringify({ outcome: "failed", message: message.slice(0, 160) }));
    return json(500, { error: "intake_failed" });
  }
}

type PacketRow = {
  id: string; platform: "linkedin" | "x"; post_url: string; author_name: string;
  author_profile_url: string; author_json: string; post_json: string; attachments_json: string;
  linked_sources_json: string; entities_json: string; collector_analysis_json: string;
  instruction_like: number; posted_at: string | null; observed_at: string;
};

function normalizedProfile(value: string) {
  try { return canonicalSocialUrl(value, value.includes("linkedin.com") ? "linkedin" : "x", true).toLowerCase(); }
  catch { return ""; }
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "social-update";
}

function region(value?: string): "PA" | "NJ" | "DE" | "regional" {
  return value === "PA" || value === "NJ" || value === "DE" ? value : "regional";
}

type Executive = {
  name: string;
  profileUrl: string;
  orgs: string[];
  role?: string;
  org?: string;
  personId?: string;
  roleId?: string;
  institutionId?: string;
  verifiedAt?: string;
  sourceId?: string;
};
async function verifiedExecutives(db: D1DatabaseLike, now: Date): Promise<Executive[]> {
  const result = await db.prepare(`SELECT p.id AS person_id, p.display_name, p.linkedin_url,
      r.id AS role_id, r.title, r.source_id, r.verified_at, i.id AS institution_id,
      i.org_ids_json, i.short_name
    FROM covered_people p
    JOIN executive_roles r ON r.person_id = p.id
    JOIN covered_institutions i ON i.id = r.institution_id
    WHERE i.covered = 1
      AND p.linkedin_url IS NOT NULL
      AND r.effective_from <= ?
      AND (r.effective_to IS NULL OR r.effective_to > ?)
      AND r.verified_at IS NOT NULL
      AND r.verified_at <= ?
      AND r.verification_status = 'verified'
    ORDER BY i.id, p.id, r.id`).bind(
        now.toISOString(), now.toISOString(), now.toISOString(),
      ).all<{
      person_id: string; display_name: string; linkedin_url: string; role_id: string; title: string;
      source_id: string | null; verified_at: string; institution_id: string;
      org_ids_json: string; short_name: string;
    }>();
  return (result.results ?? []).flatMap((row) => {
    try {
      const orgs = z.array(z.string().min(1)).parse(JSON.parse(row.org_ids_json));
      return orgs.length ? [{
        name: row.display_name, profileUrl: row.linkedin_url, orgs, role: row.title, org: row.short_name,
        personId: row.person_id, roleId: row.role_id, institutionId: row.institution_id,
        verifiedAt: row.verified_at, sourceId: row.source_id ?? undefined,
      }] : [];
    } catch { return []; }
  });
}

type SocialManifestTarget = {
  id: string;
  platform: "linkedin" | "x";
  targetType: "organization" | "executive";
  name: string;
  profileUrl: string;
  platformProfileId: string | null;
  profileKey: string;
  institutionIds: string[];
  orgIds: string[];
  active: boolean;
  state: "active" | "inactive";
  lastVerifiedAt: string | null;
  verificationSource: "curated-inventory" | "executive-ledger";
  personId?: string;
  roleId?: string;
  role?: string;
};

function profileKey(value: string) {
  try {
    const parts = new URL(value).pathname.split("/").filter(Boolean);
    return parts.at(-1) ?? "";
  } catch { return ""; }
}

function accessVerified(value?: string) {
  return value?.trim().toLowerCase() === "true";
}

function manifestOptions(env: SocialEvidenceEnv): SocialManifestOptions {
  return {
    linkedinAccessVerified: accessVerified(env.SOCIAL_LINKEDIN_ACCESS_VERIFIED),
    xAccessVerified: accessVerified(env.SOCIAL_X_ACCESS_VERIFIED),
  };
}

function institutionIdsForOrgs(orgIds: readonly string[]) {
  const allowed = new Set(orgIds);
  return coveredInstitutions(coveragePack)
    .filter((institution) => institution.orgIds.some((orgId) => allowed.has(orgId)))
    .map((institution) => institution.id)
    .sort();
}

async function manifestTargetId(platform: "linkedin" | "x", profileUrl: string) {
  return `social-${platform}-${(await digest(`${platform}:${profileUrl}`)).slice(0, 24)}`;
}

export type SocialManifestOptions = {
  linkedinAccessVerified?: boolean;
  xAccessVerified?: boolean;
};

export async function buildSocialTargetManifest(
  db: D1DatabaseLike,
  now = new Date(),
  options: SocialManifestOptions = {},
) {
  const linkedinAccessVerified = options.linkedinAccessVerified ?? false;
  const xAccessVerified = options.xAccessVerified ?? false;
  const organizationTargets = await Promise.all(
    linkedinTargets.organizations
      .filter((row) => row.orgs.length > 0)
      .map(async (row): Promise<SocialManifestTarget> => {
        const profileUrl = canonicalSocialUrl(row.url, "linkedin", true);
        return {
          id: await manifestTargetId("linkedin", profileUrl),
          platform: "linkedin",
          targetType: "organization",
          name: row.name,
          profileUrl,
          platformProfileId: null,
          profileKey: profileKey(profileUrl),
          institutionIds: institutionIdsForOrgs(row.orgs),
          orgIds: [...row.orgs].sort(),
          active: linkedinAccessVerified,
          state: linkedinAccessVerified ? "active" : "inactive",
          lastVerifiedAt: `${linkedinTargets.verifiedAt}T00:00:00.000Z`,
          verificationSource: "curated-inventory",
        };
      }),
  );
  let ledgerAvailable = false;
  let executiveTargets: Executive[] = [];
  try {
    executiveTargets = await verifiedExecutives(db, now);
    ledgerAvailable = true;
  } catch {
    // A manifest must say that its ledger is unavailable instead of silently
    // claiming that an empty executive list is current and complete.
    ledgerAvailable = false;
  }
  const executiveManifestTargets = await Promise.all(
    executiveTargets.map(async (row): Promise<SocialManifestTarget> => {
      const profileUrl = canonicalSocialUrl(row.profileUrl, "linkedin", true);
      return {
        id: await manifestTargetId("linkedin", profileUrl),
        platform: "linkedin",
        targetType: "executive",
        name: row.name,
        profileUrl,
        platformProfileId: null,
        profileKey: profileKey(profileUrl),
        institutionIds: row.institutionId ? [row.institutionId] : institutionIdsForOrgs(row.orgs),
        orgIds: [...row.orgs].sort(),
        active: linkedinAccessVerified,
        state: linkedinAccessVerified ? "active" : "inactive",
        lastVerifiedAt: row.verifiedAt ?? null,
        verificationSource: "executive-ledger",
        ...(row.personId ? { personId: row.personId } : {}),
        ...(row.roleId ? { roleId: row.roleId } : {}),
        ...(row.role ? { role: row.role } : {}),
      };
    }),
  );
  const targets = [...organizationTargets, ...executiveManifestTargets]
    .sort((left, right) => left.id.localeCompare(right.id));
  const covered = coveredInstitutions(coveragePack).map((institution) => {
    const institutionTargets = targets.filter((target) => target.institutionIds.includes(institution.id));
    const dates = institutionTargets
      .map((target) => target.lastVerifiedAt)
      .filter((value): value is string => Boolean(value))
      .sort();
    return {
      institutionId: institution.id,
      shortName: institution.shortName,
      targetCount: institutionTargets.length,
      activeTargetCount: institutionTargets.filter((target) => target.active).length,
      lastVerifiedAt: dates.at(-1) ?? null,
    };
  });
  const platformHealth = {
    linkedin: {
      state: targets.some((target) => target.platform === "linkedin" && target.active) ? "active" : "inactive",
      targetCount: targets.filter((target) => target.platform === "linkedin").length,
      activeTargetCount: targets.filter((target) => target.platform === "linkedin" && target.active).length,
      inactiveTargetCount: targets.filter((target) => target.platform === "linkedin" && !target.active).length,
      collectionMode: linkedinAccessVerified ? "public-observation" : "inventory-only",
      ...(linkedinAccessVerified ? {} : { reason: "LinkedIn connector access is not operator-verified" }),
    },
    x: {
      state: xAccessVerified && targets.some((target) => target.platform === "x" && target.active) ? "active" : "inactive",
      targetCount: 0,
      activeTargetCount: 0,
      inactiveTargetCount: 0,
      collectionMode: "not-activated",
      reason: xAccessVerified
        ? "No verified X targets are configured in the source registry"
        : "X connector access is not operator-verified and no verified targets are configured",
    },
  } as const;
  const canonical = {
    schemaVersion: 1,
    manifestType: "social-target-manifest",
    coveragePack: { packId: coveragePack.packId, schemaVersion: coveragePack.schemaVersion, asOf: coveragePack.asOf },
    source: "curated-account-inventory-plus-current-executive-ledger",
    ledger: { state: ledgerAvailable ? "available" : "unavailable" },
    platformHealth,
    coverage: covered,
    targets,
  } as const;
  const manifestHash = await digest(JSON.stringify(canonical));
  return {
    ...canonical,
    generatedAt: now.toISOString(),
    manifestVersion: `social-targets-v1-${manifestHash.slice(0, 16)}`,
    manifestHash,
  };
}

export async function handleSocialManifest(request: Request, env: SocialEvidenceEnv) {
  if (!await socialAuthorized(request, env)) {
    return json(404, { error: "not_found" });
  }
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return json(405, { error: "method_not_allowed" }, { allow: "GET, HEAD" });
  try {
    return json(200, await buildSocialTargetManifest(env.VALLEY_DESK_DB, new Date(), manifestOptions(env)));
  } catch (error) {
    console.error("social-target-manifest", JSON.stringify({ outcome: "failed", message: error instanceof Error ? error.message : String(error) }));
    return json(503, { error: "manifest_unavailable" });
  }
}

type CollectorRunRow = {
  id: string;
  schema_version: number;
  collector: "vale";
  manifest_version: string;
  manifest_hash: string;
  started_at: string;
  finished_at: string;
  outcome: "success" | "partial" | "failed";
  accounts_checked: number;
  posts_seen: number;
  accepted: number;
  duplicates: number;
  failures: number;
  platforms_json: string;
  failure_reasons_json: string;
  created_at: string;
  consecutive_failures: number;
  paused_at: string | null;
};

function collectorRunPayload(row: CollectorRunRow | null) {
  if (!row) return null;
  return {
    schemaVersion: row.schema_version,
    collector: row.collector,
    runId: row.id,
    manifestVersion: row.manifest_version,
    manifestHash: row.manifest_hash,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    outcome: row.outcome,
    accountsChecked: Number(row.accounts_checked) || 0,
    postsSeen: Number(row.posts_seen) || 0,
    accepted: Number(row.accepted) || 0,
    duplicates: Number(row.duplicates) || 0,
    failures: Number(row.failures) || 0,
    platforms: parseJson(row.platforms_json, { linkedin: {}, x: {} }),
    failureReasons: parseJson(row.failure_reasons_json, []),
    consecutiveFailures: Number(row.consecutive_failures) || 0,
    pauseRequired: Number(row.consecutive_failures) >= 3,
    pausedAt: row.paused_at,
    createdAt: row.created_at,
  };
}

export async function handleSocialCollectorRuns(request: Request, env: SocialEvidenceEnv) {
  if (!await socialAuthorized(request, env)) {
    return json(404, { error: "not_found" });
  }
  const method = request.method.toUpperCase();
  if (method === "GET") {
    try {
      const [latest, lastSuccessful] = await Promise.all([
        env.VALLEY_DESK_DB.prepare(`
          SELECT id, schema_version, collector, manifest_version, manifest_hash,
                 started_at, finished_at, outcome, accounts_checked, posts_seen,
                 accepted, duplicates, failures, platforms_json, failure_reasons_json, created_at,
                 consecutive_failures, paused_at
          FROM social_collector_runs
          WHERE collector = 'vale'
          ORDER BY finished_at DESC, id DESC LIMIT 1
        `).first<CollectorRunRow>(),
        env.VALLEY_DESK_DB.prepare(`
          SELECT id, schema_version, collector, manifest_version, manifest_hash,
                 started_at, finished_at, outcome, accounts_checked, posts_seen,
                 accepted, duplicates, failures, platforms_json, failure_reasons_json, created_at,
                 consecutive_failures, paused_at
          FROM social_collector_runs
          WHERE collector = 'vale' AND outcome = 'success'
          ORDER BY finished_at DESC, id DESC LIMIT 1
        `).first<CollectorRunRow>(),
      ]);
      return json(200, {
        schemaVersion: SOCIAL_EVIDENCE_SCHEMA_VERSION,
        collector: "vale",
        latest: collectorRunPayload(latest),
        lastSuccessful: collectorRunPayload(lastSuccessful),
      });
    } catch (error) {
      console.error("social-collector-status", JSON.stringify({ outcome: "failed", message: error instanceof Error ? error.message : String(error) }));
      return json(503, { error: "collector_status_unavailable" });
    }
  }
  if (method === "HEAD") {
    return json(200, { schemaVersion: SOCIAL_EVIDENCE_SCHEMA_VERSION, collector: "vale" });
  }
  if (method !== "POST") return json(405, { error: "method_not_allowed" }, { allow: "GET, HEAD, POST" });
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    return json(415, { error: "application_json_required" });
  }
  try {
    const decoded = CollectorRun.safeParse(await boundedJson(request));
    if (!decoded.success) {
      return json(422, {
        error: "invalid_collector_run",
        issues: decoded.error.issues.slice(0, 12).map(({ path, message }) => ({ path, message })),
      });
    }
    const input = decoded.data;
    const started = Date.parse(input.startedAt);
    const finished = Date.parse(input.finishedAt);
    if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started || finished > Date.now() + 10 * 60_000) {
      return json(422, { error: "collector_run_time_invalid" });
    }
    let manifest: Awaited<ReturnType<typeof buildSocialTargetManifest>>;
    try {
      manifest = await buildSocialTargetManifest(
        env.VALLEY_DESK_DB,
        new Date(input.finishedAt),
        manifestOptions(env),
      );
    } catch {
      return json(503, { error: "manifest_unavailable" });
    }
    if (manifest.manifestVersion !== input.manifestVersion || manifest.manifestHash !== input.manifestHash) {
      return json(409, {
        error: "manifest_mismatch",
        manifestVersion: manifest.manifestVersion,
        manifestHash: manifest.manifestHash,
      });
    }
    const existing = await env.VALLEY_DESK_DB.prepare(`
      SELECT consecutive_failures, paused_at
      FROM social_collector_runs
      WHERE id = ?
    `).bind(input.runId).first<{ consecutive_failures: number; paused_at: string | null }>();
    const previous = existing ? null : await env.VALLEY_DESK_DB.prepare(`
      SELECT consecutive_failures
      FROM social_collector_runs
      WHERE collector = 'vale'
      ORDER BY finished_at DESC, id DESC LIMIT 1
    `).first<{ consecutive_failures: number }>();
    const idempotent = Boolean(existing);
    const consecutiveFailures = existing
      ? Math.max(0, Number(existing.consecutive_failures) || 0)
      : input.outcome === "success"
        ? 0
        : Math.max(0, Number(previous?.consecutive_failures) || 0) + 1;
    const pausedAt = existing
      ? existing.paused_at
      : consecutiveFailures >= 3
        ? input.finishedAt
        : null;
    const createdAt = new Date().toISOString();
    await env.VALLEY_DESK_DB.prepare(`
      INSERT INTO social_collector_runs (
        id, schema_version, collector, manifest_version, manifest_hash,
        started_at, finished_at, outcome, accounts_checked, posts_seen,
        accepted, duplicates, failures, platforms_json, failure_reasons_json, created_at,
        consecutive_failures, paused_at
      ) VALUES (?, ?, 'vale', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        manifest_version = excluded.manifest_version,
        manifest_hash = excluded.manifest_hash,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        outcome = excluded.outcome,
        accounts_checked = excluded.accounts_checked,
        posts_seen = excluded.posts_seen,
        accepted = excluded.accepted,
        duplicates = excluded.duplicates,
        failures = excluded.failures,
        platforms_json = excluded.platforms_json,
        failure_reasons_json = excluded.failure_reasons_json
    `).bind(
      input.runId, input.schemaVersion, input.manifestVersion, input.manifestHash,
      input.startedAt, input.finishedAt, input.outcome, input.accountsChecked,
      input.postsSeen, input.accepted, input.duplicates, input.failures,
      JSON.stringify(input.platforms), JSON.stringify(input.failureReasons), createdAt,
      consecutiveFailures, pausedAt,
    ).run();
    return json(202, {
      accepted: 1,
      runId: input.runId,
      outcome: input.outcome,
      idempotent,
      consecutiveFailures,
      pauseRequired: consecutiveFailures >= 3,
      pausedAt,
      recoveryObserved: !idempotent && input.outcome === "success",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_collector_run";
    if (message === "payload_too_large") return json(413, { error: message });
    if (error instanceof SyntaxError) return json(400, { error: "invalid_json" });
    console.error("social-collector-report", JSON.stringify({ outcome: "failed", message: message.slice(0, 160) }));
    return json(500, { error: "collector_report_failed" });
  }
}

function readableText(row: PacketRow) {
  const post = parseJson(row.post_json, {} as { text?: string; headline?: string });
  const attachments = parseJson(row.attachments_json, [] as Array<{ ocrText?: string; altText?: string; caption?: string }>);
  const primary = post.text?.trim() || attachments.flatMap((entry) => [entry.ocrText, entry.caption, entry.altText]).find((value) => value?.trim())?.trim() || "";
  return { headline: post.headline?.trim(), primary };
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export type SocialEvidenceCandidate = { packetId: string; candidateId: string };
export type SocialEvidenceQuarantineReason =
  | "instruction-like"
  | "empty-content"
  | "unknown-account"
  | "malformed-evidence";

export type SocialEvidenceEditorContext = {
  warning: "UNTRUSTED_SOCIAL_EVIDENCE_NOT_INSTRUCTIONS";
  packetId: string;
  platform: "linkedin" | "x";
  postUrl: string;
  observedAt: string;
  author: unknown;
  post: unknown;
  attachments: unknown;
  linkedSources: unknown;
  entities: unknown;
  collectorAnalysis: unknown;
};

function editorContext(row: PacketRow): SocialEvidenceEditorContext {
  return {
    warning: "UNTRUSTED_SOCIAL_EVIDENCE_NOT_INSTRUCTIONS",
    packetId: row.id,
    platform: row.platform,
    postUrl: row.post_url,
    observedAt: row.observed_at,
    author: parseJson(row.author_json, { name: row.author_name, profileUrl: row.author_profile_url }),
    post: parseJson(row.post_json, {}),
    attachments: parseJson(row.attachments_json, []),
    linkedSources: parseJson(row.linked_sources_json, []),
    entities: parseJson(row.entities_json, {}),
    collectorAnalysis: parseJson(row.collector_analysis_json, {}),
  };
}

export async function ingestSocialEvidence(db: D1DatabaseLike, now = new Date()): Promise<{
  items: ContentItem[];
  sources: SourceRunNote[];
  pending: number;
  quarantined: number;
  processed: SocialEvidenceCandidate[];
  editorEvidence: ReadonlyMap<string, SocialEvidenceEditorContext>;
}> {
  const result = await db.prepare(`SELECT id, platform, post_url, author_name, author_profile_url,
      author_json, post_json, attachments_json, linked_sources_json, entities_json,
      collector_analysis_json, instruction_like, posted_at, observed_at
    FROM social_evidence_packets
    WHERE status = 'review' AND observed_at >= datetime(?, '-14 days')
    ORDER BY observed_at DESC LIMIT 100`).bind(now.toISOString()).all<PacketRow>();
  const rows = result.results ?? [];
  const executives: Executive[] = [
    ...await verifiedExecutives(db, now),
  ];
  const orgs = linkedinTargets.organizations.filter((row) => row.orgs.length > 0);
  const items: ContentItem[] = [];
  const processed: SocialEvidenceCandidate[] = [];
  const editorEvidence = new Map<string, SocialEvidenceEditorContext>();
  const quarantineUpdates: Array<{ id: string; reason: SocialEvidenceQuarantineReason }> = [];
  const quarantine = (id: string, reason: SocialEvidenceQuarantineReason) => {
    quarantineUpdates.push({ id, reason });
  };
  for (const row of rows) {
    if (row.instruction_like) {
      quarantine(row.id, "instruction-like");
      continue;
    }
    const profile = normalizedProfile(row.author_profile_url);
    const orgTarget = orgs.find((target) => normalizedProfile(target.url) === profile);
    const executive = executives.find((target) => normalizedProfile(target.profileUrl) === profile);
    const { headline, primary } = readableText(row);
    if (!primary) {
      quarantine(row.id, "empty-content");
      continue;
    }
    if (!orgTarget && !executive) {
      quarantine(row.id, "unknown-account");
      continue;
    }
    const title = (headline || primary.split(/\n|(?<=[.!?])\s/)[0] || `${row.author_name} update`).slice(0, 180);
    const citations = [{ name: row.author_name, url: row.post_url }];
    try {
      if (orgTarget) {
        const item: NewsItem = {
          id: `grok-${row.id}`, slug: slugify(`${orgTarget.name}-${row.id}`), kind: "news", title,
          dek: primary.slice(0, 280), body: primary.slice(0, 12000), status: "review", featured: false,
          publishedAt: row.posted_at ?? undefined, updatedAt: row.observed_at, topics: [], orgs: orgTarget.orgs,
          region: region(orgTarget.region), authors: [{ name: orgTarget.name }],
          source: { kind: "ingest", origin: `grok-social-${row.platform}`, url: row.post_url, fetchedAt: row.observed_at, externalId: row.id },
          citations, relatedEventIds: [], relatedVoiceIds: [],
        };
        items.push(item);
        processed.push({ packetId: row.id, candidateId: item.id });
        editorEvidence.set(item.id, editorContext(row));
      } else if (executive) {
        const item: VoiceItem = {
          id: `grok-${row.id}`, slug: slugify(`${executive.name}-${row.id}`), kind: "voice", title,
          dek: primary.slice(0, 280), body: primary.slice(0, 12000), status: "review", featured: false,
          publishedAt: row.posted_at ?? undefined, updatedAt: row.observed_at, topics: [], orgs: executive.orgs,
          region: "regional", authors: [{ name: executive.name, org: executive.org }],
          source: { kind: "ingest", origin: `grok-social-${row.platform}`, url: row.post_url, fetchedAt: row.observed_at, externalId: row.id },
          citations, person: executive.name, role: executive.role, org: executive.org,
          platform: row.platform, originalUrl: row.post_url,
        };
        items.push(item);
        processed.push({ packetId: row.id, candidateId: item.id });
        editorEvidence.set(item.id, editorContext(row));
      }
    } catch {
      quarantine(row.id, "malformed-evidence");
    }
  }
  if (quarantineUpdates.length) {
    await db.batch(quarantineUpdates.map(({ id, reason }) => db.prepare(
      `UPDATE social_evidence_packets
       SET status = 'quarantined', quarantine_reason = ?
       WHERE id = ? AND status = 'review'`,
    ).bind(reason, id)));
  }
  return {
    items,
    pending: rows.length,
    quarantined: quarantineUpdates.length,
    processed,
    editorEvidence,
    sources: [sourceNote({
      id: "grok-social-evidence", origin: "grok-social-evidence", type: "social",
      state: sourceStateForItemCount(items.length), checkedAt: now.toISOString(), itemCount: items.length,
    })],
  };
}

/** Acknowledge only after the corresponding candidate and editorial decision are durable. */
export async function markSocialEvidenceProcessed(
  db: D1DatabaseLike,
  candidates: readonly SocialEvidenceCandidate[],
  now = new Date(),
) {
  if (!candidates.length) return 0;
  await db.batch(candidates.map(({ packetId, candidateId }) => db.prepare(
    `UPDATE social_evidence_packets
     SET status = 'processed', processed_at = COALESCE(processed_at, ?), candidate_id = COALESCE(candidate_id, ?)
     WHERE id = ? AND status = 'review'`,
  ).bind(now.toISOString(), candidateId, packetId)));
  return candidates.length;
}

export async function cleanupSocialEvidencePackets(db: D1DatabaseLike, now = new Date()) {
  return db.prepare(`DELETE FROM social_evidence_packets WHERE id IN (
    SELECT id FROM social_evidence_packets
    WHERE (status IN ('processed', 'ignored', 'rejected') AND last_seen_at < datetime(?, '-180 days'))
       OR (status = 'review' AND last_seen_at < datetime(?, '-365 days'))
    ORDER BY last_seen_at ASC LIMIT 200
  )`).bind(now.toISOString(), now.toISOString()).run();
}
