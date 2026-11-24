import { rows, type ResearchDb } from "./public-directory-research";
import type { RegionalData } from "./regional-data-contract";

type RegionalPaper = { id: string; title: string };
export type PublicRegionalData = RegionalData & { metadata_reviewed: string; papers: RegionalPaper[] };

export async function regionalDataEnabled(db?: ResearchDb): Promise<boolean> {
  if (!db) return false;
  try {
    return (await rows<{ enabled: number }>(db, "SELECT enabled FROM regional_data_visibility WHERE id=1"))[0]?.enabled === 1;
  } catch {
    return false;
  }
}

/** Call with records selected from research_visible. Operational review evidence stays private. */
export async function regionalDataRecords(db: ResearchDb, records: RegionalData[]): Promise<PublicRegionalData[]> {
  if (!records.length) return [];
  const ids = JSON.stringify(records.map(({ id }) => id));
  const [checks, links] = await Promise.all([
    rows<{ id: string; checked: string }>(db, `SELECT id,checked FROM regional_data_checks
      WHERE id IN (SELECT value FROM json_each(?)) AND checked IS NOT NULL`, ids),
    rows<RegionalPaper & { dataset_id: string }>(db, `SELECT l.dataset_id,v.id,v.title
      FROM regional_data_publications l JOIN research_visible v ON v.id=l.paper_id
      WHERE l.dataset_id IN (SELECT value FROM json_each(?)) AND v.kind='publication'
      AND COALESCE(json_extract(v.record,'$.retracted'),0)=0
      ORDER BY l.dataset_id,v.title COLLATE NOCASE,v.id`, ids),
  ]);
  const checkedById = new Map(checks.map(({ id, checked }) => [id, checked]));
  const papersById = new Map<string, RegionalPaper[]>();
  for (const { dataset_id, id, title } of links) {
    const papers = papersById.get(dataset_id) ?? [];
    papers.push({ id, title });
    papersById.set(dataset_id, papers);
  }
  return records.map((record) => {
    const checked = checkedById.get(record.id);
    return {
      ...record,
      metadata_reviewed: record.checked,
      checked: checked && checked > record.checked ? checked : record.checked,
      papers: papersById.get(record.id) ?? [],
    };
  });
}

export async function regionalDataRecord(db: ResearchDb, record: RegionalData): Promise<PublicRegionalData> {
  return (await regionalDataRecords(db, [record]))[0]!;
}
