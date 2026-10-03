import test from "node:test";
import assert from "node:assert/strict";
import { qualifyPublicationScope, publicationSearchUrl, projectPubMedMetadata, createPublicationDiscoveryTransport } from "../src/ingest/regional-publications";
const observedAt = "2026-10-02T04:00:00Z", body = "The Wistar Institute is in Philadelphia, PA.";
const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)))).map(v=>v.toString(16).padStart(2,"0")).join("");
const citation = { id: "ev-wistar-location", url: "https://www.wistar.org/news/", observedAt, sourcePublishedAt: null, representationSha256: hash, quote: body, representation: "normalized-text" };
const inventory = { schemaVersion: 1, preparedAt: observedAt, collectionAuthorized: false, publicationAuthorized: false,
  institutions: [{ id: "inst-regional-wistar", name: "The Wistar Institute", kind: "research-institute", existingInstitutionId: null,
    officialHosts: ["www.wistar.org"], regionalScope: "core", evidenceIds: [citation.id], owner: "fixture" }], sources: [], evidence: [citation] };
const retained = new Map([[citation.id, { url: citation.url, observedAt, body }]]);
const scope = await qualifyPublicationScope(inventory, retained);
const plan = { institutionId: "inst-regional-wistar" as const, startDay: "2026-09-01", endDay: "2026-10-02", limit: 2 };
const article = (id = "12345", affiliation = "The Wistar Institute, Philadelphia, PA, USA. jane@fixture.edu", title = "Synthetic metadata fixture") => `<PubmedArticle><MedlineCitation><PMID Version="1">${id}</PMID><Article><ArticleTitle>${title}</ArticleTitle><Journal><Title>Fixture journal</Title><JournalIssue><PubDate><Year>2026</Year><Month>09</Month><Day>12</Day></PubDate></JournalIssue></Journal><ArticleDate DateType="Electronic"><Year>2026</Year><Month>09</Month><Day>10</Day></ArticleDate><AuthorList><Author><LastName>Smith</LastName><ForeName>Jane</ForeName><AffiliationInfo><Affiliation>${affiliation}</Affiliation></AffiliationInfo></Author></AuthorList><Abstract><AbstractText>DO NOT RETAIN THIS ABSTRACT</AbstractText></Abstract></Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="doi">10.1234/fixture</ArticleId></ArticleIdList></PubmedData></PubmedArticle>`;
const xml = (text = article()) => `<PubmedArticleSet>${text}</PubmedArticleSet>`;

test("scope requires hash-bound first-party region evidence and cannot be JSON-forged", async()=>{
  await assert.rejects(qualifyPublicationScope(inventory, new Map([[citation.id, { url: citation.url, observedAt, body: body + "changed" }]])));
  assert.throws(()=>publicationSearchUrl(JSON.parse(JSON.stringify(scope)), plan));
  const url = new URL(publicationSearchUrl(scope, plan).url);
  assert.equal(url.hostname, "eutils.ncbi.nlm.nih.gov");
  assert.equal(url.searchParams.get("usehistory"), null);
  assert.equal(url.searchParams.get("api_key"), null);
  assert.match(url.searchParams.get("term")!, /\[Affiliation\]/);
});
test("windows, IDs, pages, institution names and limits stay bounded", ()=>{
  for(const invalid of [{...plan,institutionId:"other"},{...plan,limit:6},{...plan,startDay:"2026-02-30"},
    {...plan,startDay:"2025-01-01"},{...plan,offset:101},{...plan,url:"https://private.invalid"}])
    assert.throws(()=>publicationSearchUrl(scope, invalid as typeof plan));
});
test("publication-bound author affiliation is explicit, dated, redacted and remains in review", async()=>{
  const result = await projectPubMedMetadata(xml(), ["12345"], scope, observedAt);
  const record = result.records[0];
  assert.equal(record.electronicPublishedDay,"2026-09-10");
  assert.equal(record.journalPublishedDay,"2026-09-12");
  assert.equal(record.metadataObservedAt,observedAt);
  assert.equal(record.authors[0].personId,null);
  assert.equal(record.regionalMatches.length,1);
  assert.equal(record.regionalMatches[0].currentEmploymentConfirmed,false);
  assert.equal(record.authors[0].affiliations[0].contactEmailOmitted,true);
  assert.equal(record.publicationAuthorized,false);
  assert.equal(record.status,"review");
  assert.equal(result.snapshotCompleteness,"partial");
  for(const text of ["DO NOT RETAIN THIS ABSTRACT","jane@fixture.edu","AbstractText"]) assert.equal(JSON.stringify(result).includes(text),false);
});
test("similar institution names and geographic-only or institution-only strings do not match", async()=>{
  for(const affiliation of ["Wistar Institutes, Philadelphia, PA", "Wistar Institute, Boston, MA", "Other institution, Philadelphia, PA", "Wistar Institute, Philadelphia, Mississippi"]){
    const record=(await projectPubMedMetadata(xml(article("12345",affiliation)),["12345"],scope,observedAt)).records[0];
    assert.equal(record.regionalMatches.length,0);
    assert.ok(record.holds.includes("explicit-regional-author-affiliation-missing"));
  }
});
test("different authors' institution and geography cannot be joined", async()=>{
  const text=article("12345","Wistar Institute, Boston, MA").replace("</AuthorList>","<Author><ForeName>Alex</ForeName><LastName>Other</LastName><AffiliationInfo><Affiliation>Other institution, Philadelphia, PA</Affiliation></AffiliationInfo></Author></AuthorList>");
  assert.equal((await projectPubMedMetadata(xml(text),["12345"],scope,observedAt)).records[0].regionalMatches.length,0);
});
test("unrequested/duplicate PMID, unsafe XML, external entities and excessive bytes fail closed", async()=>{
  for(const text of [xml(article("54321")),xml(article()+article()),'<!DOCTYPE PubmedArticleSet [<!ENTITY ex SYSTEM "file:///private">]>'+xml(),
    '<!DOCTYPE PubmedArticleSet PUBLIC "other" "https://private.invalid/dtd">'+xml(),'<PubmedArticleSet>','x'.repeat(524289)])
    await assert.rejects(projectPubMedMetadata(text,["12345"],scope,observedAt));
});
test("only the NLM external DTD is accepted and never resolved", async()=>{
  const declaration='<!DOCTYPE PubmedArticleSet PUBLIC "-//NLM//DTD PubMedArticle, 1st January 2026//EN" "https://dtd.nlm.nih.gov/ncbi/pubmed/out/pubmed_260101.dtd">';
  assert.equal((await projectPubMedMetadata(declaration+xml(),["12345"],scope,observedAt)).records.length,1);
});
test("empty and partial metadata never assert complete author coverage", async()=>{
  const empty=await projectPubMedMetadata(xml(""),[],scope,observedAt);assert.equal(empty.records.length,0);
  const partial=await projectPubMedMetadata(xml(),["12345","54321"],scope,observedAt);assert.deepEqual(partial.requestedPmidsMissing,["54321"]);
  assert.equal(partial.records[0].completeAuthorCoverageClaimed,false);
});
test("transport uses two sequential rate-limited metadata requests and exposes pagination without auto-following", async()=>{
  const calls: { url:string; time:number; init:RequestInit }[]=[];let now=Date.parse(observedAt);const waits:number[]=[];
  const run=createPublicationDiscoveryTransport({ clock:()=>now,wait:async ms=>{waits.push(ms);now+=ms;},fetch:async(url,init)=>{
    calls.push({url:String(url),time:now,init:init!});
    return calls.length===1?new Response(JSON.stringify({esearchresult:{count:"4",retstart:"0",retmax:"2",idlist:["12345"]}}),{headers:{"Content-Type":"application/json"}}):new Response(xml(),{headers:{"Content-Type":"text/xml"}});
  }});
  const result=await run(scope,plan);
  assert.equal(calls.length,2);assert.ok(calls[1].time-calls[0].time>=1000);assert.deepEqual(waits,[1000]);
  assert.equal("nextPageOffset" in result && result.nextPageOffset,1);
  assert.equal(calls[0].init.redirect,"error");assert.equal(calls[0].init.credentials,"omit");
  assert.equal(result.productionCollectorActivated,false);
});
test("403/429 have no retry or alternative request and do not leak response bodies", async()=>{
  for(const status of [403,429]){let calls=0;const run=createPublicationDiscoveryTransport({fetch:async()=>{calls++;return new Response("PRIVATE_UPSTREAM_BODY",{status,headers:{"Retry-After":"120"}});}});
    const result=await run(scope,plan);assert.equal(calls,1);assert.equal(result.records.length,0);
    assert.equal(JSON.stringify(result).includes("PRIVATE_UPSTREAM_BODY"),false);assert.equal(result.receipts[0].retryAfterSeconds,120);
  }
});
