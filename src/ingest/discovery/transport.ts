import { DISCOVERY_UNRESOLVED_PLAN_IDENTITY, DiscoveryRuntimeError, discoveryRuntimeFailure, type DiscoverySourceRegistry, type DiscoveryCredentialResolver, type DiscoveryEgress, type DiscoveryTransportResult, type DiscoveryIssuedPlan } from './runtime-contract';
import { validateDiscoveryEndpoint } from './endpoint';
import { DiscoveryId } from '../../content/discovery-schema';
import { SOURCE_USER_AGENT } from '../upstream';

const MAX_REDIRECTS = 3;
type Options = { registry: DiscoverySourceRegistry; credentialResolver?: DiscoveryCredentialResolver; egress?: DiscoveryEgress; clock?: () => number };
const err = (outcome: ConstructorParameters<typeof DiscoveryRuntimeError>[0], code: string, retryAfter: string | null = null) => new DiscoveryRuntimeError(outcome,code,retryAfter);
const validHeader = /^(authorization|x-api-key)$/i;
const controls = /[\u0000-\u001f\u007f]/u;

function retryAfter(value: string | null, now: number): string {
  let target: number;
  if (value && /^\d+$/.test(value)) {
    const delta = value.length <= 15 ? Number(value) : Infinity;
    target = Number.isSafeInteger(delta) ? now + delta * 1000 : Infinity;
  } else if (value && /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) {
    target = Date.parse(value);
    if (!Number.isFinite(target) || new Date(target).toUTCString() !== value) target = now + 60_000;
    target = Math.max(now,target);
  } else target = now + 60_000;
  // An unrepresentably long server hold must not become an immediate retry.
  if (!Number.isSafeInteger(target) || target > Date.parse('9999-12-31T23:59:59.000Z')) return '9999-12-31T23:59:59.000Z';
  return new Date(target).toISOString();
}
async function attemptId(planId: string, hop: number): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${planId}\n${hop}`));
  return `attempt:${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,'0')).join('')}`;
}

// GitHub uses 403 for primary and some secondary rate limits. Explicit rate
// headers distinguish this case from a plain permission/authentication failure.
// Keep a conservative minute floor and honor the longest declared server hold.
function githubRetryAfter(headers: Headers, now: number): string {
  const ceiling = '9999-12-31T23:59:59.000Z';
  let target = Date.parse(retryAfter(null,now));
  if (headers.has('retry-after')) target = Math.max(target,Date.parse(retryAfter(headers.get('retry-after'),now)));
  const raw = headers.get('x-ratelimit-reset');
  if (raw && /^\d+$/.test(raw)) {
    const seconds = raw.length <= 15 ? Number(raw) : Infinity;
    const reset = seconds * 1000;
    if (!Number.isSafeInteger(reset) || reset > Date.parse(ceiling)) return ceiling;
    target = Math.max(target,reset);
  }
  return new Date(target).toISOString();
}

/** Server-only: registry and connect-time public-destination egress must be injected. */
export function createDiscoveryTransport(options: Options) {
  const now = options.clock ?? Date.now;
  async function acquire(planId: string): Promise<DiscoveryTransportResult> {
    let plan: DiscoveryIssuedPlan | undefined;
    let identity: {sourceId:string;operationId:string} = {...DISCOVERY_UNRESOLVED_PLAN_IDENTITY};
    let activeAttempt: string | undefined;
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let receivedBytes = 0;
    const started = performance.now();
    let lastWall = now();
    const effectiveNow = () => { lastWall = Math.max(lastWall,now()); return lastWall; };
    const controller = new AbortController();
    let deadline = effectiveNow() + 300_000;
    let remainingAtPlan = 300_000;
    const remaining = () => Math.max(0,Math.min(deadline-effectiveNow(),remainingAtPlan-(performance.now()-started)));
    const bounded = async <T>(work: () => Promise<T>): Promise<T> => {
      const ms = remaining();
      if (ms <= 0) { controller.abort(); throw err('timed-out','discovery-deadline'); }
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const value = await Promise.race([work(),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(err('timed-out','discovery-deadline'));},ms);})]);
        if (remaining() <= 0) { controller.abort(); throw err('timed-out','discovery-deadline'); }
        return value;
      } finally { if (timeout) clearTimeout(timeout); }
    };
    const finish = async (outcome: Parameters<DiscoverySourceRegistry['finishAttempt']>[0]) => {
      await bounded(()=>options.registry.finishAttempt(outcome));
      activeAttempt = undefined;
    };
    try {
      const resolved = await bounded(()=>options.registry.resolvePlanIdentity(planId));
      if (!resolved || !DiscoveryId.safeParse(resolved.sourceId).success || !DiscoveryId.safeParse(resolved.operationId).success) throw err('unavailable','discovery-plan-identity-unavailable');
      identity = {sourceId:resolved.sourceId,operationId:resolved.operationId};
      if (!options.egress) throw err('unavailable','discovery-egress-unavailable');
      plan = structuredClone(await bounded(()=>options.registry.resolvePlan(planId)));
      if (plan.source.id !== identity.sourceId || plan.request.operationId !== identity.operationId) throw err('unavailable','discovery-plan-identity-mismatch');
      deadline = Date.parse(plan.deadlineAt);
      const wallLimit = plan.source.budget.maxWallTimeMs;
      if (!Number.isSafeInteger(wallLimit) || wallLimit < 1 || wallLimit > 300_000) throw err('misconfigured','discovery-deadline-invalid');
      remainingAtPlan = Math.min(wallLimit, deadline-effectiveNow()+performance.now()-started);
      if (!Number.isFinite(deadline) || remaining() <= 0) throw err('timed-out','discovery-deadline');
      let endpoint: string;
      try { endpoint = await bounded(()=>validateDiscoveryEndpoint(plan!.source.endpointTemplate,plan!.endpoint,plan!.continuation,new Date(effectiveNow()).toISOString())); } catch (e) { if (e instanceof DiscoveryRuntimeError) throw e; throw err('misconfigured','discovery-endpoint-invalid'); }
      const originalOrigin = new URL(endpoint).origin;
      const visited = new Set<string>();
      for (let hop=0; hop<=MAX_REDIRECTS; hop++) {
        if (visited.has(endpoint)) throw err('upstream-failed','discovery-redirect-loop');
        visited.add(endpoint);
        let headers: Record<string,string> = {};
        let credentialExpiry = Infinity;
        let credentialMonotonicDeadline = Infinity;
        if (plan.source.requiresAuth) {
          if (!options.credentialResolver || !plan.source.credentialRef) throw err('misconfigured','discovery-credential-unavailable');
          let binding;
          try { binding = await bounded(()=>Promise.resolve().then(()=>options.credentialResolver!(plan!.source.credentialRef!,{sourceId:plan!.source.id,installation:plan!.source.installation,origin:originalOrigin,endpointConstructor:plan!.source.endpointTemplate.id})).then(value=>structuredClone(value)).catch(()=>{throw err('misconfigured','discovery-credential-unavailable');})); }
          catch (e) { if (e instanceof DiscoveryRuntimeError) throw e; throw err('misconfigured','discovery-credential-unavailable'); }
          if (!binding || binding.origin !== originalOrigin || !Number.isFinite(Date.parse(binding.expiresAt)) || Date.parse(binding.expiresAt) <= effectiveNow()) throw err('misconfigured','discovery-credential-unavailable');
          const names = Object.keys(binding.headers);
          if (!names.length || names.length > 2 || names.some(n=>!validHeader.test(n)) || new Set(names.map(n=>n.toLowerCase())).size !== names.length || names.some(n=>typeof binding!.headers[n] !== 'string' || !binding!.headers[n] || binding!.headers[n].length > 8192 || controls.test(binding!.headers[n]))) throw err('misconfigured','discovery-credential-unavailable');
          headers = Object.fromEntries(names.map(n=>[n,binding!.headers[n]]));
          credentialExpiry = Date.parse(binding.expiresAt);
          credentialMonotonicDeadline = performance.now() + (credentialExpiry - effectiveNow());
        }
        if (plan.source.provider === 'github') {
          headers['User-Agent'] = SOURCE_USER_AGENT;
          headers.Accept = 'application/vnd.github+json';
          headers['X-GitHub-Api-Version'] = '2022-11-28';
        }
        const id = await bounded(()=>attemptId(plan!.id,hop));
        const permit = structuredClone(await bounded(()=>options.registry.reserveAttempt({planId:plan!.id,attemptId:id,endpoint,ordinal:hop,hop})));
        activeAttempt = id;
        if (permit.attemptId !== id || permit.plan.id !== plan.id || permit.deadlineAt !== plan.deadlineAt || !Number.isSafeInteger(permit.maxResponseBytes) || permit.maxResponseBytes < 1 || permit.maxResponseBytes > plan.maxResponseBytes || remaining() <= 0) throw err('unavailable','discovery-permit-invalid');
        if (credentialExpiry <= effectiveNow() || credentialMonotonicDeadline <= performance.now()) throw err('misconfigured','discovery-credential-unavailable');
        // Registry admission is the linearization point. Egress owns connect-time DNS enforcement.
        response = await bounded(()=>{
          const sending = Promise.resolve().then(()=>options.egress!.send(endpoint,{headers,signal:controller.signal,redirect:'manual'})).catch(()=>{throw err('unavailable','discovery-egress-failed');});
          sending.then(late => { if (controller.signal.aborted) void late.body?.cancel().catch(()=>{}); }).catch(()=>{});
          return sending;
        });
        if (response.status >= 300 && response.status <= 399) {
          const status = response.status;
          const location = response.headers.get('location');
          void response.body?.cancel().catch(()=>{}); response = undefined;
          if (!location || hop === MAX_REDIRECTS || controls.test(location)) throw err('upstream-failed','discovery-redirect-denied');
          let next: URL;
          try { next = new URL(location,endpoint); } catch { throw err('upstream-failed','discovery-redirect-denied'); }
          if (next.origin !== originalOrigin) throw err('upstream-failed','discovery-redirect-denied');
          let nextEndpoint: string;
          try { nextEndpoint = await bounded(()=>validateDiscoveryEndpoint(plan!.source.endpointTemplate,next.href,plan!.continuation,new Date(effectiveNow()).toISOString())); } catch (e) { if (e instanceof DiscoveryRuntimeError) throw e; throw err('upstream-failed','discovery-redirect-denied'); }
          if (nextEndpoint !== plan.endpoint) {
            await finish({attemptId:id,outcome:'upstream-failed',receivedBytes:0,httpStatus:status,code:'discovery-redirect-denied'});
            throw err('upstream-failed','discovery-redirect-denied');
          }
          await finish({attemptId:id,outcome:'upstream-failed',receivedBytes:0,httpStatus:status,code:'discovery-redirect'});
          endpoint = nextEndpoint;
          continue;
        }
        if (!response.ok) {
          const status = response.status;
          const github = plan.source.provider === 'github';
          const githubRateLimit = github && status === 403 &&
            (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after'));
          const limited = status === 429 || githubRateLimit;
          const outcome = limited ? 'rate-limited' : status === 401 || status === 403 ? 'auth-failed' : 'upstream-failed';
          const retry = limited ? github ? githubRetryAfter(response.headers,effectiveNow()) : retryAfter(response.headers.get('retry-after'),effectiveNow()) : null;
          void response.body?.cancel().catch(()=>{}); response = undefined;
          await finish({attemptId:id,outcome,receivedBytes:0,httpStatus:status,retryAfter:retry,code:'discovery-upstream-status'});
          throw err(outcome,'discovery-upstream-status',retry);
        }
        const length = response.headers.get('content-length');
        if (length && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length)>permit.maxResponseBytes)) throw err('upstream-failed','discovery-response-too-large');
        if (!response.body) throw err('upstream-failed','discovery-response-empty');
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        for (;;) {
          const next = await bounded(()=>Promise.resolve().then(()=>reader!.read()).catch(()=>{throw err('unavailable','discovery-body-read-failed');}));
          if (next.done) break;
          if (!(next.value instanceof Uint8Array)) throw err('upstream-failed','discovery-response-invalid');
          receivedBytes += next.value.byteLength;
          if (receivedBytes > permit.maxResponseBytes) throw err('upstream-failed','discovery-response-too-large');
          chunks.push(new Uint8Array(next.value));
        }
        if (receivedBytes === 0) throw err('upstream-failed','discovery-response-empty');
        const bytes = new Uint8Array(receivedBytes); let offset=0;
        for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.length; }
        const status = response.status;
        const representationSha256 = Array.from(new Uint8Array(await bounded(()=>crypto.subtle.digest('SHA-256',bytes))), b=>b.toString(16).padStart(2,'0')).join('');
        const linkMetadata = plan.source.provider === 'github' ? {responseLink:response.headers.get('link')} : {};
        if (linkMetadata.responseLink && linkMetadata.responseLink.length > 4096) throw err('upstream-failed','discovery-response-link-too-large');
        await finish({attemptId:id,outcome:'received',receivedBytes,httpStatus:status,representationSha256,...linkMetadata});
        return {ok:true,acquisition:{plan,attemptId:id,bytes,endpoint,status,receivedBytes,retainedByteCeiling:permit.maxResponseBytes,...linkMetadata}};
      }
      throw err('upstream-failed','discovery-redirect-denied');
    } catch (failure) {
      controller.abort();
      if (reader) void reader.cancel().catch(()=>{}); else if (response?.body) void response.body.cancel().catch(()=>{});
      const safe = failure instanceof DiscoveryRuntimeError ? failure : err('unavailable','discovery-transport-unavailable');
      if (activeAttempt) {
        // Best effort only: a deadline or storage failure leaves an explicitly charged uncertain attempt.
        if (remaining() > 0) { try { await bounded(()=>options.registry.finishAttempt({attemptId:activeAttempt!,outcome:safe.outcome,receivedBytes,code:safe.code,retryAfter:safe.retryAfter})); } catch { /* charged attempt remains uncertain */ } }
      }
      return {ok:false,failure:discoveryRuntimeFailure(safe,identity.operationId,identity.sourceId)};
    }
  }
  return {acquire};
}
