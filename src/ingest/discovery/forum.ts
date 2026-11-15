import { z } from 'zod';
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import { DiscoveryId, DiscoveryInstant, RevisionRef, makeDiscoveryDate } from '../../content/discovery-schema';
import { isCalendarDay } from '../../content/watch-schema';
import { canonicalDiscoveryEvidenceJson as canonical } from '../discovery-evidence-store';
import { redactRegionalContactEmails as redact } from '../regional-privacy';
import { permittedPublicUrl } from '../regional-contracts';
import { looksInstructionLike } from '../untrusted-text';
import { constructDiscoveryEndpoint } from './endpoint';
import { DiscoveryRuntimeError, DiscoveryRuntimeSource, type DiscoveryIssuedPlan } from './runtime-contract';
import { DiscoverySourceRequest } from './source-contract';
import { DiscoveryCollectionDraft, DiscoveryCollectionPageReceipt, type DiscoveryCollectionClaim,
  type DiscoveryCollectionLead, type DiscoveryCollectionParseInput } from './collection-contract';
import type { DiscoveryTrustedAdapterRepresentation } from './adapter';

export const DISCOVERY_FORUM_FAMILY = 'discourse-public-json-v1' as const;
const positive = z.number().int().positive().safe();
const nonnegative = z.number().int().nonnegative().safe();
const username = z.string().min(1).max(60).regex(/^[A-Za-z0-9_.-]+$/).refine(value => value !== '.' && value !== '..');
const originSchema = z.string().refine(value => {
  try { const url = new URL(value); return permittedPublicUrl(value) && url.origin === value; } catch { return false; }
});
const scopeInput = z.object({
  declaredId: DiscoveryId, revision: positive, installationId: DiscoveryId, origin: originSchema,
  installationVersion: z.string().min(1).max(100), family: z.literal(DISCOVERY_FORUM_FAMILY),
  categoryId: positive, categorySlug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  startDay: z.string().refine(isCalendarDay), endDay: z.string().refine(isCalendarDay),
  maxTopicsPerPage: z.number().int().min(1).max(50), maxPages: z.number().int().min(1).max(100),
  maxTopics: z.number().int().min(1).max(1000), maxPostsPerTopic: z.number().int().min(1).max(40),
  maxExcerptChars: z.number().int().min(1).max(2000), denominator: z.string().min(3).max(512), retentionPolicy: RevisionRef,
}).strict();
export type DiscoveryForumScopeInput = z.infer<typeof scopeInput>;
export type DiscoveryForumScope = Readonly<DiscoveryForumScopeInput & {id: string; scopeSha256: string; categoryPath: string}>;
const qualifiedScopes = new WeakSet<object>();
function fail(code: string, privacy = false): never {
  throw new DiscoveryRuntimeError(privacy ? 'permission-denied' : 'parser-failed', `discovery-forum-${code}`);
}
const encode = (value: string) => new TextEncoder().encode(value);
async function digest(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), value => value.toString(16).padStart(2, '0')).join('');
}
export async function qualifyDiscoveryForumScope(input: DiscoveryForumScopeInput): Promise<DiscoveryForumScope> {
  const checked = scopeInput.parse(JSON.parse(canonical(input)));
  if (checked.startDay > checked.endDay || Date.parse(checked.endDay) - Date.parse(checked.startDay) > 366 * 86400000) return fail('scope-window');
  const categoryPath = `/c/${checked.categorySlug}/${checked.categoryId}/l/latest.json`;
  const scopeSha256 = await digest(encode(canonical({...checked, categoryPath})));
  const scope = Object.freeze({...checked, retentionPolicy: Object.freeze({...checked.retentionPolicy}), categoryPath,
    id: `forum-scope:${scopeSha256}`, scopeSha256});
  qualifiedScopes.add(scope);
  return scope;
}
export type DiscoveryForumResolvers = {
  resolveSource(id: string): Promise<DiscoveryRuntimeSource | null>;
  resolveScope(id: string): Promise<DiscoveryForumScope | null>;
  resolvePlan(id: string): Promise<DiscoveryIssuedPlan>;
  resolvePage(id: string): Promise<DiscoveryCollectionPageReceipt | null>;
  resolveRepresentation(ref: {id: string; revision: number}): Promise<DiscoveryTrustedAdapterRepresentation | null>;
  resolveClaim(id: string): Promise<DiscoveryCollectionClaim>;
  resolveChainPage(chainId: string, ordinal: number): Promise<DiscoveryCollectionPageReceipt | null>;
  listingReceiptForTopicSource(sourceId: string): Promise<string | null>;
  now?(): string;
};
export function discoveryForumNativeKey(installation: string, kind: 'topic' | 'post' | 'account', id: number) {
  return canonical([DiscoveryId.parse(installation), kind, positive.parse(id)]);
}

/** Local bounded equivalent of strict offline intake JSON, with no script/module dependency. */
function strictJson(text: string): unknown {
  let at = 0, nodes = 0;
  const bad = (): never => fail('invalid-json', true);
  const whitespace = () => { while (/[\x20\x09\x0a\x0d]/.test(text[at] ?? 'X')) at++; };
  const string = (): string => {
    const start = at++;
    while (at < text.length) {
      const code = text.charCodeAt(at++);
      if (code === 34) {
        let result: string;
        try { result = JSON.parse(text.slice(start, at)); } catch { return bad(); }
        for (let i = 0; i < result.length; i++) {
          const c = result.charCodeAt(i);
          if (c >= 0xd800 && c <= 0xdbff) {
            const next = result.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return bad();
          } else if (c >= 0xdc00 && c <= 0xdfff) return bad();
        }
        return result;
      }
      if (code === 92) at++;
      else if (code < 32) return bad();
    }
    return bad();
  };
  const value = (depth: number): unknown => {
    if (depth > 32 || ++nodes > 20000) return bad();
    whitespace(); const token = text[at];
    if (token === '"') return string();
    if (token === '{' || token === '[') {
      at++; whitespace(); const array = token === '[', end = array ? ']' : '}';
      const result: any = array ? [] : Object.create(null), keys = new Set<string>();
      if (text[at] === end) { at++; return result; }
      for (;;) {
        whitespace(); let key = '';
        if (!array) {
          if (text[at] !== '"') return bad(); key = string();
          if (keys.has(key) || keys.size >= 200) return bad(); keys.add(key);
          whitespace(); if (text[at++] !== ':') return bad();
        }
        const entry = value(depth + 1); if (array) result.push(entry); else result[key] = entry;
        whitespace(); const next = text[at++]; if (next === end) return result; if (next !== ',') return bad();
      }
    }
    for (const [literal, entry] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(literal, at)) { at += literal.length; return entry; }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(at));
    if (!number) return bad();
    at += number[0].length; const result = Number(number[0]);
    if (!Number.isSafeInteger(result) || Object.is(result, -0) || /[.eE]/.test(number[0])) return bad();
    return result;
  };
  const result = value(0); whitespace(); if (at !== text.length) return bad(); return result;
}
function contacts(value: string) {
  return redact(value) !== value || /(?:mailto|tel|sms):/i.test(value) ||
    /(?:\+?\d{1,3}[ .-]?)?(?:\(\d{3}\)|\b\d{3})[ .-]\d{3}[ .-]\d{4}\b|\b\d{10,15}\b/.test(value);
}
function htmlText(html: string, rejectHidden: boolean) {
  if (/<!|<\?/.test(html)) return fail('unsupported-html-declaration', true);
  let malformed = false;
  const root = parseFragment(html, {onParseError: () => { malformed = true; }}), parts: string[] = [];
  if (malformed) return fail('malformed-html', true);
  const pending: {node: DefaultTreeAdapterTypes.Node; depth: number}[] = [{node: root, depth: 0}];
  let nodes = 0;
  while (pending.length) {
    const {node, depth} = pending.pop()!;
    if (++nodes > 10000 || depth > 64) return fail('html-bound', true);
    if (!('tagName' in node) && !['#document-fragment','#text'].includes(node.nodeName)) return fail('unsupported-html-node', true);
    if (node.nodeName === '#comment') return fail('unsupported-html-comment', true);
    if ('tagName' in node) {
      const allowedTags = ['p','br','strong','em','b','i','u','s','del','ul','ol','li','blockquote','code','pre','a','hr','span','div'];
      if (rejectHidden && (!allowedTags.includes(node.tagName) || node.attrs.some(attribute =>
          !['href','title','rel'].includes(attribute.name) || attribute.namespace || attribute.prefix ||
          attribute.name === 'href' && node.tagName !== 'a') || node.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
          ['script','style','iframe','object','embed','form','input','textarea','template','noscript'].includes(node.tagName) ||
          node.attrs.some(attribute => ['hidden','inert','srcdoc'].includes(attribute.name) ||
            attribute.name.startsWith('on') || attribute.name === 'aria-hidden' && attribute.value.toLowerCase() === 'true' ||
            attribute.name === 'style' && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attribute.value)))) return fail('hidden-html', true);
      for (const attribute of node.attrs) {
        if (contacts(attribute.value)) return fail('contact-content', true);
        if (attribute.name === 'href' || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(attribute.value)) {
          let url: URL, decoded: string;
          try { url = new URL(attribute.value, 'https://forum-public.invalid'); decoded = decodeURIComponent(attribute.value); }
          catch { return fail('unsupported-html-url', true); }
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
              contacts(decoded)) return fail('restricted-html-url', true);
        }
      }
    }
    if ('value' in node && typeof node.value === 'string') {
      if (contacts(node.value)) return fail('contact-content', true);
      parts.push(node.value);
    }
    if ('childNodes' in node) for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push({node: node.childNodes[i], depth: depth + 1});
  }
  if (contacts(parts.join('')) || contacts(parts.join(' '))) return fail('combined-contact-content', true);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
function privacy(value: unknown): void {
  if (typeof value === 'string') {
    if (contacts(value)) return fail('contact-content', true);
    if (/[<&]/.test(value)) htmlText(value, true);
  } else if (Array.isArray(value)) value.forEach(privacy);
  else if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) {
    if (/email|password|secret|api.?key|token|private|user_fields|custom_fields|ip_address|^raw$|hidden_profile/i.test(key)) return fail('restricted-field', true);
    privacy(entry);
  }
}
const accountSchema = z.object({id: positive, username, name: z.string().max(300).nullable().optional(), avatar_template: z.string().max(1000).optional()}).strict();
const topicSummary = z.object({id: positive, title: z.string().min(1).max(512), slug: z.string().min(1).max(200),
  category_id: positive, archetype: z.literal('regular'), visible: z.literal(true),
  created_at: DiscoveryInstant, last_posted_at: DiscoveryInstant.nullable().optional(), posts_count: nonnegative,
  closed: z.boolean().optional(), archived: z.boolean().optional(), pinned: z.boolean().optional(), deleted_at: z.null().optional()}).strict();
const listingSchema = z.object({users: z.array(accountSchema).max(100).optional(), topic_list: z.object({
  topics: z.array(topicSummary).max(50), more_topics_url: z.string().max(2048).nullable(), per_page: nonnegative.optional(),
}).strict()}).strict();
const postSchema = z.object({id: positive, topic_id: positive, user_id: positive, username,
  name: z.string().max(300).nullable().optional(), post_number: positive, post_type: z.literal(1),
  cooked: z.string().max(12000), created_at: DiscoveryInstant, updated_at: DiscoveryInstant, version: positive,
  hidden: z.literal(false), deleted_at: z.null().optional(), user_deleted: z.literal(false).optional(), reply_to_post_number: positive.nullable().optional(),
}).strict();
const topicSchema = z.object({id: positive, title: z.string().min(1).max(512), slug: z.string().min(1).max(200),
  category_id: positive, archetype: z.literal('regular'), visible: z.literal(true), created_at: DiscoveryInstant,
  last_posted_at: DiscoveryInstant.nullable().optional(), posts_count: nonnegative, deleted_at: z.null().optional(),
  closed: z.boolean().optional(), archived: z.boolean().optional(), post_stream: z.object({stream: z.array(positive).max(1000),
    posts: z.array(postSchema).max(40)}).strict(), details: z.object({created_by: accountSchema.optional(), last_poster: accountSchema.optional(),
      participants: z.array(accountSchema).max(100).optional()}).strict().optional(),
}).strict();
type Listing = z.infer<typeof listingSchema>;
type Topic = z.infer<typeof topicSchema>;
function decode(bytes: Uint8Array, topic: boolean): Listing | Topic {
  if (bytes.length > 48000) return fail('body-cap');
  let text: string;
  try { text = new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch { return fail('encoding', true); }
  const decoded = strictJson(text); privacy(decoded);
  const parsed = topic ? topicSchema.safeParse(decoded) : listingSchema.safeParse(decoded);
  if (!parsed.success) return fail('private-or-unsupported-schema', true);
  return parsed.data;
}

export type DiscoveryForumMetadata = {
  installation: string; nativeId: string; kind: 'topic' | 'post' | 'account'; sourceVersion: string;
  sourcePointer: string; publicUrl: string; excerpt?: string; usernameAlias?: string;
  instructionLike: boolean; holds: string[]; publicationAuthorized: false;
};
export type DiscoveryForumRelation = {kind: 'topic-has-post' | 'post-authored-by-account' | 'post-replies-to-post';
  from: string; to: string | null; sourcePointer: string; admitted: false};
export type DiscoveryForumGap = {code: 'outside-local-window' | 'missing-post' | 'unresolved-reply' | 'page-cap' | 'item-cap' | 'missing-next' | 'body-count-conflict'; nativeId?: string};
function topicInWindow(row: {created_at: string}, scope: DiscoveryForumScope) {
  const epoch = Date.parse(row.created_at);
  return epoch >= Date.parse(scope.startDay) && epoch < Date.parse(scope.endDay) + 86400000;
}
function validateListing(value: Listing, scope: DiscoveryForumScope) {
  const topics = value.topic_list.topics;
  if (topics.length > scope.maxTopicsPerPage || value.topic_list.per_page !== undefined && value.topic_list.per_page !== scope.maxTopicsPerPage ||
      new Set(topics.map(row => row.id)).size !== topics.length || topics.some(row => row.category_id !== scope.categoryId) ||
      new Set((value.users ?? []).map(row => row.id)).size !== (value.users ?? []).length) return fail('listing-binding');
  return value;
}
function validateTopic(value: Topic, scope: DiscoveryForumScope, topicId: number) {
  const posts = value.post_stream.posts, stream = value.post_stream.stream;
  if (value.id !== topicId || value.category_id !== scope.categoryId || !topicInWindow(value, scope) ||
      posts.length > scope.maxPostsPerTopic || new Set(stream).size !== stream.length ||
      new Set(posts.map(post => post.id)).size !== posts.length || new Set(posts.map(post => post.post_number)).size !== posts.length ||
      posts.some(post => post.topic_id !== topicId || !stream.includes(post.id) || Date.parse(post.created_at) > Date.parse(post.updated_at))) return fail('topic-binding');
  for (const post of posts) {
    const text = htmlText(post.cooked, true);
    if (post.cooked.length > scope.maxExcerptChars || text.length > scope.maxExcerptChars) return fail('excerpt-retention-bound', true);
  }
  const accounts = new Map<number, string>();
  for (const post of posts) {
    if (accounts.has(post.user_id) && accounts.get(post.user_id) !== post.username) return fail('account-conflict');
    accounts.set(post.user_id, post.username);
  }
  return value;
}
export function createDiscoveryForumAdapter(options: DiscoveryForumResolvers) {
  const trusted = {...options}, clock = trusted.now ?? (() => new Date().toISOString());
  const now = () => {
    const value = DiscoveryInstant.safeParse(clock());
    if (!value.success) return fail('clock');
    return Date.parse(value.data);
  };
  async function source(id: string) {
    const raw = await trusted.resolveSource(id);
    if (!raw) return fail('source-missing');
    const value = DiscoveryRuntimeSource.parse(JSON.parse(canonical(raw))), template = value.endpointTemplate;
    const scope = await trusted.resolveScope(value.scopeId);
    if (value.id !== id || value.provider !== 'forum' || value.requiresAuth || value.credentialRef || !scope ||
        !qualifiedScopes.has(scope) || scope.id !== value.scopeId || scope.installationId !== value.installation ||
        template.origin !== scope.origin || canonical(scope.retentionPolicy) !== canonical(value.accessDecision) || Object.keys(template.fixed).length) return fail('source-binding');
    const topicMatch = /^\/t\/([1-9]\d*)\.json$/.exec(template.path);
    if (template.path === scope.categoryPath) {
      if (template.pageParameter !== 'page' || Object.keys(template.parameters).join(',') !== 'page' ||
          template.parameters.page.kind !== 'integer' || template.parameters.page.min !== 0 ||
          template.required.length !== 1 || template.required[0] !== 'page') return fail('category-template');
    } else if (topicMatch) {
      if (Object.keys(template.parameters).length || template.required.length || template.pageParameter) return fail('topic-template');
      const parentId = await trusted.listingReceiptForTopicSource(id);
      if (!parentId || await topicSourceId(parentId, Number(topicMatch[1])) !== id) return fail('topic-source-binding');
    } else return fail('source-route');
    return {value, template, scope, topicId: topicMatch ? positive.parse(Number(topicMatch[1])) : null};
  }
  function bindRequest(request: DiscoverySourceRequest, s: Awaited<ReturnType<typeof source>>) {
    if (request.provider !== 'forum' || request.sourceId !== s.value.id || request.installation !== s.value.installation ||
        request.scopeId !== s.scope.id || request.endpointConstructor !== s.template.id ||
        canonical(request.enrollment) !== canonical(s.value.enrollment) || canonical(request.configuration) !== canonical(s.value.configuration) ||
        canonical(request.permission) !== canonical(s.value.permission) || canonical(request.parser) !== canonical(s.value.parser)) return fail('request-binding');
    if (s.topicId !== null) { if (Object.keys(request.parameters).length || request.checkpoint !== null) return fail('topic-parameters'); }
    else {
      if (Object.keys(request.parameters).join(',') !== 'page' || !/^(?:0|[1-9]\d*)$/.test(request.parameters.page) ||
          !Number.isSafeInteger(Number(request.parameters.page)) || Number(request.parameters.page) >= s.scope.maxPages) return fail('page-parameters');
    }
  }
  async function parsed(bytes: Uint8Array, s: Awaited<ReturnType<typeof source>>) {
    return s.topicId === null ? validateListing(decode(bytes, false) as Listing, s.scope) : validateTopic(decode(bytes, true) as Topic, s.scope, s.topicId);
  }
  async function retainedPage(id: string) {
    const raw = await trusted.resolvePage(id);
    if (!raw) return fail('receipt-missing');
    const page = DiscoveryCollectionPageReceipt.parse(JSON.parse(canonical(raw)));
    if (page.responseLink !== undefined && page.responseLink !== null && page.responseLink !== '') return fail('response-link-not-qualified', true);
    const resolved = await trusted.resolveRepresentation(page.representation);
    if (!resolved) return fail('unretained');
    const retained = {...resolved, bytes: new Uint8Array(resolved.bytes), request: DiscoverySourceRequest.parse(JSON.parse(canonical(resolved.request)))};
    const s = await source(page.sourceId); bindRequest(retained.request, s);
    if (page.id !== id || page.sourceRevision !== s.value.revision || Date.parse(page.committedAt) > now() ||
        retained.id !== page.representation.id || retained.revision !== page.representation.revision ||
        retained.representationSha256 !== page.representationSha256 || await digest(retained.bytes) !== page.representationSha256 ||
        await digest(encode(canonical(retained.request))) !== page.requestSha256) return fail('retained-binding');
    const claimRaw = await trusted.resolveClaim(page.claimId), claim = {...claimRaw, source: DiscoveryRuntimeSource.parse(JSON.parse(canonical(claimRaw.source))), chain: {...claimRaw.chain}};
    if (claim.id !== page.claimId || claim.roundId !== page.roundId || claim.slot !== page.slot || claim.issuedPlanId !== page.planId ||
        canonical(claim.source) !== canonical(s.value) || claim.chain.id !== page.chainId || claim.chain.sourceId !== page.sourceId ||
        claim.chain.sourceRevision !== page.sourceRevision || claim.chain.pageCount + 1 !== page.pageOrdinal ||
        !DiscoveryInstant.safeParse(claim.expiresAt).success || Date.parse(page.committedAt) >= Date.parse(claim.expiresAt)) return fail('claim-binding');
    await constructDiscoveryEndpoint(s.template, Object.entries(retained.request.parameters));
    return {page, retained, s, claim, body: await parsed(retained.bytes, s)};
  }
  async function listingBinding(receiptId: string, topicId: number) {
    positive.parse(topicId);
    const retained = await retainedPage(receiptId);
    if (retained.s.topicId !== null) return fail('listing-required');
    const body = retained.body as Listing, index = body.topic_list.topics.findIndex(row => row.id === topicId);
    const row = body.topic_list.topics[index];
    if (!row || !topicInWindow(row, retained.s.scope) || index >= retained.retained.remainingItems ||
        index >= retained.s.scope.maxTopics - (retained.page.pageOrdinal - 1) * retained.s.scope.maxTopicsPerPage) return fail('topic-not-qualified-in-listing');
    return {retained, row};
  }
  async function topicSourceId(listingReceiptId: string, topicId: number) {
    const {retained} = await listingBinding(listingReceiptId, topicId);
    return `forum-topic:${await digest(encode(canonical({listingReceiptId, topicId, installation: retained.s.value.installation,
      scopeId: retained.s.scope.id, scopeSha256: retained.s.scope.scopeSha256, categoryId: retained.s.scope.categoryId,
      requestSha256: retained.page.requestSha256, representationSha256: retained.page.representationSha256})))}`;
  }
  async function topicPlan(listingReceiptId: string, topicId: number, sourceId: string) {
    if (await topicSourceId(listingReceiptId, topicId) !== sourceId) return fail('topic-source-binding');
    const s = await source(sourceId), parent = (await listingBinding(listingReceiptId, topicId)).retained;
    if (s.topicId !== topicId || s.scope.id !== parent.s.scope.id || s.value.installation !== parent.s.value.installation) return fail('topic-scope');
    return {sourceId, parameters: {}, endpoint: await constructDiscoveryEndpoint(s.template, []), listingReceiptId,
      publicationAuthorized: false as const};
  }
  async function nextToken(body: Listing, s: Awaited<ReturnType<typeof source>>, page: number) {
    const raw = body.topic_list.more_topics_url;
    if (raw === null) return null;
    let url: URL;
    try { url = new URL(raw, s.scope.origin); } catch { return fail('next-url'); }
    const expected = await constructDiscoveryEndpoint(s.template, [['page', String(page + 1)]]);
    if (url.href !== expected || url.username || url.password || url.hash || raw.startsWith('//')) return fail('next-url-scope');
    return String(page + 1);
  }
  async function ancestry(parentId: string, s: Awaited<ReturnType<typeof source>>) {
    const parent = await retainedPage(parentId);
    if (s.topicId !== null || parent.s.topicId !== null || parent.page.sourceId !== s.value.id || parent.page.pageOrdinal >= s.scope.maxPages) return fail('parent-source');
    const pages: Awaited<ReturnType<typeof retainedPage>>[] = [];
    for (let ordinal = 1; ordinal <= parent.page.pageOrdinal; ordinal++) {
      const row = ordinal === parent.page.pageOrdinal ? parent.page : await trusted.resolveChainPage(parent.page.chainId, ordinal);
      if (!row) return fail('ancestry-missing');
      const entry = ordinal === parent.page.pageOrdinal ? parent : await retainedPage(row.id), prior = pages.at(-1);
      if (entry.page.chainId !== parent.page.chainId || entry.page.pageOrdinal !== ordinal || entry.page.sourceId !== s.value.id ||
          entry.page.terminal || entry.page.providerLimited || entry.page.rejectedCount || entry.page.truncated || entry.page.limitationCode !== null ||
          entry.s.topicId !== null || entry.page.nextCheckpoint !== await nextToken(entry.body as Listing, entry.s, ordinal - 1) ||
          !entry.page.nextCheckpoint || entry.retained.request.parameters.page !== String(ordinal - 1)) return fail('ancestry-binding');
      if (!prior && (entry.retained.request.checkpoint !== null || entry.claim.chain.lastReceiptId !== null || entry.claim.chain.checkpoint !== null) ||
          prior && (entry.retained.request.checkpoint !== prior.page.nextCheckpoint || entry.claim.chain.lastReceiptId !== prior.page.id ||
            entry.claim.chain.checkpoint !== prior.page.nextCheckpoint)) return fail('ancestry-checkpoint');
      pages.push(entry);
    }
    return {pages, parent, consumed: pages.reduce((sum, entry) => sum + (entry.body as Listing).topic_list.topics.length, 0)};
  }
  async function liveChain(input: DiscoveryCollectionParseInput, s: Awaited<ReturnType<typeof source>>) {
    const resolved = await trusted.resolvePlan(input.request.budgetReservation.id);
    const plan = {...resolved, source: DiscoveryRuntimeSource.parse(JSON.parse(canonical(resolved.source))), request: DiscoverySourceRequest.parse(JSON.parse(canonical(resolved.request))),
      ...(resolved.continuation ? {continuation: {...resolved.continuation}} : {})};
    if (plan.id !== input.request.budgetReservation.id || canonical(plan.request) !== canonical(input.request) ||
        plan.requestSha256 !== input.requestSha256 || canonical(plan.source) !== canonical(s.value) ||
        plan.endpoint !== await constructDiscoveryEndpoint(s.template, Object.entries(input.request.parameters))) return fail('issued-plan-binding');
    const page = s.topicId === null ? Number(input.request.parameters.page) : 0;
    if (page === 0) {
      if (input.request.checkpoint !== null || plan.continuation) return fail('initial-page');
      return {pages: [] as Awaited<ReturnType<typeof retainedPage>>[], consumed: 0};
    }
    const continuation = plan.continuation;
    if (!continuation || input.request.checkpoint !== String(page)) return fail('continuation-required');
    const previous = await ancestry(continuation.parentReceiptId, s);
    if (continuation.sourceId !== s.value.id || continuation.scopeId !== s.scope.id || continuation.sourceRevision !== s.value.revision ||
        continuation.installation !== s.value.installation || continuation.querySha256 !== s.value.materialScope.requestScopeSha256 ||
        continuation.tokenSha256 !== await digest(encode(String(page))) || !DiscoveryInstant.safeParse(continuation.expiresAt).success ||
        Date.parse(continuation.expiresAt) <= now() || previous.parent.page.nextCheckpoint !== String(page)) return fail('continuation-binding');
    return previous;
  }
  async function project(input: DiscoveryCollectionParseInput, s: Awaited<ReturnType<typeof source>>,
    chain: {pages: Awaited<ReturnType<typeof retainedPage>>[]; consumed: number}) {
    // The whole response is strictly decoded, privacy checked and schema qualified
    // before any candidate is projected. No partial catch can hide restricted data.
    const body = await parsed(input.bytes, s);
    const leads: DiscoveryCollectionLead[] = [], metadata: DiscoveryForumMetadata[] = [], relations: DiscoveryForumRelation[] = [], gaps: DiscoveryForumGap[] = [];
    let terminal = true, nextCheckpoint: string | null = null, providerLimited = false, rejectedCount = 0;
    const identity = (kind: 'topic' | 'post' | 'account', id: number) => `${kind}:${id}`;
    async function add(kind: 'topic' | 'post' | 'account', id: number, title: string, semantic: unknown, pointer: string,
      dates: DiscoveryCollectionLead['sourceDates'], excerpt?: string, alias?: string) {
      const nativeId = identity(kind, id), sourceVersion = `metadata:${await digest(encode(canonical(semantic)))}`;
      leads.push({nativeId, kind: kind === 'account' ? 'account' : 'artifact', ...(kind === 'account' ? {} : {artifactKind: 'discussion' as const}),
        displayName: title.slice(0, 512), sourceStage: kind === 'account' ? 'profile' : 'discussion', sourceVersion, sourceDates: dates,
        relatedAccounts: [], unresolvedPeople: [], publicationAuthorized: false});
      metadata.push({installation: s.value.installation, nativeId, kind, sourceVersion, sourcePointer: pointer,
        publicUrl: kind === 'account' ? `${s.scope.origin}/u/${alias}` : kind === 'topic' ? `${s.scope.origin}/t/${id}` : `${s.scope.origin}/p/${id}`,
        ...(excerpt === undefined ? {} : {excerpt}), ...(alias === undefined ? {} : {usernameAlias: alias}),
        instructionLike: looksInstructionLike(excerpt ?? title),
        holds: ['editorial-review-required','account-not-person','regional-attribution-unverified','medical-claims-unverified','public-source-not-publication-authority'],
        publicationAuthorized: false});
    }
    if (s.topicId === null) {
      const listing = body as Listing, rows = listing.topic_list.topics, page = Number(input.request.parameters.page);
      const cap = Math.min(input.maxItems, s.scope.maxTopics - chain.consumed);
      const priorIds = new Set(chain.pages.flatMap(entry => (entry.body as Listing).topic_list.topics.map(row => row.id)));
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        if (index >= cap) { rejectedCount++; gaps.push({code: 'item-cap', nativeId: identity('topic', row.id)}); continue; }
        if (!topicInWindow(row, s.scope)) { rejectedCount++; gaps.push({code: 'outside-local-window', nativeId: identity('topic', row.id)}); continue; }
        if (priorIds.has(row.id)) return fail('duplicate-topic');
        await add('topic', row.id, row.title, row, `/topic_list/topics/${index}`,
          [{field: 'created_at', date: makeDiscoveryDate('instant', row.created_at)},
            ...(row.last_posted_at ? [{field: 'last_posted_at', date: makeDiscoveryDate('instant', row.last_posted_at)}] : [])]);
      }
      const proposed = await nextToken(listing, s, page);
      terminal = proposed === null && rows.length < s.scope.maxTopicsPerPage;
      if (proposed === null && !terminal) { providerLimited = true; gaps.push({code: 'missing-next'}); }
      if (proposed !== null) {
        if (chain.pages.length + 1 >= s.scope.maxPages) { providerLimited = true; gaps.push({code: 'page-cap'}); }
        else if (chain.consumed + rows.length >= s.scope.maxTopics) { providerLimited = true; gaps.push({code: 'item-cap'}); }
        else nextCheckpoint = proposed;
      }
    } else {
      const topic = body as Topic, posts = topic.post_stream.posts;
      await add('topic', topic.id, topic.title, {id: topic.id, title: topic.title, created_at: topic.created_at,
        last_posted_at: topic.last_posted_at ?? null, posts_count: topic.posts_count, stream: topic.post_stream.stream}, '/id',
        [{field: 'created_at', date: makeDiscoveryDate('instant', topic.created_at)},
          ...(topic.last_posted_at ? [{field: 'last_posted_at', date: makeDiscoveryDate('instant', topic.last_posted_at)}] : [])]);
      const accountIds = new Set<number>(), byNumber = new Map(posts.map(post => [post.post_number, post.id]));
      for (let index = 0; index < posts.length; index++) {
        const post = posts[index], pointer = `/post_stream/posts/${index}`, excerpt = htmlText(post.cooked, true);
        await add('post', post.id, `Post ${post.post_number}: ${topic.title}`, {id: post.id, topic_id: post.topic_id,
          post_number: post.post_number, user_id: post.user_id, username: post.username, version: post.version,
          created_at: post.created_at, updated_at: post.updated_at, cooked: post.cooked, reply_to_post_number: post.reply_to_post_number ?? null}, pointer,
          [{field: 'created_at', date: makeDiscoveryDate('instant', post.created_at)}, {field: 'updated_at', date: makeDiscoveryDate('instant', post.updated_at)}], excerpt);
        const postLead = leads.at(-1)!;
        postLead.relatedAccounts.push(identity('account', post.user_id));
        postLead.unresolvedPeople.push(post.name || post.username);
        relations.push({kind: 'topic-has-post', from: identity('topic', topic.id), to: identity('post', post.id), sourcePointer: `${pointer}/id`, admitted: false},
          {kind: 'post-authored-by-account', from: identity('post', post.id), to: identity('account', post.user_id), sourcePointer: `${pointer}/user_id`, admitted: false});
        if (!accountIds.has(post.user_id)) {
          accountIds.add(post.user_id);
          await add('account', post.user_id, post.name || post.username, {id: post.user_id, username: post.username, name: post.name ?? null}, `${pointer}/user_id`, [], undefined, post.username);
        }
        if (post.reply_to_post_number) {
          const target = byNumber.get(post.reply_to_post_number);
          relations.push({kind: 'post-replies-to-post', from: identity('post', post.id), to: target ? identity('post', target) : null,
            sourcePointer: `${pointer}/reply_to_post_number`, admitted: false});
          if (!target) gaps.push({code: 'unresolved-reply', nativeId: identity('post', post.id)});
        }
      }
      const present = new Set(posts.map(post => post.id));
      for (const id of topic.post_stream.stream) if (!present.has(id)) gaps.push({code: 'missing-post', nativeId: identity('post', id)});
      if (topic.posts_count !== topic.post_stream.stream.length) gaps.push({code: 'body-count-conflict'});
      providerLimited = gaps.length > 0;
    }
    const overflow = Math.max(0, leads.length - input.maxItems);
    const truncated = overflow > 0 || s.topicId === null && (body as Listing).topic_list.topics.length > Math.min(input.maxItems, s.scope.maxTopics - chain.consumed);
    rejectedCount += overflow;
    if (overflow) gaps.push({code: 'item-cap'});
    if (providerLimited || rejectedCount || truncated) { terminal = false; nextCheckpoint = null; }
    const draft = DiscoveryCollectionDraft.parse({schemaVersion: 'discovery-collection-v1', requestSha256: input.requestSha256,
      representationSha256: input.representationSha256, parser: input.parser, representationFormat: 'json',
      leads: leads.slice(0, input.maxItems), terminal, nextCheckpoint, rejectedCount, truncated, providerLimited});
    return {draft, metadata, relations, gaps, inventoryComplete: false as const, publicationAuthorized: false as const,
      provenance: {installation: s.value.installation, sourceId: s.value.id, sourceRevision: s.value.revision,
        scopeId: s.scope.id, scopeSha256: s.scope.scopeSha256, retentionPolicy: {...s.scope.retentionPolicy},
        accessDecision: {...s.value.accessDecision}, rights: {...s.value.rights}, permission: {...s.value.permission},
        request: input.request, requestSha256: input.requestSha256,
        representationSha256: input.representationSha256, parentReceiptId: chain.pages.at(-1)?.page.id ?? null}};
  }
  async function inspect(supplied: DiscoveryCollectionParseInput) {
    const input = {...supplied, bytes: new Uint8Array(supplied.bytes), request: DiscoverySourceRequest.parse(JSON.parse(canonical(supplied.request))), parser: {...supplied.parser}};
    if (input.responseLink !== undefined && input.responseLink !== null && input.responseLink !== '') return fail('response-link-not-qualified', true);
    const s = await source(input.request.sourceId); bindRequest(input.request, s);
    if (canonical(input.parser) !== canonical(s.value.parser) || !Number.isSafeInteger(input.maxItems) || input.maxItems < 1 || input.maxItems > 100 ||
        await digest(input.bytes) !== input.representationSha256 || await digest(encode(canonical(input.request))) !== input.requestSha256) return fail('input-binding');
    return project(input, s, await liveChain(input, s));
  }
  async function replay(receiptId: string) {
    const retained = await retainedPage(receiptId), {page, s, claim} = retained;
    let chain: {pages: Awaited<ReturnType<typeof retainedPage>>[]; consumed: number} = {pages: [], consumed: 0};
    if (page.pageOrdinal === 1) {
      if (claim.chain.lastReceiptId !== null || claim.chain.checkpoint !== null || retained.retained.request.checkpoint !== null ||
          s.topicId === null && retained.retained.request.parameters.page !== '0') return fail('replay-initial');
    } else {
      if (!claim.chain.lastReceiptId) return fail('replay-parent');
      chain = await ancestry(claim.chain.lastReceiptId, s);
      const prior = chain.pages.at(-1)!;
      if (prior.page.chainId !== page.chainId || prior.page.pageOrdinal + 1 !== page.pageOrdinal ||
          prior.page.nextCheckpoint !== retained.retained.request.parameters.page || prior.page.nextCheckpoint !== retained.retained.request.checkpoint) return fail('replay-parent');
    }
    const result = await project({bytes: retained.retained.bytes, request: retained.retained.request, requestSha256: page.requestSha256,
      representationSha256: page.representationSha256, parser: s.value.parser, maxItems: retained.retained.remainingItems}, s, chain);
    if (result.draft.leads.length !== page.leadCount || result.draft.rejectedCount !== page.rejectedCount || result.draft.truncated !== page.truncated ||
        result.draft.providerLimited !== page.providerLimited || result.draft.terminal !== page.terminal || result.draft.nextCheckpoint !== page.proposedCheckpoint) return fail('replay-receipt');
    return {...result, replayed: true as const, provenance: {...result.provenance, receiptId, representation: page.representation}};
  }
  const parse = async (input: DiscoveryCollectionParseInput) => (await inspect(input)).draft;
  return {provider: 'forum' as const, family: DISCOVERY_FORUM_FAMILY, parser: parse, parse, inspect, replay, topicSourceId, topicPlan,
    async categoryPlan(sourceId: string, page = 0, parentReceiptId?: string) {
      const s = await source(sourceId);
      if (s.topicId !== null || !Number.isSafeInteger(page) || page < 0 || page >= s.scope.maxPages) return fail('category-plan');
      if (page !== 0) {
        if (!parentReceiptId || (await ancestry(parentReceiptId, s)).parent.page.nextCheckpoint !== String(page)) return fail('continuation-required');
      } else if (parentReceiptId) return fail('initial-page');
      return {sourceId, parameters: {page: String(page)}, endpoint: await constructDiscoveryEndpoint(s.template, [['page', String(page)]]), publicationAuthorized: false as const};
    },
    async nextPage(receiptId: string) {
      const retained = await retainedPage(receiptId);
      if (retained.s.topicId !== null || retained.page.truncated || retained.page.rejectedCount || retained.page.providerLimited || retained.page.limitationCode !== null) return fail('page-incomplete');
      if (retained.page.nextCheckpoint !== null) await ancestry(receiptId, retained.s);
      return retained.page.nextCheckpoint;
    },
    async removalProposal(priorReceiptId: string, requestedReason: 'source-deleted' | 'source-private' | 'rights-revoked') {
      if (!['source-deleted','source-private','rights-revoked'].includes(requestedReason)) return fail('removal-reason');
      const prior = await retainedPage(priorReceiptId);
      return {kind: 'retention-review-proposal' as const, priorReceiptId, representation: prior.page.representation,
        installation: prior.s.value.installation, sourceId: prior.s.value.id, rights: {...prior.s.value.rights},
        materialScope: JSON.parse(canonical(prior.s.value.materialScope)), policy: {...prior.s.scope.retentionPolicy},
        requestedReason, sourceChangeVerified: false as const, revokeAuthorized: false as const,
        currentClaimIntegration: 'requires-WP14-consumer' as const};
    },
  };
}
