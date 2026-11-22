import { decodedPublicPath } from "../lib/editorial-retirement";
import { html } from "./public-directory-ui";
import {
  newPath,
  feedPath,
  publicationsApi,
  pubPath,
  rows,
  optionsFor,
  institutionFor,
  projectQuery,
  researchQuery,
  researchFeed,
  renderPublication,
  publicationTitle,
  displayTitle,
  publicationType,
  renderResearch,
  facetSlug,
  kindCounts,
  listingPath,
  listingTitle,
  topicPath,
  rss,
  feedUrl,
  type Publication,
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
    ["/api/directory/listings", "/llms.txt", newPath, feedPath, publicationsApi].includes(
      path.replace(/\/$/, ""),
    ) ||
    path.startsWith(publicationsApi + "/") ||
    path.startsWith("/discover/publication/") ||
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
  return [
    ...["/", browsePath, methodPath, newPath, "/discover/connect"].map((path) => ({ loc: origin + path })),
    ...directoryCatalog.publishedEntities(removed).map((entity) => ({ loc: origin + entityPath(entity) })),
    ...directoryCatalog.projects(removed).map((project) => ({
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
function describeQuery(params: URLSearchParams, names: Names, added = false) {
  const kind = params.get("kind");
  const parts = [kind === "publication" ? "Publications" : kind === "project" ? "Research software" : "Publications and research software"];
  const q = params.get("q")?.trim();
  if (q) parts.push(`matching “${q.slice(0, 80)}”`);
  const topic = params.getAll("topic").filter(Boolean).map((t) => names.topic(facetSlug(t)));
  if (topic.length) parts.push("on " + topic.join(" or "));
  const institution = params.getAll("institution").filter(Boolean).map((i) => names.institution(i));
  if (institution.length) parts.push("from " + institution.join(" or "));
  const county = params.getAll("county").filter(Boolean).map((c) => names.county(facetSlug(c)) + " County");
  if (county.length) parts.push("in " + county.join(" or "));
  const label = params.getAll("label").filter(Boolean);
  if (label.length) parts.push(`with ${label.join(" or ")} evidence`);
  if (!added && params.get("sort") === "name") parts.push("by title");
  if (!added && params.get("sort") === "activity") parts.push("by publication or push date");
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

export async function servePublicDirectory(
  request: Request,
  db?: RemovalDb,
  origin = DEFAULT_PUBLIC_ORIGIN,
  nonce?: string,
  catalog: ReturnType<typeof createDirectoryCatalog> = directoryCatalog,
  publicationsEnabled = false,
): Promise<Response> {
  const head = request.method === "HEAD";
  if (request.method !== "GET" && !head) {
    return new Response(null, { status: 405, headers: { ...noStore, allow: "GET, HEAD" } });
  }
  const { pathname, search, searchParams } = new URL(request.url);
  const api = pathname.startsWith("/api/directory/");
  const fragment = request.headers.get(fragmentHeader) === "results";
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
        headers: status >= 400 ? { ...headers, "x-robots-tag": "noindex" } : headers,
      },
    );
  };
  const json = (value: () => unknown, status = 200) =>
    new Response(head ? null : JSON.stringify(value()), { status, headers: jsonHeaders });
  const redirect = (path: string) => new Response(null, { status: 308, headers: { ...noStore, location: path } });

  let removed: Set<string>;
  try {
    removed = await removalIds(db);
  } catch {
    return api ? json(() => ({ error: "directory_unavailable" }), 503) : page({ kind: "unavailable" }, 503);
  }

  const researchDb = db!;
  const path = pathname.replace(/\/$/, "") || "/";
  const combinedApi = path === "/api/directory/listings";
  const pubApi = path === publicationsApi || path.startsWith(publicationsApi + "/");
  const detail = path.startsWith("/discover/publication/") || path.startsWith(publicationsApi + "/");
  const xml = (value: string, type = "application/xml") =>
    new Response(head ? null : value, { headers: { ...noStore, "content-type": type + "; charset=utf-8" } });
  const unavailable = () =>
    api || pubApi ? json(() => ({ error: "directory_unavailable" }), 503) : page({ kind: "unavailable" }, 503);
  let hasPubs = false;
  let linked: { title: string; url: string }[] = [];
  try {
    if (publicationsEnabled) {
      hasPubs =
        (await rows(researchDb, "SELECT id FROM research_visible WHERE kind='publication' LIMIT 1")).length > 0;
    }
    if (path === "/llms.txt")
      return new Response(head ? null : llmsTxt(origin, true, hasPubs), {
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
      const versions = await rows<{ record: string }>(
        researchDb,
        "SELECT record FROM research_visible WHERE kind='publication' AND (id IN (?,?) OR (id IN (SELECT id FROM research_facets WHERE field='version' AND value=?) AND id<>?))",
        p.preprint_of ?? "",
        p.published_as ?? "",
        id,
        id,
      );
      for (const version of versions) related.push({ kind: "publication", record: JSON.parse(version.record) });
      if (pubApi)
        return json(() => ({
          publication: {
            ...p,
            projects: related.filter((i) => i.kind === "project").map((i) => i.record.id),
            preprint_of: versions.some((v) => JSON.parse(v.record).id === p.preprint_of) ? p.preprint_of : null,
            published_as: versions.some((v) => JSON.parse(v.record).id === p.published_as) ? p.published_as : null,
          },
        }));
      const refs = await institutionRefs(researchDb);
      const institution = p.institutions[0];
      const topic = healthTopic(p.topic) ? facetSlug(p.topic) : "";
      const nearby = institution
        ? (
            await rows<{ kind: Listing["kind"]; record: string }>(
              researchDb,
              "SELECT kind,record FROM research_visible WHERE kind='publication' AND id NOT IN (?,?,?) AND id IN (SELECT id FROM research_facets WHERE field='institution' AND value=?" +
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
          content: renderPublication(p, refs, related, more, catalog),
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
        return xml(
          `<sitemapindex${namespace}>${parts.map((p) => `<sitemap><loc>${html(origin + prefix + p + ".xml")}</loc></sitemap>`).join("")}</sitemapindex>`,
        );
      }
      let entries: { loc: string; lastmod?: string }[];
      if (path === prefix + "directory.xml") {
        entries = await publicDirectorySitemap(db, origin);
        if (hasPubs) {
          // Registry institutions are listed once, at their reference ID.
          const refs = await institutionRefs(researchDb);
          const legacy = new Set(
            directoryCatalog
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
        const match = /^\/discover\/sitemap\/([1-9]\d{0,5})\.xml$/.exec(path);
        if (!hasPubs || !match) return page({ kind: "not-found" }, 404);
        entries = (
          await rows<{ id: string; checked: string | null }>(
            researchDb,
            "SELECT id,json_extract(record,'$.checked') checked FROM research_visible WHERE kind='publication' ORDER BY id LIMIT ? OFFSET ?",
            partSize,
            (Number(match[1]) - 1) * partSize,
          )
        ).map((r) => ({ loc: origin + pubPath(r.id), lastmod: r.checked ?? undefined }));
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
    if (path === "/" && hasPubs) {
      const summary = await summarize(researchDb);
      const latest = (
        await rows<{ kind: Listing["kind"]; record: string }>(
          researchDb,
          "SELECT kind,record FROM research_visible ORDER BY added DESC,id LIMIT 6",
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
      scoped || path === newPath || path === feedPath || combinedApi || pubApi || (path === browsePath && hasPubs);
    if (
      needsRefs &&
      (hasPubs ||
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
      combinedApi ||
      (scoped && refs.length > 0) ||
      (path === browsePath && searchParams.has("kind") && !hasPubs) ||
      (hasPubs &&
        ((path === browsePath && (!projectFilters || searchParams.get("kind") === "publication")) || scoped))
    ) {
      if (pubApi && !hasPubs) return json(() => ({ error: "publication_not_found" }), 404);
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
      if (path === feedPath && hasPubs) {
        return xml(
          rss(origin, params, await researchFeed(researchDb, params, refs), options),
          "application/rss+xml",
        );
      }
      const result = hasPubs
        ? await researchQuery(researchDb, params, refs)
        : projectQuery(catalog, removed, params, options, refs);
      if (scoped && !result.total && !options[scoped[1] as keyof typeof options].has(params.get(scoped[1])!))
        return page({ kind: "not-found" }, 404);
      if (pubApi || combinedApi) {
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
        const listings = result.items.map((i) =>
          i.kind === "project"
            ? { kind: i.kind, record: publicProject(i.record) }
            : {
                kind: i.kind,
                record: {
                  ...i.record,
                  projects: i.record.projects.filter((id) => catalog.project(id, removed)),
                  preprint_of: visibleVersions.has(i.record.preprint_of ?? "") ? i.record.preprint_of : null,
                  published_as: visibleVersions.has(i.record.published_as ?? "") ? i.record.published_as : null,
                },
              },
        );
        return json(() => ({
          ...(pubApi ? { publications: listings.map((i) => i.record) } : { listings }),
          page: result.page,
          page_size: 24,
          total: result.counts.reduce((sum, kind) => sum + kind.works, 0),
          record_total: result.total,
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
      const feed = feedUrl(params);
      const landing = !filtered && !pageNo;
      const described = describeQuery(params, names, path === newPath);
      let header: string, title: string, description: string, about: Record<string, unknown> | undefined, aside = "";
      const crumbs: [string, string][] = [["Directory", browsePath]];
      if (scope) {
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
            ? `${scope.name}: healthcare publications and research software`
            : scope.field === "topic"
              ? `${scope.name} research in the Delaware Valley`
              : `Healthcare research in ${place}`;
        if (landing) {
          const summary = await summarize(researchDb, { field: scope.field, value: scope.slug });
          const built = entityHeader({ ...scope, refs, summary, names, now, feed, name: scope.field === "county" ? place : scope.name });
          header = built.header;
          aside = built.index;
          description = built.description;
        } else {
          header = filteredHeader(crumbs, described, path);
          title = described;
          description = `${described}. ${kindCounts(result.counts) || "No listings"} in The Valley Desk directory of Delaware Valley healthcare research.`;
        }
      } else if (path === newPath) {
        title = landing ? "What’s new" : `What’s new: ${described}`;
        description = `Healthcare research listings in the order they entered The Valley Desk directory, newest first. ${kindCounts(result.counts)}.`;
        crumbs.push(["What’s new", newPath]);
        header = `<header class="entity-head"><nav class="breadcrumb" aria-label="Breadcrumb"><a href="${browsePath}">Directory</a></nav>
          <h1>What’s new</h1>
          <p class="lede">Listings in the order they entered the directory, newest first. A paper can enter long after its publication date, and a new code push does not move a project here. The original project collection entered on November 18, 2026.</p></header>`;
      } else {
        title = landing ? "Search healthcare publications and research software" : described;
        description = landing
          ? `Search ${kindCounts(result.counts)} connected to the nine-county Delaware Valley by title, term, institution, topic or county.`
          : `${described}. ${kindCounts(result.counts) || "No listings"} in The Valley Desk directory of Delaware Valley healthcare research.`;
        header = landing
          ? `<header class="entity-head"><h1>Publications and research software</h1><p class="lede">The directory lists ${kindCounts(result.counts)} connected to the nine-county Delaware Valley. Search titles, terms and institutions, or narrow the list by kind, institution, topic and county.</p></header>`
          : filteredHeader(crumbs, described, path);
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
            enabled: hasPubs,
            scope: scoped?.[1],
            byDate: path === newPath,
            aside,
          }),
          feed: { title: scope ? `Additions: ${scope.name}` : "Directory additions", href: feed },
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
              numberOfItems: result.counts.reduce((sum, row) => sum + row.works, 0),
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
      }
    }
  } catch {
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
    return page({ kind: "methodology", publications: hasPubs }, 200);

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
  return page({ kind: "project", project, related: catalog.related(project, removed), linked, now }, 200);
}
