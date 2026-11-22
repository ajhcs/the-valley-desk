import {
  browsePath,
  counties,
  projectPath,
  type DirectoryProject,
  type DirectoryCatalog,
} from "./public-directory-data";
import {
  contactLink,
  count,
  externalLink,
  healthTopic,
  html,
  partialDate,
  projectRecord,
  searchInput,
  timestamp,
} from "./public-directory-ui";

export const newPath = "/discover/new";
export const feedPath = "/discover/updates.xml";
export const publicationsApi = "/api/directory/publications";
export const pubPath = (id: string) => "/discover/publication/" + encodeURIComponent(id);
export const studiesApi = "/api/directory/studies";
export const studyPath = (id: string) => "/discover/study/" + encodeURIComponent(id);
export const studyId = /^NCT[0-9]{8}$/;
export const facetSlug = (name: string) =>
  name
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.join("-") ?? "";
type Prepared = {
  bind?(...args: (string | number)[]): Prepared;
  all(): Promise<{ results: unknown[]; success?: boolean }>;
};
export type ResearchDb = { prepare(sql: string): Prepared };
export async function rows<T>(db: ResearchDb, sql: string, ...args: (string | number)[]): Promise<T[]> {
  const prepared = db.prepare(sql);
  const query = args.length ? prepared.bind?.(...args) : prepared;
  if (!query) throw Error("Directory binding unavailable");
  const result = await query.all();
  if (result.success === false || !Array.isArray(result.results)) throw Error("Directory query unavailable");
  return result.results as T[];
}

export type Publication = {
  id: string;
  title: string;
  type: string;
  venue: string | null;
  published: string;
  doi?: string | null;
  pmid?: string | null;
  pmcid?: string | null;
  arxiv?: string | null;
  added: string;
  checked: string;
  topic: string;
  terms: string[];
  authors: { name: string }[];
  author_count: number;
  institutions: string[];
  counties: string[];
  label: string;
  connection: string;
  source: string;
  url: string;
  open_access: { url: string | null; status?: string | null; license?: string | null } | null;
  projects: string[];
  published_as: string | null;
  preprint_of: string | null;
  retracted: boolean;
};
export type Institution = {
  id: string;
  name: string;
  aliases: string[];
  sites: { name: string; place: string; county: string; source: string; state?: string }[];
};
export type ClinicalStudy = {
  id: string;
  title: string;
  type: string;
  status: string;
  phases: string[];
  first_posted: string | null;
  last_updated: string | null;
  conditions: string[];
  sites: { facility: string; city: string; state: string; zip: string; county: string; status: string | null }[];
  institutions: string[];
  counties: string[];
  label: "Verified";
  connection: string;
  source: string;
  url: string;
  added: string;
  checked: string;
};
type RecordsByKind = { project: DirectoryProject; publication: Publication; study: ClinicalStudy };
export type ListingKind = keyof RecordsByKind;
export type Listing<K extends ListingKind = ListingKind> = {
  [P in K]: { kind: P; record: RecordsByKind[P] };
}[K];
export const publicationTitle = (p: Pick<Publication, "title">) =>
  p.title.replace(/<\/?(?:em|strong|i|b|sub|sup)>/gi, "");
/** Catalogue display drops the closing period that bibliographic sources add to titles. */
export const displayTitle = (p: Pick<Publication, "title">) => publicationTitle(p).replace(/(?<![.\s])\.$/u, "");
const typeNames: Record<string, string> = {
  article: "Article",
  review: "Review",
  "clinical-trial-report": "Clinical trial report",
  editorial: "Editorial",
  "case-report": "Case report",
  letter: "Letter",
  "conference-abstract": "Conference abstract",
  preprint: "Preprint",
  "dataset-paper": "Data paper",
  other: "Publication",
};
export const publicationType = (type: string) =>
  typeNames[type] ?? (type ? type[0].toUpperCase() + type.slice(1).replaceAll("-", " ") : "Publication");

const templates: {
  [K in ListingKind]: {
    name: string;
    plural: string;
    path: (id: string) => string;
    title: (record: RecordsByKind[K]) => string;
    card: (record: RecordsByKind[K], catalog: DirectoryCatalog) => string;
  };
} = {
  project: {
    name: "Software project",
    plural: "Software projects",
    path: (id) => projectPath({ id }),
    title: (r) => r.name,
    card: (r, catalog) => projectRecord(catalog, r, "added"),
  },
  publication: {
    name: "Publication",
    plural: "Publications",
    path: pubPath,
    title: displayTitle,
    card: publicationRecord,
  },
  study: {
    name: "Clinical study",
    plural: "Clinical studies",
    path: studyPath,
    title: (r) => r.title,
    card: studyRecord,
  },
};
export const listingTitle = <K extends ListingKind>(item: Listing<K>) => templates[item.kind].title(item.record);
export const listingPath = (item: { kind: ListingKind; record: { id: string } }) =>
  templates[item.kind].path(item.record.id);
function card<K extends ListingKind>(item: Listing<K>, catalog: DirectoryCatalog) {
  return templates[item.kind].card(item.record, catalog);
}
export const fields = ["institution", "topic", "county"] as const;
export type Options = Record<(typeof fields)[number], Map<string, string>>;
export function institutionFor(refs: Institution[], value: string) {
  const key = facetSlug(value);
  return refs.find((ref) => [ref.id, ref.name, ...ref.aliases].some((name) => facetSlug(name) === key));
}
export function optionsFor(catalog: DirectoryCatalog, removed: Set<string>, refs: Institution[]): Options {
  const options: Options = { institution: new Map(), topic: new Map(), county: new Map() };
  for (const entity of catalog.publishedEntities(removed)) {
    if (entity.kind === "institution" && institutionFor(refs, entity.name)) continue;
    if (entity.kind !== "lab") options[entity.kind].set(entity.slug, entity.name);
  }
  for (const ref of refs) options.institution.set(ref.id, ref.name);
  for (const c of counties) options.county.set(facetSlug(c.name), c.name);
  return options;
}

export const pageNumber = (params: URLSearchParams) =>
  Math.max(1, Math.min(10000000, Number(params.get("page")) || 1) | 0);
export const dateBound = (value?: string | null) =>
  value && /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/.test(value) ? value : "";
function searchSource(params: URLSearchParams, refs: Institution[]) {
  const where: string[] = [];
  const args: string[] = [];
  const terms = params
    .get("q")
    ?.slice(0, 200)
    .match(/[\p{L}\p{N}]+/gu);
  if (terms?.length) {
    where.push(
      "id IN (SELECT l.id FROM research_search JOIN research_listings l ON l.rowid=research_search.rowid WHERE research_search MATCH ?)",
    );
    const institutions = refs
      .filter((ref) =>
        [ref.name, ...ref.aliases].some((name) =>
          terms.every((term) => facetSlug(name).includes(facetSlug(term))),
        ),
      )
      .map((ref) => ref.id);
    args.push(terms.map((term) => '"' + term + '"*').join(" AND "));
    if (institutions.length) {
      where[0] =
        "(" +
        where[0] +
        " OR id IN (SELECT id FROM research_facets WHERE field='institution' AND value IN (SELECT value FROM json_each(?))))";
      args.push(JSON.stringify(institutions));
    }
  }
  const facetQueries: string[] = [];
  let scope: Scope | undefined;
  let simple = !where.length;
  for (const key of [...fields, "label"]) {
    const selected = params
      .getAll(key)
      .filter(Boolean)
      .slice(0, 15)
      .map(facetSlug)
      .map((value) => (key === "institution" ? (institutionFor(refs, value)?.id ?? value) : value));
    if (selected.length) {
      facetQueries.push(
        "SELECT id FROM research_facets WHERE field=? AND value IN (" +
          selected.map(() => "?").join(",") +
          ")",
      );
      args.push(key, ...selected);
      if (key !== "label" && selected.length === 1) scope = { field: key as Scope["field"], value: selected[0] };
      else simple = false;
    }
  }
  if (facetQueries.length) where.push("id IN (" + facetQueries.join(" INTERSECT ") + ")");
  if (facetQueries.length > 1) simple = false;
  const kind = params.get("kind") ?? "";
  if (kind) {
    where.push("kind=?");
    args.push(kind);
  }
  const conditions = where.length;
  // Optional date bounds: added_from/added_to on the listing date, date_from/date_to on the
  // published or last-push date. A bound is YYYY, YYYY-MM or YYYY-MM-DD and is inclusive.
  for (const [key, column] of [["added", "added"], ["date", "activity"]]) {
    const [after, before] = ["_from", "_to"].map((end) => dateBound(params.get(key + end)));
    if (after) where.push(column + ">=?"), args.push(after);
    if (before) where.push(column + "<>'' AND " + column + "<=?"), args.push(before + "~");
  }
  const from = " FROM research_visible" + (where.length ? " WHERE " + where.join(" AND ") : "");
  // Only one facet value and/or a kind: stored counts answer the totals, and a large scope can
  // be read in listing order instead of being collected and sorted.
  const stored = simple && where.length === conditions ? { scope, kind } : undefined;
  return { from, args, facetCount: facetQueries.length, stored };
}

type Scope = { field: (typeof fields)[number]; value: string };
type KindCount = { kind: ListingKind; n: number; works: number };

/**
 * Totals written by ops/research-summary.sql for the whole directory or one facet value.
 * Returns nothing while those tables are missing, mid-refresh or have no row for the scope,
 * and the caller then counts directly.
 */
async function storedCounts(db: ResearchDb, scope: Scope | undefined, kind: string) {
  try {
    const found = await rows<KindCount & { everything: number | null; of_kind: number | null }>(
      db,
      "SELECT kind,n,works,(SELECT sum(n) FROM research_summary_kinds WHERE scope_field='' AND scope_value='') everything,(SELECT n FROM research_summary_kinds WHERE scope_field='' AND scope_value='' AND kind=?) of_kind FROM research_summary_kinds WHERE scope_field=? AND scope_value=? ORDER BY kind",
      kind,
      scope?.field ?? "",
      scope?.value ?? "",
    );
    const everything = found[0]?.everything;
    if (!everything) return undefined;
    return {
      everything,
      // A kind that is most of the directory is spread through every listing order.
      commonKind: !!kind && (found[0].of_kind ?? 0) * 2 > everything,
      counts: found.filter((row) => !kind || row.kind === kind).map(({ kind, n, works }) => ({ kind, n, works })),
    };
  } catch {
    return undefined;
  }
}

/**
 * Whether an institution's publications (within a topic when given) are numerous enough that the
 * few most recent are cheaper to find by reading in date order. False without stored counts.
 */
export async function manyPublications(db: ResearchDb, institution: string, topic: string) {
  const everything = "(SELECT sum(n) FROM research_summary_kinds WHERE scope_field='' AND scope_value='') everything";
  try {
    const [row] = await rows<{ n: number; everything: number | null }>(
      db,
      topic
        ? `SELECT n,${everything} FROM research_summary_facets WHERE scope_field='institution' AND scope_value=? AND field='topic' AND value=?`
        : `SELECT n,${everything} FROM research_summary_kinds WHERE scope_field='institution' AND scope_value=? AND kind='publication'`,
      institution,
      ...(topic ? [topic] : []),
    );
    return !!row?.everything && row.n * row.n > 30 * row.everything;
  } catch {
    return false;
  }
}

/**
 * Lists one facet value, or one common kind, in listing order. Reading in order stops after the
 * rows shown, so it wins when the matches are a large share of the directory; a small scope is
 * cheaper to collect and sort. The unary plus keeps SQLite from collecting by kind or by id first.
 */
function orderedScan(
  stored: { scope?: Scope; kind: string },
  known: { everything: number; commonKind: boolean },
  total: number,
  order: string,
  wanted: number,
) {
  const { scope, kind } = stored;
  if (scope ? total * total <= wanted * known.everything : !known.commonKind) return undefined;
  const where = [
    ...(scope ? ["EXISTS(SELECT 1 FROM research_facets f WHERE f.field=? AND f.value=? AND f.id=+v.id)"] : []),
    ...(kind ? [(known.commonKind ? "+" : "") + "kind=?"] : []),
  ];
  return {
    sql: "SELECT kind,record FROM research_visible v WHERE " + where.join(" AND ") + " ORDER BY " + order,
    args: [...(scope ? [scope.field, scope.value] : []), ...(kind ? [kind] : [])],
  };
}

function readListing(row: { kind: Listing["kind"]; record: string }): Listing {
  return { kind: row.kind, record: JSON.parse(row.record) };
}
export async function researchFeed(db: ResearchDb, params: URLSearchParams, refs: Institution[]) {
  const { from, args, stored } = searchSource(params, refs);
  const page = pageNumber(params);
  const known = stored && (stored.scope || stored.kind) ? await storedCounts(db, stored.scope, stored.kind) : undefined;
  const scan =
    known && orderedScan(stored!, known, known.counts.reduce((sum, row) => sum + row.n, 0), "added DESC,id", page * 24 + 1);
  const result = await rows<{ kind: Listing["kind"]; record: string }>(
    db,
    (scan ? scan.sql : "SELECT kind,record" + from + " ORDER BY added DESC,id") + " LIMIT 25 OFFSET ?",
    ...(scan ? scan.args : args),
    (page - 1) * 24,
  );
  return { page, items: result.slice(0, 24).map(readListing), hasMore: result.length > 24 };
}
export async function researchQuery(db: ResearchDb, params: URLSearchParams, refs: Institution[]) {
  const { from, args, facetCount, stored } = searchSource(params, refs);
  const sort = params.get("sort");
  const sortColumn = sort === "name" ? "title" : sort === "activity" ? "activity" : "added";
  const order = sortColumn + (sort === "name" ? " COLLATE NOCASE,id" : " DESC,id");
  if (facetCount > 1) {
    // Reuse the facet intersection for exact counts and the sorted page.
    // Keep large bylines out of the temporary table and fetch only the final page's records.
    const requested = pageNumber(params);
    const data = await rows<
      | { kind: ListingKind; n: number; works: number; record: null }
      | { kind: ListingKind; n: null; works: null; record: string }
    >(
      db,
      `
      WITH matches AS MATERIALIZED (SELECT id,kind,group_id,${sortColumn} ${from}),
      totals AS (SELECT kind,count(*) n,count(DISTINCT group_id) works FROM matches GROUP BY kind),
      page AS (SELECT id FROM matches ORDER BY ${order} LIMIT 24
        OFFSET (SELECT 24 * max(0,min(? - 1,(coalesce(sum(n),0)-1)/24)) FROM totals))
      SELECT kind,n,works,NULL AS record,NULL AS ${sortColumn},NULL AS id FROM totals
      UNION ALL
      SELECT l.kind,NULL,NULL,l.record,l.${sortColumn},l.id FROM page JOIN research_listings l USING(id)
      ORDER BY n DESC,${order}`,
      ...args,
      requested,
    );
    const counts = data.flatMap((row) => row.n === null ? [] : [{ kind: row.kind, n: row.n, works: row.works }]);
    const total = counts.reduce((sum, row) => sum + row.n, 0);
    const items = data.flatMap((row) => row.n === null ? [readListing(row)] : []);
    return { counts, total, page: Math.min(requested, Math.max(1, Math.ceil(total / 24))), items };
  }
  const known = stored ? await storedCounts(db, stored.scope, stored.kind) : undefined;
  const counts =
    known?.counts ??
    (await rows<KindCount>(db, "SELECT kind,count(*) n,count(DISTINCT group_id) works" + from + " GROUP BY kind", ...args));
  const total = counts.reduce((sum, row) => sum + row.n, 0);
  const page = Math.min(pageNumber(params), Math.max(1, Math.ceil(total / 24)));
  const scan = known && orderedScan(stored!, known, total, order, page * 24);
  const result = await rows<{ kind: Listing["kind"]; record: string }>(
    db,
    (scan ? scan.sql : "SELECT kind,record" + from + " ORDER BY " + order) + " LIMIT 24 OFFSET ?",
    ...(scan ? scan.args : args),
    (page - 1) * 24,
  );
  return {
    items: result.map(readListing),
    counts,
    page,
    total,
  };
}
export type Results = Awaited<ReturnType<typeof researchQuery>>;

export function projectQuery(
  catalog: DirectoryCatalog,
  removed: Set<string>,
  params: URLSearchParams,
  options: Options,
  refs: Institution[] = [],
): Results {
  const query = new URLSearchParams(params);
  for (const key of fields) {
    const values = query.getAll(key);
    query.delete(key);
    for (const value of values) {
      const ref = key === "institution" ? institutionFor(refs, value) : undefined;
      for (const name of ref ? [ref.name, ...ref.aliases] : [options[key].get(facetSlug(value)) ?? value])
        query.append(key, name);
    }
  }
  query.set("sort", "added");
  const result = catalog.list(removed, query, new Date());
  if (params.get("kind") && params.get("kind") !== "project") return { items: [], total: 0, page: 1, counts: [] };
  return {
    items: result.projects.map((record) => ({ kind: "project", record })),
    page: result.query.page,
    total: result.matchCount,
    counts: [{ kind: "project", n: result.matchCount, works: result.matchCount }],
  };
}

export const topicPath = (topic: string) => "/discover/topic/" + facetSlug(topic);
/** A health topic links to its landing page. Other topic labels are plain text. */
export function topicLink(topic: string) {
  return healthTopic(topic) ? `<a href="${html(topicPath(topic))}">${html(topic)}</a>` : `<span>${html(topic)}</span>`;
}
function evidence(p: Publication) {
  return `<a class="evidence${p.label === "Verified" ? " evidence-verified" : ""}" href="/discover/methodology#regional-evidence">${html(p.label)}</a> ${html(p.connection)} ${externalLink(p.source, "Affiliation source")}`;
}
function bylinePreview(p: Publication, shown = 3) {
  const names = p.authors.slice(0, shown).map((a) => html(a.name));
  const total = Math.max(p.author_count, p.authors.length);
  return total > names.length ? `${names.join(", ")} <span class="muted">and others (${count(total)} authors)</span>` : names.join(", ");
}
function publicationRecord(p: Publication) {
  return `<li class="record record-publication${p.retracted ? " is-retracted" : ""}">
    <p class="record-kind"><span class="kind">${html(publicationType(p.type))}</span>${p.venue ? `<span class="record-venue">${html(p.venue)}</span>` : ""}${partialDate(p.published) ? `<span>${partialDate(p.published)}</span>` : ""}${p.retracted ? '<strong class="retracted">Retracted</strong>' : ""}</p>
    <h3 class="record-title"><a href="${html(pubPath(p.id))}">${html(displayTitle(p))}</a></h3>
    <p class="record-byline">${bylinePreview(p)}</p>
    <p class="record-evidence">${evidence(p)}</p>
    <p class="record-topic">${topicLink(p.topic)}${timestamp(p.added) ? `<span>Added ${timestamp(p.added)}</span>` : ""}</p>
  </li>`;
}
const studyNames: Record<string, string> = {
  INTERVENTIONAL: "Interventional trial",
  OBSERVATIONAL: "Observational study",
  EXPANDED_ACCESS: "Expanded access",
};
export function registryLabel(value: string) {
  return studyNames[value] ?? value.toLowerCase().replaceAll("_", " ").replace(/^./, (s) => s.toUpperCase());
}
function studyRecord(study: ClinicalStudy) {
  return `<li class="record record-study">
    <p class="record-kind"><span class="kind">${html(registryLabel(study.type))}</span><span>${html(study.id)}</span><span>${html(registryLabel(study.status))}</span></p>
    <h3 class="record-title"><a href="${studyPath(study.id)}">${html(study.title)}</a></h3>
    <p class="record-evidence">${html(study.counties.map((county) => county + " County").join(", "))} · ClinicalTrials.gov</p>
    <p class="record-topic"><span>Added ${timestamp(study.added)}</span></p>
  </li>`;
}
export function renderStudy(study: ClinicalStudy) {
  return `<article class="frame page prose-page">
    <nav class="breadcrumb" aria-label="Directory breadcrumb"><a href="${browsePath}?kind=study">Clinical studies</a></nav>
    <p class="record-kind">${html(study.id)} · ${html(registryLabel(study.type))}</p>
    <h1>${html(study.title)}</h1>
    <p>Overall registry status <strong>${html(registryLabel(study.status))}</strong></p>
    ${study.phases.length && study.phases.some((phase) => phase !== "NA") ? `<p>${html(study.phases.filter((phase) => phase !== "NA").map((phase) => registryLabel(phase).replace(/phase(?=[0-9])/i, "Phase ")).join(" · "))}</p>` : ""}
    ${study.conditions.length ? `<p>Conditions ${html(study.conditions.join(", "))}</p>` : ""}
    <h2>Delaware Valley sites</h2>
    <ul>${study.sites.map((site) => `<li>${html(site.facility)} · ${html(site.city)}, ${html(site.state)} · ${html(site.county)} County${site.status ? " · " + html(registryLabel(site.status)) : ""}</li>`).join("")}</ul>
    ${study.first_posted ? `<p>First posted ${partialDate(study.first_posted)}</p>` : ""}
    ${study.last_updated ? `<p>Registry updated ${partialDate(study.last_updated)}</p>` : ""}
    <p>Added to the directory ${timestamp(study.added)}</p>
    <p>${externalLink(study.source, "View this study on ClinicalTrials.gov")}</p>
  </article>`;
}
export function renderListingCards(items: Listing[], catalog: DirectoryCatalog) {
  return `<ol class="records" data-view="full">${items.map((item) => card(item, catalog)).join("")}</ol>`;
}

export function feedUrl(params: URLSearchParams) {
  const filters = new URLSearchParams(params);
  for (const key of ["page", "view", "sort"]) filters.delete(key);
  return feedPath + (filters.size ? "?" + filters : "");
}

/** Plain counts by kind, publications first, for headings, descriptions and the results bar. */
export function kindCounts(counts: Results["counts"], withVersions = false) {
  return [...counts]
    .filter((r) => r.n)
    .sort((a, b) => (a.kind === "publication" ? -1 : b.kind === "publication" ? 1 : 0))
    .map(
      (r) =>
        count(r.works) +
        " " +
        (r.works === 1 ? templates[r.kind].name : templates[r.kind].plural).toLowerCase() +
        (withVersions && r.n > r.works ? ` (${count(r.n)} records including versions)` : ""),
    )
    .join(" and ");
}

function pageLinks(path: string, params: URLSearchParams, page: number, totalPages: number) {
  if (totalPages < 2) return "";
  const link = (n: number, label: string, rel?: string) => {
    const next = new URLSearchParams(params);
    if (n > 1) next.set("page", String(n));
    else next.delete("page");
    return `<a href="${html(path + (next.size ? "?" + next : ""))}"${rel ? ` rel="${rel}"` : ""}>${label}</a>`;
  };
  const shown = [...new Set([1, page - 1, page, page + 1, totalPages])].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  return `<nav class="pagination" aria-label="Results pages"><div class="page-links">
    ${page > 1 ? link(page - 1, "Previous", "prev") : ""}
    ${shown
      .map(
        (n, i) =>
          (i && n > shown[i - 1] + 1 ? '<span aria-hidden="true">…</span>' : "") +
          (n === page ? `<span class="current-page" aria-current="page">${count(n)}</span>` : link(n, count(n))),
      )
      .join("")}
    ${page < totalPages ? link(page + 1, "Next", "next") : ""}
  </div><p class="muted">Page ${count(page)} of ${count(totalPages)}</p></nav>`;
}

export type ResearchPage = {
  header: string;
  path: string;
  params: URLSearchParams;
  data: Results;
  catalog: DirectoryCatalog;
  options: Options;
  enabled: boolean;
  studiesAvailable?: boolean;
  scope?: string;
  byDate?: boolean;
  aside?: string;
};

export function renderResearch({ header, path, params, data, catalog, options, enabled, studiesAvailable, scope = "", byDate, aside }: ResearchPage) {
  function select(name: string, label: string, choices: [string, string][], all = "All") {
    const selected = params.get(name) ?? "";
    return `<label>${label}<select form="research-form" name="${name}"><option value="">${all}</option>${choices
      .map(
        ([v, n]) =>
          `<option value="${html(v)}"${v === selected || v === facetSlug(selected) ? " selected" : ""}>${html(n)}</option>`,
      )
      .join("")}</select></label>`;
  }
  const names = { institution: ["Institution", "All institutions"], topic: ["Topic", "All topics"], county: ["County", "All counties"] };
  const totalPages = Math.ceil(data.total / 24);
  const first = (data.page - 1) * 24 + 1;
  const range =
    data.total > 24 ? `<span class="muted"> · listings ${count(first)}–${count(first + data.items.length - 1)}</span>` : "";
  let list = "";
  if (!data.items.length) {
    list = `<div class="empty-result"><h2>No matching listings</h2><p>Try fewer words or <a href="${html(path)}">clear the filters</a>.</p></div>`;
  } else if (byDate) {
    const days = new Map<string, Listing[]>();
    for (const item of data.items) days.set(item.record.added ?? "", [...(days.get(item.record.added ?? "") ?? []), item]);
    list = [...days]
      .map(
        ([day, items]) =>
          `<section class="day-group"><h2>${timestamp(day) ? `Added ${timestamp(day)}` : "Date added not recorded"}</h2>${renderListingCards(items, catalog)}</section>`,
      )
      .join("");
  } else list = `<h2 class="sr-only">Listings</h2>${renderListingCards(data.items, catalog)}`;
  const filters = [
    enabled
      ? select("kind", "Kind", (["publication", "project", ...(studiesAvailable ? ["study" as const] : [])] as const).map((kind) => [kind, templates[kind].plural]), studiesAvailable ? "All kinds" : "Publications and software")
      : "",
    ...fields
      .filter((f) => f !== scope)
      .map((f) =>
        select(
          f,
          names[f][0],
          [...options[f]].filter(([, n]) => f !== "topic" || healthTopic(n)).sort((a, b) => a[1].localeCompare(b[1])),
          names[f][1],
        ),
      ),
    path !== newPath && enabled
      ? `<label>Order<select form="research-form" name="sort">${[
          ["added", "Date added"],
          ["activity", studiesAvailable ? "Publication, code push or registry update date" : "Publication date or last code push"],
          ["name", "Title A–Z"],
        ]
          .map(([v, n]) => `<option value="${v}"${params.get("sort") === v ? " selected" : ""}>${n}</option>`)
          .join("")}</select></label>`
      : "",
  ].filter(Boolean);
  return `<div class="frame page research-page">${header}
    <form id="research-form" class="research-search" action="${html(path)}" method="get" role="search">${searchInput(params.get("q") ?? "")}</form>
    <div class="research-layout${aside ? " has-index" : ""}">
      <div class="research-filters">
        <h2 class="rail-heading">Refine</h2>
        ${filters.join("")}
        <button class="button secondary" type="submit" form="research-form">Apply</button>
        ${path === browsePath ? '<p class="rail-note"><a href="/discover/works?tools=project">Software filters: language, license, GitHub activity</a></p>' : ""}
      </div>
      <section class="research-results" aria-label="Listings">
        <div class="results-bar"><p class="results-count"><strong>${kindCounts(data.counts, true) || "No matching listings"}</strong>${range}</p>
        <p class="results-links"><a href="${html(feedUrl(params))}">RSS feed of additions</a></p></div>
        ${list}
        ${pageLinks(path, params, data.page, totalPages)}
      </section>
      ${aside ? `<div class="research-index">${aside}</div>` : ""}
    </div>
  </div>`;
}

const identifierLinks: [keyof Publication, string, (v: string) => string][] = [
  ["doi", "DOI", (v) => "https://doi.org/" + v.split("/").map(encodeURIComponent).join("/")],
  ["pmid", "PubMed ID", (v) => "https://pubmed.ncbi.nlm.nih.gov/" + encodeURIComponent(v) + "/"],
  ["pmcid", "PubMed Central ID", (v) => "https://europepmc.org/article/PMC/" + encodeURIComponent(v)],
  ["arxiv", "arXiv ID", (v) => "https://arxiv.org/abs/" + encodeURIComponent(v)],
];

export function renderPublication(
  p: Publication,
  refs: Institution[],
  related: Listing[],
  more: { heading: string; items: Listing[]; href: string } | undefined,
  catalog: DirectoryCatalog,
) {
  const entity = (kind: string, key: string, name: string) =>
    `<a href="/discover/${kind}/${encodeURIComponent(key)}">${html(name)}</a>`;
  const places = p.institutions.map((id) =>
    entity("institution", id, refs.find((ref) => ref.id === id)?.name ?? id),
  );
  const counties = p.counties.map((c) => entity("county", facetSlug(c), c + " County"));
  const total = Math.max(p.author_count, p.authors.length);
  const facts: [string, string][] = [
    ["Type", html(publicationType(p.type))],
    ["Venue", p.venue ? html(p.venue) : ""],
    ["Published", partialDate(p.published)],
    ["Topic", topicLink(p.topic)],
    ["Subject terms", p.terms.map((t) => html(t)).join("; ")],
    ...identifierLinks.map(([key, label, url]): [string, string] => {
      const value = p[key];
      return [label, typeof value === "string" && value ? externalLink(url(value), value) || html(value) : ""];
    }),
    ["Open access", p.open_access?.url ? externalLink(p.open_access.url, p.open_access.status ? `Yes, ${p.open_access.status}` : "Yes") : ""],
    ["Added to directory", timestamp(p.added)],
    ["Source checked", timestamp(p.checked)],
  ];
  return `<article class="frame page record-page publication-page">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${browsePath}">Directory</a>${healthTopic(p.topic) ? `<span aria-hidden="true">/</span>${topicLink(p.topic)}` : ""}</nav>
    <header class="record-head">
      <p class="record-kind"><span class="kind">${html(publicationType(p.type))}</span>${p.venue ? `<span>${html(p.venue)}</span>` : ""}${partialDate(p.published) ? `<span>Published ${partialDate(p.published)}</span>` : ""}</p>
      <h1>${html(displayTitle(p))}</h1>
      ${p.retracted ? '<p class="retracted-notice"><strong>Retracted publication.</strong> The source record marks this paper as retracted.</p>' : ""}
      <p class="byline">${p.authors.map((a) => html(a.name)).join(", ")}</p>
      ${total > p.authors.length ? `<p class="muted">${count(p.authors.length)} of ${count(total)} authors shown in byline order.</p>` : ""}
      <p class="record-actions">${externalLink(p.url, "Read the publication ↗", "button primary")} ${externalLink(p.open_access?.url, "Open access copy ↗", "button secondary")}</p>
    </header>
    <div class="record-body">
      <section class="record-section" aria-labelledby="connection-title">
        <h2 id="connection-title">Regional connection</h2>
        <p class="record-evidence">${evidence(p)}</p>
        <dl class="facts">
          ${places.length ? `<div><dt>${places.length === 1 ? "Institution" : "Institutions"}</dt><dd>${places.join(", ")}</dd></div>` : ""}
          ${counties.length ? `<div><dt>${counties.length === 1 ? "County" : "Counties"}</dt><dd>${counties.join(", ")}</dd></div>` : ""}
        </dl>
      </section>
      <section class="record-section" aria-labelledby="record-title">
        <h2 id="record-title">Publication record</h2>
        <dl class="facts">${facts
          .filter(([, v]) => v)
          .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
          .join("")}</dl>
      </section>
    </div>
    ${related.length ? `<section class="record-section related"><h2>Connected research</h2><ul class="plain-list">${related.map((i) => `<li><span class="muted">${i.kind === "project" ? "Software" : "Publication version"}</span> <a href="${html(listingPath(i))}">${html(listingTitle(i))}</a></li>`).join("")}</ul></section>` : ""}
    ${more?.items.length ? `<section class="related"><div class="section-heading"><h2>${html(more.heading)}</h2><a href="${html(more.href)}">More from this institution</a></div>${renderListingCards(more.items, catalog)}</section>` : ""}
    <p class="record-report">${contactLink("Report a correction or request removal", undefined, `Directory correction or removal for ${p.id}`)}</p>
  </article>`;
}
export function rss(
  origin: string,
  params: URLSearchParams,
  data: { items: Listing[]; page: number; hasMore: boolean },
  options: Options,
) {
  const scope = fields.flatMap((field) =>
    params
      .getAll(field)
      .filter(Boolean)
      .map((v) => options[field].get(facetSlug(v)) ?? v),
  );
  if (params.get("kind")) scope.push(params.get("kind")!);
  if (params.get("q")) scope.push(params.get("q")!);
  const self = new URL(feedUrl(params), origin);
  if (data.page > 1) self.searchParams.set("page", String(data.page));
  const next = new URL(self);
  next.searchParams.set("page", String(data.page + 1));
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><atom:link rel="self" type="application/rss+xml" href="${html(self.href)}"/>${data.hasMore ? `<atom:link rel="next" type="application/rss+xml" href="${html(next.href)}"/>` : ""}<title>The Valley Desk · Research additions${scope.length ? " · " + html(scope.join(" · ")) : ""}</title><link>${html(origin + newPath + "?" + params)}</link><description>Listings ordered by date added to the directory.</description>${data.items
    .map((i) => {
      const link = html(origin + listingPath(i));
      const day = i.record.added;
      return `<item><title>${html(listingTitle(i))}</title><link>${link}</link><guid>${link}</guid><category>${i.kind}</category><description>${html(i.record.connection ?? "")}</description>${day ? `<pubDate>${new Date(day + "T00:00:00Z").toUTCString()}</pubDate>` : ""}</item>`;
    })
    .join("")}</channel></rss>`;
}
