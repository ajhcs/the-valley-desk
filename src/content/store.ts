import { ContentCatalog, ContentItem as ContentItemSchema, type ContentItem } from "./schema";
import { Entity } from "./entity";
import { mergePublishedOverlay } from "./merge";
import fixtures from "./published-catalog.json";
import entityFixtures from "../../fixtures/entities.json";

export function loadCatalog(): ContentItem[] {
  const staticItems = ContentCatalog.parse(fixtures);
  const runtime = typeof globalThis !== "undefined"
    ? (globalThis as typeof globalThis & { __VALLEY_DESK_DYNAMIC_ITEMS__?: unknown }).__VALLEY_DESK_DYNAMIC_ITEMS__
    : undefined;
  const withdrawn = typeof globalThis !== "undefined"
    ? (globalThis as typeof globalThis & { __VALLEY_DESK_WITHDRAWN_IDS__?: unknown }).__VALLEY_DESK_WITHDRAWN_IDS__
    : undefined;
  const withdrawnIds = Array.isArray(withdrawn)
    ? withdrawn.filter((id): id is string => typeof id === "string")
    : [];
  if (!Array.isArray(runtime)) return mergePublishedOverlay(staticItems, [], withdrawnIds);
  const dynamicItems: ContentItem[] = [];
  for (const raw of runtime) {
    const parsed = ContentItemSchema.safeParse(raw);
    if (!parsed.success) continue;
    dynamicItems.push(parsed.data);
  }
  return mergePublishedOverlay(staticItems, dynamicItems, withdrawnIds);
}

export function loadEntities(): Entity[] {
  return Entity.array().parse(entityFixtures);
}
