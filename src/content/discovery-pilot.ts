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
  targetNativeId: Text,
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
  description: Text.max(1000).nullable(),
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
  }).strict()).max(128),
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
const ObservationDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && Number(value.slice(0, 4)) > 0;
});
const RegionalSource = z.object({
  url: DiscoveryPilotHttpsUrl,
  observedDate: ObservationDate,
  method: z.enum(['primary-web-rendering', 'primary-indexed-rendering']),
}).strict();
const RegionalContextValueObject = z.object({
  recordId: Id.regex(/^crossref:10\.\d{4,9}\/\S+$/),
  publicationSourceSha256: Hash,
  publicationYear: z.number().int().min(1).max(9999),
  authors: z.array(z.object({ sourceIndex: z.number().int().min(0).max(1000), name: Text }).strict()).min(1).max(128),
  institution: Text.max(400),
  campus: Text.max(400),
  municipality: Text.max(400),
  county: z.enum(['Bucks', 'Chester', 'Delaware', 'Montgomery', 'Philadelphia', 'Burlington', 'Camden', 'Gloucester', 'Mercer']),
  affiliationSources: z.array(RegionalSource).min(1).max(5),
  countySources: z.array(RegionalSource).min(1).max(5),
  notes: z.array(Text.max(400)).max(3),
}).strict();
const uniqueRegionalAuthors = (value: z.infer<typeof RegionalContextValueObject>) => new Set(value.authors.map(author => author.sourceIndex)).size === value.authors.length;
const uniqueRegionalSources = (value: z.infer<typeof RegionalContextValueObject>) => {
  try { return [value.affiliationSources, value.countySources].every(sources => new Set(sources.map(source => new URL(source.url).href)).size === sources.length); }
  catch { return false; }
};
export const DiscoveryPilotRegionalContextValueSchema = RegionalContextValueObject.refine(uniqueRegionalAuthors, 'Duplicate regional source author').refine(uniqueRegionalSources, 'Duplicate regional source URL');
export const DiscoveryPilotRegionalContextSchema = RegionalContextValueObject.extend({
  provenance: z.object({
    sha256: Hash,
    pointer: z.string().regex(/^\/contexts\/(0|[1-9]\d*)$/),
    method: z.literal('derived-regional-selection-observation'),
  }).strict(),
}).strict().refine(uniqueRegionalAuthors, 'Duplicate regional source author').refine(uniqueRegionalSources, 'Duplicate regional source URL');
export type DiscoveryPilotRegionalContextValue = z.infer<typeof DiscoveryPilotRegionalContextValueSchema>;
export type DiscoveryPilotRegionalContext = z.infer<typeof DiscoveryPilotRegionalContextSchema>;
function regionalKey(value: DiscoveryPilotRegionalContext): string {
  return [value.recordId, value.institution, value.campus].map(text => text.normalize('NFKC').trim().toLowerCase()).join('\u0000');
}
function regionalBinding(value: DiscoveryPilotRegionalContext, record: DiscoveryPilotRecord): boolean {
  return record.kind === 'publication' && value.publicationSourceSha256 === record.source.sha256 &&
    Number(record.sourceDate?.value.slice(0, 4)) === value.publicationYear && value.authors.every(author =>
      record.authors.some(native => native.sourceIndex === author.sourceIndex && native.name === author.name));
}
export const DiscoveryPilotQuerySchema = z.object({
  q: z.string().max(160).refine(value => !/[\u0000-\u001f\u007f]/.test(value)).default(''),
  kind: Kind.or(z.literal('all')).default('all'),
  provider: Provider.or(z.literal('all')).default('all'),
  sort: z.enum(['title-asc', 'title-desc', 'source-date-desc', 'source-date-asc']).default('title-asc')
}).strict();
export type DiscoveryPilotQuery = z.infer<typeof DiscoveryPilotQuerySchema>;
export const DiscoveryPilotCatalogSchema = z.object({
  schemaVersion: z.literal('discovery-pilot-catalog-v3'),
  catalogVersion: Text,
  selectionSha256: Hash,
  records: z.array(DiscoveryPilotRecordSchema).min(1).max(100),
  regionalContexts: z.array(DiscoveryPilotRegionalContextSchema).max(100),
}).strict().superRefine((catalog, context) => {
  const records = new Map(catalog.records.map(record => [record.id, record]));
  if (records.size !== catalog.records.length) context.addIssue({ code: 'custom', message: 'Duplicate record identity' });
  const regionalKeys = new Set<string>();
  const regionalProvenance = new Set<string>();
  for (const regional of catalog.regionalContexts) {
    const record = records.get(regional.recordId), key = regionalKey(regional);
    const provenance = `${regional.provenance.sha256}:${regional.provenance.pointer}`;
    if (!record || !regionalBinding(regional, record) || regionalKeys.has(key) || regionalProvenance.has(provenance)) context.addIssue({ code: 'custom', message: 'Inconsistent regional context binding' });
    regionalKeys.add(key);
    regionalProvenance.add(provenance);
  }
  for (const record of catalog.records) {
    const seen = new Set<string>();
    for (const link of record.relatedLinks) {
      const target = records.get(link.targetId);
      if (record.kind !== 'repository' || target?.kind !== 'publication' ||
          target.nativeId !== link.targetNativeId || target.title !== link.targetTitle || target.url !== link.url || seen.has(link.targetId)) {
        context.addIssue({ code: 'custom', message: 'Citation endpoints must match catalog records' });
      }
      seen.add(link.targetId);
    }
  }
});
export type DiscoveryPilotCatalog = z.infer<typeof DiscoveryPilotCatalogSchema>;
const PilotRecordSummary = z.object({ id: Id, nativeId: Text, kind: Kind, title: Text, url: DiscoveryPilotHttpsUrl }).strict().refine(record => {
  if (record.kind === 'repository') return record.id === `github:${record.nativeId}` && /^[1-9]\d*$/.test(record.nativeId) && record.url === `https://github.com/${record.title}`;
  if (record.kind === 'publication') {
    const url = new URL(record.url);
    try { return record.id === `crossref:${record.nativeId}` && url.hostname === 'doi.org' && !url.search && !url.hash && decodeURIComponent(url.pathname.slice(1)).toLowerCase() === record.nativeId.toLowerCase(); }
    catch { return false; }
  }
  return record.id === `ror:${record.nativeId.split('/').at(-1)}` && record.url === record.nativeId;
});
const PilotCitation = z.object({
  repository: PilotRecordSummary.refine(record => record.kind === 'repository'),
  publication: PilotRecordSummary.refine(record => record.kind === 'publication'),
  evidence: RelatedLink.shape.evidence,
}).strict();
export type DiscoveryPilotCitation = z.infer<typeof PilotCitation>;
const PilotSearchMatch = z.object({
  recordId: Id,
  basis: z.enum(['own-metadata', 'regional-context', 'cited-publication', 'citing-repository']),
  relatedRecordId: Id.nullable(),
}).strict().refine(match => ['own-metadata', 'regional-context'].includes(match.basis) ? match.relatedRecordId === null : match.relatedRecordId !== null);
export type DiscoveryPilotSearchMatch = z.infer<typeof PilotSearchMatch>;
export const DiscoveryPilotResultSchema = z.object({
  schemaVersion: z.literal('discovery-pilot-v3'),
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
  items: z.array(DiscoveryPilotRecordSchema).max(100),
  matches: z.array(PilotSearchMatch).max(100),
  citations: z.array(PilotCitation).max(800),
  regionalContexts: z.array(DiscoveryPilotRegionalContextSchema).max(100),
  regionalPublications: z.array(DiscoveryPilotRecordSchema).max(100),
}).strict().superRefine((result, context) => {
  const selected = new Map(result.items.map(item => [item.id, item]));
  const regionalPublications = new Map(result.regionalPublications.map(record => [record.id, record]));
  const sameSummary = (left: z.infer<typeof PilotRecordSummary>, right: z.infer<typeof PilotRecordSummary>) =>
    (['id', 'nativeId', 'kind', 'title', 'url'] as const).every(field => left[field] === right[field]);
  const sameEvidence = (left: z.infer<typeof RelatedLink>['evidence'], right: z.infer<typeof RelatedLink>['evidence']) =>
    (['url', 'observedAt', 'sha256', 'pointer', 'filePointer', 'method'] as const).every(field => left[field] === right[field]);
  let valid = selected.size === result.items.length && result.filteredRecords === result.items.length && result.filteredRecords <= result.totalRecords &&
    Object.values(result.counts).reduce((a, b) => a + b, 0) === result.totalRecords && result.matches.length === result.items.length &&
    new Set(result.matches.map(match => match.recordId)).size === result.items.length && result.items.every(item => result.matches.some(match => match.recordId === item.id));
  valid &&= regionalPublications.size === result.regionalPublications.length;
  for (const kind of ['repository', 'publication', 'organization'] as const) valid &&= result.items.filter(item => item.kind === kind).length <= result.counts[kind];
  const pairs = new Set<string>();
  for (const citation of result.citations) {
    const repository = selected.get(citation.repository.id);
    const publication = selected.get(citation.publication.id);
    const pair = `${citation.repository.id}\u0000${citation.publication.id}`;
    valid &&= !pairs.has(pair) && Boolean(repository || publication);
    pairs.add(pair);
    if (repository) valid &&= sameSummary(repository, citation.repository) && repository.relatedLinks.some(link =>
      link.targetId === citation.publication.id && link.targetNativeId === citation.publication.nativeId &&
      link.targetTitle === citation.publication.title && link.url === citation.publication.url && sameEvidence(link.evidence, citation.evidence));
    if (publication) valid &&= sameSummary(publication, citation.publication);
  }
  for (const item of result.items) {
    if (item.kind !== 'repository') valid &&= item.relatedLinks.length === 0;
    for (const link of item.relatedLinks) valid &&= result.citations.some(citation =>
      citation.repository.id === item.id && citation.publication.id === link.targetId && sameEvidence(citation.evidence, link.evidence));
  }
  const regionalKeys = new Set<string>();
  const regionalProvenance = new Set<string>();
  for (const publication of result.regionalPublications) valid &&= publication.kind === 'publication' && publication.relatedLinks.length === 0 && !selected.has(publication.id) &&
    result.regionalContexts.some(regional => regional.recordId === publication.id) && result.citations.some(citation =>
      citation.publication.id === publication.id && sameSummary(publication, citation.publication) && selected.get(citation.repository.id)?.kind === 'repository');
  for (const regional of result.regionalContexts) {
    const record = selected.get(regional.recordId) ?? regionalPublications.get(regional.recordId), key = regionalKey(regional);
    const provenance = `${regional.provenance.sha256}:${regional.provenance.pointer}`;
    valid &&= !regionalKeys.has(key) && !regionalProvenance.has(provenance) && Boolean(record && regionalBinding(regional, record));
    regionalKeys.add(key);
    regionalProvenance.add(provenance);
  }
  for (const match of result.matches) valid &&= match.basis === 'own-metadata' || (match.basis === 'regional-context' ?
    selected.get(match.recordId)?.kind === 'publication' && result.regionalContexts.some(regional => regional.recordId === match.recordId) : result.citations.some(citation =>
    match.basis === 'cited-publication' ? citation.repository.id === match.recordId && citation.publication.id === match.relatedRecordId :
      citation.publication.id === match.recordId && citation.repository.id === match.relatedRecordId));
  if (!valid) context.addIssue({ code: 'custom', message: 'Inconsistent search or citation context' });
});
export type DiscoveryPilotResult = z.infer<typeof DiscoveryPilotResultSchema>;
