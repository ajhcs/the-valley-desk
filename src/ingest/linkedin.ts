import type { ContentItem, VoiceItem } from "../content/schema";
import type { IngestBatch } from "./envelope";
import { toReviewQueue } from "./envelope";
import { isHeldHandle, liveLinkedInOrigins, type LinkedInOrigin } from "./origins";
import {
  sourceBackoffNote,
  sourceIsInBackoff,
  sourceNote,
  sourceStateForItemCount,
  type SourceRunNote,
} from "./source-health";
import {
  SOCIAL_MAX_BYTES,
  SOURCE_TIMEOUT_MS,
  UpstreamError,
  fetchUpstream,
} from "./upstream";

export type SocialIngestResult = {
  items: ContentItem[];
  skipped?: string;
  sources: SourceRunNote[];
};

function slugify(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "voice";
}

function activityIdFrom(raw: Record<string, unknown>): string | undefined {
  const id = raw.id ?? raw.ugcPost ?? raw.activity;
  if (typeof id !== "string" || !id.trim()) return undefined;
  const activity = id.match(/(\d{8,})$/);
  return activity?.[1] ?? id.replace(/[^a-zA-Z0-9_-]/g, "").slice(-32);
}

function asVoice(origin: LinkedInOrigin, raw: Record<string, unknown>, fetchedAt: string): VoiceItem | undefined {
  const activityId = activityIdFrom(raw);
  if (!activityId) return undefined;
  const text = String(raw.commentary ?? raw.text ?? raw.headline ?? "").trim();
  const url =
    typeof raw.permalink === "string"
      ? raw.permalink
      : `${origin.url.replace(/\/$/, "")}/posts/${activityId}`;
  const created = Date.parse(String(raw.createdAt ?? raw.publishedAt ?? ""));
  const publishedAt = Number.isFinite(created) ? new Date(created).toISOString() : undefined;
  const title = text.split(/\n/)[0]?.slice(0, 140) || `${origin.person} LinkedIn post`;
  return {
    id: `voice-li-${activityId}`,
    slug: slugify(`${origin.slug}-${activityId}`),
    kind: "voice",
    title,
    dek: text.slice(0, 240),
    body: text.slice(0, 2000),
    status: "review",
    featured: false,
    publishedAt,
    updatedAt: fetchedAt,
    topics: [],
    orgs: origin.orgs,
    region: origin.region,
    authors: [{ name: origin.person }],
    source: {
      kind: "ingest",
      origin: "linkedin",
      url,
      fetchedAt,
      externalId: activityId,
    },
    person: origin.person,
    platform: "linkedin",
    originalUrl: url,
    citations: [{ name: origin.person, url }],
  };
}

async function fetchOriginPosts(
  origin: LinkedInOrigin,
  token: string,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>[]> {
  const urn = `urn:li:organization:(slug:${origin.slug})`;
  const url = `https://api.linkedin.com/rest/posts?q=author&author=${encodeURIComponent(urn)}&count=10`;
  const response = await fetchUpstream({
    url,
    fetchImpl,
    maxBytes: SOCIAL_MAX_BYTES,
    timeoutMs: SOURCE_TIMEOUT_MS,
    headers: {
      authorization: `Bearer ${token}`,
      "linkedin-version": "202608",
      "x-restli-protocol-version": "2.0.0",
    },
    requiresAuth: true,
  });
  let data: { elements?: Record<string, unknown>[] };
  try {
    data = JSON.parse(response.body) as { elements?: Record<string, unknown>[] };
  } catch {
    throw new UpstreamError("parser-failed", "LinkedIn posts response was not JSON");
  }
  if (!Array.isArray(data.elements)) {
    throw new UpstreamError("parser-failed", "LinkedIn posts response omitted elements");
  }
  return data.elements;
}

function originNote(
  origin: LinkedInOrigin,
  checkedAt: string,
  state: SourceRunNote["state"],
  extra: Partial<SourceRunNote> = {},
): SourceRunNote {
  return sourceNote({
    id: `linkedin-${origin.slug}`,
    origin: origin.slug,
    type: "social",
    state,
    checkedAt,
    url: origin.url,
    ...extra,
  });
}

/** Official LinkedIn read. No-op without LINKEDIN_TOKEN. Person origins are unsupported. */
export async function ingestLinkedIn(
  env: {
    LINKEDIN_TOKEN?: string;
    sourceHealth?: ReadonlyMap<string, import("./source-health").PersistedSourceHealth>;
  } = {},
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<SocialIngestResult> {
  const fetchedAt = now.toISOString();
  const origins = liveLinkedInOrigins().filter((origin) => !isHeldHandle("linkedin", origin.slug));
  const token = env.LINKEDIN_TOKEN?.trim();
  if (!token) {
    return {
      items: [],
      skipped: "no-token",
      sources: origins.map((origin) => originNote(
        origin,
        fetchedAt,
        "misconfigured",
        { error: "LINKEDIN_TOKEN is not configured" },
      )),
    };
  }
  const items: ContentItem[] = [];
  const sources: SourceRunNote[] = [];
  for (const origin of origins) {
    const sourceId = `linkedin-${origin.slug}`;
    const prior = env.sourceHealth?.get(sourceId);
    if (sourceIsInBackoff(prior, now)) {
      sources.push(sourceBackoffNote(sourceId, origin.slug, "social", fetchedAt, prior, origin.url));
      continue;
    }
    if (origin.kind !== "organization") {
      sources.push(originNote(origin, fetchedAt, "misconfigured", {
        error: "LinkedIn person origins are not supported by the official organization posts API",
      }));
      continue;
    }
    try {
      const posts = await fetchOriginPosts(origin, token, fetchImpl);
      const before = items.length;
      for (const raw of posts) {
        try {
          const row = asVoice(origin, raw, fetchedAt);
          if (row) items.push(row);
        } catch {
          /* skip malformed post */
        }
      }
      const itemCount = items.length - before;
      sources.push(originNote(origin, fetchedAt, sourceStateForItemCount(itemCount), { itemCount }));
    } catch (error) {
      const failed = error instanceof UpstreamError
        ? error
        : new UpstreamError("upstream-failed", error instanceof Error ? error.message : String(error));
      sources.push(originNote(origin, fetchedAt, failed.code, {
        error: failed.message,
        requiresAuth: true,
        httpStatus: failed.httpStatus,
      }));
    }
  }
  const batch: IngestBatch = { adapter: "linkedin", fetchedAt, items };
  return { items: toReviewQueue(batch), sources };
}
