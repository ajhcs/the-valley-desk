import { loadEntities } from "../content/store";
import { entityIndex } from "../content/entity";

export const entities = loadEntities();
export const entityLookup = entityIndex(entities);
