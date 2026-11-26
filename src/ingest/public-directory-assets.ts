const assetPrefix = "/_directory-assets/";
const versionPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const directoryAssets = new Set([
  "directory-chrome.css", "directory.css", "theme.js", "directory-theme.js",
  "webmcp.js", "directory-feedback.js", "directory-search.js",
]);

export function directoryAssetPath(name: string, version?: string) {
  return version && versionPattern.test(version) ? assetPrefix + version + "/" + name : "/" + name;
}

/** An immutable URL is only served from the Worker version that owns its bytes. */
export async function serveDirectoryAsset(
  request: Request,
  url: URL,
  assets: { fetch(request: Request): Promise<Response> },
  currentVersion?: string,
) {
  if (!url.pathname.startsWith(assetPrefix)) return;
  const [version, name, ...extra] = url.pathname.slice(assetPrefix.length).split("/");
  if (extra.length || !versionPattern.test(version) || !directoryAssets.has(name)) return;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD", "cache-control": "no-store" } });
  }
  const path = "/" + name;
  // A page served just before a deployment can still load the asset via its stable URL.
  if (version !== currentVersion) {
    return new Response(null, { status: 307, headers: { location: path, "cache-control": "no-store" } });
  }
  const response = await assets.fetch(new Request(new URL(path, url), request));
  if (response.status !== 200 && response.status !== 304) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(response.body, { status: response.status, headers });
}
