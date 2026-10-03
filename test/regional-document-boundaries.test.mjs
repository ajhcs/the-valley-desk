import assert from "node:assert/strict";
import test from "node:test";
import { PublicAffiliation, verifyPublicAffiliation, resolveInstitutionalAuthor, verifyInstitutionalRepository } from "../src/ingest/regional-contracts.ts";
import { discoverDeclaredFeeds, parseRegionalFeed } from "../src/ingest/regional-discovery.ts";
const at="2026-10-02T04:00:00Z",profileUrl="https://fixture.edu/person/alex";
const institution={id:"inst-review",name:"Synthetic Institute",kind:"research-institute",existingInstitutionId:null,officialHosts:["fixture.edu"],regionalScope:"core",evidenceIds:["ev-role"],owner:"synthetic test"};
async function capture(body,{url=profileUrl,id="ev-role",representation="normalized-text",quote=body}={}) {return {evidence:{id,url,observedAt:at,sourcePublishedAt:null,representationSha256:Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(body))).toString("hex"),quote,representation},retained:{url,observedAt:at,body}};}
const row=overrides=>PublicAffiliation.parse({id:"aff-review",personId:"person-alex",fullName:"Alex Lee",institutionId:institution.id,profileUrl,role:"Research Director",evidenceId:"ev-role",validFrom:null,validUntil:null,observedAt:at,expiresAt:"2026-10-09T04:00:00Z",...overrides});
const page=(mainEntity={"@type":"Person",name:"Alex Lee",url:profileUrl})=>({"@context":"https://schema.org","@type":"ProfilePage",url:profileUrl,mainEntity});
const author={name:"Alex Lee",institutionalProfileUrl:profileUrl};
async function qualify(role,affiliation=row(),term) {const profile=await capture(JSON.stringify(page()),{id:"ev-profile",representation:"json"});return verifyPublicAffiliation(affiliation,institution,role.evidence,role.retained,{profile,...term?{term}:{}});}
for(const body of ["Mary\nAlex Lee Research Director","Alex Lee Research Director\nEmeritus","About this person\nAlex Lee Research Director\nRelated names","Alex Lee Research Director. Visitor role ended","Alex Lee Research Director\nAlex Lee Research Director"])
 test("role context cannot infer a complete record from line or substring: "+body,async()=>assert.equal(await qualify(await capture(body,{quote:"Alex Lee Research Director"})),null));
test("entire standalone record supports source whitespace without dropping context",async()=>assert.ok(await qualify(await capture("  Alex Lee\nResearch Director  ",{quote:"Alex Lee\nResearch Director"}))));
test("structured main person role preserves surrounding document metadata without using related people",async()=>{
 const body=JSON.stringify({...page({"@type":"Person",name:"Alex Lee",url:profileUrl,jobTitle:"Research Director"}),description:"Official profile metadata",relatedPeople:[{name:"Mary Alex Lee",jobTitle:"Research Director Emeritus"}]});
 const token=await qualify(await capture(body,{representation:"json"}));assert.ok(token);assert.equal(resolveInstitutionalAuthor(author,[token],at).state,"matched");
 for(const p of [page({"@type":"Person",name:"Mary Alex Lee",url:profileUrl,jobTitle:"Research Director"}),{...page(),relatedPeople:[{name:"Alex Lee",jobTitle:"Research Director"}]},page({"@type":"Person",name:"Alex Lee",url:profileUrl,jobTitle:"Research Director Emeritus"})])assert.equal(await qualify(await capture(JSON.stringify(p),{representation:"json"})),null);
});
test("structured role quote cannot crop the retained document",async()=>{const p=page({"@type":"Person",name:"Alex Lee",url:profileUrl,jobTitle:"Research Director"});assert.equal(await qualify(await capture(JSON.stringify(p),{representation:"json",quote:"Research Director"})),null);});
test("every optional term proof is checked, including null-date declarations",async()=>{
 const role=await capture("Alex Lee Research Director"), declaration={personName:"Alex Lee",role:"Research Director",profileUrl,institutionName:institution.name,validFrom:null,validUntil:null};
 const term=await capture(JSON.stringify(declaration),{representation:"json",id:"ev-term"});const token=await qualify(role,row(),term);assert.ok(token);assert.deepEqual(resolveInstitutionalAuthor(author,[token],at).evidenceIds,["ev-role","ev-profile","ev-term"]);
 for(const bad of [{...term,evidence:{...term.evidence,representationSha256:"0".repeat(64)}},{...term,evidence:{...term.evidence,url:"https://other.edu/term"}},{...term,retained:{...term.retained,body:term.retained.body+" "}},await capture(JSON.stringify({...declaration,role:"Visitor"}),{representation:"json",id:"ev-term"})])assert.equal(await qualify(role,row(),bad),null);
});
test("UTC affiliation day policy is invariant at start and end boundaries across timestamp offsets",async()=>{
 const affiliation=row({validFrom:"2026-10-02",validUntil:"2026-10-02"}),term=await capture(JSON.stringify({personName:affiliation.fullName,role:affiliation.role,profileUrl,institutionName:institution.name,validFrom:affiliation.validFrom,validUntil:affiliation.validUntil}),{representation:"json",id:"ev-term"});
 const token=await qualify(await capture("Alex Lee Research Director"),affiliation,term);assert.ok(token);
 for(const [first,second,state] of [["2026-10-02T04:00:00Z","2026-10-01T16:00:00-12:00","matched"],["2026-10-02T12:30:00Z","2026-10-03T00:30:00+12:00","matched"],["2026-10-03T00:30:00Z","2026-10-02T12:30:00-12:00","unresolved"]]){const a=resolveInstitutionalAuthor(author,[token],first),b=resolveInstitutionalAuthor(author,[token],second);assert.deepEqual(a,b);assert.equal(a.state,state);if(state==="matched")assert.equal(a.termCalendarPolicy,"UTC");}
});
const anchor='<a href="https://github.com/Example/Project">Repository</a>';
async function repository(body) {const c=await capture(body,{url:"https://fixture.edu/project",representation:"html",id:"ev-repo"});return verifyInstitutionalRepository({institution,...c,repository:{id:"123",fullName:"Example/Project",private:false,htmlUrl:"https://github.com/Example/Project"},repositoryCapture:{url:"https://api.github.com/repos/Example/Project",observedAt:at,body:JSON.stringify({id:123,full_name:"Example/Project",owner:{login:"Example"},name:"Project",private:false,html_url:"https://github.com/Example/Project"})}});}
for(const body of ['<template / >'+anchor+'</template>','<svg>'+anchor+'</svg>','<math>'+anchor+'</math>','<svg><foreignObject>'+anchor+'</foreignObject></svg>','<div inert />'+anchor+'</div>','<noscript>'+anchor+'</noscript>','<script/>"'+anchor+'"</script>','<a href="https://github.com/Example/Project" href="https://evil.org">Repository</a>'])
 test("HTML5 active document context rejects unsupported/duplicate/inert repository evidence: "+body.slice(0,45),async()=>assert.equal(await repository(body),null));
test("HTML5 parser closes real hidden context before a genuinely active anchor",async()=>{assert.equal((await repository('<div hidden>'+anchor+'</div>'+anchor)).repositoryId,"123");});
test("HTML head declarations use actual reconstructed head and template document contexts",()=>{
 const link='<link rel="alternate" type="application/rss+xml" href="/feed">';
 for(const body of ['<head><template/> '+link+'</template></head>','<head><iframe>'+link+'</iframe></head>','<head><noembed>'+link+'</noembed></head>','<head><plaintext>'+link,'<head><svg>'+link+'</svg></head>','<body><head>'+link+'</head></body>'])assert.deepEqual(discoverDeclaredFeeds(body,"https://fixture.edu/about",["fixture.edu"]),[]);
 assert.equal(discoverDeclaredFeeds(link,"https://fixture.edu/about",["fixture.edu"])[0].url,"https://fixture.edu/feed");
});
const source={url:"https://fixture.edu/feed.xml",allowedHosts:["fixture.edu"]},ATOM="http://www.w3.org/2005/Atom";
const xml=(entry,extra='')=>'<feed xmlns="'+ATOM+'" '+extra+'>'+entry+'</feed>';
const entry='<entry><title>Research</title><link href="/article"/><published>2026-10-01T12:00:00Z</published></entry>';
test("expanded Atom names accept any correctly bound prefix and default-namespace changes",()=>{
 const prefixed='<a:feed xmlns:a="'+ATOM+'"><a:entry xml:base="/papers/"><a:title>Research</a:title><a:link href="42"/><a:published>2026-10-01T12:00:00Z</a:published></a:entry></a:feed>';
 const r=parseRegionalFeed(prefixed,source,at);assert.equal(r.candidates[0].url,"https://fixture.edu/papers/42");assert.equal(r.candidates[0].sourcePublishedAt,"2026-10-01T12:00:00.000Z");
 assert.equal(parseRegionalFeed(xml(entry.replace('<published>','<published xmlns="https://foreign.org">')),source,at).candidates[0].sourcePublishedAt,null);
});
test("foreign links, titles, updates and entry containers cannot borrow Atom semantics",()=>{
 for(const e of [entry.replace('<link ','<o:link '),entry.replace('<title>','<o:title>').replace('</title>','</o:title>')])assert.equal(parseRegionalFeed(xml(e,'xmlns:o="https://foreign.org"'),source,at).candidates.length,0);
 const r=parseRegionalFeed(xml(entry.replace('</entry>','<o:updated>2026-10-01T13:00:00Z</o:updated></entry>'),'xmlns:o="https://foreign.org"'),source,at);assert.equal(r.candidates[0].sourceUpdatedAt,null);assert.equal(r.candidates[0].rawUpdatedDate,null);
 assert.equal(parseRegionalFeed(xml('<entry xmlns="https://foreign.org"><title>Foreign</title><link href="/article"/></entry>'),source,at).rawItemCount,0);
});
test("foreign base attributes are ignored; actual xml:base is resolved and namespace rebinding is rejected",()=>{
 const r=parseRegionalFeed(xml(entry.replace('<entry>','<entry o:base="https://evil.org/">'),'xmlns:o="https://foreign.org"'),source,at);assert.equal(r.candidates[0].url,"https://fixture.edu/article");
 for(const body of [xml(entry.replace('<entry>','<entry xmlns:xml="https://evil.org/">')),xml(entry.replace('<link ','<missing:link ')),xml(entry,'xmlns:x="http://www.w3.org/XML/1998/namespace"')])assert.throws(()=>parseRegionalFeed(body,source,at));
});
test("unsupported namespaced RSS and foreign pubDate cannot manufacture publications",()=>{
 assert.throws(()=>parseRegionalFeed('<rss xmlns="https://foreign.org"><channel/></rss>',source,at));
 const r=parseRegionalFeed('<rss xmlns:o="https://foreign.org"><channel><item><title>Research</title><link>https://fixture.edu/article</link><o:pubDate>2026-10-01T12:00:00Z</o:pubDate></item></channel></rss>',source,at);assert.equal(r.candidates[0].sourcePublishedAt,null);assert.equal(r.candidates[0].sourceDateField,null);
});
test("RSS1 expanded names and explicitly supported Dublin Core date keep their provenance",()=>{
 const r=parseRegionalFeed('<r:RDF xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Research feed</title></channel><item><title>Research</title><link>https://fixture.edu/article</link><dc:date>2026-10-01T12:00:00Z</dc:date></item></r:RDF>',source,at);assert.equal(r.candidates[0].sourcePublishedAt,"2026-10-01T12:00:00.000Z");assert.equal(r.candidates[0].sourceDateField,"dc.date");
});
test("supported duplicate singleton fields degrade instead of choosing one",()=>{const r=parseRegionalFeed(xml(entry.replace('</published>','</published><published>2026-10-01T13:00:00Z</published>')),source,at);assert.equal(r.state,"parser-failed");assert.equal(r.rejectedItems,1);assert.equal(r.candidates.length,0);});

test("legal repeated foreign Atom extensions are ignored without becoming dates or degraded rows",()=>{const r=parseRegionalFeed(xml(entry.replace('</entry>','<dc:date>2026-10-01T12:00:00Z</dc:date><dc:date>2026-10-01T13:00:00Z</dc:date><o:published>2026-10-01T14:00:00Z</o:published><o:published>2026-10-01T15:00:00Z</o:published></entry>'),'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:o="https://foreign.org"'),source,at);assert.equal(r.state,"healthy");assert.equal(r.rejectedItems,0);assert.equal(r.candidates[0].sourcePublishedAt,"2026-10-01T12:00:00.000Z");});
test("RSS honors document, channel, item and link XML bases and cannot launder an off-host ancestor",()=>{const body='<rss xml:base="https://fixture.edu/root/"><channel xml:base="channels/"><item xml:base="../items/"><title>Research</title><link xml:base="works/">42</link></item></channel></rss>';assert.equal(parseRegionalFeed(body,source,at).candidates[0].url,"https://fixture.edu/root/items/works/42");assert.equal(parseRegionalFeed(body.replace('https://fixture.edu/root/','https://evil.org/root/'),source,at).candidates.length,0);});
