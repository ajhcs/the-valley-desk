// Offline report from an unmodified Wrangler --json SELECT result. No network.
import { readFileSync } from 'node:fs';
import { prospectivePolicyTiming } from '../src/ingest/policy-background.ts';
const [input,start,asOf,qualification] = process.argv.slice(2);
if (!input || !start || !asOf) throw Error('Usage: report-policy-timing.mjs query.json start-UTC observation-UTC [new-development-evidence.json]');
const result = JSON.parse(readFileSync(input,'utf8'));
if (!Array.isArray(result) || result.some(r=>r.success===false)) throw Error('Successful Wrangler JSON results required');
const rows = result.flatMap(r=>r.results ?? []);
// Explicit reviewer evidence, keyed by durable development ID. Never inferred
// from a changed page hash, new slug, latest scrape, or mere lack of a milestone.
const qualified = qualification ? JSON.parse(readFileSync(qualification,'utf8')) : {};
const observations = rows.map(r=>({
  developmentId:r.development_id, discoveredAt:r.discovered_at, candidateId:r.candidate_id,
  fingerprint:r.fingerprint, stage:r.processing_stage,
  milestone:r.recorded_at ? {fingerprint:r.milestone_fingerprint,outcome:r.outcome,rule:r.rule,
    citations:JSON.parse(r.citations_json),recordedAt:r.recorded_at} : null,
  newDevelopmentEvidence:qualified[r.development_id] ?? [],
}));
console.log(JSON.stringify({...prospectivePolicyTiming(observations,start,asOf),
  input, qualification:qualification??null,
  newlyObservedDevelopmentIds:rows.filter(r=>Date.parse(r.discovered_at)>=Date.parse(start)).map(r=>r.development_id),
  detectionTimeliness:'Not computed: source action dates alone do not establish precise first-public times.',
  historicalMissProvenance:'Preserved release benchmark: 2026-09-06T21:45:25.738Z to 2026-09-07T00:02:45.667Z; not recomputed from slug-specific milestones.'},null,2));
