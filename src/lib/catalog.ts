import { loadCatalog, loadEntities } from "../content/store";
import { bindSeedOrgIds } from "../content/queries";
import { liveSeedOrgIds } from "../content/seed";

bindSeedOrgIds(liveSeedOrgIds(loadEntities()));

export const catalog = loadCatalog();
