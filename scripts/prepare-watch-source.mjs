#!/usr/bin/env node
import { readFileSync, writeFileSync, realpathSync, statSync } from "node:fs";
import { resolve, isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { launchCandidates, launchCandidate } from "../fixtures/watch-launch-candidates.ts";
import { launchCoverage } from "../fixtures/watch-launch-coverage.ts";
import { captureLaunchCandidate, prepareCapturedSource } from "./lib/watch-source-preparation.ts";
import { canonicalJson } from "../src/content/watch-schema.ts";

const {values}=parseArgs({options:{capture:{type:"string"},out:{type:"string"},replay:{type:"string"},body:{type:"string"}}});
if(values.capture&&values.replay)throw Error("Choose capture or replay");
if(values.capture){
  launchCandidate(values.capture);
  if(!values.out||!isAbsolute(values.out))throw Error("--out must name an existing absolute task fixture directory");
  const directory=realpathSync(values.out),scratch=realpathSync("/mnt/d/tmp/plumbob");
  const fixtures=resolve("test/fixtures/watch-launch");
  if(directory!==fixtures&&directory!==scratch&&!directory.startsWith(scratch+"/"))throw Error("Output must stay in task scratch or test/fixtures/watch-launch");
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
  if(statSync(values.replay).size>2_000_000||statSync(values.body).size>500_000)throw Error("Replay byte limit");
  const receipt=JSON.parse(readFileSync(values.replay,"utf8"));
  if(!receipt.packet)throw Error("Captured parser packet required");
  const actual=await prepareCapturedSource(receipt.sourceId,new Uint8Array(readFileSync(values.body)),receipt.packet.capturedAt);
  if(canonicalJson(actual)!==canonicalJson(receipt.packet))throw Error("Replay packet mismatch");
  process.stdout.write(JSON.stringify({sourceId:receipt.sourceId,outcome:"exact-replay",qualificationStatus:"candidate-only"})+"\n");
}else{
  if(values.out||values.body)throw Error("Output and body require an explicit operation");
  process.stdout.write(JSON.stringify({status:"candidate-inventory-not-active",candidates:launchCandidates,coverage:launchCoverage},null,2)+"\n");
}
