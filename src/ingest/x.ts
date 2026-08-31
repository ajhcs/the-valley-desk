import type { ContentItem, VoiceItem } from "../content/schema";
import type { IngestBatch } from "./envelope";
import { toReviewQueue } from "./envelope";
import { isHeldHandle, liveXOrigins, type XOrigin } from "./origins";
import {
  sourceBackoffNote,
  sourceIsInBackoff,
  sourceNote,
  sourceStateForItemCount,
  type SourceRunNote,
} from "./source-health";
import { institutionIdsForOrgIds } from "./coverage-pack";
import {
  SOCIAL_MAX_BYTES,
  SOURCE_TIMEOUT_MS,
  UpstreamError,
  fetchUpstream,
} from "./upstream";

export type XIngestResult = {
  items: ContentItem[];
  skipped?: string;
  sources: SourceRunNote[];
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

function parseJson<T>(body: string, error: string): T {
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new UpstreamError("parser-failed", error);
  }
}

async function fetchOriginTweets(
  origin: XOrigin,
  token: string,
  fetchImpl: typeof fetch,
) {
  const headers = { authorization: `Bearer ${token}` };
  const userRes = await fetchUpstream({
    url: `https://api.twitter.com/2/users/by/username/${encodeURIComponent(origin.handle)}`,
    fetchImpl,
    maxBytes: SOCIAL_MAX_BYTES,
    timeoutMs: SOURCE_TIMEOUT_MS,
    headers,
    requiresAuth: true,
  });
  const user = parseJson<{ data?: { id?: string } }>(userRes.body, "X user response was not JSON");
  const userId = user.data?.id;
  if (!userId) throw new UpstreamError("parser-failed", "X user response omitted id");
  const tweetsRes = await fetchUpstream({
    url: `https://api.twitter.com/2/users/${userId}/tweets?max_results=10&tweet.fields=created_at`,
    fetchImpl,
    maxBytes: SOCIAL_MAX_BYTES,
    timeoutMs: SOURCE_TIMEOUT_MS,
    headers,
    requiresAuth: true,
  });
  const tweets = parseJson<{ data?: { id: string; text?: string; created_at?: string }[] }>(
    tweetsRes.body,
    "X tweets response was not JSON",
  );
  return Array.isArray(tweets.data) ? tweets.data : [];
}

function originNote(
  origin: XOrigin,
  checkedAt: string,
  state: SourceRunNote["state"],
  extra: Partial<SourceRunNote> = {},
): SourceRunNote {
  return sourceNote({
    id: `x-${origin.handle}`,
    origin: origin.handle,
    type: "social",
    state,
    checkedAt,
    url: origin.url,
    institutionIds: institutionIdsForOrgIds(origin.orgs),
    ...extra,
  });
}

/** Allowlisted X handles only. No-op without X_BEARER_TOKEN. Personal X stays HOLD. */
export async function ingestX(
  env: {
    X_BEARER_TOKEN?: string;
    sourceHealth?: ReadonlyMap<string, import("./source-health").PersistedSourceHealth>;
  } = {},
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<XIngestResult> {
  const fetchedAt = now.toISOString();
  const allow = liveXOrigins().filter((origin) => !isHeldHandle("x", origin.handle));
  const token = env.X_BEARER_TOKEN?.trim();
  if (!token) {
    return {
      items: [],
      skipped: "no-token",
      sources: allow.length
        ? allow.map((origin) => originNote(origin, fetchedAt, "misconfigured", {
          error: "X_BEARER_TOKEN is not configured",
        }))
        : [sourceNote({
          id: "x",
          origin: "x",
          type: "social",
          state: "misconfigured",
          checkedAt: fetchedAt,
          error: "X_BEARER_TOKEN is not configured",
        })],
    };
  }
  if (allow.length === 0) {
    return {
      items: [],
      skipped: "empty-allowlist",
      sources: [sourceNote({
        id: "x",
        origin: "x",
        type: "social",
        state: "disabled",
        checkedAt: fetchedAt,
        error: "No live X origins are configured",
      })],
    };
  }
  const items: ContentItem[] = [];
  const sources: SourceRunNote[] = [];
  for (const origin of allow) {
    const sourceId = `x-${origin.handle}`;
    const prior = env.sourceHealth?.get(sourceId);
    if (sourceIsInBackoff(prior, now)) {
      sources.push(sourceBackoffNote(sourceId, origin.handle, "social", fetchedAt, prior, origin.url));
      continue;
    }
    try {
      const tweets = await fetchOriginTweets(origin, token, fetchImpl);
      const before = items.length;
      for (const tweet of tweets) {
        if (!tweet.id) continue;
        try {
          items.push(asVoice(origin, tweet, fetchedAt));
        } catch {
          /* skip malformed tweet */
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
  const batch: IngestBatch = { adapter: "x", fetchedAt, items };
  return { items: toReviewQueue(batch), sources };
}
