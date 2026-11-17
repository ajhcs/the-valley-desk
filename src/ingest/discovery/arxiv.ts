import { z } from 'zod';
import { XMLValidator } from 'fast-xml-parser';
import { DiscoveryInstant, makeDiscoveryDate } from '../../content/discovery-schema';
import { isCalendarDay } from '../../content/watch-schema';
import { canonicalDiscoveryEvidenceJson as canonical } from '../discovery-evidence-store';
import { regionalXmlDocument, xmlAttribute, type RegionalXmlElement } from '../regional-xml';
import { redactRegionalContactEmails as redact } from '../regional-privacy';
import { permittedPublicUrl } from '../regional-contracts';
import { normalizeDiscoveryCrossrefDoi } from './crossref';
import { constructDiscoveryEndpoint } from './endpoint';
import { DiscoveryRuntimeError, DiscoveryRuntimeSource, type DiscoveryIssuedPlan } from './runtime-contract';
import { DiscoverySourceRequest } from './source-contract';
import {
  DiscoveryCollectionDraft, DiscoveryCollectionPageReceipt,
  type DiscoveryCollectionParseInput, type DiscoveryCollectionLead, type DiscoveryCollectionClaim,
} from './collection-contract';
import type { DiscoveryTrustedAdapterRepresentation } from './adapter';

const ATOM = 'http://www.w3.org/2005/Atom';
const OPEN_SEARCH = 'http://a9.com/-/spec/opensearch/1.1/';
const ARXIV = 'http://arxiv.org/schemas/atom';
const XML = 'http://www.w3.org/XML/1998/namespace';
export const ARXIV_IDENTIFIER_VERSION = 'arxiv-base-version-v1' as const;
const category = z.string().max(64).regex(/^[a-z][a-z-]*(?:\.[A-Za-z][A-Za-z0-9-]*)?$/);
const term = z.string().trim().min(2).max(80).regex(/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u);
const scopeInput = z.object({
  declaredId: z.string().min(1).max(200),
  revision: z.number().int().positive().safe(),
  categories: z.array(category).max(10),
  terms: z.array(term).max(10),
  startDay: z.string().refine(isCalendarDay),
  endDay: z.string().refine(isCalendarDay),
  pageSize: z.number().int().min(1).max(100),
  maxPages: z.number().int().min(1).max(100),
  maxItems: z.number().int().min(1).max(1000),
  denominator: z.string().min(3).max(512),
}).strict();
export type DiscoveryArxivScopeInput = z.infer<typeof scopeInput>;
export type DiscoveryArxivScope = Readonly<Omit<DiscoveryArxivScopeInput, 'categories' | 'terms'> & {
  categories: readonly string[];
  terms: readonly string[];
  id: string;
  scopeSha256: string;
  searchQuery: string;
}>;
const qualifiedScopes = new WeakSet<object>();
function fail(code: string): never {
  throw new DiscoveryRuntimeError('parser-failed', `discovery-arxiv-${code}`);
}
const encode = (value: string) => new TextEncoder().encode(value);
async function digest(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(result), value => value.toString(16).padStart(2, '0')).join('');
}
/** Frozen query syntax only; qualification does not establish location or provider access. */
export async function qualifyDiscoveryArxivScope(input: DiscoveryArxivScopeInput): Promise<DiscoveryArxivScope> {
  const parsed = scopeInput.parse(JSON.parse(canonical(input)));
  if (!parsed.categories.length && !parsed.terms.length || parsed.startDay > parsed.endDay ||
      Date.parse(parsed.endDay) - Date.parse(parsed.startDay) > 366 * 86400000 ||
      parsed.terms.some(value => redact(value) !== value)) return fail('scope-invalid');
  const categories = [...new Set(parsed.categories)].sort(), terms = [...new Set(parsed.terms)].sort();
  const clauses = [categories.length ? `(${categories.map(value => `cat:${value}`).join(' OR ')})` : null,
    terms.length ? `(${terms.map(value => `all:"${value}"`).join(' OR ')})` : null,
    `submittedDate:[${parsed.startDay.replaceAll('-', '')}0000 TO ${parsed.endDay.replaceAll('-', '')}2359]`].filter(Boolean);
  const searchQuery = clauses.join(' AND ');
  if (searchQuery.length > 512) return fail('query-bound');
  const scopeSha256 = await digest(encode(canonical({...parsed, categories, terms, searchQuery})));
  const result = Object.freeze({...parsed, categories: Object.freeze(categories),
    terms: Object.freeze(terms), searchQuery, scopeSha256, id: `arxiv-scope:${scopeSha256}`});
  qualifiedScopes.add(result);
  return result;
}
export type DiscoveryArxivResolvers = {
  resolveSource(id: string): Promise<DiscoveryRuntimeSource | null>;
  resolveScope(id: string): Promise<DiscoveryArxivScope | null>;
  resolvePlan(id: string): Promise<DiscoveryIssuedPlan>;
  resolvePage(id: string): Promise<DiscoveryCollectionPageReceipt | null>;
  resolveRepresentation(ref: {id: string; revision: number}): Promise<DiscoveryTrustedAdapterRepresentation | null>;
  resolveClaim(id: string): Promise<DiscoveryCollectionClaim>;
  resolveChainPage(chainId: string, ordinal: number): Promise<DiscoveryCollectionPageReceipt | null>;
  now?(): string;
};
export type DiscoveryArxivMetadata = {
  baseId: string;
  version: number | null;
  versionedId: string | null;
  suppliedSubjectClass: string | null;
  originalId: string;
  publicUrl: string;
  sourceVersion: string;
  sourcePointer: string;
  title: string;
  authors: {index: number; name: string; affiliations: string[]; identityLinkProposals: string[];
    personId: null; currentEmploymentConfirmed: false}[];
  categories: {term: string; scheme: string | null}[];
  primaryCategory: string | null;
  journalReference: string | null;
  doiProposal: {original: string; canonical: string | null} | null;
  predecessorProposal: {baseId: string; version: number; verified: false} | null;
  rightsStatement: string | null;
  licenseProposals: {reportedValue: string; publicUrl: string | null; admitted: false}[];
  comment: string | null;
  statusProposals: string[];
  holds: string[];
  publicationAuthorized: false;
};
export type DiscoveryArxivGap = {code: 'malformed-entry' | 'duplicate-id' | 'changed-total' | 'truncated-page' | 'page-cap' | 'item-cap';
  entryIndex?: number; reason?: string};
function children(node: RegionalXmlElement, name: string, namespace = ATOM) {
  return node.children.filter(child => child.name === name && child.namespace === namespace);
}
function one(node: RegionalXmlElement, name: string, namespace = ATOM, required = true) {
  const values = children(node, name, namespace);
  if (values.length > 1 || required && values.length !== 1) return fail('xml-cardinality');
  return values[0];
}
function leaf(node: RegionalXmlElement | undefined): string {
  if (!node) return '';
  if (node.children.length) return fail('mixed-or-structured-text');
  return node.text.trim();
}
function display(value: string, cap: number) {
  const result = redact(value).trim();
  if (!result.length || result.length > cap) return fail('display-bound');
  return result;
}
function integer(value: string) {
  if (!/^(?:0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) return fail('integer');
  return Number(value);
}
function publicLink(value: string): string | null {
  if (redact(value) !== value || !permittedPublicUrl(value)) return null;
  const url = new URL(value);
  if (url.href !== value || url.search || url.hostname === 'home.arpa' || url.hostname.endsWith('.home.arpa')) return null;
  return value;
}
function parseXml(bytes: Uint8Array) {
  if (bytes.length > 48000) return fail('body-cap');
  let xml: string;
  try { xml = new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch { return fail('encoding'); }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) ||
      xml.replace(/&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/g, '').includes('&') ||
      XMLValidator.validate(xml) !== true) return fail('unsafe-xml');
  const roots = regionalXmlDocument(xml);
  if (roots.length !== 1 || roots[0].name !== 'feed' || roots[0].namespace !== ATOM) return fail('feed-vocabulary');
  const atomNames = new Set(['feed','entry','title','id','updated','published','summary','author','name','uri','category','link','rights']);
  const searchNames = new Set(['totalResults','startIndex','itemsPerPage']);
  const arxivNames = new Set(['affiliation','primary_category','doi','journal_ref','comment','license']);
  const validate = (node: RegionalXmlElement) => {
    if (![ATOM, OPEN_SEARCH, ARXIV].includes(node.namespace) ||
        node.attributes.some(attribute => attribute.namespace !== '' && attribute.namespace !== XML)) return fail('foreign-vocabulary');
    if (atomNames.has(node.name) && node.namespace !== ATOM || searchNames.has(node.name) && node.namespace !== OPEN_SEARCH ||
        arxivNames.has(node.name) && node.namespace !== ARXIV) return fail('misqualified-vocabulary');
    for (const child of node.children) validate(child);
  };
  validate(roots[0]);
  return roots[0];
}

/** Explicit EX16 subset; syntax does not prove that a submission exists. */
export function normalizeDiscoveryArxivIdentifier(originalId: unknown) {
  if (typeof originalId !== 'string' || originalId.length > 200 || /[^\x21-\x7e]/u.test(originalId)) return fail('identifier-unsupported');
  let value = originalId, wrapped = false;
  for (const prefix of ['https://arxiv.org/abs/', 'http://arxiv.org/abs/']) {
    if (value.startsWith(prefix)) { value = value.slice(prefix.length); wrapped = true; break; }
  }
  if (!wrapped && /^arxiv:/i.test(value)) value = value.slice(6);
  const versionMatch = /v([1-9]\d*)$/.exec(value);
  const version = versionMatch ? Number(versionMatch[1]) : null;
  if (version !== null && !Number.isSafeInteger(version)) return fail('version-bound');
  const bare = versionMatch ? value.slice(0, versionMatch.index) : value;
  let baseId: string, suppliedSubjectClass: string | null = null;
  const modern = /^(\d{2})(\d{2})\.(\d{4,5})$/.exec(bare);
  if (modern) {
    const stamp = Number(`${modern[1]}${modern[2]}`), month = Number(modern[2]);
    if (stamp < 704 || stamp > 9912 || month < 1 || month > 12 || Number(modern[3]) === 0 ||
        modern[3].length !== (stamp < 1501 ? 4 : 5)) return fail('identifier-date-sequence');
    baseId = bare;
  } else {
    const legacy = /^([a-z][a-z-]*)(?:\.([A-Z]{2}))?\/(\d{2})(\d{2})(\d{3})$/.exec(bare);
    if (!legacy) return fail('identifier-unsupported');
    const year = Number(legacy[3]) >= 91 ? 1900 + Number(legacy[3]) : 2000 + Number(legacy[3]);
    const month = Number(legacy[4]), coordinate = year * 100 + month;
    if (coordinate < 199107 || coordinate > 200703 || month < 1 || month > 12 || Number(legacy[5]) === 0) return fail('identifier-date-sequence');
    baseId = `${legacy[1]}/${legacy[3]}${legacy[4]}${legacy[5]}`;
    suppliedSubjectClass = legacy[2] ?? null;
    if (suppliedSubjectClass !== null && !['math', 'cs', 'nlin', 'q-bio'].includes(legacy[1])) return fail('legacy-class-unsupported');
  }
  const versionedId = version === null ? null : `${baseId}v${version}`;
  return {originalId, baseId, version, versionedId, suppliedSubjectClass,
    publicUrl: `https://arxiv.org/abs/${versionedId ?? baseId}`, identifierContract: ARXIV_IDENTIFIER_VERSION};
}
function checkFeedUrl(raw: string, expected: {searchQuery: string; start: number; pageSize: number}) {
  let url: URL;
  try { url = new URL(raw); } catch { return fail('feed-link'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['arxiv.org', 'export.arxiv.org'].includes(url.hostname) ||
      url.pathname !== '/api/query' || url.port || url.username || url.password || url.hash ||
      /[\u0000-\u0020\u007f]/u.test(raw)) return fail('feed-link');
  const values = new Map<string, string>();
  for (const [key, value] of url.searchParams) {
    if (values.has(key) || !['search_query','start','max_results','id_list','sortBy','sortOrder'].includes(key)) return fail('feed-link-query');
    values.set(key, value);
  }
  if (values.get('search_query') !== expected.searchQuery || values.get('start') !== String(expected.start) ||
      values.get('max_results') !== String(expected.pageSize) || (values.get('id_list') ?? '') !== '' ||
      values.has('sortBy') && values.get('sortBy') !== 'submittedDate' ||
      values.has('sortOrder') && values.get('sortOrder') !== 'ascending') return fail('feed-link-query');
}
function envelope(bytes: Uint8Array, scope: DiscoveryArxivScope, requestedStart: number) {
  const root = parseXml(bytes);
  const total = integer(leaf(one(root, 'totalResults', OPEN_SEARCH)));
  const start = integer(leaf(one(root, 'startIndex', OPEN_SEARCH)));
  const itemsPerPage = integer(leaf(one(root, 'itemsPerPage', OPEN_SEARCH)));
  const entries = children(root, 'entry');
  if (start !== requestedStart || entries.length > scope.pageSize || itemsPerPage > scope.pageSize ||
      itemsPerPage !== entries.length) return fail('page-binding');
  const self = children(root, 'link').filter(node => xmlAttribute(node, 'rel') === 'self');
  if (self.length !== 1) return fail('feed-self');
  checkFeedUrl(xmlAttribute(self[0], 'href') ?? '', {searchQuery: scope.searchQuery, start, pageSize: scope.pageSize});
  for (const link of children(root, 'link')) {
    if (xmlAttribute(link, 'rel') === 'next') checkFeedUrl(xmlAttribute(link, 'href') ?? '',
      {searchQuery: scope.searchQuery, start: start + entries.length, pageSize: scope.pageSize});
  }
  const feedUpdated = leaf(one(root, 'updated'));
  if (!DiscoveryInstant.safeParse(feedUpdated).success) return fail('feed-date');
  for (const entry of entries) {
    const id = leaf(one(entry, 'id'));
    if (/^https?:\/\/arxiv\.org\/api\/errors(?:#|\/|$)/.test(id)) return fail('provider-error');
  }
  return {root, entries, total, start, itemsPerPage, feedUpdated};
}
async function projectEntry(entry: RegionalXmlElement, index: number) {
  const identity = normalizeDiscoveryArxivIdentifier(leaf(one(entry, 'id')));
  let version = identity.version;
  const links = children(entry, 'link');
  for (const link of links.filter(node => xmlAttribute(node, 'rel') === 'alternate')) {
    const href = xmlAttribute(link, 'href') ?? '';
    if (!/^https?:\/\/arxiv\.org\/abs\//.test(href)) return fail('alternate-identity-link');
    const alternate = normalizeDiscoveryArxivIdentifier(href);
    if (alternate.baseId !== identity.baseId || version !== null && alternate.version !== null && alternate.version !== version) return fail('identifier-conflict');
    if (alternate.version !== null) version = alternate.version;
  }
  const versionedId = version === null ? null : `${identity.baseId}v${version}`;
  const titleNode = one(entry, 'title')!, titleType = xmlAttribute(titleNode, 'type');
  if (titleType !== undefined && titleType !== 'text') return fail('title-format');
  const title = display(leaf(titleNode), 512);
  const published = makeDiscoveryDate('instant', leaf(one(entry, 'published')));
  const updated = makeDiscoveryDate('instant', leaf(one(entry, 'updated')));
  if (published.precision !== 'instant' || updated.precision !== 'instant' || published.lowerEpochMs > updated.lowerEpochMs) return fail('source-date-order');
  const holds = ['editorial-review-required', 'person-identity-unresolved', 'regional-attribution-unverified',
    'current-employment-unknown', 'license-not-admitted', 'preprint-stage-only'];
  if (version === null) holds.push('source-version-unknown');
  const authorNodes = children(entry, 'author');
  if (authorNodes.length > 100) return fail('author-cap');
  const authors = authorNodes.map((author, authorIndex) => {
    const affiliations = children(author, 'affiliation', ARXIV).map(node => display(leaf(node), 1000));
    if (affiliations.length > 8) return fail('affiliation-cap');
    if (!affiliations.length) holds.push('affiliation-unknown');
    const uri = one(author, 'uri', ATOM, false);
    const identityLinkProposals = uri && publicLink(leaf(uri)) ? [leaf(uri)] : [];
    if (uri && !identityLinkProposals.length) holds.push('identity-link-unqualified');
    return {index: authorIndex, name: display(leaf(one(author, 'name')), 300), affiliations, identityLinkProposals,
      personId: null, currentEmploymentConfirmed: false as const};
  });
  if (!authors.length) holds.push('authors-unknown');
  const categories = children(entry, 'category').map(node => ({term: display(xmlAttribute(node, 'term') ?? '', 100),
    scheme: xmlAttribute(node, 'scheme') === undefined ? null : display(xmlAttribute(node, 'scheme')!, 200)}));
  if (categories.length > 30) return fail('category-cap');
  const primaryNode = one(entry, 'primary_category', ARXIV, false);
  const primaryCategory = primaryNode ? display(xmlAttribute(primaryNode, 'term') ?? '', 100) : null;
  const journal = one(entry, 'journal_ref', ARXIV, false);
  const journalReference = journal ? display(leaf(journal), 1000) : null;
  if (journalReference) holds.push('journal-reference-not-peer-review-evidence');
  const doiNode = one(entry, 'doi', ARXIV, false);
  let doiProposal: DiscoveryArxivMetadata['doiProposal'] = null;
  if (doiNode) {
    const original = display(leaf(doiNode), 512);
    let canonicalDoi: string | null = null;
    try { canonicalDoi = normalizeDiscoveryCrossrefDoi(original).canonicalDoi; } catch { holds.push('unsupported-doi-form'); }
    doiProposal = {original, canonical: canonicalDoi};
    holds.push('doi-target-unverified', 'cross-provider-equivalence-unverified');
  }
  const rights = one(entry, 'rights', ATOM, false), rightsStatement = rights ? display(leaf(rights), 1000) : null;
  const licenseProposals: DiscoveryArxivMetadata['licenseProposals'] = [];
  for (const link of links.filter(node => xmlAttribute(node, 'rel') === 'license')) {
    const reportedValue = display(xmlAttribute(link, 'href') ?? '', 512);
    licenseProposals.push({reportedValue, publicUrl: publicLink(reportedValue), admitted: false});
  }
  const extensionLicense = one(entry, 'license', ARXIV, false);
  if (extensionLicense) {
    const reportedValue = display(leaf(extensionLicense), 1000);
    licenseProposals.push({reportedValue, publicUrl: publicLink(reportedValue), admitted: false});
    holds.push('undocumented-license-extension');
  }
  if (licenseProposals.length > 10) return fail('license-cap');
  const commentNode = one(entry, 'comment', ARXIV, false), comment = commentNode ? display(leaf(commentNode), 2000) : null;
  const statusProposals = comment && /withdraw|retract|correct|erratum/i.test(comment)
    ? ['source-comment-status-review-required'] : [];
  if (statusProposals.length) holds.push('source-status-unverified');
  const predecessorProposal = version !== null && version > 1 ? {baseId: identity.baseId, version: version - 1, verified: false as const} : null;
  if (predecessorProposal) holds.push('predecessor-version-unverified');
  const semantic = {baseId: identity.baseId, version, stage: 'preprint', title, authors, categories, primaryCategory,
    journalReference, doiProposal, rightsStatement, licenseProposals, comment, statusProposals, published, updated};
  const sourceVersion = `${version === null ? 'unknown' : `v${version}`}:metadata:${await digest(encode(canonical(semantic)))}`;
  const metadata: DiscoveryArxivMetadata = {...identity, version, versionedId, publicUrl: `https://arxiv.org/abs/${versionedId ?? identity.baseId}`, sourceVersion, sourcePointer: `/feed/entry/${index}`, title, authors, categories,
    primaryCategory, journalReference, doiProposal, predecessorProposal, rightsStatement, licenseProposals, comment,
    statusProposals, holds: [...new Set(holds)], publicationAuthorized: false};
  const lead: DiscoveryCollectionLead = {nativeId: identity.baseId, kind: 'artifact', artifactKind: 'publication',
    displayName: title, sourceStage: 'preprint', sourceVersion, sourceDates: [{field: 'published', date: published}, {field: 'updated', date: updated}],
    relatedAccounts: [], unresolvedPeople: authors.map(author => author.name), publicationAuthorized: false};
  return {lead, metadata, entryPointer: `/feed/entry/${index}`};
}

export function createDiscoveryArxivAdapter(options: DiscoveryArxivResolvers) {
  const trusted = {...options}, clock = trusted.now ?? (() => new Date().toISOString());
  const now = () => {
    const value = DiscoveryInstant.safeParse(clock());
    if (!value.success) return fail('clock');
    return Date.parse(value.data);
  };
  async function source(id: string) {
    const resolved = await trusted.resolveSource(id);
    if (!resolved) return fail('source-missing');
    const value = DiscoveryRuntimeSource.parse(JSON.parse(canonical(resolved))), template = value.endpointTemplate;
    const scope = await trusted.resolveScope(value.scopeId);
    if (value.id !== id || value.provider !== 'arxiv' || template.origin !== 'https://export.arxiv.org' ||
        template.path !== '/api/query' || !scope || !qualifiedScopes.has(scope) || scope.id !== value.scopeId) return fail('source-binding');
    if (template.pageParameter !== 'start' || Object.keys(template.parameters).join(',') !== 'start' ||
        template.parameters.start.kind !== 'integer' || template.parameters.start.min !== 0 ||
        template.required.length !== 1 || template.required[0] !== 'start' ||
        template.fixed.search_query !== scope.searchQuery || template.fixed.max_results !== String(scope.pageSize) ||
        template.fixed.sortBy !== 'submittedDate' || template.fixed.sortOrder !== 'ascending' ||
        Object.keys(template.fixed).some(key => !['search_query','max_results','sortBy','sortOrder'].includes(key))) return fail('query-binding');
    return {value, template, scope};
  }
  function requestBinding(request: DiscoverySourceRequest, s: Awaited<ReturnType<typeof source>>) {
    if (request.provider !== 'arxiv' || request.sourceId !== s.value.id || request.installation !== s.value.installation ||
        request.scopeId !== s.scope.id || request.endpointConstructor !== s.template.id ||
        canonical(request.enrollment) !== canonical(s.value.enrollment) || canonical(request.configuration) !== canonical(s.value.configuration) ||
        canonical(request.permission) !== canonical(s.value.permission) || canonical(request.parser) !== canonical(s.value.parser) ||
        Object.keys(request.parameters).join(',') !== 'start') return fail('request-binding');
    const start = integer(request.parameters.start);
    if (start % s.scope.pageSize !== 0 || start >= s.scope.maxItems || start / s.scope.pageSize >= s.scope.maxPages) return fail('start-cap');
    return start;
  }
  async function retainedPage(id: string) {
    const resolved = await trusted.resolvePage(id);
    if (!resolved) return fail('receipt-missing');
    const page = DiscoveryCollectionPageReceipt.parse(JSON.parse(canonical(resolved)));
    const raw = await trusted.resolveRepresentation(page.representation);
    if (!raw) return fail('unretained');
    const retained = {...raw, bytes: new Uint8Array(raw.bytes), request: DiscoverySourceRequest.parse(JSON.parse(canonical(raw.request)))};
    const s = await source(page.sourceId), start = requestBinding(retained.request, s);
    if (page.id !== id || page.sourceRevision !== s.value.revision || Date.parse(page.committedAt) > now() ||
        retained.id !== page.representation.id || retained.revision !== page.representation.revision ||
        retained.representationSha256 !== page.representationSha256 || await digest(retained.bytes) !== page.representationSha256 ||
        await digest(encode(canonical(retained.request))) !== page.requestSha256) return fail('retained-binding');
    await constructDiscoveryEndpoint(s.template, Object.entries(retained.request.parameters));
    const resolvedClaim = await trusted.resolveClaim(page.claimId);
    const claim = {...resolvedClaim, source: DiscoveryRuntimeSource.parse(JSON.parse(canonical(resolvedClaim.source))),
      chain: {...resolvedClaim.chain}, sourceLease: {...resolvedClaim.sourceLease}};
    if (claim.id !== page.claimId || claim.roundId !== page.roundId || claim.slot !== page.slot || claim.issuedPlanId !== page.planId ||
        canonical(claim.source) !== canonical(s.value) || claim.chain.id !== page.chainId || claim.chain.sourceId !== page.sourceId ||
        claim.chain.sourceRevision !== page.sourceRevision || claim.chain.pageCount + 1 !== page.pageOrdinal ||
        !DiscoveryInstant.safeParse(claim.expiresAt).success || !DiscoveryInstant.safeParse(claim.processingDeadlineAt).success ||
        claim.sourceLease.expiresAt !== claim.expiresAt || Date.parse(page.committedAt) >= Date.parse(claim.expiresAt)) return fail('claim-binding');
    return {page, retained, s, claim, parsed: envelope(retained.bytes, s.scope, start)};
  }
  async function ancestry(parentId: string, s: Awaited<ReturnType<typeof source>>) {
    const parent = await retainedPage(parentId), chainId = parent.page.chainId;
    if (parent.page.sourceId !== s.value.id || parent.page.pageOrdinal >= s.scope.maxPages) return fail('parent-source');
    const pages: Awaited<ReturnType<typeof retainedPage>>[] = [];
    for (let ordinal = 1; ordinal <= parent.page.pageOrdinal; ordinal++) {
      const candidate = ordinal === parent.page.pageOrdinal ? parent.page : await trusted.resolveChainPage(chainId, ordinal);
      if (!candidate) return fail('ancestry-missing');
      const entry = ordinal === parent.page.pageOrdinal ? parent : await retainedPage(candidate.id);
      if (entry.page.chainId !== chainId || entry.page.pageOrdinal !== ordinal || entry.page.sourceId !== s.value.id ||
          entry.page.sourceRevision !== s.value.revision || entry.page.truncated || entry.page.rejectedCount || entry.page.providerLimited ||
          entry.page.terminal || entry.page.limitationCode !== null || entry.parsed.entries.length !== s.scope.pageSize ||
          entry.page.nextCheckpoint !== String(entry.parsed.start + entry.parsed.entries.length)) return fail('ancestry-binding');
      const prior = pages.at(-1);
      if (!prior && (entry.parsed.start !== 0 || entry.retained.request.checkpoint !== null ||
          entry.claim.chain.lastReceiptId !== null || entry.claim.chain.checkpoint !== null) ||
          prior && (entry.parsed.start !== prior.parsed.start + prior.parsed.entries.length || entry.parsed.total !== prior.parsed.total ||
            entry.retained.request.checkpoint !== prior.page.nextCheckpoint || entry.claim.chain.lastReceiptId !== prior.page.id ||
            entry.claim.chain.checkpoint !== prior.page.nextCheckpoint)) return fail('ancestry-sequence');
      pages.push(entry);
    }
    const consumed = pages.reduce((sum, entry) => sum + entry.parsed.entries.length, 0);
    if (consumed >= s.scope.maxItems) return fail('item-cap');
    return {pages, consumed, parent};
  }
  async function activeChain(input: DiscoveryCollectionParseInput, s: Awaited<ReturnType<typeof source>>) {
    const resolved = await trusted.resolvePlan(input.request.budgetReservation.id);
    const plan = {...resolved, request: DiscoverySourceRequest.parse(JSON.parse(canonical(resolved.request))),
      source: DiscoveryRuntimeSource.parse(JSON.parse(canonical(resolved.source))),
      ...(resolved.continuation ? {continuation: {...resolved.continuation}} : {})};
    if (plan.id !== input.request.budgetReservation.id || canonical(plan.request) !== canonical(input.request) ||
        plan.requestSha256 !== input.requestSha256 || canonical(plan.source) !== canonical(s.value) ||
        plan.endpoint !== await constructDiscoveryEndpoint(s.template, Object.entries(input.request.parameters))) return fail('issued-plan-binding');
    const start = integer(input.request.parameters.start);
    if (start === 0) {
      if (input.request.checkpoint !== null || plan.continuation) return fail('initial-page');
      return {pages: [] as Awaited<ReturnType<typeof retainedPage>>[], consumed: 0};
    }
    const continuation = plan.continuation;
    if (!continuation || input.request.checkpoint !== String(start)) return fail('continuation-required');
    const previous = await ancestry(continuation.parentReceiptId, s);
    if (continuation.sourceId !== s.value.id || continuation.scopeId !== s.scope.id || continuation.sourceRevision !== s.value.revision ||
        continuation.installation !== s.value.installation || continuation.querySha256 !== s.value.materialScope.requestScopeSha256 ||
        continuation.tokenSha256 !== await digest(encode(String(start))) ||
        !DiscoveryInstant.safeParse(continuation.expiresAt).success || Date.parse(continuation.expiresAt) <= now() ||
        previous.parent.page.nextCheckpoint !== String(start)) return fail('continuation-binding');
    return previous;
  }
  async function project(input: DiscoveryCollectionParseInput, s: Awaited<ReturnType<typeof source>>,
    chain: {pages: Awaited<ReturnType<typeof retainedPage>>[]; consumed: number}) {
    const parsed = envelope(input.bytes, s.scope, integer(input.request.parameters.start));
    const leads: DiscoveryCollectionLead[] = [], metadata: DiscoveryArxivMetadata[] = [], gaps: DiscoveryArxivGap[] = [];
    const seen = new Set<string>();
    for (const previous of chain.pages) for (const entry of previous.parsed.entries) {
      const identity = normalizeDiscoveryArxivIdentifier(leaf(one(entry, 'id')));
      seen.add(identity.baseId);
    }
    const cap = Math.min(input.maxItems, s.scope.maxItems - chain.consumed);
    let rejectedCount = 0;
    for (let index = 0; index < parsed.entries.length; index++) {
      if (index >= cap) { rejectedCount++; gaps.push({code: 'item-cap', entryIndex: index}); continue; }
      try {
        const entry = await projectEntry(parsed.entries[index], index);
        if (seen.has(entry.lead.nativeId)) { rejectedCount++; gaps.push({code: 'duplicate-id', entryIndex: index}); continue; }
        seen.add(entry.lead.nativeId); leads.push(entry.lead); metadata.push(entry.metadata);
      } catch (error) {
        rejectedCount++; gaps.push({code: 'malformed-entry', entryIndex: index,
          reason: error instanceof DiscoveryRuntimeError ? error.code : 'unsupported-entry-field'});
      }
    }
    const consumed = chain.consumed + parsed.entries.length, pageCount = chain.pages.length + 1;
    let providerLimited = false, nextCheckpoint: string | null = null;
    if (parsed.total < parsed.start + parsed.entries.length ||
        chain.pages.some(page => page.parsed.total !== parsed.total)) { providerLimited = true; gaps.push({code: 'changed-total'}); }
    const terminal = parsed.start + parsed.entries.length === parsed.total;
    if (!terminal && parsed.entries.length < s.scope.pageSize) { providerLimited = true; gaps.push({code: 'truncated-page'}); }
    if (!terminal) {
      if (pageCount >= s.scope.maxPages) { providerLimited = true; gaps.push({code: 'page-cap'}); }
      else if (consumed >= s.scope.maxItems) { providerLimited = true; gaps.push({code: 'item-cap'}); }
      if (!providerLimited && rejectedCount === 0) {
        nextCheckpoint = String(parsed.start + parsed.entries.length);
        await constructDiscoveryEndpoint(s.template, [['start', nextCheckpoint]]);
      }
    }
    if (rejectedCount || providerLimited) nextCheckpoint = null;
    const draft = DiscoveryCollectionDraft.parse({schemaVersion: 'discovery-collection-v1', requestSha256: input.requestSha256,
      representationSha256: input.representationSha256, parser: input.parser, representationFormat: 'text', leads,
      terminal: terminal && !providerLimited && rejectedCount === 0, nextCheckpoint, rejectedCount,
      truncated: parsed.entries.length > cap, providerLimited});
    return {draft, metadata, gaps, reportedTotal: parsed.total, consumedItems: consumed, pageCount,
      feedUpdated: parsed.feedUpdated, publicationAuthorized: false as const,
      provenance: {sourceId: s.value.id, sourceRevision: s.value.revision, scopeId: s.scope.id, scopeSha256: s.scope.scopeSha256,
        request: input.request, requestSha256: input.requestSha256, representationSha256: input.representationSha256,
        parentReceiptId: chain.pages.at(-1)?.page.id ?? null}};
  }
  async function inspect(supplied: DiscoveryCollectionParseInput) {
    const input = {...supplied, bytes: new Uint8Array(supplied.bytes),
      request: DiscoverySourceRequest.parse(JSON.parse(canonical(supplied.request))), parser: {...supplied.parser}};
    const s = await source(input.request.sourceId);
    requestBinding(input.request, s);
    if (canonical(input.parser) !== canonical(s.value.parser) || !Number.isSafeInteger(input.maxItems) || input.maxItems < 1 ||
        input.maxItems > 100 || await digest(input.bytes) !== input.representationSha256 ||
        await digest(encode(canonical(input.request))) !== input.requestSha256) return fail('input-binding');
    return project(input, s, await activeChain(input, s));
  }
  async function replay(receiptId: string) {
    const retained = await retainedPage(receiptId), {page, s, claim} = retained;
    let chain: {pages: Awaited<ReturnType<typeof retainedPage>>[]; consumed: number} = {pages: [], consumed: 0};
    if (page.pageOrdinal === 1) {
      if (retained.parsed.start !== 0 || retained.retained.request.checkpoint !== null ||
          claim.chain.lastReceiptId !== null || claim.chain.checkpoint !== null) return fail('replay-initial');
    } else {
      if (!claim.chain.lastReceiptId) return fail('replay-parent');
      chain = await ancestry(claim.chain.lastReceiptId, s);
      const prior = chain.pages.at(-1)!;
      if (prior.page.chainId !== page.chainId || prior.page.pageOrdinal + 1 !== page.pageOrdinal ||
          prior.page.nextCheckpoint !== retained.retained.request.parameters.start ||
          prior.page.nextCheckpoint !== retained.retained.request.checkpoint) return fail('replay-parent');
    }
    const result = await project({bytes: retained.retained.bytes, request: retained.retained.request,
      requestSha256: page.requestSha256, representationSha256: page.representationSha256, parser: s.value.parser,
      maxItems: retained.retained.remainingItems}, s, chain);
    if (result.draft.leads.length !== page.leadCount || result.draft.rejectedCount !== page.rejectedCount ||
        result.draft.truncated !== page.truncated || result.draft.providerLimited !== page.providerLimited ||
        result.draft.terminal !== page.terminal || result.draft.nextCheckpoint !== page.proposedCheckpoint) return fail('replay-receipt');
    return {...result, replayed: true as const, provenance: {...result.provenance, receiptId, representation: page.representation}};
  }
  const parse = async (input: DiscoveryCollectionParseInput) => (await inspect(input)).draft;
  return {provider: 'arxiv' as const, parser: parse, parse, inspect, replay,
    async plan(sourceId: string, start = 0, parentReceiptId?: string) {
      const s = await source(sourceId);
      if (!Number.isSafeInteger(start) || start < 0) return fail('start');
      const parameters = {start: String(start)};
      if (start % s.scope.pageSize !== 0 || start >= s.scope.maxItems || start / s.scope.pageSize >= s.scope.maxPages) return fail('start-cap');
      if (start !== 0) {
        if (!parentReceiptId) return fail('continuation-required');
        const previous = await ancestry(parentReceiptId, s);
        if (previous.parent.page.nextCheckpoint !== String(start)) return fail('continuation-binding');
      } else if (parentReceiptId) return fail('initial-page');
      return {sourceId, parameters, endpoint: await constructDiscoveryEndpoint(s.template, Object.entries(parameters)), scopeSha256: s.scope.scopeSha256};
    },
    async nextPage(receiptId: string) {
      const retained = await retainedPage(receiptId);
      if (retained.page.truncated || retained.page.rejectedCount || retained.page.providerLimited || retained.page.limitationCode !== null) return fail('page-incomplete');
      if (retained.page.nextCheckpoint !== null) await ancestry(receiptId, retained.s);
      return retained.page.nextCheckpoint;
    },
  };
}
