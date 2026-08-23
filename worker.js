const SPA_PATH = /^\/(?:(?:news|events|voices|briefing)(?:\/[^/]+)?)?\/?$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (SPA_PATH.test(url.pathname)) {
      return env.ASSETS.fetch(new URL("/index.html", url.origin));
    }
    return new Response("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-robots-tag": "noindex",
      },
    });
  },
};
