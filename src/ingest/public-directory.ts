import { directoryView, publicProjectId } from "./public-directory-data";
import { renderDirectoryPage } from "./public-directory-page";

type RemovalDb = {
  prepare(query: string): { all(): Promise<{ results: { github_id: string }[] }> };
};

const detailPrefix = "/discover/work/";
const browse = "/discover/works";

export function isPublicDirectoryPath(path: string) {
  return path === "/" || /^\/discover\/?$/.test(path) || /^\/discover\/works\/?$/.test(path) ||
    path.startsWith(detailPrefix);
}

const htmlHeaders = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };

export async function servePublicDirectory(request: Request, db?: RemovalDb): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  }

  const url = new URL(request.url);
  const { pathname } = url;
  const page = (view: ReturnType<typeof directoryView>, status: number) =>
    new Response(request.method === "HEAD" ? null : renderDirectoryPage(view), { status, headers: htmlHeaders });

  let removed: Set<string>;
  try {
    const state = await db?.prepare("SELECT github_id FROM public_directory_removals").all();
    if (!Array.isArray(state?.results)) throw new Error("removal list unavailable");
    removed = new Set(state.results.map(row => row.github_id));
  } catch {
    return page(directoryView("unavailable", new Set()), 503);
  }

  if (pathname === "/") return page(directoryView("home", removed), 200);
  if (pathname === browse || pathname === browse + "/") return page(directoryView("results", removed, url.searchParams), 200);
  if (pathname === "/discover" || pathname === "/discover/") {
    return new Response(null, { status: 308, headers: { location: browse + url.search, "cache-control": "no-store" } });
  }

  let raw = "";
  try {
    raw = decodeURIComponent(pathname.slice(detailPrefix.length));
  } catch {
    return page(directoryView("not-found", removed), 404);
  }
  const identity = publicProjectId(raw);
  const view = identity ? directoryView("project", removed, undefined, identity) : directoryView("not-found", removed);
  if (view.kind === "removed") return page(view, 410);
  if (view.kind === "not-found") return page(view, 404);
  if (raw !== identity) {
    return new Response(null, { status: 308, headers: { location: detailPrefix + identity, "cache-control": "no-store" } });
  }
  return page(view, 200);
}
