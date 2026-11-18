import { DirectoryIdSchema, readDirectorySnapshot, type DirectoryView } from '../content/discovery-directory';

// Public query/read boundary; private review inputs are never imported here.
export { parseDirectoryQuery, readDirectoryList } from './discovery-directory-search';
export type { DirectoryQuery, DirectorySearchResult } from './discovery-directory-search';
export function readDirectoryDetail(input: unknown, id: string, view: DirectoryView = 'release') {
  const snapshot = readDirectorySnapshot(input, view);
  if (!DirectoryIdSchema.safeParse(id).success) throw new Error('directory-id');
  return snapshot.works.find(work => work.id === id) ?? null;
}
