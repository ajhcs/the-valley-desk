import { decodeDiscoveryMetadataJson } from './metadata-preflight';

// Private, operator-run staging only. Nothing here supplies public admission authority.
export const GITHUB_ENRICHMENT_REVISION = 'github-owned-metadata-v2';
export const ENRICHMENT_LIMITS = Object.freeze({
  perPage: 20, maxPagesPerAccount: 20, maxRequests: 55,
  maxBytesPerResponse: 256000, timeoutMs: 25000, maxElapsedMs: 1800000,
});
const fail = (code: string): never => { throw new Error(`github-enrichment:${code}`); };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('object');
  return value as Record<string, unknown>;
};
function text(value: unknown, max = 1000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return fail('text');
  return value;
}
function id(value: unknown): string {
  if (!Number.isSafeInteger(value) || (value as number) < 1) return fail('native-id');
  return String(value);
}
function instant(value: unknown): string {
  const v = text(value, 40);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v.replace('Z', '.000Z')) return fail('date');
  return v;
}
export type EnrichmentOwner = { nativeId: string; login: string; type: 'User' | 'Organization' };
export type EnrichedRepository = {
  nativeId: string; fullName: string; originalUrl: string; description: string | null;
  fork: boolean; archived: boolean; createdAt: string; updatedAt: string; pushedAt: string | null;
  owner: EnrichmentOwner; sourcePointer: string;
};
export function enrichmentUrl(login: string, page: number): string {
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login)) return fail('login');
  if (!Number.isSafeInteger(page) || page < 1 || page > ENRICHMENT_LIMITS.maxPagesPerAccount) return fail('page');
  return `https://api.github.com/users/${login}/repos?type=owner&sort=full_name&direction=asc&per_page=${ENRICHMENT_LIMITS.perPage}&page=${page}`;
}

function continuation(header: string | null, login: string, page: number, owner: EnrichmentOwner | null, count: number) {
  if (header !== null && (typeof header !== 'string' || header.length > 8192)) return fail('link');
  const expected = new URL(enrichmentUrl(login, page));
  const seen = new Set<string>();
  const relations = new Map<string, number>();
  const pathKinds = new Set<string>();
  let nextPage: number | null = null;
  for (const part of header?.split(/,\s*(?=<)/) ?? []) {
    const m = /^\s*<([^<>]+)>\s*;\s*rel="(next|prev|first|last)"\s*$/.exec(part);
    if (!m || seen.has(m[2])) return fail('link');
    seen.add(m[2]);
    let url: URL;
    try { url = new URL(m[1]); } catch { return fail('link'); }
    // GitHub can canonicalize this users route to /user/{id} for either owner kind.
    const nativeUserPath = owner ? `/user/${owner.nativeId}/repos` : null;
    const nativeOrgPath = owner?.type === 'Organization' ? `/organizations/${owner.nativeId}/repos` : null;
    if (url.origin !== expected.origin || url.username || url.password || url.hash ||
      ![expected.pathname, nativeUserPath, nativeOrgPath].includes(url.pathname)) return fail('link-scope');
    pathKinds.add(url.pathname === expected.pathname ? 'named-account' : url.pathname === nativeUserPath ? 'native-user' : 'native-organization');
    const entries = [...url.searchParams];
    if (new Set(entries.map(([k]) => k)).size !== entries.length || entries.length !== [...expected.searchParams].length) return fail('link-query');
    for (const [key, value] of entries) {
      if (key === 'page') continue;
      if (expected.searchParams.get(key) !== value) return fail('link-query');
    }
    const p = url.searchParams.get('page') ?? '';
    if (!/^[1-9]\d*$/.test(p) || !Number.isSafeInteger(Number(p))) return fail('link-page');
    relations.set(m[2], Number(p));
    if (m[2] === 'next') {
      if (Number(p) !== page + 1) return fail('link-sequence');
      nextPage = Number(p);
    }
  }
  if (relations.has('first') && relations.get('first') !== 1 ||
    relations.has('prev') && relations.get('prev') !== page - 1 ||
    relations.has('last') && relations.get('last')! < page ||
    relations.has('last') && relations.get('last')! > page && nextPage === null ||
    nextPage !== null && (count === 0 || relations.has('last') && nextPage > relations.get('last')!)) return fail('link-relations');
  if (nextPage !== null) return {
    state: page === ENRICHMENT_LIMITS.maxPagesPerAccount ? 'page-cap' as const : 'more' as const,
    nextPage: page === ENRICHMENT_LIMITS.maxPagesPerAccount ? null : nextPage,
    pathKinds: [...pathKinds].sort(),
  };
  // A full page without continuation does not establish exhaustion.
  return { state: count === 0 ? 'empty-unverified' as const : count === ENRICHMENT_LIMITS.perPage ? 'unknown' as const : owner ? 'complete' as const : 'empty-unverified' as const, nextPage: null, pathKinds: [...pathKinds].sort() };
}

export function inspectGithubEnrichmentPage(bytes: Uint8Array, login: string, page: number,
  responseLink: string | null, previousOwner: EnrichmentOwner | null = null) {
  enrichmentUrl(login, page);
  if (bytes.length > ENRICHMENT_LIMITS.maxBytesPerResponse) return fail('byte-cap');
  // Scan the complete transient representation, including unused fields, before projection.
  const raw = decodeDiscoveryMetadataJson(bytes, 'github', code => fail(`preflight-${code}`), 'inventory');
  if (!Array.isArray(raw) || raw.length > ENRICHMENT_LIMITS.perPage) return fail('page-shape');
  let owner = previousOwner;
  if (owner && owner.login.toLowerCase() !== login.toLowerCase()) return fail('owner-binding');
  const ids = new Set<string>();
  const repositories = raw.map((value, index): EnrichedRepository => {
    const row = object(value), account = object(row.owner);
    const nativeId = id(row.id), ownerId = id(account.id), ownerLogin = text(account.login, 39);
    if (!['User', 'Organization'].includes(account.type as string) || ownerLogin.toLowerCase() !== login.toLowerCase()) return fail('owner-binding');
    const currentOwner: EnrichmentOwner = { nativeId: ownerId, login: ownerLogin, type: account.type as EnrichmentOwner['type'] };
    if (owner && (owner.nativeId !== ownerId || owner.type !== currentOwner.type)) return fail('owner-change');
    owner = currentOwner;
    const name = text(row.name, 100), fullName = text(row.full_name, 140);
    if (!/^[a-z\d_.-]+$/i.test(name) || ['.', '..'].includes(name) || fullName !== `${ownerLogin}/${name}` || row.private !== false ||
      row.html_url !== `https://github.com/${fullName}` || row.url !== `https://api.github.com/repos/${fullName}`) return fail('repository-binding');
    if (ids.has(nativeId)) return fail('duplicate-native-id');
    ids.add(nativeId);
    if (typeof row.fork !== 'boolean' || typeof row.archived !== 'boolean') return fail('state');
    if (row.description !== null && typeof row.description !== 'string') return fail('description');
    if (typeof row.description === 'string' && (row.description.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(row.description))) return fail('description');
    return { nativeId, fullName, originalUrl: row.html_url as string, description: row.description as string | null,
      fork: row.fork, archived: row.archived, createdAt: instant(row.created_at), updatedAt: instant(row.updated_at),
      pushedAt: row.pushed_at === null ? null : instant(row.pushed_at), owner: currentOwner, sourcePointer: `/${index}` };
  });
  return { revision: GITHUB_ENRICHMENT_REVISION, owner,
    repositories, continuation: continuation(responseLink, login, page, owner, raw.length),
    publicationAuthorized: false as const, rawBodyRetained: false as const };
}

export type EnrichmentObservation = EnrichedRepository & {
  receiptId: string; observedAt: string; sourceObservationIds: string[];
};

// Retained projections cross a second boundary. Their own digest is not evidence
// that their fields still satisfy the provider/identity/privacy contract.
export function validateRetainedGithubProjection(input: unknown, login: string, page: number, revision: string) {
  const root = object(input);
  const keys = (row: Record<string, unknown>, allowed: string[], required = allowed) => {
    if (Object.keys(row).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(row, key))) return fail('retained-shape');
  };
  keys(root, ['revision', 'owner', 'repositories', 'continuation', 'publicationAuthorized', 'rawBodyRetained', 'nativeBodySha256']);
  if (!['github-owned-metadata-v1', 'github-owned-metadata-v2'].includes(revision) || root.revision !== revision ||
    root.publicationAuthorized !== false || root.rawBodyRetained !== false || !/^[a-f0-9]{64}$/.test(String(root.nativeBodySha256))) return fail('retained-shape');
  decodeDiscoveryMetadataJson(new TextEncoder().encode(JSON.stringify(input)), 'github', code => fail(`retained-${code}`));
  const nativeId = (value: unknown) => {
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) return fail('retained-native-id');
    return Number(value);
  };
  const owner = (value: unknown) => {
    const row = object(value); keys(row, ['nativeId', 'login', 'type']);
    nativeId(row.nativeId); enrichmentUrl(text(row.login, 39), 1);
    if (!['User', 'Organization'].includes(String(row.type))) return fail('retained-owner');
    return row as unknown as EnrichmentOwner;
  };
  const retainedOwner = root.owner === null ? null : owner(root.owner);
  if (!Array.isArray(root.repositories) || root.repositories.length > ENRICHMENT_LIMITS.perPage) return fail('retained-shape');
  const rows = root.repositories.map((value, index) => {
    const row = object(value);
    keys(row, ['nativeId', 'fullName', 'originalUrl', 'description', 'fork', 'archived', 'createdAt', 'updatedAt', 'pushedAt', 'owner', 'sourcePointer']);
    const account = owner(row.owner), fullName = text(row.fullName, 140);
    if (row.sourcePointer !== `/${index}`) return fail('retained-pointer');
    return { id: nativeId(row.nativeId), name: fullName.split('/')[1], full_name: fullName, html_url: row.originalUrl,
      url: `https://api.github.com/repos/${fullName}`, private: false, description: row.description,
      fork: row.fork, archived: row.archived, created_at: row.createdAt, updated_at: row.updatedAt, pushed_at: row.pushedAt,
      owner: { id: nativeId(account.nativeId), login: account.login, type: account.type } };
  });
  const checked = inspectGithubEnrichmentPage(new TextEncoder().encode(JSON.stringify(rows)), login, page, null, retainedOwner);
  if (rows.length && (!retainedOwner || checked.owner?.nativeId !== retainedOwner.nativeId ||
    checked.owner.type !== retainedOwner.type || checked.owner.login.toLowerCase() !== retainedOwner.login.toLowerCase())) return fail('retained-owner');
  const next = object(root.continuation);
  keys(next, ['state', 'nextPage', 'pathKinds'], ['state', 'nextPage']);
  if (next.pathKinds !== undefined && (!Array.isArray(next.pathKinds) || next.pathKinds.length > 3 ||
    new Set(next.pathKinds).size !== next.pathKinds.length || next.pathKinds.some(kind => !['named-account', 'native-user', 'native-organization'].includes(kind)))) return fail('retained-continuation');
  const more = next.state === 'more', count = rows.length;
  if (!['more', 'complete', 'unknown', 'page-cap', 'empty-unverified'].includes(String(next.state)) ||
    more && (next.nextPage !== page + 1 || page >= ENRICHMENT_LIMITS.maxPagesPerAccount || !retainedOwner || count === 0) ||
    !more && next.nextPage !== null || next.state === 'complete' && (count === 0 || count === ENRICHMENT_LIMITS.perPage || !retainedOwner) ||
    next.state === 'empty-unverified' && count !== 0 || next.state === 'unknown' && count !== ENRICHMENT_LIMITS.perPage ||
    next.state === 'page-cap' && (page !== ENRICHMENT_LIMITS.maxPagesPerAccount || count === 0 || !retainedOwner)) return fail('retained-continuation');
  return input;
}

export function buildGithubEnrichmentQueue(observations: EnrichmentObservation[]) {
  const byId = new Map<string, EnrichmentObservation[]>();
  for (const observation of observations) {
    if (!/^[1-9]\d*$/.test(observation.nativeId)) return fail('native-id');
    const group = byId.get(observation.nativeId) ?? [];
    group.push(observation); byId.set(observation.nativeId, group);
  }
  return {
    schemaVersion: GITHUB_ENRICHMENT_REVISION, visibility: 'private', publicationAuthorized: false,
    candidates: [...byId].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([nativeId, rows]) => ({
      nativeId, aliases: [...new Set(rows.map(r => r.fullName))].sort(),
      // Retain every source observation; transferred/renamed repositories are one review unit.
      observations: rows, reviewState: 'unreviewed',
    })),
  };
}
