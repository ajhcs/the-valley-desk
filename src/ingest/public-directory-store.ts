import {
  createDirectoryCatalog,
  directoryCatalog,
  type DirectoryCatalog,
  type DirectoryProject,
} from "./public-directory-data";
import { rows, type ResearchDb } from "./public-directory-research";

export const projectRecordsSql = "SELECT id,record FROM research_listings WHERE kind='project'";
type StoredProject = { id: string; record: string };
const catalogs = new WeakMap<ResearchDb, { version: string; catalog: DirectoryCatalog }>();

function decodeProject(row: StoredProject): DirectoryProject {
  const project = JSON.parse(row.record);
  if (!project || project.id !== row.id || typeof project.code !== "string" || typeof project.name !== "string") {
    throw new Error("Invalid stored project");
  }
  return project;
}

export async function readProjectCatalog(db: ResearchDb, version?: string) {
  const current = catalogs.get(db);
  if (version && current?.version === version) return { catalog: current.catalog, fallback: false, cached: true };
  try {
    const records = await rows<StoredProject>(db, projectRecordsSql);
    const catalog = createDirectoryCatalog(records.map(decodeProject));
    if (version) catalogs.set(db, { version, catalog });
    return { catalog, fallback: false, cached: false };
  } catch {
    console.warn("directory_project_catalog_unavailable");
    return { catalog: directoryCatalog, fallback: true, cached: false };
  }
}

export async function readProject(db: ResearchDb, id: string, removed: Set<string>) {
  if (removed.has(id)) return { project: undefined, fallback: false };
  try {
    const [row] = await rows<StoredProject>(db, projectRecordsSql + " AND id=?", id);
    return { project: row ? decodeProject(row) : undefined, fallback: false };
  } catch {
    console.warn("directory_project_record_unavailable");
    return { project: directoryCatalog.project(id, removed), fallback: true };
  }
}
