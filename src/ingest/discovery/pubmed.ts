import { z } from 'zod';
import { XMLValidator } from 'fast-xml-parser';
import { DISCOVERY_COUNTY_KEYS, makeDiscoveryDate } from '../../content/discovery-schema';
import { isCalendarDay } from '../../content/watch-schema';
import { canonicalDiscoveryEvidenceJson as canonical } from '../discovery-evidence-store';
import {
  RegionalEvidence, RegionalInstitution, permittedPublicUrl, verifyRegionalEvidence,
} from '../regional-contracts';
import { regionalXmlDocument, xmlAttribute, type RegionalXmlElement } from '../regional-xml';
import { redactRegionalContactEmails as redact } from '../regional-privacy';
import { looksInstructionLike } from '../untrusted-text';
import { constructDiscoveryEndpoint } from './endpoint';
import { DiscoveryRuntimeError, DiscoveryRuntimeSource } from './runtime-contract';
import { DiscoverySourceRequest } from './source-contract';
import {
  DiscoveryCollectionDraft, DiscoveryCollectionPageReceipt,
  type DiscoveryCollectionParseInput, type DiscoveryCollectionLead,
} from './collection-contract';
import type { DiscoveryTrustedAdapterRepresentation } from './adapter';

const ORIGIN = 'https://eutils.ncbi.nlm.nih.gov';
const SEARCH_PATH = '/entrez/eutils/esearch.fcgi';
const FETCH_PATH = '/entrez/eutils/efetch.fcgi';
const safeLiteral = z.string().min(2).max(200).regex(/^[^"\[\]\\\u0000-\u001f\u007f]+$/u);
const scopeInput = z.object({
  id: z.string().min(1).max(200),
  revision: z.number().int().positive().safe(),
  institutionLiteral: safeLiteral,
  locationLiteral: safeLiteral,
  county: z.enum(DISCOVERY_COUNTY_KEYS),
  searchLiteral: safeLiteral,
  startDay: z.string().refine(isCalendarDay),
  endDay: z.string().refine(isCalendarDay),
  pageSize: z.number().int().min(1).max(5),
  maxOffset: z.number().int().min(0).max(100),
  denominator: z.string().min(3).max(512),
  institution: RegionalInstitution,
  evidence: RegionalEvidence,
  retained: z.object({url: z.string(), observedAt: z.string(), body: z.string()}).strict(),
}).strict();
export type DiscoveryPubmedScopeInput = z.infer<typeof scopeInput>;
export type DiscoveryPubmedScope = Readonly<Omit<DiscoveryPubmedScopeInput, 'retained'> & {
  term: string;
  scopeSha256: string;
  declaredScopeId: string;
}>;
const qualifiedScopes = new WeakSet<object>();
function fail(code: string): never {
  throw new DiscoveryRuntimeError('parser-failed', `discovery-pubmed-${code}`);
}
async function digest(bytes: Uint8Array): Promise<string> {
  const value = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(value), x => x.toString(16).padStart(2, '0')).join('');
}
const encode = (value: string) => new TextEncoder().encode(value);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}
function literalPresent(value: string, literal: string) {
  const haystack = value.toLocaleLowerCase('en-US'), needle = literal.toLocaleLowerCase('en-US');
  let position = haystack.indexOf(needle);
  while (position !== -1) {
    const before = haystack[position - 1] ?? '', after = haystack[position + needle.length] ?? '';
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
    position = haystack.indexOf(needle, position + 1);
  }
  return false;
}
function regionalAddressPresent(quote: string, scope: Pick<DiscoveryPubmedScopeInput, 'county' | 'institutionLiteral' | 'locationLiteral'>) {
  const [state, county] = scope.county.split(':');
  const statePattern = state === 'PA' ? '(?:PA|Pennsylvania)' : '(?:NJ|New Jersey)';
  const countyPattern = county === 'Philadelphia' ? 'Philadelphia(?: County)?' : `${county} County`;
  // Require an address-like county/state pair in the same bounded statement as
  // the institution and locality; unrelated state mentions do not qualify it.
  const address = new RegExp(`\\b${countyPattern}\\s*,\\s*${statePattern}\\b`, 'i');
  return quote.split(/[;\n]|[.!?]\s+/).some(statement =>
    literalPresent(statement, scope.institutionLiteral) &&
    literalPresent(statement, scope.locationLiteral) && address.test(statement));
}
/** Separate evidence qualification; this is not provider enrollment or public admission. */
export async function qualifyDiscoveryPubmedScope(input: DiscoveryPubmedScopeInput): Promise<DiscoveryPubmedScope> {
  const checked = scopeInput.parse(JSON.parse(canonical(input)));
  const {institution, evidence, retained} = checked;
  if (checked.startDay > checked.endDay ||
      Date.parse(checked.endDay) - Date.parse(checked.startDay) > 90 * 86400000 ||
      institution.regionalScope !== 'core' || checked.institutionLiteral !== institution.name ||
      checked.searchLiteral !== checked.institutionLiteral || !institution.evidenceIds.includes(evidence.id) ||
      !permittedPublicUrl(evidence.url, institution.officialHosts) ||
      !await verifyRegionalEvidence(evidence, retained) ||
      !literalPresent(evidence.quote, checked.institutionLiteral) ||
      !literalPresent(evidence.quote, checked.locationLiteral) ||
      !regionalAddressPresent(evidence.quote, checked) ||
      [checked.institutionLiteral, checked.locationLiteral, checked.searchLiteral].some(value => redact(value) !== value) ||
      looksInstructionLike(evidence.quote)) return fail('scope-unqualified');
  const term = `"${checked.searchLiteral}"[Affiliation] AND ("${checked.startDay.replaceAll('-', '/')}"[Date - Publication] : "${checked.endDay.replaceAll('-', '/')}"[Date - Publication])`;
  const {retained: _retained, ...scope} = checked;
  void _retained;
  const scopeSha256 = await digest(encode(canonical({...scope, term})));
  const result = freeze({...scope, term, declaredScopeId: scope.id, id: `pubmed-scope:${scopeSha256}`, scopeSha256});
  qualifiedScopes.add(result);
  return result;
}
export type DiscoveryPubmedResolvers = {
  resolveSource(id: string): Promise<DiscoveryRuntimeSource | null>;
  resolvePage(id: string): Promise<DiscoveryCollectionPageReceipt | null>;
  resolveRepresentation(ref: {id: string; revision: number}): Promise<DiscoveryTrustedAdapterRepresentation | null>;
  resolveScope(scopeId: string): Promise<DiscoveryPubmedScope | null>;
  searchReceiptForFetchSource(sourceId: string): Promise<string | null>;
};
export type DiscoveryPubmedGap = {
  code: 'metadata-pending' | 'missing-pmid' | 'author-coverage-partial' | 'regional-affiliation-missing' | 'search-cap';
  nativeId?: string;
};
export type DiscoveryPubmedAuthor = {
  authorIndex: number;
  name: string | null;
  personId: null;
  currentEmploymentConfirmed: false;
  affiliations: {
    reportedText: string;
    institutionLiteralPresent: boolean;
    locationLiteralPresent: boolean;
    historicalRegionalCandidate: boolean;
    basis: 'pubmed-author-affiliation-at-publication';
  }[];
};
export type DiscoveryPubmedMetadata = {
  pmid: string;
  sourceVersion: string;
  doiProposal: string | null;
  authors: DiscoveryPubmedAuthor[];
  publicationTypes: string[];
  correctionRelations: {type: string; pmid: string | null}[];
  currentEmploymentConfirmed: false;
  completeAuthorCoverageClaimed: false;
  publicationAuthorized: false;
};
function pmid(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) return fail('pmid');
  return value;
}
function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('object');
  return value as Record<string, any>;
}
/** NCBI warnings can change the effective query; only documented empty shapes are safe. */
function hasDiagnostics(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
  const fields = ['phrasesignored', 'quotedphrasesnotfound', 'outputmessages'];
  return Object.entries(value).some(([key, messages]) =>
    !fields.includes(key.toLowerCase()) || !Array.isArray(messages) || messages.length !== 0);
}
function checkDiagnostics(value: Record<string, unknown>): void {
  for (const [key, diagnostic] of Object.entries(value)) {
    const name = key.toLowerCase();
    if (name === 'error' || name === 'errorlist') return fail('search-error');
    if (name === 'warning' || name === 'warninglist' && hasDiagnostics(diagnostic)) return fail('search-warning');
  }
}
function integer(value: unknown): number {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) return fail('integer');
  return Number(value);
}
const children = (node: RegionalXmlElement, name: string) => node.children.filter(child => child.name === name);
function one(node: RegionalXmlElement, name: string, required = true): RegionalXmlElement | undefined {
  const rows = children(node, name);
  if (rows.length > 1 || required && rows.length !== 1) return fail('xml-cardinality');
  return rows[0];
}
function text(node: RegionalXmlElement | undefined): string {
  if (!node) return '';
  // The shared XML projection does not preserve text/element interleaving.
  // Refuse mixed content rather than reorder a source title or affiliation.
  if (node.children.length && node.text.trim()) return fail('mixed-content');
  return (node.text + node.children.map(child => text(child)).join(' ')).trim();
}
function display(value: string, cap: number): string {
  const clean = redact(value).trim();
  if (!clean.length || clean.length > cap) return fail('display-bound');
  return clean;
}
function xmlRoot(bytes: Uint8Array): RegionalXmlElement {
  let xml: string;
  try { xml = new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch { return fail('encoding'); }
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(xml)) return fail('unsafe-xml');
  const declarations = xml.match(/<!DOCTYPE[^>]*>/gi) ?? [];
  if (declarations.length > 1 || declarations.some(value => !/^<!DOCTYPE\s+PubmedArticleSet\s+PUBLIC\s+"-\/\/NLM\/\/DTD PubMedArticle,[^"<>\[\]]+"\s+"https:\/\/dtd\.nlm\.nih\.gov\/ncbi\/pubmed\/out\/pubmed_\d{6}\.dtd"\s*>$/i.test(value))) return fail('unsafe-dtd');
  xml = xml.replace(/<!DOCTYPE[^>]*>/gi, '');
  if (xml.replace(/&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/g, '').includes('&')) return fail('unsupported-entity');
  if (XMLValidator.validate(xml) !== true) return fail('invalid-xml');
  const roots = regionalXmlDocument(xml);
  if (roots.length !== 1 || roots[0].name !== 'PubmedArticleSet') return fail('xml-root');
  const check = (node: RegionalXmlElement) => {
    if (node.namespace !== '' || node.attributes.some(attribute => attribute.namespace !== '')) return fail('xml-namespace');
    for (const child of node.children) check(child);
  };
  check(roots[0]);
  if (roots[0].children.some(node => node.name !== 'PubmedArticle')) return fail('xml-vocabulary');
  return roots[0];
}
function publicationDate(node: RegionalXmlElement | undefined) {
  if (!node) return makeDiscoveryDate('unknown', null);
  const year = text(one(node, 'Year', false));
  const rawMonth = text(one(node, 'Month', false));
  const day = text(one(node, 'Day', false));
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const month = /^\d{1,2}$/.test(rawMonth) ? rawMonth.padStart(2, '0') :
    months.includes(rawMonth) ? String(months.indexOf(rawMonth) + 1).padStart(2, '0') : '';
  if (!/^\d{4}$/.test(year)) return makeDiscoveryDate('unknown', redact(text(node)).slice(0, 200) || null);
  if (!rawMonth && !day) return makeDiscoveryDate('year', year);
  if (!month) return makeDiscoveryDate('unknown', redact(text(node)).slice(0, 200) || null);
  if (!day) return makeDiscoveryDate('month', `${year}-${month}`);
  if (!/^\d{1,2}$/.test(day)) return fail('publication-date');
  return makeDiscoveryDate('day', `${year}-${month}-${day.padStart(2, '0')}`);
}

export function createDiscoveryPubmedAdapter(resolvers: DiscoveryPubmedResolvers) {
  const trusted = {...resolvers};
  async function source(id: string) {
    const resolved = await trusted.resolveSource(id);
    if (!resolved) return fail('source-missing');
    const value = DiscoveryRuntimeSource.parse(JSON.parse(canonical(resolved)));
    if (value.id !== id) return fail('source-identity');
    const template = value.endpointTemplate;
    if (value.provider !== 'pubmed' || template.origin !== ORIGIN ||
        ![SEARCH_PATH, FETCH_PATH].includes(template.path)) return fail('source-route');
    const scope = await trusted.resolveScope(value.scopeId);
    if (!scope || !qualifiedScopes.has(scope) || scope.id !== value.scopeId) return fail('scope-unqualified');
    if (template.path === FETCH_PATH) {
      const receiptId = await trusted.searchReceiptForFetchSource(value.id);
      if (!receiptId || value.id !== await fetchSourceId(receiptId)) return fail('fetch-source-binding');
    }
    return {value, scope, template};
  }
  function binding(request: DiscoverySourceRequest, s: Awaited<ReturnType<typeof source>>) {
    const value = s.value;
    if (request.provider !== 'pubmed' || request.sourceId !== value.id ||
        request.scopeId !== value.scopeId || request.installation !== value.installation ||
        request.endpointConstructor !== s.template.id ||
        canonical(request.enrollment) !== canonical(value.enrollment) ||
        canonical(request.configuration) !== canonical(value.configuration) ||
        canonical(request.permission) !== canonical(value.permission) ||
        canonical(request.parser) !== canonical(value.parser)) return fail('request-binding');
  }
  function effective(s: Awaited<ReturnType<typeof source>>, parameters: Record<string, string>) {
    return {...s.template.fixed, ...parameters};
  }
  function searchParameters(s: Awaited<ReturnType<typeof source>>, parameters: Record<string, string>) {
    const all = effective(s, parameters), scope = s.scope;
    const offset = integer(all.retstart ?? '0');
    if (s.template.path !== SEARCH_PATH || all.db !== 'pubmed' || all.retmode !== 'json' ||
        all.term !== scope.term || all.retmax !== String(scope.pageSize) || all.sort !== 'pub date' ||
        offset > scope.maxOffset || offset % scope.pageSize !== 0 ||
        Object.keys(all).some(key => !['db','term','retmode','retmax','retstart','sort','tool'].includes(key))) return fail('search-parameters');
    return {all, offset};
  }
  function parseSearch(bytes: Uint8Array, s: Awaited<ReturnType<typeof source>>, parameters: Record<string, string>) {
    const {offset} = searchParameters(s, parameters);
    let decoded: unknown;
    try { decoded = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); } catch { return fail('search-json'); }
    const root = object(decoded);
    checkDiagnostics(root);
    const result = object(root.esearchresult);
    checkDiagnostics(result);
    if (!Array.isArray(result.idlist)) return fail('search-error');
    const ids = result.idlist.map(pmid), count = integer(result.count), retmax = integer(result.retmax);
    if (new Set(ids).size !== ids.length || ids.length > s.scope.pageSize ||
        integer(result.retstart) !== offset || retmax > s.scope.pageSize || retmax < ids.length ||
        count < offset + ids.length || ids.length !== Math.min(s.scope.pageSize, count - offset)) return fail('search-result-binding');
    return {ids, count, offset};
  }
  async function retainedPage(id: string) {
    const resolvedPage = await trusted.resolvePage(id);
    if (!resolvedPage) return fail('receipt-missing');
    const page = DiscoveryCollectionPageReceipt.parse(JSON.parse(canonical(resolvedPage)));
    if (page.id !== id) return fail('receipt-binding');
    const resolved = await trusted.resolveRepresentation(page.representation);
    if (!resolved) return fail('unretained');
    const representation = {...resolved, bytes: new Uint8Array(resolved.bytes),
      request: DiscoverySourceRequest.parse(JSON.parse(canonical(resolved.request)))};
    const request = representation.request, s = await source(page.sourceId);
    binding(request, s);
    await constructDiscoveryEndpoint(s.template, Object.entries(request.parameters));
    if (s.value.revision !== page.sourceRevision || representation.id !== page.representation.id ||
        representation.revision !== page.representation.revision ||
        representation.representationSha256 !== page.representationSha256 ||
        await digest(representation.bytes) !== page.representationSha256 ||
        await digest(encode(canonical(request))) !== page.requestSha256) return fail('receipt-binding');
    return {page, representation, request, s};
  }
  async function searchBinding(receiptId: string) {
    const retained = await retainedPage(receiptId);
    if (retained.page.truncated || retained.page.rejectedCount || retained.page.leadCount !== 0 ||
        retained.s.template.path !== SEARCH_PATH) return fail('search-receipt');
    const result = parseSearch(retained.representation.bytes, retained.s, retained.request.parameters);
    return {...result, inventoryLimited: retained.page.providerLimited || result.count > Math.min(10000, retained.s.scope.maxOffset + retained.s.scope.pageSize), receiptId, sourceId: retained.s.value.id, scopeId: retained.s.scope.id,
      scopeSha256: retained.s.scope.scopeSha256, searchRequest: retained.request,
      representation: retained.page.representation, representationSha256: retained.page.representationSha256};
  }
  async function fetchSourceId(searchReceiptId: string) {
    const search = await searchBinding(searchReceiptId);
    const scope = (await source(search.sourceId)).scope;
    const batch = {searchReceiptId, searchRequestSha256: await digest(encode(canonical(search.searchRequest))),
      searchRepresentationSha256: search.representationSha256, scopeId: scope.id, scopeRevision: scope.revision,
      scopeSha256: scope.scopeSha256, ids: search.ids, query: scope.term,
      startDay: scope.startDay, endDay: scope.endDay, offset: search.offset};
    return `pubmed-fetch:${await digest(encode(canonical(batch)))}`;
  }
  async function fetchPlan(searchReceiptId: string, fetchSource: string) {
    const search = await searchBinding(searchReceiptId), s = await source(fetchSource);
    if (fetchSource !== await fetchSourceId(searchReceiptId)) return fail('fetch-source-binding');
    if (s.template.path !== FETCH_PATH || s.scope.scopeSha256 !== search.scopeSha256 || !search.ids.length) return fail('fetch-search-scope');
    const parameters: Record<string, string> = Object.hasOwn(s.template.fixed, 'id') ? {} : {id: search.ids.join(',')};
    const all = effective(s, parameters);
    if (all.db !== 'pubmed' || all.retmode !== 'xml' || all.id !== search.ids.join(',') ||
        Object.keys(all).some(key => !['db','retmode','id','tool'].includes(key))) return fail('fetch-parameters');
    const endpoint = await constructDiscoveryEndpoint(s.template, Object.entries(parameters));
    return {sourceId: fetchSource, parameters, endpoint, searchReceiptId, requestedPmids: search.ids,
      scopeSha256: search.scopeSha256, searchInventoryLimited: search.inventoryLimited,
      searchCoverageGaps: search.inventoryLimited ? ['search-cap'] as const : [], inventoryComplete: false as const};
  }
  async function inspect(supplied: DiscoveryCollectionParseInput) {
    const input = {...supplied, bytes: new Uint8Array(supplied.bytes),
      request: DiscoverySourceRequest.parse(JSON.parse(canonical(supplied.request))), parser: {...supplied.parser}};
    const s = await source(input.request.sourceId);
    binding(input.request, s);
    if (input.bytes.length > 48000 || !Number.isSafeInteger(input.maxItems) || input.maxItems < 1 ||
        input.maxItems > 100 || canonical(input.parser) !== canonical(s.value.parser) ||
        await digest(input.bytes) !== input.representationSha256 ||
        await digest(encode(canonical(input.request))) !== input.requestSha256) return fail('input-binding');
    await constructDiscoveryEndpoint(s.template, Object.entries(input.request.parameters));
    const leads: DiscoveryCollectionLead[] = [], metadata: DiscoveryPubmedMetadata[] = [], gaps: DiscoveryPubmedGap[] = [];
    let terminal = false, nextCheckpoint: string | null = null, providerLimited = false;
    let searchReceiptId: string | null = null;
    if (s.template.path === SEARCH_PATH) {
      const result = parseSearch(input.bytes, s, input.request.parameters);
      terminal = result.ids.length === 0 && result.count === 0;
      if (result.ids.length) gaps.push({code: 'metadata-pending'});
      if (result.offset + result.ids.length < result.count) {
        const next = result.offset + s.scope.pageSize;
        if (next > s.scope.maxOffset || result.count > 10000) {
          providerLimited = true;
          gaps.push({code: 'search-cap'});
        } else {
          if (s.template.pageParameter !== 'retstart') return fail('search-pagination');
          await constructDiscoveryEndpoint(s.template, Object.entries({...input.request.parameters, retstart: String(next)}));
          nextCheckpoint = String(next);
        }
      }
    } else {
      searchReceiptId = await trusted.searchReceiptForFetchSource(s.value.id);
      if (!searchReceiptId) return fail('fetch-search-required');
      const plan = await fetchPlan(searchReceiptId, s.value.id);
      if (plan.searchInventoryLimited) gaps.push({code: 'search-cap'});
      if (canonical(input.request.parameters) !== canonical(plan.parameters)) return fail('fetch-id-binding');
      const root = xmlRoot(input.bytes), seen = new Set<string>();
      for (const entry of root.children) {
        const med = one(entry, 'MedlineCitation')!, article = one(med, 'Article')!;
        const idNode = one(med, 'PMID')!, id = pmid(text(idNode));
        if (!plan.requestedPmids.includes(id) || seen.has(id)) return fail('unrequested-or-duplicate-pmid');
        seen.add(id);
        const title = display(text(one(article, 'ArticleTitle')), 512);
        const authorList = one(article, 'AuthorList', false);
        const authorNodes = authorList ? children(authorList, 'Author') : [];
        if (authorNodes.length > 100) return fail('author-cap');
        const authors = authorNodes.map((author, authorIndex): DiscoveryPubmedAuthor => {
          const name = [text(one(author, 'ForeName', false)), text(one(author, 'LastName', false))].filter(Boolean).join(' ') ||
            text(one(author, 'CollectiveName', false)) || text(one(author, 'Initials', false));
          const info = children(author, 'AffiliationInfo');
          if (info.length > 8) return fail('affiliation-cap');
          return {authorIndex, name: name ? display(name, 300) : null, personId: null, currentEmploymentConfirmed: false,
            affiliations: info.map(row => {
              const reportedText = display(text(one(row, 'Affiliation')), 2000);
              const institutionLiteralPresent = literalPresent(reportedText, s.scope.institutionLiteral);
              const locationLiteralPresent = literalPresent(reportedText, s.scope.locationLiteral);
              return {reportedText, institutionLiteralPresent, locationLiteralPresent,
                historicalRegionalCandidate: institutionLiteralPresent && locationLiteralPresent && !looksInstructionLike(reportedText),
                basis: 'pubmed-author-affiliation-at-publication'};
            })};
        });
        if (!authors.length || authors.some(author => !author.affiliations.length) ||
            authorList && xmlAttribute(authorList, 'CompleteYN') === 'N') gaps.push({code: 'author-coverage-partial', nativeId: id});
        if (!authors.some(author => author.affiliations.some(row => row.historicalRegionalCandidate))) gaps.push({code: 'regional-affiliation-missing', nativeId: id});
        const journal = one(article, 'Journal', false), issue = journal && one(journal, 'JournalIssue', false);
        const date = publicationDate(issue && one(issue, 'PubDate', false));
        const sourceDates = [{field: 'journal_publication', date}];
        const electronic = children(article, 'ArticleDate').find(node => xmlAttribute(node, 'DateType') === 'Electronic');
        if (electronic) sourceDates.push({field: 'electronic_publication', date: publicationDate(electronic)});
        const data = one(entry, 'PubmedData', false), idList = data && one(data, 'ArticleIdList', false);
        const doiNode = idList && children(idList, 'ArticleId').find(node => xmlAttribute(node, 'IdType') === 'doi');
        const doiRaw = text(doiNode);
        const doiProposal = /^10\.\d{4,9}\/\S+$/.test(doiRaw) && doiRaw.length <= 200 && redact(doiRaw) === doiRaw ? doiRaw : null;
        const typeList = one(article, 'PublicationTypeList', false);
        const publicationTypes = typeList ? children(typeList, 'PublicationType').map(node => display(text(node), 200)) : [];
        const correctionList = one(med, 'CommentsCorrectionsList', false);
        const correctionRelations = correctionList ? children(correctionList, 'CommentsCorrections').map(node => ({
          type: display(xmlAttribute(node, 'RefType') ?? 'unknown', 100),
          pmid: one(node, 'PMID', false) ? pmid(text(one(node, 'PMID'))) : null,
        })) : [];
        const version = xmlAttribute(idNode, 'Version') ?? 'unknown';
        if (version !== 'unknown' && !/^[1-9]\d{0,5}$/.test(version)) return fail('pmid-version');
        const sourceVersion = `pmid:${version}:metadata:${await digest(encode(canonical(entry)))}`;
        leads.push({nativeId: id, kind: 'artifact', artifactKind: 'publication', displayName: title,
          sourceStage: 'publication', sourceVersion, sourceDates, relatedAccounts: [],
          unresolvedPeople: authors.flatMap(author => author.name ? [author.name] : []), publicationAuthorized: false});
        metadata.push({pmid: id, sourceVersion, doiProposal, authors, publicationTypes, correctionRelations,
          currentEmploymentConfirmed: false, completeAuthorCoverageClaimed: false, publicationAuthorized: false});
      }
      for (const id of plan.requestedPmids) if (!seen.has(id)) gaps.push({code: 'missing-pmid', nativeId: id});
      terminal = !gaps.some(gap => gap.code === 'missing-pmid');
      providerLimited = !terminal;
    }
    const truncated = leads.length > input.maxItems;
    const draft = DiscoveryCollectionDraft.parse({schemaVersion: 'discovery-collection-v1',
      requestSha256: input.requestSha256, representationSha256: input.representationSha256, parser: input.parser,
      representationFormat: s.template.path === SEARCH_PATH ? 'json' : 'text', leads: leads.slice(0, input.maxItems),
      terminal: terminal && !truncated, nextCheckpoint: truncated ? null : nextCheckpoint,
      rejectedCount: Math.max(0, leads.length - input.maxItems), truncated, providerLimited});
    return {draft, metadata, gaps, fetchBatchComplete: s.template.path === FETCH_PATH && draft.terminal,
      inventoryComplete: false as const, provenance: {scopeId: s.scope.id, scopeSha256: s.scope.scopeSha256,
        sourceId: s.value.id, sourceRevision: s.value.revision, request: input.request,
        requestSha256: input.requestSha256, representationSha256: input.representationSha256, searchReceiptId}};
  }
  const parse = async (input: DiscoveryCollectionParseInput) => (await inspect(input)).draft;
  return {provider: 'pubmed' as const, parser: parse, parse, inspect, searchBinding, fetchSourceId, fetchPlan,
    async searchPlan(sourceId: string, offset = 0) {
      const s = await source(sourceId);
      const parameters: Record<string, string> = Object.hasOwn(s.template.fixed, 'retstart') ? {} : {retstart: String(offset)};
      const checked = searchParameters(s, parameters);
      if (checked.offset !== offset) return fail('search-offset');
      return {sourceId, parameters, endpoint: await constructDiscoveryEndpoint(s.template, Object.entries(parameters)), scopeSha256: s.scope.scopeSha256};
    },
    async nextPage(receiptId: string) {
      const retained = await retainedPage(receiptId);
      if (retained.s.template.path !== SEARCH_PATH || retained.page.truncated || retained.page.providerLimited || retained.page.rejectedCount) return fail('page-incomplete');
      return retained.page.nextCheckpoint;
    },
  };
}
