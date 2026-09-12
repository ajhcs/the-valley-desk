import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import worker from "../worker.js";
import { configureReviewGuardsForTests, handleReviewApi } from "../src/ingest/review-api";
import { capturePolicyPdf, policyBaselineView } from "../src/ingest/policy-pdf";
import { provisionContext, reconstructProvisions, type EvidencePage } from "../src/ingest/policy-provisions";
import { pdfDatabase, seedPdfBills, pdfCases, officialPdfFixtureFetch } from "./helpers/policy-pdf";

test("actual 79 PDF pages persist through authenticated review, with immutable retries and no publication", async () => {
  const {db,sqlite}=pdfDatabase();
  const scratch=mkdtempSync(join(process.env.TMPDIR??"/mnt/d/tmp/plumbob","tvd-pdf-regression-"));
  const originalFetch=globalThis.fetch;
  const token="local-fixture-operator-only";
  configureReviewGuardsForTests({postLimit:100});
  const call=(path:string,body?:unknown,credential:string|null=token) => handleReviewApi(new Request(`http://localhost/api/${path}`,{
    method:body?"POST":"GET",headers:{...(credential?{authorization:`Bearer ${credential}`} : {}),"content-type":"application/json"},
    ...(body?{body:JSON.stringify(body)}:{}),
  }),{VALLEY_DESK_DB:db,REVIEW_API_TOKEN:token});
  try {
    await seedPdfBills(db);
    assert.equal((await call("policy-background",undefined,null)).status,404);
    assert.equal((await call("policy-background",undefined,"invalid")).status,404);
    assert.equal((await call("policy-background")).status,200);
    const initial=sqlite.prepare("SELECT * FROM policy_versions ORDER BY id").all();
    globalThis.fetch=officialPdfFixtureFetch;
    for(const entry of pdfCases) {
      const version=sqlite.prepare("SELECT * FROM policy_versions WHERE version_id=?").get(`PN ${entry.printer}`)!;
      const capture=await call(`policy-versions/${version.id}/capture`,{});
      assert.equal(capture.status,201,await capture.clone().text());
      const artifact=await capture.json();
      const download=await call(`policy-pdf/${artifact.id}/content`);
      const pdf=join(scratch,`${entry.bill}.pdf`),meta=join(scratch,`${entry.bill}.json`),pagesDir=join(scratch,entry.bill);
      writeFileSync(pdf,new Uint8Array(await download.arrayBuffer()));
      writeFileSync(meta,JSON.stringify(artifact));
      const completed=JSON.parse(execFileSync("node_modules/.policy-pdf/bin/python",["scripts/render-policy-evidence.py",pdf,meta,pagesDir],{encoding:"utf8",timeout:120_000}));
      assert.equal(completed.pageCount,entry.pages);
      assert.equal((await call(`policy-pdf/${artifact.id}/complete`,completed)).status,409,"no partial completion");
      assert.equal((await call(`policy-pdf/${artifact.id}/failure`,{artifactSha256:artifact.sha256,error:"render-failed"})).status,200);
      const packets=[];
      for(let n=1;n<=entry.pages;n++) {
        const packet=JSON.parse(readFileSync(join(pagesDir,`page-${n}.json`),"utf8")); packets.push(packet);
        const stored=await call(`policy-pdf/${artifact.id}/pages/${n}`,packet);
        assert.equal(stored.status,200,await stored.clone().text());
      }
      const finish=await call(`policy-pdf/${artifact.id}/complete`,completed);
      assert.equal(finish.status,200,await finish.clone().text());
      assert.equal((await finish.json()).outcome,"complete");
      assert.equal((await (await call(`policy-pdf/${artifact.id}/complete`,completed)).json()).outcome,"unchanged");
      assert.equal((await (await call(`policy-pdf/${artifact.id}/pages/1`,packets[0])).json()).outcome,"unchanged");
      assert.equal((await call(`policy-pdf/${artifact.id}/pages/1`,{...packets[0],artifactSha256:"0".repeat(64)})).status,409);
      assert.equal((await call(`policy-pdf/${artifact.id}/complete`,{...completed,headerIdentity:{...completed.headerIdentity,printer:"PN 9999"}})).status,409);
      const groups=sqlite.prepare("SELECT * FROM policy_provisions WHERE artifact_id=? ORDER BY ordinal").all(artifact.id);
      assert.equal(groups.length,entry.bill==="hb1925"?52:entry.bill==="sb1113"?45:8,"captured section-boundary contract");
      assert.ok(groups.every(g=>!/^section\s/.test(String(g.heading))),"lowercase references cannot become section headings");
      if(entry.bill==="hb1925")assert.ok(groups.some(g=>String(g.heading).startsWith("§ 3507 3506.")),"renumbered heading retains both printed numbers");
      const bodyLines=packets.flatMap(p=>p.lines.filter((l:{role:string;text:string})=>l.role==="body"&&l.text.trim()));
      assert.equal(groups.reduce((n,g)=>n+JSON.parse(String(g.evidence_json)).parts.length,0),bodyLines.length,"all body lines retained exactly once across pages");
      assert.ok(groups.some(g=>new Set(JSON.parse(String(g.evidence_json)).parts.map((p:{page:number})=>p.page)).size>1));
      const group=groups[0]!;
      const review={evidenceSha256:group.evidence_sha256,decision:"approved",summary:"Unverified summary must not escape",questions:[],supportingSpans:[],renderedPages:[],verificationNote:"No rendered-page check has been performed.",confirmedDefinitionsExceptionsAndReferences:true};
      assert.equal((await call(`policy-provisions/${group.id}/review`,review)).status,409);
      assert.equal((await call(`policy-provisions/${group.id}/review`,{...review,decision:"hold",summary:"",questions:["Fixture hold: rendered-page interpretation has not been approved."]})).status,200);
      assert.equal((await call(`policy-provisions/${group.id}/review`,{...review,supportingSpans:[{page:1,line:0,quote:"This quotation was invented."}]})).status,409);
      if(entry.bill==="hb1993") {
        const exception=groups.find(g=>String(g.heading).startsWith("Section 6."))!;
        const evidence=JSON.parse(String(exception.evidence_json));
        const context=provisionContext(evidence,groups.map(g=>JSON.parse(String(g.evidence_json))));
        const numbered=[...new Set(context.flatMap(g=>g.parts.map(p=>p.page)))].sort((a,b)=>a-b);
        assert.deepEqual(numbered,[1,2,3,4,5,7]);
        const literal=evidence.parts.find((p:{text:string})=>p.text.includes("This act does not apply"));
        const approved={...review,evidenceSha256:exception.evidence_sha256,
          summary:"Fixture contract: this section lists exceptions; substantive visual-review examples are retained separately.",
          supportingSpans:[{page:literal.page,line:literal.line,quote:literal.text}],
          renderedPages:numbered.map(page=>({page,sha256:packets[page-1].renderSha256})),
          verificationNote:"Fixture-only authenticated review contract. No production review or publication is authorized."};
        const saved=await call(`policy-provisions/${exception.id}/review`,approved);
        assert.equal(saved.status,200,await saved.clone().text());
        const savedId=(await saved.json()).id;
        assert.equal((await (await call(`policy-provisions/${exception.id}/review`,approved)).json()).id,savedId);
        assert.equal((await call(`policy-provisions/${exception.id}/review`,{...approved,renderedPages:approved.renderedPages.slice(1)})).status,409);
        assert.equal((await call(`policy-provisions/${exception.id}/review`,{...approved,evidenceSha256:"f".repeat(64)})).status,409);
        assert.ok((await policyBaselineView(db)).bills.find(b=>b.bill==="HB 1993")!.provisions.some(p=>p.summary===approved.summary));
        const hold={...approved,decision:"hold",summary:"",questions:["New fixture question supersedes the prior review."]};
        assert.equal((await call(`policy-provisions/${exception.id}/review`,hold)).status,200);
        assert.equal((await call(`policy-provisions/${exception.id}/review`,approved)).status,409,"an old replay must not claim to supersede a newer hold");
        assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM policy_provision_reviews WHERE provision_id=?").get(exception.id)!.n,2);
      }
      const again=await capturePolicyPdf(db,String(version.id),"fixture",officialPdfFixtureFetch);
      assert.equal(again!.id,artifact.id);
      assert.equal(sqlite.prepare("SELECT extraction_error FROM policy_pdf_artifacts WHERE id=?").get(artifact.id)!.extraction_error,null);
    }
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM policy_pdf_artifacts").get()!.n,3);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM policy_pdf_pages").get()!.n,79);
    const audit=readFileSync(new URL("../docs/evidence/policy-pdf-review-audit.sql",import.meta.url),"utf8");
    const audited=sqlite.prepare(audit).all();
    assert.equal(audited.length,3);
    assert.ok(audited.every(r=>r.bill===r.bound_bill&&r.session===r.bound_session&&r.printer===r.bound_printer&&r.declared_page_count===r.retained_pages&&r.extraction_state==="complete"));
    assert.deepEqual(sqlite.prepare("SELECT * FROM policy_versions ORDER BY id").all(),initial,"PDF workflow must not change legislative identity or dates");
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM content_candidates").get()!.n,0);
    const baseline=await policyBaselineView(db);
    assert.equal(baseline.bills.length,3);
    assert.ok(baseline.bills.every(b=>b.artifact?.state==="complete"));
    assert.ok(baseline.bills.every(b=>b.provisions.every(p=>!p.summary && !("evidence" in p))));
    assert.equal(baseline.publicationAuthorized,false);
  } finally { configureReviewGuardsForTests(); globalThis.fetch=originalFetch; sqlite.close(); rmSync(scratch,{recursive:true,force:true}); }
});

test("official PDF fetch confinement and checksum revisions never reuse another artifact's evidence", async () => {
  const {db,sqlite}=pdfDatabase();
  try {
    await seedPdfBills(db);
    const version=sqlite.prepare("SELECT * FROM policy_versions WHERE version_id='PN 2515'").get()!;
    const id=String(version.id);
    for(const bad of ["https://example.com/a.pdf",String(version.text_url).replace("PN2515","PN3349"),`${version.text_url}?token=sensitive`,"not-a-url"]) {
      sqlite.prepare("UPDATE policy_versions SET text_url=? WHERE id=?").run(bad,id);
      await assert.rejects(()=>capturePolicyPdf(db,id,"fixture",async()=>{throw Error("fetch must not run");}),/version-url-conflict/);
    }
    sqlite.prepare("UPDATE policy_versions SET text_url=? WHERE id=?").run(version.text_url,id);
    await assert.rejects(()=>capturePolicyPdf(db,id,"fixture",async()=>new Response(null,{status:302,headers:{location:"https://example.com/private"}})),/pdf-redirect-conflict/);
    await assert.rejects(()=>capturePolicyPdf(db,id,"fixture",async()=>new Response("unavailable",{status:403})),/official-pdf-http-403/);
    const first=await capturePolicyPdf(db,id,"fixture",officialPdfFixtureFetch);
    const original=await officialPdfFixtureFetch(String(version.text_url)).then(r=>r.arrayBuffer());
    for(let n=1;n<8;n++) {
      const bytes=Buffer.concat([Buffer.from(original),Buffer.from("\n".repeat(n))]);
      const next=await capturePolicyPdf(db,id,"fixture",async()=>new Response(bytes,{headers:{"content-type":"application/pdf"}}));
      assert.notEqual(next!.id,first!.id);
      assert.equal(next!.state,"pending");
      assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM policy_pdf_pages WHERE artifact_id=?").get(next!.id)!.n,0);
    }
    assert.equal((await capturePolicyPdf(db,id,"fixture",officialPdfFixtureFetch))!.id,first!.id,"capacity must not reject an identical retry");
    await assert.rejects(()=>capturePolicyPdf(db,id,"fixture",async()=>new Response(Buffer.concat([Buffer.from(original),Buffer.from("\n".repeat(8))]),{headers:{"content-type":"application/pdf"}})),/artifact-capacity-hold/);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM policy_pdf_artifacts").get()!.n,8);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM policy_versions").get()!.n,3);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM published_content").get()!.n,0);
  } finally {sqlite.close();}
});

test("Explicitly enabled Worker baseline is read-only background; protected evidence and HEAD contracts remain intact", async () => {
  const {db,sqlite}=pdfDatabase();
  try {
    await seedPdfBills(db);
    const env={VALLEY_DESK_DB:db,REVIEW_API_TOKEN:"fixture-worker-only",PUBLIC_ORIGIN:"https://thevalleydesk.org",POLICY_BACKGROUND_PUBLIC_ENABLED:"true"};
    const get=await worker.fetch(new Request("https://thevalleydesk.org/api/policy-watchlist"),env,{});
    assert.equal(get.status,200);
    assert.equal((await get.json()).kind,"policy-background");
    const head=await worker.fetch(new Request("https://thevalleydesk.org/api/policy-watchlist",{method:"HEAD"}),env,{});
    assert.equal(head.status,200);assert.equal(await head.text(),"");
    assert.equal((await worker.fetch(new Request("https://thevalleydesk.org/api/policy-watchlist",{method:"POST"}),env,{})).status,405);
    for(const path of ["/api/policy-background","/api/policy-pdf/unknown/content","/api/policy-versions/id/capture","/api/policy-provisions/id/review","/ops/api/policy-background"]) {
      assert.equal((await worker.fetch(new Request(`https://thevalleydesk.org${path}`),env,{})).status,404);
    }
  } finally {sqlite.close();}
});

test("provision reconstruction preserves continuations, definitions, exceptions, amendment hints and transitive context", () => {
  const page=(n:number,texts:string[]):EvidencePage=>({pageNumber:n,textSha256:"0".repeat(64),renderSha256:"1".repeat(64),renderer:"fixture",lines:texts.map((text,i)=>({text,bbox:[0,i*20,100,i*20+15],role:"body",marks:text.includes("deleted")?["strike"]:[]}))});
  const groups=reconstructProvisions([
    page(1,["Section 1. Definitions.","A means B as described in section 2.","Section 2. Scope.","Except where"]),
    page(2,["the exemption in section 3 applies.","deleted text remains available", "Section 3. Exemptions.","Definitions in section 1 apply."]),
  ]);
  assert.equal(groups.length,3);
  assert.deepEqual(groups[1]!.parts.map(p=>p.page),[1,1,2,2]);
  assert.deepEqual(provisionContext(groups[0]!,groups).map(g=>g.ordinal),[0,1,2]);
  assert.deepEqual(groups[1]!.parts.at(-1)!.marks,["strike"]);
  const missing=reconstructProvisions([page(1,["Section 1. Scope.","Subject to section 99."])]);
  assert.deepEqual(missing[0]!.unresolvedReferences,["99"]);
  const split=page(1,["§","3507","3506",". Oversight.","See sections 3502 (relating to disclosure), 3503 and 3504."]);
  split.lines.slice(0,4).forEach(l=>{l.bbox[1]=0;});
  const renumbered=reconstructProvisions([split]);
  assert.equal(renumbered[0]!.heading,"§ 3507 3506. Oversight.");
  assert.deepEqual(renumbered[0]!.references,["3507","3502","3503","3504"]);
  assert.ok(renumbered[0]!.unresolvedReferences.includes("3507"));
});
