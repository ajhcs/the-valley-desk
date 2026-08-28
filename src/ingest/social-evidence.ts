import { z } from "zod";
import linkedinTargets from "../../fixtures/linkedin-notification-targets.json";
import type { ContentItem, NewsItem, VoiceItem } from "../content/schema";
import type { D1DatabaseLike } from "./persistence";
import { looksInstructionLike } from "./untrusted-text";
import { sourceNote, sourceStateForItemCount, type SourceRunNote } from "./source-health";

export const SOCIAL_EVIDENCE_PATH = "/api/signals/social";
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

type SocialEvidenceEnv = { VALLEY_DESK_DB: D1DatabaseLike; SOCIAL_INGEST_TOKEN?: string };

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

export async function handleSocialEvidence(request: Request, env: SocialEvidenceEnv) {
  if (!await tokenMatches(env.SOCIAL_INGEST_TOKEN, request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null)) {
    return json(404, { error: "not_found" });
  }
  if (request.method.toUpperCase() === "GET") {
    return json(200, {
      schemaVersion: SOCIAL_EVIDENCE_SCHEMA_VERSION,
      accepts: ["linkedin", "x"],
      maxBatch: SOCIAL_EVIDENCE_MAX_BATCH,
      maxBytes: SOCIAL_EVIDENCE_MAX_BYTES,
      publication: "editor_only",
    });
  }
  if (request.method.toUpperCase() !== "POST") return json(405, { error: "method_not_allowed" }, { allow: "GET, POST" });
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
  linked_sources_json: string; instruction_like: number; posted_at: string | null; observed_at: string;
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

type Executive = { name: string; profileUrl: string; orgs: string[]; role?: string; org?: string };
async function verifiedExecutives(db: D1DatabaseLike): Promise<Executive[]> {
  try {
    const result = await db.prepare(`SELECT p.display_name, p.linkedin_url, r.title, i.org_ids_json, i.short_name
      FROM covered_people p
      JOIN executive_roles r ON r.person_id = p.id
      JOIN covered_institutions i ON i.id = r.institution_id
      WHERE p.linkedin_url IS NOT NULL AND r.effective_to IS NULL AND r.verification_status = 'verified'`).all<{
        display_name: string; linkedin_url: string; title: string; org_ids_json: string; short_name: string;
      }>();
    return (result.results ?? []).flatMap((row) => {
      try {
        const orgs = z.array(z.string().min(1)).parse(JSON.parse(row.org_ids_json));
        return orgs.length ? [{
          name: row.display_name, profileUrl: row.linkedin_url, orgs, role: row.title, org: row.short_name,
        }] : [];
      } catch { return []; }
    });
  } catch { return []; }
}

function readableText(row: PacketRow) {
  const post = JSON.parse(row.post_json) as { text?: string; headline?: string };
  const attachments = JSON.parse(row.attachments_json) as Array<{ ocrText?: string; altText?: string; caption?: string }>;
  const primary = post.text?.trim() || attachments.flatMap((entry) => [entry.ocrText, entry.caption, entry.altText]).find((value) => value?.trim())?.trim() || "";
  return { headline: post.headline?.trim(), primary };
}

export async function ingestSocialEvidence(db: D1DatabaseLike, now = new Date()): Promise<{ items: ContentItem[]; sources: SourceRunNote[]; pending: number }> {
  const result = await db.prepare(`SELECT id, platform, post_url, author_name, author_profile_url,
      author_json, post_json, attachments_json, linked_sources_json, instruction_like, posted_at, observed_at
    FROM social_evidence_packets
    WHERE status IN ('review', 'processed') AND observed_at >= datetime(?, '-14 days')
    ORDER BY observed_at DESC LIMIT 100`).bind(now.toISOString()).all<PacketRow>();
  const rows = result.results ?? [];
  const executives: Executive[] = [
    ...await verifiedExecutives(db),
    ...linkedinTargets.people.map((row) => ({ name: row.name, profileUrl: row.url, orgs: row.orgs })),
  ];
  const orgs = linkedinTargets.organizations.filter((row) => row.orgs.length > 0);
  const items: ContentItem[] = [];
  const processed: Array<{ packetId: string; candidateId: string }> = [];
  for (const row of rows) {
    if (row.instruction_like) continue;
    const profile = normalizedProfile(row.author_profile_url);
    const orgTarget = orgs.find((target) => normalizedProfile(target.url) === profile);
    const executive = executives.find((target) => normalizedProfile(target.profileUrl) === profile);
    const { headline, primary } = readableText(row);
    if (!primary) continue;
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
      }
    } catch { /* malformed evidence remains in the durable review packet */ }
  }
  if (processed.length) {
    await db.batch(processed.map(({ packetId, candidateId }) => db.prepare(
      "UPDATE social_evidence_packets SET status = 'processed', processed_at = ?, candidate_id = ? WHERE id = ?",
    ).bind(now.toISOString(), candidateId, packetId)));
  }
  return {
    items,
    pending: rows.length,
    sources: [sourceNote({
      id: "grok-social-evidence", origin: "grok-social-evidence", type: "social",
      state: sourceStateForItemCount(items.length), checkedAt: now.toISOString(), itemCount: items.length,
    })],
  };
}

export async function cleanupSocialEvidencePackets(db: D1DatabaseLike, now = new Date()) {
  return db.prepare(`DELETE FROM social_evidence_packets WHERE id IN (
    SELECT id FROM social_evidence_packets
    WHERE (status IN ('processed', 'ignored', 'rejected') AND last_seen_at < datetime(?, '-180 days'))
       OR (status = 'review' AND last_seen_at < datetime(?, '-365 days'))
    ORDER BY last_seen_at ASC LIMIT 200
  )`).bind(now.toISOString(), now.toISOString()).run();
}
