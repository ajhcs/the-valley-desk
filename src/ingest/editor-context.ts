import type { ContentItem } from "../content/schema";

export type EditorContextItem = {
  id: string;
  publishedAt?: string;
  title: string;
  summary: string;
  sourceUrl: string;
};

/** Prior published coverage is bounded, local, and cited before it reaches the editor model. */
export function editorContextForItem(
  item: ContentItem,
  published: readonly ContentItem[],
  limit = 4,
): EditorContextItem[] {
  const orgs = new Set(item.orgs);
  if (!orgs.size) return [];
  return published
    .filter((candidate) =>
      candidate.id !== item.id
      && candidate.status === "published"
      && candidate.source.url
      && candidate.source.url !== item.source.url
      && candidate.orgs.some((id) => orgs.has(id))
      && candidate.kind !== "event",
    )
    .sort((a, b) => (b.publishedAt ?? b.updatedAt).localeCompare(a.publishedAt ?? a.updatedAt))
    .slice(0, Math.max(0, limit))
    .map((candidate) => ({
      id: candidate.id,
      publishedAt: candidate.publishedAt,
      title: candidate.title,
      summary: candidate.impactSentence?.trim() || candidate.dek.trim(),
      sourceUrl: candidate.source.url!,
    }));
}
