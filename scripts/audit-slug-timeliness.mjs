// Offline analysis only. Input is a restricted, read-only D1 audit receipt.
import { readFileSync } from 'node:fs';
import { publicationSlug } from '../src/ingest/event-parser.ts';
import { canonicalPath } from '../src/lib/canonical.ts';
import { evaluateCandidate } from '../src/ingest/editor.ts';
const receipt = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const rows = name => receipt.d1[name].flatMap(r => r.results);
const candidates = rows('identities').map(r => ({ id:r.id, item:JSON.parse(r.content_json) }));
const published = rows('published').map(r => ({ id:r.candidate_id, item:JSON.parse(r.content_json) }));
const catalog = JSON.parse(readFileSync(new URL('../fixtures/catalog.json',import.meta.url),'utf8'));
const bundled = (Array.isArray(catalog) ? catalog : catalog.items).map(item=>({id:item.id,item}));
const paths = new Map();
for (const row of [...candidates,...published,...bundled]) {
  const path=canonicalPath(row.item);
  paths.set(path,new Set([...(paths.get(path)??[]),row.id]));
}
const changes = candidates.filter(r=>r.id.startsWith('official-ofs-') || r.item.kind === 'event').flatMap(({id,item})=>{
  const slug=publicationSlug(item.slug);
  if (slug===item.slug) return [];
  const corrected={...item,slug};
  const path=canonicalPath(corrected);
  return [{id,oldSlug:item.slug,newSlug:slug,path,
    collisions:[...(paths.get(path)??[])].filter(other=>other!==id),
    published:published.some(r=>r.id===id),
    correctedRule:evaluateCandidate(corrected,null,new Date(receipt.capturedAt)).rule}];
});
for (const row of changes) row.proposedCollisions=changes.filter(other=>other.id!==row.id&&other.path===row.path).map(other=>other.id);
const collisionFree = changes.every(row=>!row.collisions.length && !row.proposedCollisions.length);
if (!collisionFree) process.exitCode = 1; // Block repair/release review; never silently assign another identity.
const timings = rows('discoveries').map(r=>({
  ...r,
  dispositionSeconds:r.recorded_at?(Date.parse(r.recorded_at)-Date.parse(r.discovered_at))/1000:null,
  unresolvedAgeSeconds:r.recorded_at?null:(Date.parse(receipt.capturedAt)-Date.parse(r.discovered_at))/1000,
}));
const cohort = timings.filter(r=>Date.parse(r.discovered_at)>=Date.parse(receipt.start));
console.log(JSON.stringify({capturedAt:receipt.capturedAt,build:receipt.health.buildSha,
  changes,collisionFree,cohort,cohortSize:new Set(cohort.map(r=>r.id)).size,
  historicalCompleted:timings.filter(r=>r.recorded_at && Date.parse(r.discovered_at)<Date.parse(receipt.start)),
  historicalUnresolved:timings.filter(r=>!r.recorded_at && Date.parse(r.discovered_at)<Date.parse(receipt.start)),
  observationSeconds:(Date.parse(receipt.capturedAt)-Date.parse(receipt.start))/1000,
  historicalMissSeconds:8239.929,historicalExcessSeconds:1039.929,
  sustainedAcceptance:'not established; retain unresolved rows and repeat read-only sampling across natural cycles',
  mutation:false},null,2));
