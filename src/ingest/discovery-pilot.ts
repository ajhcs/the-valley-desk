import { DiscoveryPilotCatalogSchema, DiscoveryPilotQuerySchema, DiscoveryPilotResultSchema } from '../content/discovery-pilot';
import type { DiscoveryPilotCatalog, DiscoveryPilotQuery, DiscoveryPilotResult, DiscoveryPilotRecord, DiscoveryPilotCitation, DiscoveryPilotSearchMatch } from '../content/discovery-pilot';
export function parseDiscoveryPilotQuery(params: URLSearchParams): DiscoveryPilotQuery {
  if (params.toString().length > 4096) throw new Error('pilot-query-size');
  const values: Record<string, string> = Object.create(null);
  for (const [key, value] of params) {
    if (!['q', 'kind', 'provider', 'sort'].includes(key) || Object.hasOwn(values, key)) throw new Error('pilot-query-key');
    values[key] = value;
  }
  return DiscoveryPilotQuerySchema.parse(values);
}
const folded = (value: string) => value.normalize('NFKC').toLowerCase();
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
function dateKey(record: DiscoveryPilotRecord): string | null {
  const date = record.sourceDate;
  if (!date) return null;
  if (date.precision === 'instant') return new Date(date.value).toISOString();
  const [year, month = '01', day = '01'] = date.value.split('-');
  return `${year}-${month}-${day}T00:00:00.000Z`;
}
function searchable(record: DiscoveryPilotRecord) {
  return folded([record.title, record.description ?? '', record.nativeId, record.provider, record.owner?.name ?? '', ...record.authors.flatMap(author => [author.name, ...author.affiliations]), ...record.geography.reportedLocations].join(' '));
}
const summary = (record: DiscoveryPilotRecord) => ({ id: record.id, nativeId: record.nativeId, kind: record.kind, title: record.title, url: record.url });
export function queryDiscoveryPilot(input: unknown, queryInput: unknown) {
  const catalog = DiscoveryPilotCatalogSchema.parse(input),
    query = DiscoveryPilotQuerySchema.parse(queryInput);
  const terms = folded(query.q).trim().split(/[\s\u2010-\u2015-]+/u).filter(Boolean);
  const records = new Map(catalog.records.map(record => [record.id, record]));
  const textById = new Map(catalog.records.map(record => [record.id, searchable(record)]));
  const regionalText = new Map(catalog.records.map(record => [record.id, folded(catalog.regionalContexts.filter(context => context.recordId === record.id).flatMap(context =>
    [context.institution, context.campus, context.municipality, `${context.county} County`, ...context.authors.map(author => author.name)]).join(' '))]));
  const withRegional = (id: string) => `${textById.get(id)!} ${regionalText.get(id)!}`;
  const citations: DiscoveryPilotCitation[] = catalog.records.flatMap(repository => repository.relatedLinks.map(link => ({
    repository: summary(repository), publication: summary(records.get(link.targetId)!), evidence: link.evidence,
  })));
  const neighbors = new Map<string, { id: string; basis: DiscoveryPilotSearchMatch['basis'] }[]>();
  for (const citation of citations) {
    neighbors.set(citation.repository.id, [...neighbors.get(citation.repository.id) ?? [], { id: citation.publication.id, basis: 'cited-publication' }]);
    neighbors.set(citation.publication.id, [...neighbors.get(citation.publication.id) ?? [], { id: citation.repository.id, basis: 'citing-repository' }]);
  }
  for (const values of neighbors.values()) values.sort((a, b) => compare(a.id, b.id));
  const matches: DiscoveryPilotSearchMatch[] = [];
  const items = catalog.records.filter(record => {
    if ((query.kind !== 'all' && record.kind !== query.kind) || (query.provider !== 'all' && record.provider !== query.provider)) return false;
    const ownText = textById.get(record.id)!;
    if (terms.every(term => ownText.includes(term))) {
      matches.push({ recordId: record.id, basis: 'own-metadata', relatedRecordId: null });
      return true;
    }
    if (terms.every(term => withRegional(record.id).includes(term))) {
      matches.push({ recordId: record.id, basis: 'regional-context', relatedRecordId: null });
      return true;
    }
    // Only one retained, validated citation edge supplies additional search context.
    // The record itself never inherits that neighbor's authors, owner or location.
    const related = (neighbors.get(record.id) ?? []).find(neighbor => terms.every(term => withRegional(record.id).includes(term) || withRegional(neighbor.id).includes(term)));
    if (!related) return false;
    matches.push({ recordId: record.id, basis: related.basis, relatedRecordId: related.id });
    return true;
  });
  items.sort((left, right) => {
    if (query.sort.startsWith('title-')) return (query.sort === 'title-desc' ? -1 : 1) * compare(folded(left.title), folded(right.title)) || compare(left.id, right.id);
    const a = dateKey(left),
      b = dateKey(right);
    if (a === null || b === null) return a === b ? compare(left.id, right.id) : a === null ? 1 : -1;
    return (query.sort === 'source-date-desc' ? -1 : 1) * compare(a, b) || compare(left.id, right.id);
  });
  const counts = {
    repository: 0,
    publication: 0,
    organization: 0
  };
  for (const record of catalog.records) counts[record.kind]++;
  const selectedIds = new Set(items.map(record => record.id));
  const selectedCitations = citations.filter(citation => selectedIds.has(citation.repository.id) || selectedIds.has(citation.publication.id));
  const regionalIds = new Set([...items.filter(record => record.kind === 'publication').map(record => record.id),
    ...selectedCitations.filter(citation => selectedIds.has(citation.repository.id)).map(citation => citation.publication.id)]);
  const regionalContexts = catalog.regionalContexts.filter(context => regionalIds.has(context.recordId));
  const regionalSupportIds = new Set(regionalContexts.filter(context => !selectedIds.has(context.recordId)).map(context => context.recordId));
  return {
    catalog,
    query,
    items,
    counts,
    matches: items.map(record => matches.find(match => match.recordId === record.id)!),
    citations: selectedCitations,
    regionalContexts,
    regionalPublications: catalog.records.filter(record => regionalSupportIds.has(record.id)),
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function digest(catalog: DiscoveryPilotCatalog) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(catalog)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function readDiscoveryPilot(catalogInput: unknown, queryInput: unknown): Promise<DiscoveryPilotResult> {
  const {
    catalog,
    query,
    items,
    counts,
    matches,
    citations,
    regionalContexts,
    regionalPublications,
  } = queryDiscoveryPilot(catalogInput, queryInput);
  return DiscoveryPilotResultSchema.parse({
    schemaVersion: 'discovery-pilot-v3',
    catalogVersion: catalog.catalogVersion,
    catalogSha256: await digest(catalog),
    totalRecords: catalog.records.length,
    filteredRecords: items.length,
    counts,
    query,
    items,
    matches,
    citations,
    regionalContexts,
    regionalPublications,
  });
}
function response(request: Request, status: number, value: unknown, headers: Record<string, string> = {}) {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'cdn-cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      ...headers
    }
  });
}
function error(request: Request, status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return response(request, status, {
    error: {
      code,
      message
    }
  }, headers);
}
/** A finite metadata read. Disabled access never imports or validates the catalog. */
export async function handleDiscoveryPilot(request: Request, env: {
  DISCOVERY_PILOT_ENABLED?: unknown;
}, options: {
  loadCatalog?: () => Promise<unknown>;
} = {}): Promise<Response> {
  if (env.DISCOVERY_PILOT_ENABLED !== 'true') return error(request, 404, 'pilot-not-found', 'Resource not found.');
  const url = new URL(request.url);
  if (!/^\/api\/discovery-pilot\/?$/.test(url.pathname)) return error(request, 404, 'pilot-not-found', 'Resource not found.');
  if (!['GET', 'HEAD'].includes(request.method)) return error(request, 405, 'pilot-method-not-allowed', 'Read-only endpoint.', {
    allow: 'GET, HEAD'
  });
  let query: DiscoveryPilotQuery;
  try {
    query = parseDiscoveryPilotQuery(url.searchParams);
  } catch {
    return error(request, 400, 'pilot-invalid-query', 'Choose supported filters and a search of at most 160 characters.');
  }
  try {
    const input = await (options.loadCatalog ?? (async () => (await import('../content/discovery-pilot-catalog.json')).default))();
    return response(request, 200, await readDiscoveryPilot(input, query));
  } catch {
    return error(request, 503, 'pilot-unavailable', 'The selected metadata is temporarily unavailable.');
  }
}
