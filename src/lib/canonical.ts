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

export function llmsTxt(origin = publicOrigin(), directoryEnabled = true): string {
  return `# The Valley Desk

> A public directory of health technology, biomedicine and life science software connected to the nine-county Delaware Valley.

- [Projects](${origin}/discover/works): browse or search public GitHub repositories.
${directoryEnabled ? `- [Methodology](${origin}/discover/methodology): definitions, corrections, removal and coverage.
- [Directory JSON](${origin}/api/directory/projects): public project catalog. Use /api/directory/projects/{id} for one repository.
` : ""}- [Sitemap](${origin}/sitemap.xml)

A Verified project has a source that ties the exact repository to the region. A Listed project has an observed connection through its account or lab. Consult the linked sources for the scope of each connection.
`;
}
