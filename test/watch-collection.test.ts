import assert from "node:assert/strict";
import test from "node:test";
import { pdfDatabase } from "./helpers/policy-pdf";
import { rssSource,rssBody,rssItem,atomBody,githubInput,repository,release,SEEN_AT } from "./fixtures/watch-adapters/synthetic";
import { canonicalJson, sha256 } from "../src/content/watch-schema";
import { sourceConfigurationDigest, type SourceEnrollment } from "../src/ingest/watch/source-enrollment";
import { configureWatchCollectionSource,resolveEnrolledCollectionSource,resolveWatchCollectionEvidence,revokeWatchCollectionReview } from "../src/ingest/watch/collection-storage";
import { runWatchCollection } from "../src/ingest/watch/collector";
import type { D1DatabaseLike } from "../src/ingest/persistence";

async function enroll(db:D1DatabaseLike,overrides:Partial<SourceEnrollment>={}) {
  const source=rssSource({...overrides,state:"qualified",qualificationReceiptId:"synthetic-qualified"});
  const qualification={id:"synthetic-qualified",sourceId:source.id,configurationSha256:await sourceConfigurationDigest(source),
    reviewedAt:SEEN_AT,expiresAt:"2026-10-01T00:00:00.000Z",engineeringOwnerId:"synthetic-engineer",editorialOwnerId:"synthetic-editor",
    reviewEvidenceId:source.id+"-review",rightsDecision:"accepted",accessDecision:"public-or-authorized-read",
    negativeFixtureSha256:await sha256("negative"),replayFixtureSha256:await sha256("replay"),
    samples:[{endpoint:source.endpoints[0],representationSha256:await sha256("sample1"),capturedAt:"2026-09-11T00:00:00.000Z",parserVersion:source.parserVersion,itemCount:1,outcome:"parsed"},
      {endpoint:source.endpoints[0],representationSha256:await sha256("sample2"),capturedAt:"2026-09-12T00:00:00.000Z",parserVersion:source.parserVersion,itemCount:1,outcome:"parsed"}]};
  await db.prepare("INSERT OR IGNORE INTO watch_collection_reviews VALUES(?,?,?,?,?,?,NULL)")
    .bind(qualification.reviewEvidenceId,"synthetic-engineer","synthetic-editor",await sha256("synthetic acceptance"),await sha256(canonicalJson(qualification)),SEEN_AT).run();
  await configureWatchCollectionSource(db,{source,qualification,activationId:"synthetic-activation",cadenceSeconds:60,expectedRevision:0},SEEN_AT);
  return {source,qualification};
}
function clock(at=SEEN_AT){return ()=>new Date(at);}
const success:typeof fetch=async()=>new Response(rssBody(),{headers:{"content-type":"application/rss+xml; charset=utf-8",etag:'"one"'}});
const federalSource:Partial<SourceEnrollment>={id:"synthetic-federal",desk:"policy",jurisdiction:"federal",family:"regulation",
  transport:"official-json",parserId:"watch-federal-register",parserVersion:"1",
  endpoints:["https://www.federalregister.gov/api/v1/documents.json?per_page=5"],
  linkScopes:[{host:"www.federalregister.gov",pathPrefix:"/"}]};
const federalRecord={document_number:"2026-12345",type:"Proposed Rule",title:"Synthetic healthcare proposal",
  publication_date:"2026-09-10",action:"Proposed rule",pdf_url:"https://www.govinfo.gov/content/pkg/FR-2026-09-10/pdf/2026-12345.pdf"};
async function due(db:D1DatabaseLike){await db.prepare("UPDATE watch_collection_state SET next_due_at=?").bind(SEEN_AT).run();}

test("Federal Register inventory persists raw evidence then stages unreviewed policy, including304 replay",async t=>{
  const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());await enroll(db,federalSource);
  const first=await runWatchCollection(db,{enabled:true,clock:clock(),fetchImpl:async(_url,init)=>{
    assert.equal(new Headers(init?.headers).get("accept"),"application/json");
    return new Response(JSON.stringify({results:[federalRecord]}),{headers:{etag:'"fr-one"'}});
  }});
  assert.equal(first.sources[0]?.state,"healthy",JSON.stringify(first));
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_raw_representations").get()!.n,1);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM policy_watch_captures").get()!.n,1);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_drafts").get()!.n,1);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_decisions").get()!.n,0);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM published_content").get()!.n,0);
  const proposal=JSON.parse(String(sqlite.prepare("SELECT payload_json FROM watch_editorial_drafts").get()!.payload_json));
  assert.equal(proposal.draft.interpretation.readiness,"review-pending");
  await due(db);
  const second=await runWatchCollection(db,{enabled:true,clock:clock("2026-09-12T12:02:00.000Z"),fetchImpl:async()=>new Response(null,{status:304})});
  assert.equal(second.sources[0]?.state,"healthy",JSON.stringify(second));
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_raw_observations").get()!.n,1);
  assert.equal(sqlite.prepare("SELECT first_seen_at FROM watch_raw_observations").get()!.first_seen_at,SEEN_AT);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM policy_watch_captures").get()!.n,1);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_drafts").get()!.n,1);
  await due(db);
  const changedEnvelope=await runWatchCollection(db,{enabled:true,clock:clock("2026-09-12T12:04:00.000Z"),
    fetchImpl:async()=>new Response(JSON.stringify({results:[federalRecord],count:99}))});
  assert.equal(changedEnvelope.sources[0]?.state,"healthy",JSON.stringify(changedEnvelope));
  const bindings=sqlite.prepare("SELECT o.observation_json,r.representation_sha256 FROM watch_raw_observations o JOIN watch_raw_representations r ON r.id=o.representation_id").all();
  assert.equal(bindings.length,2);
  for(const binding of bindings)assert.equal(JSON.parse(String(binding.observation_json)).representationSha256,binding.representation_sha256);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM policy_watch_captures").get()!.n,1);
});

test("native staging transactions fence revocation and lease replacement after raw persistence",async t=>{
  for(const mutation of ["UPDATE watch_collection_reviews SET revoked_at='2026-09-12T12:00:00.000Z'",
    "UPDATE watch_collection_leases SET owner='replacement'"]){
    const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());await enroll(db,federalSource);let batches=0;
    const racing:D1DatabaseLike={prepare:sql=>db.prepare(sql),async batch(statements){
      batches++;if(batches===2)sqlite.exec(mutation);
      return db.batch(statements);
    }};
    const run=runWatchCollection(racing,{enabled:true,clock:clock(),fetchImpl:async()=>new Response(JSON.stringify({results:[federalRecord]}))});
    if(mutation.includes("leases"))await assert.rejects(run,/lease-lost/);
    else assert.equal((await run).sources[0]?.checkpointAdvanced,false);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_raw_representations").get()!.n,1);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM policy_watch_captures").get()!.n,0);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_drafts").get()!.n,0);
  }
});

test("native policy failure, partial items and revoked permissions cannot stage reviewed facts",async t=>{
  for(const results of [[{...federalRecord,type:"unexpected"}],[federalRecord,{...federalRecord,document_number:"2026-12346"}]]){
    const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());await enroll(db,{...federalSource,maxItems:1});
    const result=await runWatchCollection(db,{enabled:true,clock:clock(),fetchImpl:async()=>new Response(JSON.stringify({results}))});
    assert.equal(result.sources[0]?.checkpointAdvanced,false);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_drafts").get()!.n,0);
  }
  const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());await enroll(db,federalSource);
  const result=await runWatchCollection(db,{enabled:true,clock:clock(),fetchImpl:async()=>{
    sqlite.exec("UPDATE watch_collection_reviews SET revoked_at='2026-09-12T12:00:00.000Z'");
    return new Response(JSON.stringify({results:[federalRecord]}));
  }});
  assert.equal(result.sources[0]?.checkpointAdvanced,false);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM policy_watch_captures").get()!.n,0);
});

test("Federal Register notices are filtered and unregistered continuation is never fetched",async t=>{
  const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());await enroll(db,federalSource);let calls=0;
  const result=await runWatchCollection(db,{enabled:true,clock:clock(),fetchImpl:async()=>{
    calls++;return new Response(JSON.stringify({results:[{type:"Notice"}],next_page_url:"https://outside.example/page2"}));
  }});
  assert.equal(calls,1);assert.equal(result.sources[0]?.state,"parser-failed");
  assert.equal(result.sources[0]?.checkpointAdvanced,false);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_drafts").get()!.n,0);
});

test("collector persists raw bytes before observations; replay and304 preserve first-seen and never publish",async t=>{
  const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());await enroll(db);
  const first=await runWatchCollection(db,{enabled:true,fetchImpl:success,clock:clock()});
  assert.equal(first.sources[0]?.state,"healthy",JSON.stringify(first));assert.equal(first.sources[0]?.checkpointAdvanced,true);
  const row=sqlite.prepare("SELECT * FROM watch_raw_observations").get()!;
  assert.equal(row.first_seen_at,SEEN_AT);
  await due(db);
  const later="2026-09-12T12:02:00.000Z";
  const second=await runWatchCollection(db,{enabled:true,clock:clock(later),fetchImpl:async(_url,init)=>{
    assert.equal(new Headers(init?.headers).get("if-none-match"),'"one"');return new Response(null,{status:304});
  }});
  assert.equal(second.sources[0]?.state,"healthy",JSON.stringify(second));
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_raw_observations").get()!.n,1);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_raw_representations").get()!.n,1);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_collection_pages").get()!.n,2);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM published_content").get()!.n,0);
  const evidence=await resolveWatchCollectionEvidence(db,[String(row.id)],later);
  assert.equal(evidence.observations.get(String(row.id))?.normalizedText,rssBody());
  assert.equal(evidence.sourcePermissionDigests.size,1);
  assert.equal(evidence.sourceUrlAllowed("synthetic-rss","https://source.example/not-enrolled"),false);
  assert.equal(evidence.publicUrlAllowed("https://source.example/items/a"),true);
  assert.equal(JSON.parse(String(sqlite.prepare("SELECT checkpoint_json FROM watch_collection_state").get()!.checkpoint_json)).fullSnapshot,false);
});

test("source activation requires persisted named approval and config-bound receipt",async t=>{
  const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());const fixture=await enroll(db);
  assert.ok(await resolveEnrolledCollectionSource(db,fixture.source.id,SEEN_AT));
  await assert.rejects(configureWatchCollectionSource(db,{...fixture,source:{...fixture.source,name:"changed"},activationId:"other",cadenceSeconds:60,expectedRevision:1},SEEN_AT),/qualification-required/);
  sqlite.exec("UPDATE watch_collection_reviews SET revoked_at='2026-09-12T12:00:00.000Z'");
  let calls=0;const result=await runWatchCollection(db,{enabled:true,clock:clock(),fetchImpl:async()=>{calls++;return new Response(rssBody());}});
  assert.equal(calls,0);assert.equal(result.sources[0]?.state,"disabled");
});

test("deactivation atomically nulls delivery permission and removes evidence eligibility",async t=>{
  const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());const fixture=await enroll(db);
  await runWatchCollection(db,{enabled:true,clock:clock(),fetchImpl:success});
  const id=String(sqlite.prepare("SELECT id FROM watch_raw_observations").get()!.id);
  await configureWatchCollectionSource(db,{...fixture,activationId:null,cadenceSeconds:60,expectedRevision:1},"2026-09-12T12:01:00.000Z");
  assert.equal(sqlite.prepare("SELECT digest FROM watch_dependency_heads").get()!.digest,null);
  assert.equal((await resolveWatchCollectionEvidence(db,[id],"2026-09-12T12:02:00.000Z")).observations.size,0);
  await assert.rejects(configureWatchCollectionSource(db,{...fixture,activationId:null,cadenceSeconds:60,expectedRevision:1},SEEN_AT),/revision-conflict/);
});

test("failure backoff, retry-after and due-time survive runner restarts",async t=>{
  const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());await enroll(db);
  let calls=0;const fetchImpl:typeof fetch=async()=>{calls++;return new Response("busy",{status:429,headers:{"retry-after":"3600"}});};
  const one=await runWatchCollection(db,{enabled:true,clock:clock(),fetchImpl});
  assert.equal(one.sources[0]?.state,"rate-limited");
  assert.equal(sqlite.prepare("SELECT failures FROM watch_collection_state").get()!.failures,1);
  assert.equal(sqlite.prepare("SELECT next_due_at FROM watch_collection_state").get()!.next_due_at,"2026-09-12T13:00:00.000Z");
  assert.equal((await runWatchCollection(db,{enabled:true,clock:clock(),fetchImpl})).sources.length,0);
  assert.equal(calls,1);assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_collection_leases").get()!.n,0);
});

test("unregistered redirect, oversize bytes, invalidUTF8 and bare304 are explicit failures",async t=>{
  for(const response of [()=>new Response(null,{status:302,headers:{location:"https://outside.example/feed"}}),
    ()=>new Response("x".repeat(33000)),()=>new Response(new Uint8Array([0xff,0xfe])),()=>new Response(null,{status:304})]){
    const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());await enroll(db);let calls=0;
    const result=await runWatchCollection(db,{enabled:true,clock:clock(),fetchImpl:async()=>{calls++;return response();}});
    assert.notEqual(result.sources[0]?.state,"healthy");assert.equal(result.sources[0]?.checkpointAdvanced,false);
    assert.equal(calls,1);assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_raw_observations").get()!.n,0);
  }
});

test("item cap retains partial observations without advancing checkpoint",async t=>{
  const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());await enroll(db,{maxItems:1});
  const result=await runWatchCollection(db,{enabled:true,clock:clock(),fetchImpl:async()=>new Response(rssBody(rssItem()+rssItem({id:"other"})))});
  assert.equal(result.sources[0]?.checkpointAdvanced,false);assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_raw_observations").get()!.n,1);
  assert.equal(sqlite.prepare("SELECT checkpoint_json FROM watch_collection_state").get()!.checkpoint_json,null);
});

test("failed batch rolls back raw representation and observations and never checkpoints",async t=>{
  const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());await enroll(db);
  sqlite.exec("CREATE TRIGGER synthetic_fail BEFORE INSERT ON watch_collection_pages BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  const result=await runWatchCollection(db,{enabled:true,clock:clock(),fetchImpl:success});
  assert.equal(result.sources[0]?.checkpointAdvanced,false);
  for(const table of ["watch_raw_observations","watch_raw_representations","watch_collection_pages"])assert.equal(sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()!.n,0);
});

test("global lease excludes concurrent runner and enabled=false does no database work",async t=>{
  const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());await enroll(db);
  sqlite.exec("INSERT INTO watch_collection_leases VALUES('watch-collector','other','2026-09-12T13:00:00.000Z')");
  assert.equal((await runWatchCollection(db,{enabled:true,clock:clock(),fetchImpl:success})).outcome,"locked");
  assert.equal((await runWatchCollection({prepare(){throw Error("must not read");},batch(){throw Error("must not write");}},{enabled:false})).outcome,"disabled");
});

test("GitHub repository bytes are persisted before bound release fetch; alias reuse is held",async t=>{
  const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());
  const input=githubInput("repository",repository),base=input.finalUrl;
  await enroll(db,{...input.source as SourceEnrollment,endpoints:[base,base+"/releases"]});
  let tick=Date.parse(SEEN_AT);const advancing=()=>new Date(tick+=1100);
  const result=await runWatchCollection(db,{enabled:true,clock:advancing,fetchImpl:async url=>{
    if(String(url).endsWith("/releases")){
      assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_raw_observations").get()!.n,1);
      return new Response(JSON.stringify([release]));
    }return new Response(JSON.stringify(repository));
  }});
  assert.equal(result.sources[0]?.state,"healthy",JSON.stringify(result));assert.equal(result.sources[0]?.itemCount,2);
  await due(db);tick+=120000;
  const changed=await runWatchCollection(db,{enabled:true,clock:advancing,fetchImpl:async()=>new Response(JSON.stringify({...repository,id:9999}))});
  assert.equal(changed.sources[0]?.state,"parser-failed");assert.equal(changed.sources[0]?.checkpointAdvanced,false);
});

test("qualification expiry or missing expiry-head binding fails closed",async t=>{
  const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());await enroll(db);
  assert.equal(await resolveEnrolledCollectionSource(db,"synthetic-rss","2026-10-02T00:00:00.000Z"),null);
  sqlite.exec("DELETE FROM watch_dependency_expirations");
  assert.equal(await resolveEnrolledCollectionSource(db,"synthetic-rss",SEEN_AT),null);
});

test("qualification approval cannot be reused for a changed receipt and review revocation retracts heads",async t=>{
  const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());const fixture=await enroll(db);
  await assert.rejects(configureWatchCollectionSource(db,{...fixture,qualification:{...fixture.qualification,expiresAt:"2026-11-01T00:00:00.000Z"},
    activationId:"another",cadenceSeconds:60,expectedRevision:1},SEEN_AT),/qualification-required/);
  const revoked=await revokeWatchCollectionReview(db,fixture.qualification.reviewEvidenceId,"2026-09-12T12:01:00.000Z");
  assert.equal(revoked.outcome,"revoked");
  assert.equal(sqlite.prepare("SELECT digest FROM watch_dependency_heads").get()!.digest,null);
  assert.equal(sqlite.prepare("SELECT activation_id FROM watch_collection_sources").get()!.activation_id,null);
  assert.equal((await revokeWatchCollectionReview(db,fixture.qualification.reviewEvidenceId,"2026-09-12T12:02:00.000Z")).outcome,"unchanged");
});

test("failed second Atom page retains first page but cannot checkpoint; replay deduplicates it",async t=>{
  const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());
  await enroll(db,{transport:"atom",endpoints:["https://source.example/feed.xml","https://source.example/page2.xml"]});
  let tick=Date.parse(SEEN_AT);const advancing=()=>new Date(tick+=1100);
  const first=atomBody(undefined,'<link rel="next" href="https://source.example/page2.xml"/>');
  let requests=0;
  const fetchImpl:typeof fetch=async url=>{requests++;return String(url).endsWith("page2.xml")?new Response("unavailable",{status:503}):new Response(first);};
  const initial=await runWatchCollection(db,{enabled:true,clock:advancing,fetchImpl});
  assert.equal(initial.sources[0]?.checkpointAdvanced,false);assert.equal(initial.sources[0]?.state,"upstream-failed");
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_raw_observations").get()!.n,1);
  assert.equal(sqlite.prepare("SELECT checkpoint_json FROM watch_collection_state").get()!.checkpoint_json,null);
  await due(db);tick+=120000;
  await runWatchCollection(db,{enabled:true,clock:advancing,fetchImpl});
  assert.equal(requests,4);assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_raw_observations").get()!.n,1);
});

test("empty terminal Atom page is durably acknowledged without claiming complete inventory",async t=>{
  const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());
  await enroll(db,{transport:"atom",endpoints:["https://source.example/feed.xml","https://source.example/page2.xml"]});
  let tick=Date.parse(SEEN_AT);const advancing=()=>new Date(tick+=1100);
  const result=await runWatchCollection(db,{enabled:true,clock:advancing,fetchImpl:async url=>new Response(
    String(url).endsWith("page2.xml")?atomBody(""):atomBody(undefined,'<link rel="next" href="https://source.example/page2.xml"/>'))});
  assert.equal(result.sources[0]?.checkpointAdvanced,true,JSON.stringify(result));
  const checkpoint=JSON.parse(String(sqlite.prepare("SELECT checkpoint_json FROM watch_collection_state").get()!.checkpoint_json));
  assert.equal(checkpoint.completedPageKeys.length,2);assert.equal(checkpoint.fullSnapshot,false);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_collection_pages").get()!.n,2);
});

test("due ordering lets untouched sources run after a bounded failing dispatch",async t=>{
  const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());
  for(const id of ["a","b","c"])await enroll(db,{id,endpoints:[`https://${id}.example/feed.xml`],linkScopes:[{host:`${id}.example`,pathPrefix:"/"}]});
  const options={enabled:true,clock:clock(),maxSources:1,fetchImpl:async()=>new Response("unavailable",{status:503})};
  const outputs=[];for(let i=0;i<3;i++)outputs.push((await runWatchCollection(db,options)).sources[0]?.sourceId);
  assert.deepEqual(outputs,["a","b","c"]);
});

test("failed permission-head write rolls back deactivation",async t=>{
  const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());const fixture=await enroll(db);
  sqlite.exec("CREATE TRIGGER synthetic_head_failure BEFORE UPDATE ON watch_dependency_heads BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  await assert.rejects(configureWatchCollectionSource(db,{...fixture,activationId:null,cadenceSeconds:60,expectedRevision:1},SEEN_AT));
  assert.equal(sqlite.prepare("SELECT revision FROM watch_collection_sources").get()!.revision,1);
  assert.notEqual(sqlite.prepare("SELECT digest FROM watch_dependency_heads").get()!.digest,null);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_dependency_records").get()!.n,1);
});

test("lease replacement during fetch fences the entire raw write batch",async t=>{
  const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());await enroll(db);
  await assert.rejects(runWatchCollection(db,{enabled:true,clock:clock(),fetchImpl:async()=>{
    sqlite.exec("UPDATE watch_collection_leases SET owner='replacement'");
    return new Response(rssBody());
  }}),/lease-lost/);
  for(const table of ["watch_raw_observations","watch_raw_representations","watch_collection_pages"])
    assert.equal(sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()!.n,0);
  assert.equal(sqlite.prepare("SELECT owner FROM watch_collection_leases").get()!.owner,"replacement");
});

test("unsupported installed parser or transport is held before any network request",async t=>{
  for(const overrides of [{parserVersion:"next"},{transport:"html" as const}]){
    const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());await enroll(db,overrides);
    let calls=0;const result=await runWatchCollection(db,{enabled:true,clock:clock(),fetchImpl:async()=>{calls++;return new Response(rssBody());}});
    assert.equal(result.sources[0]?.state,"misconfigured");assert.equal(calls,0);
  }
});

test("storage-backed acceptance guards roll back first acceptance after source revocation",async t=>{
  const {db,sqlite}=pdfDatabase();t.after(()=>sqlite.close());const fixture=await enroll(db);
  await runWatchCollection(db,{enabled:true,clock:clock(),fetchImpl:success});
  const id=String(sqlite.prepare("SELECT id FROM watch_raw_observations").get()!.id);
  const snapshot=await resolveWatchCollectionEvidence(db,[id],"2026-09-12T12:01:00.000Z");
  await db.batch(snapshot.acceptanceGuards("first-acceptance"));
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_collection_acceptance_guards").get()!.n,1);
  await revokeWatchCollectionReview(db,fixture.qualification.reviewEvidenceId,"2026-09-12T12:00:30.000Z");
  sqlite.exec("CREATE TABLE synthetic_acceptance_probe(id TEXT PRIMARY KEY)");
  await assert.rejects(db.batch([db.prepare("INSERT INTO synthetic_acceptance_probe VALUES('must-rollback')"),
    ...snapshot.acceptanceGuards("racing-acceptance")]),/CHECK/);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM synthetic_acceptance_probe").get()!.n,0);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_collection_acceptance_guards").get()!.n,1);
});
