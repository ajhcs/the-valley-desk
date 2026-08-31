import { ingestLinkedIn } from "./linkedin";
import { ingestX } from "./x";
import type { ContentItem } from "../content/schema";
import { isLiveSocialKey } from "./origins";
import type { SourceRunNote } from "./source-health";
import { sourceBackoffNote, sourceIsInBackoff, sourceNote } from "./source-health";
import { ingestSocialEvidence, type SocialEvidenceCandidate, type SocialEvidenceEditorContext } from "./social-evidence";
import type { D1DatabaseLike } from "./persistence";

export type IngestEnv = {
  X_BEARER_TOKEN?: string;
  LINKEDIN_TOKEN?: string;
  VALLEY_DESK_DB?: D1DatabaseLike;
  sourceHealth?: ReadonlyMap<string, import("./source-health").PersistedSourceHealth>;
};

export type SocialRun = {
  items: ContentItem[];
  linkedin: { count: number; skipped?: string };
  x: { count: number; skipped?: string };
  grok: { count: number; pending: number; quarantined?: number; skipped?: string };
  processedPackets: SocialEvidenceCandidate[];
  editorEvidence: ReadonlyMap<string, SocialEvidenceEditorContext>;
  sources: SourceRunNote[];
};

async function consumeSocialEvidence(env: IngestEnv, now: Date) {
  if (!env.VALLEY_DESK_DB) {
    return {
      items: [] as ContentItem[], pending: 0, processed: [] as SocialEvidenceCandidate[],
      quarantined: 0,
      skipped: "no-database",
      editorEvidence: new Map<string, SocialEvidenceEditorContext>(),
      sources: [] as SourceRunNote[],
    };
  }
  if (sourceIsInBackoff(env.sourceHealth?.get("grok-social-evidence"), now)) {
    return {
      items: [] as ContentItem[], pending: 0, processed: [] as SocialEvidenceCandidate[],
      quarantined: 0,
      editorEvidence: new Map<string, SocialEvidenceEditorContext>(),
      sources: [sourceBackoffNote(
        "grok-social-evidence", "grok-social-evidence", "social", now.toISOString(),
        env.sourceHealth?.get("grok-social-evidence"),
      )],
    };
  }
  try {
    return await ingestSocialEvidence(env.VALLEY_DESK_DB, now);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim().slice(0, 240);
    return {
      items: [] as ContentItem[], pending: 0, processed: [] as SocialEvidenceCandidate[],
      quarantined: 0,
      skipped: "source-error",
      editorEvidence: new Map<string, SocialEvidenceEditorContext>(),
      sources: [sourceNote({
        id: "grok-social-evidence",
        origin: "grok-social-evidence",
        type: "social",
        state: "upstream-failed",
        checkedAt: now.toISOString(),
        error: message || "Social evidence consumer error",
        consecutiveFailures: (env.sourceHealth?.get("grok-social-evidence")?.consecutiveFailures ?? 0) + 1,
        lastSuccessAt: env.sourceHealth?.get("grok-social-evidence")?.lastSuccessAt ?? null,
      })],
    };
  }
}

/** LI + X only. Never RSS. Review-only. Jane Doe is not a live key. */
export async function ingestSocial(
  env: IngestEnv = {},
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<SocialRun> {
  const [linkedin, x, grok] = await Promise.all([
    ingestLinkedIn(env, now, fetchImpl),
    ingestX(env, now, fetchImpl),
    consumeSocialEvidence(env, now),
  ]);
  const items = [...linkedin.items, ...x.items, ...grok.items].filter((item) => isLiveSocialKey(item.id) && item.slug !== "cio-note-workforce-ai");
  return {
    items,
    linkedin: { count: linkedin.items.length, skipped: linkedin.skipped },
    x: { count: x.items.length, skipped: x.skipped },
    grok: {
      count: grok.items.length,
      pending: grok.pending,
      quarantined: grok.quarantined,
      ...("skipped" in grok && grok.skipped ? { skipped: grok.skipped } : {}),
    },
    processedPackets: grok.processed,
    editorEvidence: grok.editorEvidence,
    sources: [...linkedin.sources, ...x.sources, ...grok.sources],
  };
}
