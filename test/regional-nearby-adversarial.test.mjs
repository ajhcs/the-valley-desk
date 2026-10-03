import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { RegionalInventory, PublicAffiliation, permittedPublicUrl, verifyPublicAffiliation, resolveInstitutionalAuthor, verifyInstitutionalRepository } from "../src/ingest/regional-contracts.ts";
import { discoverDeclaredFeeds, parseRegionalFeed } from "../src/ingest/regional-discovery.ts";
import { prepareRegionalSourceReadView, queryRegionalSourceReadView } from "../src/ingest/regional-read-view.ts";
import { prepareRegionalEditorialContext } from "../src/ingest/regional-context.ts";
const at = "2026-10-02T04:00:00Z";
const fixture = JSON.parse(await readFile(new URL("../fixtures/regional-source-inventory-v1.json", import.meta.url),"utf8"));
const institution = {id:"inst-fixture",name:"Synthetic Institute",kind:"research-institute",existingInstitutionId:null,officialHosts:["fixture.edu"],regionalScope:"core",evidenceIds:["ev-fixture"],owner:"synthetic reviewer"};
const sha = async text => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,"0")).join("");
async function citation(body, url="https://fixture.edu/person/alex", representation="normalized-text") {
 const evidence={id:"ev-fixture",url,observedAt:at,sourcePublishedAt:null,representationSha256:await sha(body),quote:body,representation};
 return {evidence,retained:{url,observedAt:at,body}};
}
const aff = (overrides={}) => PublicAffiliation.parse({id:"aff-alex",personId:"person-alex",fullName:"Alex Lee",institutionId:institution.id,profileUrl:"https://fixture.edu/person/alex",role:"Research Director",evidenceId:"ev-fixture",validFrom:null,validUntil:null,observedAt:at,expiresAt:"2026-10-09T04:00:00Z",...overrides});
async function verified(overrides={},body="Alex Lee Research Director",url="https://fixture.edu/person/alex") {
 const c=await citation(body,url);
 const profile=await citation(JSON.stringify({"@context":"https://schema.org","@type":"ProfilePage",url:"https://fixture.edu/person/alex",mainEntity:{"@type":"Person",name:"Alex Lee",url:"https://fixture.edu/person/alex"}}),"https://fixture.edu/person/alex","json");
 profile.evidence.id="ev-profile";
 const qualification={profile};
 // Only this ended-term positive control has an independently retained field-specific date declaration.
 if(overrides.validUntil==="2026-10-01" && !overrides.validFrom) {
  qualification.term=await citation(JSON.stringify({personName:"Alex Lee",role:"Research Director",profileUrl:"https://fixture.edu/person/alex",institutionName:institution.name,validFrom:null,validUntil:"2026-10-01"}),url,"json");
  qualification.term.evidence.id="ev-term";
 }
 return verifyPublicAffiliation(aff(overrides),institution,c.evidence,c.retained,qualification);
}
const rss = items => '<rss version="2.0"><channel><title>Synthetic</title>'+items+'</channel></rss>';
const item = (url="https://fixture.edu/paper/1",date="2026-10-01T12:00:00Z") => '<item><title>Synthetic research</title><link>'+url+'</link><pubDate>'+date+'</pubDate></item>';
const feedSource = {url:"https://fixture.edu/recent.rss",allowedHosts:["fixture.edu"]};
const existing={id:"inst-fixture",name:"Synthetic Institute",covered:true,edge:false};
const news={id:"src-fixture-news",institutionId:existing.id,category:"news",status:"enabled",url:"https://fixture.edu/news"};
const viewInput=(overrides={})=>({inventory:structuredClone(fixture),existingInstitutions:[existing],existingOfficialSources:[news],asOf:at,...overrides});
const receipt=(overrides={})=>({sourceId:news.id,state:"healthy",itemCount:0,complete:false,consecutiveFailures:0,lastCheckedAt:"2026-10-02T03:55:00Z",lastSuccessAt:"2026-10-02T03:55:00Z",lastError:null,nextAttemptAt:at,lastHttpStatus:200,requiresAuth:false,...overrides});
const author=(row)=>({name:row.fullName,institutionalProfileUrl:row.profileUrl});
async function repositoryInput(quote='<a href="https://github.com/Example/Project">Repository</a>') {
 const c=await citation(quote,"https://fixture.edu/project","html");
 return {institution,...c,repository:{id:"123",fullName:"Example/Project",private:false,htmlUrl:"https://github.com/Example/Project"},repositoryCapture:{url:"https://api.github.com/repos/Example/Project",observedAt:at,body:JSON.stringify({id:123,full_name:"Example/Project",owner:{login:"Example"},name:"Project",private:false,html_url:"https://github.com/Example/Project",visibility:"public"})}};
}

test("nearby affiliation rejects path convention alone even with one-person roster",async()=>{const c=await citation("Alex Lee Research Director");assert.equal(await verifyPublicAffiliation(aff(),institution,c.evidence,c.retained),null);});
test("nearby affiliation exact token is immutable; unchanged, altered, and symbol clones cannot resolve",async()=>{const a=await verified();assert.ok(Object.isFrozen(a));assert.throws(()=>{a.personId="person-invented"});for(const b of [{...a},Object.assign({},a),{...a,profileUrl:"https://fixture.edu/person/morgan"},JSON.parse(JSON.stringify(a))])assert.equal(resolveInstitutionalAuthor(author(b),[b],at).state,"unresolved");assert.equal(Object.getOwnPropertySymbols(a).length,0);assert.equal(resolveInstitutionalAuthor(author(a),[a],at).state,"matched");});
test("nearby affiliation preserves independent profile proof attribution",async()=>{const a=await verified();assert.deepEqual(resolveInstitutionalAuthor(author(a),[a],at).evidenceIds,["ev-fixture","ev-profile"]);});
test("nearby profile must bind one person, canonical URL, first-party host and exact retained bytes",async()=>{
 const row=aff(),c=await citation("Alex Lee Research Director");
 const good={"@context":"https://schema.org","@type":"ProfilePage",url:row.profileUrl,mainEntity:{"@type":"Person",name:row.fullName,url:row.profileUrl}};
 for(const declaration of [{...good,url:"https://fixture.edu/leadership"},{...good,mainEntity:{...good.mainEntity,name:"Mary Alex Lee"}},{...good,mainEntity:[good.mainEntity]},{...good,"@type":"CollectionPage"}]){
  const profile=await citation(JSON.stringify(declaration),row.profileUrl,"json");assert.equal(await verifyPublicAffiliation(row,institution,c.evidence,c.retained,{profile}),null);
 }
 const profile=await citation(JSON.stringify(good),row.profileUrl,"json");
 assert.equal(await verifyPublicAffiliation(row,institution,c.evidence,c.retained,{profile:{...profile,retained:{...profile.retained,body:profile.retained.body+" "}}}),null);
 const external=await citation(JSON.stringify(good),"https://unrelated.org/alex","json");assert.equal(await verifyPublicAffiliation(row,institution,c.evidence,c.retained,{profile:external}),null);
});
test("nearby appointment fields require their own exact source declaration; observation never supplies them",async()=>{
 const row=aff({validFrom:"2026-09-01",validUntil:"2026-10-03"}),c=await citation("Alex Lee Research Director");
 const profile=await citation(JSON.stringify({"@context":"https://schema.org","@type":"ProfilePage",url:row.profileUrl,mainEntity:{"@type":"Person",name:row.fullName,url:row.profileUrl}}),row.profileUrl,"json");profile.evidence.id="ev-profile";
 const declaration={personName:row.fullName,role:row.role,profileUrl:row.profileUrl,institutionName:institution.name,validFrom:row.validFrom,validUntil:row.validUntil};
 assert.equal(await verifyPublicAffiliation(row,institution,c.evidence,c.retained,{profile}),null);
 for(const fields of [{...declaration,validUntil:"2030-01-01"},{...declaration,role:"Visitor"},{...declaration,institutionName:"Other Institute"}]){const term=await citation(JSON.stringify(fields),row.profileUrl,"json");assert.equal(await verifyPublicAffiliation(row,institution,c.evidence,c.retained,{profile,term}),null);}
 const term=await citation(JSON.stringify(declaration),row.profileUrl,"json");term.evidence.id="ev-term";
 const token=await verifyPublicAffiliation(row,institution,c.evidence,c.retained,{profile,term});assert.ok(token);assert.deepEqual(resolveInstitutionalAuthor(author(token),[token],at).evidenceIds,["ev-fixture","ev-profile","ev-term"]);
});
test("nearby inventory rejects same-host unsupported path and comment-only feed link",()=>{const f=structuredClone(fixture);const s=f.sources[0];s.url=new URL("/invented-source",s.url).href;assert.equal(RegionalInventory.safeParse(f).success,false);});
test("nearby inventory cannot grant another host by expanding only source allowlist",()=>{const f=structuredClone(fixture);f.sources[0].allowedHosts.push("unrelated.org");assert.equal(RegionalInventory.safeParse(f).success,false);});
for(const wrapper of [s=>"<!-- "+s+" -->",s=>"<script>"+s+"</script>",s=>"<style>"+s+"</style>",s=>"<textarea>"+s+"</textarea>",s=>"<template>"+s+"</template>",s=>"<div hidden>"+s+"</div>",s=>"<div inert>"+s+"</div>",s=>'<div aria-hidden="true">'+s+'</div>',s=>'<div style="display:none">'+s+'</div>',s=>'<div data-text=\''+s+'\'></div>'])
 test("nearby GitHub rejects inert or attribute anchor "+wrapper('<a>'),async()=>{assert.equal(await verifyInstitutionalRepository(await repositoryInput(wrapper('<a href="https://github.com/Example/Project">Repository</a>'))),null);});
test("nearby GitHub rejects duplicate href and detached citation span",async()=>{
 assert.equal(await verifyInstitutionalRepository(await repositoryInput('<a href="https://evil.org" href="https://github.com/Example/Project">Repository</a>')),null);
 const quoted='<!-- <a href="https://github.com/Example/Project">Repository</a> -->',actual='<a href="https://github.com/Example/Project">Repository</a>';
 const input=await repositoryInput(quoted+actual);input.evidence.quote=quoted;assert.equal(await verifyInstitutionalRepository(input),null);
});
test("nearby GitHub supports actual case-insensitive encoded href",async()=>{const input=await repositoryInput('<a href="https://github.com/Example&#x2f;Project">Repository</a>');assert.equal((await verifyInstitutionalRepository(input)).repositoryId,"123");});
for(const body of ['<!-- <head><link rel="alternate" type="application/rss+xml" href="/fake"/></head> -->','<head><style><link rel="alternate" type="application/rss+xml" href="/fake"/></style></head>','<head><title><link rel="alternate" type="application/rss+xml" href="/fake"/></title></head>','<head><div data-value=\'<link rel="alternate" type="application/rss+xml" href="/fake"/>\'></div></head>','<body><link rel="alternate" type="application/rss+xml" href="/fake"/></body>','<head><template><link rel="alternate" type="application/rss+xml" href="/fake"/></template></head>'])
 test("nearby discovery requires actual non-inert head declaration "+body.slice(0,35),()=>assert.deepEqual(discoverDeclaredFeeds(body,"https://fixture.edu/about",["fixture.edu"]),[]));
test("nearby discovery honors permitted document base and rejects off-host base",()=>{const link='<link rel="alternate" type="application/rss+xml" href="recent.rss"/>';assert.equal(discoverDeclaredFeeds('<head><base href="/research/"/>'+link+'</head>',"https://fixture.edu/about",["fixture.edu"])[0].url,"https://fixture.edu/research/recent.rss");assert.throws(()=>discoverDeclaredFeeds('<head><base href="https://evil.org/"/>'+link+'</head>',"https://fixture.edu/about",["fixture.edu"]));assert.throws(()=>discoverDeclaredFeeds('<head><base href="/a/"/><base href="/b/"/>'+link+'</head>',"https://fixture.edu/about",["fixture.edu"]));});
test("nearby bounded feed accounts for every raw row including malformed rows beyond cap and duplicates",()=>{const xml=rss(item()+item()+Array.from({length:98},(_,i)=>item("https://fixture.edu/paper/"+(i+2))).join("")+"<item>bad</item>"+item("https://fixture.edu/paper/101"));const r=parseRegionalFeed(xml,feedSource,at);assert.equal(r.rawItemCount,102);assert.equal(r.processedItemCount,100);assert.equal(r.candidates.length,99);assert.equal(r.duplicateItems,1);assert.equal(r.malformedItems,1);assert.equal(r.rejectedItems,1);assert.equal(r.skippedByLimit,1);assert.equal(r.truncated,true);assert.equal(r.state,"parser-failed");assert.equal(r.candidates.length+r.duplicateItems+r.rejectedItems+r.skippedByLimit,r.rawItemCount);});
const atom=entry=>'<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://fixture.edu/research/">'+entry+'</feed>';
test("nearby Atom resolves inherited root, entry and link bases without guessing",()=>{const r=parseRegionalFeed(atom('<entry xml:base="papers/"><title>Research</title><link xml:base="../works/" href="42"/><published>2026-10-01T12:00:00Z</published></entry>'),feedSource,at);assert.equal(r.candidates[0].url,"https://fixture.edu/research/works/42");});
for(const base of ['https://evil.org/','https://user:pass@fixture.edu/','https://fixture.edu:8443/','https://fixture.edu/?access_token=SECRET'])test("nearby Atom entry/link base rejects "+base,()=>{for(const e of ['<entry xml:base="'+base+'"><title>Research</title><link href="42"/></entry>','<entry><title>Research</title><link xml:base="'+base+'" href="42"/></entry>']){const r=parseRegionalFeed(atom(e),feedSource,at);assert.equal(r.candidates.length,0);assert.equal(r.rejectedItems,1);}});
for(const key of ["access_token","refresh-token","api_key","JWT","signature","X-Amz-Credential","X-Goog-Signature","sessionid"])test("nearby read view strips credential/query and fragment for "+key,async()=>{const v=await prepareRegionalSourceReadView(viewInput({existingOfficialSources:[{...news,url:"https://fixture.edu/news?"+key+"=SYNTHETIC_NEARBY_SECRET#SYNTHETIC_FRAGMENT"}]}));const r=queryRegionalSourceReadView(v,{},at);assert.equal(JSON.stringify(r).includes("SYNTHETIC_"),false);assert.equal(r.results.find(x=>x.sourceId===news.id).url,"https://fixture.edu/news");assert.match(r.urlProjection,/omit all query/);});
test("nearby URL projection also drops harmless and nested redirect queries without claiming exact configuration",async()=>{const v=await prepareRegionalSourceReadView(viewInput({existingOfficialSources:[{...news,url:"https://fixture.edu/news?topic=public&next=https%3A%2F%2Fevil.org%2F%3Fjwt%3DSYNTHETIC_SECRET"}]}));assert.equal(queryRegionalSourceReadView(v,{},at).results.find(x=>x.sourceId===news.id).url,"https://fixture.edu/news");assert.equal(permittedPublicUrl("https://fixture.edu/news?next=https%3A%2F%2Fevil.org%2F%3Fjwt%3DSYNTHETIC_SECRET"),false);});
test("nearby public projection rejects userinfo/private endpoint and oversized raw input",async()=>{for(const url of ["https://user:pass@fixture.edu/news","https://127.0.0.1/news","https://fixture.edu/news?x="+"a".repeat(2100)])await assert.rejects(prepareRegionalSourceReadView(viewInput({existingOfficialSources:[{...news,url}]})));});
test("nearby unsupported, calendar-impossible and timezone-impossible feed dates retain raw and explicit hold",()=>{for(const d of ["Feb 29, 2025 12:00:00 GMT","2025-02-29T12:00:00Z","31 Apr 2026 12:00:00 GMT","2026-10-01T24:00:00Z","2026-10-01T12:00:60Z","2026-10-01T12:00:00+24:00","01 Oct 2026 12:00:00 +0060","2026/10/01 12:00:00 +0000"]){const c=parseRegionalFeed(rss(item(undefined,d)),feedSource,at).candidates[0];assert.equal(c.sourcePublishedAt,null,d);assert.equal(c.rawPublishedDate,d);assert.equal(c.dateBasis,"unknown");assert.ok(c.holds.includes("source-date-invalid-or-future"));}});
test("nearby strict date parser preserves supported PDT, ISO fractions and leap day",()=>{for(const [raw,expected] of [["Thu, 01 Oct 2026 12:00:00 PDT","2026-10-01T19:00:00.000Z"],["2026-10-01T12:00:00.1+02:30","2026-10-01T09:30:00.100Z"],["29 Feb 2024 12:00:00 GMT","2024-02-29T12:00:00.000Z"]])assert.equal(parseRegionalFeed(rss(item(undefined,raw)),feedSource,at).candidates[0].sourcePublishedAt,expected);assert.throws(()=>parseRegionalFeed(rss(item()),feedSource,"2026-02-30T04:00:00Z"));});

test("nearby observation and source date accept bounded RFC3339 sub-millisecond precision without changing raw evidence",()=>{const raw="2026-10-01T12:00:00.123456Z";const r=parseRegionalFeed(rss(item(undefined,raw)),feedSource,"2026-10-02T04:00:00.987654+00:00");assert.equal(r.candidates[0].sourcePublishedAt,"2026-10-01T12:00:00.123Z");assert.equal(r.candidates[0].rawPublishedDate,raw);assert.equal(r.observedAt,"2026-10-02T04:00:00.987654+00:00");});
