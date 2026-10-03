import assert from "node:assert/strict";
import test from "node:test";
import { RegionalInventory, PublicAffiliation, verifyPublicAffiliation, resolveInstitutionalAuthor, verifyInstitutionalRepository } from "../src/ingest/regional-contracts.ts";
import { discoverDeclaredFeeds, parseRegionalFeed } from "../src/ingest/regional-discovery.ts";
const at="2026-10-02T04:00:00Z";
const institution={id:"inst-review",name:"Synthetic Institute",kind:"research-institute",existingInstitutionId:null,officialHosts:["fixture.edu"],regionalScope:"core",evidenceIds:["ev-role"],owner:"independent synthetic reviewer"};
const profileUrl="https://fixture.edu/person/alex";
const sha=async body=>Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(body))).toString("hex");
async function capture(body,{url=profileUrl,representation="normalized-text",id="ev-role",quote=body}={}) {
 return {evidence:{id,url,observedAt:at,sourcePublishedAt:null,representationSha256:await sha(body),quote,representation},
 retained:{url,observedAt:at,body}};
}
const row=(overrides={})=>PublicAffiliation.parse({id:"aff-review",personId:"person-alex",fullName:"Alex Lee",institutionId:institution.id,profileUrl,role:"Research Director",evidenceId:"ev-role",validFrom:null,validUntil:null,observedAt:at,expiresAt:"2026-10-09T04:00:00Z",...overrides});
async function proof(overrides={},body="Alex Lee Research Director",quote=body,extraTerm) {
 const r=row(overrides), role=await capture(body,{quote});
 const profile=await capture(JSON.stringify({"@context":"https://schema.org","@type":"ProfilePage",url:profileUrl,mainEntity:{"@type":"Person",name:"Alex Lee",url:profileUrl}}),{representation:"json",id:"ev-profile"});
 const qualification={profile};
 if(r.validFrom||r.validUntil) qualification.term=await capture(JSON.stringify({personName:r.fullName,role:r.role,profileUrl,institutionName:institution.name,validFrom:r.validFrom,validUntil:r.validUntil}),{representation:"json",id:"ev-term"});
 if(extraTerm) qualification.term=extraTerm;
 return verifyPublicAffiliation(r,institution,role.evidence,role.retained,qualification);
}
const author={name:"Alex Lee",institutionalProfileUrl:profileUrl};
test("N01 CONTROL genuine independently captured profile and role match",async()=>{
 const token=await proof(); assert.ok(token); assert.equal(resolveInstitutionalAuthor(author,[token],at).state,"matched"); assert.ok(Object.isFrozen(token));
});
test("N02 F1 cropped quote inside another person's full name must reject",async()=>assert.equal(await proof({},"Mary Alex Lee Research Director","Alex Lee Research Director"),null));
test("N03 F1 cropped quote cannot drop an emeritus role qualifier",async()=>assert.equal(await proof({},"Alex Lee Research Director Emeritus","Alex Lee Research Director"),null));
test("N04 CONTROL genuine token spread and structured clone both lose verification",async()=>{
 const t=await proof(); assert.ok(t); for(const v of [{...t},structuredClone(t),Object.create(t)]) assert.equal(resolveInstitutionalAuthor(author,[v],at).state,"unresolved");
});
test("N05 CONTROL unsupported term declaration must not qualify",async()=>{
 const t=await capture(JSON.stringify({personName:"Alex Lee",role:"Research Director",profileUrl,institutionName:institution.name,validFrom:null,validUntil:"2030-01-01"}),{representation:"json",id:"ev-term"});
 assert.equal(await proof({validUntil:"2026-10-01"},"Alex Lee Research Director","Alex Lee Research Director",t),null);
});
test("N06 unvalidated optional term ID must not enter verified provenance",async()=>{
 const fake={evidence:{id:"ev-unverified-term",url:"https://unrelated.org/term",observedAt:"2020-01-01T00:00:00Z",representation:"json",representationSha256:"0".repeat(64),quote:"invented"},retained:{url:"https://fixture.edu/no-such-term",observedAt:at,body:"not JSON"}};
 const token=await proof({},"Alex Lee Research Director","Alex Lee Research Director",fake);
 if(token) assert.equal(resolveInstitutionalAuthor(author,[token],at).evidenceIds.includes("ev-unverified-term"),false);
});
test("N07 equal instants in different offsets must produce same term decision",async()=>{
 const token=await proof({validUntil:"2026-10-02"}); assert.ok(token);
 assert.deepEqual(resolveInstitutionalAuthor(author,[token],"2026-10-02T12:30:00Z"),resolveInstitutionalAuthor(author,[token],"2026-10-03T00:30:00+12:00"));
});
const anchor='<a href="https://github.com/Example/Project">Repository</a>';
async function repo(body) {
 const c=await capture(body,{url:"https://fixture.edu/project",representation:"html",id:"ev-repo"});
 return verifyInstitutionalRepository({institution,...c,repository:{id:"123",fullName:"Example/Project",private:false,htmlUrl:"https://github.com/Example/Project"},repositoryCapture:{url:"https://api.github.com/repos/Example/Project",observedAt:at,body:JSON.stringify({id:123,full_name:"Example/Project",owner:{login:"Example"},name:"Project",private:false,html_url:"https://github.com/Example/Project",visibility:"public"})}});
}
test("N08 CONTROL visible full anchor proves one public repo link",async()=>{const r=await repo("<html><body>"+anchor+"</body></html>");assert.equal(r?.repositoryId,"123");assert.equal(r.organizationOwnershipVerified,false);assert.equal(r.publicationAuthorized,false);});
const inertCases=[
 ["N09","self-closing template is still an HTML template","<template/>"+anchor+"</template>"],
 ["N10","self-closing hidden div remains a hidden ancestor","<div hidden/>"+anchor+"</div>"],
 ["N11","xmp content is raw text","<xmp>"+anchor+"</xmp>"],
 ["N12","iframe content is raw text","<iframe>"+anchor+"</iframe>"],
 ["N13","noembed content is raw text","<noembed>"+anchor+"</noembed>"],
 ["N14","plaintext content is raw text","<plaintext>"+anchor],
 ["N15","ordinary template stays inert","<template>"+anchor+"</template>"],
 ["N16","ordinary hidden div stays hidden","<div hidden>"+anchor+"</div>"],
 ["N17","comment stays inert","<!--"+anchor+"-->"],
 ["N18","style content stays raw","<style>"+anchor+"</style>"]
];
for(const [id,label,body] of inertCases) test(id+" F7 "+label+" cannot prove institutional GitHub anchor",async()=>assert.equal(await repo(body),null));
const feedLink='<link rel="alternate" type="application/rss+xml" href="/feed.rss">';
for(const [id,body] of [["N19","<head><template/>"+feedLink+"</template></head>"],["N20","<head><xmp>"+feedLink+"</xmp></head>"],["N21","<head><div hidden/>"+feedLink+"</div></head>"]])
 test(id+" fake/inert head feed link must not become declaration",()=>assert.deepEqual(discoverDeclaredFeeds(body,"https://fixture.edu/about",["fixture.edu"]),[]));
test("N22 CONTROL valid head declaration and quoted tag delimiter work",()=>assert.deepEqual(discoverDeclaredFeeds('<head><meta content=">"><link rel="alternate" type="application/rss+xml" href="/valid.rss"></head>',"https://fixture.edu/about",["fixture.edu"]).map(x=>x.url),["https://fixture.edu/valid.rss"]));
const source={url:"https://fixture.edu/feed.xml",allowedHosts:["fixture.edu"]};
const atomEntry='<entry><title>Synthetic article</title><link href="/article"/><published>2026-10-01T12:00:00Z</published></entry>';
test("N23 non-Atom namespaced feed must fail closed",()=>assert.throws(()=>parseRegionalFeed('<other:feed xmlns:other="https://unrelated.org/not-atom"><other:entry><other:title>Synthetic article</other:title><other:link href="/article"/><other:published>2026-10-01T12:00:00Z</other:published></other:entry></other:feed>',source,at)));
test("N24 foreign extension entry must not become an Atom article",()=>{const r=parseRegionalFeed('<feed xmlns="http://www.w3.org/2005/Atom" xmlns:other="https://unrelated.org/not-atom"><other:entry><other:title>Synthetic article</other:title><other:link href="/article"/><other:published>2026-10-01T12:00:00Z</other:published></other:entry></feed>',source,at);assert.equal(r.candidates.length,0);});
test("N25 foreign published field must not become publication-date evidence",()=>{const r=parseRegionalFeed('<feed xmlns="http://www.w3.org/2005/Atom" xmlns:other="https://unrelated.org/not-atom"><entry><title>Synthetic article</title><link href="/article"/><other:published>2026-10-01T12:00:00Z</other:published></entry></feed>',source,at);assert.equal(r.candidates[0].sourcePublishedAt,null);});
test("N26 CONTROL ordinary Atom identity and publication date work",()=>{const r=parseRegionalFeed('<feed xmlns="http://www.w3.org/2005/Atom">'+atomEntry+'</feed>',source,at);assert.equal(r.state,"healthy");assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].sourcePublishedAt,"2026-10-01T12:00:00.000Z");assert.equal(r.completeness,"partial");});
test("N27 CONTROL mixed malformed rows remain visible as failure",()=>{const r=parseRegionalFeed('<rss><channel><item>bad</item><item><title>Good</title><link>https://fixture.edu/a</link></item></channel></rss>',source,at);assert.equal(r.state,"parser-failed");assert.equal(r.malformedItems,1);assert.equal(r.rawItemCount,2);});
test("N28 CONTROL off-host nested xml:base cannot be laundered",()=>{const r=parseRegionalFeed('<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://fixture.edu/root/"><entry xml:base="https://unrelated.org/"><title>Synthetic</title><link xml:base="https://fixture.edu/" href="article"/></entry></feed>',source,at);assert.equal(r.candidates.length,0);});
test("N29 CONTROL leap-day date works but Gregorian century rollover rejects",()=>{for(const [d,want] of [["2000-02-29T12:00:00Z","2000-02-29T12:00:00.000Z"],["1900-02-29T12:00:00Z",null],["2026-09-31T12:00:00Z",null]]){const r=parseRegionalFeed('<rss><channel><item><title>Synthetic</title><link>https://fixture.edu/a</link><pubDate>'+d+'</pubDate></item></channel></rss>',source,at);assert.equal(r.candidates[0].sourcePublishedAt,want,d);}});
