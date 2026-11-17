import { z } from 'zod';

// Structural contract only: GL04 must reconstruct observations and validate review authority.
const Id = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Text = z.string().min(1).max(1000).refine(v => !/[\u0000-\u001f\u007f]/.test(v) && v.trim() === v);
const Url = z.string().max(2048).refine(v => {
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && !/[\s\\\u0000-\u001f\u007f]/.test(v); }
  catch { return false; }
}, 'HTTPS source link required');
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v && !v.startsWith('0000');
});
const AsOf = z.discriminatedUnion('precision', [
  z.object({ precision: z.literal('year'), value: z.string().regex(/^(?!0000)\d{4}$/) }).strict(),
  z.object({ precision: z.literal('month'), value: z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/) }).strict(),
  z.object({ precision: z.literal('day'), value: Day }).strict(),
]);
const Pointer = z.string().max(1000).regex(/^(?:\/(?:[^~]|~[01])*)?$/).refine(v => !/[\u0000-\u001f\u007f]/.test(v));
const Kind = z.enum(['repository', 'publication', 'preprint', 'discussion', 'project']);
export const DIRECTORY_TOPIC_REVISION = 'directory-topics-v1' as const;
export const DIRECTORY_TOPICS = ['medical-imaging', 'sleep', 'machine-learning', 'clinical-informatics', 'biomedical-data', 'assistive-technology', 'public-health'] as const;
export const DIRECTORY_TOPIC_ALIASES: Readonly<Record<string, readonly (typeof DIRECTORY_TOPICS)[number][]>> = Object.freeze({
  ai: Object.freeze(['machine-learning'] as const),
});
const Evidence = z.object({
  id: Id, sourceUrl: Url, observedDate: Day, observationSha256: Hash,
  pointer: Pointer, method: z.enum(['provider-metadata', 'primary-web-rendering', 'primary-indexed-rendering', 'reviewed-observation']),
}).strict();
const NativeText = z.object({ value: Text, evidenceId: Id }).strict();
const NativeUrl = z.object({ value: Url, evidenceId: Id }).strict();
const EvidenceIds = z.array(Id).min(1).max(20).refine(a => new Set(a).size === a.length);
const Reviewed = { id: Id, subjectId: Id, evidenceIds: EvidenceIds, reviewId: Id };
const HealthClaim = z.object({ ...Reviewed, kind: z.literal('health-purpose'), text: Text }).strict();
const TopicClaim = z.object({ ...Reviewed, kind: z.literal('topic'), topic: z.enum(DIRECTORY_TOPICS), vocabularyRevision: z.literal(DIRECTORY_TOPIC_REVISION) }).strict();
const RegionClaim = z.object({
  ...Reviewed, kind: z.literal('regional-connection'), institution: Text.max(400).nullable(), campus: Text.max(400).nullable(),
  municipality: Text.max(400).nullable(), state: z.enum(['PA', 'NJ']), regionalBasis: z.enum(['county', 'municipality', 'campus']), county: z.enum(['Bucks', 'Chester', 'Delaware', 'Montgomery', 'Philadelphia', 'Burlington', 'Camden', 'Gloucester', 'Mercer']).nullable(),
  asOf: AsOf, subjectRole: z.enum(['work', 'author-affiliation', 'account-association', 'project-association']),
  subjectLabel: Text.max(400), sourceAuthorIndex: z.number().int().min(0).max(1000).nullable(),
  affiliationEvidenceIds: EvidenceIds, geographyEvidenceIds: EvidenceIds,
  scope: z.enum(['historical', 'observed', 'unknown-currentness']), qualification: Text.max(400),
}).strict();
const Claim = z.discriminatedUnion('kind', [HealthClaim, TopicClaim, RegionClaim]);
const Relation = z.object({ id: Id, fromId: Id, toId: Id, predicate: z.enum(['repository-cites-work', 'work-links-repository']), evidenceIds: EvidenceIds, reviewId: Id }).strict();
const Namespace = Url.refine(v => { try { const u = new URL(v); return !u.hash && !u.search; } catch { return false; } }, 'installation namespace cannot contain query or fragment');
const NativeIdentity = z.object({ provider: z.enum(['github', 'crossref', 'pubmed', 'arxiv', 'other']), namespace: Namespace.nullable(), nativeId: Text.max(300), evidenceId: Id }).strict();
function identityKey(identity: z.infer<typeof NativeIdentity>): string | null {
  const raw = identity.provider === 'other' ? identity.nativeId : identity.nativeId.normalize('NFKC');
  if ((identity.provider === 'other') !== (identity.namespace !== null)) return null;
  if (identity.provider === 'github' || identity.provider === 'pubmed') return /^[1-9]\d*$/.test(raw) ? `${identity.provider}:${raw}` : null;
  if (identity.provider === 'crossref') { const doi = raw.replace(/^https:\/\/doi\.org\//i, '').toLowerCase(); return /^10\.\d{4,9}\/[^\s]+$/.test(doi) ? `doi:${doi}` : null; }
  if (identity.provider === 'arxiv') { const id = raw.replace(/^https:\/\/arxiv\.org\/abs\//i, '').toLowerCase(); return /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7})(?:v[1-9]\d*)?$/.test(id) ? `arxiv:${id}` : null; }
  try { return JSON.stringify(['other', new URL(identity.namespace!).href, raw]); } catch { return null; }
}
const Owner = z.object({ name: Text.max(300), kind: z.enum(['User', 'Organization', 'other']), nativeId: Text.max(300).nullable(), evidenceId: Id }).strict();
const WorkObject = z.object({
  schemaVersion: z.literal('discovery-directory-work-v1'), id: Id, revision: z.number().int().safe().positive(), kind: Kind,
  nativeIdentity: NativeIdentity.nullable(), title: NativeText, url: NativeUrl, description: NativeText.nullable(),
  owner: Owner.nullable(), sourceDate: z.object({ value: AsOf, evidenceId: Id }).strict().nullable(), checkedAt: Day,
  evidence: z.array(Evidence).min(1).max(100), reviewRefs: z.array(z.object({ id: Id, receiptSha256: Hash }).strict()).min(1).max(100), claims: z.array(Claim).min(2).max(100), relations: z.array(Relation).max(100),
}).strict();
export const DirectoryWorkSchema = WorkObject.superRefine((work, ctx) => {
  const evidence = new Set(work.evidence.map(e => e.id));
  if (work.evidence.some(e => e.observedDate > work.checkedAt)) ctx.addIssue({ code: 'custom', message: 'observation after checked date' });
  const unique = (ids: string[], label: string) => { if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: `duplicate ${label}` }); };
  unique(work.evidence.map(e => e.id), 'evidence'); unique(work.reviewRefs.map(r => r.id), 'review reference'); unique(work.claims.map(c => c.id), 'claim'); unique(work.relations.map(r => r.id), 'relation');
  const reviews = new Set(work.reviewRefs.map(r => r.id));
  const review = (id: string) => { if (!reviews.has(id)) ctx.addIssue({ code: 'custom', message: 'missing review reference' }); };
  const ref = (id: string) => { if (!evidence.has(id)) ctx.addIssue({ code: 'custom', message: 'missing evidence reference' }); };
  if (work.nativeIdentity && identityKey(work.nativeIdentity) === null) ctx.addIssue({ code: 'custom', message: 'invalid native identity' });
  [work.title.evidenceId, work.url.evidenceId, work.description?.evidenceId, work.owner?.evidenceId, work.nativeIdentity?.evidenceId, work.sourceDate?.evidenceId].forEach(id => { if (id) ref(id); });
  if (!work.claims.some(c => c.kind === 'health-purpose') || !work.claims.some(c => c.kind === 'regional-connection')) ctx.addIssue({ code: 'custom', message: 'health and regional claims required' });
  for (const claim of work.claims) {
    if (claim.subjectId !== work.id) ctx.addIssue({ code: 'custom', message: 'claim subject mismatch' });
    claim.evidenceIds.forEach(ref); review(claim.reviewId);
    if (claim.kind === 'regional-connection') {
      const pa = ['Bucks', 'Chester', 'Delaware', 'Montgomery', 'Philadelphia'];
      const nj = ['Burlington', 'Camden', 'Gloucester', 'Mercer'];
      if (claim.county !== null && !(claim.state === 'PA' ? pa : nj).includes(claim.county)) ctx.addIssue({ code: 'custom', message: 'county state mismatch' });
      if (claim.regionalBasis === 'county' && !claim.county || claim.regionalBasis === 'municipality' && !claim.municipality || claim.regionalBasis === 'campus' && (!claim.institution || !claim.campus)) ctx.addIssue({ code: 'custom', message: 'missing regional basis' });
      if ((claim.subjectRole === 'author-affiliation') !== (claim.sourceAuthorIndex !== null)) ctx.addIssue({ code: 'custom', message: 'source author index mismatch' });
      for (const id of [...claim.affiliationEvidenceIds, ...claim.geographyEvidenceIds]) {
        ref(id); if (!claim.evidenceIds.includes(id)) ctx.addIssue({ code: 'custom', message: 'regional evidence role not bound to claim' });
      }
    }
  }
  for (const relation of work.relations) {
    if (relation.fromId !== work.id || relation.fromId === relation.toId) ctx.addIssue({ code: 'custom', message: 'relation source mismatch' });
    relation.evidenceIds.forEach(ref); review(relation.reviewId);
  }
});
export const DirectorySnapshotSchema = z.object({ schemaVersion: z.literal('discovery-directory-snapshot-v1'), version: Id, works: z.array(DirectoryWorkSchema).max(10000) }).strict().superRefine((snapshot, ctx) => {
  const works = new Map(snapshot.works.map(w => [w.id, w]));
  if (works.size !== snapshot.works.length) ctx.addIssue({ code: 'custom', message: 'duplicate work identity' });
  const relationIds = new Set<string>(), triples = new Set<string>(), nativeIds = new Set<string>(), claimIds = new Set<string>(), observations = new Map<string, string>(), reviews = new Map<string, string>();
  for (const w of snapshot.works) {
    if (w.nativeIdentity) { const key = identityKey(w.nativeIdentity); if (!key || nativeIds.has(key)) ctx.addIssue({ code: 'custom', message: 'duplicate native identity' }); if (key) nativeIds.add(key); }
    for (const ref of w.reviewRefs) { if (reviews.has(ref.id) && reviews.get(ref.id) !== ref.receiptSha256) ctx.addIssue({ code: 'custom', message: 'conflicting review reference' }); reviews.set(ref.id,ref.receiptSha256); }
    for (const c of w.claims) { if (claimIds.has(c.id)) ctx.addIssue({ code: 'custom', message: 'duplicate global claim identity' }); claimIds.add(c.id); }
    for (const e of w.evidence) { const canonical = JSON.stringify([e.sourceUrl,e.observedDate,e.observationSha256,e.pointer,e.method]); if (observations.has(e.id) && observations.get(e.id) !== canonical) ctx.addIssue({ code: 'custom', message: 'conflicting evidence identity' }); observations.set(e.id,canonical); }
    for (const r of w.relations) {
    const target = works.get(r.toId);
    const correct = r.predicate === 'repository-cites-work' ? w.kind === 'repository' && (target?.kind === 'publication' || target?.kind === 'preprint') : (w.kind === 'publication' || w.kind === 'preprint') && target?.kind === 'repository';
    if (!correct || relationIds.has(r.id)) ctx.addIssue({ code: 'custom', message: 'relation endpoint or identity mismatch' });
    relationIds.add(r.id); const triple = JSON.stringify([r.fromId,r.predicate,r.toId]); if (triples.has(triple)) ctx.addIssue({ code: 'custom', message: 'duplicate relation triple' }); triples.add(triple);
    }
  }
});
export type DirectoryWork = z.infer<typeof DirectoryWorkSchema>;
export type DirectorySnapshot = z.infer<typeof DirectorySnapshotSchema>;

export { Id as DirectoryIdSchema, Hash as DirectoryHashSchema, Text as DirectoryTextSchema, Url as DirectoryUrlSchema, Day as DirectoryDaySchema };
