import type { SitemapEntry } from "../content/sitemap";
import { DEFAULT_PUBLIC_ORIGIN } from "../lib/canonical";
import {
  apiPath, browsePath, createDirectoryCatalog, detailPrefix, directoryCatalog, entityPath, httpsUrl,
  lastActivity, methodPath, projectPath, publicProjectId, type DirectoryProject,
} from "./public-directory-data";
import { renderDirectoryPage, type DirectoryView } from "./public-directory-page";
import { renderResultsRegion } from "./public-directory-results";

type RemovalDb = {
  prepare(query: string): { all(): Promise<{ results: { github_id: string }[]; success?: boolean }> };
};
const entityRoute = /^\/discover\/(institution|lab|topic|county)\/([^/]+)\/?$/;
const fragmentHeader = "X-Valley-Desk-Fragment";
const noStore = { "cache-control": "no-store", "cdn-cache-control": "no-store" };
const htmlHeaders = { ...noStore, "content-type": "text/html; charset=utf-8" };
const jsonHeaders = { ...noStore, "content-type": "application/json; charset=utf-8", "x-robots-tag": "noindex" };

export function isPublicDirectoryPath(path: string) {
  return path === "/" || /^\/discover\/?$/.test(path) || path === browsePath || path === browsePath + "/" ||
    path === methodPath || path === methodPath + "/" || path.startsWith(detailPrefix) || entityRoute.test(path) ||
    path === apiPath || path.startsWith(apiPath + "/");
}

async function removalIds(db?: RemovalDb) {
  const state = await db?.prepare("SELECT github_id FROM public_directory_removals").all();
  if (state?.success === false || !Array.isArray(state?.results) ||
      !state.results.every(row => typeof row?.github_id === "string")) throw new Error("removal list unavailable");
  return new Set(state.results.map(row => row.github_id));
}

function publicProject(project: DirectoryProject) {
  const {
    id, code, name, purpose, topic, label, institution, county, connection, source, paper, language, license,
    updated, added, owner, lab, stars, topics, homepage, created, pushed, archived, papers, checked,
  } = project;
  return {
    id, code: httpsUrl(code), name, purpose, topic, label, institution, county, connection,
    source: httpsUrl(source), paper: httpsUrl(paper), language, license, updated, added,
    owner: owner ? { login: owner.login, name: owner.name, kind: owner.kind } : undefined,
    lab, stars, topics, homepage: httpsUrl(homepage), created, pushed, archived, checked,
    papers: papers?.map(({ title, url, doi, year, venue }) => ({ title, url: httpsUrl(url), doi, year, venue })),
  };
}

function decode(segment: string) {
  try { return decodeURIComponent(segment); }
  catch { return ""; }
}

export function directoryNotFound(origin: string, nonce?: string, head = false) {
  return new Response(head ? null : renderDirectoryPage({ kind: "not-found" }, directoryCatalog, origin, nonce), {
    status: 404, headers: { ...htmlHeaders, "x-robots-tag": "noindex" },
  });
}

export async function publicDirectorySitemap(db: RemovalDb | undefined, origin: string): Promise<SitemapEntry[]> {
  const removed = await removalIds(db);
  return [
    ...["/", browsePath, methodPath].map(path => ({ loc: origin + path })),
    ...directoryCatalog.publishedEntities(removed).map(entity => ({ loc: origin + entityPath(entity) })),
    ...directoryCatalog.projects(removed).map(project => ({
      loc: origin + projectPath(project), lastmod: lastActivity(project) || undefined,
    })),
  ];
}

export async function servePublicDirectory(
  request: Request, db?: RemovalDb, origin = DEFAULT_PUBLIC_ORIGIN, nonce?: string,
  catalog: ReturnType<typeof createDirectoryCatalog> = directoryCatalog,
): Promise<Response> {
  const head = request.method === "HEAD";
  if (request.method !== "GET" && !head) {
    return new Response(null, { status: 405, headers: { ...noStore, allow: "GET, HEAD" } });
  }
  const { pathname, search, searchParams } = new URL(request.url);
  const api = pathname === apiPath || pathname.startsWith(apiPath + "/");
  const fragment = request.headers.get(fragmentHeader) === "results";
  const page = (view: DirectoryView, status: number) => {
    const renderFragment = fragment && view.kind === "results" && (view.data.scope?.entity.kind !== "county" || view.data.total > 0);
    const headers = view.kind === "results" ? { ...htmlHeaders, vary: fragmentHeader } : htmlHeaders;
    return new Response(head ? null : renderFragment ? renderResultsRegion(catalog, view.data)
      : renderDirectoryPage(view, catalog, origin, nonce), {
      status, headers: status >= 400 ? { ...headers, "x-robots-tag": "noindex" } : headers,
    });
  };
  const json = (value: () => unknown, status = 200) =>
    new Response(head ? null : JSON.stringify(value()), { status, headers: jsonHeaders });
  const redirect = (path: string) =>
    new Response(null, { status: 308, headers: { ...noStore, location: path } });

  let removed: Set<string>;
  try { removed = await removalIds(db); }
  catch {
    return api ? json(() => ({ error: "directory_unavailable" }), 503) : page({ kind: "unavailable" }, 503);
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
  if (pathname === methodPath || pathname === methodPath + "/") return page({ kind: "methodology" }, 200);

  const entityMatch = entityRoute.exec(pathname);
  if (entityMatch) {
    const entity = catalog.entityAt(entityMatch[1], decode(entityMatch[2]), removed);
    return entity ? page({ kind: "results", data: catalog.list(removed, searchParams, now, entity) }, 200)
      : page({ kind: "not-found" }, 404);
  }

  const raw = pathname.startsWith(detailPrefix) ? decode(pathname.slice(detailPrefix.length)) : "";
  const id = publicProjectId(raw);
  if (!id) return page({ kind: "not-found" }, 404);
  if (removed.has(id)) return page({ kind: "removed" }, 410);
  const project = catalog.project(id, removed);
  if (!project) return page({ kind: "not-found" }, 404);
  if (raw !== id) return redirect(projectPath(project));
  return page({ kind: "project", project, related: catalog.related(project, removed), now }, 200);
}
