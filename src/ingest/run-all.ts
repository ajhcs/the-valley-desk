import { ingestEventsWithHealth } from "./events";
import { ingestRssWithHealth } from "./rss";
import { ingestSocial, type IngestEnv } from "./social";
import type { ContentItem } from "../content/schema";
import type {
  NewsArticleExtractionAttempt,
  NewsArticleExtractionMetrics,
  NewsArticleExtractionState,
} from "./news-extraction";
import { sourceNote, type SourceRunNote } from "./source-health";

export type IngestRunOptions = {
  knownSourceUrls?: ReadonlySet<string>;
  newsExtractions?: ReadonlyMap<string, NewsArticleExtractionState>;
  /** The Worker uses hourly for freshness and daily for deep event discovery. */
  mode?: "hourly" | "daily";
  /** Explicit override for callers that need to run a one-off all-source scan. */
  includeEvents?: boolean;
};

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
    cadence?: "hourly" | "daily";
    failures?: string[];
    sources?: SourceRunNote[];
    newsExtraction?: NewsArticleExtractionMetrics;
  };
  newsExtraction?: {
    attempts: NewsArticleExtractionAttempt[];
    metrics: NewsArticleExtractionMetrics;
  };
};

export async function runIngestAll(
  env: IngestEnv = {},
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
  options: IngestRunOptions = {},
): Promise<IngestRun> {
  const fetchedAt = now.toISOString();
  // A normal scheduled run is freshness-first. Event pages are broader and
  // more expensive, so they run on the daily deep-scan trigger. Direct
  // callers without a mode retain the historical all-source behavior.
  const includeEvents = options.includeEvents ?? (options.mode ? options.mode === "daily" : true);
  const [rssResult, eventsResult, socialResult] = await Promise.allSettled([
    ingestRssWithHealth(now, fetchImpl, options),
    includeEvents ? ingestEventsWithHealth(now, fetchImpl) : Promise.resolve(undefined),
    ingestSocial(env, now, fetchImpl),
  ]);
  const rss = rssResult.status === "fulfilled" ? rssResult.value.items : [];
  const events = eventsResult?.status === "fulfilled" && eventsResult.value
    ? eventsResult.value.items
    : [];
  const social = socialResult.status === "fulfilled"
    ? socialResult.value
    : { items: [], linkedin: { count: 0, skipped: "source-error" }, x: { count: 0, skipped: "source-error" }, sources: [] as SourceRunNote[] };
  const failures = [
    rssResult.status === "rejected" ? `rss: ${String(rssResult.reason)}` : undefined,
    eventsResult?.status === "rejected" ? `events: ${String(eventsResult.reason)}` : undefined,
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
    ...(eventsResult?.status === "fulfilled" && eventsResult.value ? eventsResult.value.sources : []),
    ...socialSources,
  ];
  const newsExtraction = rssResult.status === "fulfilled" ? rssResult.value.newsExtraction : undefined;
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
      ...(options.mode ? { cadence: options.mode } : {}),
      ...(failures.length ? { failures } : {}),
      sources,
      ...(newsExtraction ? { newsExtraction: newsExtraction.metrics } : {}),
    },
    newsExtraction,
  };
}

/** Worker cron. Secrets missing → social no-op; daily mode adds event scans. */
export async function runScheduledIngest(
  env: IngestEnv = {},
  fetchImpl: typeof fetch = fetch,
  options: IngestRunOptions = {},
): Promise<IngestRun> {
  return runIngestAll(env, new Date(), fetchImpl, options);
}
