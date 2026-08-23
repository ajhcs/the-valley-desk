import { ContentCatalog, type ContentItem } from "./schema";
import { Entity } from "./entity";
import fixtures from "./published-catalog.json";
import entityFixtures from "../../fixtures/entities.json";

export function loadCatalog(): ContentItem[] {
  return ContentCatalog.parse(fixtures);
}

export function loadEntities(): Entity[] {
  return Entity.array().parse(entityFixtures);
}
