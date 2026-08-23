import { ingestEvents } from "./events";
import { ingestRss } from "./rss";
import { ingestSocial, type IngestEnv } from "./social";
import type { ContentItem } from "../content/schema";

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
  };
};

export async function runIngestAll(
  env: IngestEnv = {},
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<IngestRun> {
  const fetchedAt = now.toISOString();
  const [rss, events, social] = await Promise.all([
    ingestRss(now, fetchImpl),
    ingestEvents(now, fetchImpl),
    ingestSocial(env, now, fetchImpl),
  ]);
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
    },
  };
}

/** Worker cron. Secrets missing → social no-op; RSS and events still run. */
export async function runScheduledIngest(env: IngestEnv = {}): Promise<IngestRun> {
  return runIngestAll(env);
}
