import test from "node:test";
import assert from "node:assert/strict";
import { redactRegionalContactEmails } from "../src/ingest/regional-privacy";
import { qualifyPublicationScope, projectPubMedMetadata, createPublicationDiscoveryTransport } from "../src/ingest/regional-publications";
import { prepareRegionalDiscoveryView, queryRegionalDiscoveryView, queryRegionalDiscoveryRecord } from "../src/ingest/regional-discovery-view";
const observedAt="2026-10-02T04:00:00Z",body="The Wistar Institute is in Philadelphia, PA.";
const sha=async(value:string|Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",typeof value==='string'?new TextEncoder().encode(value):Uint8Array.from(value)))).map(v=>v.toString(16).padStart(2,"0")).join("");
const citation={id:"ev-wistar-location",url:"https://www.wistar.org/news/",observedAt,sourcePublishedAt:null,representationSha256:await sha(body),quote:body,representation:"normalized-text"};
const inventory={schemaVersion:1,preparedAt:observedAt,collectionAuthorized:false,publicationAuthorized:false,institutions:[{id:"inst-regional-wistar",name:"The Wistar Institute",kind:"research-institute",existingInstitutionId:null,officialHosts:["www.wistar.org"],regionalScope:"core",evidenceIds:[citation.id],owner:"fixture"}],sources:[],evidence:[citation]};
const scope=await qualifyPublicationScope(inventory,new Map([[citation.id,{url:citation.url,observedAt,body}]]));
const xml=(contact:string)=>`<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>12345</PMID><Article><ArticleTitle>Fixture</ArticleTitle><AuthorList><Author><ForeName>Jane</ForeName><LastName>Smith</LastName><AffiliationInfo><Affiliation>Wistar Institute, Philadelphia, PA. ${contact.replaceAll('&','&amp;').replaceAll('<','&lt;')}</Affiliation></AffiliationInfo></Author></AuthorList></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>`;
test("quoted, escaped, international and domain-literal contact addresses are masked in projection and tool output",async()=>{
 for(const contact of ['"jane.smith"@fixture.edu','"Jane Smith"@fixture.edu','"jane\\\"smith"@fixture.edu',"o'connor+research@fixture.edu",'jane@[127.0.0.1]','jane@[IPv6:2001:db8::1]','jané@éxample.edu','research@localhost']){
  assert.equal(redactRegionalContactEmails(contact),'[email omitted]',contact);
  const snapshot=await projectPubMedMetadata(xml(contact),['12345'],scope,observedAt);
  assert.equal(snapshot.records[0].authors[0].affiliations[0].contactEmailOmitted,true,contact);
  assert.equal(JSON.stringify(snapshot).includes(contact),false,contact);
  const view=await prepareRegionalDiscoveryView({inventory,captures:{wistar:{url:citation.url,observedAt,body,text:body}},publicationSnapshot:snapshot,asOf:observedAt});
  const row=queryRegionalDiscoveryView(view,{},observedAt).results[0];
  const detail=queryRegionalDiscoveryRecord(view,{snapshotId:view.snapshotId,recordId:row.recordId},observedAt);
  assert.equal(detail.details.authors[0].affiliations[0].contactEmailOmitted,true);assert.equal(JSON.stringify(detail).includes(contact),false);
 }
 assert.equal(redactRegionalContactEmails('Wistar Institute, Philadelphia, PA.'),'Wistar Institute, Philadelphia, PA.');
});
test("PubMed transport hashes received BOM bytes, preserves XML BOM through decode, and binds projection separately",async()=>{
 for(const bom of [false,true]){
  const wire=new TextEncoder().encode((bom?'\uFEFF':'')+xml('"jane.smith"@fixture.edu'));let calls=0,clock=Date.parse(observedAt);
  const transport=createPublicationDiscoveryTransport({clock:()=>clock,wait:async delay=>{clock+=delay;},fetch:async()=>{
   calls++;return calls===1?Response.json({esearchresult:{count:'1',retstart:'0',retmax:'1',idlist:['12345']}}):new Response(wire,{headers:{'Content-Type':'application/xml'}});
  }});
  const result=await transport(scope,{institutionId:'inst-regional-wistar',startDay:'2026-09-01',endDay:'2026-10-02',limit:1});
  assert.ok('wireResponseSha256' in result);if(!('wireResponseSha256' in result))throw new Error('transport projection failed');
  assert.equal(result.wireResponseSha256,await sha(wire));assert.equal(result.receipts[1].sha256,await sha(wire));assert.equal(result.receipts[1].byteCount,wire.length);
  assert.equal(result.metadataProjectionSha256,await sha(result.retainedMetadataRepresentation));assert.equal(result.records[0].authors[0].affiliations[0].contactEmailOmitted,true);assert.equal(calls,2);
 }
});
test("unrecognized/comment-separated contact syntax withholds the whole field and cannot assert a retained affiliation match",async()=>{
 for(const contact of ['jane(comment)@fixture.edu','jane(comment) @ fixture.edu','"jane.smith"(work)@fixture.edu','jane@(work)fixture.edu','jane@ (work) fixture.edu']){
  assert.equal(redactRegionalContactEmails(contact),'[contact-bearing text omitted]',contact);
  const snapshot=await projectPubMedMetadata(xml(contact),['12345'],scope,observedAt),affiliation=snapshot.records[0].authors[0].affiliations[0];
  assert.equal(affiliation.reportedText,'[contact-bearing text omitted]');assert.equal(affiliation.contactEmailOmitted,true);
  assert.equal(affiliation.institutionLiteralPresent,false);assert.equal(affiliation.geographicLiteralPresent,false);assert.equal(snapshot.records[0].regionalMatches.length,0);
  const view=await prepareRegionalDiscoveryView({inventory,captures:{wistar:{url:citation.url,observedAt,body,text:body}},publicationSnapshot:snapshot,asOf:observedAt});
  const row=queryRegionalDiscoveryView(view,{},observedAt).results[0];assert.equal(row.explicitRegionalAuthorAffiliationMatches,0);assert.ok(row.holds.includes('explicit-regional-author-affiliation-missing'));
  const detail=queryRegionalDiscoveryRecord(view,{snapshotId:view.snapshotId,recordId:row.recordId},observedAt);assert.equal(JSON.stringify(detail).includes('@'),false);assert.equal(detail.details.authors[0].affiliations[0].contactEmailOmitted,true);
 }
});
test("legacy hash-bound projections cannot retain positive summary matches after their affiliation display field is withheld",async()=>{
 const snapshot=await projectPubMedMetadata(xml(''),['12345'],scope,observedAt);
 const affiliation=snapshot.records[0].authors[0].affiliations[0];
 affiliation.reportedText='Wistar Institute, Philadelphia, PA. jane(comment)@fixture.edu';affiliation.contactEmailOmitted=false;
 snapshot.retainedMetadataRepresentation=JSON.stringify({schemaVersion:1,source:'pubmed-indexed-metadata',records:snapshot.records});snapshot.metadataProjectionSha256=await sha(snapshot.retainedMetadataRepresentation);
 const view=await prepareRegionalDiscoveryView({inventory,captures:{wistar:{url:citation.url,observedAt,body,text:body}},publicationSnapshot:snapshot,asOf:observedAt});
 const row=queryRegionalDiscoveryView(view,{},observedAt).results[0];assert.equal(row.explicitRegionalAuthorAffiliationMatches,0);assert.ok(row.holds.includes('explicit-regional-author-affiliation-missing'));
 const detail=queryRegionalDiscoveryRecord(view,{snapshotId:view.snapshotId,recordId:row.recordId},observedAt);
 assert.equal(detail.details.authors[0].affiliations[0].reportedText,'[contact-bearing text omitted]');assert.equal(detail.details.authors[0].affiliations[0].institutionLiteralPresent,false);assert.equal(detail.details.authors[0].affiliations[0].geographicLiteralPresent,false);
 assert.equal(JSON.stringify(detail).includes('@'),false);
});
