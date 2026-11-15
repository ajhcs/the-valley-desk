import { DiscoveryId, DiscoveryInstant } from '../../content/discovery-schema';
import { DiscoverySourceFailure, type DiscoverySourceFailure as SourceFailure } from './source-contract';
import { DiscoveryRuntimeError, type DiscoveryTransportResult } from './runtime-contract';
import type {
  DiscoveryCollectionAction, DiscoveryCollectionClaim, DiscoveryCollectionContext,
  DiscoveryCollectionStore, DiscoveryCollectionStepResult, DiscoveryCollectionTokenRequest,
  DiscoveryCollectionTransportOptions, DiscoveryPreparedCollectionPage,
} from './collection-contract';

type CollectorOptions = {
  store: DiscoveryCollectionStore;
  // Trusted server-only credential minting, never an authority object from a request body.
  capabilityFor: (request: DiscoveryCollectionTokenRequest & {domain:'collection'}) => Promise<string>;
  transport?: {acquire(planId:string):Promise<DiscoveryTransportResult>};
  transportOptions?: DiscoveryCollectionTransportOptions;
  clock?: () => number;
  maxStepMs?: number;
  cleanupMs?: number;
};
export type DiscoveryCollectionStepInput = {
  roundId:string;owner:string;claimOperationId:string;expiresAt:string;processingDeadlineAt:string;
};
class StepTimeout extends Error {}
const sourceFailure = (sourceId:string, operationId:string, outcome:SourceFailure['outcome'], code:string):SourceFailure => ({
  schemaVersion:'discovery-v1',sourceId,operationId,outcome,code,retryAfter:null,checkpointUnchanged:true,
});
async function stageId(claim:DiscoveryCollectionClaim,stage:string):Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([claim.roundId,claim.slot,claim.id,claim.fence,stage]));
  const hash = await crypto.subtle.digest('SHA-256',bytes);
  return `collection:${Array.from(new Uint8Array(hash), b=>b.toString(16).padStart(2,'0')).join('')}`;
}

/** Server-only bounded orchestration. Store owns the parser and every durable mutation. */
export function createDiscoveryCollector(options:CollectorOptions) {
  const store = options.store;
  const capabilityFor = options.capabilityFor;
  const injectedTransport = options.transport;
  const configuredTransportOptions = {...options.transportOptions};
  const clock = options.clock ?? Date.now;
  const discard = (handle:DiscoveryPreparedCollectionPage) => { try { store.discardPreparedPage(handle); } catch { /* best-effort in-memory cleanup */ } };
  const maxStepMs = options.maxStepMs ?? 300_000;
  const cleanupMs = options.cleanupMs ?? 1000;
  if (!Number.isSafeInteger(maxStepMs) || maxStepMs < 1 || maxStepMs > 300_000 ||
      !Number.isSafeInteger(cleanupMs) || cleanupMs < 1 || cleanupMs > 5000) throw new Error('discovery-collection-invalid-time-bound');
  async function step(input:DiscoveryCollectionStepInput):Promise<DiscoveryCollectionStepResult> {
    const copied = structuredClone(input);
    DiscoveryId.parse(copied.roundId); DiscoveryId.parse(copied.owner); DiscoveryId.parse(copied.claimOperationId);
    DiscoveryInstant.parse(copied.expiresAt); DiscoveryInstant.parse(copied.processingDeadlineAt);
    const leaseEnd = Date.parse(copied.expiresAt), processingEnd = Date.parse(copied.processingDeadlineAt);
    if (processingEnd > leaseEnd) throw new Error('discovery-collection-invalid-deadline');
    const started = performance.now();
    let lastWall = clock();
    const now = () => { lastWall = Math.max(lastWall,clock()); return lastWall; };
    const originalWall = now();
    let sourceEnd = Math.min(processingEnd,originalWall+maxStepMs);
    let monotonicLimit = maxStepMs;
    const remaining = () => Math.max(0,Math.min(sourceEnd-now(),monotonicLimit-(performance.now()-started))); 
    const within = async <T>(work:()=>Promise<T>, limit:()=>number = remaining):Promise<T> => {
      const ms=limit(); if (ms<=0) throw new StepTimeout();
      let timer:ReturnType<typeof setTimeout>|undefined;
      try { const result=await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new StepTimeout()),ms);})]);
        if (limit()<=0) throw new StepTimeout(); return result;
      } finally { if(timer)clearTimeout(timer); }
    };
    const uncertain = (code:string,claimId:string|null=null,operationId=copied.claimOperationId):DiscoveryCollectionStepResult => ({kind:'uncertain',roundId:copied.roundId,claimId,operationId,code});
    const context = async (action:DiscoveryCollectionAction,operationId:string,limit:()=>number=remaining):Promise<DiscoveryCollectionContext> => {
      const token=await within(()=>capabilityFor({domain:'collection',action,targetId:copied.roundId,operationId}),limit);
      if(typeof token!=='string'||!token||token.length>2048)throw new Error('discovery-collection-capability-unavailable');
      return {operationId,capabilityToken:token};
    };
    let claim:DiscoveryCollectionClaim;
    try {
      const ctx=await context('claim-slot',copied.claimOperationId);
      const result=await within(()=>store.claimNext(ctx,{roundId:copied.roundId,owner:copied.owner,expiresAt:copied.expiresAt,processingDeadlineAt:copied.processingDeadlineAt}));
      if(result.kind==='complete'||result.kind==='stopped'||result.kind==='busy')return result;
      if(result.kind==='skipped')return {kind:'skipped',ack:result.ack};
      if(!('claim' in result)) return uncertain('discovery-collection-claim-binding');
      claim=structuredClone(result.claim);
    } catch { return uncertain('discovery-collection-claim-uncertain'); }
    if(claim.roundId!==copied.roundId || claim.owner!==copied.owner || claim.processingDeadlineAt!==copied.processingDeadlineAt ||
       Date.parse(claim.expiresAt)<processingEnd || Date.parse(claim.sourceLease.expiresAt)<processingEnd ||
       claim.sourceLease.owner!==claim.owner || claim.sourceLease.sourceId!==claim.source.id) return uncertain('discovery-collection-claim-binding',claim.id);
    const sourceLimit=claim.source.budget.maxWallTimeMs;
    if(!Number.isSafeInteger(sourceLimit)||sourceLimit<1||sourceLimit>300_000) return uncertain('discovery-collection-source-deadline-invalid',claim.id);
    monotonicLimit=Math.min(monotonicLimit,sourceLimit);
    sourceEnd=Math.min(sourceEnd,originalWall+sourceLimit);
    if(remaining()<=0) return uncertain('discovery-collection-claim-deadline',claim.id);
    let ids:string[];
    try { ids=await within(()=>Promise.all(['issue','plan','commit','finish'].map(stage=>stageId(claim,stage)))); }
    catch { return uncertain('discovery-collection-reconciliation-uncertain',claim.id); }
    const [issueId,planId,commitId,finishId] = ids;
    const finish = async (failure:SourceFailure, cleanup=false):Promise<DiscoveryCollectionStepResult> => {
      // This is the only post-cutoff operation: one fenced timeout finalization
      // when no mutation is in flight and the original lease remains live.
      const cleanupStart=performance.now();
      const limit=cleanup ? () => Math.max(0,Math.min(
        cleanupMs-(performance.now()-cleanupStart),
        Date.parse(claim.expiresAt)-now(),Date.parse(claim.sourceLease.expiresAt)-now(),
        Math.min(Date.parse(claim.expiresAt),Date.parse(claim.sourceLease.expiresAt))-originalWall-(performance.now()-started),
      )) : remaining;
      if(limit()<=0)return uncertain('discovery-collection-finish-uncertain',claim.id,finishId);
      try {
        const ctx=await context('finish-slot',finishId,limit);
        const ack=await within(()=>store.finishSlot(ctx,{claimId:claim.id,failure}),limit);
        if(ack.roundId!==claim.roundId||ack.slot!==claim.slot||ack.sourceId!==claim.source.id||ack.operationId!==finishId) return uncertain('discovery-collection-finish-binding',claim.id,finishId);
        return {kind:'failure',ack};
      } catch { return uncertain('discovery-collection-finish-uncertain',claim.id,finishId); }
    };
    try {
      for(const id of [commitId,finishId]) {
        const prior=await within(()=>store.resolveOperation(id));
        if(prior) return 'representation' in prior ? {kind:'page',receipt:prior} : {kind:'failure',ack:prior};
      }
      if(claim.issuedPlanId) return uncertain('discovery-collection-issued-uncertain',claim.id,issueId);
      const issueContext=await context('issue-page',issueId);
      let issued;
      try { issued=structuredClone(await within(()=>store.issueForClaim(issueContext,{claimId:claim.id,planId,deadlineAt:new Date(sourceEnd).toISOString()}))); }
      catch(e) {
        if(e instanceof StepTimeout) return uncertain('discovery-collection-issue-uncertain',claim.id,issueId);
        if(e instanceof DiscoveryRuntimeError) {
          const safe = DiscoverySourceFailure.safeParse(sourceFailure(claim.source.id,issueId,e.outcome,'discovery-collection-issue-denied'));
          if(safe.success)return finish(safe.data);
        }
        return uncertain('discovery-collection-issue-uncertain',claim.id,issueId);
      }
      if(issued.id!==planId || issued.source.id!==claim.source.id || !issued.requestBindingToken ||
         Date.parse(issued.deadlineAt)>sourceEnd || Date.parse(issued.deadlineAt)>Date.parse(claim.sourceLease.expiresAt))
        return uncertain('discovery-collection-issue-binding',claim.id,issueId);
      // Only the store-created transport is used in production. The optional
      // transport override is a trusted, isolated test seam.
      const issuedEnd=Date.parse(issued.deadlineAt);
      if(!Number.isFinite(issuedEnd))return uncertain('discovery-collection-issue-binding',claim.id,issueId);
      monotonicLimit=Math.min(monotonicLimit,issuedEnd-originalWall);
      sourceEnd=Math.min(sourceEnd,issuedEnd);
      if(remaining()<=0)return uncertain('discovery-collection-issue-uncertain',claim.id,issueId);
      const upstreamEgress=configuredTransportOptions.egress;
      const transportOptions:DiscoveryCollectionTransportOptions = {
        ...configuredTransportOptions,
        ...(upstreamEgress ? {egress:{send:(url,init)=>{
          if(remaining()<=0)throw new Error('discovery-collection-deadline');
          return upstreamEgress.send(url,init);
        }}} : {}),
      };
      const transport=injectedTransport ?? store.createTransport(transportOptions);
      let result:DiscoveryTransportResult;
      try { result=await within(()=>transport.acquire(planId)); }
      catch { return uncertain('discovery-collection-attempt-uncertain',claim.id,issueId); }
      if(!result.ok) {
        const parsed=DiscoverySourceFailure.safeParse(result.failure);
        const failure=parsed.success && parsed.data.sourceId===claim.source.id && parsed.data.operationId===issued.request.operationId
          ? {...parsed.data,code:'discovery-collection-transport-failed'} : sourceFailure(claim.source.id,issued.request.operationId,'unavailable','discovery-collection-transport-binding');
        return finish(failure,remaining()<=0);
      }
      const acquisition=structuredClone(result.acquisition);
      if(acquisition.plan.id!==planId || acquisition.plan.source.id!==claim.source.id || acquisition.plan.request.operationId!==issued.request.operationId)
        return uncertain('discovery-collection-acquisition-binding',claim.id,issueId);
      let prepared:DiscoveryPreparedCollectionPage;
      let discarded=false;
      let latePrepared:DiscoveryPreparedCollectionPage | undefined;
      try {
        prepared=await within(()=>{
          const promise=store.preparePage(claim.id,acquisition);
          promise.then(handle=>{latePrepared=handle;if(discarded)discard(handle);}).catch(()=>{});
          return promise;
        });
      } catch(e) {
        discarded=true;
        if(latePrepared)discard(latePrepared);
        if(e instanceof StepTimeout) return finish(sourceFailure(claim.source.id,issued.request.operationId,'timed-out','discovery-collection-parse-timeout'),true);
        return finish(sourceFailure(claim.source.id,issued.request.operationId,'parser-failed','discovery-collection-parse-failed'));
      }
      let commitStarted=false;
      try {
        const ctx=await context('commit-page',commitId);
        const receipt=await within(()=>{
          const pending=store.commitPage(ctx,{prepared,requestBindingToken:issued.requestBindingToken});
          commitStarted=true;
          pending.then(()=>discard(prepared),()=>discard(prepared));
          return pending;
        });
        if(receipt.roundId!==claim.roundId||receipt.slot!==claim.slot||receipt.claimId!==claim.id||receipt.sourceId!==claim.source.id||receipt.operationId!==commitId)
          return uncertain('discovery-collection-receipt-binding',claim.id,commitId);
        return {kind:'page',receipt};
      } catch { return uncertain('discovery-collection-commit-uncertain',claim.id,commitId); }
      finally { if(!commitStarted)discard(prepared); }
    } catch { return uncertain('discovery-collection-reconciliation-uncertain',claim.id); }
  }
  return {step};
}
