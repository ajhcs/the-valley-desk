import assert from 'node:assert/strict';
import test, {type TestContext} from 'node:test';
import {readFileSync} from 'node:fs';
import {unstable_splitSqlQuery} from 'wrangler';
import {createDiscoveryForumAdapter,qualifyDiscoveryForumScope} from '../src/ingest/discovery/forum';
import {createDiscoveryForumCurrentnessConsumer} from '../src/ingest/discovery/forum-currentness';
import {putDiscoveryEntity} from '../src/ingest/discovery-store';
import {createDiscoveryEvidenceStore} from '../src/ingest/discovery-evidence-store';
import {makeDiscoveryDate} from '../src/content/discovery-schema';
import {fixture,authority,evidenceContext,ref,forumScopeInput,forumListTemplate,forumTopicTemplate,forumList,forumTopic} from './helpers/discovery-forum-currentness-fixture';

async function setup(t:TestContext,orphanQualification=false){
 const f=await fixture(t);
 await f.db.batch(unstable_splitSqlQuery(readFileSync(new URL('../migrations/0045_discovery_source_support.sql',import.meta.url),'utf8')).map(sql=>f.db.prepare(sql)));
 const scopes=new Map<string,any>(),sources=new Map<string,any>(),parents=new Map<string,string>();let store:ReturnType<typeof f.makeStore>;
 const adapter=createDiscoveryForumAdapter({resolveSource:async id=>sources.get(id)??null,resolveScope:async id=>scopes.get(id)??null,
 resolvePlan:id=>f.registry.resolvePlan(id),resolvePage:id=>store.resolvePage(id),resolveRepresentation:r=>f.registry.resolveRetainedRepresentation(r),
 resolveClaim:id=>store.resolveClaim(id),resolveChainPage:(id,n)=>store.resolveChainPage(id,n),listingReceiptForTopicSource:async id=>parents.get(id)??null,now:f.now});
 store=f.makeStore(f.db,adapter.parse);let serial=0;
 const collect=async(source:any,body:any)=>{const tag=`lifecycle-${++serial}`;f.advance(31000);await f.makeRound(store,`round:${tag}`,`cohort:${tag}`,[source]);
 const result=await f.makeCollector(store,{transportOptions:{clock:()=>Date.parse(f.now()),egress:{send:async()=>new Response(JSON.stringify(body))}}}).step(f.stepInput(`round:${tag}`));
 assert.equal(result.kind,'page',JSON.stringify(result));if(result.kind!=='page')throw Error('page');return result.receipt;};
 const scope=await qualifyDiscoveryForumScope(forumScopeInput('lifecycle'));scopes.set(scope.id,scope);
 const listingSource=await f.source('lifecycle-list',{scopeId:scope.id,installation:scope.installationId,accessPolicy:scope.retentionPolicy.id,template:forumListTemplate(scope,'endpoint:lifecycle-list'),params:{page:'0'}});sources.set(listingSource.value.id,listingSource.value);
 const listing=await collect(listingSource,forumList()),topicId=await adapter.topicSourceId(listing.id,12);parents.set(topicId,listing.id);
 const topic=await f.source('lifecycle-topic',{...(orphanQualification?{qualificationBody:forumTopic()}:{}),sourceId:topicId,scopeId:scope.id,installation:scope.installationId,accessPolicy:scope.retentionPolicy.id,template:forumTopicTemplate(scope,'endpoint:lifecycle-topic',12),params:{}});sources.set(topicId,topic.value);
 const evidence=f.registry.createEvidenceStore({resolveCapability:authority,resolveForumSupport:adapter.supportSnapshot});
 const consumer=createDiscoveryForumCurrentnessConsumer(evidence);
 await putDiscoveryEntity(f.db,{operationId:'synthetic:lifecycle-anchor',expectedRevision:null,entity:{schemaVersion:'discovery-v1',id:'artifact:lifecycle',revision:1,kind:'artifact',artifactKind:'discussion',displayName:'Synthetic only',sourceDate:makeDiscoveryDate('unknown',null)}});
 const support=async(tag:string,page:any,pointer:string,value:unknown)=>{
  await evidence.appendEvidence(evidenceContext(`support:${tag}`),{id:`evidence:${tag}`,revision:1,representation:page.representation,selector:{kind:'json-pointer',pointer,value}});
  await evidence.appendClaim(evidenceContext(`claim:${tag}`),{id:`claim:${tag}`,revision:1,subject:{kind:'artifact',id:'artifact:lifecycle'},subjectRevision:1,predicate:`synthetic-${tag}`,value:'Synthetic current support only.',uncertainty:'asserted',validFrom:null,validUntil:null,evidence:[ref(`evidence:${tag}`)],policy:ref(topic.ids.policy)});
  await evidence.appendDecision(evidenceContext(`decision:${tag}`),{id:`decision:${tag}`,revision:1,claim:ref(`claim:${tag}`),decision:'accepted',reason:'Fictional ledger fixture; no admission bridge',policy:ref(topic.ids.policy),decidedAt:f.now()});
 };
 const body=(version=1,reordered=false)=>{const v:any=forumTopic(version,`<p>Synthetic version ${version}.</p>`),other={...v.post_stream.posts[0],id:43,post_number:2,cooked:'<p>Unchanged other post.</p>',version:1};v.post_stream.posts=reordered?[other,v.post_stream.posts[0]]:[v.post_stream.posts[0],other];v.post_stream.stream=[42,43];v.posts_count=2;return v;};
 const edit=(prior:any,current:any,id='change:post42')=>({id,revision:1,priorReceiptId:prior.id,currentReceiptId:current.id,postId:42,policy:scope.retentionPolicy});
 return{f,scope,topic,adapter,evidence,consumer,collect,support,body,edit};
}

test('native edit invalidates every older post copy, preserves other post and historical content, blocks resurrection',{timeout:600000},async t=>{
 const x=await setup(t),v1=x.body(1),p1=await x.collect(x.topic,v1);await x.support('old-v1',p1,'/post_stream/posts/0/cooked',v1.post_stream.posts[0].cooked);
 await x.support('unrelated',p1,'/post_stream/posts/1/cooked',v1.post_stream.posts[1].cooked);
 const v2=x.body(2,true),p2=await x.collect(x.topic,v2);await x.support('old-v2',p2,'/post_stream/posts/1/cooked',v2.post_stream.posts[1].cooked);
 const v3=x.body(3),p3=await x.collect(x.topic,v3),ctx=evidenceContext('native-edit');
 const before=await x.f.evidence.readRevision('representation',p1.representation.id,p1.representation.revision);
 const result=await x.consumer.consumeEdit(ctx,x.edit(p2,p3));assert.equal(result.affectedEvidenceCount,2);assert.equal(result.committed,true);assert.equal(result.deletionVerified,false);
 for(const tag of ['old-v1','old-v2'])for(const kind of ['evidence','claim','decision'] as const){const value=await x.evidence.readRevision(kind,`${kind}:${tag}`,1);assert.equal(value?.usable,false);assert.equal(value?.invalidated,true);assert.ok(value?.content);assert.equal(value?.tombstoned,false);}
 assert.equal((await x.evidence.readRevision('decision','decision:unrelated',1))?.usable,true);
 assert.deepEqual(await x.f.evidence.readRevision('representation',p1.representation.id,p1.representation.revision),before);
 assert.deepEqual(await x.consumer.consumeEdit(ctx,x.edit(p2,p3)),result);
 await assert.rejects(x.consumer.consumeEdit(ctx,{...x.edit(p2,p3),postId:43}));
 await assert.rejects(x.evidence.appendEvidence(evidenceContext('resurrection'),{id:'evidence:resurrected',revision:1,representation:p1.representation,selector:{kind:'json-pointer',pointer:'/post_stream/posts/0/cooked',value:v1.post_stream.posts[0].cooked}}));
 const lateBody=x.body(1,true),late=await x.collect(x.topic,lateBody);
 await assert.rejects(x.evidence.appendEvidence(evidenceContext('late-old-copy'),{id:'evidence:late-old-copy',revision:1,representation:late.representation,selector:{kind:'json-pointer',pointer:'/post_stream/posts/1/cooked',value:lateBody.post_stream.posts[1].cooked}}));
 await x.evidence.appendEvidence(evidenceContext('late-other'),{id:'evidence:late-other',revision:1,representation:late.representation,selector:{kind:'json-pointer',pointer:'/post_stream/posts/0/cooked',value:lateBody.post_stream.posts[0].cooked}});
 assert.equal((await x.f.db.prepare('SELECT count(*) AS n FROM discovery_catalog_decision_refs').first<any>())?.n,0);
});

test('ancestor selectors and ambiguous spans invalidate; unrelated title and valid current support remain usable',{timeout:600000},async t=>{
 const x=await setup(t),body=x.body(1),prior=await x.collect(x.topic,body);
 for(const [tag,pointer,value] of [['root','',body],['posts','/post_stream/posts',body.post_stream.posts],['post','/post_stream/posts/0',body.post_stream.posts[0]],['title','/title',body.title]] as const)await x.support(tag,prior,pointer,value);
 const rep=await x.evidence.readRevision('representation',prior.representation.id,prior.representation.revision),text=(rep!.content as any).normalizedText,start=text.indexOf('Synthetic version 1.');assert.ok(start>=0);
 await x.evidence.appendEvidence(evidenceContext('span'),{id:'evidence:span',revision:1,representation:prior.representation,selector:{kind:'text-span',start,end:start+'Synthetic version 1.'.length,quote:'Synthetic version 1.'}});
 const nextBody=x.body(2,true),current=await x.collect(x.topic,nextBody),result=await x.consumer.consumeEdit(evidenceContext('selector-edit'),x.edit(prior,current));
 assert.equal(result.affectedEvidenceCount,4);assert.equal(result.conservativeSpanCount,1);
 for(const tag of ['root','posts','post','span'])assert.equal((await x.evidence.readRevision('evidence',`evidence:${tag}`,1))?.usable,false);
 assert.equal((await x.evidence.readRevision('decision','decision:title',1))?.usable,true);
 for(const [tag,pointer,value] of [['new-root','',body],['new-posts','/post_stream/posts',body.post_stream.posts],['new-post','/post_stream/posts/0',body.post_stream.posts[0]]] as const)
  await assert.rejects(x.evidence.appendEvidence(evidenceContext(tag),{id:`evidence:${tag}`,revision:1,representation:prior.representation,selector:{kind:'json-pointer',pointer,value}}));
 await assert.rejects(x.evidence.appendEvidence(evidenceContext('bad-index'),{id:'evidence:bad-index',revision:1,representation:prior.representation,selector:{kind:'json-pointer',pointer:'/post_stream/posts/00/cooked',value:body.post_stream.posts[0].cooked}}));
 await x.evidence.appendEvidence(evidenceContext('fresh-post'),{id:'evidence:fresh-post',revision:1,representation:current.representation,selector:{kind:'json-pointer',pointer:'/post_stream/posts/1/cooked',value:nextBody.post_stream.posts[1].cooked}});
 assert.equal((await x.evidence.readRevision('evidence','evidence:fresh-post',1))?.usable,true);
});

test('wrong authority, reverse native order, future edit and late transaction failure leave zero effects',{timeout:600000},async t=>{
 const x=await setup(t),body=x.body(1),prior=await x.collect(x.topic,body);await x.support('protected',prior,'/post_stream/posts/0/cooked',body.post_stream.posts[0].cooked);
 const current=await x.collect(x.topic,x.body(2)),before=await x.f.dump();
 const denied=x.f.registry.createEvidenceStore({resolveCapability:async(token,request)=>({...await authority(token,request),action:'capture'}),resolveForumSupport:x.adapter.supportSnapshot});
 await assert.rejects(denied.invalidateSourceSupport(evidenceContext('wrong-authority'),x.edit(prior,current)));assert.deepEqual(await x.f.dump(),before);
 await assert.rejects(x.consumer.consumeEdit(evidenceContext('reversed'),x.edit(current,prior)));assert.deepEqual(await x.f.dump(),before);
 const lateDb={prepare:x.f.db.prepare.bind(x.f.db),batch:(statements:any[])=>x.f.db.batch([...statements,x.f.db.prepare('SELECT * FROM deliberate_missing_final_statement')])};
 const late=createDiscoveryEvidenceStore(lateDb,{resolveCapability:authority,resolveForumSupport:x.adapter.supportSnapshot,composeSourceChangeGuard:x.f.registry.composeSourceChangeGuard,now:x.f.now});
 await assert.rejects(late.invalidateSourceSupport(evidenceContext('late-failure'),x.edit(prior,current)));assert.deepEqual(await x.f.dump(),before);
 const future=x.body(3);future.post_stream.posts[0].updated_at='2080-01-01T00:00:00Z';const futurePage=await x.collect(x.topic,future),futureBefore=await x.f.dump();
 await assert.rejects(x.consumer.consumeEdit(evidenceContext('future-native-edit'),x.edit(prior,futurePage)));assert.deepEqual(await x.f.dump(),futureBefore);
});

test('unacknowledged but retained native capture prevents an incomplete coverage claim',{timeout:600000},async t=>{
 const x=await setup(t,true),orphan={representation:{id:'representation:lifecycle-topic:sample',revision:1}};
 await x.support('orphan',orphan,'/post_stream/posts/0/cooked','<p>Synthetic public discussion.</p>');
 const prior=await x.collect(x.topic,x.body(1)),current=await x.collect(x.topic,x.body(2)),before=await x.f.dump();
 await assert.rejects(x.consumer.consumeEdit(evidenceContext('orphan-hold'),x.edit(prior,current)),/unmapped-history/);assert.deepEqual(await x.f.dump(),before);
 assert.equal((await x.evidence.readRevision('decision','decision:orphan',1))?.usable,true,'hold is explicit; no false complete-invalidation claim');
});

test('actual source revision two with unchanged controls is held for affected and unrelated new support',{timeout:600000},async t=>{
 const x=await setup(t),first=x.body(1),prior=await x.collect(x.topic,first);await x.support('frame-other',prior,'/post_stream/posts/1/cooked',first.post_stream.posts[1].cooked);
 const current=await x.collect(x.topic,x.body(2));await x.consumer.consumeEdit(evidenceContext('frame-watermark'),x.edit(prior,current));
 const value={...x.topic.value,revision:2},context=(label:string)=>({operationId:`frame:${label}`,capabilityToken:'synthetic'}),future=(ms:number)=>new Date(Date.parse(x.f.now())+ms).toISOString();x.f.advance(31000);
 await x.f.registry.enroll(context('revision-two'),value);
 await x.f.registry.authorizeSampling(context('sample'),{id:'sample:frame-two',sourceId:value.id,sourceRevision:2,maxRequests:1,expiresAt:'2090-01-01T00:00:00Z'});
 const oldLease=await x.f.db.prepare('SELECT id,fence FROM discovery_source_leases WHERE source_id=?').bind(value.id).first<any>();
 const lease=await x.f.registry.acquireLease(context('lease'),{id:oldLease.id,sourceId:value.id,owner:'synthetic:qualification-worker',expectedFence:oldLease.fence,expiresAt:future(30000)});
 const plan=await x.f.registry.issue(context('issue'),{id:'plan:frame-two',sourceId:value.id,sourceRevision:2,runId:'run:frame-two',purpose:'qualification-sample',samplingGrantId:'sample:frame-two',parameters:{},checkpoint:null,lease:{id:lease.id,owner:lease.owner,fence:lease.fence},deadlineAt:future(30000)});
 const body=x.body(3),acquired=await x.f.registry.createTransport({clock:()=>Date.parse(x.f.now()),egress:{send:async()=>new Response(JSON.stringify(body))}}).acquire(plan.id);assert.equal(acquired.ok,true);if(!acquired.ok)throw Error('capture');
 const e=x.f.registry.createEvidenceStore({resolveCapability:authority});
 await e.appendIssuedSourceRequest(evidenceContext('frame-issued'),{id:plan.id,revision:1,requestSha256:plan.requestSha256,materialScope:value.materialScope,actualEndpoint:plan.endpoint,originMemberId:plan.originMemberId,permission:value.permission,rights:value.rights,expiresAt:plan.retainedThrough,requestBindingToken:plan.requestBindingToken});
 await e.appendOrigin(evidenceContext('frame-origin'),{id:'origin:frame-two',revision:1,status:'provisional-source-response',originalWorkId:null,materialScope:value.materialScope,issuedRequest:ref(plan.id),requestSha256:plan.requestSha256,members:[plan.originMemberId],memberEndpoints:{[plan.originMemberId]:plan.endpoint},retentionRights:[value.rights],policy:ref(x.topic.ids.policy),reason:'Fictional source revision; no inferred frame equivalence',requestBindingToken:plan.requestBindingToken});
 const representation=ref('representation:frame-two');
 await e.appendRepresentation(evidenceContext('frame-capture'),{...representation,enrollment:value.enrollment,configuration:value.configuration,permission:value.permission,rights:value.rights,origin:ref('origin:frame-two'),originMemberId:plan.originMemberId,parser:value.parser,normalizer:value.normalizer,materialScope:value.materialScope,issuedRequest:ref(plan.id),requestSha256:plan.requestSha256,actualEndpoint:plan.endpoint,capturedAt:x.f.now(),byteKind:'captured-body-bytes',format:'json',bytes:acquired.acquisition.bytes,requestBindingToken:plan.requestBindingToken});
 const before=await x.f.dump();
 for(const index of [0,1])await assert.rejects(e.appendEvidence(evidenceContext(`frame-evidence-${index}`),{id:`evidence:frame-two-${index}`,revision:1,representation,selector:{kind:'json-pointer',pointer:`/post_stream/posts/${index}/cooked`,value:body.post_stream.posts[index].cooked}}),/source-support/);
 assert.deepEqual(await x.f.dump(),before);
 assert.equal((await x.evidence.readRevision('decision','decision:frame-other',1))?.usable,true,'existing visibility after source-frame changes remains the separate WP14/WP16 hold');
});

test('phantom capture and source deactivation before commit abort the entire invalidation',{timeout:600000},async t=>{
 const x=await setup(t),body=x.body(1),prior=await x.collect(x.topic,body);await x.support('race',prior,'/post_stream/posts/0/cooked',body.post_stream.posts[0].cooked);
 const current=await x.collect(x.topic,x.body(2));let afterExternal:any,once=false;
 const phantomDb={prepare:x.f.db.prepare.bind(x.f.db),batch:async(statements:any[])=>{if(!once){once=true;await x.collect(x.topic,x.body(1,true));afterExternal=await x.f.dump();}return x.f.db.batch(statements);}};
 const phantom=createDiscoveryEvidenceStore(phantomDb,{resolveCapability:authority,resolveForumSupport:x.adapter.supportSnapshot,composeSourceChangeGuard:x.f.registry.composeSourceChangeGuard,now:x.f.now});
 await assert.rejects(phantom.invalidateSourceSupport(evidenceContext('phantom-capture'),x.edit(prior,current)),/inventory-changed/);
 assert.deepEqual(await x.f.dump(),afterExternal);assert.equal((await x.evidence.readRevision('decision','decision:race',1))?.usable,true);
 let deactivated=false;
 const inactiveDb={prepare:x.f.db.prepare.bind(x.f.db),batch:async(statements:any[])=>{if(!deactivated){deactivated=true;await x.f.registry.deactivate({operationId:'race:deactivate',capabilityToken:'synthetic'},{sourceId:x.topic.value.id,reasonCode:'synthetic-race',expectedGeneration:(await x.f.db.prepare('SELECT generation FROM discovery_source_heads WHERE source_id=?').bind(x.topic.value.id).first<any>())!.generation});afterExternal=await x.f.dump();}return x.f.db.batch(statements);}};
 const inactive=createDiscoveryEvidenceStore(inactiveDb,{resolveCapability:authority,resolveForumSupport:x.adapter.supportSnapshot,composeSourceChangeGuard:x.f.registry.composeSourceChangeGuard,now:x.f.now});
 await assert.rejects(inactive.invalidateSourceSupport(evidenceContext('inactive-at-commit'),x.edit(prior,current)));
 assert.equal(deactivated,true);assert.equal((await x.f.db.prepare('SELECT active FROM discovery_source_heads WHERE source_id=?').bind(x.topic.value.id).first<any>())?.active,0);
 assert.deepEqual(await x.f.dump(),afterExternal);assert.equal((await x.evidence.readRevision('decision','decision:race',1))?.usable,true);
});
