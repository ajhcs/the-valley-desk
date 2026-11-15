import assert from 'node:assert/strict';
import test from 'node:test';
import { createDiscoveryCollector } from '../src/ingest/discovery/collector';
import { createDiscoveryTransport } from '../src/ingest/discovery/transport';
import { DiscoveryRuntimeError } from '../src/ingest/discovery/runtime-contract';
import type { DiscoveryCollectionStore } from '../src/ingest/discovery/collection-contract';

const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
type Scenario='success'|'issue-timeout'|'commit-timeout'|'issued'|'sync-overrun'|'issue-error'|'transport-error'|'real-transport'|'short-issued';
function fixture(scenario:Scenario, config:{processingMs?:number;leaseMs?:number;sourceMs?:number;credentialMs?:number}={}) {
  const wall=Date.now(), processingDeadlineAt=new Date(wall+(config.processingMs??500)).toISOString(), expiresAt=new Date(wall+(config.leaseMs??1500)).toISOString();
  const template={id:'constructor:test',origin:'https://example.test',path:'/items',fixed:{},parameters:{q:{kind:'text',maxLength:30}},required:['q']};
  const source={id:'source:test',installation:'synthetic',requiresAuth:true,credentialRef:'credential:test',budget:{maxWallTimeMs:config.sourceMs??1000},endpointTemplate:template};
  const claim={id:'claim:test',roundId:'round:test',slot:0,owner:'worker:test',fence:1,expiresAt,processingDeadlineAt,source,sourceLease:{owner:'worker:test',sourceId:'source:test',expiresAt},issuedPlanId:scenario==='issued'?'plan:previous':null};
  const observed={sends:0,finishes:0,commits:0,discards:0,finishInput:null as unknown, capabilityRequests:[] as unknown[]};
  let issued:any;
  const store:any={
    claimNext:async()=>({kind:'claimed',claim}), resolveOperation:async()=>null,
    issueForClaim:async(_ctx:unknown,input:{planId:string;deadlineAt:string})=>{
      if(scenario==='issue-timeout'||scenario==='short-issued') await sleep(150);
      if(scenario==='issue-error')throw new DiscoveryRuntimeError('permission-denied','secret-token-issue');
      issued={id:input.planId,source,request:{operationId:'operation:issued'},endpoint:'https://example.test/items?q=test',deadlineAt:scenario==='short-issued'?new Date(wall+70).toISOString():input.deadlineAt,maxResponseBytes:100,requestBindingToken:'synthetic-token'};
      return issued;
    },
    preparePage:()=>{if(scenario==='sync-overrun'){const until=performance.now()+140;while(performance.now()<until){} }return Promise.resolve({});},
    discardPreparedPage:()=>{observed.discards++},
    commitPage:async(ctx:{operationId:string})=>{observed.commits++;if(scenario==='commit-timeout')await sleep(150);return {roundId:'round:test',slot:0,claimId:'claim:test',sourceId:'source:test',operationId:ctx.operationId,representation:{id:'representation:test',revision:1}};},
    finishSlot:async(ctx:{operationId:string},input:unknown)=>{observed.finishes++;observed.finishInput=input;return {roundId:'round:test',slot:0,sourceId:'source:test',operationId:ctx.operationId};},
    createTransport:(options:unknown)=>{
      const registry:any={resolvePlanIdentity:async()=>({sourceId:'source:test',operationId:'operation:issued'}),resolvePlan:async()=>issued,reserveAttempt:async(input:{attemptId:string})=>({attemptId:input.attemptId,plan:issued,request:issued.request,deadlineAt:issued.deadlineAt,maxResponseBytes:100}),finishAttempt:async()=>{}};
      return createDiscoveryTransport({registry,...options as object});
    },
  };
  const transport={acquire:async(id:string)=>{observed.sends++;if(scenario==='transport-error')return {ok:false as const,failure:{schemaVersion:'discovery-v1' as const,sourceId:'source:test',operationId:'operation:issued',outcome:'upstream-failed' as const,code:'secret-token-transport',retryAfter:null,checkpointUnchanged:true as const}};return {ok:true as const,acquisition:{plan:{id,source,request:{operationId:'operation:issued'}},bytes:new Uint8Array([1])} as never};}};
  const capabilityFor=async(request:unknown)=>{observed.capabilityRequests.push(request);return 'synthetic-capability';};
  const collector=createDiscoveryCollector({store:store as DiscoveryCollectionStore,clock:()=>wall,capabilityFor,
    ...(scenario==='real-transport'?{transportOptions:{clock:()=>wall,credentialResolver:async()=>{await sleep(config.credentialMs??0);return {origin:'https://example.test',headers:{Authorization:'Bearer synthetic'},expiresAt:new Date(wall+1200).toISOString()}},egress:{send:async()=>{observed.sends++;return new Response('synthetic');}}}}:{transport})});
  const input={roundId:'round:test',owner:'worker:test',claimOperationId:`claimop:${scenario}`,expiresAt,processingDeadlineAt};
  return {collector,input,observed};
}

test('issued token loss and uncertain issue/commit never trigger a competing mutation or free resend',async()=>{
  for(const scenario of ['issue-timeout','commit-timeout','issued'] as const){
    const f=fixture(scenario,{processingMs:50});const result=await f.collector.step(f.input);
    assert.equal(result.kind,'uncertain');assert.equal(f.observed.finishes,0);
    if(scenario!=='commit-timeout')assert.equal(f.observed.sends,0);
    await sleep(180);
    if(scenario==='commit-timeout')assert.equal(f.observed.commits,1);
    if(scenario==='issued')assert.equal(f.observed.commits,0);
  }
});

test('nonpreemptible parser overrun cannot finalize after the original lease expires, even with frozen wall clock',async()=>{
  const f=fixture('sync-overrun',{processingMs:40,leaseMs:100});
  const result=await f.collector.step(f.input);assert.equal(result.kind,'uncertain');assert.equal(f.observed.finishes,0);
});

test('external issue and transport failure strings are not persisted into finalization',async()=>{
  for(const scenario of ['issue-error','transport-error'] as const){
    const f=fixture(scenario);const result=await f.collector.step(f.input);assert.equal(result.kind,'failure');
    assert.equal(JSON.stringify({result,input:f.observed.finishInput}).includes('secret-token'),false);
    for(const request of f.observed.capabilityRequests as Array<{targetId:string}>)assert.equal(request.targetId,'round:test');
  }
});

test('real WP06 transport cannot send after collector deadline with delayed credentials and frozen wall clock',async()=>{
  const f=fixture('real-transport',{processingMs:70,credentialMs:150});
  const result=await f.collector.step(f.input);assert.equal(result.kind,'uncertain');await sleep(200);assert.equal(f.observed.sends,0);
});

test('source-specific cap shortens default collector deadline without preventing a quick valid page',async()=>{
  const slow=fixture('real-transport',{processingMs:1200,leaseMs:1600,sourceMs:70,credentialMs:150});
  const result=await slow.collector.step(slow.input);assert.equal(result.kind,'uncertain');await sleep(200);assert.equal(slow.observed.sends,0);
  const quick=fixture('success',{processingMs:1200,leaseMs:1600,sourceMs:800});
  assert.equal((await quick.collector.step(quick.input)).kind,'page');assert.equal(quick.observed.sends,1);
});

test('a shorter issued deadline includes time already spent issuing under a frozen clock',async()=>{
  const f=fixture('short-issued',{processingMs:1000,leaseMs:1500,sourceMs:1000});
  const result=await f.collector.step(f.input);assert.equal(result.kind,'uncertain');assert.equal(f.observed.sends,0);
});
