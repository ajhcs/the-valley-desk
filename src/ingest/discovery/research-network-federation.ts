import { classifyGithubUrl } from './research-map-import.ts';

export type Observation = { id: string; batch: string; kind: string; url?: string | null; nativeId?: string | null; observedDate?: string | null; fields: Record<string, unknown> };
export type ReportedNode = { id: string; type: string; label: string; url?: string | null; sourcePointer: string };
export type ReportedEdge = { id: string; source: string; target: string; relationship: string; evidenceUrl?: string | null; reportedConfidence?: string | null; status: string; sourcePointer: string };
const validDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** Federation is a review index of reported observations, never an identity or publication decision. */
export function federate(observations: Observation[], nodes: ReportedNode[], edges: ReportedEdge[]) {
  const seen = new Set<string>(), aliases = new Map<string, string>(), idAliases = new Map<string, string>();
  const accounts = new Map<string, string[]>(), repositories = new Map<string, { nativeId: string | null; observations: string[] }>();
  const queue: Array<Observation & { urlKind: string; repositoryKey: string | null; accountKey: string | null; publicationAuthorized: false }> = [];
  const allowedFields = new Set('censusStatus nativeRepositoryCount reportedContext existingSourcePointer nextAction existing fork archived novelty projectAttribution status reportedRepositoryCount failure sourcePointer reportedCategory reportedEvidenceUrls context createdAt updatedAt pushedAt spdxId articleId mechanicalFlags sourceRow sourceOccurrences occurrenceCount withheldUrlSha256 urlDisposition targetShape inputFile inputRow observationDateBasis account entity reportedAffiliation sourceUrl sourceKind regionalPolicy county currentRole identityBasis relationQualification reportedFork reportedArchived reportedLastPushUtc reportedAttribution urlKind kind reportedCount reportedError state reportedHttpStatus reportedResolvedUrl reportedReason reportedCheckedUtc reportedConfirmedParent reportedApiParent reportedProposedUpstream reportedDescription repository name reportedPerson reportedRelationship evidenceUrl evidenceUrls reportedLookup subject reportedClassification reportedStatus pmcid reportedOutcome classification type label reportedLabel relationship reportedConnectionType timeScope regionPolicy sourceRefs currentAffiliationVerified ownershipVerified'.split(' '));
  const forbidden = /^(?:abstract|fulltext|fullText|contact|email|orcid|articleText)$/i;
  const safeValue = (v: unknown): boolean => v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (Array.isArray(v) && v.every(safeValue)) || (typeof v === 'object' && v !== null && Object.entries(v).every(([k, x]) => !forbidden.test(k) && safeValue(x)));
  for (const o of observations) {
    if (!o || typeof o.id !== 'string' || typeof o.batch !== 'string' || !o.batch || typeof o.kind !== 'string' || !o.kind || (o.url != null && typeof o.url !== 'string') || (o.nativeId != null && (typeof o.nativeId !== 'string' || !o.nativeId)) || (o.observedDate != null && (typeof o.observedDate !== 'string' || !o.observedDate)) || !o.fields || typeof o.fields !== 'object' || Array.isArray(o.fields) || Object.keys(o).some(k => !['id','batch','kind','url','nativeId','observedDate','fields'].includes(k)) || Object.entries(o.fields).some(([k,v]) => !allowedFields.has(k) || !safeValue(v))) throw new Error('Invalid observation schema');
    if (!o.id.startsWith(`${o.batch}:`)) throw new Error('Observation namespace mismatch');
    const bools = new Set('existing fork archived reportedFork reportedArchived reportedConfirmedParent currentAffiliationVerified ownershipVerified'.split(' '));
    const nums = new Set('nativeRepositoryCount reportedRepositoryCount inputRow sourceRow occurrenceCount reportedCount reportedHttpStatus'.split(' '));
    const arrays = new Set('reportedEvidenceUrls evidenceUrls sourceRefs'.split(' '));
    for (const [key, value] of Object.entries(o.fields)) {
      if (value == null) continue;
      if (bools.has(key) ? typeof value !== 'boolean' : nums.has(key) ? typeof value !== 'number' || !Number.isInteger(value) : arrays.has(key) ? !Array.isArray(value) || value.some(x => typeof x !== 'string') : ['reportedContext','mechanicalFlags','sourceOccurrences'].includes(key) ? false : typeof value !== 'string') throw new Error(`Invalid field type: ${key}`);
      if (key === 'reportedContext' && (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k=>!['groupLabel','associationKind','qualification','evidenceUrls','researchReportPointer','currentAffiliationVerified','status'].includes(k)))) throw new Error('Invalid reported context');
      if (key === 'reportedContext' && Object.entries(value as Record<string, unknown>).some(([k,v]) => k === 'currentAffiliationVerified' ? v !== false : k === 'evidenceUrls' ? !Array.isArray(v) || v.some(x=>typeof x !== 'string') : typeof v !== 'string' || !v)) throw new Error('Invalid reported context fields');
      if (key === 'mechanicalFlags' && (typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([k,v])=>!['firstAuthorMentionsJefferson','anyAuthorMentionsJefferson','availabilityLanguage'].includes(k) || typeof v !== 'boolean'))) throw new Error('Invalid mechanical flags');
      if (key === 'sourceOccurrences' && (!Array.isArray(value) || value.some(v=>!v || typeof v !== 'object' || Object.keys(v).some(k=>!['jsonlRecord','linkIndex'].includes(k)) || !Number.isInteger(v.jsonlRecord) || !Number.isInteger(v.linkIndex)))) throw new Error('Invalid source occurrences');
    }
    if (!o.id || seen.has(o.id)) throw new Error(`Duplicate source observation: ${o.id}`);
    seen.add(o.id);
    for (const key of ['createdAt','updatedAt','pushedAt','reportedLastPushUtc']) { const value = o.fields[key]; if (value != null && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/.test(value) || !validDay(value.slice(0,10)) || !Number.isFinite(Date.parse(value)))) throw new Error(`Invalid source timestamp: ${o.id}`); }
    if (o.fields.reportedCheckedUtc && (typeof o.fields.reportedCheckedUtc !== 'string' || !validDay(o.fields.reportedCheckedUtc))) throw new Error(`Invalid source date: ${o.id}`);
    if (o.observedDate && !validDay(o.observedDate)) throw new Error(`Invalid observation date: ${o.id}`);
    const parsed = classifyGithubUrl(o.url ?? '');
    if (o.nativeId && (!/^[1-9]\d*$/.test(o.nativeId) || parsed.kind !== 'repository-url')) throw new Error(`Invalid native repository: ${o.id}`);
    if (parsed.kind === 'account-url') accounts.set(parsed.accountKey!, [...(accounts.get(parsed.accountKey!) ?? []), o.id]);
    if (parsed.kind === 'repository-url' && (o.kind === 'repository' || o.nativeId)) {
      const key = parsed.repositoryKey!, prior = repositories.get(key);
      if (o.nativeId) {
        const oldId = aliases.get(key), oldAlias = idAliases.get(o.nativeId);
        if ((oldId && oldId !== o.nativeId) || (oldAlias && oldAlias !== key)) throw new Error(`Conflicting repository identity: ${o.id}`);
        aliases.set(key, o.nativeId); idAliases.set(o.nativeId, key);
      }
      repositories.set(key, { nativeId: o.nativeId ?? prior?.nativeId ?? null, observations: [...(prior?.observations ?? []), o.id] });
    }
    queue.push({ ...o, urlKind: parsed.kind, repositoryKey: parsed.repositoryKey, accountKey: parsed.accountKey, publicationAuthorized: false });
  }
  const nodeIds = new Set<string>();
  const graphNodes = nodes.map(n => { if (!n || typeof n.id !== 'string' || !n.id.startsWith('cooper:') || typeof n.type !== 'string' || typeof n.label !== 'string' || typeof n.sourcePointer !== 'string' || !n.sourcePointer || (n.url != null && typeof n.url !== 'string') || Object.keys(n).some(k => !['id','type','label','url','sourcePointer'].includes(k))) throw new Error('Invalid graph node'); if (!n.id || nodeIds.has(n.id)) throw new Error(`Duplicate graph node: ${n.id}`); nodeIds.add(n.id); return { ...n, publicationAuthorized: false as const }; });
  const edgeIds = new Set<string>();
  const graphEdges = edges.map(e => { if (!e || typeof e.id !== 'string' || !e.id.startsWith('cooper:') || typeof e.source !== 'string' || !e.source.startsWith('cooper:') || typeof e.target !== 'string' || !e.target.startsWith('cooper:') || typeof e.relationship !== 'string' || !e.relationship || typeof e.status !== 'string' || e.status !== 'source_reported_not_independently_verified' || typeof e.sourcePointer !== 'string' || !e.sourcePointer || (e.evidenceUrl != null && typeof e.evidenceUrl !== 'string') || (e.reportedConfidence != null && typeof e.reportedConfidence !== 'string') || Object.keys(e).some(k => !['id','source','target','relationship','evidenceUrl','reportedConfidence','status','sourcePointer'].includes(k))) throw new Error('Invalid graph edge'); if (!e.id || edgeIds.has(e.id)) throw new Error(`Duplicate graph edge: ${e.id}`); if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) throw new Error(`Missing graph endpoint: ${e.id}`); edgeIds.add(e.id); return { ...e, publicationAuthorized: false as const }; });
  return { accounts: [...accounts].sort(([a], [b]) => a.localeCompare(b)).map(([key, observationIds]) => ({ key, observationIds })), repositories: [...repositories].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, ...value })), observations: queue, nodes: graphNodes, edges: graphEdges };
}
