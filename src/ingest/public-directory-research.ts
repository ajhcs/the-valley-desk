import {
  browsePath,
  counties,
  projectPath,
  type DirectoryProject,
  type DirectoryCatalog,
} from "./public-directory-data";
import { count, externalLink, html, projectCards, searchInput } from "./public-directory-ui";

export const newPath = "/discover/new";
export const feedPath = "/discover/updates.xml";
export const publicationsApi = "/api/directory/publications";
export const pubPath = (id: string) => "/discover/publication/" + encodeURIComponent(id);
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
  open_access: { url: string | null } | null;
  projects: string[];
  published_as: string | null;
  preprint_of: string | null;
  retracted: boolean;
};
export type Institution = {
  id: string;
  name: string;
  aliases: string[];
  sites: { name: string; place: string; county: string; source: string }[];
};
type RecordsByKind = { project: DirectoryProject; publication: Publication };
export type ListingKind = keyof RecordsByKind;
export type Listing<K extends ListingKind = ListingKind> = {
  [P in K]: { kind: P; record: RecordsByKind[P] };
}[K];
export const publicationTitle = (p: Pick<Publication, "title">) =>
  p.title.replace(/<\/?(?:em|strong|i|b|sub|sup)>/gi, "");

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
    name: "Project",
    plural: "Projects",
    path: (id) => projectPath({ id }),
    title: (r) => r.name,
    card: (r, catalog) => projectCards(catalog, [r], "cards", "added"),
  },
  publication: {
    name: "Publication",
    plural: "Publications",
    path: pubPath,
    title: publicationTitle,
    card: publicationCard,
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
    }
  }
  if (facetQueries.length) where.push("id IN (" + facetQueries.join(" INTERSECT ") + ")");
  if (params.get("kind")) {
    where.push("kind=?");
    args.push(params.get("kind")!);
  }
  // Optional date bounds: added_from/added_to on the listing date, date_from/date_to on the
  // published or last-push date. A bound is YYYY, YYYY-MM or YYYY-MM-DD and is inclusive.
  for (const [key, column] of [["added", "added"], ["date", "activity"]]) {
    const [after, before] = ["_from", "_to"].map((end) => dateBound(params.get(key + end)));
    if (after) where.push(column + ">=?"), args.push(after);
    if (before) where.push(column + "<>'' AND " + column + "<=?"), args.push(before + "~");
  }
  const from = " FROM research_visible" + (where.length ? " WHERE " + where.join(" AND ") : "");
  return { from, args, facetCount: facetQueries.length };
}

function readListing(row: { kind: Listing["kind"]; record: string }): Listing {
  return { kind: row.kind, record: JSON.parse(row.record) };
}
export async function researchFeed(db: ResearchDb, params: URLSearchParams, refs: Institution[]) {
  const { from, args } = searchSource(params, refs);
  const page = pageNumber(params);
  const result = await rows<{ kind: Listing["kind"]; record: string }>(
    db,
    "SELECT kind,record" + from + " ORDER BY added DESC,id LIMIT 25 OFFSET ?",
    ...args,
    (page - 1) * 24,
  );
  return { page, items: result.slice(0, 24).map(readListing), hasMore: result.length > 24 };
}
export async function researchQuery(db: ResearchDb, params: URLSearchParams, refs: Institution[]) {
  const { from, args, facetCount } = searchSource(params, refs);
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
  const counts = await rows<{ kind: ListingKind; n: number; works: number }>(
    db,
    "SELECT kind,count(*) n,count(DISTINCT group_id) works" + from + " GROUP BY kind",
    ...args,
  );
  const total = counts.reduce((sum, row) => sum + row.n, 0);
  const page = Math.min(pageNumber(params), Math.max(1, Math.ceil(total / 24)));
  const result = await rows<{ kind: Listing["kind"]; record: string }>(
    db,
    "SELECT kind,record" + from + " ORDER BY " + order + " LIMIT 24 OFFSET ?",
    ...args,
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

function evidence(p: Publication) {
  return `<a class="evidence ${p.label === "Verified" ? "evidence-verified" : ""}" href="/discover/methodology#regional-evidence">${html(p.label)}</a> ${html(p.connection)} ${externalLink(p.source, "Affiliation source")}`;
}
function publicationCard(p: Publication) {
  return `<article class="project-card paper-card"><div class="card-topic">Publication · ${html(p.type)}</div>
    <h3><a href="${html(pubPath(p.id))}">${html(publicationTitle(p))}</a></h3>${p.retracted ? "<strong>Retracted</strong>" : ""}
    <p>${html([p.venue, p.topic].filter(Boolean).join(" · "))}</p><p>${evidence(p)}</p>
    <div class="card-meta">Published ${html(p.published)} · Added ${html(p.added)}</div></article>`;
}
export function renderListingCards(items: Listing[], catalog: DirectoryCatalog) {
  return `<div class="research-grid">${items.map((item) => card(item, catalog)).join("")}</div>`;
}

export function feedUrl(params: URLSearchParams) {
  const filters = new URLSearchParams(params);
  for (const key of ["page", "view", "sort"]) filters.delete(key);
  return feedPath + (filters.size ? "?" + filters : "");
}
export function renderResearch(
  title: string,
  path: string,
  params: URLSearchParams,
  data: Results,
  catalog: DirectoryCatalog,
  options: Options,
  enabled: boolean,
  intro = "",
  scope = "",
) {
  function select(name: string, label: string, choices: [string, string][]) {
    const selected = params.get(name) ?? "";
    return `<label>${label}<select name="${name}"><option value="">All</option>${choices
      .map(
        ([v, n]) =>
          `<option value="${html(v)}"${v === selected || v === facetSlug(selected) ? " selected" : ""}>${html(n)}</option>`,
      )
      .join("")}</select></label>`;
  }
  function pageLink(n: number, label: string) {
    const next = new URLSearchParams(params);
    next.set("page", String(n));
    return `<a class="button secondary" href="${html(path + "?" + next)}">${label}</a>`;
  }
  return `<section class="frame page"><h1>${html(title)}</h1>${intro}
    <p><a href="${html(feedUrl(params))}">Follow additions via RSS</a></p>
    <form class="research-form" action="${html(path)}" method="get" role="search">${searchInput(params.get("q") ?? "")}
    <div class="research-filters">${
      enabled
        ? select(
            "kind",
            "Listing kind",
            Object.entries(templates).map(([kind, t]) => [kind, t.plural]),
          )
        : ""
    }
    ${fields
      .filter((f) => f !== scope)
      .map((f) =>
        select(
          f,
          f[0].toUpperCase() + f.slice(1),
          [...options[f]].sort((a, b) => a[1].localeCompare(b[1])),
        ),
      )
      .join("")}
    ${
      path !== newPath && enabled
        ? `<label>Sort<select name="sort">${[
            ["added", "Date added"],
            ["activity", "Published or last project activity"],
            ["name", "Title A–Z"],
          ]
            .map(([v, n]) => `<option value="${v}"${params.get("sort") === v ? " selected" : ""}>${n}</option>`)
            .join("")}</select></label>`
        : ""
    }
    <button class="button secondary">Apply filters</button></div></form>
    ${path === browsePath ? '<p><a href="/discover/works?tools=project">Project filters for language, license and GitHub activity</a></p>' : ""}
    <p>${
      data.counts
        .filter((r) => r.n)
        .map(
          (r) =>
            count(r.works) +
            " " +
            (r.works === 1 ? templates[r.kind].name : templates[r.kind].plural).toLowerCase() +
            (r.n > r.works ? " (" + count(r.n) + " versions)" : ""),
        )
        .join(" · ") || "No matching listings"
    }</p>
    ${renderListingCards(data.items, catalog)}
    <nav class="pagination" aria-label="Results pages">${data.page > 1 ? pageLink(data.page - 1, "Previous") : ""}
    ${data.total > 24 ? "Page " + count(data.page) + " of " + count(Math.ceil(data.total / 24)) : ""} ${data.page * 24 < data.total ? pageLink(data.page + 1, "Next") : ""}</nav></section>`;
}
export function renderPublication(p: Publication, refs: Institution[], related: Listing[]) {
  const entity = (kind: string, key: string, name: string) =>
    `<a href="/discover/${kind}/${encodeURIComponent(key)}">${html(name)}</a>`;
  const places = p.institutions.map((id) =>
    entity("institution", id, refs.find((ref) => ref.id === id)?.name ?? id),
  );
  return `<article class="frame page project-page"><nav class="breadcrumb"><a href="${browsePath}">Research directory</a></nav>
    <header class="project-intro publication-intro"><p class="card-topic">Publication · ${html(p.type)}</p><h1>${html(publicationTitle(p))}</h1>
    <p>${html([p.venue, "Published " + p.published].filter(Boolean).join(" · "))}</p>${p.retracted ? "<strong>Retracted publication</strong>" : ""}
    <p>${externalLink(p.url, "Read the publication ↗", "button primary")} ${externalLink(p.open_access?.url, "Open access copy ↗")}</p></header>
    <section class="detail-section"><h2>Byline</h2><p>${p.authors.map((a) => html(a.name)).join(", ")}</p>
    ${p.author_count > p.authors.length ? `<p>${p.authors.length} of ${count(p.author_count)} authors shown in byline order.</p>` : ""}</section>
    <section class="detail-section"><h2>Regional connection</h2><p>${evidence(p)}</p><p>${[...places, ...p.counties.map((c) => entity("county", facetSlug(c), c + " County"))].join(" · ")}</p></section>
    <section class="detail-section"><h2>Directory record</h2><p>${entity("topic", facetSlug(p.topic), p.topic)}</p><p>Added ${html(p.added)} · Source checked ${html(p.checked)}</p></section>
    ${related.length ? `<section class="detail-section"><h2>Connected research</h2><ul>${related.map((i) => `<li>${i.kind === "project" ? "Project" : "Publication version"} · <a href="${html(listingPath(i))}">${html(listingTitle(i))}</a></li>`).join("")}</ul></section>` : ""}</article>`;
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
