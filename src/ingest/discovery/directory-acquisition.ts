import { z } from 'zod';
import { DirectoryPrivateFrontierSchema } from './directory-frontier';
import { DirectoryDaySchema, DirectoryHashSchema, DirectoryIdSchema, DirectoryTextSchema, DirectoryUrlSchema } from '../../content/discovery-directory';

// The frozen operator plan and fact-only packets are private staging. They neither
// perform network requests nor qualify a provider, source, reviewer or publication.
const Provider = z.enum(['github', 'pubmed', 'crossref', 'arxiv', 'other']);
const Route = z.enum(['account', 'topic', 'publication', 'institution', 'community']);
const County = z.enum(['Bucks', 'Chester', 'Delaware', 'Montgomery', 'Philadelphia', 'Burlington', 'Camden', 'Gloucester', 'Mercer']);
const positive = z.number().int().safe().positive();
const Page = z.object({
  id: DirectoryIdSchema, chainId: DirectoryIdSchema, page: positive.max(3), parentPageId: DirectoryIdSchema.nullable(),
  provider: Provider, route: Route, county: County, sourceId: DirectoryIdSchema, scopeId: DirectoryIdSchema,
  installation: DirectoryIdSchema, qualificationSha256: DirectoryHashSchema, parserRevision: DirectoryIdSchema, parserSha256: DirectoryHashSchema,
  url: DirectoryUrlSchema, method: z.literal('GET'), accept: z.enum(['application/json', 'application/vnd.github+json']), encoding: z.literal('identity'), userAgent: DirectoryTextSchema.max(200), githubApiVersion: DirectoryTextSchema.max(40).nullable(), maxBytes: positive.max(48000), timeoutMs: positive.max(25000), redirects: z.literal(0), requestSha256: DirectoryHashSchema, reason: DirectoryTextSchema.max(400),
}).strict().superRefine((p, ctx) => {
  if ((p.page === 1) !== (p.parentPageId === null)) ctx.addIssue({ code: 'custom', message: 'page ancestry mismatch' });
  try { if (new URL(p.url).hash) ctx.addIssue({ code: 'custom', message: 'request fragment forbidden' }); } catch { ctx.addIssue({ code: 'custom', message: 'invalid request URL' }); }
});
export const DirectoryAcquisitionPlanSchema = z.object({
  schemaVersion: z.literal('directory-acquisition-plan-v1'), id: DirectoryIdSchema,
  gl02ManifestSha256: DirectoryHashSchema, approvedScopeSha256: DirectoryHashSchema,
  limits: z.object({ totalRequests: positive.max(120), perProviderRequests: positive.max(35),
    queue: positive.max(180), perCountyLeads: positive.max(10), totalLeads: positive.max(90), concurrentAttempts: positive.max(3),
    resultsPerPage: positive.max(30), activeMsTotal: positive.max(16200000), activeMsPerCounty: positive.max(1800000) }).strict(),
  pages: z.array(Page).min(1).max(120),
}).strict().superRefine((plan, ctx) => {
  const ids = new Set<string>(), chainPage = new Set<string>(), requests = new Set<string>();
  for (const p of plan.pages) {
    if (ids.has(p.id) || requests.has(p.requestSha256) || chainPage.has(JSON.stringify([p.chainId, p.page]))) ctx.addIssue({ code: 'custom', message: 'duplicate page plan' });
    ids.add(p.id); requests.add(p.requestSha256); chainPage.add(JSON.stringify([p.chainId, p.page]));
    if (p.route !== 'account' && p.page > 2) ctx.addIssue({ code: 'custom', message: 'query page cap exceeded' });
  }
  for (const p of plan.pages.filter(p => p.parentPageId !== null)) {
    const parent = plan.pages.find(q => q.id === p.parentPageId);
    if (!parent || parent.chainId !== p.chainId || parent.page !== p.page - 1 || parent.provider !== p.provider || parent.scopeId !== p.scopeId || parent.installation !== p.installation || parent.sourceId !== p.sourceId || parent.county !== p.county || parent.route !== p.route || parent.qualificationSha256 !== p.qualificationSha256 || parent.parserRevision !== p.parserRevision || parent.parserSha256 !== p.parserSha256) ctx.addIssue({ code: 'custom', message: 'invalid planned ancestry' });
  }
});
export type DirectoryAcquisitionPlan = z.infer<typeof DirectoryAcquisitionPlanSchema>;
const FactPointer = z.string().max(1000).regex(/^(?:\/(?:[^~]|~[01])*)?$/).refine(v => !/[\u0000-\u001f\u007f]/.test(v));
export const DirectoryAcquisitionFactSchema = z.object({
  // Exact source-native stable ID; identity is scoped by provider/installation.
  nativeId: DirectoryTextSchema.max(300), kind: z.enum(['repository', 'publication', 'preprint', 'discussion', 'project']),
  title: DirectoryTextSchema.max(512), url: DirectoryUrlSchema,
  pointers: z.object({ nativeId: FactPointer, title: FactPointer, url: FactPointer, ownerType: FactPointer.nullable(), archived: FactPointer.nullable(), fork: FactPointer.nullable(), sourceVersion: FactPointer.nullable(), sourceDates: z.array(z.object({field: DirectoryTextSchema.max(128), pointer: FactPointer}).strict()).max(8) }).strict(),
  ownerType: z.enum(['User', 'Organization', 'other']).nullable(), archived: z.boolean().nullable(), fork: z.boolean().nullable(),
  frontier: DirectoryPrivateFrontierSchema,
}).strict().superRefine((fact, ctx) => {
  for (const field of ['ownerType', 'archived', 'fork'] as const) if ((fact[field] === null) !== (fact.pointers[field] === null)) ctx.addIssue({ code: 'custom', message: 'optional fact pointer mismatch' });
  if (fact.frontier.source.kind === 'collection-lead') {
    const lead = fact.frontier.source.lead;
    if ((lead.sourceVersion === undefined) !== (fact.pointers.sourceVersion === null)) ctx.addIssue({ code: 'custom', message: 'source version pointer mismatch' });
    const names = fact.pointers.sourceDates.map(x => x.field);
    if (new Set(names).size !== names.length || names.length !== lead.sourceDates.length || lead.sourceDates.some(x => !names.includes(x.field))) ctx.addIssue({ code: 'custom', message: 'source dates pointer mismatch' });
  }
});
export const DirectoryFactPacketSchema = z.object({
  schemaVersion: z.literal('directory-factual-page-v1'), publicationAuthorized: z.literal(false), receiptId: DirectoryIdSchema, pageId: DirectoryIdSchema,
  manifestSha256: DirectoryHashSchema, qualificationSha256: DirectoryHashSchema,
  requestSha256: DirectoryHashSchema, nativeBodySha256: DirectoryHashSchema, parserSha256: DirectoryHashSchema, parserRevision: DirectoryIdSchema,
  observedDate: DirectoryDaySchema, continuation: z.enum(['none', 'more', 'unknown']), nextRequestSha256: DirectoryHashSchema.nullable(), providerIncomplete: z.boolean(),
  facts: z.array(DirectoryAcquisitionFactSchema).max(30),
  projectionSha256: DirectoryHashSchema,
}).strict().superRefine((packet,ctx) => { if ((packet.continuation === 'more') !== (packet.nextRequestSha256 !== null)) ctx.addIssue({ code: 'custom', message: 'continuation binding mismatch' }); });
export type DirectoryFactPacket = z.infer<typeof DirectoryFactPacketSchema>;
const Instant = z.string().datetime({ offset: true }).refine(v => Number.isFinite(Date.parse(v)));
export const DirectoryNativeReceiptSchema = z.object({
  schemaVersion: z.literal('directory-native-receipt-v1'), id: DirectoryIdSchema, pageId: DirectoryIdSchema,
  manifestSha256: DirectoryHashSchema, sourceId: DirectoryIdSchema, scopeId: DirectoryIdSchema, installation: DirectoryIdSchema,
  qualificationSha256: DirectoryHashSchema, requestSha256: DirectoryHashSchema,
  issuedAt: Instant, completedAt: Instant, status: z.enum(['received', 'refused', 'rate-limited', 'malformed', 'unavailable', 'unknown']),
  httpStatus: z.number().int().min(100).max(599).nullable(), responseBytes: z.number().int().min(0).max(48000),
  contentEncoding: z.enum(['identity', 'unknown']), contentType: z.enum(['application/json', 'unknown']), utf8: z.enum(['valid', 'invalid', 'unknown']), redirects: z.literal(0), nativeBodySha256: DirectoryHashSchema.nullable(),
  projectionSha256: DirectoryHashSchema.nullable(), packetSha256: DirectoryHashSchema.nullable(), parserRevision: DirectoryIdSchema.nullable(), parserSha256: DirectoryHashSchema.nullable(),
}).strict().superRefine((r, ctx) => {
  const elapsed = Date.parse(r.completedAt) - Date.parse(r.issuedAt);
  if (elapsed < 0 || (elapsed > 25000 && r.status === 'received')) ctx.addIssue({ code: 'custom', message: 'receipt deadline invalid' });
  if (r.status === 'received' && (r.httpStatus !== 200 || !r.nativeBodySha256 || !r.projectionSha256 || !r.packetSha256 || !r.parserSha256 || !r.parserRevision || r.contentEncoding !== 'identity' || r.contentType !== 'application/json' || r.utf8 !== 'valid' || r.responseBytes < 1)) ctx.addIssue({ code: 'custom', message: 'received receipt incomplete' });
  if (r.status !== 'received' && (r.nativeBodySha256 !== null || r.projectionSha256 !== null || r.packetSha256 !== null || r.parserSha256 !== null || r.parserRevision !== null)) ctx.addIssue({ code: 'custom', message: 'failure cannot retain projection' });
});
export type DirectoryNativeReceipt = z.infer<typeof DirectoryNativeReceiptSchema>;
// Stable serialization is a digest convention, not an authenticity check.
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}
