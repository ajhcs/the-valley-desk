#!/usr/bin/env node
import { boundedWatchFile as boundedFile, watchOutputDirectory } from "./lib/watch-local-files.mjs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { launchCandidates, launchCandidate } from "../fixtures/watch-launch-candidates.ts";
import { launchCoverage } from "../fixtures/watch-launch-coverage.ts";
import { captureLaunchCandidate, prepareCapturedSource } from "./lib/watch-source-preparation.ts";
import { importPaOriginal } from "./lib/pa-original-import.ts";
import { canonicalJson } from "../src/content/watch-schema.ts";

const {values}=parseArgs({options:{capture:{type:"string"},out:{type:"string"},replay:{type:"string"},body:{type:"string"},import:{type:"string"},acquisition:{type:"string"},"download-receipt":{type:"string"},"task-root":{type:"string"}}});
if([values.capture,values.replay,values.import].filter(Boolean).length>1)throw Error("Choose capture, import or replay");
const outputDirectory=()=>watchOutputDirectory(values.out,values["task-root"],Boolean(values.import));
if(values.import){
  const source=launchCandidate(values.import).source,directory=outputDirectory();
  if(!values.body||!values.acquisition||!values["download-receipt"])throw Error("Import requires body, acquisition and unchanged download receipt");
  const acquisition=JSON.parse(new TextDecoder().decode(boundedFile(values.acquisition,64000)));
  const packet=await importPaOriginal(values.import,boundedFile(values.body,source.maxBytes),acquisition,boundedFile(values["download-receipt"],64000));
  const output=join(directory,values.import+"-import-"+randomUUID()+".json");
  writeFileSync(output,JSON.stringify(packet,null,2)+"\n",{flag:"wx",mode:0o600});
  process.stdout.write(JSON.stringify({receipt:output,outcome:"review-only-import",sourceId:values.import})+"\n");
}else if(values.capture){
  launchCandidate(values.capture);
  const directory=outputDirectory();
  const result=await captureLaunchCandidate(values.capture);
  const stem=values.capture+"-"+randomUUID();
  const bodyFile=result.bytes?stem+".body":null;
  if(bodyFile)writeFileSync(join(directory,bodyFile),result.bytes,{flag:"wx"});
  const {bytes,...receipt}=result;
  const output=join(directory,stem+".json");
  writeFileSync(output,JSON.stringify({...receipt,preparedAt:new Date().toISOString(),bodyFile},null,2)+"\n",{flag:"wx"});
  process.stdout.write(JSON.stringify({receipt:output,outcome:result.outcome,sourceId:result.sourceId})+"\n");
}else if(values.replay){
  if(!values.body)throw Error("--body is required for replay");
  const receipt=JSON.parse(new TextDecoder().decode(boundedFile(values.replay,2_000_000)));
  const bytes=boundedFile(values.body,launchCandidate(receipt.sourceId).source.maxBytes);
  if(receipt.schemaVersion==="pa-original-import-1"){
    if(!values["download-receipt"])throw Error("Original replay requires unchanged download receipt");
    const actual=await importPaOriginal(receipt.sourceId,bytes,receipt.acquisition,boundedFile(values["download-receipt"],64000));
    if(canonicalJson(actual)!==canonicalJson(receipt))throw Error("Replay packet mismatch");
    process.stdout.write(JSON.stringify({sourceId:receipt.sourceId,outcome:"exact-replay",qualificationStatus:"candidate-only"})+"\n");
    process.exit(0);
  }
  if(!receipt.packet)throw Error("Captured parser packet required");
  const actual=await prepareCapturedSource(receipt.sourceId,bytes,receipt.packet.capturedAt);
  if(canonicalJson(actual)!==canonicalJson(receipt.packet))throw Error("Replay packet mismatch");
  process.stdout.write(JSON.stringify({sourceId:receipt.sourceId,outcome:"exact-replay",qualificationStatus:"candidate-only"})+"\n");
}else{
  if(values.out||values.body||values.acquisition||values["download-receipt"])throw Error("Output and body require an explicit operation");
  process.stdout.write(JSON.stringify({status:"candidate-inventory-not-active",candidates:launchCandidates,coverage:launchCoverage},null,2)+"\n");
}
