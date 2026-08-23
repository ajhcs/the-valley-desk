function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-robots-tag": "noindex",
      "cache-control": "no-store",
    },
  });
}

const SPA_PATH = /^\/(?:(?:news|events|voices|briefing)(?:\/[^/]+)?)?\/?$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/org" || path.startsWith("/org/")) {
      return notFound();
    }
    if (SPA_PATH.test(path)) {
      return env.ASSETS.fetch(new URL("/index.html", url.origin));
    }
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return asset;
    return notFound();
  },
};
