import { z } from 'zod';
const Text = z.string().min(1).max(4000).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
const Id = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Instant = z.string().datetime({
  offset: true
}).refine(value => Number.isFinite(Date.parse(value)));
export const DiscoveryPilotHttpsUrl = z.string().min(1).max(2048).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && !/[\s\\\u0000-\u001f\u007f]/.test(value);
  } catch {
    return false;
  }
}, 'Safe HTTPS link required');
const Pointer = z.string().max(1000).regex(/^(?:\/(?:[^~]|~[01])*)*$/);
const Kind = z.enum(['repository', 'publication', 'organization']);
const Provider = z.enum(['github', 'crossref', 'ror']);
const DateValue = z.object({
  label: Text,
  value: z.string().min(4).max(80),
  precision: z.enum(['year', 'month', 'day', 'instant'])
}).strict().refine(value => {
  if (value.precision === 'instant') return Instant.safeParse(value.value).success;
  if (!/^\d{4}(?:-\d{2})?(?:-\d{2})?$/.test(value.value)) return false;
  const parts = value.value.split('-').map(Number);
  if (parts.length !== ({
    year: 1,
    month: 2,
    day: 3
  } as const)[value.precision] || parts[0] < 1) return false;
  if (parts.length > 1 && (parts[1] < 1 || parts[1] > 12)) return false;
  return parts.length < 3 || parts[2] > 0 && parts[2] <= new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate();
});
const RelatedLink = z.object({
  targetId: Id,
  targetTitle: Text,
  url: DiscoveryPilotHttpsUrl,
  relation: z.literal('cites-publication'),
  evidence: z.object({
    url: DiscoveryPilotHttpsUrl,
    observedAt: Instant,
    sha256: Hash,
    pointer: Pointer,
    filePointer: Pointer,
    method: z.literal('derived-connector-observation')
  }).strict()
}).strict();
export const DiscoveryPilotRecordSchema = z.object({
  id: Id,
  kind: Kind,
  provider: Provider,
  nativeId: Text,
  title: Text,
  url: DiscoveryPilotHttpsUrl,
  owner: z.object({
    id: z.string().regex(/^[1-9]\d*$/),
    name: Text,
    kind: z.enum(['Organization', 'User'])
  }).strict().nullable(),
  authors: z.array(z.object({
    sourceIndex: z.number().int().min(0).max(1000),
    name: Text,
    affiliations: z.array(Text).max(20)
  }).strict()).max(8),
  sourceDate: DateValue.nullable(),
  additionalDates: z.array(DateValue).max(4),
  geography: z.object({
    basis: z.enum(['publication-reported-affiliation', 'registry-reported-location', 'not-established']),
    reportedLocations: z.array(Text).max(100),
    county: z.null()
  }).strict(),
  source: z.object({
    url: DiscoveryPilotHttpsUrl,
    observedAt: Instant,
    sha256: Hash,
    useBasis: z.object({
      label: Text,
      url: DiscoveryPilotHttpsUrl
    }).strict()
  }).strict(),
  provenance: z.array(z.object({
    field: z.string().min(1).max(200),
    pointer: Pointer
  }).strict()).min(1).max(200),
  relatedLinks: z.array(RelatedLink).max(8)
}).strict().refine(record => ({
  repository: 'github',
  publication: 'crossref',
  organization: 'ror'
} as const)[record.kind] === record.provider);
export type DiscoveryPilotRecord = z.infer<typeof DiscoveryPilotRecordSchema>;
export const DiscoveryPilotQuerySchema = z.object({
  q: z.string().max(160).refine(value => !/[\u0000-\u001f\u007f]/.test(value)).default(''),
  kind: Kind.or(z.literal('all')).default('all'),
  provider: Provider.or(z.literal('all')).default('all'),
  sort: z.enum(['title-asc', 'title-desc', 'source-date-desc', 'source-date-asc']).default('title-asc')
}).strict();
export type DiscoveryPilotQuery = z.infer<typeof DiscoveryPilotQuerySchema>;
export const DiscoveryPilotCatalogSchema = z.object({
  schemaVersion: z.literal('discovery-pilot-catalog-v1'),
  catalogVersion: Text,
  selectionSha256: Hash,
  records: z.array(DiscoveryPilotRecordSchema).min(1).max(100)
}).strict().refine(catalog => new Set(catalog.records.map(record => record.id)).size === catalog.records.length);
export type DiscoveryPilotCatalog = z.infer<typeof DiscoveryPilotCatalogSchema>;
export const DiscoveryPilotResultSchema = z.object({
  schemaVersion: z.literal('discovery-pilot-v1'),
  catalogVersion: Text,
  catalogSha256: Hash,
  totalRecords: z.number().int().min(0).max(100),
  filteredRecords: z.number().int().min(0).max(100),
  counts: z.object({
    repository: z.number().int().min(0).max(100),
    publication: z.number().int().min(0).max(100),
    organization: z.number().int().min(0).max(100)
  }).strict(),
  query: DiscoveryPilotQuerySchema,
  items: z.array(DiscoveryPilotRecordSchema).max(100)
}).strict();
export type DiscoveryPilotResult = z.infer<typeof DiscoveryPilotResultSchema>;
