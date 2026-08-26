import type { Entity } from "../content/entity";
import type { ContentItem } from "../content/schema";
import { itemOrgGraph } from "./entityFacts";

const SKIP_TOPICS = new Set(["product-watch", "events"]);

function norm(value: string) {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}

function topicSet(item: ContentItem) {
  return new Set(item.topics.map(norm).filter((topic) => topic && !SKIP_TOPICS.has(topic)));
}

/** Distinctive project tokens already present in title/topics — never inferred vendors. */
export function projectTokens(item: Pick<ContentItem, "title" | "topics" | "slug">) {
  const hay = norm(`${item.title} ${item.topics.join(" ")} ${item.slug}`);
  const tokens: string[] = [];
  for (const token of [
    "epic",
    "mychart",
    "dragon",
    "copilot",
    "orca",
    "scribe",
    "ambient",
    "340b",
    "cms 0057",
    "hitrust",
    "honor roll",
  ]) {
    if (hay.includes(token)) tokens.push(token);
  }
  return tokens;
}

function sharedCount(a: Iterable<string>, b: ReadonlySet<string>) {
  let n = 0;
  for (const value of a) {
    if (b.has(value)) n += 1;
  }
  return n;
}

function recency(item: ContentItem) {
  return item.publishedAt ?? item.updatedAt;
}

/**
 * Same-desk related rows from shared org graph, topics, or project tokens.
 * Does not read relatedEventIds/relatedVoiceIds and does not invent links.
 */
export function relatedItems(
  item: ContentItem,
  catalog: readonly ContentItem[],
  entities: readonly Entity[],
  n = 4,
): ContentItem[] {
  const orgs = itemOrgGraph(item, entities);
  const topics = topicSet(item);
  const projects = new Set(projectTokens(item));
  const scored: { item: ContentItem; score: number }[] = [];

  for (const other of catalog) {
    if (other.id === item.id || other.status !== "published") continue;
    const otherOrgs = itemOrgGraph(other, entities);
    const orgScore = sharedCount(orgs, otherOrgs);
    const topicScore = sharedCount(topicSet(other), topics);
    const projectScore = sharedCount(projectTokens(other), projects);
    if (!orgScore && !topicScore && !projectScore) continue;
    const kindBonus = other.kind === item.kind ? 1 : 0;
    scored.push({
      item: other,
      score: orgScore * 3 + topicScore * 2 + projectScore * 4 + kindBonus,
    });
  }

  return scored
    .sort((a, b) => b.score - a.score || recency(b.item).localeCompare(recency(a.item)) || a.item.id.localeCompare(b.item.id))
    .slice(0, n)
    .map((row) => row.item);
}
