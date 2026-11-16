import { z } from 'zod';
import { DirectorySnapshotSchema, type DirectorySnapshot, type DirectoryWork } from '../content/discovery-directory';

// A bounded read of the reviewed snapshot. No private review input is accepted here.
const Query = z.object({
  q: z.string().max(200).default(''),
  kind: z.enum(['repository', 'publication', 'preprint', 'discussion', 'project']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  after: z.string().min(1).max(2000).optional(),
}).strict();
export type DirectoryQuery = z.infer<typeof Query>;
export function parseDirectoryQuery(params: URLSearchParams): DirectoryQuery {
  if (params.toString().length > 4096) throw new Error('directory-query-size');
  const raw: Record<string, string> = Object.create(null);
  for (const [key, value] of params) {
    if (!['q', 'kind', 'limit', 'after'].includes(key) || Object.hasOwn(raw, key)) throw new Error('directory-query-key');
    raw[key] = value;
  }
  if (raw.limit !== undefined && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(raw.limit)) throw new Error('directory-query-limit');
  return Query.parse(raw);
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const fold = (s: string) => s.normalize('NFKC').toLowerCase();
function text(work: DirectoryWork): string {
  return fold([work.title.value, work.url.value, work.description?.value ?? '', work.owner?.name ?? '', work.nativeIdentity?.nativeId ?? '', ...work.claims.flatMap(c => c.kind === 'health-purpose' ? [c.text] : c.kind === 'topic' ? [c.topic] : [c.institution ?? '', c.campus ?? '', c.municipality ?? '', c.county ?? '', c.state, c.subjectLabel])].join(' '));
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function snapshotDigest(snapshot: DirectorySnapshot): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(snapshot)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export async function readDirectoryList(input: unknown, queryInput: unknown) {
  const snapshot: DirectorySnapshot = DirectorySnapshotSchema.parse(input);
  const query = Query.parse(queryInput);
  const snapshotSha256 = await snapshotDigest(snapshot);
  const terms = fold(query.q).trim().split(/\s+/u).filter(Boolean);
  const ordered = snapshot.works.filter(work => (!query.kind || work.kind === query.kind) && terms.every(term => text(work).includes(term))).sort((a, b) => compare(a.id, b.id));
  // An unrecognised position is an error, never a silent restart.
  let start = 0;
  if (query.after) {
    let cursor: unknown;
    try { cursor = JSON.parse(decodeURIComponent(query.after)); } catch { throw new Error('directory-cursor-invalid'); }
    const parsed = z.tuple([z.string(), z.string(), z.string(), z.number(), z.string()]).safeParse(cursor);
    if (!parsed.success || parsed.data[0] !== snapshotSha256 || parsed.data[1] !== query.q || parsed.data[2] !== (query.kind ?? '') || parsed.data[3] !== query.limit) throw new Error('directory-cursor-restart');
    start = ordered.findIndex(work => work.id === parsed.data[4]) + 1;
    if (!start) throw new Error('directory-cursor-restart');
  }
  const items = ordered.slice(start, start + query.limit);
  return { schemaVersion: 'discovery-directory-list-v1' as const, snapshotVersion: snapshot.version, snapshotSha256, totalWorks: snapshot.works.length, matchingWorks: ordered.length, items, nextAfter: start + items.length < ordered.length ? encodeURIComponent(JSON.stringify([snapshotSha256, query.q, query.kind ?? '', query.limit, items.at(-1)!.id])) : null };
}
export function readDirectoryDetail(input: unknown, id: string) {
  const snapshot = DirectorySnapshotSchema.parse(input);
  if (!/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,199}$/.test(id)) throw new Error('directory-id');
  return snapshot.works.find(work => work.id === id) ?? null;
}
