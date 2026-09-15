import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { policyBackground, prospectivePolicyTiming, type PolicyTimingObservation } from "../src/ingest/policy-background";

test("captured official backgrounds retain action chronology and prior printers without publishing", () => {
  for (const [bill, printer, date] of [["hb1925","PN 3349","2026-06-25"], ["sb1113","PN 1376","2026-01-09"], ["hb1993","PN 2515","2025-10-24"]]) {
    const html = readFileSync(new URL(`./fixtures/pa-legislation/captured-${bill}-20260906.html`,import.meta.url),"utf8");
    const result = policyBackground(html,`https://www.palegis.us/legislation/bills/2025/${bill}`,"2026-09-07T21:00:00.000Z");
    assert.equal(result.record.current?.printer,printer);
    assert.equal(result.record.actionAt?.slice(0,10),date);
    assert.equal(result.historyOutcome,"complete");
    assert.ok(result.actions.some(a=>a.actionAt?.slice(0,10)===date));
    assert.equal(result.publicationAuthorized,false);
    assert.ok(result.synopsis.includes("artificial intelligence"));
    assert.ok(result.actions.every(a=>!a.wording.includes("Has not yet reached")));
    if (bill === "hb1925") {
      assert.equal(result.actions.length,5);
      assert.ok(result.record.history.some(v=>v.printer==="PN 2403"));
      assert.notEqual(result.record.current?.textDate,result.record.actionAt);
    }
  }
});

test("missing history is unavailable rather than successful empty; action timestamps are never fetch time", () => {
  const result = policyBackground("<div></div>","https://www.palegis.us/legislation/bills/2025/hb1925","2026-09-07T21:00:00.000Z");
  assert.equal(result.historyOutcome,"unavailable");
  assert.equal(result.record.actionAt,null);
  assert.ok(result.blockers.length);
});

const observation = (): PolicyTimingObservation => ({developmentId:"version-new",discoveredAt:"2026-09-07T12:00:00.000Z",
  candidateId:"candidate-1",fingerprint:"real-current-fingerprint",stage:"editorial-review",newDevelopmentEvidence:["https://official.example/new-action"],
  milestone:{fingerprint:"real-current-fingerprint",outcome:"blocker",rule:"evidence-required",citations:[{name:"Official source",url:"https://official.example/new-action"}],recordedAt:"2026-09-07T13:00:00.000Z"}});

test("prospective timing separates completed duration and unresolved age without resetting the historical miss", () => {
  const complete=observation(), unresolved={...observation(),developmentId:"version-held",stage:"relevance-hold",milestone:null};
  const report=prospectivePolicyTiming([complete,unresolved],"2026-09-07T10:00:00.000Z","2026-09-07T15:00:00.000Z");
  assert.equal(report.eligibleSamples,2);
  assert.equal(report.observations[0]!.completedSeconds,3600);
  assert.equal(report.observations[0]!.unresolvedAgeSeconds,null);
  assert.equal(report.observations[1]!.completedSeconds,null);
  assert.equal(report.observations[1]!.unresolvedAgeSeconds,10800);
  assert.equal(report.observations[1]!.stage,"relevance-hold");
  assert.equal(report.historicalMissSeconds,8239.929);
  assert.equal(unresolved.discoveredAt,"2026-09-07T12:00:00.000Z");
});

test("scrapes, old fingerprints, unsupported decisions and unadmitted records cannot prove new-development timeliness", () => {
  for (const row of [
    {...observation(),candidateId:null},
    {...observation(),fingerprint:"changed"},
    {...observation(),milestone:{...observation().milestone!,citations:[]}},
    {...observation(),milestone:{...observation().milestone!,citations:[{url:"not-a-citation"}]}},
    {...observation(),milestone:{...observation().milestone!,recordedAt:"2026-09-06T12:00:00.000Z"}},
  ]) {
    const report=prospectivePolicyTiming([row],"2026-09-07T10:00:00.000Z","2026-09-07T15:00:00.000Z");
    assert.equal(report.observations[0]!.completedSeconds,null);
  }
  const row={...observation(),newDevelopmentEvidence:[]};
  assert.equal(prospectivePolicyTiming([row],"2026-09-07T10:00:00.000Z","2026-09-07T15:00:00.000Z").eligibleSamples,0);
  assert.equal(prospectivePolicyTiming([observation()],"2026-09-07T13:00:00.000Z","2026-09-07T15:00:00.000Z").observations[0]!.exclusion,"historical-discovery");
  assert.equal(prospectivePolicyTiming([observation()],"2026-09-07T13:00:00.000Z","2026-09-07T15:00:00.000Z").observations[0]!.completedSeconds,null);
  assert.equal(prospectivePolicyTiming([observation()],"2026-09-07T13:00:00.000Z","2026-09-07T15:00:00.000Z").observations[0]!.meetsTwoHours,null);
  assert.throws(()=>prospectivePolicyTiming([row,row],"2026-09-07T10:00:00.000Z","2026-09-07T15:00:00.000Z"),/Duplicate/);
});

test("prospective SQL executes on schema 0027 and cannot lend a milestone to another version or fingerprint", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const migrations = new URL("../migrations/",import.meta.url);
    for (const name of readdirSync(migrations).filter(n=>n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(name,migrations),"utf8"));
    const sql=readFileSync(new URL("../docs/evidence/policy-prospective-timing.sql",import.meta.url),"utf8");
    assert.equal(db.prepare(sql).all().length,0);
    db.exec(`INSERT INTO ingest_runs (id,started_at,state,item_count) VALUES ('run','2026-09-07T12:00:00.000Z','succeeded',1);
      INSERT INTO policy_instruments VALUES ('bill','PA','2025-2026','HB 1','Bill','https://palegis.us/bill','PN 2','amended','2026-09-01T12:00:00.000Z','2026-09-07T12:00:00.000Z');
      INSERT INTO policy_versions (id,instrument_row_id,version_id,stage,development_at,source_url,first_seen_at,last_seen_at)
      VALUES ('old','bill','PN 1','amended','2026-09-01T00:00:00.000Z','https://palegis.us/bill','2026-09-01T12:00:00.000Z','2026-09-07T12:00:00.000Z'),
             ('new','bill','PN 2','amended','2026-09-07T00:00:00.000Z','https://palegis.us/bill','2026-09-07T12:00:00.000Z','2026-09-07T12:00:00.000Z');`);
    db.prepare(`INSERT INTO content_candidates (id,fingerprint,kind,title,source_origin,item_status,queue_status,content_json,first_seen_at,last_seen_at,last_run_id)
      VALUES ('candidate','current-fp','policy','Bill','official','review','review',?,'2026-09-01T12:00:00.000Z','2026-09-07T12:00:00.000Z','run')`).run(JSON.stringify({policyIdentity:{jurisdiction:'PA',session:'2025-2026',instrumentId:'HB 1',versionId:'PN 2',stage:'amended',developmentAt:'2026-09-07T00:00:00.000Z'}}));
    db.exec(`INSERT INTO official_source_candidates (id,source_id,category,region,title,url,source_page_url,source_name,trust,discovered_at,last_seen_at,status,instruction_like,content_item_id)
      VALUES ('discovery','source','policy','PA','Bill','https://palegis.us/bill','https://palegis.us/bill','PA','regulatory','2026-09-01T12:00:00.000Z','2026-09-07T12:00:00.000Z','review',0,'candidate');
      INSERT INTO policy_review_milestones VALUES ('candidate','old-fp','blocker','old-rule','2026-09-01T00:00:00.000Z','["https://palegis.us/bill"]','2026-09-01T13:00:00.000Z');`);
    let rows = db.prepare(sql).all();
    assert.equal(rows[0]!.candidate_id,null);
    assert.equal(rows[1]!.recorded_at,null);
    assert.equal(rows[1]!.discovered_at,'2026-09-07T12:00:00.000Z');
    db.exec(`INSERT INTO policy_review_milestones VALUES ('candidate','current-fp','blocker','evidence-required','2026-09-07T00:00:00.000Z','["https://palegis.us/bill"]','2026-09-07T13:00:00.000Z');`);
    rows = db.prepare(sql).all();
    assert.equal(rows[0]!.recorded_at,null);
    assert.equal(rows[1]!.rule,'evidence-required');
    assert.equal(rows[1]!.processing_stage,'editorial-milestone');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM policy_review_milestones').get()!.n,2);
  } finally { db.close(); }
});
