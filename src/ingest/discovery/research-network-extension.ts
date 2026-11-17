import { federate, type Observation, type ReportedNode, type ReportedEdge } from './research-network-federation.ts';

// Frozen review contracts: independent of the manifests being validated.
const expectedPolicies: Record<string, Record<string, string[]>> = {
  "lehigh": {
    "initial/github-links.csv": [
      "area",
      "evidence_url",
      "github_url",
      "lab",
      "lead",
      "link_type",
      "notes",
      "urlDisposition"
    ],
    "initial/no-verified-lab-account-found.csv": [
      "lab_or_center",
      "lead",
      "source",
      "status"
    ],
    "initial/unavailable-or-unconfirmed.csv": [
      "lead",
      "observed_status",
      "project",
      "published_github_url",
      "source",
      "urlDisposition"
    ],
    "followup/combined-github-inventory.csv": [
      "evidence_url",
      "github_url",
      "lab_or_group",
      "link_type",
      "notes",
      "person_or_account",
      "urlDisposition"
    ],
    "followup/new-since-first-inventory.csv": [
      "evidence_url",
      "github_url",
      "lab_or_group",
      "link_type",
      "notes",
      "person_or_account",
      "urlDisposition"
    ],
    "followup/lab-account-repository-census.csv": [
      "account",
      "account_association",
      "archived",
      "created_at",
      "fork",
      "github_url",
      "lab",
      "license",
      "pushed_at",
      "repository",
      "updated_at",
      "urlDisposition"
    ],
    "followup/member-account-repository-census.csv": [
      "account",
      "account_attribution",
      "account_evidence",
      "archived",
      "created_at",
      "fork",
      "github_url",
      "lab_or_group",
      "license",
      "person",
      "pushed_at",
      "repository",
      "research_connection",
      "updated_at",
      "urlDisposition"
    ],
    "followup/publication-review-samples.csv": [
      "finding",
      "lab_or_group",
      "level_inspected",
      "paper_or_catalogue",
      "source_url",
      "urlDisposition"
    ],
    "followup/review-coverage.csv": [
      "lab_or_center",
      "limitations",
      "people_checked_or_identified",
      "roster_source",
      "urlDisposition",
      "work_checked"
    ],
    "followup/unavailable-or-unconfirmed.csv": [
      "lead",
      "observed_status",
      "project",
      "published_github_url",
      "source",
      "urlDisposition"
    ],
    "followup/non-github-code.csv": [
      "code_or_data_url",
      "lab_or_group",
      "paper_url",
      "urlDisposition"
    ],
    "followup/nonlive-manual-leads.csv": [
      "evidence_url",
      "github_url",
      "http_status",
      "lab_or_group",
      "link_type",
      "notes",
      "person_or_account",
      "urlDisposition"
    ]
  },
  "pcom": {
    "connected_account_repositories.csv": [
      "account",
      "account_relationship",
      "archived",
      "description",
      "fork",
      "language",
      "license",
      "pcom_research_attribution",
      "primaryUrlDisposition",
      "pushed_at",
      "repository"
    ],
    "connections.csv": [
      "area",
      "notes",
      "person_or_entity",
      "primaryUrlDisposition",
      "primary_evidence",
      "relationship",
      "year"
    ],
    "corpus_github_candidates.csv": [
      "authors",
      "classification",
      "github_url",
      "notes",
      "paper_title",
      "pmcid",
      "primaryUrlDisposition"
    ],
    "network_edges.csv": [
      "primaryUrlDisposition",
      "qualification",
      "relationship",
      "source",
      "target"
    ],
    "people_screened.csv": [
      "campuses",
      "name",
      "official_urls",
      "search_notes",
      "search_notes_truncated",
      "sourceCitationUrls",
      "source_files",
      "statuses"
    ],
    "account_snapshot.json": [
      "account_type",
      "listed_public_repos",
      "login",
      "primaryUrlDisposition",
      "public_repos",
      "relationship",
      "requested_account",
      "retrieved_at_utc"
    ]
  },
  "rowan": {
    "matched-repositories.csv": [
      "api_status",
      "archived",
      "association_evidence",
      "checked_at_utc",
      "created_at_utc",
      "fork_parent",
      "group_or_researcher",
      "is_fork",
      "last_push_at_utc",
      "ownership_relationship",
      "qualification",
      "repository",
      "urlDisposition"
    ],
    "matched-accounts.csv": [
      "account",
      "associated_groups",
      "association_evidence",
      "checked_at_utc",
      "github_account_type",
      "login",
      "matched_repository_count",
      "public_repository_count",
      "qualification",
      "repository_relationships",
      "urlDisposition"
    ],
    "account-repository-snapshot.csv": [
      "account",
      "account_relationship",
      "archived",
      "checked_at_utc",
      "created_at_utc",
      "is_fork",
      "last_push_at_utc",
      "repository",
      "urlDisposition"
    ],
    "unavailable-repositories.csv": [
      "api_status",
      "checked_at_utc",
      "paper",
      "qualification",
      "repository",
      "rowan_association",
      "urlDisposition"
    ],
    "epmc-screening-dispositions.csv": [
      "article_url",
      "disposition",
      "doi",
      "pmcid",
      "qualification",
      "title",
      "urlDisposition",
      "year"
    ],
    "epmc-remaining-1.csv": [
      "authorString",
      "doi",
      "pmcid",
      "pmid",
      "pubYear",
      "title"
    ],
    "epmc-remaining-2.csv": [
      "authorString",
      "doi",
      "pmcid",
      "pmid",
      "pubYear",
      "title"
    ],
    "epmc-remaining-3.csv": [
      "authorString",
      "doi",
      "pmcid",
      "pmid",
      "pubYear",
      "title"
    ],
    "epmc-remaining-4.csv": [
      "authorString",
      "doi",
      "pmcid",
      "pmid",
      "pubYear",
      "title"
    ],
    "snapshots/first-pass-20261116/matched-repositories.csv": [
      "api_status",
      "archived",
      "association_evidence",
      "checked_at_utc",
      "created_at_utc",
      "fork_parent",
      "group_or_researcher",
      "is_fork",
      "last_push_at_utc",
      "ownership_relationship",
      "qualification",
      "repository",
      "urlDisposition"
    ],
    "snapshots/first-pass-20261116/account-repository-snapshot.csv": [
      "account",
      "account_relationship",
      "archived",
      "checked_at_utc",
      "created_at_utc",
      "is_fork",
      "last_push_at_utc",
      "repository",
      "urlDisposition"
    ],
    "europe-pmc-results.json": [
      "authorString",
      "doi",
      "firstPublicationDate",
      "pmcid",
      "pmid",
      "pubYear",
      "title"
    ]
  },
  "scranton": {
    "README.md": [
      "reportedQualification"
    ],
    "build-inventory.py": [],
    "findings.md": [
      "reportedQualification"
    ],
    "labs-and-people.csv": [
      "evidence_url",
      "github_status",
      "name",
      "qualification",
      "relationship_to_scranton",
      "research_area",
      "type",
      "urlDisposition"
    ],
    "repositories.csv": [
      "connection_class",
      "evidence_urls",
      "id",
      "public_content_status",
      "qualification",
      "repository",
      "researched_date",
      "scranton_connection",
      "subject",
      "url",
      "urlDisposition"
    ],
    "research-trails.csv": [
      "attribution_limit",
      "evidence_urls",
      "id",
      "result",
      "trail"
    ],
    "search-notes.md": [
      "reportedQualification"
    ]
  },
  "sju": {
    "accounts.csv": [
      "account",
      "account_type",
      "connection",
      "evidence_urls",
      "identified_as",
      "limits",
      "primaryUrlDisposition",
      "snapshot_utc"
    ],
    "repositories.csv": [
      "description",
      "evidence_urls",
      "group",
      "limits",
      "people",
      "primaryUrlDisposition",
      "relationship",
      "repository",
      "snapshot_utc"
    ],
    "labs-checked.csv": [
      "evidence_urls",
      "finding",
      "group",
      "limits",
      "snapshot_utc"
    ],
    "link-checks.csv": [
      "checked_at_utc",
      "disposition",
      "final_url",
      "primaryUrlDisposition",
      "status"
    ]
  },
  "widener": {
    "README.md": [
      "reportedQualification"
    ],
    "repositories.csv": [
      "account_owner",
      "attribution_notes",
      "github_url",
      "project",
      "public_content",
      "relationship",
      "repository",
      "source_1",
      "source_2",
      "urlDisposition"
    ]
  }
};
const expectedFields: Record<string, Record<string, string[]>> = {
  "lehigh": {
    "initial/github-links.csv": [
      "area",
      "evidence_url",
      "github_url",
      "lab",
      "lead",
      "link_type",
      "notes"
    ],
    "initial/no-verified-lab-account-found.csv": [
      "lab_or_center",
      "lead",
      "source",
      "status"
    ],
    "initial/unavailable-or-unconfirmed.csv": [
      "lead",
      "observed_status",
      "project",
      "published_github_url",
      "source"
    ],
    "followup/combined-github-inventory.csv": [
      "evidence_url",
      "github_url",
      "lab_or_group",
      "link_type",
      "notes",
      "person_or_account"
    ],
    "followup/new-since-first-inventory.csv": [
      "evidence_url",
      "github_url",
      "lab_or_group",
      "link_type",
      "notes",
      "person_or_account"
    ],
    "followup/lab-account-repository-census.csv": [
      "account",
      "account_association",
      "archived",
      "created_at",
      "fork",
      "github_url",
      "lab",
      "license",
      "pushed_at",
      "repository",
      "updated_at"
    ],
    "followup/member-account-repository-census.csv": [
      "account",
      "account_attribution",
      "account_evidence",
      "archived",
      "created_at",
      "fork",
      "github_url",
      "lab_or_group",
      "license",
      "person",
      "pushed_at",
      "repository",
      "research_connection",
      "updated_at"
    ],
    "followup/publication-review-samples.csv": [
      "finding",
      "lab_or_group",
      "level_inspected",
      "paper_or_catalogue",
      "source_url"
    ],
    "followup/review-coverage.csv": [
      "lab_or_center",
      "limitations",
      "people_checked_or_identified",
      "roster_source",
      "work_checked"
    ],
    "followup/unavailable-or-unconfirmed.csv": [
      "lead",
      "observed_status",
      "project",
      "published_github_url",
      "source"
    ],
    "followup/non-github-code.csv": [
      "code_or_data_url",
      "lab_or_group",
      "paper_url"
    ]
  },
  "pcom": {
    "connected_account_repositories.csv": [
      "account",
      "account_relationship",
      "archived",
      "description",
      "fork",
      "language",
      "license",
      "pcom_research_attribution",
      "primaryUrlDisposition",
      "pushed_at",
      "repository"
    ],
    "connections.csv": [
      "area",
      "notes",
      "person_or_entity",
      "primaryUrlDisposition",
      "primary_evidence",
      "relationship",
      "year"
    ],
    "corpus_github_candidates.csv": [
      "authors",
      "classification",
      "github_url",
      "notes",
      "paper_title",
      "pmcid",
      "primaryUrlDisposition"
    ],
    "network_edges.csv": [
      "primaryUrlDisposition",
      "qualification",
      "relationship",
      "source",
      "target"
    ],
    "people_screened.csv": [
      "campuses",
      "name",
      "official_urls",
      "search_notes",
      "search_notes_truncated",
      "sourceCitationUrls",
      "source_files",
      "statuses"
    ],
    "account_snapshot.json": [
      "account_type",
      "listed_public_repos",
      "login",
      "primaryUrlDisposition",
      "public_repos",
      "relationship",
      "requested_account",
      "retrieved_at_utc"
    ]
  },
  "rowan": {
    "matched-repositories.csv": [
      "api_status",
      "archived",
      "association_evidence",
      "checked_at_utc",
      "created_at_utc",
      "fork_parent",
      "group_or_researcher",
      "is_fork",
      "last_push_at_utc",
      "ownership_relationship",
      "qualification",
      "repository"
    ],
    "matched-accounts.csv": [
      "account",
      "associated_groups",
      "association_evidence",
      "checked_at_utc",
      "github_account_type",
      "login",
      "matched_repository_count",
      "public_repository_count",
      "qualification",
      "repository_relationships"
    ],
    "account-repository-snapshot.csv": [
      "account",
      "account_relationship",
      "archived",
      "checked_at_utc",
      "created_at_utc",
      "is_fork",
      "last_push_at_utc",
      "repository"
    ],
    "unavailable-repositories.csv": [
      "api_status",
      "checked_at_utc",
      "paper",
      "qualification",
      "repository",
      "rowan_association"
    ],
    "epmc-screening-dispositions.csv": [
      "article_url",
      "disposition",
      "doi",
      "pmcid",
      "qualification",
      "title",
      "year"
    ],
    "epmc-remaining-1.csv": [
      "authorString",
      "doi",
      "pmcid",
      "pmid",
      "pubYear",
      "title"
    ],
    "epmc-remaining-2.csv": [
      "authorString",
      "doi",
      "pmcid",
      "pmid",
      "pubYear",
      "title"
    ],
    "epmc-remaining-3.csv": [
      "authorString",
      "doi",
      "pmcid",
      "pmid",
      "pubYear",
      "title"
    ],
    "epmc-remaining-4.csv": [
      "authorString",
      "doi",
      "pmcid",
      "pmid",
      "pubYear",
      "title"
    ],
    "snapshots/first-pass-20261116/matched-repositories.csv": [
      "api_status",
      "archived",
      "association_evidence",
      "checked_at_utc",
      "created_at_utc",
      "fork_parent",
      "group_or_researcher",
      "is_fork",
      "last_push_at_utc",
      "ownership_relationship",
      "qualification",
      "repository"
    ],
    "snapshots/first-pass-20261116/account-repository-snapshot.csv": [
      "account",
      "account_relationship",
      "archived",
      "checked_at_utc",
      "created_at_utc",
      "is_fork",
      "last_push_at_utc",
      "repository"
    ],
    "europe-pmc-results.json": [
      "authorString",
      "doi",
      "firstPublicationDate",
      "pmcid",
      "pmid",
      "pubYear",
      "title"
    ]
  },
  "scranton": {
    "repositories.csv": [
      "connection_class",
      "evidence_urls",
      "id",
      "public_content_status",
      "qualification",
      "repository",
      "researched_date",
      "scranton_connection",
      "subject",
      "url",
      "urlDisposition"
    ],
    "labs-and-people.csv": [
      "evidence_url",
      "github_status",
      "name",
      "qualification",
      "relationship_to_scranton",
      "research_area",
      "type",
      "urlDisposition"
    ],
    "research-trails.csv": [
      "attribution_limit",
      "evidence_urls",
      "id",
      "result",
      "trail"
    ],
    "search-notes.md": [
      "reportedQualification"
    ],
    "findings.md": [
      "reportedQualification"
    ],
    "README.md": [
      "reportedQualification"
    ]
  },
  "sju": {
    "accounts.csv": [
      "account",
      "account_type",
      "connection",
      "evidence_urls",
      "identified_as",
      "limits",
      "primaryUrlDisposition",
      "snapshot_utc"
    ],
    "repositories.csv": [
      "description",
      "evidence_urls",
      "group",
      "limits",
      "people",
      "primaryUrlDisposition",
      "relationship",
      "repository",
      "snapshot_utc"
    ],
    "labs-checked.csv": [
      "evidence_urls",
      "finding",
      "group",
      "limits",
      "snapshot_utc"
    ],
    "link-checks.csv": [
      "checked_at_utc",
      "disposition",
      "final_url",
      "primaryUrlDisposition",
      "status"
    ]
  },
  "widener": {
    "repositories.csv": [
      "account_owner",
      "attribution_notes",
      "github_url",
      "project",
      "public_content",
      "relationship",
      "repository",
      "source_1",
      "source_2",
      "urlDisposition"
    ],
    "README.md": [
      "reportedQualification"
    ]
  }
};
const exact = (v: any, keys: string) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(' ') === keys.split(' ').sort().join(' ');
const safeFile = (s: string) => typeof s === 'string' && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(s) && s.split('/').every(x => x !== '.' && x !== '..');
const receipt = (v: any) => exact(v,'sha256 bytes') && typeof v.sha256 === 'string' && /^[a-f0-9]{64}$/.test(v.sha256) && Number.isSafeInteger(v.bytes) && v.bytes >= 0;
const forbidden = /(?:abstract|full.?text|contact|email|orcid|phone|biography|article.?body|readme.?body|raw.?text)/i;
const dateFields = new Set(['snapshot_utc','checked_at_utc','created_at','updated_at','pushed_at','researched_date','created_at_utc','last_push_at_utc','firstPublicationDate','retrieved_at_utc']);
function validDate(s: string) {
  const match=/^(\d{4}-\d{2}-\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|\+00:00))?$/.exec(s);
  if (!match) return false;
  const d=new Date(`${match[1]}T00:00:00Z`);
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0,10)===match[1];
}
export function validateManifest(m: any, batch: string) {
  if (!Object.hasOwn(expectedPolicies,batch)) throw Error('Unsupported intake batch');
  if (!exact(m,'schemaVersion batch sourceThreadId inputs outputs recordCount metadataPolicies sourceRequests suppliedScriptsExecuted publicationAuthorized') || m.schemaVersion !== 'regional-source-intake-manifest-v1' || m.batch !== batch || typeof m.sourceThreadId !== 'string' || !m.sourceThreadId || m.sourceRequests !== 0 || m.suppliedScriptsExecuted !== false || m.publicationAuthorized !== false || !Number.isSafeInteger(m.recordCount) || m.recordCount < 0 || !exact(m.outputs,'source-assertions.json') || !receipt(m.outputs['source-assertions.json'])) throw Error('Invalid intake manifest');
  if (!m.inputs || typeof m.inputs !== 'object' || Array.isArray(m.inputs) || !Object.keys(m.inputs).length || Object.entries(m.inputs).some(([k,v])=>!safeFile(k) || !receipt(v))) throw Error('Invalid input receipts');
  if (!m.metadataPolicies || typeof m.metadataPolicies !== 'object' || Array.isArray(m.metadataPolicies) || Object.entries(m.metadataPolicies).some(([k,v])=>!Object.hasOwn(m.inputs,k) || !Array.isArray(v) || v.some(x=>typeof x !== 'string' || !x || forbidden.test(x)) || new Set(v).size !== v.length)) throw Error('Invalid metadata policies');
  if (JSON.stringify(Object.fromEntries(Object.entries(m.metadataPolicies).sort().map(([k,v])=>[k,(v as string[]).slice().sort()]))) !== JSON.stringify(Object.fromEntries(Object.entries(expectedPolicies[batch]).sort()))) throw Error('Metadata policy mismatch');
  return m;
}
const kinds = new Set('account repository project publication relationship coverage availability external-resource source-observation'.split(' '));
export function validateIntake(d: any, m: any) {
  if (!m || typeof m.batch !== 'string' || !Object.hasOwn(expectedPolicies,m.batch)) throw Error('Unsupported intake batch');
  if (!exact(d,'schemaVersion batch visibility publicationAuthorized sourceThreadId records coverage qualifications') || d.schemaVersion !== 'regional-source-intake-v1' || d.batch !== m.batch || d.visibility !== 'private' || d.publicationAuthorized !== false || d.sourceThreadId !== m.sourceThreadId || !Array.isArray(d.records) || d.records.length !== m.recordCount || !d.coverage || typeof d.coverage !== 'object' || Array.isArray(d.coverage) || !Array.isArray(d.qualifications) || d.qualifications.some((x: unknown)=>typeof x !== 'string')) throw Error('Invalid intake envelope');
  for (const [key,value] of Object.entries(d.coverage)) {
    if (['perFileRowCounts','fileRowCounts','countsPerFile'].includes(key)) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([file,count])=>!Object.hasOwn(m.inputs,file) || !Number.isSafeInteger(count) || (count as number)<0)) throw Error('Invalid coverage counts');
    } else if (key==='reportObservationCount') { if (!Number.isSafeInteger(value) || (value as number)<0) throw Error('Invalid coverage count'); }
    else if (key==='scope') { if (typeof value !== 'string') throw Error('Invalid coverage scope'); }
    else throw Error('Unexpected coverage field');
  }
  const seen = new Set<string>();
  for (const r of d.records) {
    if (!exact(r,'id kind url nativeId sourceRef metadata publicationAuthorized reviewState') || typeof r.id !== 'string' || !r.id.startsWith(`${m.batch}:`) || seen.has(r.id) || !kinds.has(r.kind) || r.nativeId !== null || r.publicationAuthorized !== false || r.reviewState !== 'source_reported_unreviewed') throw Error('Invalid source record');
    seen.add(r.id);
    if (r.url !== null) { try { if (typeof r.url !== 'string' || /[\s\u0000-\u001f]/.test(r.url)) throw Error(); const u = new URL(r.url); if (u.protocol !== 'https:' || u.username || u.password || u.port) throw Error(); } catch { throw Error('Invalid source URL'); } }
    if (typeof r.sourceRef !== 'string') throw Error('Invalid source reference');
    const match = /^([^#]+)#(row=[2-9]\d*|row=1\d+|L[1-9]\d*(?:-L[1-9]\d*)?|\/(?:[^\s#~]|~[01])*)$/.exec(r.sourceRef);
    if (!match || !safeFile(match[1]) || !Object.hasOwn(m.inputs,match[1]) || !Object.hasOwn(m.metadataPolicies,match[1]) || (r.id !== `${m.batch}:${r.sourceRef}` && r.id !== `${m.batch}:${r.sourceRef.replace('#',':')}`)) throw Error('Invalid source reference');
    if (match[2].startsWith('/') && match[2].split('/').some((part: string)=>part==='.' || part==='..')) throw Error('Invalid JSON pointer');
    const lineRange=/^L(\d+)-L(\d+)$/.exec(match[2]); if(lineRange && Number(lineRange[2])<Number(lineRange[1])) throw Error('Invalid line range');
    if (!r.metadata || typeof r.metadata !== 'object' || Array.isArray(r.metadata) || Object.entries(r.metadata).some(([k,v])=>!m.metadataPolicies[match[1]].includes(k) || (v !== null && typeof v !== 'string'))) throw Error('Invalid source metadata');
    const required=expectedFields[m.batch]?.[match[1]];
    if (expectedFields[m.batch] && (!required || JSON.stringify(Object.keys(r.metadata).sort())!==JSON.stringify(required))) throw Error('Missing source metadata');
    if (Object.entries(r.metadata).some(([k,v])=>dateFields.has(k) && typeof v==='string' && v!=='' && !validDate(v))) throw Error('Invalid reported date');
    if (Object.entries(r.metadata).some(([k,v])=>['fork','archived','is_fork','is_archived','search_notes_truncated'].includes(k) && typeof v==='string' && v!=='' && !/^(true|false)$/i.test(v))) throw Error('Invalid reported boolean');
  }
  const coverageSchemas: Record<string,string> = {sju:'perFileRowCounts',pcom:'perFileRowCounts',widener:'fileRowCounts scope reportObservationCount',scranton:'fileRowCounts scope reportObservationCount',lehigh:'countsPerFile',rowan:'countsPerFile'};
  if (coverageSchemas[m.batch] && !exact(d.coverage,coverageSchemas[m.batch])) throw Error('Unexpected batch coverage');
  const fileCounts=d.coverage.perFileRowCounts ?? d.coverage.fileRowCounts ?? d.coverage.countsPerFile;
  if (fileCounts) {
    for (const [file,count] of Object.entries(fileCounts)) if (d.records.filter((r:any)=>r.sourceRef.startsWith(`${file}#`)).length!==count) throw Error('Coverage count mismatch');
    const covered=d.records.filter((r:any)=>Object.hasOwn(fileCounts,r.sourceRef.split('#')[0])).length;
    if (d.records.length-covered!==(d.coverage.reportObservationCount ?? 0)) throw Error('Incomplete coverage counts');
  }
  return d;
}
export function extendNetwork(oldObservations: Observation[], nodes: ReportedNode[], edges: ReportedEdge[], records: any[]) {
  const added: Observation[] = [];
  for (const r of records) {
    const batch=r.id.slice(0,r.id.indexOf(':'));
    added.push({id:r.id,batch,kind:r.kind,url:r.url,nativeId:null,observedDate:null,fields:{sourcePointer:r.sourceRef,status:r.reviewState}});
    for (const [key,value] of Object.entries(r.metadata)) {
      if (typeof value !== 'string') continue;
      const matches=value.match(/https:\/\/[^\s<>"']+/g) ?? [];
      matches.forEach((raw,index)=>{
        let url=raw.replace(/[.,;:!?]+$/g,'');
        while (url.endsWith(')') && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)) url=url.slice(0,-1);
        try { const u=new URL(url); if(u.protocol!=='https:' || u.username || u.password || u.port || /[\s\u0000-\u001f]/.test(url)) return; } catch { return; }
        added.push({id:`${r.id}:metadata:${key}:${index}`,batch,kind:'source-observation',url,nativeId:null,observedDate:null,fields:{sourcePointer:r.sourceRef,sourceRefs:[`metadata:${key}:${index}`],status:r.reviewState}});
      });
    }
  }
  return federate([...oldObservations,...added],nodes,edges);
}
