import { ContentItem } from "./schema";
import fixtures from "../../fixtures/catalog.json";

export function loadCatalog(): ContentItem[] {
  return ContentItem.array().parse(fixtures);
}
