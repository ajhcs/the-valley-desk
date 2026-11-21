import { decodedPublicPath } from "../lib/editorial-retirement";
import { externalLink, html } from "./public-directory-ui";
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
  renderResearch,
  facetSlug,
  rss,
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
      return page(
        {
          kind: "research",
          title: publicationTitle(p),
          summary: p.connection,
          path: pubPath(id),
          content: renderPublication(p, refs, related),
          schema: {
            "@type": "ScholarlyArticle",
            headline: publicationTitle(p),
            datePublished: p.published,
            url: origin + pubPath(id),
          },
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
      let paths: string[];
      if (path === prefix + "directory.xml") {
        paths = (await publicDirectorySitemap(db, origin)).map((e) => e.loc);
        if (hasPubs) {
          const groups = await rows<{ field: string; value: string }>(
            researchDb,
            "SELECT DISTINCT field,value FROM research_facets JOIN research_visible USING(id) WHERE field IN ('institution','topic','county')",
          );
          paths.push(...groups.map((g) => origin + "/discover/" + g.field + "/" + encodeURIComponent(g.value)));
        }
      } else {
        const match = /^\/discover\/sitemap\/([1-9]\d{0,5})\.xml$/.exec(path);
        if (!hasPubs || !match) return page({ kind: "not-found" }, 404);
        paths = (
          await rows<{ id: string }>(
            researchDb,
            "SELECT id FROM research_visible WHERE kind='publication' ORDER BY id LIMIT ? OFFSET ?",
            partSize,
            (Number(match[1]) - 1) * partSize,
          )
        ).map((r) => origin + pubPath(r.id));
        if (!paths.length) return page({ kind: "not-found" }, 404);
      }
      return xml(
        `<urlset${namespace}>${[...new Set(paths)].map((p) => `<url><loc>${html(p)}</loc></url>`).join("")}</urlset>`,
      );
    }
    if (path === "/" && hasPubs) {
      const [r] = await rows<{ n: number }>(
        researchDb,
        "SELECT count(DISTINCT group_id) n FROM research_visible WHERE kind='publication'",
      );
      const latest = (
        await rows<{ kind: Listing["kind"]; record: string }>(
          researchDb,
          "SELECT kind,record FROM research_visible ORDER BY added DESC,id LIMIT 3",
        )
      ).map((row) => ({ kind: row.kind, record: JSON.parse(row.record) }) as Listing);
      return page({ kind: "home", data: catalog.home(removed, new Date()), publications: r.n, latest }, 200);
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
      if (pubApi) params.set("kind", "publication");
      if (path === feedPath || path === newPath) params.set("sort", "added");
      let title = path === newPath ? "What’s new" : "Research directory";
      let intro =
        path === newPath
          ? "<p>Listings by date added. The original project collection entered the directory on November 18, 2026.</p>"
          : "";
      if (scoped) {
        const field = scoped[1] as keyof typeof options,
          value = decode(scoped[2]);
        const ref = field === "institution" ? institutionFor(refs, value) : undefined;
        params.set(field, ref?.id ?? value);
        title = ref?.name ?? options[field].get(value) ?? value;
        if (field === "county") title += " County";
        const sites =
          field === "institution"
            ? (ref?.sites ?? [])
            : field === "county"
              ? refs.flatMap((r) => r.sites).filter((s) => facetSlug(s.county) === value)
              : [];
        if (sites.length)
          intro =
            "<h2>Regional sites</h2><ul>" +
            sites
              .map(
                (s) =>
                  "<li>" +
                  externalLink(s.source, s.name + " · " + s.place + ", " + s.county + " County") +
                  "</li>",
              )
              .join("") +
            "</ul>";
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
      return page(
        {
          kind: "research",
          title,
          summary: "Search and follow regional healthcare research.",
          path,
          content: renderResearch(title, path, params, result, catalog, options, hasPubs, intro, scoped?.[1]),
          schema: { "@type": "CollectionPage", name: title, url: origin + path },
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
    return page({ kind: "results", data: catalog.list(removed, searchParams, now) }, 200);
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
