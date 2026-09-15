#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { readFileSync,writeFileSync,realpathSync,statSync } from "node:fs";
import { resolve,dirname } from "node:path";
import { parseArgs } from "node:util";
import { canonicalJson,sha256 } from "../src/content/watch-schema.ts";
import { ContentItem } from "../src/content/schema.ts";
import { prepareEvaluationInventory,underlyingGroup } from "./lib/evaluation-preparation.ts";

const {values}=parseArgs({options:{db:{type:"string"},"source-root":{type:"string"},"technology-captures":{type:"string"},out:{type:"string"}}});
if(!values.db||!values["source-root"]||!values["technology-captures"])throw Error("Explicit local --db, --source-root and --technology-captures are required; no network mode exists");
const dbPath=realpathSync(values.db),scratch=realpathSync("/mnt/d/tmp/plumbob");
if(!dbPath.startsWith(scratch+"/")||statSync(dbPath).size>100_000_000)throw Error("Use a bounded local backup under task scratch, never a production binding");
const root=realpathSync(values["source-root"]),technology=realpathSync(values["technology-captures"]);
const read=path=>{if(statSync(path).size>10_000_000)throw Error("Evidence file limit");return readFileSync(path);};
const rows=[],records=[],excluded=[];
const db=new DatabaseSync(dbPath,{readOnly:true});
let extracts;
try{
  rows.push(...db.prepare("SELECT id,kind,title,source_url,content_json,verification_json FROM content_candidates ORDER BY id").all());
  extracts=db.prepare("SELECT url,state,cached_text,method,last_success_at FROM news_article_extractions ORDER BY url").all();
}finally{db.close();}
if(rows.length>5000||extracts.length>5000)throw Error("Inventory row limit");
const extractionMap=new Map(extracts.filter(row=>row.state==="success").map(row=>[row.url,row]));
const realEvents=new Set(["evt-dvhimss-22958","evt-njdvhimss-fall-2026","evt-dvhimss-23007","evt-njdvhimss-golf-2026","evt-dvhimss-23032"]);
const falseEventPages=new Set(["official-ofs-rwjbarnabas-news-rwjbh-org-billing","official-ofs-njha-events-njha-com-pressroom","official-ofs-dha-home-deha-org-advocacy","official-ofs-hap-events-haponline-org-advocacy-advocacy-resources-elections"]);
for(const row of rows){
  const parsed=ContentItem.safeParse(JSON.parse(row.content_json));
  if(!parsed.success||!row.source_url?.startsWith("https://")){excluded.push({id:row.id,reason:"invalid-legacy-item-or-public-url"});continue;}
  const item=parsed.data,extraction=extractionMap.get(row.source_url);
  let desk=null,limitations=["human-labels-and-reuse-review-missing"],text=extraction?.cached_text??item.body;
  if(falseEventPages.has(row.id)){desk="cross-cutting";limitations.push("agent-suspected-page-misclassified-as-event-not-human-ground-truth");}
  else if(row.verification_json?.includes("verifier-malformed")){desk="cross-cutting";limitations.push("observed-malformed-verifier-audit-only-raw-model-response-not-retained");}
  else if(row.kind==="event"&&realEvents.has(row.id)){desk="events";limitations.push("derived-event-copy-not-raw-calendar-response");}
  else if(row.kind==="policy"&&/\/legislation\/bills\/2025\/(hb1925|hb1993|sb1113)/.test(row.source_url)){desk="policy";limitations.push("same-instrument-html-pdf-advocacy-must-share-split");}
  else if(row.kind==="news"&&extraction){desk="news";limitations.push("extracted-article-text-not-original-http-bytes","editor-must-review-regional-relevance-and-syndication");}
  if(!desk||!text||text.length>24000){excluded.push({id:row.id,reason:!desk?"no-verified-distinct-case-family":"source-text-unavailable-or-over-limit"});continue;}
  records.push({id:row.id,desk,groupId:underlyingGroup(row.id,row.source_url),sourceUrl:row.source_url,
    sourceTextSha256:await sha256(text),characters:text.length,
    ...(desk==="policy"?{policyJurisdiction:"PA"}:{}),limitations,
    provenance:{file:dbPath,table:extraction?"news_article_extractions":"content_candidates",
      rowKey:extraction?.url??row.id,field:extraction?"cached_text":"content_json.body",
      capturedAt:extraction?.last_success_at??item.source.fetchedAt??null,
      legacyItemSha256:await sha256(canonicalJson(item)),verificationSha256:row.verification_json?await sha256(row.verification_json):null}});
}
for(const [file,jurisdiction,group]of [
  ["fr-2025-15492-20260912.json","federal","policy:federal:RIN-0938-AV50"],
  ["nj-a101-20260912.json","NJ","policy:NJ:2026:A101-companion-S2431"],
  ["de-sb360-20260912.json","DE","policy:DE:153:SB360"],
]){
  const path=resolve(root,"test/fixtures/policy-watch-native",file),bytes=read(path),data=JSON.parse(bytes);
  const text=canonicalJson(data.native);
  records.push({id:"native-"+file,desk:"policy",policyJurisdiction:jurisdiction,groupId:group,
    sourceUrl:data.source.sourceUrl,sourceTextSha256:await sha256(text),characters:text.length,
    provenance:{file:path,fileSha256:await sha256(bytes),field:"native",capturedAt:data.source.retrievedAt},
    limitations:["normalized-native-fixture-not-complete-original-instrument","legacy-input-mapping-and-human-labels-missing","reuse-review-missing"]});
}
for(const name of ["chop-orca","penn-captk","chop-openpedcan"]){
  const path=resolve(technology,name+".captures.json"),bytes=read(path),data=JSON.parse(bytes);
  const repository=JSON.parse(data.repository.body),text=data.readme.body;
  records.push({id:"technology-"+repository.id,desk:"technology",groupId:"github:"+repository.id,sourceUrl:data.readme.url,
    sourceTextSha256:await sha256(text),characters:text.length,
    provenance:{file:path,fileSha256:await sha256(bytes),field:"readme.body",capturedAt:data.readme.checkedAt,
      representations:await Promise.all(Object.entries(data).map(async([kind,value])=>({kind,url:value.url,sha256:await sha256(value.body)})))},
    limitations:["all-releases-readme-license-paper-aliases-share-repository-group","legacy-input-mapping-and-human-labels-missing","reuse-and-license-scope-review-missing",
      ...(text.length>24000?["literal-excerpt-selection-required-before-case-input"]:[])]});
}
const report=await prepareEvaluationInventory(records,{database:dbPath,publicRowsSha256:await sha256(canonicalJson(JSON.parse(JSON.stringify({rows,extracts})))),
  candidateRows:rows.length,extractionRows:extracts.length,successfulExtractions:extractionMap.size,
  sourceRoot:root,technologyCaptures:technology,excluded,inventoryAssessment:"agent-prepared-not-human-reviewed"});
const output=JSON.stringify(report,null,2)+"\n";
if(values.out){
  const destination=resolve(values.out),parent=realpathSync(dirname(destination));
  if(parent!==resolve("fixtures/evaluation-preparation")&&parent!==scratch&&!parent.startsWith(scratch+"/"))throw Error("Output must be a task scratch or evaluation-preparation directory");
  writeFileSync(destination,output,{flag:"wx"});
  process.stdout.write(JSON.stringify({output:destination,coverage:report.coverage,policyCoverage:report.policyCoverage,approvedCases:0})+"\n");
}else process.stdout.write(output);
