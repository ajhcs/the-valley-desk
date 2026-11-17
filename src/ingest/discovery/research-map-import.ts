import { z } from 'zod';

export function verifyIntakeOutput(actual: { sha256: string; bytes: number }, expected: { sha256: string; bytes: number }) {
  if (!/^[a-f0-9]{64}$/.test(expected.sha256) || actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw new Error('Intake output hash or byte count mismatch');
}
const validDay = (value: string) => { const date = new Date(`${value}T00:00:00.000Z`); return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value; };

// This private intake never supplies publication authority or asserts institutional ownership.
export const NativeRepositorySchema = z.object({
  nativeId: z.string().regex(/^[1-9]\d*$/), url: z.string().url(), fork: z.boolean(), archived: z.boolean(),
}).passthrough();
export type UrlKind = 'repository-url' | 'account-url' | 'file-path-reference' | 'invalid-fragment';
// These are GitHub navigation routes, not account namespaces. Keeping them out
// prevents publication mentions of topic/search/org pages becoming fake work.
const githubRoutes = new Set(['about', 'account', 'apps', 'collections', 'contact', 'customer-stories', 'enterprise', 'events', 'explore', 'features', 'issues', 'join', 'login', 'marketplace', 'new', 'notifications', 'orgs', 'organizations', 'pricing', 'pulls', 'readme', 'search', 'security', 'sessions', 'settings', 'site', 'solutions', 'sponsors', 'topics', 'trending', 'users']);
export function classifyGithubUrl(value: string): { kind: UrlKind; accountKey: string | null; repositoryKey: string | null } {
  const invalid = { kind: 'invalid-fragment' as const, accountKey: null, repositoryKey: null };
  let url: URL;
  try { url = new URL(value); } catch { return invalid; }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.port || url.search || url.hash) return invalid;
  if (url.pathname.includes('//')) return invalid;
  const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (!parts.length || parts.some(p => !/^[A-Za-z0-9_.-]+$/.test(p)) || ['.', '..'].some(p => parts.includes(p))) return invalid;
  const accountKey = parts[0].toLowerCase();
  if (githubRoutes.has(accountKey)) return invalid;
  if (parts.length === 1) return { kind: 'account-url', accountKey, repositoryKey: null };
  const repositoryKey = `${accountKey}/${parts[1].toLowerCase()}`;
  return { kind: parts.length === 2 ? 'repository-url' : 'file-path-reference', accountKey, repositoryKey };
}

const ExistingSchema = z.object({ publicationAuthorized: z.literal(false), accounts: z.array(z.object({ key: z.string(), url: z.string().url() }).passthrough()), repositories: z.array(z.object({ key: z.string(), url: z.string().url() }).passthrough()) }).passthrough();
const CensusSchema = z.object({ accounts: z.array(z.object({ handle: z.string(), status: z.enum(['observed', 'failed']), repositories: z.array(NativeRepositorySchema) }).passthrough()) }).passthrough();
const PairsSchema = z.array(z.object({ articleId: z.string().min(1), url: z.string().min(1).nullable() }).passthrough());
export function mergeResearchMap(existingInput: unknown, censusInput: unknown, pairInput: unknown) {
  const existing = ExistingSchema.parse(existingInput), census = CensusSchema.parse(censusInput), pairs = PairsSchema.parse(pairInput);
  const accounts = new Map<string, { key: string; existing: boolean; censusStatus: string | null; nativeRepositoryCount: number }>();
  const repos = new Map<string, { key: string; nativeId: string | null; existing: boolean; fork: boolean | null; archived: boolean | null }>();
  const idToAlias = new Map<string, string>();
  for (const account of existing.accounts) {
    const parsed = classifyGithubUrl(account.url);
    if (parsed.kind !== 'account-url' || parsed.accountKey !== account.key.toLowerCase() || accounts.has(parsed.accountKey)) throw new Error('Conflicting existing account');
    accounts.set(parsed.accountKey, { key: parsed.accountKey, existing: true, censusStatus: null, nativeRepositoryCount: 0 });
  }
  for (const repository of existing.repositories) {
    const parsed = classifyGithubUrl(repository.url);
    if (parsed.kind !== 'repository-url' || parsed.repositoryKey !== repository.key.toLowerCase() || repos.has(parsed.repositoryKey)) throw new Error('Conflicting existing repository');
    repos.set(parsed.repositoryKey, { key: parsed.repositoryKey, nativeId: null, existing: true, fork: null, archived: null });
  }
  const censusSeen = new Set<string>();
  for (const account of census.accounts) {
    const key = account.handle.toLowerCase();
    if (!/^[a-z0-9-]+$/.test(key) || censusSeen.has(key)) throw new Error('Duplicate or invalid census account');
    censusSeen.add(key);
    if (account.status === 'failed' && account.repositories.length) throw new Error('Failed account has repositories');
    const current = accounts.get(key) ?? { key, existing: false, censusStatus: null, nativeRepositoryCount: 0 };
    current.censusStatus = account.status; current.nativeRepositoryCount = account.repositories.length; accounts.set(key, current);
    for (const repository of account.repositories) {
      const url = classifyGithubUrl(repository.url);
      if (url.kind !== 'repository-url' || url.accountKey !== key) throw new Error('Repository namespace mismatch');
      const alias = url.repositoryKey!, previousAlias = idToAlias.get(repository.nativeId), previous = repos.get(alias);
      if (previousAlias || previous?.nativeId) throw new Error('Duplicate or conflicting native repository ID or alias');
      idToAlias.set(repository.nativeId, alias);
      repos.set(alias, { key: alias, nativeId: repository.nativeId, existing: previous?.existing ?? false, fork: repository.fork, archived: repository.archived });
    }
  }
  const seenPairs = new Set<string>();
  const publicationQueue = pairs.map((pair, index) => {
    const pairKey = JSON.stringify([pair.articleId, pair.url, pair.url === null ? pair.withheldUrlSha256 : null]);
    if (seenPairs.has(pairKey)) throw new Error('Duplicate article/URL pair');
    seenPairs.add(pairKey);
    return { articleId: pair.articleId, url: pair.url, sourceIndex: index, ...(pair.url === null ? { kind: 'invalid-fragment' as const, accountKey: null, repositoryKey: null } : classifyGithubUrl(pair.url)), relationship: 'unknown', review: 'unreviewed', publicationAuthorized: false };
  });
  const compare = (a: { key: string }, b: { key: string }) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  const accountList = [...accounts.values()].sort(compare), repositoryList = [...repos.values()].sort(compare);
  return { schemaVersion: 1, publicationAuthorized: false, counts: { accounts: accountList.length, repositories: repositoryList.length, nativeObservedRepositories: repositoryList.filter(r => r.nativeId !== null).length, urlOnlyRepositories: repositoryList.filter(r => r.nativeId === null).length, matchedExistingAccounts: accountList.filter(a => a.existing && a.censusStatus !== null).length, matchedExistingRepositories: repositoryList.filter(r => r.existing && r.nativeId !== null).length, publicationPairs: publicationQueue.length }, accounts: accountList, repositories: repositoryList, publicationQueue };
}

const DateInstant = z.string().datetime({ offset: true }).nullable();
const httpsUrl = z.string().url().refine(u => new URL(u).protocol === 'https:');
const SourceContext = z.object({ groupLabel: z.string().min(1), associationKind: z.enum(['lab-branded', 'personal-project', 'historical', 'self-reported', 'broad-institution', 'external-collaboration', 'unresolved']), qualification: z.string().min(1), evidenceUrls: z.array(httpsUrl), researchReportPointer: z.string().regex(/^README\.md:L\d+(?:-L\d+)?$/), currentAffiliationVerified: z.literal(false), status: z.literal('user-supplied research-report context; not independently verified primary truth') }).strict();
const SourceRepo = z.object({ id: z.number().int().positive().safe(), fullName: z.string().min(3), url: httpsUrl, fork: z.boolean(), archived: z.boolean(), createdAt: DateInstant, updatedAt: DateInstant, pushedAt: DateInstant, sourcePointer: z.string().startsWith('/'), reportedDescription: z.string().nullable(), spdxId: z.string().nullable() }).strict();
export const AccountEvidenceSchema = z.object({ schemaVersion: z.literal('jefferson-account-evidence-v1'), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), observedDate: z.string().refine(validDay), evidenceStatus: z.string(), accounts: z.array(z.object({ handle: z.string(), status: z.enum(['success', 'failed']), reportedRepositoryCount: z.number().int().nonnegative().nullable(), repositories: z.array(SourceRepo).nullable(), failure: z.string().nullable(), sourcePointer: z.string().startsWith('/'), reportedCategory: z.string(), reportedEvidenceUrls: z.array(httpsUrl), context: z.string(), reportedContext: SourceContext.nullable() }).strict()) }).strict();
export const PublicationLinksSchema = z.object({ schemaVersion: z.literal('jefferson-publication-links-v1'), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), occurrenceSourceSha256: z.string().regex(/^[a-f0-9]{64}$/), observedDate: z.string().refine(validDay), status: z.string(), rows: z.array(z.object({ rowId: z.string().min(1), articleId: z.string().regex(/^PMC[1-9]\d*$/), url: z.string().nullable(), mechanicalFlags: z.object({ firstAuthorMentionsJefferson: z.boolean(), anyAuthorMentionsJefferson: z.boolean(), availabilityLanguage: z.boolean() }).strict(), sourceRow: z.number().int().positive(), withheldUrlSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(), urlDisposition: z.string(), targetShape: z.string(), sourceOccurrences: z.array(z.object({ jsonlRecord: z.number().int().positive(), linkIndex: z.number().int().nonnegative() }).strict()), occurrenceCount: z.number().int().positive(), sourceRowMeaning: z.string(), reviewStatus: z.literal('unreviewed') }).strict()) }).strict();
export const BibliographicMetadataSchema = z.object({ schemaVersion: z.literal('jefferson-bibliographic-metadata-v1'), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), observedDate: z.string().refine(validDay), recordStatus: z.string(), articles: z.array(z.object({ articleId: z.string().regex(/^PMC[1-9]\d*$/), pmid: z.string().nullable(), doi: z.string().nullable(), title: z.string(), reportedFirstPublicationDate: z.string().nullable(), publicationUrl: httpsUrl, sourcePointer: z.string().startsWith('/'), status: z.literal('unreviewed') }).strict()) }).strict();
export function importSanitizedResearchMap(existing: unknown, accountInput: unknown, publicationInput: unknown) {
  const account = AccountEvidenceSchema.parse(accountInput), publications = PublicationLinksSchema.parse(publicationInput);
  const rowIds = new Set<string>();
  for (const row of publications.rows) {
    if (row.occurrenceCount !== row.sourceOccurrences.length) throw new Error('Publication occurrence count mismatch');
    if (row.url === null && !row.withheldUrlSha256) throw new Error('Withheld URL requires hash');
    if (rowIds.has(row.rowId)) throw new Error('Duplicate publication row ID');
    rowIds.add(row.rowId);
  }
  const adapted = account.accounts.map(a => {
    if ((a.status === 'success') !== (a.repositories !== null) || (a.status === 'success' ? a.repositories?.length !== a.reportedRepositoryCount : a.reportedRepositoryCount !== null)) throw new Error('Account status or reported repository count mismatch');
    const repositories = (a.repositories ?? []).map(r => {
      const parsed = classifyGithubUrl(r.url);
      if (parsed.repositoryKey !== r.fullName.toLowerCase()) throw new Error('Native repository URL/full name mismatch');
      return { nativeId: String(r.id), url: r.url, fork: r.fork, archived: r.archived };
    });
    return { handle: a.handle, status: a.status === 'success' ? 'observed' : 'failed', repositories };
  });
  const result = mergeResearchMap(existing, { accounts: adapted }, publications.rows);
  return { ...result, censusObservationDate: account.observedDate, sourceAccounts: account.accounts, publicationQueue: result.publicationQueue.map((row, index) => ({ ...row, rowId: publications.rows[index].rowId, mechanicalFlags: publications.rows[index].mechanicalFlags, sourceRow: publications.rows[index].sourceRow, sourceOccurrences: publications.rows[index].sourceOccurrences, ...(publications.rows[index].url === null ? { withheldReason: 'unsafe URL withheld', urlSha256: publications.rows[index].withheldUrlSha256 ?? null } : {}) })) };
}
