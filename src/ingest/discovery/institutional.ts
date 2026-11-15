import { z } from 'zod';
import { isCalendarDay } from '../../content/watch-schema';
import { parse as parseHtml, ErrorCodes, type DefaultTreeAdapterTypes } from 'parse5';
import { DISCOVERY_COUNTY_KEYS, DiscoveryInstant, RevisionRef, makeDiscoveryDate, type DiscoveryDate } from '../../content/discovery-schema';
import { canonicalDiscoveryEvidenceJson as canonical } from '../discovery-evidence-store';
import { redactRegionalContactEmails as redact } from '../regional-privacy';
import { constructDiscoveryEndpoint, discoveryEndpointTemplateDigest, validateDiscoveryEndpoint } from './endpoint';
import { DiscoveryEndpointTemplate, DiscoveryRuntimeError, DiscoveryRuntimeSource, type DiscoveryIssuedPlan } from './runtime-contract';
import { DiscoverySourceRequest } from './source-contract';
import { DiscoveryCollectionDraft, DiscoveryCollectionPageReceipt, type DiscoveryCollectionParseInput,
  DiscoveryCollectionLead, type DiscoveryCollectionClaim } from './collection-contract';
import type { DiscoveryTrustedAdapterRepresentation } from './adapter';

/** Reviewed, source-specific HTML class mappings. This is not a universal directory parser. */
const className = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const classesSchema = z.object({record: className, name: className, healthTechBasis: className,
  affiliation: className, unit: className, county: className, locationRole: className,
  dateStart: className, dateEnd: className, currentThrough: className, sourceDate: className,
  creator: className, publisher: className, adopter: className, professionalId: className}).strict();
const scopeInput = z.object({declaredId: z.string().min(1).max(200), revision: z.number().int().positive().safe(),
  sourceFamily: z.enum(['independent-professional','institution','lab','association']),
  recordKind: z.enum(['person','organization','output']), endpointTemplate: DiscoveryEndpointTemplate,
  originUrl: z.string().max(1000), provenanceOriginId: z.string().min(1).max(200), originReview: RevisionRef.optional(),
  classes: classesSchema, pageSize: z.number().int().min(1).max(100), maxPages: z.number().int().min(1).max(100),
  maxItems: z.number().int().min(1).max(1000), denominator: z.string().min(3).max(512),
  rosterTotal: z.number().int().min(0).max(1000000).nullable(),
  startDay: z.string().refine(isCalendarDay), endDay: z.string().refine(isCalendarDay),
  dateBasis: z.literal('source-profile-date')}).strict();
export type DiscoveryInstitutionalScopeInput = z.infer<typeof scopeInput>;
export type DiscoveryInstitutionalScope = Readonly<DiscoveryInstitutionalScopeInput & {id: string; scopeSha256: string}>;
const qualifiedScopes = new WeakSet<object>();
const bytes = (value: string) => new TextEncoder().encode(value);
async function digest(value: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(value))), v => v.toString(16).padStart(2,'0')).join('');
}
function fail(code: string): never { throw new DiscoveryRuntimeError('parser-failed', `discovery-institutional-${code}`); }
function freeze<T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}
function contact(value: string) {
  // Decode bounded URL escaping too; parse5 separately decodes HTML entities.
  for (let i=0; i<2; i++) { try { const decoded = decodeURIComponent(value); if (decoded === value) break; value = decoded; } catch { break; } }
  return redact(value) !== value || /(?:mailto:|tel:|(?:\+\d{1,3}[ .-]?)?\(\d{3}\)[ .-]?\d{3}[ .-]?\d{4}|\b\d{3}[ .-]\d{3}[ .-]\d{4}\b|\b\d{10,15}\b)/i.test(value);
}
function publicUrl(value: string, pagination?: z.infer<typeof DiscoveryEndpointTemplate>): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  const host = url.hostname;
  if (contact(value) || url.protocol !== 'https:' || url.href !== value || url.username || url.password || url.port || url.hash ||
      !host.includes('.') || host.includes(':') || /^\d+(?:\.\d+)*$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|home\.arpa)$/.test(host)) return null;
  if (url.search) {
    const rule = pagination?.parameters.page;
    if (!pagination || Object.keys(pagination.fixed).length || url.origin !== pagination.origin || url.pathname !== pagination.path ||
        !/^\?page=[1-9]\d*$/.test(url.search) || rule?.kind !== 'integer' || Number(url.searchParams.get('page')) > rule.max) return null;
  }
  return value;
}
/** Syntax and a reviewed extraction contract only; does not grant collection or rights. */
export async function qualifyDiscoveryInstitutionalScope(input: DiscoveryInstitutionalScopeInput): Promise<DiscoveryInstitutionalScope> {
  const parsed = scopeInput.parse(JSON.parse(canonical(input))), t = parsed.endpointTemplate;
  await discoveryEndpointTemplateDigest(t);
  if (new Set(Object.values(parsed.classes)).size !== Object.keys(parsed.classes).length ||
      Object.keys(t.fixed).length !== 0 || Object.keys(t.parameters).join(',') !== 'page' || t.pageParameter !== 'page' ||
      t.required.length !== 1 || t.required[0] !== 'page' || t.parameters.page.kind !== 'integer' ||
      t.parameters.page.min !== 1 || t.parameters.page.max < parsed.maxPages ||
      !publicUrl(parsed.originUrl) || new URL(parsed.originUrl).hash || new URL(parsed.originUrl).search ||
      parsed.originUrl !== `${t.origin}${t.path}` && !parsed.originReview ||
      parsed.startDay > parsed.endDay || contact(parsed.denominator) || contact(parsed.declaredId) || contact(parsed.provenanceOriginId)) return fail('scope');
  const scopeSha256 = await digest(bytes(canonical(parsed)));
  const result = freeze({...parsed, scopeSha256, id: `institutional-scope:${scopeSha256}`});
  qualifiedScopes.add(result); return result;
}
export type DiscoveryInstitutionalResolvers = {
  resolveSource(id: string): Promise<DiscoveryRuntimeSource | null>;
  resolveScope(id: string): Promise<DiscoveryInstitutionalScope | null>;
  resolvePlan(id: string): Promise<DiscoveryIssuedPlan>;
  resolvePage(id: string): Promise<DiscoveryCollectionPageReceipt | null>;
  resolveRepresentation(ref: {id: string; revision: number}): Promise<DiscoveryTrustedAdapterRepresentation | null>;
  resolveClaim(id: string): Promise<DiscoveryCollectionClaim>;
  resolveChainPage(chainId: string, ordinal: number): Promise<DiscoveryCollectionPageReceipt | null>;
  distinctOriginCount?(refs: {id: string; revision: number}[]): Promise<number>;
  now?(): string;
};
export type DiscoveryInstitutionalEvidence = {value: string; excerpt: string; start: number; end: number; date?: DiscoveryDate};
export type DiscoveryInstitutionalMetadata = {
  nativeId: string; kind: 'person'|'organization'|'output'; name: DiscoveryInstitutionalEvidence;
  healthTechBasis: DiscoveryInstitutionalEvidence | null; sourceDate: DiscoveryInstitutionalEvidence | null;
  affiliations: {unit: DiscoveryInstitutionalEvidence; county: DiscoveryInstitutionalEvidence | null;
    locationRole: DiscoveryInstitutionalEvidence | null; dateStart: DiscoveryInstitutionalEvidence | null;
    dateEnd: DiscoveryInstitutionalEvidence | null; currentThrough: DiscoveryInstitutionalEvidence | null;
    temporalStatus: 'historic'|'current-supported'|'unknown'|'contradictory'; currentLocalSupported: boolean}[];
  relationships: {role: 'creator'|'publisher'|'adopter'; evidence: DiscoveryInstitutionalEvidence; targetIdentity: null}[];
  professionalIdentifiers: {url: string; scheme: 'orcid'|'ror'; evidence: DiscoveryInstitutionalEvidence;
    equivalenceProposed: true; verified: false; networkRequested: false}[];
  originResolution: 'reviewed-origin-required'; sourceUrl: string; provenanceOriginId: string; originUrl: string; originReview: {id: string; revision: number} | null;
  sourceVersion: string; sourcePointer: string; holds: string[]; assessmentOnly: true; currentEmploymentConfirmed: false; publicationAuthorized: false;
};
export type DiscoveryInstitutionalGap = {code: string; recordIndex?: number; reason?: string};
type Element = DefaultTreeAdapterTypes.Element;
const HTML = 'http://www.w3.org/1999/xhtml';
function attrs(node: Element) { return Object.fromEntries(node.attrs.filter(a => !a.namespace && !a.prefix).map(a => [a.name,a.value])); }
function hasClass(node: Element, cls: string) { return (attrs(node).class ?? '').split(/\s+/).includes(cls); }
function document(body: Uint8Array, scope: DiscoveryInstitutionalScope, endpoint: string) {
  if (body.byteLength > 48000) return fail('body-cap');
  let html: string;
  try { html = new TextDecoder('utf-8',{fatal:true}).decode(body); } catch { return fail('encoding'); }
  if (!html.replace(/^\uFEFF/, '').trimStart().startsWith('<')) return fail('unsupported-format');
  let unsupportedSyntax = false;
  if (contact(html) || /<!--|<!\[CDATA\[|<\?/i.test(html)) return fail('private-or-unsupported-document');
  const root = parseHtml(html, {sourceCodeLocationInfo:true, scriptingEnabled:true,
    // Recovery can discard private attributes before the DOM privacy walk sees
    // them. Only an omitted doctype is supported by this passive subset.
    onParseError: e => { if (e.code !== ErrorCodes.missingDoctype) unsupportedSyntax = true; }});
  if (unsupportedSyntax) return fail('private-or-unsupported-document');
  const decodedText: string[] = [];
  const elements: Element[] = [], descendants = new Map<Element, Element[]>();
  const walk = (node: DefaultTreeAdapterTypes.Node, parents: Element[], depth: number) => {
    if (node.nodeName === '#documentType' && 'publicId' in node &&
        (node.name !== 'html' || node.publicId !== '' || node.systemId !== '')) return fail('private-or-unsupported-document');
    if ('value' in node && typeof node.value === 'string') { if (contact(node.value)) return fail('private-or-unsupported-document'); decodedText.push(node.value); }
    if (depth > 100 || elements.length > 10000) return fail('html-bound');
    if ('tagName' in node) {
      const a = attrs(node);
      if (node.tagName === 'link' && !(a.rel === 'next' || a.rel === 'alternate' &&
          ['application/atom+xml','application/rss+xml'].includes(a.type))) return fail('unsupported-link-semantics');
      if (node.tagName === 'meta' && !(Object.keys(a).length === 1 && a.charset?.toLowerCase() === 'utf-8' ||
          Object.keys(a).length === 2 && a.name === 'viewport' &&
          ['width=device-width, initial-scale=1','width=device-width,initial-scale=1'].includes(a.content))) return fail('unsupported-meta-semantics');
      if (Object.values(scope.classes).filter(cls => hasClass(node,cls)).length > 1) return fail('ambiguous-field-class');
      // Passive, visible public-only HTML subset. Reject unsupported markup anywhere
      // in the response, before WP07 may retain the raw bytes. No scripts, hidden
      // subtrees, contact-bearing attributes or private structured payloads.
      const tags = new Set(['html','head','body','title','meta','link','main','header','footer','nav','section','article','div','span','p','h1','h2','h3','h4','ul','ol','li','dl','dt','dd','a','time','br','strong','em','small','table','thead','tbody','tr','td','th']);
      const allowedAttrs = new Set(['id','class','lang','charset','name','content','rel','href','type','datetime']);
      if (!tags.has(node.tagName) || node.namespaceURI !== HTML ||
          node.attrs.some(attr => attr.namespace || attr.prefix || !allowedAttrs.has(attr.name) || contact(attr.value)) ||
          a.name && !(node.tagName === 'meta' && a.name === 'viewport') ||
          a.content && !(node.tagName === 'meta' && a.name === 'viewport') ||
          a.href && (!['a','link'].includes(node.tagName) || !publicUrl(new URL(a.href,endpoint).href,scope.endpointTemplate))) return fail('private-or-unsupported-document');
      if (node.namespaceURI !== HTML || ['script','style','template','noscript'].includes(node.tagName) ||
          'hidden' in a || 'inert' in a || a['aria-hidden']?.toLowerCase() === 'true' ||
          /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(a.style ?? '')) return;
      elements.push(node); descendants.set(node, []);
      for (const p of parents) descendants.get(p)!.push(node);
      parents = [...parents,node];
    }
    if ('childNodes' in node) for (const child of node.childNodes) walk(child,parents,depth+1);
  };
  walk(root, [], 0);
  if (contact(decodedText.join(''))) return fail('private-or-unsupported-document');
  for (const text of decodedText) for (const match of text.matchAll(/https:\/\/[^\s<>"']+/g)) {
    if (!publicUrl(match[0],scope.endpointTemplate)) return fail('private-or-unsupported-document');
  }
  const ids = new Set<string>();
  for (const node of elements) { const id = attrs(node).id; if (id) { if (ids.has(id)) return fail('duplicate-html-id'); ids.add(id); } }
  const records = elements.filter(node => hasClass(node,scope.classes.record));
  if (records.length > scope.pageSize || records.some(node => descendants.get(node)!.some(child => hasClass(child,scope.classes.record)))) return fail('record-bound');
  const navigation: {url: string; relation: string; status: 'declared-unqualified'|'qualified-next'|'blocked'; requested: false}[] = [];
  const nexts: string[] = [];
  for (const node of elements) {
    const a = attrs(node), rel = (a.rel ?? '').split(/\s+/);
    const feed = node.tagName === 'link' && rel.includes('alternate') && ['application/atom+xml','application/rss+xml'].includes(a.type);
    const next = ['a','link'].includes(node.tagName) && rel.includes('next');
    const directory = node.tagName === 'a' && rel.includes('item');
    if (!feed && !next && !directory) continue;
    let url: string;
    try { url = new URL(a.href,endpoint).href; } catch { continue; }
    if (contact(url)) continue;
    let status: 'declared-unqualified'|'qualified-next'|'blocked' = publicUrl(url,scope.endpointTemplate) ? 'declared-unqualified' : 'blocked';
    if (next) {
      if (status !== 'blocked') { nexts.push(url); status = 'qualified-next'; }
      else nexts.push('blocked');
    }
    navigation.push({url, relation: next ? 'next' : feed ? 'feed' : 'directory-item', status, requested:false});
  }
  if (nexts.length > 1) return fail('multiple-next');
  function fields(parent: Element, key: keyof z.infer<typeof classesSchema>) {
    return descendants.get(parent)!.filter(n => hasClass(n,scope.classes[key]));
  }
  function evidence(node: Element): DiscoveryInstitutionalEvidence {
    if (node.childNodes.some(child => !('nodeName' in child) || child.nodeName !== '#text')) return fail('structured-field');
    const loc = node.sourceCodeLocation;
    if (!loc) return fail('field-location');
    const excerpt = html.slice(loc.startOffset,loc.endOffset), value = node.childNodes.map(n => 'value' in n ? n.value : '').join('').trim();
    if (!value || value.length > 1000 || excerpt.length > 3000 || contact(excerpt)) return fail('private-or-unbounded-field');
    return {value,excerpt,start:loc.startOffset,end:loc.endOffset};
  }
  function one(parent: Element, key: keyof z.infer<typeof classesSchema>, required = false) {
    const nodes = fields(parent,key);
    if (nodes.length > 1 || required && nodes.length !== 1) return fail('field-cardinality');
    return nodes[0] ? evidence(nodes[0]) : null;
  }
  function date(parent: Element, key: 'dateStart'|'dateEnd'|'currentThrough'|'sourceDate') {
    const nodes = fields(parent,key), field = one(parent,key);
    if (!field) return null;
    if (nodes[0].tagName !== 'time') return fail('date-element');
    const value = attrs(nodes[0]).datetime;
    const precision = /^\d{4}$/.test(value) ? 'year' : /^\d{4}-\d{2}$/.test(value) ? 'month' : /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'day' : null;
    if (!precision || field.value !== value) return fail('date-value');
    return {...field,date:makeDiscoveryDate(precision,value)};
  }
  return {records, navigation, next:nexts[0] ?? null, fields, evidence, one, date, attrs};
}
function numericPage(value: string) { if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) return fail('page'); return Number(value); }

export function createDiscoveryInstitutionalAdapter(options: DiscoveryInstitutionalResolvers) {
  const trusted = {...options}, clock = trusted.now ?? (() => new Date().toISOString());
  function now() { const value = DiscoveryInstant.safeParse(clock()); if (!value.success) return fail('clock'); return Date.parse(value.data); }
  async function source(id: string) {
    const resolved = await trusted.resolveSource(id);
    if (!resolved) return fail('source-missing');
    const value = DiscoveryRuntimeSource.parse(JSON.parse(canonical(resolved))), scope = await trusted.resolveScope(value.scopeId);
    if (value.id !== id || value.provider !== 'institutional' || !scope || !qualifiedScopes.has(scope) || scope.id !== value.scopeId ||
        canonical(value.endpointTemplate) !== canonical(scope.endpointTemplate)) return fail('source-binding');
    return {value, scope, template:value.endpointTemplate};
  }
  function requestBinding(request: DiscoverySourceRequest, s: Awaited<ReturnType<typeof source>>) {
    if (request.provider !== 'institutional' || request.sourceId !== s.value.id || request.installation !== s.value.installation ||
        request.scopeId !== s.scope.id || request.endpointConstructor !== s.template.id ||
        canonical(request.enrollment) !== canonical(s.value.enrollment) || canonical(request.configuration) !== canonical(s.value.configuration) ||
        canonical(request.permission) !== canonical(s.value.permission) || canonical(request.parser) !== canonical(s.value.parser) ||
        Object.keys(request.parameters).join(',') !== 'page') return fail('request-binding');
    const page = numericPage(request.parameters.page);
    if (page > s.scope.maxPages || (page-1)*s.scope.pageSize >= s.scope.maxItems) return fail('page-cap');
    return page;
  }
  async function envelope(body: Uint8Array, scope: DiscoveryInstitutionalScope, page: number) {
    const endpoint = await constructDiscoveryEndpoint(scope.endpointTemplate,[['page',String(page)]]);
    const parsed = document(body,scope,endpoint);
    let next: string | null = null;
    if (parsed.next) {
      try {
        await validateDiscoveryEndpoint(scope.endpointTemplate,parsed.next);
        const target = numericPage(new URL(parsed.next).searchParams.get('page') ?? '');
        if (target !== page+1) return fail('next-sequence');
        next = String(target);
      } catch { for (const n of parsed.navigation) if (n.relation === 'next') n.status = 'blocked'; }
    }
    return {...parsed, endpoint, next, blockedNext: parsed.next !== null && next === null};
  }
  async function retainedPage(id: string) {
    const resolved = await trusted.resolvePage(id);
    if (!resolved) return fail('receipt-missing');
    const page = DiscoveryCollectionPageReceipt.parse(JSON.parse(canonical(resolved)));
    if (page.responseLink) return fail('unsupported-response-link');
    const raw = await trusted.resolveRepresentation(page.representation);
    if (!raw) return fail('unretained');
    const retained = {...raw,bytes:new Uint8Array(raw.bytes),request:DiscoverySourceRequest.parse(JSON.parse(canonical(raw.request)))};
    const s = await source(page.sourceId), number = requestBinding(retained.request,s);
    if (page.id !== id || page.sourceRevision !== s.value.revision || Date.parse(page.committedAt) > now() ||
        retained.id !== page.representation.id || retained.revision !== page.representation.revision ||
        retained.representationSha256 !== page.representationSha256 || await digest(retained.bytes) !== page.representationSha256 ||
        await digest(bytes(canonical(retained.request))) !== page.requestSha256) return fail('retained-binding');
    const resolvedClaim = await trusted.resolveClaim(page.claimId);
    const claim = {...resolvedClaim, source:DiscoveryRuntimeSource.parse(JSON.parse(canonical(resolvedClaim.source))),
      chain:{...resolvedClaim.chain},sourceLease:{...resolvedClaim.sourceLease}};
    if (claim.id !== page.claimId || claim.roundId !== page.roundId || claim.slot !== page.slot || claim.issuedPlanId !== page.planId ||
        canonical(claim.source) !== canonical(s.value) || claim.chain.id !== page.chainId || claim.chain.sourceId !== page.sourceId ||
        claim.chain.sourceRevision !== page.sourceRevision || claim.chain.pageCount+1 !== page.pageOrdinal ||
        !DiscoveryInstant.safeParse(claim.expiresAt).success || !DiscoveryInstant.safeParse(claim.processingDeadlineAt).success ||
        claim.sourceLease.expiresAt !== claim.expiresAt || Date.parse(page.committedAt) >= Date.parse(claim.expiresAt)) return fail('claim-binding');
    return {page,retained,s,claim,parsed:await envelope(retained.bytes,s.scope,number)};
  }
  async function ancestry(parentId: string, s: Awaited<ReturnType<typeof source>>) {
    const parent = await retainedPage(parentId), chainId = parent.page.chainId;
    if (parent.page.sourceId !== s.value.id || parent.page.pageOrdinal >= s.scope.maxPages) return fail('parent-source');
    const pages: Awaited<ReturnType<typeof retainedPage>>[] = [];
    for (let ordinal = 1; ordinal <= parent.page.pageOrdinal; ordinal++) {
      const candidate = ordinal === parent.page.pageOrdinal ? parent.page : await trusted.resolveChainPage(chainId,ordinal);
      if (!candidate) return fail('ancestry-missing');
      const entry = ordinal === parent.page.pageOrdinal ? parent : await retainedPage(candidate.id), prior = pages.at(-1);
      if (entry.page.chainId !== chainId || entry.page.pageOrdinal !== ordinal || entry.page.sourceId !== s.value.id ||
          entry.page.sourceRevision !== s.value.revision || entry.page.truncated || entry.page.rejectedCount || entry.page.providerLimited ||
          entry.page.terminal || entry.page.limitationCode !== null || entry.page.nextCheckpoint !== String(ordinal+1) ||
          entry.parsed.next !== String(ordinal+1) || entry.retained.request.parameters.page !== String(ordinal) ||
          !prior && (entry.retained.request.checkpoint !== null || entry.claim.chain.lastReceiptId !== null || entry.claim.chain.checkpoint !== null) ||
          prior && (entry.retained.request.checkpoint !== prior.page.nextCheckpoint || entry.claim.chain.lastReceiptId !== prior.page.id ||
          entry.claim.chain.checkpoint !== prior.page.nextCheckpoint)) return fail('ancestry-binding');
      pages.push(entry);
    }
    return {pages,consumed:pages.reduce((n,p) => n+p.parsed.records.length,0),parent};
  }
  async function activeChain(input: DiscoveryCollectionParseInput, s: Awaited<ReturnType<typeof source>>) {
    const resolved = await trusted.resolvePlan(input.request.budgetReservation.id);
    const plan = {...resolved,request:DiscoverySourceRequest.parse(JSON.parse(canonical(resolved.request))),
      source:DiscoveryRuntimeSource.parse(JSON.parse(canonical(resolved.source))),...(resolved.continuation ? {continuation:{...resolved.continuation}} : {})};
    if (plan.id !== input.request.budgetReservation.id || canonical(plan.request) !== canonical(input.request) ||
        plan.requestSha256 !== input.requestSha256 || canonical(plan.source) !== canonical(s.value) ||
        plan.endpoint !== await constructDiscoveryEndpoint(s.template,Object.entries(input.request.parameters))) return fail('issued-plan-binding');
    const page = numericPage(input.request.parameters.page);
    if (page === 1) { if (input.request.checkpoint !== null || plan.continuation) return fail('initial-page');
      return {pages:[] as Awaited<ReturnType<typeof retainedPage>>[],consumed:0}; }
    const continuation = plan.continuation;
    if (!continuation || input.request.checkpoint !== String(page)) return fail('continuation-required');
    const previous = await ancestry(continuation.parentReceiptId,s);
    if (continuation.sourceId !== s.value.id || continuation.scopeId !== s.scope.id || continuation.sourceRevision !== s.value.revision ||
        continuation.installation !== s.value.installation || continuation.querySha256 !== s.value.materialScope.requestScopeSha256 ||
        continuation.tokenSha256 !== await digest(bytes(String(page))) || !DiscoveryInstant.safeParse(continuation.expiresAt).success ||
        Date.parse(continuation.expiresAt) <= now() || previous.parent.page.nextCheckpoint !== String(page)) return fail('continuation-binding');
    return previous;
  }
  async function project(input: DiscoveryCollectionParseInput, s: Awaited<ReturnType<typeof source>>,
    chain: {pages: Awaited<ReturnType<typeof retainedPage>>[]; consumed: number}) {
    const pageNumber = numericPage(input.request.parameters.page), parsed = await envelope(input.bytes,s.scope,pageNumber);
    const leads: DiscoveryCollectionLead[] = [], metadata: DiscoveryInstitutionalMetadata[] = [], gaps: DiscoveryInstitutionalGap[] = [];
    // HTML IDs are document-local; never merge same-ID cards across directory pages.
    const seen = new Set<string>();
    const cap = Math.min(input.maxItems,s.scope.maxItems-chain.consumed), today = new Date(now()).toISOString().slice(0,10);
    let rejectedCount = 0;
    for (let index = 0; index < parsed.records.length; index++) {
      if (index >= cap) { rejectedCount++; gaps.push({code:'item-cap',recordIndex:index}); continue; }
      try {
        const record = parsed.records[index], id = attrs(record).id;
        if (!id || !/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(id)) return fail('native-id');
        if (seen.has(id)) { rejectedCount++; gaps.push({code:'duplicate-origin',recordIndex:index}); continue; }
        seen.add(id);
        const name = parsed.one(record,'name',true)!, healthTechBasis = parsed.one(record,'healthTechBasis');
        const sourceDate = parsed.date(record,'sourceDate'), holds: string[] = ['private-provisional-lead','identity-review-required'];
        if (!healthTechBasis) holds.push('professional-health-tech-basis-unknown');
        if (!sourceDate) holds.push('profile-date-unknown');
        if (sourceDate?.date && sourceDate.date.precision !== 'unknown' && sourceDate.date.precision !== 'instant' &&
            (sourceDate.date.upperDate <= s.scope.startDay || sourceDate.date.lowerDate > s.scope.endDay)) holds.push('profile-date-outside-scope-window');
        if (sourceDate?.date && sourceDate.date.precision !== 'unknown' && sourceDate.date.precision !== 'instant' && sourceDate.date.lowerDate > today) return fail('future-source-date');
        const affiliations = parsed.fields(record,'affiliation').map(unitNode => {
          const unit = parsed.one(unitNode,'unit',true)!, county = parsed.one(unitNode,'county'), locationRole = parsed.one(unitNode,'locationRole');
          const dateStart = parsed.date(unitNode,'dateStart'), dateEnd = parsed.date(unitNode,'dateEnd'), currentThrough = parsed.date(unitNode,'currentThrough');
          const start = dateStart?.date, end = dateEnd?.date, through = currentThrough?.date;
          const bounds = (d: DiscoveryDate | undefined) => d && d.precision !== 'unknown' && d.precision !== 'instant' ? d : null;
          const sb = bounds(start), eb = bounds(end), tb = bounds(through);
          let temporalStatus: 'historic'|'current-supported'|'unknown'|'contradictory' = 'unknown';
          if (sb && eb && sb.lowerDate >= eb.upperDate || sb && tb && sb.lowerDate >= tb.upperDate || eb && tb && tb.lowerDate >= eb.upperDate) temporalStatus = 'contradictory';
          else if (eb && eb.upperDate <= today || tb && tb.upperDate <= today) temporalStatus = 'historic';
          else if (sb && sb.upperDate <= today && tb && tb.lowerDate >= today && (!eb || eb.lowerDate > today)) temporalStatus = 'current-supported';
          const currentLocalSupported = temporalStatus === 'current-supported' && sourceDate !== null && healthTechBasis !== null &&
            !holds.includes('profile-date-outside-scope-window') && locationRole?.value === 'actual-unit' && (DISCOVERY_COUNTY_KEYS as readonly string[]).includes(county?.value ?? '');
          return {unit,county,locationRole,dateStart,dateEnd,currentThrough,temporalStatus,currentLocalSupported};
        });
        if (!affiliations.some(a => a.currentLocalSupported)) holds.push('current-local-professional-presence-unconfirmed');
        if (affiliations.some(a => a.temporalStatus === 'contradictory')) holds.push('contradictory-affiliation');
        const relationships: DiscoveryInstitutionalMetadata['relationships'] = [];
        for (const role of ['creator','publisher','adopter'] as const) for (const n of parsed.fields(record,role)) relationships.push({role,evidence:parsed.evidence(n),targetIdentity:null});
        if (relationships.length > 30 || affiliations.length > 20) return fail('relation-cap');
        const professionalIdentifiers: DiscoveryInstitutionalMetadata['professionalIdentifiers'] = [];
        for (const node of parsed.fields(record,'professionalId')) {
          const url = attrs(node).href;
          if (node.tagName !== 'a' || !url || !publicUrl(url)) return fail('professional-id');
          const scheme = /^https:\/\/orcid\.org\/\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(url) ? 'orcid' : /^https:\/\/ror\.org\/0[0-9a-z]{6}[0-9]{2}$/.test(url) ? 'ror' : null;
          if (!scheme) return fail('professional-id');
          professionalIdentifiers.push({url,scheme,evidence:parsed.evidence(node),equivalenceProposed:true,verified:false,networkRequested:false});
        }
        if (professionalIdentifiers.length > 10) return fail('identifier-cap');
        // A claimed mirror origin is an unresolved proposal, never a native-person merge.
        const nativeId = `${parsed.endpoint}#${id}`;
        const valueOnly = (field: DiscoveryInstitutionalEvidence | null) => field ? {value:field.value,...(field.date ? {date:field.date} : {})} : null;
        const semantic = {name:valueOnly(name),healthTechBasis:valueOnly(healthTechBasis),sourceDate:valueOnly(sourceDate),
          affiliations:affiliations.map(a => ({unit:valueOnly(a.unit),county:valueOnly(a.county),locationRole:valueOnly(a.locationRole),
            dateStart:valueOnly(a.dateStart),dateEnd:valueOnly(a.dateEnd),currentThrough:valueOnly(a.currentThrough)})),
          relationships:relationships.map(r => ({role:r.role,value:r.evidence.value})),
          professionalIdentifiers:professionalIdentifiers.map(i => ({url:i.url,scheme:i.scheme,value:i.evidence.value}))};
        const sourceVersion = `html:${await digest(bytes(canonical(semantic)))}`;
        metadata.push({nativeId,kind:s.scope.recordKind,name,healthTechBasis,sourceDate,affiliations,relationships,professionalIdentifiers,
          originResolution:'reviewed-origin-required',sourceUrl:parsed.endpoint,provenanceOriginId:s.scope.provenanceOriginId,originUrl:s.scope.originUrl,originReview:s.scope.originReview ?? null,
          sourceVersion,sourcePointer:`#${id}`,holds,assessmentOnly:true,currentEmploymentConfirmed:false,publicationAuthorized:false});
        leads.push(DiscoveryCollectionLead.parse({nativeId,kind:s.scope.recordKind === 'output' ? 'artifact' : s.scope.recordKind,
          ...(s.scope.recordKind === 'output' ? {artifactKind:'publication'} : {}),displayName:name.value,sourceVersion,
          sourceStage:s.scope.recordKind === 'output' ? 'publication' : 'profile',sourceDates:sourceDate?.date ? [{field:'source-date',date:sourceDate.date}] : [],
          relatedAccounts:[],unresolvedPeople:relationships.filter(r => r.role === 'creator').map(r => r.evidence.value),publicationAuthorized:false}));
      } catch (error) { rejectedCount++; gaps.push({code:'malformed-record',recordIndex:index,
        reason:error instanceof DiscoveryRuntimeError ? error.code : 'unsupported-field'}); }
    }
    const consumed = chain.consumed+parsed.records.length, pageCount = chain.pages.length+1;
    let providerLimited = parsed.blockedNext, nextCheckpoint = parsed.next;
    if (parsed.blockedNext) gaps.push({code:'off-scope-next'});
    if (nextCheckpoint && (pageCount >= s.scope.maxPages || consumed >= s.scope.maxItems)) { providerLimited = true; gaps.push({code:pageCount >= s.scope.maxPages ? 'page-cap' : 'item-cap'}); }
    if (!parsed.next && s.scope.rosterTotal === null) { providerLimited = true; gaps.push({code:'roster-completeness-unknown'}); }
    if (!parsed.next && s.scope.rosterTotal !== null && consumed !== s.scope.rosterTotal) { providerLimited = true; gaps.push({code:'roster-denominator-mismatch'}); }
    if (parsed.next && s.scope.rosterTotal !== null && consumed >= s.scope.rosterTotal) { providerLimited = true; gaps.push({code:'roster-denominator-mismatch'}); }
    if (rejectedCount || providerLimited) nextCheckpoint = null;
    const draft = DiscoveryCollectionDraft.parse({schemaVersion:'discovery-collection-v1',requestSha256:input.requestSha256,
      representationSha256:input.representationSha256,parser:input.parser,representationFormat:'text',leads,
      terminal:!parsed.next && !providerLimited && !rejectedCount,nextCheckpoint,rejectedCount,truncated:parsed.records.length>cap,providerLimited});
    return {draft,metadata,gaps,navigation:parsed.navigation,reportedTotal:s.scope.rosterTotal,consumedItems:consumed,pageCount,
      coverage:{denominator:s.scope.denominator,rosterTotal:s.scope.rosterTotal,complete:draft.terminal,scopeBounded:true},
      maintenanceEstimate:{profileRefreshMinutesPerRecord:3,identityReviewMinutesPerRecord:5,estimateOnly:true},publicationAuthorized:false as const,
      provenance:{sourceId:s.value.id,sourceRevision:s.value.revision,scopeId:s.scope.id,scopeSha256:s.scope.scopeSha256,
        rights:s.value.rights,permission:s.value.permission,request:input.request,requestSha256:input.requestSha256,
        representationSha256:input.representationSha256,parentReceiptId:chain.pages.at(-1)?.page.id ?? null}};
  }
  async function inspect(supplied: DiscoveryCollectionParseInput) {
    const input = {...supplied,bytes:new Uint8Array(supplied.bytes),request:DiscoverySourceRequest.parse(JSON.parse(canonical(supplied.request))),parser:{...supplied.parser}};
    if (input.responseLink) return fail('unsupported-response-link');
    const s = await source(input.request.sourceId); requestBinding(input.request,s);
    if (canonical(input.parser) !== canonical(s.value.parser) || !Number.isSafeInteger(input.maxItems) || input.maxItems < 1 || input.maxItems > 100 ||
        await digest(input.bytes) !== input.representationSha256 || await digest(bytes(canonical(input.request))) !== input.requestSha256) return fail('input-binding');
    return project(input,s,await activeChain(input,s));
  }
  async function replay(receiptId: string) {
    const retained = await retainedPage(receiptId), {page,s,claim} = retained;
    let chain: {pages: Awaited<ReturnType<typeof retainedPage>>[]; consumed:number} = {pages:[],consumed:0};
    if (page.pageOrdinal === 1) {
      if (retained.retained.request.parameters.page !== '1' || retained.retained.request.checkpoint !== null ||
          claim.chain.lastReceiptId !== null || claim.chain.checkpoint !== null) return fail('replay-initial');
    } else {
      if (!claim.chain.lastReceiptId) return fail('replay-parent');
      chain = await ancestry(claim.chain.lastReceiptId,s); const prior = chain.pages.at(-1)!;
      if (prior.page.chainId !== page.chainId || prior.page.pageOrdinal+1 !== page.pageOrdinal ||
          prior.page.nextCheckpoint !== retained.retained.request.parameters.page || prior.page.nextCheckpoint !== retained.retained.request.checkpoint) return fail('replay-parent');
    }
    const result = await project({bytes:retained.retained.bytes,request:retained.retained.request,requestSha256:page.requestSha256,
      representationSha256:page.representationSha256,parser:s.value.parser,maxItems:retained.retained.remainingItems},s,chain);
    if (result.draft.leads.length !== page.leadCount || result.draft.rejectedCount !== page.rejectedCount || result.draft.truncated !== page.truncated ||
        result.draft.providerLimited !== page.providerLimited || result.draft.terminal !== page.terminal || result.draft.nextCheckpoint !== page.proposedCheckpoint) return fail('replay-receipt');
    return {...result,replayed:true as const,provenance:{...result.provenance,receiptId,representation:page.representation}};
  }
  const parse = async (input: DiscoveryCollectionParseInput) => (await inspect(input)).draft;
  return {provider:'institutional' as const,parser:parse,parse,inspect,replay,
    async distinctReviewedOriginCount(rawRefs: {id: string; revision: number}[]) {
      const refs = z.array(RevisionRef).min(1).max(100).parse(rawRefs);
      if (!trusted.distinctOriginCount) return fail('origin-unresolved');
      const result = await trusted.distinctOriginCount(refs);
      if (!Number.isSafeInteger(result) || result < 0 || result > refs.length) return fail('origin-count');
      return result;
    },
    async plan(sourceId: string, page = 1, parentReceiptId?: string) {
      const s = await source(sourceId);
      if (!Number.isSafeInteger(page) || page<1 || page>s.scope.maxPages || (page-1)*s.scope.pageSize>=s.scope.maxItems) return fail('page-cap');
      if (page !== 1) { if (!parentReceiptId) return fail('continuation-required');
        if ((await ancestry(parentReceiptId,s)).parent.page.nextCheckpoint !== String(page)) return fail('continuation-binding');
      } else if (parentReceiptId) return fail('initial-page');
      const parameters = {page:String(page)};
      return {sourceId,parameters,endpoint:await constructDiscoveryEndpoint(s.template,Object.entries(parameters)),scopeSha256:s.scope.scopeSha256};
    },
    async nextPage(receiptId: string) {
      const retained = await retainedPage(receiptId);
      if (retained.page.truncated || retained.page.rejectedCount || retained.page.providerLimited || retained.page.limitationCode !== null) return fail('page-incomplete');
      if (retained.page.nextCheckpoint !== null) await ancestry(receiptId,retained.s);
      return retained.page.nextCheckpoint;
    }};
}
