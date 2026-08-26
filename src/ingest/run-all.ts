import { ingestEventsWithHealth } from "./events";
import { ingestRssWithHealth } from "./rss";
import { ingestSocial, type IngestEnv } from "./social";
import type { ContentItem } from "../content/schema";
import { sourceNote, type SourceRunNote } from "./source-health";

export type IngestRun = {
  fetchedAt: string;
  rss: ContentItem[];
  events: ContentItem[];
  social: ContentItem[];
  notes: {
    rss: number;
    events: number;
    linkedin: { count: number; skipped?: string };
    x: { count: number; skipped?: string };
    failures?: string[];
    sources?: SourceRunNote[];
  };
};

export async function runIngestAll(
  env: IngestEnv = {},
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<IngestRun> {
  const fetchedAt = now.toISOString();
  const [rssResult, eventsResult, socialResult] = await Promise.allSettled([
    ingestRssWithHealth(now, fetchImpl),
    ingestEventsWithHealth(now, fetchImpl),
    ingestSocial(env, now, fetchImpl),
  ]);
  const rss = rssResult.status === "fulfilled" ? rssResult.value.items : [];
  const events = eventsResult.status === "fulfilled" ? eventsResult.value.items : [];
  const social = socialResult.status === "fulfilled"
    ? socialResult.value
    : { items: [], linkedin: { count: 0, skipped: "source-error" }, x: { count: 0, skipped: "source-error" }, sources: [] as SourceRunNote[] };
  const failures = [
    rssResult.status === "rejected" ? `rss: ${String(rssResult.reason)}` : undefined,
    eventsResult.status === "rejected" ? `events: ${String(eventsResult.reason)}` : undefined,
    socialResult.status === "rejected" ? `social: ${String(socialResult.reason)}` : undefined,
  ].filter((value): value is string => Boolean(value));
  const socialSources: SourceRunNote[] = socialResult.status === "fulfilled"
    ? social.sources
    : [
      sourceNote({
        id: "linkedin",
        origin: "linkedin",
        type: "social",
        state: "upstream-failed",
        checkedAt: fetchedAt,
        error: "LinkedIn source error",
      }),
      sourceNote({
        id: "x",
        origin: "x",
        type: "social",
        state: "upstream-failed",
        checkedAt: fetchedAt,
        error: "X source error",
      }),
    ];
  const sources = [
    ...(rssResult.status === "fulfilled" ? rssResult.value.sources : []),
    ...(eventsResult.status === "fulfilled" ? eventsResult.value.sources : []),
    ...socialSources,
  ];
  return {
    fetchedAt,
    rss,
    events,
    social: social.items,
    notes: {
      rss: rss.length,
      events: events.length,
      linkedin: social.linkedin,
      x: social.x,
      ...(failures.length ? { failures } : {}),
      sources,
    },
  };
}

/** Worker cron. Secrets missing → social no-op; RSS and events still run. */
export async function runScheduledIngest(
  env: IngestEnv = {},
  fetchImpl: typeof fetch = fetch,
): Promise<IngestRun> {
  return runIngestAll(env, new Date(), fetchImpl);
}
