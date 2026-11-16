import { DiscoveryPilotCatalogSchema, DiscoveryPilotQuerySchema, DiscoveryPilotResultSchema } from '../content/discovery-pilot';
import type { DiscoveryPilotCatalog, DiscoveryPilotQuery, DiscoveryPilotResult, DiscoveryPilotRecord } from '../content/discovery-pilot';
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
  return folded([record.title, record.nativeId, record.provider, record.owner?.name ?? '', ...record.authors.flatMap(author => [author.name, ...author.affiliations]), ...record.geography.reportedLocations].join(' '));
}
export function queryDiscoveryPilot(input: unknown, queryInput: unknown) {
  const catalog = DiscoveryPilotCatalogSchema.parse(input),
    query = DiscoveryPilotQuerySchema.parse(queryInput);
  const terms = folded(query.q).trim().split(/\s+/).filter(Boolean);
  const items = catalog.records.filter(record => (query.kind === 'all' || record.kind === query.kind) && (query.provider === 'all' || record.provider === query.provider) && terms.every(term => searchable(record).includes(term)));
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
  return {
    catalog,
    query,
    items,
    counts
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
    counts
  } = queryDiscoveryPilot(catalogInput, queryInput);
  return DiscoveryPilotResultSchema.parse({
    schemaVersion: 'discovery-pilot-v1',
    catalogVersion: catalog.catalogVersion,
    catalogSha256: await digest(catalog),
    totalRecords: catalog.records.length,
    filteredRecords: items.length,
    counts,
    query,
    items
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
