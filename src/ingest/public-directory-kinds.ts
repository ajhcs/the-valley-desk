/** Which kinds of listing are public right now. The directory handler reads this once per request; pages
 *  rendered outside it (support, suggest, connect, error pages) read it through directoryNav, so every
 *  masthead offers the same sections and a hidden kind appears in none of them. */
import { rows, type ResearchDb } from "./public-directory-research";
import { regionalDataEnabled } from "./regional-data-read";
import type { DirectoryNav } from "./public-directory-page";

export type DirectoryKinds = {
  hasPubs: boolean; hasStudies: boolean; hasDatasets: boolean; hasRegionalData: boolean;
  /** The regional data switch alone, which still governs removal notices when no record is visible. */
  regionalEnabled?: boolean;
};

/** Reads an optional table added after the core schema; a database without it reads as empty. */
export async function optionalRows<T>(db: ResearchDb, sql: string, ...args: string[]): Promise<T[]> {
  try {
    return await rows<T>(db, sql, ...args);
  } catch (error) {
    if (/no such table/i.test(String(error))) return [];
    throw error;
  }
}

/** One indexed probe per kind, each stopping at its first row. Pass a db that already applies the
 *  publications switch to research_visible. */
export async function readKinds(db: ResearchDb, publicationsEnabled: boolean): Promise<DirectoryKinds> {
  let hasPubs = false, hasStudies = false, hasDatasets = false;
  if (publicationsEnabled) {
    try {
      const [visible] = await rows<{
        publications: number; studies: number; datasets: number; regionalEnabled: number; regionalData: number;
      }>(
        db,
        `SELECT
          EXISTS(SELECT 1 FROM research_visible WHERE kind='publication') publications,
          EXISTS(SELECT 1 FROM research_visible WHERE kind='study') studies,
          CASE WHEN (SELECT enabled FROM dataset_visibility WHERE id=1)=1
            THEN EXISTS(SELECT 1 FROM research_visible WHERE kind='dataset') ELSE 0 END datasets,
          coalesce((SELECT enabled FROM regional_data_visibility WHERE id=1),0) regionalEnabled,
          CASE WHEN (SELECT enabled FROM regional_data_visibility WHERE id=1)=1
            THEN EXISTS(SELECT 1 FROM research_visible WHERE kind='regional-data') ELSE 0 END regionalData`,
      );
      if (visible) {
        return {
          hasPubs: visible.publications === 1,
          hasStudies: visible.studies === 1,
          hasDatasets: visible.datasets === 1,
          regionalEnabled: visible.regionalEnabled === 1,
          hasRegionalData: visible.regionalData === 1,
        };
      }
    } catch (error) {
      if (!/no such table/i.test(String(error))) throw error;
      // Older schemas can lack the optional visibility tables.
    }
    hasPubs = (await rows(db, "SELECT id FROM research_visible WHERE kind='publication' LIMIT 1")).length > 0;
    // The dataset switch is read first, so a hidden collection costs no listing reads. A database
    // without migration 0050 has no switch and no datasets.
    const [visible] = await optionalRows<{ studies: number; datasets: number }>(
      db,
      "SELECT EXISTS(SELECT 1 FROM research_visible WHERE kind='study') studies,CASE WHEN (SELECT enabled FROM dataset_visibility WHERE id=1)=1 THEN EXISTS(SELECT 1 FROM research_visible WHERE kind='dataset') ELSE 0 END datasets",
    );
    hasStudies = visible
      ? visible.studies === 1
      : (await rows(db, "SELECT id FROM research_visible WHERE kind='study' LIMIT 1")).length > 0;
    hasDatasets = visible?.datasets === 1;
  }
  const regionalEnabled = await regionalDataEnabled(db);
  const hasRegionalData = regionalEnabled
    && (await rows(db, "SELECT id FROM research_visible WHERE kind='regional-data' LIMIT 1")).length > 0;
  return { hasPubs, hasStudies, hasDatasets, hasRegionalData, regionalEnabled };
}

export const navFor = (kinds: DirectoryKinds, at?: string): DirectoryNav => ({
  publications: kinds.hasPubs, studies: kinds.hasStudies, datasets: kinds.hasDatasets || kinds.hasRegionalData, at,
});

/** The masthead sections for a page rendered outside the directory handler. A missing or failing
 *  database offers only what never hides: software and the about page. */
export async function directoryNav(db: ResearchDb | undefined, publicationsEnabled: boolean): Promise<DirectoryNav> {
  if (!db) return {};
  try {
    return navFor(await readKinds(db, publicationsEnabled));
  } catch {
    return {};
  }
}
