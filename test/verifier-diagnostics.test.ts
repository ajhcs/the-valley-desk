import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyWithSecondModel } from "../src/ingest/verification";
import type { ModelResponseDiagnostic } from "../src/ingest/model-response-diagnostics";

const input = {id:"diagnostic-fixture",kind:"news",title:"Penn financial report",dek:"Dek",
  body:"Penn financial report was released.",impactSentence:"Penn financial report",evidenceSpans:["Penn financial report"]};
const envelope = (content: string) => JSON.stringify({choices:[{finish_reason:"length",message:{content}}],usage:{completion_tokens:2048}});

test("synthetic verifier failures yield bounded content-free diagnostics without changing rejection", async () => {
  for (const [body, phase, failure] of [
    ['{"PRIVATE-MARKER":', "outer_json", "outer_json_or_body_failure"],
    [envelope('{"approved":true,"PRIVATE-MARKER":'), "content_json", "malformed"],
    [envelope('{"approved":"PRIVATE-MARKER"}'), "content_json", "schema_invalid"],
    ["PRIVATE-MARKER".repeat(30000), "outer_json", "response_byte_limit"],
  ]) {
    let diagnostic: ModelResponseDiagnostic | undefined;
    const result = await verifyWithSecondModel(input, {apiKey:"PRIVATE-MARKER",onDiagnostic:value=>{diagnostic=value;}}, async()=>new Response(body));
    assert.equal(result.approved,false);
    assert.equal(diagnostic?.phase,phase);
    assert.equal(diagnostic?.failure,failure);
    const serialized=JSON.stringify(diagnostic);
    assert.ok(serialized.length<2048);
    assert.ok(!serialized.includes("PRIVATE-MARKER"));
    assert.ok(!JSON.stringify(result).includes("PRIVATE-MARKER"));
    if (failure!=="response_byte_limit") assert.match(diagnostic?.shape?.sha256??"",/^[a-f0-9]{64}$/);
    if (phase==="content_json") {
      assert.equal(diagnostic?.finishReason,"length");
      assert.equal(diagnostic?.usage?.completionTokens,2048);
    }
  }
});

test("diagnostic sink errors cannot authorize or reject an otherwise unchanged verifier result", async () => {
  for (const content of ['```json\n{"approved":true,"objections":[]}\n```','{"approved":false,"objections":[{"code":"uncertain","reason":"Needs corroboration"}]}']) {
    const config={apiKey:"fixture",onDiagnostic:()=>{throw Error("sink failure");}};
    const result=await verifyWithSecondModel(input,config,async()=>new Response(envelope(content)));
    assert.equal(result.approved,content.startsWith("```"));
  }
});

test("default verifier failure log emits safe metadata and never arbitrary provider fields", async () => {
  const messages:unknown[]=[]; const original=console.warn;
  try {
    console.warn=(value:unknown)=>{messages.push(value);};
    const body=JSON.stringify({id:"PRIVATE-MARKER",choices:[{finish_reason:"PRIVATE-MARKER",message:{content:"PRIVATE-MARKER"}}]});
    const result=await verifyWithSecondModel(input,{apiKey:"PRIVATE-MARKER"},async()=>new Response(body,{headers:{"x-request-id":"PRIVATE-MARKER"}}));
    assert.equal(result.approved,false);
    assert.equal(messages.length,1);
    assert.ok(!JSON.stringify(messages).includes("PRIVATE-MARKER"));
    assert.equal(JSON.parse(String(messages[0])).event,"verifier-response-diagnostic");
    assert.equal(JSON.parse(String(messages[0])).finishReason,"unknown");
  } finally { console.warn=original; }
});
