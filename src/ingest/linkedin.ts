import type { ContentItem, VoiceItem } from "../content/schema";
import type { IngestBatch } from "./envelope";
import { toReviewQueue } from "./envelope";
import { isHeldHandle, liveLinkedInOrigins, type LinkedInOrigin } from "./origins";

export type SocialIngestResult = {
  items: ContentItem[];
  skipped?: string;
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
  if (isHeldHandle("linkedin", origin.slug)) return [];
  const urn = origin.kind === "organization" ? `urn:li:organization:(slug:${origin.slug})` : undefined;
  if (!urn) return [];
  const url = `https://api.linkedin.com/rest/posts?q=author&author=${encodeURIComponent(urn)}&count=10`;
  const res = await fetchImpl(url, {
    headers: {
      authorization: `Bearer ${token}`,
      "linkedin-version": "202608",
      "x-restli-protocol-version": "2.0.0",
    },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { elements?: Record<string, unknown>[] };
  return Array.isArray(data.elements) ? data.elements : [];
}

/** Official LinkedIn read. No-op without LINKEDIN_TOKEN. No cookie/like/comment scrape. */
export async function ingestLinkedIn(
  env: { LINKEDIN_TOKEN?: string } = {},
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<SocialIngestResult> {
  const token = env.LINKEDIN_TOKEN?.trim();
  if (!token) return { items: [], skipped: "no-token" };
  const fetchedAt = now.toISOString();
  const items: ContentItem[] = [];
  for (const origin of liveLinkedInOrigins()) {
    if (isHeldHandle("linkedin", origin.slug)) continue;
    try {
      const posts = await fetchOriginPosts(origin, token, fetchImpl);
      for (const raw of posts) {
        const row = asVoice(origin, raw, fetchedAt);
        if (row) items.push(row);
      }
    } catch {
      /* official read failed; do not scrape */
    }
  }
  const batch: IngestBatch = { adapter: "linkedin", fetchedAt, items };
  return { items: toReviewQueue(batch) };
}
