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

export function robotsTxt(origin = publicOrigin()): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /lab",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

export function llmsTxt(origin = publicOrigin(), watchEnabled = false): string {
  return `# The Valley Desk

> A concise, cited record of how healthcare technology, AI, health policy, interoperability, EHR changes, cybersecurity, and related developments affect Delaware Valley health systems.

The site is an aggregator with context, not a magazine. Each published item links to its source material. Use the canonical pages and machine-readable feeds below.

## Sections

- [News](${origin}/news): health-system technology, policy, finance, AI, EHR, interoperability, workforce, and cybersecurity briefs.
- [Events](${origin}/events): confirmed Delaware Valley chapter events, webinars, and regionally relevant programs with registration links.
${watchEnabled ? `- [Policy Watch](${origin}/policy-watch): source-backed federal, PA, NJ, DE, and Delaware Valley policy records.
- [Technology Watch](${origin}/technology-watch): technology with verified Delaware Valley connections.\n` : ""}

## Machine-readable feeds

- [JSON feed](${origin}/feed.json)
- [XML feed](${origin}/feed.xml)
- [Sitemap](${origin}/sitemap.xml)

## Editorial notes

- Prefer the primary source and citations attached to each item.
- Dates and event times use the America/New_York timezone unless the item states otherwise.
- Unpublished and review-queue material is not part of the public record.
`;
}
