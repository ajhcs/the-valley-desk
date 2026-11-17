import { federate, type Observation, type ReportedNode, type ReportedEdge } from './research-network-federation.ts';

const schemas: Record<string, Record<string, string>> = {
  drexel: {
    accounts: 'account publicationAuthorized reportedContext reviewState sourceRef',
    repositories: 'account archived created_at description fetched_at_utc fork health_relevance lab license publicationAuthorized pushed_at repository reviewState sourceRef updated_at url',
    projects: 'affiliation_evidence_or_grade canonical_repository evidence_urls independent_audit_report institutional_ownership is_archived is_fork project_health_relevance project_or_paper_title publicationAuthorized record_type repository_mentioned repository_root_url reviewState root_availability root_checked_at_utc sourceRef source_file source_id',
    studentAssociations: 'canonical_repository companion_or_copy_note evidence_grade_as_reported evidence_urls is_fork_at_check project_or_topic publicationAuthorized repository_mentioned repository_url reviewState root_availability root_checked_at_utc sourceRef source_file student_identity_and_project_scope',
    statuses: 'article_ids availability canonical_name canonical_url checked_at_utc created_at health_relevance is_archived is_fork license_spdx project_attribution publicationAuthorized pushed_at requested_repository requested_root_url resolution_note resolution_report reviewState reviewed_correction_url sourceRef source_files updated_at',
    publicationSearch: 'article_url authors doi github_urls journal pmcid publicationAuthorized reviewState sourceRef status title year',
    studentVerified: 'affiliation_evidence_urls availability_ledger_matching_names availability_ledger_status evidence_grade historical_public_access hosting latest_is_fork latest_root_checked_at_utc latest_root_status project_evidence_urls project_url publicationAuthorized repository reviewState sourceRef topic',
    studentReview: 'github_public_at_search independent_attribution publicationAuthorized readme_status reportedReviewLabel repository reviewState review_report sourceRef url',
    publicationReview: 'article_url attribution_and_availability authors pmcid publicationAuthorized reportedReviewGithubLinks reportedReviewLabel reviewState review_report sourceRef source_mentions title year',
    expandedPublicationReview: 'attribution_and_availability authors doi id pmcid publicationAuthorized reviewState review_report source sourceRef title year',
    forkReview: 'different_default_head_count fork_count identical_default_head_count parent_repository parent_url publicationAuthorized reviewState review_report sourceRef',
  },
  villanova: {
    accounts: 'currentAffiliationVerified evidenceUrls handle id nativeId ownershipVerified publicationAuthorized reportedAccountType reportedContext reportedSections sourceRefs url',
    projects: 'currentAffiliationVerified currentInstitutionalOwnership evidenceUrls healthPurposeStatus id nativeId ownershipVerified publicationAuthorized reportedRelationship reportedSections sourceRefs url',
    externalResources: 'evidenceUrls nativeId publicationAuthorized purpose resourceType sourceRefs url',
    professionalOccurrences: 'accountOwnershipEstablished currentAffiliation name nativeId publicationAuthorized reportedProfessionalContext sourceRefs',
    sourceObservations: 'sourceRefs statement subject',
    citations: 'sourceRef url',
  },
};
const listFields = new Set(['sourceRefs','evidenceUrls','reportedSections','reportedReviewGithubLinks']);
const falseFields = new Set(['publicationAuthorized','currentAffiliationVerified','ownershipVerified','accountOwnershipEstablished']);
const nullFields = new Set(['nativeId','currentAffiliation','currentInstitutionalOwnership']);
const timestampFields = new Set(['created_at','updated_at','pushed_at','fetched_at_utc','root_checked_at_utc','checked_at_utc','latest_root_checked_at_utc']);
const boolText = new Set(['fork','archived','is_fork','is_archived','is_fork_at_check','latest_is_fork','github_public_at_search']);
function validDate(value: string): boolean {
  const m = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|\+00:00)$/.exec(value);
  if (!m) return false;
  const date = new Date(`${m[1]}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0,10) === m[1] && Number.isFinite(Date.parse(value));
}
export function validateRows(batch: 'drexel'|'villanova', group: string, rows: unknown): Record<string, any>[] {
  const schema = schemas[batch][group]; if (!schema || !Array.isArray(rows)) throw Error('Unexpected source group');
  const keys = new Set(schema.split(' '));
  return rows.map((row: any) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || (Object.keys(row).some(k=>!keys.has(k)) || Object.keys(row).length !== keys.size)) throw Error(`Unexpected ${batch} ${group} field`);
    for (const [key,value] of Object.entries(row)) {
      if (key === 'sourceRef' && batch === 'villanova' && group === 'citations') { if (typeof value !== 'string' || !/^README\.md#L[1-9]\d*(?:-L[1-9]\d*)?$/.test(value)) throw Error('Invalid citation reference'); }
      else if (key === 'sourceRef') {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'file,row' || typeof (value as any).file !== 'string' || !/^[A-Za-z0-9_.-]+$/.test((value as any).file) || !Number.isInteger((value as any).row) || (value as any).row < 1) throw Error('Invalid source reference');
      } else if (falseFields.has(key)) { if (value !== false) throw Error('Unexpected authority or verification'); }
      else if (nullFields.has(key)) { if (value !== null) throw Error('Unexpected identity or current role'); }
      else if (listFields.has(key)) { if (!Array.isArray(value) || value.some(x=>typeof x !== 'string' || !x)) throw Error('Invalid list'); if (['evidenceUrls','reportedReviewGithubLinks'].includes(key) && value.some(x=>{ try { const u = new URL(x); return u.protocol !== 'https:' || !!u.username || !!u.password || /\s/.test(x); } catch { return true; } })) throw Error('Invalid evidence URL'); }
      else if (value !== null && typeof value !== 'string') throw Error(`Invalid field type: ${key}`);
      if (typeof value === 'string' && /^https?:\/\//i.test(value) && !/\s/.test(value)) { try { const u = new URL(value); if (u.username || u.password) throw Error('URL credentials forbidden'); } catch (e) { if (e instanceof Error && e.message === 'URL credentials forbidden') throw e; } }
      if (typeof value === 'string' && timestampFields.has(key) && !validDate(value)) throw Error(`Invalid source timestamp: ${key}`);
      if (typeof value === 'string' && boolText.has(key) && !/^(?:true|false)$/i.test(value)) throw Error(`Invalid reported boolean: ${key}`);
    }
    const required = batch === 'drexel' ? ({accounts:['account'],repositories:['url'],statuses:['requested_root_url']} as Record<string,string[]>)[group] : ({accounts:['id','url'],projects:['id','url'],externalResources:['url'],professionalOccurrences:['name'],sourceObservations:['subject','statement'],citations:['url']} as Record<string,string[]>)[group];
    if (required?.some(k=>typeof row[k] !== 'string' || !row[k])) throw Error('Missing source identity or URL');
    if (batch === 'drexel' && (!row.sourceRef || row.publicationAuthorized !== false || row.reviewState !== 'source_reported_unreviewed')) throw Error('Invalid Drexel source row');
    if (batch === 'villanova' && group !== 'citations' && (!Array.isArray(row.sourceRefs) || !row.sourceRefs.length || row.sourceRefs.some((s: string)=>!/^README\.md#L[1-9]\d*(?:-L[1-9]\d*)?$/.test(s)))) throw Error('Invalid Villanova references');
    if (batch === 'villanova' && ['accounts','projects','externalResources','professionalOccurrences'].includes(group) && row.publicationAuthorized !== false) throw Error('Invalid Villanova authority');
    return row;
  });
}
export function expand(oldObservations: Observation[], oldNodes: ReportedNode[], oldEdges: ReportedEdge[], added: Observation[]) {
  return federate([...oldObservations,...added], oldNodes, oldEdges);
}
