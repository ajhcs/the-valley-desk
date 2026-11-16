import { z } from 'zod';
import { DirectorySnapshotSchema, DirectoryWorkSchema } from '../../content/discovery-directory';

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const pointer = z.string().max(1000).regex(/^(?:\/(?:[^~]|~[01])*)?$/);
const decision = z.enum(['accept', 'correction', 'hold', 'duplicate', 'outside-scope', 'removal']);
const evidence = z.object({ id, path: z.string().min(1).max(1000), sha256: hash, sourceUrl: z.string().url(), observedDate: z.string(), method: z.enum(['provider-metadata', 'primary-web-rendering', 'primary-indexed-rendering', 'reviewed-observation']), kind: z.enum(['native-json', 'gl03-fact-packet', 'curated-observation']) }).strict();
const target = z.object({ id, revision: z.number().int().positive() }).strict().nullable();
const receipt = z.object({ id, target, bindingsSha256: hash, workSha256: hash.nullable(), operator: z.string(), reviewer: z.string(), decision, candidateId: id, reason: z.string().min(1).max(1000) }).strict();
const binding = z.object({ field: pointer, evidenceId: id, pointer, transform: z.enum(['identity', 'number-string', 'date-parts', 'reviewed-claim', 'reviewed-relation']), nativePointer: pointer.nullable() }).strict();
export const DirectoryReviewSelectionSchema = z.object({ schemaVersion: z.literal('directory-review-selection-v1'), version: id, evidence: z.array(evidence).max(1000), entries: z.array(z.object({ candidateId: id, target, decision, reason: z.string().min(1).max(1000), work: DirectoryWorkSchema.nullable(), bindings: z.array(binding).max(300), receipt }).strict()).max(10000) }).strict();
export type DirectoryReviewSelection = z.infer<typeof DirectoryReviewSelectionSchema>;
export type DirectoryTrustedContext = { selectionSha256: string; operator: string; reviewer: string; priorState: { path: string; sha256: string } | null };
const State = z.object({ snapshot: DirectorySnapshotSchema, tombstones: z.array(z.object({ id, revision: z.number().int().positive(), nativeKeySha256: hash.nullable() }).strict()).max(10000) }).strict();
async function nativeKey(work: z.infer<typeof DirectoryWorkSchema>) { const n = work.nativeIdentity; if (!n) return null; let value = n.nativeId; if (n.provider !== 'other') value = value.normalize('NFKC'); if (n.provider === 'crossref') value = value.replace(/^https:\/\/doi\.org\//i, '').toLowerCase(); if (n.provider === 'arxiv') value = value.replace(/^https:\/\/arxiv\.org\/abs\//i, '').toLowerCase(); return directorySha256(canonicalDirectoryJson([n.provider, n.namespace ? new URL(n.namespace).href : null, value])); }
export function canonicalDirectoryJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalDirectoryJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalDirectoryJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function directorySha256(value: string | Uint8Array): Promise<string> { const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value); const digest = await crypto.subtle.digest('SHA-256', bytes); return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''); }
export async function directoryWorkReviewHash(work: z.infer<typeof DirectoryWorkSchema>) {
  const { reviewRefs: _ignored, ...rest } = work;
  return directorySha256(canonicalDirectoryJson(rest));
}
// Same decoded-key/depth checks used by the pilot builder, plus safe integers.
function parseEvidenceJson(text: string): unknown {
  const stack: (Set<string> | null)[] = []; let prior = '', nodes = 0;
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g) ?? [];
  for (const token of tokens) {
    if (++nodes > 200000) throw Error('json-bound');
    if (token === '{' || token === '[') { stack.push(token === '{' ? new Set() : null); if (stack.length > 32) throw Error('json-depth'); }
    else if (token === '}' || token === ']') stack.pop();
    else if (token.startsWith('\"') && stack.at(-1) instanceof Set && (prior === '{' || prior === ',')) { const key: string = JSON.parse(token); const keys = stack.at(-1)!; if (keys.has(key)) throw Error('duplicate-json-key'); keys.add(key); }
    prior = token;
  }
  const result: unknown = JSON.parse(text);
  const check = (v: unknown): void => {
    if (typeof v === 'number' && (!Number.isFinite(v) || Number.isInteger(v) && !Number.isSafeInteger(v))) throw Error('unsafe-json-number');
    if (typeof v === 'string' && /[\uD800-\uDFFF]/u.test(v)) throw Error('invalid-unicode');
    if (v && typeof v === 'object') Object.values(v).forEach(check);
  }; check(result); return result;
}
function at(root: unknown, path: string): unknown {
  let v = root;
  for (const part of path === '' ? [] : path.slice(1).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, part) || Array.isArray(v) && !/^(0|[1-9]\d*)$/.test(part)) throw Error('missing-pointer');
    v = (v as Record<string, unknown>)[part];
  }
  return v;
}
function transform(value: unknown, kind: z.infer<typeof binding>['transform']): unknown {
  if (kind === 'identity') return value;
  if (kind === 'number-string') { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw Error('invalid-number'); return String(value); }
  const parts = z.array(z.number().int()).min(1).max(3).parse(value);
  return { precision: ['year', 'month', 'day'][parts.length - 1], value: parts.map((n, i) => String(n).padStart(i ? 2 : 4, '0')).join('-') };
}
// Only these retained GL05 captures are qualified here. A selection's own hash
// cannot establish that an arbitrary provider response was actually observed.
const gl05Captures: Record<string, { provider: 'github' | 'crossref'; id: string; body: string; receipt: string; url: string }> = {
  'github-sleepboost': { provider: 'github', id: '617168725', body: '66ac1e79e4baa723868870d08ad89c52222fee65064d26787281ed8af40f7c56', receipt: 'fd5942605aa036f2b046ddab44bc3f4d35d736229dd55419f8e90194391d5496', url: 'https://api.github.com/repos/akibzaman/SleepBoost' },
  'github-openpbta': { provider: 'github', id: '192607622', body: '168d20ed54b06459fa13791f65d6a7b828d0fbdff5a4aa21c221423fca641867', receipt: '880d03353a4a004d1fa12f484044816f3fdc93a269a7ae2bae4bf5db9049d6fb', url: 'https://api.github.com/repos/AlexsLemonade/OpenPBTA-analysis' },
  'crossref-sleepboost': { provider: 'crossref', id: '10.1007/s11517-024-03096-x', body: '7fd215c83d699ba8c7b7161c97bdc99cb7d468320069884e213a0021be129a42', receipt: 'c874ed334895c833b3d63bc29bd947058ee11fe2fcbc2933c3c663b3c045c55f', url: 'https://api.crossref.org/v1/works?filter=doi%3A10.1007%2Fs11517-024-03096-x&rows=1&select=DOI%2Ctitle%2Ctype%2Cauthor%2Cpublished%2CURL%2Cpublisher%2Crelation%2Clicense' },
  'crossref-openpbta': { provider: 'crossref', id: '10.1016/j.xgen.2023.100340', body: '87029a1329fcf87d11a740057de736cfee7c4b6e0cd67c0f00d8217a7c41aa3d', receipt: 'c756e1aedbfe7f9fa050848f4185a467b508df46fece0f489985ffdaa4d9f41a', url: 'https://api.crossref.org/v1/works?filter=doi%3A10.1016%2Fj.xgen.2023.100340&rows=1&select=DOI%2Ctitle%2Ctype%2Cauthor%2Cpublished%2CURL%2Cpublisher%2Crelation%2Clicense' },
};
const gl05Base = 'docs/discovery/qualification/evidence/pilot-counties-20261116/';
async function qualifyGl05Capture(meta: z.infer<typeof evidence>, work: z.infer<typeof DirectoryWorkSchema>, loadBytes: (path: string) => Promise<Uint8Array>) {
  const match = /^docs\/discovery\/qualification\/evidence\/pilot-counties-20261116\/(github-sleepboost|github-openpbta|crossref-sleepboost|crossref-openpbta)\/body\.json$/.exec(meta.path);
  if (!match) throw Error('gl05-unqualified-capture');
  const capture = gl05Captures[match[1]];
  if (meta.kind !== 'native-json' || meta.sha256 !== capture.body || meta.sourceUrl !== capture.url || meta.method !== 'provider-metadata' || work.nativeIdentity?.provider !== capture.provider || work.nativeIdentity.nativeId.toLowerCase() !== capture.id) throw Error('gl05-capture-subject');
  const bytes = await loadBytes(`${gl05Base}${match[1]}/observation.json`);
  if (await directorySha256(bytes) !== capture.receipt) throw Error('gl05-receipt-hash');
  const receipt: unknown = parseEvidenceJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (at(receipt, '/provider') !== capture.provider || at(receipt, '/url') !== capture.url || at(receipt, '/body_sha256') !== capture.body || at(receipt, '/status') !== 200 || at(receipt, '/response_complete') !== true || at(receipt, '/started_at_utc') !== undefined && !(at(receipt, '/started_at_utc') as string).startsWith(meta.observedDate)) throw Error('gl05-receipt');
}
/** trustedContext is supplied by reviewed code, never by the selection itself. */
export async function validateDirectorySelection(input: unknown, trustedContext: DirectoryTrustedContext, loadBytes: (path: string) => Promise<Uint8Array>) {
  if (!trustedContext || !(trustedContext.priorState === null || typeof trustedContext.priorState === 'object' && trustedContext.priorState !== null && hash.safeParse(trustedContext.priorState.sha256).success && typeof trustedContext.priorState.path === 'string') || !hash.safeParse(trustedContext.selectionSha256).success || !trustedContext.operator || !trustedContext.reviewer || trustedContext.operator === trustedContext.reviewer || await directorySha256(canonicalDirectoryJson(input)) !== trustedContext.selectionSha256) throw Error('untrusted-selection');
  const selection = DirectoryReviewSelectionSchema.parse(input);
  const sources = new Map<string, { meta: z.infer<typeof evidence>; body: unknown }>();
  for (const meta of selection.evidence) {
    if (sources.has(meta.id)) throw Error('duplicate-evidence');
    const bytes = await loadBytes(meta.path);
    if (bytes.length > 5000000 || await directorySha256(bytes) !== meta.sha256) throw Error('evidence-hash');
    const body: unknown = parseEvidenceJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    sources.set(meta.id, { meta, body });
  }
  let prior = State.parse({ snapshot: { schemaVersion: 'discovery-directory-snapshot-v1', version: 'bootstrap', works: [] }, tombstones: [] });
  if (trustedContext.priorState) {
    const bytes = await loadBytes(trustedContext.priorState.path);
    if (bytes.length > 5000000 || await directorySha256(bytes) !== trustedContext.priorState.sha256) throw Error('prior-state-hash');
    prior = State.parse(parseEvidenceJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    const priorVersion = `sha256:${await directorySha256(canonicalDirectoryJson({ works: prior.snapshot.works, tombstones: prior.tombstones }))}`;
    if (prior.snapshot.version !== priorVersion || prior.snapshot.works.some((w, i, a) => i > 0 && a[i - 1].id >= w.id) || prior.tombstones.some((t, i, a) => i > 0 && a[i - 1].id >= t.id)) throw Error('prior-state-version');
  }
  const tombstones = [...prior.tombstones], works = [...prior.snapshot.works];
  if (new Set(tombstones.map(t => t.id)).size !== tombstones.length || works.some(w => tombstones.some(t => t.id === w.id))) throw Error('prior-state-conflict');
  for (const w of works) { const key = await nativeKey(w); if (key !== null && tombstones.some(t => t.nativeKeySha256 === key)) throw Error('prior-state-conflict'); }
  const seen = new Set<string>(), changes: { candidateId: string; decision: string; workId: string | null }[] = [];
  for (const entry of selection.entries) {
    if (seen.has(entry.candidateId)) throw Error('duplicate-candidate'); seen.add(entry.candidateId);
    const r = entry.receipt;
    if (r.candidateId !== entry.candidateId || r.decision !== entry.decision || r.reason !== entry.reason || canonicalDirectoryJson(r.target) !== canonicalDirectoryJson(entry.target) || r.bindingsSha256 !== await directorySha256(canonicalDirectoryJson(entry.bindings)) || r.operator !== trustedContext.operator || r.reviewer !== trustedContext.reviewer) throw Error('receipt-authority');
    const admitted = entry.decision === 'accept' || entry.decision === 'correction';
    if (admitted !== (entry.work !== null)) throw Error('decision-work');
    const targetRequired = entry.decision === 'correction' || entry.decision === 'removal' || entry.decision === 'duplicate';
    if (targetRequired !== (entry.target !== null)) throw Error('decision-target');
    const existing = entry.target ? works.find(w => w.id === entry.target!.id) : undefined;
    if (targetRequired && (!existing || existing.revision !== entry.target!.revision || entry.decision === 'duplicate' && entry.candidateId === entry.target!.id)) throw Error('stale-target');
    if (!entry.work) {
      if (r.workSha256 !== null || entry.bindings.length) throw Error('private-decision');
      if (entry.decision === 'removal') { works.splice(works.indexOf(existing!), 1); tombstones.push({ id: existing!.id, revision: existing!.revision, nativeKeySha256: await nativeKey(existing!) }); }
      changes.push({ candidateId: entry.candidateId, decision: entry.decision, workId: existing?.id ?? null }); continue;
    }
    const work = entry.work;
    if (entry.decision === 'correction' && (work.id !== existing!.id || work.revision !== existing!.revision + 1)) throw Error('correction-revision');
    const key = await nativeKey(work);
    if (entry.decision === 'correction' && key !== await nativeKey(existing!)) throw Error('correction-identity');
    if (tombstones.some(t => t.id === work.id || key !== null && t.nativeKeySha256 === key)) throw Error('tombstoned-work');
    const same = works.find(w => w.id === work.id);
    if (entry.decision === 'accept' && same && canonicalDirectoryJson(same) !== canonicalDirectoryJson(work)) throw Error('unreviewed-replacement');
    if (entry.decision === 'accept' && !same && work.revision !== 1) throw Error('initial-revision');
    if (r.workSha256 !== await directoryWorkReviewHash(work) || work.reviewRefs.length !== 1 || work.reviewRefs[0].id !== r.id || work.reviewRefs[0].receiptSha256 !== await directorySha256(canonicalDirectoryJson(r))) throw Error('receipt-binding');
    for (const e of work.evidence) {
      const source = sources.get(e.id);
      if (!source || source.meta.sha256 !== e.observationSha256 || source.meta.sourceUrl !== e.sourceUrl || source.meta.observedDate !== e.observedDate || source.meta.method !== e.method) throw Error('evidence-metadata');
      at(source.body, e.pointer);
      if (source.meta.kind === 'curated-observation' && e.pointer.startsWith('/observations/')) {
        const match = /^\/observations\/(0|[1-9]\d*)\/facts\/[A-Za-z][A-Za-z0-9]*$/.exec(e.pointer);
        if (!match || at(source.body, `/observations/${match[1]}/sourceUrl`) !== e.sourceUrl || at(source.body, `/observations/${match[1]}/access`) !== e.method || at(source.body, '/observedDate') !== e.observedDate) throw Error('observation-source');
      }
    }
    const fields = new Set<string>();
    for (const b of entry.bindings) {
      const e = work.evidence.find(x => x.id === b.evidenceId), source = sources.get(b.evidenceId);
      if (!e || !source || e.pointer !== b.pointer || fields.has(b.field)) throw Error('binding-evidence');
      fields.add(b.field);
      if (work.nativeIdentity && ['/nativeIdentity/nativeId', '/title/value', '/url/value', '/sourceDate/value'].includes(b.field) && source.meta.kind === 'curated-observation') throw Error('native-kind');
      const nativeEvidencePaths: Record<string, string> = { '/title/value': '/title/evidenceId', '/url/value': '/url/evidenceId', '/nativeIdentity/nativeId': '/nativeIdentity/evidenceId', '/description/value': '/description/evidenceId', '/owner/name': '/owner/evidenceId', '/owner/kind': '/owner/evidenceId', '/owner/nativeId': '/owner/evidenceId', '/sourceDate/value': '/sourceDate/evidenceId' };
      if (nativeEvidencePaths[b.field] && at(work, nativeEvidencePaths[b.field]) !== b.evidenceId) throw Error('field-evidence');
      if (b.transform === 'reviewed-relation') { const match = /^\/relations\/(0|[1-9]\d*)$/.exec(b.field); if (!match || source.meta.kind !== 'curated-observation' || !work.relations[Number(match[1])]?.evidenceIds.includes(b.evidenceId)) throw Error('relation-binding'); at(source.body, b.pointer); }
      else if (b.transform === 'reviewed-claim') { const match = /^\/claims\/(0|[1-9]\d*)$/.exec(b.field); if (!match || source.meta.kind !== 'curated-observation' || !work.claims[Number(match[1])]?.evidenceIds.includes(b.evidenceId)) throw Error('claim-binding'); at(source.body, b.pointer); }
      else if (canonicalDirectoryJson(at(work, b.field)) !== canonicalDirectoryJson(transform(at(source.body, b.pointer), b.transform))) throw Error('binding-value');
      if (source.meta.kind === 'gl03-fact-packet') {
        const m = /^\/packet\/facts\/(0|[1-9]\d*)\/(nativeId|title|url|ownerType)$/.exec(b.pointer);
        const expected: Record<string, string> = { nativeId: '/id', title: '/full_name', url: '/html_url', ownerType: '/owner/type' };
        // The native-body commitment is checked against the retained, previously
        // qualified GL03 plan; the native bytes themselves were not retained.
        if (source.meta.path !== 'docs/discovery/go-live/evidence/GL03/original/G04.json') throw Error('gl03-unqualified-page');
        const planBytes = await loadBytes('docs/discovery/go-live/evidence/GL03/original/plan.json');
        const plan: unknown = parseEvidenceJson(new TextDecoder('utf-8', { fatal: true }).decode(planBytes));
        if (await directorySha256(canonicalDirectoryJson(plan)) !== at(source.body, '/receipt/manifestSha256')) throw Error('gl03-plan-hash');
        const pages = z.array(z.object({ id: z.string(), sourceId: z.string(), scopeId: z.string(), installation: z.string(), qualificationSha256: z.string(), parserRevision: z.string(), parserSha256: z.string(), requestSha256: z.string(), url: z.string() }).passthrough()).parse(at(plan, '/pages'));
        const page = pages.find(x => x.id === at(source.body, '/receipt/pageId'));
        if (!page || page.id !== 'G04' || page.url !== source.meta.sourceUrl || ['sourceId', 'scopeId', 'installation', 'qualificationSha256', 'parserRevision', 'parserSha256', 'requestSha256'].some(k => page[k as keyof typeof page] !== at(source.body, `/receipt/${k}`))) throw Error('gl03-plan-page');
        const packet = at(source.body, '/packet');
        if (await directorySha256(canonicalDirectoryJson(packet)) !== at(source.body, '/receipt/packetSha256') || await directorySha256(canonicalDirectoryJson(at(source.body, '/packet/facts'))) !== at(source.body, '/receipt/projectionSha256')) throw Error('gl03-digest');
        for (const key of ['pageId', 'nativeBodySha256', 'projectionSha256', 'parserRevision']) if (at(source.body, `/receipt/${key}`) !== at(source.body, `/packet/${key}`)) throw Error('gl03-tuple');
        if (m) {
          const base = `/packet/facts/${m[1]}`;
          if (at(source.body, `${base}/kind`) !== work.kind || work.kind !== 'repository' || at(source.body, `${base}/nativeId`) !== work.nativeIdentity?.nativeId || at(source.body, `${base}/title`) !== work.title.value || at(source.body, `${base}/url`) !== work.url.value || at(source.body, `${base}/frontier/source/lead/nativeId`) !== work.nativeIdentity?.nativeId || at(source.body, `${base}/frontier/source/lead/displayName`) !== work.title.value || at(source.body, `${base}/frontier/source/representationSha256`) !== at(source.body, '/receipt/nativeBodySha256') || at(source.body, `${base}/frontier/source/pageReceiptId`) !== at(source.body, '/receipt/id') || at(source.body, `${base}/frontier/source/lead/publicationAuthorized`) !== false) throw Error('gl03-fact-identity');
        }
        if (!m || work.nativeIdentity?.provider !== 'github' || at(source.body, '/receipt/id') !== at(source.body, '/packet/receiptId') || at(source.body, '/receipt/manifestSha256') !== at(source.body, '/packet/manifestSha256') || at(source.body, '/receipt/qualificationSha256') !== at(source.body, '/packet/qualificationSha256') || at(source.body, '/receipt/requestSha256') !== at(source.body, '/packet/requestSha256') || at(source.body, '/receipt/parserSha256') !== at(source.body, '/packet/parserSha256') || b.nativePointer !== expected[m[2]] || at(source.body, `/packet/facts/${m[1]}/pointers/${m[2] === 'ownerType' ? 'ownerType' : m[2]}`) !== b.nativePointer || at(source.body, '/receipt/status') !== 'received' || at(source.body, '/packet/publicationAuthorized') !== false) throw Error('gl03-binding');
      } else {
        if (b.nativePointer !== null) throw Error('unexpected-native-pointer');
        const gl05Native = source.meta.kind === 'native-json' && /^docs\/discovery\/qualification\/evidence\/pilot-counties-20261116\/(?:github|crossref)-(?:sleepboost|openpbta)\/body\.json$/.test(source.meta.path);
        if (source.meta.kind === 'native-json' && Object.values(gl05Captures).some(c => c.provider === work.nativeIdentity?.provider && c.id === work.nativeIdentity.nativeId.toLowerCase()) && !gl05Native) throw Error('gl05-unqualified-capture');
        if (gl05Native) {
          await qualifyGl05Capture(source.meta, work, loadBytes);
          if (work.nativeIdentity?.provider === 'github') {
            const paths: Record<string, [string, string]> = { '/nativeIdentity/nativeId': ['/id', 'number-string'], '/title/value': ['/full_name', 'identity'], '/url/value': ['/html_url', 'identity'], '/description/value': ['/description', 'identity'], '/owner/name': ['/owner/login', 'identity'], '/owner/kind': ['/owner/type', 'identity'], '/owner/nativeId': ['/owner/id', 'number-string'] };
            const expected = paths[b.field];
            if (!expected || b.pointer !== expected[0] || b.transform !== expected[1]) throw Error('gl05-native-field');
          }
        }
        if (source.meta.kind === 'native-json' && ['/nativeIdentity/nativeId', '/title/value', '/url/value', '/sourceDate/value'].includes(b.field)) {
          if (work.nativeIdentity?.provider === 'github' && gl05Native) continue;
          if (work.nativeIdentity?.provider !== 'crossref') throw Error('unqualified-native-provider');
          const patterns: Record<string, RegExp> = { '/nativeIdentity/nativeId': /^\/message\/items\/(0|[1-9]\d*)\/DOI$/, '/title/value': /^\/message\/items\/(0|[1-9]\d*)\/title\/0$/, '/url/value': /^\/message\/items\/(0|[1-9]\d*)\/URL$/, '/sourceDate/value': /^\/message\/items\/(0|[1-9]\d*)\/published\/date-parts\/0$/ };
          if (!patterns[b.field].test(b.pointer)) throw Error('native-semantic-pointer');
        }
      }
    }
    if (work.nativeIdentity?.provider === 'crossref') {
      const native = entry.bindings.filter(b => ['/nativeIdentity/nativeId', '/title/value', '/url/value', '/sourceDate/value'].includes(b.field));
      const roots = native.map(b => b.pointer.match(/^\/message\/items\/(0|[1-9]\d*)\//)?.[1]);
      const evidenceBodies = native.map(b => sources.get(b.evidenceId)!.meta.sha256);
      const doi = work.nativeIdentity.nativeId.replace(/^https:\/\/doi\.org\//i, '').toLowerCase();
      const url = new URL(work.url.value); const request = new URL(sources.get(work.nativeIdentity.evidenceId)!.meta.sourceUrl);
      const nativeRecord = at(sources.get(work.nativeIdentity.evidenceId)!.body, `/message/items/${roots[0]}`) as Record<string, unknown>;
      if (work.kind !== 'publication' || nativeRecord.type !== 'journal-article') throw Error('crossref-kind');
      if (roots.some(x => x === undefined || x !== roots[0]) || evidenceBodies.some(x => x !== evidenceBodies[0]) || url.hostname !== 'doi.org' || decodeURIComponent(url.pathname.slice(1)).toLowerCase() !== doi || request.hostname !== 'api.crossref.org' || request.pathname !== '/v1/works' || request.searchParams.getAll('filter').length !== 1 || request.searchParams.get('filter')?.toLowerCase() !== `doi:${doi}`) throw Error('crossref-identity');
    }
    if (work.nativeIdentity?.provider === 'github') {
      if (work.url.value !== `https://github.com/${work.title.value}` || sources.get(work.nativeIdentity.evidenceId)?.meta.sourceUrl !== `https://api.github.com/repos/${work.title.value}`) throw Error('github-identity');
    }
    const required = ['/title/value', '/url/value', ...(work.nativeIdentity ? ['/nativeIdentity/nativeId'] : []), ...(work.description ? ['/description/value'] : []), ...(work.owner ? ['/owner/name', '/owner/kind', ...(work.owner.nativeId ? ['/owner/nativeId'] : [])] : []), ...(work.sourceDate ? ['/sourceDate/value'] : [])];
    if (required.some(f => !fields.has(f))) throw Error('missing-native-binding');
    for (let i = 0; i < work.claims.length; i++) if (!entry.bindings.some(b => b.field === `/claims/${i}` && b.transform === 'reviewed-claim' && work.claims[i].evidenceIds.includes(b.evidenceId))) throw Error('missing-claim-binding');
    if (work.evidence.some(e => sources.get(e.id)?.meta.path === 'docs/discovery/go-live/evidence/GL05/source-observations.json')) {
      const claimPointers: Record<string, Record<string, string>> = {
        'github:760662846': { 'medical-imaging': '/observations/3/facts/medicalImaging' },
        'crossref:10.1038/s41592-024-02503-3': { 'machine-learning': '/observations/2/facts/machineLearning', 'biomedical-data': '/observations/2/facts/biomedicalData' },
        'github:617168725': { sleep: '/observations/6/facts/purpose', 'machine-learning': '/observations/6/facts/purpose' },
        'crossref:10.1007/s11517-024-03096-x': { sleep: '/observations/6/facts/purpose', 'machine-learning': '/observations/6/facts/purpose' },
        'github:192607622': { 'biomedical-data': '/observations/7/facts/purpose' },
        'crossref:10.1016/j.xgen.2023.100340': { 'biomedical-data': '/observations/7/facts/purpose' },
      };
      const subject = `${work.nativeIdentity?.provider}:${work.nativeIdentity?.nativeId.toLowerCase()}`;
      for (const claim of work.claims) if (claim.kind === 'topic') {
        const expected = claimPointers[subject]?.[claim.topic];
        const qualified = work.evidence.some(e => claim.evidenceIds.includes(e.id) && e.pointer === expected && sources.get(e.id)?.meta.path === 'docs/discovery/go-live/evidence/GL05/source-observations.json' && sources.get(e.id)?.meta.sha256 === '7e3328ef54de42c6817e7793a5bf36275b0dc4d47d869fa7b836bb7166089cd0');
        if (!expected || !qualified) throw Error('gl05-topic-subject');
      }
      if (subject.includes('617168725') || subject.includes('03096-x') || subject.includes('192607622') || subject.includes('100340')) for (const claim of work.claims) if (claim.kind === 'health-purpose') {
        const expected = subject.includes('617168725') || subject.includes('03096-x') ? '/observations/6/facts/purpose' : '/observations/7/facts/purpose';
        const qualified = work.evidence.find(e => claim.evidenceIds.includes(e.id) && e.pointer === expected && sources.get(e.id)?.meta.sha256 === '7e3328ef54de42c6817e7793a5bf36275b0dc4d47d869fa7b836bb7166089cd0');
        if (!qualified || at(sources.get(qualified.id)!.body, expected) !== claim.text) throw Error('gl05-purpose-subject');
      }
    }
    // The qualified institutional-project adapter requires two independently scoped roles:
    // a project page linking the exact repository and a dated center-location observation.
    for (const claim of work.claims) if (claim.kind === 'regional-connection' && claim.subjectRole === 'project-association') {
      if (work.nativeIdentity?.provider === 'github' && ['617168725', '192607622'].includes(work.nativeIdentity.nativeId)) {
        const sleep = work.nativeIdentity.nativeId === '617168725', projectIndex = sleep ? 6 : 7, locationIndex = sleep ? 6 : 8, edgeIndex = sleep ? 1 : 2;
        const project = work.evidence.find(e => claim.affiliationEvidenceIds.includes(e.id) && e.pointer === `/observations/${projectIndex}/facts/purpose`);
        const location = work.evidence.find(e => claim.geographyEvidenceIds.includes(e.id) && e.pointer === `/observations/${locationIndex}/facts/municipality`);
        const edge = work.evidence.find(e => claim.affiliationEvidenceIds.includes(e.id) && e.pointer === `/explicit_repository_publication_edges/${edgeIndex}`);
        if (!project || !location || !edge || !work.relations.some(r => r.predicate === 'repository-cites-work' && r.evidenceIds.includes(edge.id))) throw Error('gl05-project-roles');
        const p = sources.get(project.id)!, l = sources.get(location.id)!, es = sources.get(edge.id)!;
        const fixed = '7e3328ef54de42c6817e7793a5bf36275b0dc4d47d869fa7b836bb7166089cd0';
        if (p.meta.path !== 'docs/discovery/go-live/evidence/GL05/source-observations.json' || l.meta.path !== p.meta.path || p.meta.sha256 !== fixed || l.meta.sha256 !== fixed || es.meta.path !== `${gl05Base}connector-observations.json` || es.meta.sha256 !== '37f75ca9f45528b9943afd2774a59fc592ac7b983cebfa6d2f106c6205c534c4' || at(p.body, `/observations/${projectIndex}/facts/project`) !== claim.subjectLabel || at(p.body, `/observations/${projectIndex}/facts/institution`) !== claim.institution || at(l.body, `/observations/${locationIndex}/facts/institution`) !== claim.institution || at(l.body, `/observations/${locationIndex}/facts/municipality`) !== claim.municipality || at(l.body, `/observations/${locationIndex}/facts/state`) !== claim.state || claim.regionalBasis !== 'municipality' || claim.county !== null || claim.campus !== null || claim.asOf.precision !== (sleep ? 'day' : 'month') || claim.asOf.value !== at(p.body, `/observations/${projectIndex}/facts/${sleep ? 'date' : 'publicationMonth'}`) || claim.scope !== 'historical') throw Error('gl05-project-context');
        if (sleep) {
          const bytes = await loadBytes(`${gl05Base}regional-contexts.json`);
          if (await directorySha256(bytes) !== '440b35651460bb97d5bba29b4db32f20c01c0edcfa8fdd01fd522f2c59be0e1c') throw Error('gl05-project-location');
          const context: unknown = parseEvidenceJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          if (at(context, '/contexts/1/recordId') !== 'crossref:10.1007/s11517-024-03096-x' || at(context, '/contexts/1/institution') !== claim.institution || at(context, '/contexts/1/municipality') !== claim.municipality) throw Error('gl05-project-location');
        } else {
          const bytes = await loadBytes('docs/discovery/qualification/evidence/ror-chop-20261115/body.json');
          if (await directorySha256(bytes) !== 'd8deea480e21c142e38bbc13fb0b0842364c4cdf8621be57f958a2d51c130893') throw Error('gl05-project-location');
          const ror: unknown = parseEvidenceJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          if (at(ror, '/locations/0/geonames_details/name') !== claim.municipality || at(ror, '/locations/0/geonames_details/country_subdivision_code') !== claim.state) throw Error('gl05-project-location');
        }
        continue;
      }
      const project = work.evidence.find(e => claim.affiliationEvidenceIds.includes(e.id) && /^\/observations\/(0|[1-9]\d*)\/facts\/purpose$/.test(e.pointer));
      const location = work.evidence.find(e => claim.geographyEvidenceIds.includes(e.id) && /^\/observations\/(0|[1-9]\d*)\/facts\/municipality$/.test(e.pointer));
      if (!project || !location || work.nativeIdentity?.provider !== 'github') throw Error('project-evidence-roles');
      const p = sources.get(project.id)!; const l = sources.get(location.id)!;
      const pbase = project.pointer.replace(/\/facts\/purpose$/, ''), lbase = location.pointer.replace(/\/facts\/municipality$/, '');
      const projectName = at(p.body, `${pbase}/facts/project`), institution = at(l.body, `${lbase}/facts/institution`);
      if (at(p.body, `${pbase}/facts/projectRepositoryUrl`) !== work.url.value || typeof projectName !== 'string' || !claim.subjectLabel.endsWith(projectName) || typeof institution !== 'string' || !claim.institution || !institution.includes(claim.institution) || at(l.body, `${lbase}/facts/municipality`) !== claim.municipality || at(l.body, `${lbase}/facts/state`) !== claim.state || claim.asOf.precision !== 'day' || claim.asOf.value !== location.observedDate || claim.county !== null || claim.scope !== 'observed') throw Error('project-context-binding');
      const purposeClaim = work.claims.find(c => c.kind === 'health-purpose');
      if (!purposeClaim || !purposeClaim.evidenceIds.includes(project.id)) throw Error('project-purpose-binding');
    }
    for (const claim of work.claims) if (claim.kind === 'regional-connection' && claim.subjectRole === 'author-affiliation') {
      const regional = work.evidence.find(e => claim.evidenceIds.includes(e.id) && /^\/contexts\/(0|[1-9]\d*)\/institution$/.test(e.pointer));
      if (!regional || work.nativeIdentity?.provider !== 'crossref' || !work.sourceDate) throw Error('author-context');
      const src = sources.get(regional.id)!; const base = regional.pointer.replace(/\/institution$/, '');
      const context = at(src.body, base) as Record<string, unknown>;
      if (['10.1007/s11517-024-03096-x', '10.1016/j.xgen.2023.100340'].includes(work.nativeIdentity.nativeId.toLowerCase())) {
        const index = work.nativeIdentity.nativeId.toLowerCase().endsWith('03096-x') ? 1 : 2;
        if (src.meta.path !== `${gl05Base}regional-contexts.json` || src.meta.sha256 !== '440b35651460bb97d5bba29b4db32f20c01c0edcfa8fdd01fd522f2c59be0e1c' || regional.pointer !== `/contexts/${index}/institution` || claim.state !== 'NJ' || claim.scope !== 'historical' || claim.asOf.value !== work.sourceDate.value.value.slice(0, 4)) throw Error('gl05-author-context');
      }
      const authors = z.array(z.object({ sourceIndex: z.number().int(), name: z.string() }).passthrough()).parse(context.authors);
      const doi = work.nativeIdentity.nativeId.replace(/^https:\/\/doi\.org\//i, '').toLowerCase();
      const identityBinding = entry.bindings.find(b => b.field === '/nativeIdentity/nativeId')!;
      const nativeBody = sources.get(identityBinding.evidenceId)!.body;
      const nativeRoot = identityBinding.pointer.replace(/\/DOI$/, '');
      const author = at(nativeBody, `${nativeRoot}/author/${claim.sourceAuthorIndex}`) as Record<string, unknown>;
      const nativeName = [author.given, author.family].filter(x => typeof x === 'string' && x).join(' ') || author.name;
      if (nativeName !== claim.subjectLabel) throw Error('native-author-binding');
      if (!claim.affiliationEvidenceIds.includes(regional.id)) throw Error('author-affiliation-role');
      const geographic = work.evidence.find(e => claim.geographyEvidenceIds.includes(e.id) && e.pointer === `${base}/county` && e.observationSha256 === regional.observationSha256);
      const countySources = z.array(z.object({ url: z.string(), observedDate: z.string() }).passthrough()).parse(context.countySources);
      if (!geographic || !countySources.some(a => a.url === geographic.sourceUrl && a.observedDate === geographic.observedDate) || at(src.body, geographic.pointer) !== claim.county) throw Error('author-geography-role');
      const affiliationSources = z.array(z.object({ url: z.string(), observedDate: z.string() }).passthrough()).parse(context.affiliationSources);
      if (!affiliationSources.some(a => a.url === regional.sourceUrl && a.observedDate === regional.observedDate)) throw Error('author-context-source');
      if (context.recordId !== `crossref:${doi}` || context.publicationSourceSha256 !== sources.get(work.nativeIdentity.evidenceId)?.meta.sha256 || String(context.publicationYear) !== claim.asOf.value || claim.asOf.precision !== 'year' || context.institution !== claim.institution || context.campus !== claim.campus || context.municipality !== claim.municipality || context.county !== claim.county || !authors.some(a => a.sourceIndex === claim.sourceAuthorIndex && a.name === claim.subjectLabel)) throw Error('author-context-binding');
    }
    for (let i = 0; i < work.relations.length; i++) if (!entry.bindings.some(b => b.field === `/relations/${i}` && b.transform === 'reviewed-relation')) throw Error('missing-relation-binding');
    if (entry.decision === 'correction') works.splice(works.indexOf(existing!), 1, work); else if (!same) works.push(work);
    changes.push({ candidateId: entry.candidateId, decision: entry.decision, workId: work.id });
  }
  works.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  tombstones.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const allIds = new Set(works.map(w => w.id));
  if (allIds.size !== works.length) throw Error('duplicate-work');
  for (const work of works) for (let i = 0; i < work.relations.length; i++) {
    const relation = work.relations[i], entry = selection.entries.find(e => e.work?.id === work.id), other = works.find(w => w.id === relation.toId);
    if (!other) throw Error('relation-unreviewed');
    if (!entry) continue;
    const b = entry.bindings.find(b => b.field === `/relations/${i}` && b.transform === 'reviewed-relation')!;
    const relationSource = sources.get(b.evidenceId)!;
    const observed = at(relationSource.body, b.pointer);
    const pair = ({
      '617168725': { index: 1, doi: '10.1007/s11517-024-03096-x', alias: 'akibzaman/SleepBoost' },
      '192607622': { index: 2, doi: '10.1016/j.xgen.2023.100340', alias: 'AlexsLemonade/OpenPBTA-analysis' },
    } as Record<string, { index: number; doi: string; alias: string }>)[work.nativeIdentity?.nativeId ?? ''];
    if (pair) {
      const bytes = await loadBytes(`${gl05Base}connector-observations.json`);
      if (await directorySha256(bytes) !== '37f75ca9f45528b9943afd2774a59fc592ac7b983cebfa6d2f106c6205c534c4') throw Error('gl05-relation-source');
      const connector: unknown = parseEvidenceJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      const base = `/file_observation_batch/files/${pair.index}`, edge = `/explicit_repository_publication_edges/${pair.index}`;
      if (relationSource.meta.path !== `${gl05Base}connector-observations.json` || relationSource.meta.kind !== 'curated-observation' || relationSource.meta.method !== 'reviewed-observation' || relationSource.meta.observedDate !== '2026-11-16' || b.pointer !== edge || relationSource.meta.sha256 !== '37f75ca9f45528b9943afd2774a59fc592ac7b983cebfa6d2f106c6205c534c4' || work.nativeIdentity?.provider !== 'github' || work.title.value !== pair.alias || other.nativeIdentity?.provider !== 'crossref' || other.nativeIdentity.nativeId.toLowerCase() !== pair.doi || relation.predicate !== 'repository-cites-work' || at(connector, `${base}/permalink`) !== relationSource.meta.sourceUrl || at(connector, `${base}/repository`) !== pair.alias || at(connector, `${base}/tool_success`) !== true || at(connector, `${base}/doi_mentions/0`) !== pair.doi || at(connector, `${edge}/repository`) !== pair.alias || at(connector, `${edge}/doi`) !== pair.doi || at(connector, `${edge}/commit`) !== at(connector, `${base}/commit`) || at(connector, `${edge}/paths/0`) !== at(connector, `${base}/path`)) throw Error('gl05-relation-subject');
    }
    if (pair) continue;
    const expected = { fromId: work.id, toId: other.id, predicate: relation.predicate, fromNativeIdentity: work.nativeIdentity && { provider: work.nativeIdentity.provider, namespace: work.nativeIdentity.namespace, nativeId: work.nativeIdentity.nativeId }, toNativeIdentity: other.nativeIdentity && { provider: other.nativeIdentity.provider, namespace: other.nativeIdentity.namespace, nativeId: other.nativeIdentity.nativeId } };
    if (canonicalDirectoryJson(observed) !== canonicalDirectoryJson(expected)) throw Error('relation-subject');
  }
  const contentHash = await directorySha256(canonicalDirectoryJson({ works, tombstones }));
  const snapshot = DirectorySnapshotSchema.parse({ schemaVersion: 'discovery-directory-snapshot-v1', version: `sha256:${contentHash}`, works });
  const previous = new Map(prior.snapshot.works.map(w => [w.id, w]));
  const current = new Map(works.map(w => [w.id, w]));
  const added = works.filter(w => !previous.has(w.id)).map(w => w.id);
  const removed = prior.snapshot.works.filter(w => !current.has(w.id)).map(w => w.id);
  const revised = works.filter(w => previous.has(w.id) && canonicalDirectoryJson(w) !== canonicalDirectoryJson(previous.get(w.id))).map(w => w.id);
  const report = { previousSnapshotVersion: trustedContext.priorState ? prior.snapshot.version : null, snapshotVersion: snapshot.version, added, removed, revised, workCount: works.length, supportObjectCount: 0, projectGroupCount: null, changes };
  return { snapshot, state: { snapshot, tombstones }, report };
}
