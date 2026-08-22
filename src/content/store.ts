import { ContentItem } from "./schema";
import { Entity } from "./entity";
import fixtures from "../../fixtures/catalog.json";
import entityFixtures from "../../fixtures/entities.json";

export function loadCatalog(): ContentItem[] {
  return ContentItem.array().parse(fixtures);
}

export function loadEntities(): Entity[] {
  return Entity.array().parse(entityFixtures);
}
