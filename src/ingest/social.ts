import { ingestLinkedIn } from "./linkedin";
import { ingestX } from "./x";
import type { ContentItem } from "../content/schema";
import { isLiveSocialKey } from "./origins";

export type IngestEnv = {
  X_BEARER_TOKEN?: string;
  LINKEDIN_TOKEN?: string;
};

export type SocialRun = {
  items: ContentItem[];
  linkedin: { count: number; skipped?: string };
  x: { count: number; skipped?: string };
};

/** LI + X only. Never RSS. Review-only. Jane Doe is not a live key. */
export async function ingestSocial(
  env: IngestEnv = {},
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<SocialRun> {
  const [linkedin, x] = await Promise.all([
    ingestLinkedIn(env, now, fetchImpl),
    ingestX(env, now, fetchImpl),
  ]);
  const items = [...linkedin.items, ...x.items].filter((item) => isLiveSocialKey(item.id) && item.slug !== "cio-note-workforce-ai");
  return {
    items,
    linkedin: { count: linkedin.items.length, skipped: linkedin.skipped },
    x: { count: x.items.length, skipped: x.skipped },
  };
}
