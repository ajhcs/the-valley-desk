import { Kind, type ContentItem } from "../content/schema";
import { canonicalPath } from "../lib/canonical";
import type { D1DatabaseLike } from "./persistence";

/** Presentation-only repair. Never rename an identity or a published path. */
export async function normalizeReviewSlugs(db: D1DatabaseLike, items: ContentItem[], published: ContentItem[]) {
  const changed: ContentItem[] = [];
  const collisions: string[] = [];
  let checked = 0;
  const normalized = await Promise.all(items.map(async (item) => {
    if (!(item.id.startsWith("official-ofs-") || item.kind === "event") || !/-$/.test(item.slug)) return item;
    const slug = item.slug.replace(/-+$/g, "");
    if (!slug || slug.length > 72) return item;
    if (checked++ >= 24) return item;
    const eligible = await db.prepare(`SELECT id FROM content_candidates
      WHERE id = ? AND queue_status = 'review'
      AND NOT EXISTS (SELECT 1 FROM published_content WHERE candidate_id = ?)`)
      .bind(item.id, item.id).first();
    if (!eligible) return item;
    const path = canonicalPath({ ...item, slug });
    const kinds = Kind.options.filter(kind => canonicalPath({ kind, slug }) === path);
    const placeholders = kinds.map(() => "?").join(",");
    const collision = published.some((other) => other.id === item.id || canonicalPath(other) === path
      || (other.previousSlugs ?? []).some(previous => canonicalPath({ ...other, slug: previous }) === path))
      || items.some((other) => other.id !== item.id && canonicalPath({ ...other, slug: other.slug.replace(/-+$/g, "") }) === path)
      || await db.prepare(`SELECT id FROM content_candidates WHERE id <> ? AND kind IN (${placeholders})
        AND rtrim(json_extract(content_json, '$.slug'), '-') = ?
        UNION ALL SELECT candidate_id FROM published_content WHERE candidate_id <> ?
        AND kind IN (${placeholders}) AND slug = ?
        UNION ALL SELECT candidate_id FROM content_slug_aliases WHERE kind IN (${placeholders}) AND alias_slug = ? LIMIT 1`)
        .bind(item.id, ...kinds, slug, item.id, ...kinds, slug, ...kinds, slug).first();
    if (collision) { collisions.push(item.id); return item; }
    const corrected = { ...item, slug };
    changed.push(corrected);
    return corrected;
  }));
  return { items: normalized, changed, collisions };
}
