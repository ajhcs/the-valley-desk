import { DirectoryIdSchema, DirectorySnapshotSchema } from '../content/discovery-directory';

// Public query/read boundary; private review inputs are never imported here.
export { parseDirectoryQuery, readDirectoryList } from './discovery-directory-search';
export type { DirectoryQuery, DirectorySearchResult } from './discovery-directory-search';
export function readDirectoryDetail(input: unknown, id: string) {
  const snapshot = DirectorySnapshotSchema.parse(input);
  if (!DirectoryIdSchema.safeParse(id).success) throw new Error('directory-id');
  return snapshot.works.find(work => work.id === id) ?? null;
}
