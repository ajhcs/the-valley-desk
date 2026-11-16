import { handleDiscoveryPilot } from "./discovery-pilot";
import { DiscoveryPilotResultSchema } from "../content/discovery-pilot";
import { publicFeaturesFromEnv } from "../lib/public-features";

const esc = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "cdn-cache-control": "no-store", "x-robots-tag": "noindex" };
type PilotPageEnvironment = {
  DISCOVERY_PILOT_ENABLED?: unknown;
  WATCH_PUBLIC_ENABLED?: unknown;
  POLICY_BACKGROUND_PUBLIC_ENABLED?: unknown;
  ASSETS: { fetch(input: URL): Promise<Response> };
};

/** A finite metadata preview, independent of the editorial catalog and D1. */
export async function handleDiscoveryPilotPage(request: Request, env: PilotPageEnvironment, origin: string, nonce: string): Promise<Response> {
  const method = request.method.toUpperCase();
  const reply = (status: number, title: string, body: string, extra: Record<string, string> = {}) => new Response(method === "HEAD" ? null : `<!doctype html><html lang="en"><head><title>${esc(title)} · The Valley Desk</title></head><body><main><h1>${esc(title)}</h1>${body}</main></body></html>`, { status, headers: { ...headers, ...extra } });
  if (env.DISCOVERY_PILOT_ENABLED !== "true") return reply(404, "Not found", "<p>This page is not published.</p>");
  if (method !== "GET" && method !== "HEAD") return reply(405, "Method not allowed", "", { allow: "GET, HEAD" });
  const url = new URL(request.url);
  const apiUrl = new URL(`/api/discovery-pilot${url.search}`, url.origin);
  const result = await handleDiscoveryPilot(new Request(apiUrl), env);
  if (result.status === 400) return reply(400, "Unsupported filters", '<p><a href="/discover">Reset filters</a> to search the directory.</p>');
  if (!result.ok) return reply(503, "Directory unavailable", "<p>Please try again later.</p>");
  try {
    const data = DiscoveryPilotResultSchema.parse(await result.json());
    const asset = await env.ASSETS.fetch(new URL("/index.html", url.origin));
    if (!asset.ok) return reply(503, "Directory unavailable", "<p>Please try again later.</p>");
    const title = "Health-tech research · The Valley Desk";
    const description = "A selected metadata-and-link research directory. Source-reported affiliations are historical; current employment is not established.";
    const bootstrap = JSON.stringify({ origin, features: publicFeaturesFromEnv(env) }).replaceAll("<", "\\u003c");
    const tags = `<title>${title}</title><meta name="description" content="${esc(description)}"><meta name="robots" content="noindex"><link rel="canonical" href="${esc(new URL("/discover", origin).href)}"><script nonce="${esc(nonce)}">{const p=${bootstrap};globalThis.__VALLEY_DESK_PUBLIC_ORIGIN__=p.origin;globalThis.__VALLEY_DESK_PUBLIC_FEATURES__=p.features;}</script>`;
    const noscript = `<main id="pilot-noscript"><h1>Health-tech research</h1><p>${esc(description)}</p><p>${data.filteredRecords} of ${data.totalRecords} selected records.</p><p>Enable JavaScript for the search controls and full provenance details. These records are not a complete regional roster.</p><ul>${data.items.map(item => `<li><a href="${esc(item.url)}" rel="noreferrer">${esc(item.title)}</a> (${esc(item.kind)})${item.sourceDate ? ` — ${esc(item.sourceDate.label)}: ${esc(item.sourceDate.value)}` : " — source date not supplied"}</li>`).join("")}</ul><p><a href="/discover">Reset filters</a> · <a href="/">Back to the desk</a></p></main>`;
    const template = await asset.text();
    // Replacement callbacks keep source text containing '$&' and '$`' literal.
    const html = template.replace(/<title>The Valley Desk<\/title>/, () => tags)
      .replace(/<noscript id="tvd-primary">[\s\S]*?<\/noscript>/, () => `<noscript id="tvd-primary">${noscript}</noscript>`);
    if (html === template || !html.includes('id="pilot-noscript"')) return reply(503, "Directory unavailable", "<p>Please try again later.</p>");
    return new Response(method === "HEAD" ? null : html, { headers });
  } catch {
    return reply(503, "Directory unavailable", "<p>Please try again later.</p>");
  }
}
