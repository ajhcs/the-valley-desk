import { DiscoveryEndpointTemplate, type DiscoveryContinuation } from './runtime-contract';
import { canonicalDiscoveryEvidenceJson } from '../discovery-evidence-store';

const fail = (): never => { throw new Error('discovery-endpoint-invalid'); };
const control = /[\u0000-\u001f\u007f]/u;
function wellFormed(value: string): boolean {
  for (let i=0; i<value.length; i++) {
    const c=value.charCodeAt(i);
    if (c>=0xd800 && c<=0xdbff) { const n=value.charCodeAt(++i); if (!(n>=0xdc00 && n<=0xdfff)) return false; }
    else if (c>=0xdc00 && c<=0xdfff) return false;
  }
  return true;
}
const namePattern = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

function checkedTemplate(input: unknown): DiscoveryEndpointTemplate {
  const parsed = DiscoveryEndpointTemplate.safeParse(input);
  if (!parsed.success) return fail();
  const t = parsed.data;
  let origin: URL;
  try { origin = new URL(t.origin); } catch { return fail(); }
  const host = origin.hostname.toLowerCase();
  // Literals and local names are rejected up front. This is not a DNS check.
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.port ||
      origin.origin !== t.origin || origin.pathname !== '/' || origin.search || origin.hash ||
      host === 'localhost' || host === 'local' || host === 'internal' || host === 'home.arpa' ||
      host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal') || host.endsWith('.home.arpa') || host.includes(':') ||
      /^\d+(?:\.\d+)*$/.test(host) || !host.includes('.')) return fail();
  // Paths are literal reviewed ASCII segments, without URL normalization or encoded separators.
  if (!/^\/(?:[A-Za-z0-9_~.-]+\/?)*$/.test(t.path) ||
      t.path.split('/').some(s => s === '.' || s === '..') || t.path.includes('//') ||
      new URL(t.path, origin).pathname !== t.path) return fail();
  const fixedNames = Object.keys(t.fixed), dynamicNames = Object.keys(t.parameters);
  if (fixedNames.length + dynamicNames.length > 20 ||
      [...fixedNames, ...dynamicNames].some(n => !namePattern.test(n)) ||
      fixedNames.some(n => n in t.parameters) || new Set(t.required).size !== t.required.length ||
      t.required.some(n => !Object.hasOwn(t.parameters,n)) ||
      (t.pageParameter !== undefined && !Object.hasOwn(t.parameters,t.pageParameter))) return fail();
  for (const value of Object.values(t.fixed)) if (control.test(value) || !wellFormed(value)) return fail();
  for (const rule of Object.values(t.parameters)) {
    if (rule.kind === 'enum' && (new Set(rule.values).size !== rule.values.length || rule.values.some(v => control.test(v) || !wellFormed(v)))) return fail();
  }
  return t;
}

async function sha(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2,'0')).join('');
}
export async function discoveryEndpointTemplateDigest(template: unknown): Promise<string> {
  return sha(canonicalDiscoveryEvidenceJson(checkedTemplate(template)));
}

function validValue(value: string, rule: DiscoveryEndpointTemplate['parameters'][string]): boolean {
  if (control.test(value) || !wellFormed(value) || !value.length) return false;
  switch (rule.kind) {
    case 'integer': return /^(?:0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= rule.min && Number(value) <= rule.max;
    case 'text': return Array.from(value).length <= rule.maxLength;
    case 'token': return value.length <= rule.maxLength && !/^\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value);
    case 'enum': return rule.values.includes(value);
  }
}

/** Pure grammar validation only. The registry authenticates a continuation and its parent. */
export async function constructDiscoveryEndpoint(template: unknown, entries: readonly (readonly [string,string])[], continuation?: DiscoveryContinuation, now = new Date().toISOString()): Promise<string> {
  const t = checkedTemplate(template);
  if (!Array.isArray(entries) || entries.length > 20) return fail();
  const values = new Map<string,string>();
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string') return fail();
    const [name,value] = entry;
    if (values.has(name) || !Object.hasOwn(t.parameters,name) || !validValue(value,t.parameters[name])) return fail();
    values.set(name,value);
  }
  if (t.required.some(n => !values.has(n))) return fail();
  if (continuation) {
    const token = t.pageParameter && values.get(t.pageParameter);
    if (!token || !continuation.parentReceiptId || !/^[a-f0-9]{64}$/.test(continuation.tokenSha256) ||
        !Number.isFinite(Date.parse(now)) || !Number.isFinite(Date.parse(continuation.expiresAt)) ||
        Date.parse(continuation.expiresAt) <= Date.parse(now) || await sha(token) !== continuation.tokenSha256) return fail();
  }
  const url = new URL(t.path,t.origin);
  const all = [...Object.entries(t.fixed),...values.entries()].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0);
  for (const [name,value] of all) url.searchParams.append(name,value);
  if (url.href.length > 2048) return fail();
  return url.href;
}

export async function validateDiscoveryEndpoint(template: unknown, raw: string, continuation?: DiscoveryContinuation, now?: string): Promise<string> {
  const t = checkedTemplate(template);
  if (typeof raw !== 'string' || control.test(raw) || raw.length > 2048) return fail();
  let url: URL;
  try { url = new URL(raw); } catch { return fail(); }
  if (url.origin !== t.origin || url.pathname !== t.path || url.username || url.password || url.hash) return fail();
  const entries: [string,string][] = [];
  const seen = new Set<string>();
  for (const [name,value] of url.searchParams) {
    if (seen.has(name)) return fail();
    seen.add(name);
    if (Object.hasOwn(t.fixed,name)) { if (t.fixed[name] !== value) return fail(); }
    else entries.push([name,value]);
  }
  if (Object.keys(t.fixed).some(n => !seen.has(n))) return fail();
  const canonical = await constructDiscoveryEndpoint(t,entries,continuation,now);
  if (canonical !== raw) return fail();
  return canonical;
}
