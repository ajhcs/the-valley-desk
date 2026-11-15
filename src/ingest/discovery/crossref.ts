import { z } from 'zod';
import { DiscoveryInstant, DiscoveryPublicUrl, RevisionRef, makeDiscoveryDate } from '../../content/discovery-schema';
import { permittedPublicUrl } from '../regional-contracts';
import { isCalendarDay } from '../../content/watch-schema';
import { canonicalDiscoveryEvidenceJson as canonical } from '../discovery-evidence-store';
import { redactRegionalContactEmails as redact } from '../regional-privacy';
import { constructDiscoveryEndpoint } from './endpoint';
import {
  DiscoveryRuntimeError, DiscoveryRuntimeSource, type DiscoveryIssuedPlan,
} from './runtime-contract';
import { DiscoverySourceRequest } from './source-contract';
import {
  DiscoveryCollectionDraft, DiscoveryCollectionPageReceipt,
  type DiscoveryCollectionParseInput, type DiscoveryCollectionLead, type DiscoveryCollectionClaim,
} from './collection-contract';
import type { DiscoveryTrustedAdapterRepresentation } from './adapter';

export const CROSSREF_DOI_NORMALIZER = 'crossref-doi-ascii-v1' as const;
const CURSOR_TTL_MS = 300000;
const scopeInput = z.object({
  declaredId: z.string().min(1).max(200),
  revision: z.number().int().positive().safe(),
  queryKind: z.enum(['work', 'institution']),
  queryLiteral: z.string().trim().min(2).max(200).refine(value => !/[\u0000-\u001f\u007f]/u.test(value)),
  startDay: z.string().refine(isCalendarDay),
  endDay: z.string().refine(isCalendarDay),
  pageSize: z.number().int().min(1).max(100),
  maxPages: z.number().int().min(1).max(100),
  maxItems: z.number().int().min(1).max(1000),
  denominator: z.string().min(3).max(512),
}).strict();
export type DiscoveryCrossrefScopeInput = z.infer<typeof scopeInput>;
export type DiscoveryCrossrefScope = Readonly<DiscoveryCrossrefScopeInput & {
  id: string;
  scopeSha256: string;
  queryParameter: 'query' | 'query.affiliation';
  filter: string;
}>;
const qualifiedScopes = new WeakSet<object>();
function fail(code: string): never {
  throw new DiscoveryRuntimeError('parser-failed', `discovery-crossref-${code}`);
}
const encode = (value: string) => new TextEncoder().encode(value);
async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
}
/** Frozen candidate-query grammar only; provider access and regional admission are separate. */
export async function qualifyDiscoveryCrossrefScope(input: DiscoveryCrossrefScopeInput): Promise<DiscoveryCrossrefScope> {
  const checked = scopeInput.parse(JSON.parse(canonical(input)));
  if (checked.startDay > checked.endDay || Date.parse(checked.endDay) - Date.parse(checked.startDay) > 366 * 86400000 ||
      redact(checked.queryLiteral) !== checked.queryLiteral || !/[\p{L}\p{N}]/u.test(checked.queryLiteral)) return fail('scope-invalid');
  const queryParameter = checked.queryKind === 'institution' ? 'query.affiliation' : 'query';
  const filter = `from-pub-date:${checked.startDay},until-pub-date:${checked.endDay}`;
  const scopeSha256 = await digest(encode(canonical({...checked, queryParameter, filter})));
  const result = Object.freeze({...checked, queryParameter, filter, scopeSha256, id: `crossref-scope:${scopeSha256}`});
  qualifiedScopes.add(result);
  return result;
}
export type DiscoveryCrossrefResolvers = {
  resolveSource(id: string): Promise<DiscoveryRuntimeSource | null>;
  resolveScope(id: string): Promise<DiscoveryCrossrefScope | null>;
  resolvePlan(id: string): Promise<DiscoveryIssuedPlan>;
  resolvePage(id: string): Promise<DiscoveryCollectionPageReceipt | null>;
  resolveClaim(id: string): Promise<DiscoveryCollectionClaim>;
  resolveRepresentation(ref: {id: string; revision: number}): Promise<DiscoveryTrustedAdapterRepresentation | null>;
  distinctOriginCount?(refs: {id: string; revision: number}[]): Promise<number>;
  now?(): string;
};
export type DiscoveryCrossrefGap = {
  code: 'malformed-item' | 'duplicate-doi' | 'page-cap' | 'item-cap' | 'provider-total-conflict' | 'missing-cursor';
  itemIndex?: number;
  reason?: string;
};
export type DiscoveryCrossrefMetadata = {
  originalDoi: string;
  canonicalDoi: string;
  providerNativeId: string;
  doiNormalizer: typeof CROSSREF_DOI_NORMALIZER;
  publicDoiUrl: string;
  sourceVersion: string;
  publicationType: string;
  publicationSubtype: string | null;
  titles: string[];
  contributors: {
    role: 'author' | 'editor';
    index: number;
    displayName: string | null;
    affiliations: string[];
    personId: null;
    currentEmploymentConfirmed: false;
  }[];
  licenseHints: {url: string; appliesTo: string | null; startDate: ReturnType<typeof makeDiscoveryDate>}[];
  relationProposals: {relation: string; targetDoi: string | null; originalTarget: string | null; jsonPointer: string}[];
  metadataDates: {field: string; date: ReturnType<typeof makeDiscoveryDate>}[];
  holds: string[];
  publicationAuthorized: false;
  originResolution: 'reviewed-origin-required';
};
function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('object');
  return value as Record<string, any>;
}
function label(value: unknown, cap: number): string {
  if (typeof value !== 'string') return fail('text');
  const clean = redact(value).trim();
  if (!clean.length || clean.length > cap) return fail('text-bound');
  return clean;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return fail('count');
  return value;
}
function dateParts(value: unknown) {
  if (value === undefined || value === null) return makeDiscoveryDate('unknown', null);
  const raw = record(value)['date-parts'];
  if (!Array.isArray(raw) || raw.length !== 1 || !Array.isArray(raw[0]) || raw[0].length < 1 || raw[0].length > 3 ||
      raw[0].some((part: unknown) => typeof part !== 'number' || !Number.isSafeInteger(part))) return fail('date-parts');
  const [year, month, day] = raw[0] as number[];
  const y = String(year).padStart(4, '0');
  return raw[0].length === 1 ? makeDiscoveryDate('year', y) : raw[0].length === 2
    ? makeDiscoveryDate('month', `${y}-${String(month).padStart(2, '0')}`)
    : makeDiscoveryDate('day', `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
}
function publicLink(value: unknown): string | null {
  const parsed = DiscoveryPublicUrl.safeParse(value);
  if (!parsed.success || typeof value !== 'string' || redact(value) !== value || !permittedPublicUrl(value)) return null;
  const url = new URL(parsed.data);
  if (url.href !== value || url.search || url.hostname === 'home.arpa' || url.hostname.endsWith('.home.arpa')) return null;
  return parsed.data;
}
function envelope(bytes: Uint8Array) {
  if (bytes.length > 48000) return fail('body-cap');
  let root: Record<string, any>;
  try { root = record(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes))); } catch { return fail('json'); }
  if (Object.keys(root).some(key => ['error','errors','warning','warnings'].includes(key.toLowerCase())) ||
      root.status !== 'ok' || root['message-type'] !== 'work-list') return fail('response-status');
  const message = record(root.message);
  if (Object.keys(message).some(key => ['error','errors','warning','warnings'].includes(key.toLowerCase())) ||
      !Array.isArray(message.items)) return fail('response-message');
  const total = count(message['total-results']);
  const cursor = message['next-cursor'];
  if (cursor !== undefined && cursor !== null &&
      (typeof cursor !== 'string' || !cursor.length || cursor.length > 512 || /[\u0000-\u001f\u007f]/u.test(cursor) || /^\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(cursor))) return fail('cursor-shape');
  return {message, items: message.items as unknown[], total, cursor: cursor ?? null};
}

/** New bounded WP10 DOI subset, not a claim that all valid DOI syntax is supported. */
export function normalizeDiscoveryCrossrefDoi(original: unknown) {
  if (typeof original !== 'string' || original.length > 512 || /[^\x20-\x7e]/u.test(original)) return fail('doi-unsupported');
  let bare = original.trim();
  if (bare.startsWith('https://doi.org/')) bare = bare.slice('https://doi.org/'.length);
  else if (/^doi:/i.test(bare)) bare = bare.slice(4);
  if (!/^10\.[0-9]{4,9}\/[A-Za-z0-9._;()/:+-]+$/.test(bare) ||
      bare.split('/').some(segment => segment === '.' || segment === '..')) return fail('doi-unsupported');
  const canonicalDoi = bare.replace(/[A-Z]/g, value => value.toLowerCase());
  const publicDoiUrl = `https://doi.org/${canonicalDoi}`;
  if (new URL(publicDoiUrl).href !== publicDoiUrl || !publicLink(publicDoiUrl)) return fail('doi-url');
  return {originalDoi: original, canonicalDoi, providerNativeId: canonicalDoi, publicDoiUrl,
    doiNormalizer: CROSSREF_DOI_NORMALIZER};
}

const supportedTypes = new Set(['journal-article', 'posted-content', 'proceedings-article', 'book-chapter',
  'monograph', 'book', 'edited-book', 'report', 'dissertation', 'reference-entry', 'book-section']);
const relationTypes = new Set(['is-preprint-of','has-preprint','is-version-of','has-version','is-identical-to',
  'is-correction-of','has-correction','is-retraction-of','is-retracted-by','is-supplement-to','is-supplemented-by',
  'is-update-of','is-updated-by','is-review-of','has-review','is-part-of','has-part']);
async function projectItem(raw: unknown, itemIndex: number) {
  const row = record(raw), identity = normalizeDiscoveryCrossrefDoi(row.DOI);
  if (!Array.isArray(row.title) || !row.title.length || row.title.length > 10) return fail('title');
  const titles = row.title.map((value: unknown) => label(value, 512));
  const publicationType = label(row.type, 100);
  if (!supportedTypes.has(publicationType)) return fail('unsupported-type');
  const publicationSubtype = row.subtype === undefined ? null : label(row.subtype, 100);
  const sourceStage = publicationType === 'posted-content' && publicationSubtype === 'preprint' ? 'preprint' as const : 'publication' as const;
  const holds = ['editorial-review-required', 'person-identity-unresolved', 'regional-attribution-unverified',
    'reviewed-origin-required', 'license-is-not-metadata-collection-permission'];
  const contributors: DiscoveryCrossrefMetadata['contributors'] = [];
  for (const role of ['author', 'editor'] as const) {
    if (row[role] === undefined) continue;
    if (!Array.isArray(row[role]) || row[role].length > 100) return fail('contributor-list');
    row[role].forEach((value: unknown, index: number) => {
      const contributor = record(value);
      const parts = [contributor.given, contributor.family].filter(value => value !== undefined).map(value => label(value, 300));
      const displayName = contributor.name !== undefined ? label(contributor.name, 512) : parts.length ? label(parts.join(' '), 512) : null;
      if (contributor.affiliation !== undefined && !Array.isArray(contributor.affiliation)) return fail('affiliation-list');
      const affiliations = (contributor.affiliation ?? []).map((value: unknown) => label(record(value).name, 1000));
      if (affiliations.length > 8) return fail('affiliation-cap');
      if (!affiliations.length) holds.push('affiliation-unknown');
      contributors.push({role, index, displayName, affiliations, personId: null, currentEmploymentConfirmed: false});
    });
  }
  if (contributors.length > 100) return fail('contributor-cap');
  if (!contributors.length) holds.push('contributors-unknown');
  const sourceDates = ['published', 'published-online', 'published-print', 'issued']
    .filter(field => row[field] !== undefined).map(field => ({field, date: dateParts(row[field])}));
  if (!sourceDates.length) sourceDates.push({field: 'publication', date: makeDiscoveryDate('unknown', null)});
  const metadataDates: DiscoveryCrossrefMetadata['metadataDates'] = [];
  for (const field of ['created', 'deposited', 'indexed']) {
    if (row[field] !== undefined) {
      const value = record(row[field]);
      if (value['date-parts'] !== undefined) metadataDates.push({field, date: dateParts(value)});
      else if (typeof value['date-time'] === 'string') metadataDates.push({field, date: makeDiscoveryDate('instant', value['date-time'])});
      else return fail('metadata-date');
    }
  }
  const licenseHints: DiscoveryCrossrefMetadata['licenseHints'] = [];
  if (row.license !== undefined) {
    if (!Array.isArray(row.license) || row.license.length > 20) return fail('license-list');
    for (const value of row.license) {
      const license = record(value), url = publicLink(license.URL);
      if (!url) return fail('license-url');
      licenseHints.push({url, appliesTo: license['content-version'] === undefined ? null : label(license['content-version'], 100),
        startDate: dateParts(license.start)});
    }
  }
  const relationProposals: DiscoveryCrossrefMetadata['relationProposals'] = [];
  let relationGap = false;
  if (row.relation !== undefined) {
    const relation = record(row.relation);
    if (Object.keys(relation).length > 20) return fail('relation-cap');
    for (const [kind, values] of Object.entries(relation)) {
      if (!Array.isArray(values) || values.length > 20) return fail('relation-list');
      for (let i = 0; i < values.length; i++) {
        const value = record(values[i]);
        let targetDoi: string | null = null;
        const originalTarget = value.id === undefined ? null : label(value.id, 512);
        if (value['id-type'] === 'doi' && originalTarget !== null) {
          try { targetDoi = normalizeDiscoveryCrossrefDoi(originalTarget).canonicalDoi; } catch { /* retained unresolved relation */ }
        }
        if (!relationTypes.has(kind) || targetDoi === null) {
          holds.push(!relationTypes.has(kind) ? 'unsupported-relation-type' : 'relation-endpoint-missing');
          relationGap = true;
        }
        holds.push('relation-target-unverified');
        relationProposals.push({relation: label(kind, 100), targetDoi, originalTarget,
          jsonPointer: `/message/items/${itemIndex}/relation/${kind.replaceAll('~', '~0').replaceAll('/', '~1')}/${i}`});
      }
    }
  }
  if (row['update-to'] !== undefined) {
    if (!Array.isArray(row['update-to']) || row['update-to'].length > 20) return fail('update-list');
    for (let i = 0; i < row['update-to'].length; i++) {
      const update = record(row['update-to'][i]);
      let targetDoi: string | null = null;
      const originalTarget = update.DOI === undefined ? null : label(update.DOI, 512);
      if (originalTarget !== null) {
        try { targetDoi = normalizeDiscoveryCrossrefDoi(originalTarget).canonicalDoi; } catch { /* review hold */ }
      }
      if (!targetDoi) { relationGap = true; holds.push('relation-endpoint-missing'); }
      holds.push('correction-status-review-required');
      relationProposals.push({relation: label(update.type ?? 'update', 100), targetDoi, originalTarget,
        jsonPointer: `/message/items/${itemIndex}/update-to/${i}`});
    }
  }
  if (row.URL !== undefined && publicLink(row.URL) !== identity.publicDoiUrl) holds.push('reported-url-unverified');
  const revisionInput = {canonicalDoi: identity.canonicalDoi, titles, publicationType, publicationSubtype, sourceStage, contributors,
    sourceDates, metadataDates, licenseHints, relationProposals: relationProposals.map(({jsonPointer: _pointer, ...relation}) => {
      void _pointer; return relation;
    })};
  const sourceVersion = `metadata:${await digest(encode(canonical(revisionInput)))}`;
  const metadata: DiscoveryCrossrefMetadata = {...identity, sourceVersion, publicationType, publicationSubtype, titles, contributors,
    licenseHints, relationProposals, metadataDates, holds: [...new Set(holds)],
    publicationAuthorized: false, originResolution: 'reviewed-origin-required'};
  const lead: DiscoveryCollectionLead = {nativeId: identity.canonicalDoi, kind: 'artifact', artifactKind: 'publication',
    displayName: titles[0], sourceStage,
    sourceVersion, sourceDates, relatedAccounts: [], unresolvedPeople: contributors.flatMap(person => person.displayName ? [person.displayName] : []),
    publicationAuthorized: false};
  return {lead, metadata, relationGap};
}

export type DiscoveryCrossrefChainPageResolver = (chainId: string, ordinal: number) => Promise<DiscoveryCollectionPageReceipt | null>;
export function createDiscoveryCrossrefAdapter(options: DiscoveryCrossrefResolvers & {
  resolveChainPage: DiscoveryCrossrefChainPageResolver;
}) {
  const trusted = {...options}, now = trusted.now ?? (() => new Date().toISOString());
  const nowEpoch = () => {
    const value = DiscoveryInstant.safeParse(now());
    if (!value.success) return fail('clock');
    return Date.parse(value.data);
  };
  async function source(id: string) {
    const resolved = await trusted.resolveSource(id);
    if (!resolved) return fail('source-missing');
    const value = DiscoveryRuntimeSource.parse(JSON.parse(canonical(resolved))), template = value.endpointTemplate;
    const scope = await trusted.resolveScope(value.scopeId);
    if (value.id !== id || value.provider !== 'crossref' || template.origin !== 'https://api.crossref.org' ||
        !['/works', '/v1/works'].includes(template.path) || !scope || !qualifiedScopes.has(scope) || scope.id !== value.scopeId) return fail('source-binding');
    if (template.pageParameter !== 'cursor' || Object.keys(template.parameters).join(',') !== 'cursor' ||
        template.parameters.cursor.kind !== 'token' || template.required.length !== 1 || template.required[0] !== 'cursor' ||
        template.fixed[scope.queryParameter] !== scope.queryLiteral || template.fixed.filter !== scope.filter ||
        template.fixed.rows !== String(scope.pageSize) || Object.keys(template.fixed).some(key =>
          ![scope.queryParameter, 'filter', 'rows'].includes(key))) return fail('query-binding');
    return {value, template, scope};
  }
  function bindRequest(request: DiscoverySourceRequest, s: Awaited<ReturnType<typeof source>>) {
    if (request.provider !== 'crossref' || request.sourceId !== s.value.id || request.installation !== s.value.installation ||
        request.scopeId !== s.scope.id || request.endpointConstructor !== s.template.id ||
        canonical(request.enrollment) !== canonical(s.value.enrollment) || canonical(request.configuration) !== canonical(s.value.configuration) ||
        canonical(request.parser) !== canonical(s.value.parser) || canonical(request.permission) !== canonical(s.value.permission) ||
        Object.keys(request.parameters).join(',') !== 'cursor') return fail('request-binding');
  }
  async function retainedPage(id: string) {
    const resolved = await trusted.resolvePage(id);
    if (!resolved) return fail('receipt-missing');
    const page = DiscoveryCollectionPageReceipt.parse(JSON.parse(canonical(resolved)));
    const raw = await trusted.resolveRepresentation(page.representation);
    if (!raw) return fail('unretained');
    const retained = {...raw, bytes: new Uint8Array(raw.bytes), request: DiscoverySourceRequest.parse(JSON.parse(canonical(raw.request)))};
    const s = await source(page.sourceId);
    bindRequest(retained.request, s);
    if (Date.parse(page.committedAt) > nowEpoch()) return fail('future-receipt');
    if (page.id !== id || page.sourceRevision !== s.value.revision || retained.id !== page.representation.id ||
        retained.revision !== page.representation.revision || retained.representationSha256 !== page.representationSha256 ||
        await digest(retained.bytes) !== page.representationSha256 ||
        await digest(encode(canonical(retained.request))) !== page.requestSha256) return fail('retained-binding');
    await constructDiscoveryEndpoint(s.template, Object.entries(retained.request.parameters));
    const parsed = envelope(retained.bytes);
    if (parsed.items.length > s.scope.pageSize) return fail('page-shape');
    const resolvedClaim = await trusted.resolveClaim(page.claimId);
    const claim = {...resolvedClaim, source: DiscoveryRuntimeSource.parse(JSON.parse(canonical(resolvedClaim.source))),
      chain: {...resolvedClaim.chain}, sourceLease: {...resolvedClaim.sourceLease}};
    if (claim.id !== page.claimId || claim.roundId !== page.roundId || claim.slot !== page.slot ||
        claim.issuedPlanId !== page.planId || canonical(claim.source) !== canonical(s.value) ||
        claim.chain.id !== page.chainId || claim.chain.sourceId !== page.sourceId ||
        claim.chain.sourceRevision !== page.sourceRevision || claim.chain.pageCount + 1 !== page.pageOrdinal ||
        !DiscoveryInstant.safeParse(claim.expiresAt).success || !DiscoveryInstant.safeParse(claim.processingDeadlineAt).success ||
        claim.sourceLease.expiresAt !== claim.expiresAt || Date.parse(page.committedAt) >= Date.parse(claim.expiresAt)) return fail('claim-binding');
    return {page, retained, s, parsed, claim};
  }
  async function ancestry(parentId: string, s: Awaited<ReturnType<typeof source>>) {
    const parent = await retainedPage(parentId), chainId = parent.page.chainId;
    if (parent.page.sourceId !== s.value.id || parent.page.pageOrdinal >= s.scope.maxPages ||
        parent.page.truncated || parent.page.rejectedCount || parent.page.providerLimited || parent.page.terminal ||
        parent.page.limitationCode !== null || !parent.page.nextCheckpoint || parent.page.nextCheckpoint !== parent.parsed.cursor) return fail('cursor-parent');
    const pages: Awaited<ReturnType<typeof retainedPage>>[] = [];
    for (let ordinal = 1; ordinal <= parent.page.pageOrdinal; ordinal++) {
      const receipt = ordinal === parent.page.pageOrdinal ? parent.page : await trusted.resolveChainPage(chainId, ordinal);
      if (!receipt) return fail('ancestry-missing');
      const entry = ordinal === parent.page.pageOrdinal ? parent : await retainedPage(receipt.id);
      if (entry.page.chainId !== chainId || entry.page.pageOrdinal !== ordinal || entry.page.sourceId !== s.value.id ||
          entry.page.sourceRevision !== s.value.revision || entry.page.truncated || entry.page.rejectedCount ||
          entry.page.providerLimited || entry.page.terminal || entry.page.limitationCode !== null) return fail('ancestry-binding');
      const prior = pages.at(-1);
      if (!prior && (entry.retained.request.parameters.cursor !== '*' || entry.retained.request.checkpoint !== null || entry.claim.chain.lastReceiptId !== null || entry.claim.chain.checkpoint !== null) ||
          prior && (entry.retained.request.parameters.cursor !== prior.page.nextCheckpoint ||
            entry.retained.request.checkpoint !== prior.page.nextCheckpoint || entry.claim.chain.lastReceiptId !== prior.page.id ||
            entry.claim.chain.checkpoint !== prior.page.nextCheckpoint || prior.parsed.cursor !== prior.page.nextCheckpoint)) return fail('ancestry-token');
      pages.push(entry);
    }
    const consumed = pages.reduce((sum, entry) => sum + entry.parsed.items.length, 0);
    if (consumed >= s.scope.maxItems) return fail('item-cap');
    return {parent, pages, consumed};
  }
  async function currentPlan(input: DiscoveryCollectionParseInput, s: Awaited<ReturnType<typeof source>>) {
    const resolved = await trusted.resolvePlan(input.request.budgetReservation.id);
    const plan = {...resolved, request: DiscoverySourceRequest.parse(JSON.parse(canonical(resolved.request))),
      source: DiscoveryRuntimeSource.parse(JSON.parse(canonical(resolved.source))),
      ...(resolved.continuation ? {continuation: {...resolved.continuation}} : {})};
    if (plan.id !== input.request.budgetReservation.id || canonical(plan.request) !== canonical(input.request) ||
        plan.requestSha256 !== input.requestSha256 || canonical(plan.source) !== canonical(s.value) ||
        plan.endpoint !== await constructDiscoveryEndpoint(s.template, Object.entries(input.request.parameters))) return fail('issued-plan-binding');
    const cursor = input.request.parameters.cursor;
    if (cursor === '*') {
      if (input.request.checkpoint !== null || plan.continuation) return fail('initial-cursor');
      return {pages: [] as Awaited<ReturnType<typeof retainedPage>>[], consumed: 0};
    }
    if (!plan.continuation || input.request.checkpoint !== cursor) return fail('cursor-unbound');
    const previous = await ancestry(plan.continuation.parentReceiptId, s), continuation = plan.continuation;
    if (continuation.sourceId !== s.value.id || continuation.scopeId !== s.scope.id ||
        continuation.sourceRevision !== s.value.revision || continuation.installation !== s.value.installation ||
        continuation.querySha256 !== s.value.materialScope.requestScopeSha256 ||
        continuation.tokenSha256 !== await digest(encode(cursor)) || previous.parent.page.nextCheckpoint !== cursor ||
        !DiscoveryInstant.safeParse(continuation.expiresAt).success ||
        nowEpoch() >= Math.min(Date.parse(continuation.expiresAt), Date.parse(previous.parent.claim.expiresAt),
          Date.parse(previous.parent.page.committedAt) + CURSOR_TTL_MS)) return fail('cursor-expired-or-mismatched');
    return previous;
  }
  async function inspect(supplied: DiscoveryCollectionParseInput) {
    const input = {...supplied, bytes: new Uint8Array(supplied.bytes),
      request: DiscoverySourceRequest.parse(JSON.parse(canonical(supplied.request))), parser: {...supplied.parser}};
    const s = await source(input.request.sourceId);
    bindRequest(input.request, s);
    if (canonical(input.parser) !== canonical(s.value.parser) || !Number.isSafeInteger(input.maxItems) ||
        input.maxItems < 1 || input.maxItems > 100 || await digest(input.bytes) !== input.representationSha256 ||
        await digest(encode(canonical(input.request))) !== input.requestSha256) return fail('input-binding');
    const chain = await currentPlan(input, s);
    return project(input, s, chain);
  }
  async function project(input: DiscoveryCollectionParseInput, s: Awaited<ReturnType<typeof source>>,
    chain: {pages: Awaited<ReturnType<typeof retainedPage>>[]; consumed: number}) {
    const parsed = envelope(input.bytes);
    if (parsed.items.length > s.scope.pageSize) return fail('page-shape');
    const leads: DiscoveryCollectionLead[] = [], metadata: DiscoveryCrossrefMetadata[] = [], gaps: DiscoveryCrossrefGap[] = [];
    const seen = new Map<string, Set<string>>();
    for (const previous of chain.pages) for (let index = 0; index < previous.parsed.items.length; index++) {
      const item = await projectItem(previous.parsed.items[index], index);
      const versions = seen.get(item.lead.nativeId) ?? new Set<string>();
      versions.add(item.lead.sourceVersion!); seen.set(item.lead.nativeId, versions);
    }
    let rejectedCount = 0, providerLimited = false;
    const itemCap = Math.min(input.maxItems, s.scope.maxItems - chain.consumed);
    for (let index = 0; index < parsed.items.length; index++) {
      if (index >= itemCap) { rejectedCount++; gaps.push({code: 'item-cap', itemIndex: index}); continue; }
      try {
        const item = await projectItem(parsed.items[index], index), versions = seen.get(item.lead.nativeId);
        if (versions?.has(item.lead.sourceVersion!)) { rejectedCount++; gaps.push({code: 'duplicate-doi', itemIndex: index}); continue; }
        if (versions?.size) item.metadata.holds.push('contradictory-metadata-review-required');
        const nextVersions = versions ?? new Set<string>();
        nextVersions.add(item.lead.sourceVersion!); seen.set(item.lead.nativeId, nextVersions);
        leads.push(item.lead); metadata.push(item.metadata);
        if (item.relationGap) { providerLimited = true; gaps.push({code: 'malformed-item', itemIndex: index, reason: 'relation-endpoint-unresolved'}); }
      } catch (error) {
        rejectedCount++;
        gaps.push({code: 'malformed-item', itemIndex: index,
          reason: error instanceof DiscoveryRuntimeError ? error.code : 'unsupported-qualified-field'});
      }
    }
    const consumed = chain.consumed + parsed.items.length, pageCount = chain.pages.length + 1;
    let terminal = parsed.items.length < s.scope.pageSize, nextCheckpoint: string | null = null;
    if (parsed.total < consumed || terminal && parsed.total > consumed) {
      providerLimited = true; gaps.push({code: 'provider-total-conflict'});
    }
    if (!terminal) {
      if (pageCount >= s.scope.maxPages) { providerLimited = true; gaps.push({code: 'page-cap'}); }
      else if (consumed >= s.scope.maxItems) { providerLimited = true; gaps.push({code: 'item-cap'}); }
      else if (!parsed.cursor) { providerLimited = true; gaps.push({code: 'missing-cursor'}); }
      else {
        await constructDiscoveryEndpoint(s.template, [['cursor', parsed.cursor]]);
        nextCheckpoint = parsed.cursor;
      }
    }
    const truncated = parsed.items.length > itemCap;
    terminal = terminal && !providerLimited && rejectedCount === 0;
    if (providerLimited || rejectedCount) nextCheckpoint = null;
    const draft = DiscoveryCollectionDraft.parse({schemaVersion: 'discovery-collection-v1',
      requestSha256: input.requestSha256, representationSha256: input.representationSha256, parser: input.parser,
      representationFormat: 'json', leads, terminal, nextCheckpoint, rejectedCount, truncated, providerLimited});
    return {draft, metadata, gaps, reportedTotal: parsed.total, consumedItems: consumed, pageCount,
      provenance: {sourceId: s.value.id, sourceRevision: s.value.revision, scopeId: s.scope.id, scopeSha256: s.scope.scopeSha256,
        request: input.request, requestSha256: input.requestSha256, representationSha256: input.representationSha256,
        parentReceiptId: chain.pages.at(-1)?.page.id ?? null}, publicationAuthorized: false as const};
  }
  async function replay(receiptId: string) {
    const retained = await retainedPage(receiptId), {page, s, claim} = retained;
    let chain: {pages: Awaited<ReturnType<typeof retainedPage>>[]; consumed: number} = {pages: [], consumed: 0};
    if (page.pageOrdinal === 1) {
      if (retained.retained.request.parameters.cursor !== '*' || retained.retained.request.checkpoint !== null ||
          claim.chain.lastReceiptId !== null || claim.chain.checkpoint !== null) return fail('replay-initial');
    } else {
      if (!claim.chain.lastReceiptId) return fail('replay-parent');
      chain = await ancestry(claim.chain.lastReceiptId, s);
      const previous = chain.pages.at(-1)!;
      if (previous.page.chainId !== page.chainId || previous.page.pageOrdinal + 1 !== page.pageOrdinal ||
          previous.page.nextCheckpoint !== retained.retained.request.checkpoint ||
          previous.page.nextCheckpoint !== retained.retained.request.parameters.cursor) return fail('replay-parent');
    }
    const result = await project({bytes: retained.retained.bytes, request: retained.retained.request,
      requestSha256: page.requestSha256, representationSha256: page.representationSha256,
      parser: s.value.parser, maxItems: retained.retained.remainingItems}, s, chain);
    if (result.draft.leads.length !== page.leadCount || result.draft.rejectedCount !== page.rejectedCount ||
        result.draft.truncated !== page.truncated || result.draft.providerLimited !== page.providerLimited ||
        result.draft.terminal !== page.terminal || result.draft.nextCheckpoint !== page.proposedCheckpoint) return fail('replay-receipt');
    return {...result, replayed: true as const, provenance: {...result.provenance, receiptId, representation: page.representation}};
  }
  const parse = async (input: DiscoveryCollectionParseInput) => (await inspect(input)).draft;
  return {provider: 'crossref' as const, parser: parse, parse, inspect, replay,
    async plan(sourceId: string, cursor = '*', parentReceiptId?: string) {
      const s = await source(sourceId);
      if (cursor !== '*') {
        if (!parentReceiptId) return fail('cursor-unbound');
        const previous = await ancestry(parentReceiptId, s);
        if (previous.parent.page.nextCheckpoint !== cursor || nowEpoch() >= Math.min(Date.parse(previous.parent.claim.expiresAt), Date.parse(previous.parent.page.committedAt) + CURSOR_TTL_MS)) return fail('cursor-expired-or-mismatched');
      } else if (parentReceiptId) return fail('initial-cursor');
      return {sourceId, parameters: {cursor}, endpoint: await constructDiscoveryEndpoint(s.template, [['cursor', cursor]]), scopeSha256: s.scope.scopeSha256};
    },
    async nextPage(receiptId: string) {
      const retained = await retainedPage(receiptId);
      if (retained.page.truncated || retained.page.rejectedCount || retained.page.providerLimited || retained.page.limitationCode !== null) return fail('page-incomplete');
      if (retained.page.nextCheckpoint !== null) {
        if (retained.page.nextCheckpoint !== retained.parsed.cursor || nowEpoch() >= Math.min(Date.parse(retained.claim.expiresAt), Date.parse(retained.page.committedAt) + CURSOR_TTL_MS)) return fail('cursor-expired-or-mismatched');
        await ancestry(receiptId, retained.s);
      }
      return retained.page.nextCheckpoint;
    },
    async distinctReviewedOriginCount(rawRefs: {id: string; revision: number}[]) {
      const refs = z.array(RevisionRef).min(1).max(128).parse(JSON.parse(canonical(rawRefs)));
      if (!trusted.distinctOriginCount) return fail('origin-unresolved');
      return count(await trusted.distinctOriginCount(refs));
    },
  };
}
