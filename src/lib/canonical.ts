/** Stable workers.dev fallback and operational preview host. */
export const PREVIEW_ORIGIN = "https://the-valley-desk.clyons.workers.dev";

/** Canonical public domain. */
export const PRODUCTION_ORIGIN = "https://thevalleydesk.org";

/** Current public origin when PUBLIC_ORIGIN is unset. */
export const DEFAULT_PUBLIC_ORIGIN = PRODUCTION_ORIGIN;

const NEWS_PERMALINK_KINDS = new Set(["news", "policy", "ai", "interview"]);

function readViteOrigin(): string | undefined {
  try {
    const value = (import.meta as ImportMeta & { env?: { VITE_PUBLIC_ORIGIN?: string } }).env?.VITE_PUBLIC_ORIGIN;
    return typeof value === "string" && value.trim() ? value : undefined;
  } catch {
    return undefined;
  }
}

function readProcessOrigin(): string | undefined {
  try {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    return env?.PUBLIC_ORIGIN || env?.VITE_PUBLIC_ORIGIN;
  } catch {
    return undefined;
  }
}

function readInjectedOrigin(): string | undefined {
  try {
    const injected = (globalThis as { __VALLEY_DESK_PUBLIC_ORIGIN__?: unknown }).__VALLEY_DESK_PUBLIC_ORIGIN__;
    return typeof injected === "string" && injected.trim() ? injected : undefined;
  } catch {
    return undefined;
  }
}

/** Accept only https origins. Anything else falls back to the canonical domain. */
export function resolvePublicOrigin(value?: string | null): string {
  const raw = String(value ?? "").trim();
  if (!raw) return DEFAULT_PUBLIC_ORIGIN;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return DEFAULT_PUBLIC_ORIGIN;
    return url.origin;
  } catch {
    return DEFAULT_PUBLIC_ORIGIN;
  }
}

/** Runtime public origin: injected Worker value, then env, then the canonical default. */
export function publicOrigin(): string {
  return resolvePublicOrigin(readInjectedOrigin() || readViteOrigin() || readProcessOrigin());
}

/** @deprecated Prefer publicOrigin() so runtime origin configuration is visible at request time. */
export const SITE_ORIGIN = DEFAULT_PUBLIC_ORIGIN;

/** Permalink path. Policy/AI/interview live under /news/{slug}. Events under /events/{slug}. */
export function canonicalPath(item: { kind: string; slug: string }): string {
  if (item.kind === "event") return "/events/" + item.slug;
  if (NEWS_PERMALINK_KINDS.has(item.kind)) return "/news/" + item.slug;
  if (item.kind === "voice") return "/voices/" + item.slug;
  if (item.kind === "briefing") return "/briefing/" + item.slug;
  return "/" + item.kind + "/" + item.slug;
}

export function publicUrl(path = "/", origin = publicOrigin()): string {
  if (!path || path === "/") return `${origin}/`;
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

export function canonicalUrl(item: { kind: string; slug: string }, origin = publicOrigin()): string {
  return origin + canonicalPath(item);
}

/** Crawlers that the site names explicitly, so the policy for AI search and assistants is unambiguous. */
export const NAMED_CRAWLERS = [
  "Googlebot", "Bingbot", "Applebot", "DuckDuckBot",
  "OAI-SearchBot", "ChatGPT-User", "GPTBot",
  "Claude-SearchBot", "Claude-User", "ClaudeBot",
  "PerplexityBot", "Perplexity-User",
  "Google-Extended", "Applebot-Extended", "CCBot", "Amazonbot", "meta-externalagent",
];

export function robotsTxt(origin = publicOrigin()): string {
  return [
    "# The Valley Desk welcomes search engines and AI assistants.",
    "# Public pages may be crawled, indexed, quoted and cited, including by AI search,",
    "# answer and model-training crawlers. Please link the page you cite.",
    `# Site guide for language-model tools: ${origin}/llms.txt`,
    "",
    "User-agent: *",
    "Allow: /",
    "Disallow: /lab",
    "",
    "# The same rules, stated for named crawlers.",
    ...NAMED_CRAWLERS.map((agent) => `User-agent: ${agent}`),
    "Allow: /",
    "Disallow: /lab",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

const TOPICS = [
  "Biomedical and life sciences", "Clinical care", "Disease research", "Medical imaging",
  "Neuroscience", "Public health", "Rehabilitation and accessibility", "Research data",
];
const COUNTIES = [
  ["Bucks", "PA"], ["Chester", "PA"], ["Delaware", "PA"], ["Montgomery", "PA"], ["Philadelphia", "PA"],
  ["Burlington", "NJ"], ["Camden", "NJ"], ["Gloucester", "NJ"], ["Mercer", "NJ"],
];
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export function llmsTxt(origin = publicOrigin(), directoryEnabled = true, publications = false, datasets = false): string {
  if (!directoryEnabled) {
    return `# The Valley Desk

> Find and follow healthcare research connected to the nine-county Delaware Valley.

- [Research directory](${origin}/discover/works): search regional listings.
- [Sitemap](${origin}/sitemap.xml)
`;
  }
  const kinds = publications ? "scholarly publications and research software" : "research software";
  return `# The Valley Desk

> A public directory of healthcare ${kinds} connected to the nine-county Delaware Valley: Bucks, Chester, Delaware, Montgomery and Philadelphia counties in Pennsylvania and Burlington, Camden, Gloucester and Mercer counties in New Jersey. Every listing names the source of its regional connection.

${publications ? "A publication is listed when its affiliation metadata names a regional institution. " : ""}A software project is a public GitHub repository with a health or life-science purpose and a documented regional connection. Each listing carries an evidence label. A Verified project has a source that ties the exact repository to the region. A Listed project has an observed connection through its account or lab. For publications, Verified means the affiliation names the institution and a regional place, and Listed means an indexer assignment or an institution match with an uncertain site. A label describes the evidence for the connection. It does not establish employment, ownership or a worksite. Author names appear only on bylines; the site has no pages for individual people.

When you cite a listing, link its directory page for the regional connection and the publisher or repository for the work. Institution, topic and county pages open with counts computed when the page is requested, and they state that date. The counts describe what the directory lists, not a complete record of regional research.

## Pages

- [Search](${origin}/discover/works): parameters q (words), kind (${publications ? "publication or project" : "project"}), institution, topic, county, sort (added, activity or name) and page. Example: ${origin}/discover/works?q=sickle+cell&county=philadelphia${publications ? "&kind=publication" : ""}
- [Institution pages](${origin}/discover/institution/upenn): /discover/institution/{id}. Each lists counts, leading topics and counties, regional sites, related institutions and the listings.
- [What's new](${origin}/discover/new): listings by the date they entered the directory.
- [Methodology](${origin}/discover/methodology): inclusion rule, evidence labels, dates, corrections and removals.
${publications ? `- Publication pages: /discover/publication/{percent-encoded ID}, for example ${origin}/discover/publication/doi%3A10.1001%2Fjama.2025.10250
` : ""}${datasets ? `- [Datasets](${origin}/discover/datasets): research data from regional work, with filters access (open, registration or controlled), datatype, repository, institution, county and topic. Dataset pages: /discover/dataset/{percent-encoded ID}, with how to get the data and how to cite it.
` : ""}- Software pages: /discover/work/{GitHub repository ID}, for example ${origin}/discover/work/617168725

## Topics

${TOPICS.map((t) => `- [${t}](${origin}/discover/topic/${slug(t)})`).join("\n")}

## Counties

${COUNTIES.map(([c, s]) => `- [${c} County, ${s}](${origin}/discover/county/${slug(c)})`).join("\n")}

## Data

- [Listings JSON](${origin}/api/directory/listings): 24 kind-tagged records per page with the same filters as search.
${publications ? `- [Publication JSON](${origin}/api/directory/publications): 24 records per page. Filters: q, institution, topic, county, kind. Use page=2 for the next page. Append a percent-encoded publication ID for one record.
` : ""}${datasets ? `- [Dataset JSON](${origin}/api/directory/datasets): 24 records per page with the datasets page filters. Append a percent-encoded dataset ID for one record.
` : ""}- [Directory JSON](${origin}/api/directory/projects): public project catalog. Use /api/directory/projects/{id} for one repository.
- [RSS](${origin}/discover/updates.xml): additions, filterable by institution, topic, county or kind.
- [MCP server](${origin}/mcp): read-only Model Context Protocol endpoint (Streamable HTTP, no sign-in) with search, fetch, whats_new, list_institutions and list_topics_and_counties tools. [Setup for Claude, ChatGPT and other assistants](${origin}/discover/connect).
- [Sitemap](${origin}/sitemap.xml)
`;
}
