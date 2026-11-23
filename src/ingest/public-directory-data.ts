import publishedProjects from "../content/public-directory-projects.json";

export type DirectoryPaper = {
  title?: string | null;
  url?: string | null;
  doi?: string | null;
  year?: number | null;
  venue?: string | null;
};

export type DirectoryProject = {
  id: string;
  code: string;
  name: string;
  purpose: string;
  description?: string | null;
  topic: string;
  label: "Verified" | "Listed";
  institution?: string | null;
  county?: string | null;
  countyBasis?: "institution" | "profile";
  profileLocation?: string;
  connection?: string | null;
  source?: string | null;
  paper?: string | null;
  language?: string | null;
  license?: string | null;
  updated?: string | null;
  added?: string | null;
  owner?: { login: string; name?: string | null; kind?: "organization" | "user" } | null;
  lab?: string | null;
  stars?: number | null;
  topics?: string[] | null;
  homepage?: string | null;
  created?: string | null;
  pushed?: string | null;
  archived?: boolean | null;
  papers?: DirectoryPaper[] | null;
  checked?: string | null;
};

export const browsePath = "/discover/works";
export const methodPath = "/discover/methodology";
export const apiPath = "/api/directory/projects";
export const detailPrefix = "/discover/work/";

export const counties = [
  { name: "Bucks", state: "PA", fips: "42017" },
  { name: "Chester", state: "PA", fips: "42029" },
  { name: "Delaware", state: "PA", fips: "42045" },
  { name: "Montgomery", state: "PA", fips: "42091" },
  { name: "Philadelphia", state: "PA", fips: "42101" },
  { name: "Burlington", state: "NJ", fips: "34005" },
  { name: "Camden", state: "NJ", fips: "34007" },
  { name: "Gloucester", state: "NJ", fips: "34015" },
  { name: "Mercer", state: "NJ", fips: "34021" },
] as const;

export const facetLabels = {
  institution: "Institution", topic: "Topic", county: "County", language: "Language",
  license: "License", label: "Regional evidence", owner: "GitHub account",
  tag: "GitHub topic", archived: "Archive status", year: "Last activity year",
} as const;
export type FacetKey = keyof typeof facetLabels;
const facetKeys = Object.keys(facetLabels) as FacetKey[];
export type Facet = { name: string; count: number };
type Sort = "updated" | "name" | "relevance" | "stars" | "added";

export type DirectoryQuery = {
  q: string;
  facets: Partial<Record<FacetKey, string[]>>;
  paper: boolean;
  since: string;
  sort: Sort;
  view: "cards" | "compact" | "";
  page: number;
};

export type EntityKind = "institution" | "lab" | "topic" | "county";
export type DirectoryEntity = { kind: EntityKind; name: string; key: string; slug: string };
type Scope = { entity: DirectoryEntity; summary: DirectorySummary; account?: string; ownerKind?: string };
const entityFacet = { institution: "institution", lab: "owner", topic: "topic", county: "county" } as const;
const entityKinds = Object.keys(entityFacet) as EntityKind[];
export const labPageMinimum = 2;
export const pageSize = 24;

const aliases = new Map([
  ["GL04:work:crossref:gaston", "692249664"],
  ["GL05:work:crossref:sleepboost", "617168725"],
  ["GL05:work:crossref:openpbta", "192607622"],
]);

export function publicProjectId(value: string): string | null {
  if (/^[1-9][0-9]{0,19}$/.test(value)) return value;
  const oldRepository = /^GL[0-9]{2}:work:github:([1-9][0-9]{0,19})$/.exec(value);
  return oldRepository?.[1] ?? aliases.get(value) ?? null;
}

export function httpsUrl(value?: string | null): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
  } catch { /* Invalid source URL. */ }
}

export function githubAccount(project: DirectoryProject): string | undefined {
  if (project.owner?.login && /^\w[\w.-]*$/.test(project.owner.login)) return project.owner.login;
  const url = httpsUrl(project.code);
  if (!url) return;
  const { hostname, pathname } = new URL(url);
  const login = pathname.split("/")[1];
  if (hostname === "github.com" && /^\w[\w.-]*$/.test(login)) return login;
}

export function githubProfile(login?: string): string | undefined {
  return login && /^\w[\w.-]*$/.test(login) ? `https://github.com/${encodeURIComponent(login)}` : undefined;
}

export function paperUrl(paper: DirectoryPaper): string | undefined {
  const url = httpsUrl(paper.url);
  if (url) return url;
  if (!paper.doi || !/^10\.\d{4,9}\/\S+$/u.test(paper.doi)) return;
  const doi = new URL("https://doi.org");
  doi.pathname = "/" + paper.doi;
  return doi.href;
}

function isoDate(value?: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? value : "";
}

export function lastActivity(project: DirectoryProject): string {
  return isoDate(project.pushed) || isoDate(project.updated);
}

export function projectPapers(project: DirectoryProject): DirectoryPaper[] {
  const papers = (project.papers ?? []).filter(paper => paper.title || paperUrl(paper));
  const legacy = httpsUrl(project.paper);
  if (legacy && !papers.some(paper => paperUrl(paper) === legacy ||
    (paper.doi && legacy.toLowerCase() === `https://doi.org/${paper.doi.toLowerCase()}`))) {
    return [...papers, { url: legacy }];
  }
  return papers;
}

const normalizeSearch = (input: string) =>
  input.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function facetKey(field: FacetKey, value: string) {
  // Preserve punctuation in language, license, account and tag names (C and C++ are distinct).
  if (field === "institution" || field === "topic" || field === "county") return normalizeSearch(value) || value.toLowerCase();
  return value.normalize("NFKC").trim().toLowerCase();
}

export function readDirectoryQuery(params: URLSearchParams): DirectoryQuery {
  const field = (key: string) => (params.get(key) ?? "").trim();
  const q = field("q").slice(0, 200);
  const facets: DirectoryQuery["facets"] = {};
  for (const key of facetKeys) {
    const values = new Map<string, string>();
    for (const raw of params.getAll(key).slice(0, 100)) {
      const value = raw.trim().slice(0, 180);
      if (value) values.set(facetKey(key, value), value);
    }
    if (values.size) facets[key] = [...values.values()];
  }
  const sort = field("sort");
  const view = field("view");
  const page = field("page");
  return {
    q, facets, paper: field("paper") === "1", since: isoDate(field("since")),
    sort: sort === "name" || sort === "stars" || sort === "added" || (sort === "relevance" && normalizeSearch(q)) ? sort : "updated",
    view: view === "compact" || view === "cards" ? view : "",
    page: /^[1-9]\d{0,7}$/.test(page) ? Number(page) : 1,
  };
}

export function directoryParams(query: Partial<DirectoryQuery>): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  for (const key of facetKeys) for (const value of query.facets?.[key] ?? []) params.append(key, value);
  if (query.paper) params.set("paper", "1");
  if (query.since) params.set("since", query.since);
  if (query.sort && query.sort !== "updated") params.set("sort", query.sort);
  if (query.view) params.set("view", query.view);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  return params;
}

export const projectPath = (project: Pick<DirectoryProject, "id">) => detailPrefix + encodeURIComponent(project.id);
export const entityPath = (entity: DirectoryEntity) => `/discover/${entity.kind}/${entity.slug}`;

type IndexRow = {
  project: DirectoryProject;
  name: string;
  purpose: string;
  keywords: string;
  activity: string;
  added: string;
  paper: boolean;
  facets: Record<FacetKey, { key: string; name: string }[]>;
};

function indexProject(project: DirectoryProject): IndexRow {
  const activity = lastActivity(project);
  const owner = githubAccount(project);
  const papers = projectPapers(project);
  const fields: Record<FacetKey, readonly (string | undefined | null)[]> = {
    institution: [project.institution], topic: [project.topic], county: [project.county],
    language: [project.language], license: [project.license], label: [project.label], owner: [owner],
    tag: project.topics ?? [], archived: [project.archived === true ? "Archived" : project.archived === false ? "Not archived" : ""],
    year: [activity.slice(0, 4)],
  };
  const facets = {} as IndexRow["facets"];
  for (const field of facetKeys) {
    const values = new Map<string, string>();
    for (const name of fields[field]) if (name) values.set(facetKey(field, name), name);
    facets[field] = Array.from(values, ([key, name]) => ({ key, name }));
  }
  return {
    project, activity, added: isoDate(project.added), facets,
    name: normalizeSearch(project.name), purpose: normalizeSearch(project.purpose),
    keywords: normalizeSearch([
      project.code, project.topic, project.institution, project.county, project.profileLocation, project.label, project.language,
      project.license, project.connection, project.id, owner, project.owner?.name, project.lab, ...(project.topics ?? []),
      ...papers.map(paper => [paper.title, paper.url, paper.doi, paper.venue].filter(Boolean).join(" ")),
    ].filter(Boolean).join(" ")),
    paper: papers.length > 0,
  };
}

const byName = (a: IndexRow, b: IndexRow) => a.project.name.localeCompare(b.project.name, "en") ||
  a.project.id.localeCompare(b.project.id);
const byActivity = (a: IndexRow, b: IndexRow) => b.activity.localeCompare(a.activity) || byName(a, b);
const byAdded = (a: IndexRow, b: IndexRow) => b.added.localeCompare(a.added) || byActivity(a, b);
const byStars = (a: IndexRow, b: IndexRow) => (b.project.stars ?? -1) - (a.project.stars ?? -1) || byActivity(a, b);

function tally(counts: Map<string, Facet>, { key, name }: { key: string; name: string }) {
  const current = counts.get(key);
  if (current) current.count += 1;
  else counts.set(key, { name, count: 1 });
}

function facetOrder(a: Facet, b: Facet) {
  return b.count - a.count || a.name.localeCompare(b.name, "en");
}

function rank(rows: readonly IndexRow[], field: FacetKey): Facet[] {
  const counts = new Map<string, Facet>();
  for (const row of rows) for (const value of row.facets[field]) tally(counts, value);
  return [...counts.values()].sort(facetOrder);
}

export function activityCutoff(now = new Date(), years = 1): string {
  const year = now.getUTCFullYear() - years;
  const month = now.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(lastDay, now.getUTCDate()))).toISOString().slice(0, 10);
}

function recentlyActive(rows: readonly IndexRow[], now: Date) {
  const cutoff = activityCutoff(now);
  return rows.filter(row => row.activity >= cutoff);
}

function summarize(rows: readonly IndexRow[], now: Date) {
  return {
    total: rows.length, active: recentlyActive(rows, now).length,
    topics: rank(rows, "topic"), languages: rank(rows, "language"),
    institutions: rank(rows, "institution"), labs: rank(rows, "owner"),
  };
}

type DirectorySummary = ReturnType<typeof summarize>;

function score(row: IndexRow, terms: string[], phrase: string) {
  let relevance = 0;
  for (const term of terms) {
    if (row.name.includes(term)) relevance += terms.length + 1;
    else if (row.purpose.includes(term)) relevance += 1;
    else if (!row.keywords.includes(term)) return -1;
  }
  return terms.length && row.name === phrase ? relevance + (terms.length + 1) ** 2 : relevance;
}

type Exclusion = FacetKey | "q" | "paper" | "since";
type Suggestion = { field: Exclusion; label: string; count: number; query: DirectoryQuery };

export function withoutFilter(query: DirectoryQuery, field: Exclusion, value?: string): DirectoryQuery {
  const next = { ...query, page: 1, facets: { ...query.facets } };
  if (field === "q") { next.q = ""; if (next.sort === "relevance") next.sort = "updated"; }
  else if (field === "paper") next.paper = false;
  else if (field === "since") next.since = "";
  else if (value && (next.facets[field]?.length ?? 0) > 1) {
    next.facets[field] = next.facets[field]?.filter(item => item !== value);
  } else delete next.facets[field];
  return next;
}

function searchRows(rows: readonly IndexRow[], query: DirectoryQuery) {
  const options = Object.fromEntries(facetKeys.map(key => [key, new Map<string, Facet>()])) as Record<FacetKey, Map<string, Facet>>;
  for (const county of counties) options.county.set(facetKey("county", county.name), { name: county.name, count: 0 });
  const active = facetKeys.flatMap(field => {
    const selected = query.facets[field];
    return selected?.length ? [{ field, keys: new Set(selected.map(value => facetKey(field, value))) }] : [];
  });
  const phrase = normalizeSearch(query.q);
  const terms = phrase ? phrase.split(" ") : [];
  const matches: { row: IndexRow; relevance: number }[] = [];
  const improved = new Map<Exclusion, number>();
  let countyKnown = 0;
  let hasStars = false;
  const added = new Set<string>();
  for (const row of rows) {
    if (row.facets.county.length) countyKnown += 1;
    if (row.project.stars != null) hasStars = true;
    if (row.added) added.add(row.added);
    const relevance = score(row, terms, phrase);
    const misses: Exclusion[] = [];
    if (relevance < 0) misses.push("q");
    if (query.paper && !row.paper) misses.push("paper");
    if (query.since && row.activity < query.since) misses.push("since");
    for (const { field, keys } of active) {
      if (!row.facets[field].some(({ key }) => keys.has(key))) misses.push(field);
    }
    if (!misses.length) matches.push({ row, relevance });
    if (misses.length === 1) {
      const [field] = misses;
      improved.set(field, (improved.get(field) ?? 0) + 1);
    }
    for (const field of facetKeys) {
      const eligible = !misses.length || (misses.length === 1 && misses[0] === field);
      for (const value of row.facets[field]) {
        if (eligible) tally(options[field], value);
        else if (!options[field].has(value.key)) options[field].set(value.key, { name: value.name, count: 0 });
      }
    }
  }
  const facets = {} as Record<FacetKey, Facet[]>;
  for (const field of facetKeys) {
    const values = options[field];
    for (const name of query.facets[field] ?? []) {
      const key = facetKey(field, name);
      if (!values.has(key)) values.set(key, { name, count: 0 });
    }
    if (query.facets[field]) {
      query.facets[field] = query.facets[field]?.map(name => values.get(facetKey(field, name))?.name ?? name);
    }
    facets[field] = [...values.values()].sort(field === "year"
      ? (a, b) => b.name.localeCompare(a.name)
      : facetOrder);
  }
  const hasAdded = added.size > 1;
  if ((query.sort === "stars" && !hasStars) || (query.sort === "added" && !hasAdded)) query.sort = "updated";
  const sort = query.sort;
  if (sort === "relevance") matches.sort((a, b) => b.relevance - a.relevance || byActivity(a.row, b.row));
  else if (sort !== "updated") {
    const compare = sort === "name" ? byName : sort === "stars" ? byStars : byAdded;
    matches.sort((a, b) => compare(a.row, b.row));
  }
  const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
  query.page = Math.min(query.page, pageCount);
  const offset = (query.page - 1) * pageSize;
  let suggestion: Suggestion | undefined;
  if (!matches.length) {
    const next = [...improved].sort((a, b) => b[1] - a[1])[0];
    if (next) {
      const [field, count] = next;
      const label = field === "q" ? "Search term" : field === "paper" ? "Has a paper" : field === "since" ? "Updated since" : facetLabels[field];
      suggestion = { field, label, count, query: withoutFilter(query, field) };
    }
  }
  return {
    query, facets, pageCount, countyKnown, hasStars, hasAdded, suggestion,
    matchCount: matches.length, total: rows.length, projects: matches.slice(offset, offset + pageSize).map(({ row }) => row.project),
  };
}

function entitySlug(kind: EntityKind, key: string) {
  if (kind === "lab") return encodeURIComponent(key);
  // The normalized key contains only letters, digits and spaces. Keep a separate
  // prefix for punctuation-only names so new groups cannot rename existing URLs.
  return normalizeSearch(key) ? encodeURIComponent(key.replaceAll(" ", "-")) : "~" + encodeURIComponent(key);
}

export function createDirectoryCatalog(records: readonly DirectoryProject[]) {
  const rows = records.map(indexProject).sort(byActivity);
  const byId = new Map(rows.map(row => [row.project.id, row]));
  const groups = new Map<EntityKind, Map<string, IndexRow[]>>();
  const entities = new Map<EntityKind, Map<string, DirectoryEntity>>();
  const entitySlugs = new Map<EntityKind, Map<string, DirectoryEntity>>();
  for (const kind of entityKinds) {
    const field = entityFacet[kind];
    const kindGroups = new Map<string, IndexRow[]>();
    const names = new Map<string, string>();
    if (kind === "county") for (const { name } of counties) names.set(facetKey(field, name), name);
    for (const row of rows) {
      for (const { key, name } of row.facets[field]) {
        if (!names.has(key)) names.set(key, name);
        const members = kindGroups.get(key);
        if (members) members.push(row);
        else kindGroups.set(key, [row]);
      }
    }
    const byKey = new Map<string, DirectoryEntity>();
    const bySlug = new Map<string, DirectoryEntity>();
    for (const [key, name] of names) {
      const entity = { kind, name, key, slug: entitySlug(kind, key) };
      byKey.set(key, entity);
      bySlug.set(decodeURIComponent(entity.slug), entity);
    }
    groups.set(kind, kindGroups);
    entities.set(kind, byKey);
    entitySlugs.set(kind, bySlug);
  }

  function visible(removed: ReadonlySet<string>, entity?: DirectoryEntity) {
    const source = entity ? groups.get(entity.kind)?.get(entity.key) ?? [] : rows;
    return removed.size ? source.filter(row => !removed.has(row.project.id)) : source;
  }
  function entityFor(kind: EntityKind, name: string) {
    return entities.get(kind)?.get(facetKey(entityFacet[kind], name));
  }
  function dedicated(entity: DirectoryEntity) {
    return entity.kind !== "lab" || (groups.get("lab")?.get(entity.key)?.length ?? 0) >= labPageMinimum;
  }
  function entityHref(kind: EntityKind, name: string): string {
    const entity = entityFor(kind, name);
    if (entity && dedicated(entity)) return entityPath(entity);
    return `${browsePath}?${directoryParams({ facets: { [entityFacet[kind]]: [name] } })}`;
  }

  function list(removed: ReadonlySet<string>, params: URLSearchParams, now: Date, entity?: DirectoryEntity) {
    const scoped = visible(removed, entity);
    const query = readDirectoryQuery(params);
    let scope: Scope | undefined;
    if (entity) {
      const field = entityFacet[entity.kind];
      delete query.facets[field];
      const sample = scoped[0]?.project;
      const named = scoped.find(row => row.project.lab || row.project.owner?.name)?.project;
      scope = {
        entity: named && entity.kind === "lab" ? { ...entity, name: named.lab || named.owner?.name || entity.name } : entity,
        summary: summarize(scoped, now),
        ...(entity.kind === "lab" && sample ? { account: githubAccount(sample), ownerKind: sample.owner?.kind } : {}),
      };
    }
    return { ...searchRows(scoped, query), scope };
  }

  function home(removed: ReadonlySet<string>, now: Date) {
    const publicRows = visible(removed);
    const active = recentlyActive(publicRows, now);
    const addedVaries = new Set(publicRows.map(row => row.added).filter(Boolean)).size > 1;
    const verifiedRows = publicRows.filter(row => row.project.label === "Verified");
    const verified = verifiedRows.slice(0, 3).map(row => row.project);
    const featuredIds = new Set(verified.map(project => project.id));
    return {
      ...summarize(publicRows, now),
      counties: rank(publicRows, "county"), countyKnown: publicRows.filter(row => row.facets.county.length).length,
      years: rank(publicRows, "year").sort((a, b) => b.name.localeCompare(a.name)),
      activeLabs: rank(active, "owner").slice(0, 6).map(account => {
        const lab = entityFor("lab", account.name);
        const named = lab && visible(removed, lab).find(row => row.project.lab || row.project.owner?.name)?.project;
        return { ...account, login: account.name, name: named?.lab || named?.owner?.name || `@${account.name}` };
      }),
      verifiedCount: verifiedRows.length,
      verified,
      recent: publicRows.filter(row => row.activity && !featuredIds.has(row.project.id)).slice(0, 6).map(row => row.project),
      added: addedVaries ? [...publicRows].filter(row => row.added).sort(byAdded).slice(0, 6).map(row => row.project) : [],
      examples: ["medical imaging", "python", "neuroscience"].filter(example => {
        const terms = example.split(" ");
        return publicRows.some(row => score(row, terms, example) >= 0);
      }),
    };
  }

  function project(id: string, removed: ReadonlySet<string>) {
    const row = byId.get(id);
    return row && !removed.has(id) ? row.project : undefined;
  }

  function related(project: DirectoryProject, removed: ReadonlySet<string>) {
    const owner = githubAccount(project);
    const lab = owner && entityFor("lab", owner);
    const institution = project.institution && entityFor("institution", project.institution);
    const other = (row: IndexRow) => row.project.id !== project.id;
    const sameLab = lab ? visible(removed, lab).filter(other).slice(0, 4).map(row => row.project) : [];
    const sameTopic = institution ? visible(removed, institution).filter(row =>
      other(row) && row.facets.topic[0]?.key === facetKey("topic", project.topic) &&
      !sameLab.some(item => item.id === row.project.id)).slice(0, 4).map(row => row.project) : [];
    return { sameLab, sameTopic };
  }

  function publishedEntities(removed: ReadonlySet<string>) {
    return entityKinds.flatMap(kind => [...entities.get(kind)!.values()].filter(entity =>
      dedicated(entity) && (kind === "county" || visible(removed, entity).length)));
  }

  return {
    home, list, project, related, entityHref, publishedEntities,
    projects: (removed: ReadonlySet<string>) => visible(removed).map(row => row.project),
    entityAt: (kind: string, slug: string, removed: ReadonlySet<string>) => {
      const entity = entitySlugs.get(kind as EntityKind)?.get(slug);
      if (entity && dedicated(entity) && (kind === "county" || visible(removed, entity).length)) return entity;
    },
  };
}

export type DirectoryCatalog = ReturnType<typeof createDirectoryCatalog>;
export const directoryCatalog = createDirectoryCatalog(publishedProjects as DirectoryProject[]);
