import { z } from 'zod';

// Private research leads only. None of these structures is an admission or publication projection.
const https = z.string().url().refine(value => new URL(value).protocol === 'https:', 'HTTPS source required');
const calendarDay = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};
const repoSchema = z.object({ url: https, purpose: z.string().min(1), purposeSource: https, githubPageChecked: z.boolean(), note: z.string().nullable() }).passthrough();
const occurrenceSchema = z.object({
  account: z.string().min(1), accountUrl: https, accountType: z.string().nullable(), person: z.string().nullable(),
  institutionOrLab: z.string().min(1), affiliationTimeScope: z.string().min(1),
  region: z.object({ municipality: z.string().nullable(), county: z.string().nullable(), basis: z.string().min(1), source: https.nullable() }).passthrough(),
  accountLinkSource: https, relationshipBasis: z.string().min(1), publicationAuthorized: z.literal(false), repositories: z.array(repoSchema).min(1),
}).passthrough();
const accountOnlySchema = z.object({ account: z.string().min(1), url: https, person: z.string().nullable(), institution: z.string().min(1), affiliationTimeScope: z.string().min(1), location: z.string().nullable(), source: https, publicationAuthorized: z.literal(false) }).passthrough();
export const ResearchLeadInputSchema = z.object({ accountOnlyLeads: z.array(accountOnlySchema).default([]), title: z.string(), observedDate: z.string().refine(calendarDay, 'Valid calendar day required'), status: z.string(), method: z.string(), publicationAuthorized: z.literal(false), accounts: z.array(occurrenceSchema) }).passthrough();
type LeadInput = z.infer<typeof ResearchLeadInputSchema>;

function githubPath(value: string, length: number): string[] {
  const url = new URL(value);
  const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.port || url.username || url.password || url.search || url.hash || parts.length !== length || parts.some(part => !/^[A-Za-z0-9_.-]+$/.test(part))) throw new Error(`Invalid GitHub URL: ${value}`);
  return parts;
}
const key = (value: string) => value.toLowerCase();
const sort = <T>(values: T[], f: (v: T) => string): T[] => values.sort((a, b) => f(a).localeCompare(f(b), 'en'));

export function buildResearchAccountMap(raw: { source: string; data: unknown; sha256?: string }[], baseline: { source: string; data: unknown }[] = []) {
  if (new Set(raw.map(item => item.source)).size !== raw.length) throw new Error('Duplicate input source');
  const inputs = raw.map(({ source, data, sha256 }) => {
    if (sha256 !== undefined && !/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`Invalid input SHA-256: ${source}`);
    if (!/^docs\/discovery\/go-live\/evidence\/GL05\/[a-z0-9-]+\.json$/.test(source)) throw new Error(`Invalid evidence reference: ${source}`);
    const checkPrivate = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(checkPrivate);
      else if (v && typeof v === 'object') for (const [k, child] of Object.entries(v)) {
        if (k === 'publicationAuthorized' && child !== false) throw new Error('Publication authorization is forbidden');
        checkPrivate(child);
      }
    };
    checkPrivate(data);
    return { source, sha256: sha256 ?? null, data: ResearchLeadInputSchema.parse(data) as LeadInput };
  });
  const accounts = new Map<string, { key: string; url: string; occurrenceIds: string[]; repositoryKeys: string[] }>();
  const repositories = new Map<string, { key: string; url: string; accountKey: string; occurrenceIds: string[]; relevance: string[] }>();
  const occurrences: any[] = [];
  for (const { source, data } of inputs) for (const [index, entry] of data.accounts.entries()) {
    const accountPath = githubPath(entry.accountUrl, 1);
    if (key(accountPath[0]) !== key(entry.account)) throw new Error(`Account URL mismatch: ${entry.account}`);
    const accountKey = key(entry.account), occurrenceId = `${source}#/accounts/${index}`;
    const account = accounts.get(accountKey) ?? { key: accountKey, url: `https://github.com/${accountKey}`, occurrenceIds: [], repositoryKeys: [] };
    account.occurrenceIds.push(occurrenceId);
    accounts.set(accountKey, account);
    const links = entry.repositories.map((repository, ri) => {
      const parts = githubPath(repository.url, 2);
      if (key(parts[0]) !== accountKey) throw new Error(`Repository owner mismatch: ${repository.url}`);
      const repoKey = `${accountKey}/${key(parts[1])}`;
      const relevance = /\b(cancer|tumou?r|immunotherapy|pulmonary|stroke|corneal|mri|ct|health dataset)\b/i.test(repository.purpose) ? 'triage-health-purpose-indicated-review-required' : 'triage-general-method-or-neuroscience-health-purpose-review-required';
      const repo = repositories.get(repoKey) ?? { key: repoKey, url: `https://github.com/${repoKey}`, accountKey, occurrenceIds: [], relevance: [] };
      repo.occurrenceIds.push(`${occurrenceId}/repositories/${ri}`);
      if (!repo.relevance.includes(relevance)) repo.relevance.push(relevance);
      repositories.set(repoKey, repo);
      if (!account.repositoryKeys.includes(repoKey)) account.repositoryKeys.push(repoKey);
      return { repositoryKey: repoKey, evidence: `${occurrenceId}/repositories/${ri}`, institutionRepositorySource: repository.purposeSource, namespaceBasis: 'URL path only; native account and repository identity unverified', purpose: repository.purpose, githubPageChecked: repository.githubPageChecked, note: repository.note };
    });
    // The present sources do not establish an explicit person-to-account role.
    // Names remain source occurrences, never merged into identity edges.
    const personAccountEdge = null;
    const personResourceAssociation = entry.person === 'Shannon Pileggi' && accountKey === 'shannonpileggi' && links.some(link => link.repositoryKey === 'shannonpileggi/gtreg') && entry.accountLinkSource === 'https://shannonpileggi.github.io/gtreg/'
      ? { type: 'source-person-resource-association', person: entry.person, repositoryKey: 'shannonpileggi/gtreg', source: entry.accountLinkSource, qualification: 'Documentation names author and maintainer; account control not authenticated.' }
      : entry.person === 'Nick Battista' && accountKey === 'nickabattista' && links.some(link => link.repositoryKey === 'nickabattista/ib2d') && entry.accountLinkSource === 'https://nickabattista.wixsite.com/home'
      ? { type: 'source-person-resource-association', person: entry.person, repositoryKey: 'nickabattista/ib2d', source: entry.accountLinkSource, qualification: 'Lab page reports his GitHub site and project association; account control not authenticated.' } : null;
    occurrences.push({ id: occurrenceId, observedDate: data.observedDate, sourceAccess: entry.sourceAccess ?? entry.evidenceAccess ?? entry.observationMethod ?? data.method, accountKey, personOccurrence: entry.person === null ? null : { name: entry.person, role: accountKey === 'sacanlab' ? 'paper-author; account ownership not established' : 'source-reported person; role requires source review' }, personAccountEdge, personResourceAssociation, institutionOrLab: entry.institutionOrLab, institutionAccountSource: entry.accountLinkSource, relationshipBasis: entry.relationshipBasis, affiliationTimeScope: entry.affiliationTimeScope, region: entry.region, projectWorksite: null, currentEmployment: null, repositories: links, novelty: 'unknown; reconcile against catalog and frontier', publicationAuthorized: false });
  }
  for (const { source, data } of inputs) for (const [index, entry] of data.accountOnlyLeads.entries()) {
    const path = githubPath(entry.url, 1), accountKey = key(entry.account);
    if (key(path[0]) !== accountKey) throw new Error(`Account URL mismatch: ${entry.account}`);
    const occurrenceId = `${source}#/accountOnlyLeads/${index}`;
    const account = accounts.get(accountKey) ?? { key: accountKey, url: `https://github.com/${accountKey}`, occurrenceIds: [], repositoryKeys: [] };
    account.occurrenceIds.push(occurrenceId); accounts.set(accountKey, account);
    occurrences.push({ id: occurrenceId, observedDate: data.observedDate, sourceAccess: data.method, accountKey, personOccurrence: entry.person === null ? null : { name: entry.person, role: 'source-reported researcher or student occurrence; account ownership not established' }, personAccountEdge: null, personResourceAssociation: null, institutionOrLab: entry.institution, institutionAccountSource: entry.source, relationshipBasis: 'Source associates a lab or project with this account; individual ownership unverified', affiliationTimeScope: entry.affiliationTimeScope, region: { municipality: null, county: null, basis: entry.location ?? 'unknown', source: entry.source }, projectWorksite: null, currentEmployment: null, repositories: [], reportedProjectPurpose: typeof entry.projectPurpose === 'string' ? entry.projectPurpose : null, novelty: 'unknown; reconcile against catalog and frontier', publicationAuthorized: false });
  }
  // Reconciliation is a literal URL/namespace cross-reference, not a novelty finding.
  const references = new Map<string, Set<string>>();
  const walk = (value: unknown, pointer: string, source: string) => {
    if (typeof value === 'string') {
      const matches = value.matchAll(/https:\/\/github\.com\/([a-z0-9_.-]+)(?:\/([a-z0-9_.-]+))?/gi);
      for (const match of matches) {
        const account = key(match[1]), repo = match[2] ? `${account}/${key(match[2])}` : null;
        for (const item of [account, repo].filter((v): v is string => v !== null)) {
          if (!references.has(item)) references.set(item, new Set());
          references.get(item)!.add(`${source}#${pointer}`);
        }
      }
    } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${pointer}/${i}`, source));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => walk(v, `${pointer}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`, source));
  };
  for (const item of baseline) walk(item.data, '', item.source);
  const reconciliation = (id: string) => ({ status: references.has(id) ? 'matched-existing-url' : 'unknown', evidence: [...references.get(id) ?? []].sort(), qualification: 'Literal URL match only; absence does not establish novelty.' });
  return { schemaVersion: 1, visibility: 'private-research-leads', publicationAuthorized: false, inputSources: inputs.map(({ source, sha256 }) => ({ source, sha256 })), counts: { accountHandles: accounts.size, repositories: repositories.size, personOccurrences: occurrences.filter(o => o.personOccurrence !== null).length, distinctPeople: null, regionalCoverage: null }, accounts: sort([...accounts.values()].map(a => ({ ...a, reconciliation: reconciliation(a.key), occurrenceIds: a.occurrenceIds.sort(), repositoryKeys: a.repositoryKeys.sort() })), a => a.key), repositories: sort([...repositories.values()].map(r => ({ ...r, reconciliation: reconciliation(r.key), occurrenceIds: r.occurrenceIds.sort(), relevance: r.relevance.sort() })), r => r.key), occurrences: sort(occurrences, o => o.id) };
}
