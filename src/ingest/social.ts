import { ingestLinkedIn } from "./linkedin";
import { ingestX } from "./x";
import type { ContentItem } from "../content/schema";
import { isLiveSocialKey } from "./origins";
import type { SourceRunNote } from "./source-health";
import { ingestSocialEvidence, type SocialEvidenceCandidate, type SocialEvidenceEditorContext } from "./social-evidence";
import type { D1DatabaseLike } from "./persistence";

export type IngestEnv = {
  X_BEARER_TOKEN?: string;
  LINKEDIN_TOKEN?: string;
  VALLEY_DESK_DB?: D1DatabaseLike;
};

export type SocialRun = {
  items: ContentItem[];
  linkedin: { count: number; skipped?: string };
  x: { count: number; skipped?: string };
  grok: { count: number; pending: number; skipped?: string };
  processedPackets: SocialEvidenceCandidate[];
  editorEvidence: ReadonlyMap<string, SocialEvidenceEditorContext>;
  sources: SourceRunNote[];
};

/** LI + X only. Never RSS. Review-only. Jane Doe is not a live key. */
export async function ingestSocial(
  env: IngestEnv = {},
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<SocialRun> {
  const [linkedin, x, grok] = await Promise.all([
    ingestLinkedIn(env, now, fetchImpl),
    ingestX(env, now, fetchImpl),
    env.VALLEY_DESK_DB
      ? ingestSocialEvidence(env.VALLEY_DESK_DB, now)
      : Promise.resolve({
        items: [], pending: 0, processed: [],
        editorEvidence: new Map<string, SocialEvidenceEditorContext>(),
        sources: [] as SourceRunNote[],
      }),
  ]);
  const items = [...linkedin.items, ...x.items, ...grok.items].filter((item) => isLiveSocialKey(item.id) && item.slug !== "cio-note-workforce-ai");
  return {
    items,
    linkedin: { count: linkedin.items.length, skipped: linkedin.skipped },
    x: { count: x.items.length, skipped: x.skipped },
    grok: { count: grok.items.length, pending: grok.pending, ...(!env.VALLEY_DESK_DB ? { skipped: "no-database" } : {}) },
    processedPackets: grok.processed,
    editorEvidence: grok.editorEvidence,
    sources: [...linkedin.sources, ...x.sources, ...grok.sources],
  };
}
