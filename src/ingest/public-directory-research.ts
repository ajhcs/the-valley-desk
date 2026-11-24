import { datasetUseGuidance } from "./directory-use-guidance";
import { renderUseGuidance } from "./public-directory-ui";
import { regionalDataPath, type RegionalData, type DirectoryAccess } from "./regional-data-contract";
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
  evidenceMark,
  externalLink,
  feedbackBlock,
  healthTopic,
  html,
  kindIcon,
  namedLinks,
  partialDate,
  projectRecord,
  regionalLabel,
  searchInput,
  sourceIcon,
  timestamp,
  topicTag,
} from "./public-directory-ui";
import { icon, type IconName } from "./public-directory-icons";
import institutionRegistry from "../content/public-directory-institutions.json";

/** Institution display names by reference ID, for listing cards that carry only IDs. */
const institutionNames = new Map((institutionRegistry as { id: string; name: string }[]).map((ref) => [ref.id, ref.name]));
const institutionLinks = (ids: string[]) =>
  ids.map((id) => `<a href="/discover/institution/${encodeURIComponent(id)}">${html(institutionNames.get(id) ?? id)}</a>`);

export const newPath = "/discover/new";
export const feedPath = "/discover/updates.xml";
export const publicationsApi = "/api/directory/publications";
export const pubPath = (id: string) => "/discover/publication/" + encodeURIComponent(id);
export const studiesApi = "/api/directory/studies";
export const studyPath = (id: string) => "/discover/study/" + encodeURIComponent(id);
export const studyId = /^NCT[0-9]{8}$/;
export const datasetsApi = "/api/directory/datasets";
export const datasetsPath = "/discover/datasets";
export const datasetPath = (id: string) => "/discover/dataset/" + encodeURIComponent(id);
/** The identifier forms of the dataset contract; ops/load-research.py checks the same set. */
export const datasetId =
  /^(geo:GSE[0-9]+|bioproject:PRJ[A-Z]{2}[0-9]+|sra:[SED]RP[0-9]+|dbgap:phs[0-9]{6}|ega:EGA[SD][0-9]{11}|pride:PXD[0-9]{6}|arrayexpress:E-[A-Z]{4}-[0-9]+|pdb-set:(doi:10\.[0-9]{4,}\/\S+|pmid:[0-9]+|arxiv:\S+)|doi:10\.[0-9]{4,}\/[^A-Z\s]+)$/;
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
export type Access = DirectoryAccess;
export type Dataset = {
  id: string;
  title: string;
  summary: string;
  data_type: string;
  access: Access;
  repository: string;
  accessions: string[];
  url: string;
  institutions: string[];
  counties: string[];
  label: string;
  connection: string;
  source: string;
  papers: string[];
  paper_provenance?: { paper: string; relation: "produced" | "linked" }[];
  topic: string;
  released: string | null;
  added: string;
  checked: string;
  size: string | null;
  format: string | null;
  license: string | null;
};
type RecordsByKind = { project: DirectoryProject; publication: Publication; study: ClinicalStudy; dataset: Dataset; "regional-data": RegionalData };
export type ListingKind = keyof RecordsByKind;
export type Listing<K extends ListingKind = ListingKind> = {
  [P in K]: { kind: P; record: RecordsByKind[P] };
}[K];
export const publicationTitle = (p: Pick<Publication, "title">) =>
  p.title.replace(/<\/?(?:em|strong|i|b|sub|sup)>/gi, "");
/** Catalogue display drops the closing period that bibliographic sources add to titles. */
/** PubMed wraps translated titles in square brackets; the catalogue shows the title without them. */
export const displayTitle = (p: Pick<Publication, "title">) =>
  publicationTitle(p).replace(/^\[([^[\]]+)\]\.?$/u, "$1").replace(/(?<![.\s])\.$/u, "");
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
  "regional-data": { name: "Regional data", plural: "Regional data", path: regionalDataPath, title: (r) => r.title, card: regionalDataCard },
  dataset: {
    name: "Dataset",
    plural: "Datasets",
    path: datasetPath,
    title: (r) => r.title,
    card: datasetRecord,
  },
};
export const listingTitle = <K extends ListingKind>(item: Listing<K>) => templates[item.kind].title(item.record);
export const listingPath = (item: { kind: ListingKind; record: { id: string } }) =>
  templates[item.kind].path(item.record.id);
function card<K extends ListingKind>(item: Listing<K>, catalog: DirectoryCatalog) {
  return templates[item.kind].card(item.record, catalog);
}
export const fields = ["institution", "topic", "county"] as const;
/** Facets only datasets carry. Their filters appear on the datasets page. */
export const datasetFields = ["access", "datatype", "repository"] as const;
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
export const searchCountCap = 2000;

function searchSource(params: URLSearchParams, refs: Institution[], cap = searchCountCap) {
  const where: string[] = [];
  const args: string[] = [];
  // The same filters written against the listing row `l`, for the relevance-ordered page.
  const ranked: string[] = [];
  const rankedArgs: string[] = [];
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
  for (const key of [...fields, "label", ...datasetFields]) {
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
      ranked.push(
        "EXISTS(SELECT 1 FROM research_facets f WHERE f.field=? AND f.value IN (" + selected.map(() => "?").join(",") + ") AND f.id=l.id)",
      );
      rankedArgs.push(key, ...selected);
      // Stored counts cover institution, topic and county scopes only.
      if ((fields as readonly string[]).includes(key) && selected.length === 1) scope = { field: key as Scope["field"], value: selected[0] };
      else simple = false;
    }
  }
  if (facetQueries.length) where.push("id IN (" + facetQueries.join(" INTERSECT ") + ")");
  if (facetQueries.length > 1) simple = false;
  const kind = params.get("kind") ?? "";
  if (kind === "__datasets") {
    where.push("kind IN ('dataset','regional-data')");
    ranked.push("l.kind IN ('dataset','regional-data')");
    simple = false;
  } else if (kind) {
    where.push("kind=?");
    args.push(kind);
    ranked.push("l.kind=?");
    rankedArgs.push(kind);
  }
  const conditions = where.length;
  // Optional date bounds: added_from/added_to on the listing date, date_from/date_to on the
  // published or last-push date. A bound is YYYY, YYYY-MM or YYYY-MM-DD and is inclusive.
  for (const [key, column] of [["added", "added"], ["date", "activity"]]) {
    const [after, before] = ["_from", "_to"].map((end) => dateBound(params.get(key + end)));
    if (after) where.push(column + ">=?"), args.push(after), ranked.push("l." + column + ">=?"), rankedArgs.push(after);
    if (before) {
      where.push(column + "<>'' AND " + column + "<=?"), args.push(before + "~");
      ranked.push("l." + column + "<>'' AND l." + column + "<=?"), rankedArgs.push(before + "~");
    }
  }
  const from = " FROM research_visible" + (where.length ? " WHERE " + where.join(" AND ") : "");
  // Only one facet value and/or a kind: stored counts answer the totals, and a large scope can
  // be read in listing order instead of being collected and sorted.
  const stored = simple && where.length === conditions ? { scope, kind } : undefined;
  const relevance =
    // Institution names need no separate match here: each listing's institution IDs are in its
    // indexed keywords, so a search for "health" already finds listings at Jefferson Health.
    terms?.length
      ? {
          // Rank in the full-text index and check filters on each candidate in rank order, so the
          // cost follows the page shown rather than the number of matches.
          sql:
            "SELECT v.kind,v.record FROM research_search s JOIN research_listings l ON l.rowid=s.rowid JOIN research_visible v ON v.id=l.id WHERE research_search MATCH ?" +
            ranked.map((c) => " AND " + c).join("") +
            " ORDER BY s.rank,l.id LIMIT 24 OFFSET ?",
          // Counts stop after cap + 1 matches, so a broad search costs the same as a
          // narrower one. Past the cap the page says "more than" instead of exact counts.
          count:
            "WITH m AS MATERIALIZED (SELECT v.kind,v.group_id FROM research_search s JOIN research_listings l ON l.rowid=s.rowid JOIN research_visible v ON v.id=l.id WHERE research_search MATCH ?" +
            ranked.map((c) => " AND " + c).join("") +
            ` LIMIT ${cap + 1}) SELECT kind,count(*) n,count(DISTINCT group_id) works FROM m GROUP BY kind`,
          args: [args[0], ...rankedArgs],
        }
      : undefined;
  return { from, args, facetCount: facetQueries.length, stored, relevance };
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
    const [state] = await rows<{ visible: number; refreshed: number; regional_visible: number; regional_refreshed: number }>(db, "SELECT EXISTS(SELECT 1 FROM research_visible WHERE kind='dataset') visible,coalesce((SELECT CAST(first AS INTEGER) FROM research_summary_kinds WHERE scope_field='visibility' AND kind='dataset'),0) refreshed,EXISTS(SELECT 1 FROM research_visible WHERE kind='regional-data') regional_visible,coalesce((SELECT CAST(first AS INTEGER) FROM research_summary_kinds WHERE scope_field='visibility' AND kind='regional-data'),0) regional_refreshed");
    if (state.visible && !state.refreshed) return undefined;
    if (state.regional_visible !== state.regional_refreshed) return undefined;
    const withoutDatasets = !state.visible && !!state.refreshed;
    const found = await rows<KindCount & { everything: number | null; of_kind: number | null }>(
      db,
      `SELECT kind,n,works,(SELECT sum(n) FROM research_summary_kinds WHERE scope_field='' AND scope_value='' ${withoutDatasets ? "AND kind<>'dataset'" : ""}) everything,(SELECT n FROM research_summary_kinds WHERE scope_field='' AND scope_value='' AND kind=? ${withoutDatasets ? "AND kind<>'dataset'" : ""}) of_kind FROM research_summary_kinds WHERE scope_field=? AND scope_value=? ${withoutDatasets ? "AND kind<>'dataset'" : ""} ORDER BY kind`,
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
export async function researchQuery(db: ResearchDb, params: URLSearchParams, refs: Institution[], cap = searchCountCap) {
  const { from, args, facetCount, stored, relevance } = searchSource(params, refs, cap);
  const sort = params.get("sort");
  if (relevance && (!sort || sort === "relevance")) {
    // A search is ordered by full-text relevance unless another order is chosen.
    const counts = await rows<KindCount>(db, relevance.count, ...relevance.args);
    const more = counts.reduce((sum, row) => sum + row.n, 0) > cap;
    const total = more ? cap : counts.reduce((sum, row) => sum + row.n, 0);
    const page = Math.min(pageNumber(params), Math.max(1, Math.ceil(total / 24)));
    const result = await rows<{ kind: Listing["kind"]; record: string }>(db, relevance.sql, ...relevance.args, (page - 1) * 24);
    return { items: result.map(readListing), counts, page, total, more };
  }
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
export type Results = Awaited<ReturnType<typeof researchQuery>> & { more?: boolean };

/** How many listings a result holds, in words; "More than 2,000 listings" past the count cap. */
export function resultCount(data: Pick<Results, "counts" | "more" | "total">, withVersions = false) {
  return data.more ? `More than ${count(data.total)} listings` : kindCounts(data.counts, withVersions);
}

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
  return `${regionalLabel(p)} ${html(p.connection)} ${externalLink(p.source, "Affiliation source")}`;
}
/** Card line: evidence icon, the named institutions, and the affiliation source as an icon. */
function cardEvidence(label: string, connection: string, institutions: string[], source: string, sourceName: string, fallback = "") {
  const names = namedLinks("institution", institutionLinks(institutions));
  return `<p class="record-evidence">${evidenceMark(label, connection)}${names || fallback}${sourceIcon(source, sourceName)}</p>`;
}
function bylinePreview(p: Publication, shown = 3) {
  const names = p.authors.slice(0, shown).map((a) => html(a.name));
  const total = Math.max(p.author_count, p.authors.length);
  return total > names.length ? `${names.join(", ")} <span class="muted">and others (${count(total)} authors)</span>` : names.join(", ");
}
function publicationRecord(p: Publication) {
  return `<li class="record record-publication${p.retracted ? " is-retracted" : ""}">
    <p class="record-kind">${kindIcon("publication", publicationType(p.type))}${p.venue ? `<span class="record-venue">${html(p.venue)}</span>` : ""}${partialDate(p.published) ? `<span>${partialDate(p.published)}</span>` : ""}${p.retracted ? '<strong class="retracted">Retracted</strong>' : ""}</p>
    <h3 class="record-title"><a href="${html(pubPath(p.id))}">${html(displayTitle(p))}</a></h3>
    <p class="record-byline">${bylinePreview(p)}</p>
    ${cardEvidence(p.label, p.connection, p.institutions, p.source, "Affiliation source")}
    <p class="record-topic">${topicTag(topicLink(p.topic), p.topic)}${timestamp(p.added) ? `<span>Added ${timestamp(p.added)}</span>` : ""}</p>
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
    <p class="record-kind">${kindIcon("study", registryLabel(study.type))}<span>${html(study.id)}</span><span>${html(registryLabel(study.status))}</span></p>
    <h3 class="record-title"><a href="${studyPath(study.id)}">${html(study.title)}</a></h3>
    ${cardEvidence(study.label, study.connection, study.institutions, study.source, "ClinicalTrials.gov record",
      namedLinks("place", study.counties.map((c) => `<a href="/discover/county/${facetSlug(c)}">${html(c)}</a>`), 4))}
    <p class="record-topic"><span>Added ${timestamp(study.added)}</span></p>
  </li>`;
}
const dataTypes: Record<string, [string, string]> = {
  "gene expression": ["Gene expression", "Gene expression data"],
  sequencing: ["Sequencing", "Sequencing data"],
  "single-cell": ["Single-cell", "Single-cell data"],
  structure: ["Structure", "Structural data"],
  proteomics: ["Proteomics", "Proteomics data"],
  metabolomics: ["Metabolomics", "Metabolomics data"],
  imaging: ["Imaging", "Imaging data"],
  "clinical and survey": ["Clinical and survey", "Clinical and survey data"],
  other: ["Other", "Dataset"],
};
/** The data type as a filter choice (short) or as the kind line of a card (long). */
export const dataTypeLabel = (type: string, long = false) =>
  dataTypes[type]?.[long ? 1 : 0] ?? (type ? type[0].toUpperCase() + type.slice(1) : "Dataset");
export const accessLevels: Record<Access, { name: string; explain: string }> = {
  open: { name: "Open", explain: "Anyone can download the files, with no account or application." },
  registration: { name: "Registration", explain: "Free to download after you create an account or accept the repository’s terms of use." },
  controlled: {
    name: "Controlled",
    explain: "You apply for access, and a data access committee reviews the request. Approval can take weeks and usually requires an institutional agreement.",
  },
};
/** The access level as a small tag with its padlock or key icon. */
export function accessTag(access: string) {
  const level = accessLevels[access as Access];
  if (!level) return "";
  return `<span class="access-tag access-${access}" title="${html(level.explain)}">${icon(("access-" + access) as IconName)}${html(level.name)}</span>`;
}
const accessionLinks: [RegExp, (v: string) => string][] = [
  [/^GSE[0-9]+$/, (v) => "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=" + v],
  [/^PRJ[A-Z]{2}[0-9]+$/, (v) => "https://www.ncbi.nlm.nih.gov/bioproject/" + v],
  [/^[SED]R[PRSX][0-9]+$/, (v) => "https://www.ncbi.nlm.nih.gov/sra/?term=" + v],
  [/^phs[0-9]{6}(\.v[0-9]+\.p[0-9]+)?$/, (v) => "https://www.ncbi.nlm.nih.gov/projects/gap/cgi-bin/study.cgi?study_id=" + v],
  [/^EGA[SD][0-9]{11}$/, (v) => (v.startsWith("EGAS") ? "https://ega-archive.org/studies/" : "https://ega-archive.org/datasets/") + v],
  [/^PXD[0-9]{6}$/, (v) => "https://www.ebi.ac.uk/pride/archive/projects/" + v],
  [/^E-[A-Z]{4}-[0-9]+$/, (v) => "https://www.ebi.ac.uk/biostudies/arrayexpress/studies/" + v],
  [/^[0-9][A-Za-z0-9]{3}$/, (v) => "https://www.rcsb.org/structure/" + v],
  [/^10\.[0-9]{4,}\/\S+$/, (v) => "https://doi.org/" + v.split("/").map(encodeURIComponent).join("/")],
];
/** An accession linked to its repository record when its form is known, otherwise plain text. */
export function accessionLink(value: string) {
  const known = accessionLinks.find(([pattern]) => pattern.test(value));
  return (known && externalLink(known[1](value), value)) || html(value);
}
const mainId = (d: Dataset) => d.accessions[0] ?? d.id.slice(d.id.indexOf(":") + 1);
const releaseYear = (d: Dataset) => (d.released && /^\d{4}/.test(d.released) ? d.released.slice(0, 4) : "");
const countyLinks = (names: string[]) => names.map((c) => `<a href="/discover/county/${facetSlug(c)}">${html(c)}</a>`);
function datasetKind(d: Dataset, release: string) {
  const more = d.accessions.length > 1 ? ` <span class="muted">+${count(d.accessions.length - 1)}</span>` : "";
  return `<p class="record-kind">${kindIcon("dataset", dataTypeLabel(d.data_type, true))}<span class="record-repository">${html(d.repository)} ${html(mainId(d))}${more}</span>${release}${accessTag(d.access)}</p>`;
}
function datasetRecord(d: Dataset) {
  const year = releaseYear(d);
  return `<li class="record record-dataset">
    ${datasetKind(d, year ? `<span><time datetime="${html(year)}">${html(year)}</time></span>` : "")}
    <h3 class="record-title"><a href="${html(datasetPath(d.id))}">${html(d.title)}</a></h3>
    <p class="record-summary">${html(d.summary)}</p>
    ${cardEvidence(d.label, d.connection, d.institutions, d.source, "Regional source", namedLinks("place", countyLinks(d.counties), 4))}
    <p class="record-topic">${topicTag(topicLink(d.topic), d.topic)}${timestamp(d.added) ? `<span>Added ${timestamp(d.added)}</span>` : ""}</p>
  </li>`;
}
function regionalDataCard(d: RegionalData) {
  return `<li class="record record-dataset"><p class="record-kind">Regional data · ${html(d.publisher)}</p><h3 class="record-title"><a href="${html(regionalDataPath(d.id))}">${html(d.title)}</a></h3><p>${html(d.summary)}</p><p>${html(d.counties.join(", ") || "Not stated")}</p></li>`;
}

export function renderRegionalData(d: RegionalData & { papers?: { id: string; title: string }[] }) {
  const value = (v: string | null | undefined) => v ? html(v) : "Not stated";
  const field = (name: string, content: string) => `<div><dt>${name}</dt><dd>${content}</dd></div>`;
  const countyNames = d.counties.map(c => counties.find(item => facetSlug(item.name) === facetSlug(c))?.name ?? c);
  const topic = d.topic.replaceAll("-", " ").replace(/^./, c => c.toUpperCase());
  const level = accessLevels[d.access];
  const source = externalLink(d.url, "View public record ↗", "button primary");
  const api = d.api ? `${externalLink(d.api.url, d.api.type) || html(d.api.type)}` : "Not stated";
  return `<article class="frame page record-page dataset-page">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${browsePath}">Directory</a><span aria-hidden="true">/</span><a href="${datasetsPath}">Datasets</a></nav>
    <header class="record-head">
      <p class="record-kind">${kindIcon("dataset", "Regional data")}<span>Regional data</span>${accessTag(d.access)}</p>
      <h1>${html(d.title)}</h1>
      <p class="lede">${html(d.summary)}</p>
      <p class="record-actions">${source}</p>
    </header>
    <div class="record-body">
      <section class="record-section" aria-labelledby="regional-coverage-title">
        <h2 id="regional-coverage-title">Coverage</h2>
        <dl class="facts">
          ${field("Counties", countyNames.length ? countyLinks(countyNames).join(", ") : "Not stated")}
          ${field("Topic", topicLink(topic))}
          ${field("Granularity", value(d.granularity))}
          ${field("Time span", value(d.time_span))}
          ${field("Update cadence", value(d.update_cadence))}
        </dl>
      </section>
      <section class="record-section" aria-labelledby="regional-get-title">
        <h2 id="regional-get-title">How to get it</h2>
        <dl class="facts">
          ${field("Access", level ? `${accessTag(d.access)} <span class="access-explain">${html(level.explain)}</span>` : "Not stated")}
          ${field("Publisher", value(d.publisher))}
          ${field("Portal", value(d.portal))}
          ${field("Listing ID", value(d.id))}
          ${field("Formats", value(d.formats?.join(", ")))}
          ${field("API", api)}
          ${field("License", value(d.license))}
          ${field("Added to directory", value(d.added))}
          ${field("Source checked", value(d.checked))}
        </dl>
      </section>
    </div>
    <section class="record-section" aria-labelledby="regional-use-title">
      <h2 id="regional-use-title">How to use it</h2>
      <p>${html(d.how_to_use.step)}</p>
      <p>${externalLink(d.how_to_use.url, "Source guidance ↗")}</p>
      ${d.how_to_use.caveats.length ? `<ul>${d.how_to_use.caveats.map(c => `<li>${html(c)}</li>`).join("")}</ul>` : ""}
      <h3>How to cite</h3><p>${html(d.how_to_use.citation)}</p>
    </section>
    ${d.papers?.length ? `<section class="record-section"><h2>Publications</h2><ul class="plain-list">${d.papers.map(p => `<li><a href="${html(pubPath(p.id))}">${html(p.title)}</a></li>`).join("")}</ul></section>` : ""}
    ${feedbackBlock(regionalDataPath(d.id), contactLink("Request removal by email", undefined, `Directory removal request for ${d.id}`))}
  </article>`;
}

/** A paper a dataset names, linked to its directory page when the paper is listed. */
export type DatasetPaper = { id: string; title?: string; relation?: "produced" | "linked" };
function paperLink(paper: DatasetPaper) {
  if (paper.title) return `<a href="${html(pubPath(paper.id))}">${html(displayTitle({ title: paper.title }))}</a>`;
  const doi = /^doi:(10\..+)$/.exec(paper.id)?.[1];
  return doi ? accessionLink(doi) : html(paper.id);
}
export function renderDataset(d: Dataset, refs: Institution[], papers: DatasetPaper[], similar: Listing[] = [], catalog?: DirectoryCatalog) {
  const entity = (kind: string, key: string, name: string) =>
    `<a href="/discover/${kind}/${encodeURIComponent(key)}">${html(name)}</a>`;
  const places = d.institutions.map((id) => entity("institution", id, refs.find((ref) => ref.id === id)?.name ?? id));
  const counties = d.counties.map((c) => entity("county", facetSlug(c), c + " County"));
  const level = accessLevels[d.access];
  const contents = [d.size, d.format].filter(Boolean).map((v) => html(v!)).join(" · ");
  const ids = d.accessions.map(accessionLink).join(", ");
  const produced = papers.filter((p) => p.relation === "produced");
  const linked = papers.filter((p) => !produced.includes(p));
  const cite = [...produced.map(paperLink), html(d.repository + " " + d.accessions.join(", "))];
  const get: [string, string][] = [
    ["Access", `${accessTag(d.access)}<span class="access-explain">${html(level?.explain ?? "")}</span>`],
    [d.accessions.length === 1 ? "ID" : "IDs", ids],
    ["Repository", externalLink(d.url, d.repository) || html(d.repository)],
    ["Contents", contents],
    ["License", d.license ? html(d.license) : '<span class="muted">Not stated in the record</span>'],
    ["Released", partialDate(d.released)],
    ["How to cite", `<ol class="cite-list">${cite.map((c) => `<li>${c}</li>`).join("")}</ol>`],
  ];
  const release = partialDate(d.released) ? `<span>Released ${partialDate(d.released)}</span>` : "";
  return `<article class="frame page record-page dataset-page">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${browsePath}">Directory</a><span aria-hidden="true">/</span><a href="${datasetsPath}">Datasets</a></nav>
    <header class="record-head">
      ${datasetKind(d, release)}
      <h1>${html(d.title)}</h1>
      <p class="lede">${html(d.summary)}</p>
      <p class="record-actions">${externalLink(d.url, `View on ${d.repository} ↗`, "button primary")}</p>
    </header>
    <div class="record-body">
      <section class="record-section get-data" aria-labelledby="get-title">
        <h2 id="get-title">How to get it</h2>
        <dl class="facts">${get.filter(([, v]) => v).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
      </section>
      <div>
        <section class="record-section" aria-labelledby="connection-title">
          <h2 id="connection-title">Regional connection</h2>
          <p class="record-evidence">${regionalLabel(d)} ${html(!produced.length ? d.connection.replace(/^Produced by a paper with /, "Linked to a paper with ") : d.connection)} ${externalLink(d.source, "Regional source")}</p>
          <dl class="facts">
            ${places.length ? `<div><dt>${places.length === 1 ? "Institution" : "Institutions"}</dt><dd>${places.join(", ")}</dd></div>` : ""}
            ${counties.length ? `<div><dt>${counties.length === 1 ? "County" : "Counties"}</dt><dd>${counties.join(", ")}</dd></div>` : ""}
            <div><dt>Topic</dt><dd>${topicLink(d.topic)}</dd></div>
            ${timestamp(d.added) ? `<div><dt>Added to directory</dt><dd>${timestamp(d.added)}</dd></div>` : ""}
          </dl>
        </section>
        ${produced.length ? `<section class="record-section" aria-labelledby="papers-title"><h2 id="papers-title">${produced.length === 1 ? "Paper that produced it" : "Papers that produced it"}</h2><ul class="plain-list">${produced.map((paper) => `<li>${paperLink(paper)}</li>`).join("")}</ul></section>` : ""}
        ${linked.length ? `<section class="record-section" aria-labelledby="linked-papers-title"><h2 id="linked-papers-title">${linked.length === 1 ? "Linked paper" : "Linked papers"}</h2><p class="muted">These papers link to or use this data.</p><ul class="plain-list">${linked.map((paper) => `<li>${paperLink(paper)}</li>`).join("")}</ul></section>` : ""}
      </div>
    </div>
    ${renderUseGuidance(datasetUseGuidance(d))}
    ${catalog ? similarSection(similar, catalog) : ""}
    ${feedbackBlock(datasetPath(d.id), contactLink("Request removal by email", undefined, `Directory removal request for ${d.id}`))}
  </article>`;
}
/** "Data from this paper": the listed datasets whose papers include a publication. */
export function paperDatasets(items: Dataset[]) {
  if (!items.length) return "";
  return `<section class="record-section related" aria-labelledby="paper-data-title"><h2 id="paper-data-title">Data from this paper</h2><ul class="plain-list dataset-list">${items
    .map(
      (d) =>
        `<li><p class="record-kind">${kindIcon("dataset", dataTypeLabel(d.data_type, true))}<span>${html(d.repository)} ${html(mainId(d))}</span>${accessTag(d.access)}</p><a href="${html(datasetPath(d.id))}">${html(d.title)}</a></li>`,
    )
    .join("")}</ul></section>`;
}
export function similarSection(items: Listing[], catalog: DirectoryCatalog, heading = "Similar research in the Delaware Valley") {
  if (!items.length) return "";
  return `<section class="related similar" aria-labelledby="similar-title"><div class="section-heading"><h2 id="similar-title">${html(heading)}</h2></div><p class="section-note">Publications, clinical studies and software from the region that share this record’s distinctive subject words. Use them to see who else in the region works on the subject.</p>${renderListingCards(items, catalog)}</section>`;
}

export function renderStudy(study: ClinicalStudy, refs: Institution[] = [], similar: Listing[] = [], catalog?: DirectoryCatalog) {
  const entity = (kind: string, key: string, name: string) =>
    `<a href="/discover/${kind}/${encodeURIComponent(key)}">${html(name)}</a>`;
  const places = study.institutions.map((id) => entity("institution", id, refs.find((ref) => ref.id === id)?.name ?? id));
  const counties = study.counties.map((c) => entity("county", facetSlug(c), c + " County"));
  const phases = study.phases.filter((phase) => phase !== "NA").map((phase) => registryLabel(phase).replace(/phase(?=[0-9])/i, "Phase "));
  const facts: [string, string][] = [
    ["Registry ID", externalLink(study.source, study.id) || html(study.id)],
    ["Study type", html(registryLabel(study.type))],
    ["Overall status", html(registryLabel(study.status))],
    ["Phase", html(phases.join(" · "))],
    ["Conditions", html(study.conditions.join("; "))],
    ["First posted", study.first_posted ? partialDate(study.first_posted) : ""],
    ["Registry updated", study.last_updated ? partialDate(study.last_updated) : ""],
    ["Added to directory", timestamp(study.added)],
  ];
  return `<article class="frame page record-page study-page">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${browsePath}">Directory</a><span aria-hidden="true">/</span><a href="${browsePath}?kind=study">Clinical studies</a></nav>
    <header class="record-head">
      <p class="record-kind">${kindIcon("study", registryLabel(study.type))}<span>${html(study.id)}</span><span>${html(registryLabel(study.status))}</span></p>
      <h1>${html(study.title)}</h1>
      <p class="record-actions">${externalLink(study.source, "View on ClinicalTrials.gov ↗", "button primary")}</p>
    </header>
    <div class="record-body">
      <section class="record-section" aria-labelledby="connection-title">
        <h2 id="connection-title">Regional connection</h2>
        <p class="record-evidence">${regionalLabel(study)} ${html(study.connection)}</p>
        <dl class="facts">
          ${places.length ? `<div><dt>${places.length === 1 ? "Institution" : "Institutions"}</dt><dd>${places.join(", ")}</dd></div>` : ""}
          ${counties.length ? `<div><dt>${counties.length === 1 ? "County" : "Counties"}</dt><dd>${counties.join(", ")}</dd></div>` : ""}
        </dl>
        <h3 class="sites-heading">Delaware Valley sites</h3>
        <ul class="plain-list study-sites">${study.sites.map((site) => `<li>${html(site.facility)}<span class="muted"> · ${html(site.city)}, ${html(site.state)} · ${html(site.county)} County${site.status ? " · " + html(registryLabel(site.status)) : ""}</span></li>`).join("")}</ul>
      </section>
      <section class="record-section" aria-labelledby="record-title">
        <h2 id="record-title">Registry record</h2>
        <dl class="facts">${facts.filter(([, v]) => v).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
      </section>
    </div>
    ${catalog ? similarSection(similar, catalog) : ""}
    ${feedbackBlock(studyPath(study.id), contactLink("Request removal by email", undefined, `Directory removal request for ${study.id}`))}
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
    .reduce((text, part, i, parts) => text + (i === 0 ? "" : i === parts.length - 1 ? " and " : ", ") + part, "");
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
  datasetsAvailable?: boolean;
  regionalDataAvailable?: boolean;
  publicationsAvailable?: boolean;
  scope?: string;
  byDate?: boolean;
  aside?: string;
  /** Replaces the kind, institution, topic and county filters (the datasets page). */
  facets?: { name: string; label: string; all: string; choices: [string, string][] }[];
  /** The order choices when the default set does not fit. The first is the default. */
  orders?: [string, string][];
  feed?: string;
};

export function renderResearch({ header, path, params, data, catalog, options, enabled, studiesAvailable, datasetsAvailable, regionalDataAvailable, publicationsAvailable = true, scope = "", byDate, aside, facets, orders, feed }: ResearchPage) {
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
  const kinds: ListingKind[] = [...(publicationsAvailable ? ["publication" as const] : []), "project", ...(studiesAvailable ? ["study" as const] : []), ...(datasetsAvailable ? ["dataset" as const] : []), ...(regionalDataAvailable ? ["regional-data" as const] : [])];
  const activity = datasetsAvailable
    ? studiesAvailable ? "Publication, code push, registry update or release date" : "Publication, code push or release date"
    : studiesAvailable ? "Publication, code push or registry update date" : "Publication date or last code push";
  const filters = [
    ...(facets
      ? facets.filter((f) => f.choices.length).map((f) => select(f.name, f.label, f.choices, f.all))
      : [
          enabled
            ? select("kind", "Kind", kinds.map((kind) => [kind, templates[kind].plural]), kinds.length > 2 ? "All kinds" : "Publications and software")
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
        ]),
    path !== newPath && enabled
      ? `<label>Order<select form="research-form" name="sort">${[
          ...(params.get("q") ? [["relevance", "Relevance"]] : []),
          ...(orders ?? [
            ["added", "Date added"],
            ["activity", activity],
            ["name", "Title A–Z"],
          ]),
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
        <div class="results-bar"><p class="results-count"><strong>${resultCount(data, true) || "No matching listings"}</strong>${data.more ? `<span class="muted"> · most relevant first</span>` : range}</p>
        <p class="results-links"><a href="${html(feed ?? feedUrl(params))}">RSS feed of additions</a></p></div>
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
  linkedCode: Listing[] = [],
  similar: Listing[] = [],
  datasets: Dataset[] = [],
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
      <p class="record-kind">${kindIcon("publication", publicationType(p.type))}${p.venue ? `<span>${html(p.venue)}</span>` : ""}${partialDate(p.published) ? `<span>Published ${partialDate(p.published)}</span>` : ""}</p>
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
    ${linkedCode.length ? `<section class="record-section related" aria-labelledby="linked-code-title"><h2 id="linked-code-title">Code linked from this paper</h2><p class="muted">Directory projects whose repository this paper’s full text links to, as a citation, use or release.</p><ul class="plain-list">${linkedCode.map((i) => `<li><a href="${html(listingPath(i))}">${html(listingTitle(i))}</a></li>`).join("")}</ul></section>` : ""}
    ${paperDatasets(datasets)}
    ${similarSection(similar, catalog)}
    ${more?.items.length ? `<section class="related"><div class="section-heading"><h2>${html(more.heading)}</h2><a href="${html(more.href)}">More from this institution</a></div>${renderListingCards(more.items, catalog)}</section>` : ""}
    ${feedbackBlock(pubPath(p.id), contactLink("Request removal by email", undefined, `Directory removal request for ${p.id}`))}
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
      return `<item><title>${html(listingTitle(i))}</title><link>${link}</link><guid>${link}</guid><category>${i.kind}</category><description>${html(i.kind === "regional-data" ? i.record.summary : i.record.connection ?? "")}</description>${day ? `<pubDate>${new Date(day + "T00:00:00Z").toUTCString()}</pubDate>` : ""}</item>`;
    })
    .join("")}</channel></rss>`;
}
