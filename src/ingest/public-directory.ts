import { regionalDataLlms, regionalDataSchema } from "./regional-data-surfaces";
import { regionalDataApi, regionalDataPath, regionalDataId, type RegionalData } from "./regional-data-contract";
import { regionalDataEnabled, regionalDataRecord, regionalDataRecords } from "./regional-data-read";
import { decodedPublicPath } from "../lib/editorial-retirement";
import { html } from "./public-directory-ui";
import { supportOpen, supportPath } from "./public-support-data";
import {
  newPath,
  feedPath,
  publicationsApi,
  pubPath,
  studiesApi,
  studyPath,
  studyId,
  datasetsApi,
  datasetsPath,
  datasetPath,
  datasetId,
  accessLevels,
  dataTypeLabel,
  renderDataset,
  renderRegionalData,
  registryLabel,
  rows,
  optionsFor,
  institutionFor,
  projectQuery,
  researchQuery,
  manyPublications,
  researchFeed,
  renderPublication,
  renderStudy,
  publicationTitle,
  displayTitle,
  publicationType,
  renderResearch,
  renderListingCards,
  facetSlug,
  kindCounts,
  resultCount,
  listingPath,
  listingTitle,
  topicPath,
  rss,
  feedUrl,
  type Publication,
  type ClinicalStudy,
  type Dataset,
  type DatasetPaper,
  type ResearchDb,
  type Institution,
  type Listing,
} from "./public-directory-research";
import type { SitemapEntry } from "../content/sitemap";
import { DEFAULT_PUBLIC_ORIGIN, llmsTxt } from "../lib/canonical";
import type { RetiredEditorialSection } from "../lib/editorial-retirement";
import {
  apiPath,
  browsePath,
  createDirectoryCatalog,
  detailPrefix,
  directoryCatalog,
  entityPath,
  httpsUrl,
  lastActivity,
  methodPath,
  projectPath,
  publicProjectId,
  type DirectoryProject,
} from "./public-directory-data";
import { renderDirectoryPage, type DirectoryView } from "./public-directory-page";
import { activeGroups, groupList, partnerList, partners, similarListings } from "./public-directory-discover";
import { cacheKey, dataVersion, defaultCache, forCache, fromCache, type CacheStore } from "./public-directory-cache";
import { readProject, readProjectCatalog } from "./public-directory-store";
import { renderResultsRegion } from "./public-directory-results";
import { counties } from "./public-directory-data";
import { healthTopic, partialDateText } from "./public-directory-ui";
import {
  entityHeader,
  entityHref,
  namesFor,
  organizationSchema,
  summarize,
  type Names,
  type ScopeField,
} from "./public-directory-entity";

export async function institutionRefs(db: ResearchDb): Promise<Institution[]> {
  return (await rows<{ record: string }>(db, "SELECT record FROM research_institutions ORDER BY id")).map((r) =>
    JSON.parse(r.record),
  );
}

type RemovalDb = ResearchDb;
const entityRoute = /^\/discover\/(institution|lab|topic|county)\/([^/]+)\/?$/;
const fragmentHeader = "X-Valley-Desk-Fragment";
const noStore = { "cache-control": "no-store", "cdn-cache-control": "no-store" };
const htmlHeaders = { ...noStore, "content-type": "text/html; charset=utf-8" };
const jsonHeaders = { ...noStore, "content-type": "application/json; charset=utf-8", "x-robots-tag": "noindex" };

export function isPublicDirectoryPath(path: string) {
  return (
    ["/api/directory/listings", "/llms.txt", newPath, feedPath, publicationsApi, studiesApi, datasetsApi, datasetsPath, regionalDataApi].includes(
      path.replace(/\/$/, ""),
    ) ||
    path.startsWith(publicationsApi + "/") ||
    path.startsWith("/discover/publication/") ||
    path.startsWith(studiesApi + "/") ||
    path.startsWith("/discover/study/") ||
    path.startsWith(regionalDataApi + "/") ||
    path.startsWith("/discover/regional-data/") ||
    path.startsWith(datasetsApi + "/") ||
    path.startsWith("/discover/dataset/") ||
    path.startsWith("/discover/sitemap/") ||
    decodedPublicPath(path).replace(/\/$/, "") === "/sitemap.xml" ||
    path === "/" ||
    /^\/discover\/?$/.test(path) ||
    path === browsePath ||
    path === browsePath + "/" ||
    path === methodPath ||
    path === methodPath + "/" ||
    path.startsWith(detailPrefix) ||
    entityRoute.test(path) ||
    path === apiPath ||
    path.startsWith(apiPath + "/")
  );
}

export async function removalIds(db?: RemovalDb) {
  if (!db) throw new Error("Removal database unavailable");
  const result = await rows<{ github_id: string }>(db, "SELECT github_id FROM public_directory_removals");
  if (!result.every((row) => typeof row?.github_id === "string")) throw new Error("Invalid removal record");
  return new Set(result.map((row) => row.github_id));
}

function publicProject(project: DirectoryProject) {
  const {
    id,
    code,
    name,
    purpose,
    description,
    topic,
    label,
    institution,
    county,
    connection,
    source,
    paper,
    language,
    license,
    updated,
    added,
    owner,
    lab,
    stars,
    topics,
    homepage,
    created,
    pushed,
    archived,
    papers,
    checked,
  } = project;
  return {
    id,
    code: httpsUrl(code),
    name,
    purpose,
    description,
    topic,
    label,
    institution,
    county,
    connection,
    source: httpsUrl(source),
    paper: httpsUrl(paper),
    language,
    license,
    updated,
    added,
    owner: owner ? { login: owner.login, name: owner.name, kind: owner.kind } : undefined,
    lab,
    stars,
    topics,
    homepage: httpsUrl(homepage),
    created,
    pushed,
    archived,
    checked,
    papers: papers?.map(({ title, url, doi, year, venue }) => ({ title, url: httpsUrl(url), doi, year, venue })),
  };
}

/** Reads an optional table added after the core schema; a database without it reads as empty. */
async function optionalRows<T>(db: ResearchDb, sql: string, ...args: string[]): Promise<T[]> {
  try {
    return await rows<T>(db, sql, ...args);
  } catch (error) {
    if (/no such table/i.test(String(error))) return [];
    throw error;
  }
}

function decode(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}

export function directoryNotFound(origin: string, nonce?: string, head = false) {
  return new Response(head ? null : renderDirectoryPage({ kind: "not-found" }, directoryCatalog, origin, nonce), {
    status: 404,
    headers: { ...htmlHeaders, "x-robots-tag": "noindex" },
  });
}

export function retiredDirectoryPage(
  section: RetiredEditorialSection,
  origin: string,
  nonce: string,
  head: boolean,
) {
  return new Response(
    head ? null : renderDirectoryPage({ kind: "retired", section }, directoryCatalog, origin, nonce),
    {
      status: 410,
      headers: { ...htmlHeaders, "x-robots-tag": "noindex" },
    },
  );
}

export async function publicDirectorySitemap(db: RemovalDb | undefined, origin: string): Promise<SitemapEntry[]> {
  const removed = await removalIds(db);
  const { catalog } = await readProjectCatalog(db!);
  return projectSitemap(catalog, removed, origin);
}

function projectSitemap(catalog: ReturnType<typeof createDirectoryCatalog>, removed: Set<string>, origin: string): SitemapEntry[] {
  return [
    ...["/", browsePath, methodPath, newPath, "/discover/connect", ...(supportOpen() ? [supportPath] : [])].map((path) => ({ loc: origin + path })),
    ...catalog.publishedEntities(removed).map((entity) => ({ loc: origin + entityPath(entity) })),
    ...catalog.projects(removed).map((project) => ({
      loc: origin + projectPath(project),
      lastmod: lastActivity(project) || undefined,
    })),
  ];
}



/** Stable query string for a filtered view's self-referencing canonical URL. */
function canonicalQuery(params: URLSearchParams) {
  const next = new URLSearchParams([...params].filter(([key, value]) => value && key !== "view"));
  next.sort();
  return next.toString();
}

/** A readable name for a filtered view, built from the parameters in the URL. */
function describeQuery(params: URLSearchParams, names: Names, added = false, repositories = new Map<string, string>()) {
  const kind = params.get("kind");
  const parts = [kind === "publication" ? "Publications" : kind === "project" ? "Research software" : kind === "study" ? "Clinical studies" : kind === "dataset" ? "Datasets" : "Healthcare research"];
  const q = params.get("q")?.trim();
  if (q) parts.push(`matching “${q.slice(0, 80)}”`);
  const datatype = params.getAll("datatype").filter(Boolean).map((t) => dataTypeLabel(facetSlug(t).replaceAll("-", " ")).toLowerCase());
  if (datatype.length) parts.push("of " + datatype.join(" or ") + " data");
  const access = params.getAll("access").filter(Boolean).map((a) => accessLevels[facetSlug(a) as Dataset["access"]]?.name.toLowerCase() ?? a);
  if (access.length) parts.push(`with ${access.join(" or ")} access`);
  const repository = params.getAll("repository").filter(Boolean).map((r) => repositories.get(facetSlug(r)) ?? r);
  if (repository.length) parts.push("in " + repository.join(" or "));
  const topic = params.getAll("topic").filter(Boolean).map((t) => names.topic(facetSlug(t)));
  if (topic.length) parts.push("on " + topic.join(" or "));
  const institution = params.getAll("institution").filter(Boolean).map((i) => names.institution(i));
  if (institution.length) parts.push("from " + institution.join(" or "));
  const county = params.getAll("county").filter(Boolean).map((c) => names.county(facetSlug(c)) + " County");
  if (county.length) parts.push("in " + county.join(" or "));
  const label = params.getAll("label").filter(Boolean);
  if (label.length) parts.push(`with ${label.join(" or ")} evidence`);
  if (!added && params.get("sort") === "name") parts.push("by title");
  if (!added && params.get("sort") === "activity") parts.push(kind === "dataset" ? "by release date" : "by publication or push date");
  const page = Number(params.get("page"));
  return parts.join(" ") + (page > 1 ? `, page ${page}` : "");
}

function filteredHeader(crumbs: [string, string][], described: string, path: string) {
  return `<header class="entity-head"><nav class="breadcrumb" aria-label="Breadcrumb">${crumbs
    .map(([name, href]) => `<a href="${html(href)}">${html(name)}</a>`)
    .join('<span aria-hidden="true">/</span>')}</nav><h1>${html(described)}</h1><p class="muted">A filtered view. <a href="${html(path)}">Show the full list</a>.</p></header>`;
}

const highwireDate = (value: string) => value.replaceAll("-", "/");

/** Highwire Press tags read by scholarly indexes. Values come from the record unchanged. */
function citationMeta(p: Publication) {
  const tag = (name: string, value?: string | null) => (value ? `<meta name="${name}" content="${html(value)}">\n    ` : "");
  return (
    tag("citation_title", publicationTitle(p)) +
    p.authors.map((a) => tag("citation_author", a.name)).join("") +
    tag("citation_publication_date", highwireDate(p.published)) +
    tag(p.type === "preprint" ? "citation_publisher" : "citation_journal_title", p.venue) +
    tag("citation_doi", p.doi) +
    tag("citation_pmid", p.pmid) +
    tag("citation_fulltext_html_url", p.open_access?.url)
  );
}

function publicationDescription(p: Publication, refs: Institution[]) {
  const what = [publicationType(p.type), p.venue ? `in ${p.venue}` : "", partialDateText(p.published) ? `(${partialDateText(p.published)})` : ""]
    .filter(Boolean)
    .join(" ");
  const where = p.institutions.map((id) => refs.find((r) => r.id === id)?.name ?? id);
  return `${what}. ${p.label} regional connection: ${p.connection} Listed in The Valley Desk under ${where.join(", ")}${p.counties.length ? ", " + p.counties.map((c) => c + " County").join(", ") : ""}.`;
}

/** The directory page is an item page about the article; the article is its main entity. */
function publicationSchema(p: Publication, origin: string) {
  const ids = [
    p.doi && { "@type": "PropertyValue", propertyID: "DOI", value: p.doi },
    p.pmid && { "@type": "PropertyValue", propertyID: "PMID", value: p.pmid },
    p.pmcid && { "@type": "PropertyValue", propertyID: "PMCID", value: p.pmcid },
    p.arxiv && { "@type": "PropertyValue", propertyID: "arXiv", value: p.arxiv },
  ].filter(Boolean);
  const same = [p.url, p.open_access?.url].filter((u): u is string => !!u && /^https:\/\//.test(u));
  return {
    "@type": "ItemPage",
    url: origin + pubPath(p.id),
    name: displayTitle(p),
    isPartOf: { "@id": origin + "/#website" },
    mainEntity: {
      "@type": "ScholarlyArticle",
      headline: displayTitle(p).slice(0, 110),
      name: displayTitle(p),
      genre: publicationType(p.type),
      datePublished: p.published,
      author: p.authors.map((a) => ({ "@type": "Person", name: a.name })),
      ...(p.venue ? { isPartOf: { "@type": p.type === "preprint" ? "Organization" : "Periodical", name: p.venue } } : {}),
      ...(ids.length ? { identifier: ids } : {}),
      ...(same.length ? { sameAs: [...new Set(same)] } : {}),
      about: p.topic,
      ...(p.terms.length ? { keywords: p.terms } : {}),
    },
  };
}

/** schema.org Dataset for a dataset page. Values come from the record; papers are cited by their pages. */
function datasetSchema(d: Dataset, papers: DatasetPaper[], refs: Institution[], origin: string) {
  return {
    "@type": "Dataset",
    "@id": origin + datasetPath(d.id) + "#dataset",
    name: d.title,
    description: d.summary,
    url: origin + datasetPath(d.id),
    sameAs: d.url,
    identifier: [d.id, ...d.accessions.filter((a) => a !== d.id)],
    ...(d.license ? { license: d.license } : {}),
    ...(d.access === "open" ? { isAccessibleForFree: true } : { conditionsOfAccess: accessLevels[d.access]?.explain }),
    ...(d.released ? { datePublished: d.released } : {}),
    keywords: [dataTypeLabel(d.data_type), d.topic],
    creator: d.institutions.map((id) => ({ "@type": "Organization", name: refs.find((r) => r.id === id)?.name ?? id })),
    ...(papers.length
      ? { citation: papers.map((p) => (p.title ? origin + pubPath(p.id) : /^doi:/.test(p.id) ? "https://doi.org/" + p.id.slice(4) : p.id)) }
      : {}),
    publisher: { "@type": "Organization", name: d.repository },
    distribution: {
      "@type": "DataDownload",
      contentUrl: d.url,
      ...(d.format ? { encodingFormat: d.format } : {}),
      ...(d.size ? { contentSize: d.size } : {}),
    },
    includedInDataCatalog: { "@id": origin + "/#catalog" },
  };
}

/** Papers a dataset names, with the title of each one the directory lists (by ID or alternate ID). */
async function datasetPapers(db: ResearchDb, d: Dataset): Promise<DatasetPaper[]> {
  if (!d.papers.length) return [];
  const found = await rows<{ paper: string; id: string; title: string }>(
    db,
    "SELECT p.value paper,v.id,v.title FROM json_each(?) p JOIN research_visible v ON v.kind='publication' AND (v.id=p.value OR v.id IN (SELECT id FROM research_facets WHERE field='alternate' AND value=p.value))",
    JSON.stringify(d.papers),
  );
  const seen = new Set<string>();
  return d.papers
    .map((paper) => found.find((row) => row.paper === paper) ?? { paper, id: paper, title: undefined })
    .filter((paper) => !seen.has(paper.id) && !!seen.add(paper.id))
    .map(({ id, title, paper }) => ({ id, title, relation: d.paper_provenance?.find((v) => v.paper === (paper ?? id))?.relation ?? "linked" }));
}

/** Choices for the datasets page filters, from the visible datasets only, so no filter offers an empty value. */
async function datasetFacetChoices(db: ResearchDb, names: Names, regional = false) {
  const found = await rows<{ field: string; value: string; name: string | null }>(
    db,
    regional ? "SELECT f.field,f.value,max(CASE f.field WHEN 'repository' THEN json_extract(v.record,'$.repository') WHEN 'datatype' THEN json_extract(v.record,'$.data_type') WHEN 'topic' THEN json_extract(v.record,'$.topic') END) name FROM research_facets f JOIN research_visible v ON v.id=f.id WHERE v.kind IN ('dataset','regional-data') AND f.field IN ('access','datatype','repository','institution','county','topic') GROUP BY f.field,f.value" : "SELECT field,value,name FROM research_summary_dataset_facets",
  );
  const pick = (field: string) => found.filter((row) => row.field === field);
  const sorted = (choices: [string, string][]) => choices.sort((a, b) => a[1].localeCompare(b[1]));
  const repositories = new Map(pick("repository").map((r) => [r.value, r.name ?? r.value]));
  return {
    repositories,
    facets: [
      { name: "access", label: "Access", all: "Any access", choices: (Object.keys(accessLevels) as Dataset["access"][]).filter((a) => pick("access").some((r) => r.value === a)).map((a): [string, string] => [a, accessLevels[a].name]) },
      { name: "datatype", label: "Data type", all: "All data types", choices: sorted(pick("datatype").map((r): [string, string] => [r.value, dataTypeLabel(r.name ?? r.value)])) },
      { name: "repository", label: "Repository", all: "All repositories", choices: sorted([...repositories]) },
      { name: "institution", label: "Institution", all: "All institutions", choices: sorted(pick("institution").map((r): [string, string] => [r.value, names.institution(r.value)])) },
      { name: "county", label: "County", all: "All counties", choices: sorted(pick("county").map((r): [string, string] => [r.value, names.county(r.value)])) },
      { name: "topic", label: "Topic", all: "All topics", choices: sorted(pick("topic").map((r): [string, string] => [r.value, r.name ?? names.topic(r.value)]).filter(([, n]) => healthTopic(n))) },
    ],
  };
}

/**
 * Serves a directory request, reusing a response from the edge cache while the data version it
 * was built from is unchanged. Only successful GET responses are cached.
 */
export async function servePublicDirectory(
  request: Request,
  db?: RemovalDb,
  origin = DEFAULT_PUBLIC_ORIGIN,
  nonce?: string,
  catalog?: ReturnType<typeof createDirectoryCatalog>,
  publicationsEnabled = false,
  cache: { store?: CacheStore; build?: string; waitUntil?: (work: Promise<unknown>) => void } = {},
): Promise<Response> {
  const store = cache.store ?? defaultCache();
  if (request.method !== "GET" || !store) return renderPublicDirectory(request, db, origin, nonce, catalog, publicationsEnabled);
  const version = await dataVersion(db, `${cache.build ?? ""}:${publicationsEnabled}:${origin}`);
  if (!version) return renderPublicDirectory(request, db, origin, nonce, catalog, publicationsEnabled);
  const key = cacheKey(request, version, request.headers.get(fragmentHeader) === "results" ? "fragment" : "page");
  const cached = await store.match(key).catch(() => undefined);
  if (cached) return fromCache(cached, nonce);
  const response = await renderPublicDirectory(request, db, origin, nonce, catalog, publicationsEnabled, version);
  if (response.status === 200 && response.headers.get("x-directory-project-source") !== "fallback") {
    const saving = forCache(response, nonce).then((copy) => store.put(key, copy)).catch(() => undefined);
    if (cache.waitUntil) cache.waitUntil(saving);
    else await saving;
  }
  const headers = new Headers(response.headers);
  headers.set("x-directory-cache", "miss");
  return new Response(response.body, { status: response.status, headers });
}

async function renderPublicDirectory(
  request: Request,
  db?: RemovalDb,
  origin = DEFAULT_PUBLIC_ORIGIN,
  nonce?: string,
  suppliedCatalog?: ReturnType<typeof createDirectoryCatalog>,
  publicationsEnabled = false,
  version?: string,
): Promise<Response> {
  const head = request.method === "HEAD";
  if (request.method !== "GET" && !head) {
    return new Response(null, { status: 405, headers: { ...noStore, allow: "GET, HEAD" } });
  }
  const { pathname, search, searchParams } = new URL(request.url);
  const api = pathname.startsWith("/api/directory/");
  const fragment = request.headers.get(fragmentHeader) === "results";
  let catalog = suppliedCatalog ?? directoryCatalog;
  let source: "fallback" | "d1" | undefined;
  const projectSource = (): Record<string, string> => source ? { "x-directory-project-source": source } : {};
  const page = (view: DirectoryView, status: number) => {
    const renderFragment =
      fragment && view.kind === "results" && (view.data.scope?.entity.kind !== "county" || view.data.total > 0);
    const headers = view.kind === "results" ? { ...htmlHeaders, vary: fragmentHeader } : htmlHeaders;
    return new Response(
      head
        ? null
        : renderFragment
          ? renderResultsRegion(catalog, view.data)
          : renderDirectoryPage(view, catalog, origin, nonce),
      {
        status,
        headers: { ...headers, ...projectSource(), ...(status >= 400 ? { "x-robots-tag": "noindex" } : {}) },
      },
    );
  };
  const json = (value: () => unknown, status = 200) =>
    new Response(head ? null : JSON.stringify(value()), { status, headers: { ...jsonHeaders, ...projectSource() } });
  const redirect = (path: string) => new Response(null, { status: 308, headers: { ...noStore, location: path } });

  let removed: Set<string>;
  try {
    removed = await removalIds(db);
  } catch (error) {
    console.error("directory_unavailable", "removals", String(error));
    return api ? json(() => ({ error: "directory_unavailable" }), 503) : page({ kind: "unavailable" }, 503);
  }

  // When publications are disabled, every directory read must exclude their associated
  // collections too. Stored kind and partner summaries aggregate those collections, so force direct counts.
  // This wrapper applies only to read queries issued below; cache versioning uses the real DB.
  let bypassSummaries = !publicationsEnabled;
  const researchDb: ResearchDb = {
    prepare(sql) {
      if (!publicationsEnabled) sql = sql.replace(/\bresearch_visible\b/g, "(SELECT * FROM research_visible WHERE kind IN ('project','regional-data'))");
      if (bypassSummaries) sql = sql.replace(/\bresearch_summary_kinds\b/g, "(SELECT * FROM research_summary_kinds WHERE 0)")
        .replace(/\bresearch_summary_partners\b/g, "(SELECT * FROM research_summary_partners WHERE 0)")
        .replace(/\bresearch_summary_dataset_partners\b/g, "(SELECT * FROM research_summary_dataset_partners WHERE 0)");
      return db!.prepare(sql);
    },
  };
  const path = pathname.replace(/\/$/, "") || "/";
  const combinedApi = path === "/api/directory/listings";
  const pubApi = path === publicationsApi || path.startsWith(publicationsApi + "/");
  const studyApi = path === studiesApi || path.startsWith(studiesApi + "/");
  const regionalList = path === regionalDataApi;
  const datasetList = path === datasetsApi;
  const datasetsLanding = path === datasetsPath;
  const detail = path.startsWith("/discover/publication/") || path.startsWith(publicationsApi + "/");
  const xml = (value: string, type = "application/xml") =>
    new Response(head ? null : value, { headers: { ...noStore, ...projectSource(), "content-type": type + "; charset=utf-8" } });
  const unavailable = () =>
    api || pubApi ? json(() => ({ error: "directory_unavailable" }), 503) : page({ kind: "unavailable" }, 503);
  let hasPubs = false, hasStudies = false, hasDatasets = false, hasRegionalData = false;
  let linked: { title: string; url: string }[] = [];
  let mentions: { title: string; url: string }[] = [];
  let research: Listing[] = [];
  try {
    if (publicationsEnabled) {
      hasPubs =
        (await rows(researchDb, "SELECT id FROM research_visible WHERE kind='publication' LIMIT 1")).length > 0;
    }
    if (publicationsEnabled) {
      // The dataset switch is read first, so a hidden collection costs no listing reads. A database
      // without migration 0050 has no switch and no datasets.
      const [visible] = await optionalRows<{ studies: number; datasets: number }>(
        researchDb,
        "SELECT EXISTS(SELECT 1 FROM research_visible WHERE kind='study') studies,CASE WHEN (SELECT enabled FROM dataset_visibility WHERE id=1)=1 THEN EXISTS(SELECT 1 FROM research_visible WHERE kind='dataset') ELSE 0 END datasets",
      );
      hasStudies = visible
        ? visible.studies === 1
        : (await rows(researchDb, "SELECT id FROM research_visible WHERE kind='study' LIMIT 1")).length > 0;
      hasDatasets = visible?.datasets === 1;
    }
    const regionalEnabled = await regionalDataEnabled(researchDb);
    hasRegionalData = regionalEnabled && (await rows(researchDb, "SELECT id FROM research_visible WHERE kind='regional-data' LIMIT 1")).length > 0;
    if (hasRegionalData && !hasPubs) bypassSummaries = true;
    if (!suppliedCatalog && path.startsWith(apiPath + "/")) {
      const id = decode(pathname.slice(apiPath.length + 1));
      if (!/^[1-9][0-9]{0,19}$/.test(id)) return json(() => ({ error: "project_not_found" }), 404);
      if (removed.has(id)) return json(() => ({ error: "project_removed" }), 410);
      const result = await readProject(researchDb, id, removed);
      source = result.fallback ? "fallback" : "d1";
      const project = result.project;
      return project ? json(() => ({ project: publicProject(project) })) : json(() => ({ error: "project_not_found" }), 404);
    }
    if (!suppliedCatalog && !regionalList && !path.startsWith(regionalDataApi + "/") && !path.startsWith("/discover/regional-data/") && path !== methodPath && path !== "/llms.txt" &&
        (path !== "/sitemap.xml" && !path.startsWith("/discover/sitemap/") || path === "/discover/sitemap/directory.xml")) {
      const result = await readProjectCatalog(researchDb, version);
      catalog = result.catalog;
      source = result.fallback ? "fallback" : "d1";
    }
    if (path.startsWith("/discover/study/") || path.startsWith(studiesApi + "/")) {
      const id = decode(path.slice((studyApi ? studiesApi : "/discover/study").length + 1));
      const missing = () => studyApi ? json(() => ({ error: "study_not_found" }), 404) : page({ kind: "not-found" }, 404);
      if (!studyId.test(id) || !hasPubs) return missing();
      const [removals] = await rows(researchDb, "SELECT name FROM sqlite_master WHERE type='table' AND name='study_removals'");
      if (!removals) return missing();
      if ((await rows(researchDb, "SELECT id FROM study_removals WHERE id=?", id)).length) {
        return studyApi ? json(() => ({ error: "study_removed" }), 410) : page({ kind: "study-removed" }, 410);
      }
      const [entry] = await rows<{ record: string }>(researchDb, "SELECT record FROM research_visible WHERE kind='study' AND id=?", id);
      if (!entry) return missing();
      const study: ClinicalStudy = JSON.parse(entry.record);
      if (studyApi) return json(() => ({ study }));
      const similar = await similarListings(researchDb, { kind: "study", record: study }, []);
      return page({
        kind: "research",
        title: study.title,
        summary: `${registryLabel(study.type)} ${study.id}. Study sites in ${study.counties.map((county) => county + " County").join(", ")}. Source ClinicalTrials.gov.`,
        path: studyPath(id),
        content: renderStudy(study, await institutionRefs(researchDb), similar, catalog),
      }, 200);
    }
    if (path.startsWith("/discover/regional-data/") || path.startsWith(regionalDataApi + "/")) {
      const isApi = path.startsWith(regionalDataApi + "/");
      const id = decode(path.slice((isApi ? regionalDataApi : "/discover/regional-data").length + 1));
      const missing = () => isApi ? json(() => ({ error: "regional_data_not_found" }), 404) : page({ kind: "not-found" }, 404);
      if (!regionalEnabled || !regionalDataId.test(id)) return missing();
      if ((await rows(researchDb, "SELECT id FROM regional_data_removals WHERE id=?", id)).length)
        return isApi ? json(() => ({error:"regional_data_removed"}),410) : page({kind:"regional-data-removed"},410);
      const [entry] = await rows<{record:string}>(researchDb, "SELECT record FROM research_visible WHERE kind='regional-data' AND id=?", id);
      if (!entry) return missing();
      const record = await regionalDataRecord(researchDb, JSON.parse(entry.record) as RegionalData);
      if (isApi) return json(() => ({ regional_data: record }));
      return page({kind:"research", title:record.title, summary:record.summary, path:regionalDataPath(id), content:renderRegionalData(record), schema:regionalDataSchema(record,origin), breadcrumbs:[["Directory",browsePath],["Datasets",datasetsPath],[record.title,regionalDataPath(id)]]}, 200);
    }
    if (path.startsWith("/discover/dataset/") || path.startsWith(datasetsApi + "/")) {
      const datasetApi = path.startsWith(datasetsApi + "/");
      const segment = path.slice((datasetApi ? datasetsApi : "/discover/dataset").length + 1);
      const id = segment.includes("/") ? "" : decode(segment);
      const missing = () => datasetApi ? json(() => ({ error: "dataset_not_found" }), 404) : page({ kind: "not-found" }, 404);
      if (!datasetId.test(id) || !hasPubs) return missing();
      // While the collection is switched off, every dataset URL is simply absent.
      const [state] = await optionalRows<{ enabled: number | null; removed: number }>(
        researchDb,
        "SELECT (SELECT enabled FROM dataset_visibility WHERE id=1) enabled,EXISTS(SELECT 1 FROM dataset_removals WHERE id=?) removed",
        id,
      );
      if (state?.enabled !== 1) return missing();
      if (state.removed) return datasetApi ? json(() => ({ error: "dataset_removed" }), 410) : page({ kind: "dataset-removed" }, 410);
      const [entry] = await rows<{ record: string }>(researchDb, "SELECT record FROM research_visible WHERE kind='dataset' AND id=?", id);
      if (!entry) return missing();
      const dataset: Dataset = JSON.parse(entry.record);
      if (datasetApi) return json(() => ({ dataset }));
      const [refs, papers] = [await institutionRefs(researchDb), await datasetPapers(researchDb, dataset)];
      const similar = await similarListings(researchDb, { kind: "dataset", record: dataset }, papers.map((p) => p.id));
      const where = dataset.institutions.map((i) => refs.find((r) => r.id === i)?.name ?? i).join(", ");
      return page({
        kind: "research",
        title: dataset.title,
        summary: `${dataset.summary} ${dataTypeLabel(dataset.data_type, true)} in ${dataset.repository} (${dataset.accessions[0] ?? dataset.id}), ${accessLevels[dataset.access]?.name.toLowerCase() ?? dataset.access} access. ${dataset.label} regional connection: ${where}.`,
        path: datasetPath(id),
        content: renderDataset(dataset, refs, papers, similar, catalog),
        ogType: "article",
        schema: datasetSchema(dataset, papers, refs, origin),
        breadcrumbs: [["Directory", browsePath], ["Datasets", datasetsPath], [dataset.title, datasetPath(id)]],
      }, 200);
    }
    if (path === "/llms.txt")
      return new Response(head ? null : llmsTxt(origin, true, hasPubs, hasDatasets) + (hasRegionalData ? regionalDataLlms(origin) : ""), {
        headers: { ...noStore, "content-type": "text/plain; charset=utf-8" },
      });
    if (detail) {
      const segment = path.slice((pubApi ? publicationsApi + "/" : "/discover/publication/").length);
      const id = segment.includes("/") ? "" : decode(segment);
      const missing = () =>
        pubApi ? json(() => ({ error: "publication_not_found" }), 404) : page({ kind: "not-found" }, 404);
      if (!publicationsEnabled) return missing();
      if ((await rows(researchDb, "SELECT id FROM publication_removals WHERE id=?", id)).length) {
        return pubApi
          ? json(() => ({ error: "publication_removed" }), 410)
          : page({ kind: "listing-removed" }, 410);
      }
      const [row] = await rows<{ record: string }>(
        researchDb,
        "SELECT record FROM research_visible WHERE kind='publication' AND id=?",
        id,
      );
      if (!row) return missing();
      const p: Publication = JSON.parse(row.record);
      const related: Listing[] = [];
      const reverse = await rows<{ id: string }>(
        researchDb,
        "SELECT id FROM research_visible WHERE kind='project' AND id IN (SELECT id FROM research_facets WHERE field='paper' AND (value=? OR value IN (SELECT value FROM research_facets WHERE field='alternate' AND id=?)))",
        id,
        id,
      );
      for (const pid of new Set([...p.projects, ...reverse.map((r) => r.id)])) {
        const project = catalog.project(pid, removed);
        if (project) related.push({ kind: "project", record: project });
      }
      // Repositories the paper's text links to. Shown apart from software the paper releases.
      const linkedCode = (
        await optionalRows<{ project_id: string }>(
          researchDb,
          "SELECT project_id FROM paper_repository_links WHERE paper_id=? ORDER BY project_id",
          id,
        )
      )
        .map((r) => catalog.project(r.project_id, removed))
        .filter((project): project is DirectoryProject => !!project && !related.some((i) => i.kind === "project" && i.record.id === project.id))
        .map((record) => ({ kind: "project", record }) as Listing);
      const versions = await rows<{ record: string }>(
        researchDb,
        "SELECT record FROM research_visible WHERE kind='publication' AND (id IN (?,?) OR (id IN (SELECT id FROM research_facets WHERE field='version' AND value=?) AND id<>?))",
        p.preprint_of ?? "",
        p.published_as ?? "",
        id,
        id,
      );
      for (const version of versions) related.push({ kind: "publication", record: JSON.parse(version.record) });
      const datasets = hasDatasets
        ? (
            await rows<{ record: string; produced: number }>(
              researchDb,
              "SELECT record, EXISTS (SELECT 1 FROM json_each(CASE WHEN json_type(record, '$.paper_provenance')='array' THEN json_extract(record, '$.paper_provenance') ELSE '[]' END) pp WHERE json_extract(pp.value, '$.relation')='produced' AND (json_extract(pp.value, '$.paper')=? OR json_extract(pp.value, '$.paper') IN (SELECT value FROM research_facets WHERE field='alternate' AND id=?))) produced FROM research_visible WHERE kind='dataset' AND id IN (SELECT id FROM research_facets WHERE field='paper' AND (value=? OR value IN (SELECT value FROM research_facets WHERE field='alternate' AND id=?))) ORDER BY activity DESC,id LIMIT 50",
              id, id, id, id,
            )
          ).map((r) => ({ record: JSON.parse(r.record) as Dataset, produced: !!r.produced }))
        : [];
      if (pubApi)
        return json(() => ({
          publication: {
            ...p,
            projects: related.filter((i) => i.kind === "project").map((i) => i.record.id),
            linked_projects: linkedCode.map((i) => i.record.id),
            ...(hasDatasets ? { datasets: datasets.map((d) => d.record.id) } : {}),
            preprint_of: versions.some((v) => JSON.parse(v.record).id === p.preprint_of) ? p.preprint_of : null,
            published_as: versions.some((v) => JSON.parse(v.record).id === p.published_as) ? p.published_as : null,
          },
        }));
      const refs = await institutionRefs(researchDb);
      const institution = p.institutions[0];
      const topic = healthTopic(p.topic) ? facetSlug(p.topic) : "";
      const inFacet = (field: string) =>
        ` AND EXISTS(SELECT 1 FROM research_facets f WHERE f.field='${field}' AND f.value=? AND f.id=+v.id)`;
      const nearby = institution
        ? (
            await rows<{ kind: Listing["kind"]; record: string }>(
              researchDb,
              (await manyPublications(researchDb, institution, topic))
                ? "SELECT kind,record FROM research_visible v WHERE +kind='publication' AND +id NOT IN (?,?,?)" +
                    inFacet("institution") +
                    (topic ? inFacet("topic") : "") +
                    " ORDER BY activity DESC,id LIMIT 5"
                : "SELECT kind,record FROM research_visible WHERE kind='publication' AND id NOT IN (?,?,?) AND id IN (SELECT id FROM research_facets WHERE field='institution' AND value=?" +
                    (topic ? " INTERSECT SELECT id FROM research_facets WHERE field='topic' AND value=?" : "") +
                    ") ORDER BY activity DESC,id LIMIT 5",
              id,
              p.preprint_of ?? "",
              p.published_as ?? "",
              institution,
              ...(topic ? [topic] : []),
            )
          ).map((row) => ({ kind: row.kind, record: JSON.parse(row.record) }) as Listing)
        : [];
      const similar = await similarListings(
        researchDb,
        { kind: "publication", record: p },
        [p.preprint_of ?? "", p.published_as ?? "", ...related.map((i) => i.record.id), ...linkedCode.map((i) => i.record.id), ...nearby.map((i) => i.record.id), ...datasets.map((d) => d.record.id)].filter(Boolean),
      );
      const institutionName = refs.find((r) => r.id === institution)?.name ?? institution;
      const more = institution
        ? {
            heading: topic ? `Recent ${p.topic.toLowerCase()} publications from ${institutionName}` : `Recent publications from ${institutionName}`,
            items: nearby,
            href: `/discover/institution/${encodeURIComponent(institution)}?kind=publication${topic ? "&topic=" + topic : ""}&sort=activity`,
          }
        : undefined;
      return page(
        {
          kind: "research",
          title: displayTitle(p),
          summary: publicationDescription(p, refs),
          path: pubPath(id),
          content: renderPublication(p, refs, related, more, catalog, linkedCode, similar, datasets.filter((d) => d.produced).map((d) => d.record)),
          ogType: "article",
          meta: citationMeta(p),
          schema: publicationSchema(p, origin),
          breadcrumbs: [
            ["Directory", browsePath],
            ...(healthTopic(p.topic) ? [[p.topic, topicPath(p.topic)] as [string, string]] : []),
            [displayTitle(p), pubPath(id)],
          ],
        },
        200,
      );
    }
    if (path.startsWith("/discover/sitemap/") || decodedPublicPath(path) === "/sitemap.xml") {
      const prefix = "/discover/sitemap/";
      const partSize = 5000;
      const namespace = ' xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
      if (decodedPublicPath(path) === "/sitemap.xml") {
        const [row] = hasPubs
          ? await rows<{ n: number }>(
              researchDb,
              "SELECT count(*) n FROM research_visible WHERE kind='publication'",
            )
          : [{ n: 0 }];
        const parts = [
          "directory",
          ...Array.from({ length: Math.ceil(row.n / partSize) }, (_, i) => String(i + 1)),
        ];
        if (hasStudies) {
          const [{ n }] = await rows<{ n: number }>(researchDb, "SELECT count(*) n FROM research_visible WHERE kind='study'");
          parts.push(...Array.from({ length: Math.ceil(n / partSize) }, (_, i) => "studies-" + (i + 1)));
        }
        if (hasDatasets) {
          const [{ n }] = await rows<{ n: number }>(researchDb, "SELECT count(*) n FROM research_visible WHERE kind='dataset'");
          parts.push(...Array.from({ length: Math.ceil(n / partSize) }, (_, i) => "datasets-" + (i + 1)));
        }
        if (hasRegionalData) {
          const [{ n }] = await rows<{n:number}>(researchDb, "SELECT count(*) n FROM research_visible WHERE kind='regional-data'");
          parts.push(...Array.from({length: Math.ceil(n / partSize)}, (_, i) => "regional-data-" + (i + 1)));
        }
        return xml(
          `<sitemapindex${namespace}>${parts.map((p) => `<sitemap><loc>${html(origin + prefix + p + ".xml")}</loc></sitemap>`).join("")}</sitemapindex>`,
        );
      }
      let entries: { loc: string; lastmod?: string }[];
      if (path === prefix + "directory.xml") {
        entries = projectSitemap(catalog, removed, origin);
        if (hasPubs) {
          // Registry institutions are listed once, at their reference ID.
          const refs = await institutionRefs(researchDb);
          const legacy = new Set(
            catalog
              .publishedEntities(removed)
              .filter((e) => e.kind === "institution" && institutionFor(refs, e.name))
              .map((e) => origin + entityPath(e)),
          );
          entries = entries.filter((e) => !legacy.has(e.loc));
          const groups = (await summarize(researchDb)).facets;
          entries.push(
            ...(["county", "institution", "topic"] as const).flatMap((field) =>
              groups[field]
                .map((g) => g.value)
                .filter((value) => field !== "topic" || healthTopic(value))
                .sort()
                .map((value) => ({ loc: origin + "/discover/" + field + "/" + encodeURIComponent(value) })),
            ),
          );
        }
      } else {
        const match = /^\/discover\/sitemap\/(studies-|datasets-|regional-data-)?([1-9]\d{0,5})\.xml$/.exec(path);
        const part = match?.[1] === "studies-" ? "study" : match?.[1] === "datasets-" ? "dataset" : match?.[1] === "regional-data-" ? "regional-data" : "publication";
        if (!match || !{ study: hasStudies, dataset: hasDatasets, "regional-data": hasRegionalData, publication: hasPubs }[part]) return page({ kind: "not-found" }, 404);
        entries = (
          await rows<{ id: string; checked: string | null }>(
            researchDb,
            part === "regional-data"
              ? "SELECT v.id,max(json_extract(v.record,'$.checked'),coalesce(c.checked,'')) checked FROM research_visible v LEFT JOIN regional_data_checks c ON c.id=v.id WHERE v.kind=? ORDER BY v.id LIMIT ? OFFSET ?"
              : "SELECT id,json_extract(record,'$.checked') checked FROM research_visible WHERE kind=? ORDER BY id LIMIT ? OFFSET ?",
            part,
            partSize,
            (Number(match[2]) - 1) * partSize,
          )
        ).map((r) => ({ loc: origin + { study: studyPath, dataset: datasetPath, "regional-data": regionalDataPath, publication: pubPath }[part](r.id), lastmod: r.checked ?? undefined }));
        if (!entries.length) return page({ kind: "not-found" }, 404);
      }
      const seen = new Set<string>();
      return xml(
        `<urlset${namespace}>${entries
          .filter((e) => !seen.has(e.loc) && seen.add(e.loc))
          .map((e) => `<url><loc>${html(e.loc)}</loc>${e.lastmod && /^\d{4}-\d{2}-\d{2}$/.test(e.lastmod) ? `<lastmod>${e.lastmod}</lastmod>` : ""}</url>`)
          .join("")}</urlset>`,
      );
    }
    if (path === "/" && (hasPubs || hasRegionalData)) {
      const summary = await summarize(researchDb);
      const latest = (
        await rows<{ kind: Listing["kind"]; record: string }>(
          researchDb,
          // Newest publications by publication date, not by when the backfill added them.
          "SELECT kind,record FROM research_visible WHERE +kind='publication' AND activity<=? ORDER BY activity DESC,id LIMIT 6",
          new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
        )
      ).map((row) => ({ kind: row.kind, record: JSON.parse(row.record) }) as Listing);
      const refs = await institutionRefs(researchDb);
      const now = new Date();
      return page(
        {
          kind: "home",
          data: catalog.home(removed, now),
          publications: summary.kinds.publication?.works ?? 0,
          latest,
          summary,
          names: namesFor(refs, optionsFor(catalog, removed, refs)),
          now,
        },
        200,
      );
    }
    const scoped = /^\/discover\/(institution|topic|county)\/([^/]+)$/.exec(path);
    let refs: Institution[] = [];
    const needsRefs =
      scoped || path === newPath || path === feedPath || combinedApi || pubApi || studyApi || datasetList || regionalList || datasetsLanding || (path === browsePath && (hasPubs || hasRegionalData));
    if (
      needsRefs &&
      (hasPubs || hasRegionalData ||
        (
          await rows(
            researchDb,
            "SELECT name FROM sqlite_master WHERE type='table' AND name='research_institutions'",
          )
        ).length)
    ) {
      refs = await institutionRefs(researchDb);
    }
    const projectFilters =
      searchParams.get("tools") === "project" ||
      ["language", "license", "owner", "tag", "archived", "year", "paper", "since"].some((key) =>
        searchParams.has(key),
      ) ||
      searchParams.get("sort") === "stars";
    if (
      path === newPath ||
      path === feedPath ||
      pubApi ||
      studyApi ||
      datasetList || regionalList ||
      (datasetsLanding && (hasDatasets || hasRegionalData)) ||
      combinedApi ||
      (scoped && refs.length > 0) ||
      (path === browsePath && searchParams.has("kind") && !hasPubs) ||
      ((hasPubs || hasRegionalData) &&
        ((path === browsePath && (!projectFilters || searchParams.get("kind") === "publication")) || scoped))
    ) {
      if (pubApi && !hasPubs) return json(() => ({ error: "publication_not_found" }), 404);
      if (studyApi && !hasStudies) return json(() => ({ error: "study_not_found" }), 404);
      if (regionalList && !hasRegionalData) return json(() => ({ error: "regional_data_not_found" }), 404);
      if (datasetList && !hasDatasets) return json(() => ({ error: "dataset_not_found" }), 404);
      const options = optionsFor(catalog, removed, refs);
      const params = new URLSearchParams(searchParams);
      // "Other science" has no topic feed, and HTML views do not offer it as a topic filter.
      const nonHealth = params.getAll("topic").filter((t) => !healthTopic(t));
      if (nonHealth.length && path === feedPath) return page({ kind: "not-found" }, 404);
      if (nonHealth.length && !api && !pubApi) {
        const kept = params.getAll("topic").filter((t) => healthTopic(t));
        params.delete("topic");
        for (const t of kept) params.append("topic", t);
      }
      if (pubApi) params.set("kind", "publication");
      if (studyApi) params.set("kind", "study");
      if (datasetList) params.set("kind", "dataset");
      if (regionalList) params.set("kind", "regional-data");
      if (path === feedPath || path === newPath) params.set("sort", "added");
      // A landing page is the unfiltered first page. Every other combination is a search result.
      const filtered = [...searchParams.keys()].some((key) => key !== "page");
      const pageNo = Number(searchParams.get("page")) > 1;
      let scope: { field: ScopeField; slug: string; name: string; ref?: Institution } | undefined;
      if (scoped) {
        const field = scoped[1] as ScopeField,
          value = decode(scoped[2]);
        if (field === "topic" && !healthTopic(value)) return page({ kind: "not-found" }, 404);
        const ref = field === "institution" ? institutionFor(refs, value) : undefined;
        params.set(field, ref?.id ?? value);
        const name = ref?.name ?? options[field].get(value) ?? value;
        scope = { field, slug: ref?.id ?? value, name: field === "county" ? name + " County" : name, ref };
      }
      if (path === feedPath && (hasPubs || hasRegionalData)) {
        return xml(
          rss(origin, params, await researchFeed(researchDb, params, refs), options),
          "application/rss+xml",
        );
      }
      // The datasets page reads like a search for kind=dataset, newest release first.
      const query = new URLSearchParams(params);
      if (datasetsLanding) {
        const selectedKind = query.get("kind");
        query.set("kind", selectedKind === "dataset" || selectedKind === "regional-data" ? selectedKind : hasRegionalData ? "__datasets" : "dataset");
        if (!query.get("sort") && !query.get("q")) query.set("sort", "activity");
      }
      const result = (hasPubs || hasRegionalData)
        ? await researchQuery(researchDb, query, refs)
        : projectQuery(catalog, removed, params, options, refs);
      if (scoped && !result.total && !options[scoped[1] as keyof typeof options].has(params.get(scoped[1])!))
        return page({ kind: "not-found" }, 404);
      if (pubApi || combinedApi || studyApi || datasetList || regionalList) {
        const publicationIds = result.items.flatMap((i) =>
          i.kind === "publication" ? [i.record.published_as, i.record.preprint_of].filter(Boolean) : [],
        );
        const visibleVersions = new Set(
          publicationIds.length
            ? (
                await rows<{ id: string }>(
                  researchDb,
                  "SELECT id FROM research_visible WHERE id IN (SELECT value FROM json_each(?))",
                  JSON.stringify(publicationIds),
                )
              ).map((r) => r.id)
            : [],
        );
        const regionalRecords = await regionalDataRecords(researchDb, result.items.flatMap(i => i.kind === "regional-data" ? [i.record] : []));
        const regionalById = new Map(regionalRecords.map(r => [r.id,r]));
        const listings = result.items.map((i) =>
          i.kind === "regional-data" ? {kind:i.kind,record:regionalById.get(i.record.id)!} : i.kind === "project"
            ? { kind: i.kind, record: publicProject(i.record) }
            : i.kind === "publication" ? {
                kind: i.kind,
                record: {
                  ...i.record,
                  projects: i.record.projects.filter((id) => catalog.project(id, removed)),
                  preprint_of: visibleVersions.has(i.record.preprint_of ?? "") ? i.record.preprint_of : null,
                  published_as: visibleVersions.has(i.record.published_as ?? "") ? i.record.published_as : null,
                },
              } : i,
        );
        return json(() => ({
          ...(pubApi
            ? { publications: listings.map((i) => i.record) }
            : studyApi ? { studies: listings.map((i) => i.record) } : regionalList ? { regional_data: listings.map((i) => i.record) } : datasetList ? { datasets: listings.map((i) => i.record) } : { listings }),
          page: result.page,
          page_size: 24,
          total: "more" in result && result.more ? result.total : result.counts.reduce((sum, kind) => sum + kind.works, 0),
          record_total: result.total,
          ...("more" in result && result.more ? { total_is_lower_bound: true } : {}),
          total_pages: Math.ceil(result.total / 24),
        }));
      }
      if (path === feedPath)
        return xml(
          rss(origin, params, { ...result, hasMore: result.page * 24 < result.total }, options),
          "application/rss+xml",
        );
      const names = namesFor(refs, options);
      const now = new Date();
      const feed = feedUrl(datasetsLanding ? query : params);
      const landing = !filtered && !pageNo;
      const choices = datasetsLanding ? await datasetFacetChoices(researchDb, names, hasRegionalData) : undefined;
      const described = describeQuery(datasetsLanding ? new URLSearchParams([...params, ["kind", "dataset"]]) : params, names, path === newPath, choices?.repositories);
      let header: string, title: string, description: string, about: Record<string, unknown> | undefined, aside = "";
      const crumbs: [string, string][] = [["Directory", browsePath]];
      if (datasetsLanding) {
        crumbs.push(["Datasets", datasetsPath]);
        title = landing ? "Datasets from Delaware Valley research" : described;
        description = landing
          ? `${kindCounts(result.counts)} connected to the nine-county Delaware Valley, with the repository that holds each one and how to get access.`
          : `${described}. ${resultCount(result) || "No listings"} in The Valley Desk directory of Delaware Valley healthcare research.`;
        header = landing
          ? `<header class="entity-head"><nav class="breadcrumb" aria-label="Breadcrumb"><a href="${browsePath}">Directory</a></nav><h1>Datasets</h1><p class="lede">${html(kindCounts(result.counts))} from regional research, each with the repository that holds it and how to get access. Newest releases first.</p></header>`
          : filteredHeader(crumbs, described, path);
      } else if (scope) {
        const county = counties.find((c) => facetSlug(c.name) === scope.slug);
        const place = county ? `${scope.name}, ${county.state === "NJ" ? "New Jersey" : "Pennsylvania"}` : scope.name;
        crumbs.push([scope.name, path]);
        about =
          scope.field === "institution"
            ? organizationSchema(scope.ref, scope.name, origin, refs)
            : scope.field === "county"
              ? { "@type": "AdministrativeArea", name: place, containedInPlace: { "@type": "State", name: county?.state === "NJ" ? "New Jersey" : "Pennsylvania" } }
              : { "@type": "Thing", name: scope.name };
        title =
          scope.field === "institution"
            ? `${scope.name}: ${hasStudies || hasDatasets ? "healthcare research" : "healthcare publications and research software"}`
            : scope.field === "topic"
              ? `${scope.name} research in the Delaware Valley`
              : `Healthcare research in ${place}`;
        if (landing) {
          const summary = await summarize(researchDb, { field: scope.field, value: scope.slug });
          const built = entityHeader({ ...scope, refs, summary, names, now, feed, name: scope.field === "county" ? place : scope.name });
          header = built.header;
          aside = (scope.field === "institution" ? partnerList(await partners(researchDb, scope.slug), names) : "") + built.index;
          description = built.description;
        } else {
          header = filteredHeader(crumbs, described, path);
          title = described;
          description = `${described}. ${resultCount(result) || "No listings"} in The Valley Desk directory of Delaware Valley healthcare research.`;
        }
      } else if (path === newPath) {
        title = landing ? "What’s new" : `What’s new: ${described}`;
        description = `Healthcare research listings in the order they entered The Valley Desk directory, newest first. ${kindCounts(result.counts)}.`;
        crumbs.push(["What’s new", newPath]);
        const localDay = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
        }).format(now);
        const month = localDay.slice(0, 7);
        const recent = landing && hasPubs
          ? await rows<{ record: string }>(
              researchDb,
              "SELECT record FROM research_visible WHERE +kind='publication' AND activity>=? AND activity<=? ORDER BY activity DESC,id LIMIT 3",
              month,
              localDay + "~",
            )
          : [];
        header = `<header class="entity-head"><nav class="breadcrumb" aria-label="Breadcrumb"><a href="${browsePath}">Directory</a></nav>
          <h1>What’s new</h1>
          <p class="lede">Additions are ordered by the date they entered the directory.</p></header>${recent.length ? `<section class="entity-head" aria-labelledby="published-this-month"><div class="section-heading"><h2 id="published-this-month">Published this month</h2><a href="${browsePath}?kind=publication&amp;date_from=${month}&amp;date_to=${localDay}&amp;sort=activity">All publications this month</a></div>${renderListingCards(recent.map(({ record }) => ({ kind: "publication", record: JSON.parse(record) })), catalog)}</section>` : ""}`;
      } else {
        title = landing ? (hasStudies || hasDatasets ? "Search healthcare research" : "Search healthcare publications and research software") : described;
        description = landing
          ? `Search ${kindCounts(result.counts)} connected to the nine-county Delaware Valley by title, term, institution, topic or county.`
          : `${described}. ${resultCount(result) || "No listings"} in The Valley Desk directory of Delaware Valley healthcare research.`;
        header = landing
          ? `<header class="entity-head"><h1>${hasStudies || hasDatasets ? "Healthcare research" : "Publications and research software"}</h1><p class="lede">The directory lists ${kindCounts(result.counts)} connected to the nine-county Delaware Valley. Search titles, terms and institutions, or narrow the list by kind, institution, topic and county.</p></header>`
          : filteredHeader(crumbs, described, path);
      }
      const q = params.get("q")?.slice(0, 200).match(/[\p{L}\p{N}]+/gu);
      // Only the first page of a search shows who works on the subject.
      if (q?.length && !scope && path === browsePath && hasPubs && result.total > 1 && result.page === 1) {
        aside = groupList(await activeGroups(researchDb, q.map((term) => '"' + term + '"*').join(" AND ")), names, params.get("q") ?? "");
      }
      const offset = (result.page - 1) * 24;
      // An institution reached by name or alias names its reference ID as the canonical URL.
      const canonicalPath = scope ? entityHref(scope.field, scope.slug) : path;
      return page(
        {
          kind: "research",
          title,
          summary: description,
          path,
          canonical: landing ? canonicalPath : canonicalPath + "?" + canonicalQuery(searchParams),
          robots: landing ? undefined : "noindex, follow",
          content: renderResearch({
            header,
            path,
            params,
            data: result,
            catalog,
            options,
            enabled: hasPubs || hasRegionalData,
            publicationsAvailable: hasPubs,
            studiesAvailable: hasStudies,
            datasetsAvailable: hasDatasets,
            regionalDataAvailable: hasRegionalData,
            scope: scoped?.[1],
            byDate: path === newPath,
            aside,
            ...(choices
              ? {
                  facets: [
                    ...(hasRegionalData ? [{name:"kind", label:"Kind", all:"All datasets", choices: [...(hasDatasets ? [["dataset", "Research datasets"] as [string,string]] : []), ["regional-data", "Regional data"] as [string,string]]}] : []),
                    ...choices.facets,
                  ],
                  orders: [["activity", "Release date"], ["added", "Date added"], ["name", "Title A–Z"]] as [string, string][],
                  feed,
                }
              : {}),
          }),
          feed: { title: scope ? `Additions: ${scope.name}` : datasetsLanding ? "Dataset additions" : "Directory additions", href: feed },
          breadcrumbs: crumbs.length > 1 ? crumbs : undefined,
          schema: {
            "@type": "CollectionPage",
            name: title,
            description,
            url: origin + (landing ? canonicalPath : canonicalPath + "?" + canonicalQuery(searchParams)),
            isPartOf: { "@id": origin + "/#website" },
            ...(about ? { about } : {}),
            mainEntity: {
              "@type": "ItemList",
              numberOfItems: "more" in result && result.more ? result.total : result.counts.reduce((sum, row) => sum + row.works, 0),
              itemListElement: result.items.map((item, i) => ({
                "@type": "ListItem",
                position: offset + i + 1,
                url: origin + listingPath(item),
                name: listingTitle(item),
              })),
            },
          },
        },
        200,
      );
    }
    if (hasPubs && path.startsWith(detailPrefix)) {
      const id = decode(path.slice(detailPrefix.length));
      const project = catalog.project(id, removed);
      if (project) {
        const papers = await rows<{ id: string; title: string }>(
          researchDb,
          "SELECT id,title FROM research_visible WHERE kind='publication' AND (id IN (SELECT id FROM research_facets WHERE field='project' AND value=?) OR id IN (SELECT value FROM research_facets WHERE field='paper' AND id=?) OR id IN (SELECT id FROM research_facets WHERE field='alternate' AND value IN (SELECT value FROM research_facets WHERE field='paper' AND id=?))) ORDER BY title",
          id,
          id,
          id,
        );
        linked = papers.map((p) => ({ title: publicationTitle(p), url: pubPath(p.id) }));
        const known = new Set(papers.map((p) => p.id));
        mentions = (
          await optionalRows<{ id: string; title: string }>(
            researchDb,
            "SELECT id,title FROM research_visible WHERE kind='publication' AND id IN (SELECT paper_id FROM paper_repository_links WHERE project_id=?) ORDER BY title",
            id,
          )
        )
          .filter((p) => !known.has(p.id))
          .map((p) => ({ title: publicationTitle(p), url: pubPath(p.id) }));
        const shown = new Set([...known, ...mentions.map((m) => decodeURIComponent(m.url.slice("/discover/publication/".length)))]);
        research = (await similarListings(researchDb, { kind: "project", record: project }, [...shown], 12))
          .filter((item) => item.kind !== "project")
          .slice(0, 5);
      }
    }
  } catch (error) {
    console.error("directory_unavailable", path, String(error));
    return unavailable();
  }

  if (api) {
    if (pathname === apiPath || pathname === apiPath + "/") {
      return json(() => ({ projects: catalog.projects(removed).map(publicProject) }));
    }
    const id = decode(pathname.slice(apiPath.length + 1));
    if (/^[1-9][0-9]{0,19}$/.test(id)) {
      if (removed.has(id)) return json(() => ({ error: "project_removed" }), 410);
      const project = catalog.project(id, removed);
      if (project) return json(() => ({ project: publicProject(project) }));
    }
    return json(() => ({ error: "project_not_found" }), 404);
  }

  const now = new Date();
  if (pathname === "/") return page({ kind: "home", data: catalog.home(removed, now) }, 200);
  if (pathname === browsePath || pathname === browsePath + "/") {
    return page({ kind: "results", data: catalog.list(removed, searchParams, now), noindex: searchParams.size > 0 }, 200);
  }
  if (pathname === "/discover" || pathname === "/discover/") return redirect(browsePath + search);
  if (pathname === methodPath || pathname === methodPath + "/")
    return page({ kind: "methodology", publications: hasPubs, studies: hasStudies, datasets: hasDatasets, regionalData: hasRegionalData }, 200);

  const entityMatch = entityRoute.exec(pathname);
  if (entityMatch) {
    const entity = catalog.entityAt(entityMatch[1], decode(entityMatch[2]), removed);
    return entity
      ? page({ kind: "results", data: catalog.list(removed, searchParams, now, entity) }, 200)
      : page({ kind: "not-found" }, 404);
  }

  const raw = pathname.startsWith(detailPrefix) ? decode(pathname.slice(detailPrefix.length)) : "";
  const id = publicProjectId(raw);
  if (!id) return page({ kind: "not-found" }, 404);
  if (removed.has(id)) return page({ kind: "removed" }, 410);
  const project = catalog.project(id, removed);
  if (!project) return page({ kind: "not-found" }, 404);
  if (raw !== id) return redirect(projectPath(project));
  return page({ kind: "project", project, related: catalog.related(project, removed), linked, mentions, research, now }, 200);
}
