import type { ContentItem, VoiceItem } from "../content/schema";
import type { IngestBatch } from "./envelope";
import { toReviewQueue } from "./envelope";
import { isHeldHandle, liveXOrigins, type XOrigin } from "./origins";

export type XIngestResult = {
  items: ContentItem[];
  skipped?: string;
};

function slugify(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "voice";
}

function asVoice(origin: XOrigin, tweet: { id: string; text?: string; created_at?: string }, fetchedAt: string): VoiceItem {
  const url = `https://x.com/${origin.handle}/status/${tweet.id}`;
  const created = tweet.created_at ? Date.parse(tweet.created_at) : NaN;
  const publishedAt = Number.isFinite(created) ? new Date(created).toISOString() : undefined;
  const text = String(tweet.text ?? "").trim();
  const title = text.split(/\n/)[0]?.slice(0, 140) || `${origin.person} on X`;
  return {
    id: `voice-x-${tweet.id}`,
    slug: slugify(`${origin.handle}-${tweet.id}`),
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
      origin: "x",
      url,
      fetchedAt,
      externalId: tweet.id,
    },
    person: origin.person,
    platform: "x",
    originalUrl: url,
    citations: [{ name: origin.person, url }],
  };
}

/** Allowlisted X handles only. No-op without X_BEARER_TOKEN. Personal X stays HOLD. */
export async function ingestX(
  env: { X_BEARER_TOKEN?: string } = {},
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<XIngestResult> {
  const token = env.X_BEARER_TOKEN?.trim();
  if (!token) return { items: [], skipped: "no-token" };
  const allow = liveXOrigins();
  if (allow.length === 0) return { items: [], skipped: "empty-allowlist" };
  const fetchedAt = now.toISOString();
  const items: ContentItem[] = [];
  for (const origin of allow) {
    if (isHeldHandle("x", origin.handle)) continue;
    try {
      const userRes = await fetchImpl(
        `https://api.twitter.com/2/users/by/username/${encodeURIComponent(origin.handle)}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!userRes.ok) continue;
      const user = (await userRes.json()) as { data?: { id?: string } };
      const userId = user.data?.id;
      if (!userId) continue;
      const tweetsRes = await fetchImpl(
        `https://api.twitter.com/2/users/${userId}/tweets?max_results=10&tweet.fields=created_at`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!tweetsRes.ok) continue;
      const tweets = (await tweetsRes.json()) as { data?: { id: string; text?: string; created_at?: string }[] };
      for (const tweet of tweets.data ?? []) {
        if (!tweet.id) continue;
        items.push(asVoice(origin, tweet, fetchedAt));
      }
    } catch {
      /* official read failed; do not scrape */
    }
  }
  const batch: IngestBatch = { adapter: "x", fetchedAt, items };
  return { items: toReviewQueue(batch) };
}
