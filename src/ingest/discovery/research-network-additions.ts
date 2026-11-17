// Closed, reviewed contracts; never derived from candidate manifests at runtime.
const expectedPolicies: Record<string, Record<string, string[]>> = {
  "incubators": {
    "README.md": [
      "limitation"
    ],
    "evidence-link-check-pre-review.json": [
      "checked_at_utc",
      "limitation",
      "method",
      "reported_final_url",
      "reported_status"
    ],
    "github-link-check.json": [
      "checked_at_utc",
      "csv_sha256_at_check",
      "current_csv_sha256",
      "limitation",
      "method",
      "post_check_change",
      "reported_final_url",
      "reported_status"
    ],
    "source-snapshot-receipt.json": [
      "lineage"
    ],
    "supported-links.csv": [
      "entity",
      "entity_type",
      "evidence_scope",
      "evidence_url_1",
      "evidence_url_2",
      "evidence_url_3",
      "group",
      "qualification",
      "research_area"
    ],
    "unreviewed-account-leads.csv": [
      "lineage",
      "reported_raw_count"
    ],
    "unreviewed-all-repository-url-leads.csv": [
      "lineage",
      "reported_raw_count"
    ],
    "unreviewed-repository-leads.csv": [
      "lineage",
      "reported_raw_count"
    ],
    "verification.json": [
      "limitation"
    ]
  },
  "wistar": {
    "github-accounts.csv": [
      "account_type",
      "checked_utc",
      "evidence_summary",
      "evidence_url_1",
      "evidence_url_2",
      "github_login",
      "github_url",
      "name_or_identity",
      "proseTruncated",
      "public_repositories",
      "related_investigator",
      "sourceUrls"
    ],
    "labs-and-people.csv": [
      "collaboration_or_shared_links",
      "investigator",
      "investigator_accounts",
      "lab_organization_accounts",
      "notes",
      "proseTruncated",
      "sourceUrls",
      "status",
      "team_or_project_accounts",
      "wistar_profile_url"
    ],
    "organization-repositories.csv": [
      "archived",
      "checked_utc",
      "created_utc",
      "fork",
      "github_organization",
      "github_url",
      "last_push_utc",
      "proseTruncated",
      "repository_name",
      "sourceUrls"
    ]
  },
  "public-health": {
    "README.md": [
      "note"
    ],
    "counts.json": [
      "value"
    ],
    "curated-seeds.tsv": [
      "area",
      "evidence_note",
      "evidence_url",
      "extracted_urls",
      "github_url",
      "metadata_truncated",
      "name",
      "type"
    ],
    "profile-search-raw.json": [
      "first_page_only",
      "matches_reported",
      "query",
      "returned"
    ],
    "seed-github-validation.json": [
      "__typename",
      "isArchived",
      "isPrivate",
      "location",
      "login",
      "name",
      "nameWithOwner",
      "reported_key",
      "status",
      "url"
    ],
    "source-link-checks.csv": [
      "extracted_urls",
      "http_status",
      "metadata_truncated",
      "note",
      "resolved_url",
      "url"
    ],
    "source-linked-inventory.csv": [
      "area",
      "availability",
      "evidence_kind",
      "evidence_note",
      "evidence_url",
      "extracted_urls",
      "github_object_type",
      "github_url",
      "metadata_truncated",
      "name",
      "type"
    ],
    "unavailable-leads.csv": [
      "area",
      "availability_note",
      "evidence_note",
      "evidence_url",
      "extracted_urls",
      "github_url",
      "metadata_truncated",
      "name",
      "type"
    ],
    "unreviewed-profile-leads.csv": [
      "evidence_url",
      "extracted_urls",
      "github_object_type",
      "github_url",
      "matched_search_queries",
      "metadata_truncated",
      "name",
      "profile_company",
      "profile_location",
      "review_status"
    ]
  }
};
const expectedFields: Record<string, Record<string, string[]>> = {
  "incubators": {
    "README.md": [
      "limitation"
    ],
    "evidence-link-check-pre-review.json": [
      "checked_at_utc",
      "limitation",
      "method",
      "reported_final_url",
      "reported_status"
    ],
    "github-link-check.json": [],
    "source-snapshot-receipt.json": [
      "lineage"
    ],
    "supported-links.csv": [
      "entity",
      "entity_type",
      "evidence_scope",
      "evidence_url_1",
      "group",
      "qualification",
      "research_area"
    ],
    "unreviewed-account-leads.csv": [
      "lineage",
      "reported_raw_count"
    ],
    "unreviewed-all-repository-url-leads.csv": [
      "lineage",
      "reported_raw_count"
    ],
    "unreviewed-repository-leads.csv": [
      "lineage",
      "reported_raw_count"
    ],
    "verification.json": [
      "limitation"
    ]
  },
  "wistar": {
    "github-accounts.csv": [
      "account_type",
      "checked_utc",
      "evidence_summary",
      "evidence_url_1",
      "evidence_url_2",
      "github_login",
      "github_url",
      "name_or_identity",
      "proseTruncated",
      "public_repositories",
      "related_investigator",
      "sourceUrls"
    ],
    "labs-and-people.csv": [
      "collaboration_or_shared_links",
      "investigator",
      "investigator_accounts",
      "lab_organization_accounts",
      "notes",
      "proseTruncated",
      "sourceUrls",
      "status",
      "team_or_project_accounts",
      "wistar_profile_url"
    ],
    "organization-repositories.csv": [
      "archived",
      "checked_utc",
      "created_utc",
      "fork",
      "github_organization",
      "github_url",
      "last_push_utc",
      "proseTruncated",
      "repository_name",
      "sourceUrls"
    ]
  },
  "public-health": {
    "README.md": [
      "note"
    ],
    "counts.json": [
      "value"
    ],
    "curated-seeds.tsv": [
      "area",
      "evidence_note",
      "evidence_url",
      "extracted_urls",
      "github_url",
      "metadata_truncated",
      "name",
      "type"
    ],
    "profile-search-raw.json": [
      "first_page_only",
      "matches_reported",
      "query",
      "returned"
    ],
    "seed-github-validation.json": [
      "__typename",
      "isArchived",
      "isPrivate",
      "location",
      "login",
      "name",
      "nameWithOwner",
      "reported_key",
      "status",
      "url"
    ],
    "source-link-checks.csv": [
      "extracted_urls",
      "http_status",
      "metadata_truncated",
      "note",
      "resolved_url",
      "url"
    ],
    "source-linked-inventory.csv": [
      "area",
      "availability",
      "evidence_kind",
      "evidence_note",
      "evidence_url",
      "extracted_urls",
      "github_object_type",
      "github_url",
      "metadata_truncated",
      "name",
      "type"
    ],
    "unavailable-leads.csv": [
      "area",
      "availability_note",
      "evidence_note",
      "evidence_url",
      "extracted_urls",
      "github_url",
      "metadata_truncated",
      "name",
      "type"
    ],
    "unreviewed-profile-leads.csv": [
      "evidence_url",
      "extracted_urls",
      "github_object_type",
      "github_url",
      "matched_search_queries",
      "metadata_truncated",
      "name",
      "profile_company",
      "profile_location",
      "review_status"
    ]
  }
};
const exact = (v: any, keys: string) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(' ') === keys.split(' ').sort().join(' ');
const safeFile = (s: string) => typeof s === 'string' && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(s) && s.split('/').every(x => x !== '.' && x !== '..');
const receipt = (v: any) => exact(v,'sha256 bytes') && typeof v.sha256 === 'string' && /^[a-f0-9]{64}$/.test(v.sha256) && Number.isSafeInteger(v.bytes) && v.bytes >= 0;
const forbidden = /(?:abstract|full.?text|contact|email|orcid|phone|biography|article.?body|readme.?body|raw.?text)/i;
const dateFields = new Set(['snapshot_utc','checked_at_utc','created_at','updated_at','pushed_at','researched_date','created_at_utc','last_push_at_utc','firstPublicationDate','retrieved_at_utc','checked_utc','created_utc','last_push_utc']);
function validDate(s: string) {
  const match=/^(\d{4}-\d{2}-\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|\+00:00))?$/.exec(s);
  if (!match) return false;
  const d=new Date(`${match[1]}T00:00:00Z`);
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0,10)===match[1];
}
const threads: Record<string, string> = {incubators:'01a1e757-a7ce-7eb3-a4bd-3658661471f6',wistar:'01a1e754-f637-7141-a610-dd146aab4937','public-health':'01a1e757-1efe-79c2-b387-58adc9b5cccc'};
export function validateManifest(m: any, batch: string) {
  if (!Object.hasOwn(expectedPolicies,batch)) throw Error('Unsupported intake batch');
  if (!exact(m,'schemaVersion batch sourceThreadId inputs outputs recordCount metadataPolicies sourceRequests suppliedScriptsExecuted publicationAuthorized') || m.schemaVersion !== 'regional-source-intake-manifest-v1' || m.batch !== batch || m.sourceThreadId !== threads[batch] || m.sourceRequests !== 0 || m.suppliedScriptsExecuted !== false || m.publicationAuthorized !== false || !Number.isSafeInteger(m.recordCount) || m.recordCount < 0 || !exact(m.outputs,'source-assertions.json') || !receipt(m.outputs['source-assertions.json'])) throw Error('Invalid intake manifest');
  if (!m.inputs || typeof m.inputs !== 'object' || Array.isArray(m.inputs) || !Object.keys(m.inputs).length || Object.entries(m.inputs).some(([k,v])=>!safeFile(k) || !receipt(v))) throw Error('Invalid input receipts');
  if (!m.metadataPolicies || typeof m.metadataPolicies !== 'object' || Array.isArray(m.metadataPolicies) || Object.entries(m.metadataPolicies).some(([k,v])=>!Object.hasOwn(m.inputs,k) || !Array.isArray(v) || v.some(x=>typeof x !== 'string' || !x || forbidden.test(x)) || new Set(v).size !== v.length)) throw Error('Invalid metadata policies');
  if (JSON.stringify(Object.fromEntries(Object.entries(m.metadataPolicies).sort().map(([k,v])=>[k,(v as string[]).slice().sort()]))) !== JSON.stringify(Object.fromEntries(Object.entries(expectedPolicies[batch]).sort()))) throw Error('Metadata policy mismatch');
  return m;
}
const compactExports: Record<string, string> = {'unreviewed-account-leads.csv':'259','unreviewed-repository-leads.csv':'3274','unreviewed-all-repository-url-leads.csv':'5534'};
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
    const match = /^([^#]+)#(row=[1-9]\d*|L[1-9]\d*(?:-L[1-9]\d*)?|\/(?:[^\u0000-\u001f#~]|~[01])*)$/.exec(r.sourceRef);
    if (!match || !safeFile(match[1]) || !Object.hasOwn(m.inputs,match[1]) || !Object.hasOwn(m.metadataPolicies,match[1]) || (r.id !== `${m.batch}:${r.sourceRef}` && r.id !== `${m.batch}:${r.sourceRef.replace('#',':')}`)) throw Error('Invalid source reference');
    if (Object.hasOwn(compactExports,match[1]) && (match[2]!=='row=1' || r.kind!=='coverage' || r.url!==null || r.metadata?.reported_raw_count!==compactExports[match[1]] || Object.values(r.metadata ?? {}).some(v=>typeof v==='string' && v.includes('https://')))) throw Error('Invalid derived export coverage');
    if (match[2]==='row=1' && !(m.batch==='incubators' && ['unreviewed-account-leads.csv','unreviewed-repository-leads.csv','unreviewed-all-repository-url-leads.csv'].includes(match[1]) && r.kind==='coverage' && r.url===null)) throw Error('Invalid CSV header reference');
    if (match[2].startsWith('/') && match[2].split('/').some((part: string)=>part==='.' || part==='..')) throw Error('Invalid JSON pointer');
    const lineRange=/^L(\d+)-L(\d+)$/.exec(match[2]); if(lineRange && Number(lineRange[2])<Number(lineRange[1])) throw Error('Invalid line range');
    if (!r.metadata || typeof r.metadata !== 'object' || Array.isArray(r.metadata) || Object.entries(r.metadata).some(([k,v])=>!m.metadataPolicies[match[1]].includes(k) || (v !== null && typeof v !== 'string'))) throw Error('Invalid source metadata');
    const required=expectedFields[m.batch]?.[match[1]];
    if (expectedFields[m.batch] && (!required || required.some((key: string)=>!Object.hasOwn(r.metadata,key)))) throw Error('Missing source metadata');
    if (typeof r.metadata.sourceUrls === 'string') {
      let urls: unknown; try { urls=JSON.parse(r.metadata.sourceUrls); } catch { throw Error('Invalid sourceUrls'); }
      if (!Array.isArray(urls) || urls.some((value: unknown)=>{ if (typeof value !== 'string' || /[\s\u0000-\u001f]/.test(value)) return true; try { const u=new URL(value); return u.protocol!=='https:' || !!u.username || !!u.password || !!u.port; } catch { return true; } })) throw Error('Invalid sourceUrls');
    }
    if (Object.entries(r.metadata).some(([k,v])=>dateFields.has(k) && typeof v==='string' && v!=='' && !validDate(v))) throw Error('Invalid reported date');
    if (Object.entries(r.metadata).some(([k,v])=>['fork','archived','is_fork','is_archived','search_notes_truncated','proseTruncated','metadata_truncated','isArchived','isPrivate'].includes(k) && typeof v==='string' && v!=='' && !/^(true|false)$/i.test(v))) throw Error('Invalid reported boolean');
  }
  const coverageSchemas: Record<string,string> = {incubators:'perFileRowCounts',wistar:'perFileRowCounts','public-health':'perFileRowCounts'};
  if (coverageSchemas[m.batch] && !exact(d.coverage,coverageSchemas[m.batch])) throw Error('Unexpected batch coverage');
  const fileCounts=d.coverage.perFileRowCounts ?? d.coverage.fileRowCounts ?? d.coverage.countsPerFile;
  if (fileCounts) {
    for (const [file,count] of Object.entries(fileCounts)) if (d.records.filter((r:any)=>r.sourceRef.startsWith(`${file}#`)).length!==count) throw Error('Coverage count mismatch');
    const covered=d.records.filter((r:any)=>Object.hasOwn(fileCounts,r.sourceRef.split('#')[0])).length;
    if (d.records.length-covered!==(d.coverage.reportObservationCount ?? 0)) throw Error('Incomplete coverage counts');
  }
  return d;
}
