import { DEFAULT_PUBLIC_ORIGIN, resolvePublicOrigin } from "./canonical";

/** D1 schema stamp. Must match the latest file prefix in /migrations. */
export const SCHEMA_VERSION = "0024";

export type BuildEnv = {
  BUILD_SHA?: string;
  CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string };
  PUBLIC_ORIGIN?: string;
};

const SENSITIVE_KEY = /(authorization|token|secret|password|apikey|api_key|cookie)/i;

export function buildShaFromEnv(env: BuildEnv = {}): string {
  const sha = env.BUILD_SHA?.trim();
  if (sha) return sha.slice(0, 40);
  const versionId = env.CF_VERSION_METADATA?.id?.trim();
  if (versionId) return versionId.slice(0, 64);
  return "unknown";
}

export function publicHealth(env: BuildEnv = {}) {
  return {
    ok: true as const,
    schemaVersion: SCHEMA_VERSION,
    buildSha: buildShaFromEnv(env),
  };
}

export function handlePublicHealth(request: Request, env: BuildEnv = {}) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: {
        "content-type": "application/json; charset=utf-8",
        allow: "GET, HEAD",
        "cache-control": "no-store",
      },
    });
  }
  return new Response(JSON.stringify(publicHealth(env)), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

function sanitizeValue(value: unknown, key = "", depth = 0): unknown {
  if (depth > 4) return undefined;
  if (SENSITIVE_KEY.test(key)) return "[redacted]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitizeValue(entry, key, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [nextKey, nextValue] of Object.entries(value as Record<string, unknown>)) {
      out[nextKey] = sanitizeValue(nextValue, nextKey, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function logOps(event: string, fields: Record<string, unknown> = {}, level: "info" | "warn" | "error" = "info") {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...((sanitizeValue(fields) as Record<string, unknown>) ?? {}),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function asHeadResponse(response: Response) {
  return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** Redirect the www alias to the configured apex without losing path or query. */
export function canonicalHostRedirect(request: Request, publicOrigin = DEFAULT_PUBLIC_ORIGIN) {
  try {
    const requested = new URL(request.url);
    const canonical = new URL(resolvePublicOrigin(publicOrigin));
    if (requested.hostname !== `www.${canonical.hostname}`) return undefined;
    requested.protocol = canonical.protocol;
    requested.host = canonical.host;
    return new Response(null, {
      status: 308,
      headers: {
        location: requested.toString(),
        "cache-control": "public, max-age=3600",
      },
    });
  } catch {
    return undefined;
  }
}

export function htmlCsp(nonce?: string) {
  const scriptSrc = nonce ? `'self' 'nonce-${nonce}'` : "'self'";
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function requestHost(request: Request) {
  try {
    return new URL(request.url).hostname;
  } catch {
    return "";
  }
}

/**
 * HSTS is omitted on *.workers.dev (shared suffix) and when the request host is
 * not the configured public origin. Enable it at custom-domain cutover only.
 */
export function hstsHeader(request: Request, publicOrigin = DEFAULT_PUBLIC_ORIGIN) {
  const origin = resolvePublicOrigin(publicOrigin);
  let originHost = "";
  try {
    originHost = new URL(origin).hostname;
  } catch {
    return undefined;
  }
  if (!originHost || originHost.endsWith(".workers.dev")) return undefined;
  if (requestHost(request) !== originHost) return undefined;
  return "max-age=86400";
}

export function applySecurityHeaders(
  response: Response,
  options: {
    request: Request;
    publicOrigin: string;
    html?: boolean;
    nonce?: string;
  },
) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("cross-origin-opener-policy", "same-origin");
  if (options.html) headers.set("content-security-policy", htmlCsp(options.nonce));
  const hsts = hstsHeader(options.request, options.publicOrigin);
  if (hsts) headers.set("strict-transport-security", hsts);
  else headers.delete("strict-transport-security");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
