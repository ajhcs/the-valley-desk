import { createRemoteJWKSet, customFetch, decodeProtectedHeader, jwtVerify } from "jose";

export const OPS_ALLOWED_EMAIL = "clyons@ajhcs.org";
export const OPS_JWT_MAX_BYTES = 8_192;
export const OPS_JWKS_MAX_BYTES = 65_536;
export const OPS_JWKS_TIMEOUT_MS = 3_000;
export const OPS_JWKS_CACHE_MS = 5 * 60_000;
export const OPS_JWKS_COOLDOWN_MS = 30_000;

export type OpsJwtDenialReason = "configuration-unavailable" | "assertion-missing" | "header-rejected"
  | "key-unavailable" | "token-rejected" | "identity-rejected";

class OpsKeyUnavailableError extends Error {}

export type OpsJwtResult = { authorized: true; email: string }
  | { authorized: false; reason: OpsJwtDenialReason };

export type OpsJwtConfig = {
  OPS_ACCESS_ISSUER?: string;
  OPS_ACCESS_AUDIENCE?: string;
};

/** These are reviewed deployment inputs, never values discovered from a token. */
export function opsJwtConfiguration(env: OpsJwtConfig) {
  const issuer = env.OPS_ACCESS_ISSUER;
  const audience = env.OPS_ACCESS_AUDIENCE;
  if (typeof issuer !== "string" || !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(issuer)
    || typeof audience !== "string" || !/^[a-f0-9]{64}$/.test(audience)) return undefined;
  return { issuer, audience };
}

/** One configured issuer per verifier; no token-controlled cache or URL keys. */
export function createOpsJwtResultVerifier(
  fetcher: typeof fetch = (input, init) => fetch(input, init),
  now: () => Date = () => new Date(),
  onDenied: (reason: OpsJwtDenialReason) => void = () => undefined,
) {
  // Fixed categories only: no request, token, claim, provider or configuration values.
  const lastReported = new Map<OpsJwtDenialReason, number>();
  function deny(reason: OpsJwtDenialReason): OpsJwtResult {
    const time = Date.now();
    const previous = lastReported.get(reason);
    if (previous === undefined || time - previous >= OPS_JWKS_COOLDOWN_MS) {
      lastReported.set(reason, time);
      try { onDenied(reason); } catch { /* Diagnostics cannot change authorization. */ }
    }
    return { authorized: false, reason };
  }

  let entry: {
    issuer: string;
    resolve: ReturnType<typeof createRemoteJWKSet>;
  } | undefined;

  function resolver(issuer: string) {
    if (entry?.issuer === issuer) return entry.resolve;
    const url = `${issuer}/cdn-cgi/access/certs`;
    let busy = false;
    let nextAttemptAt = 0;
    const resolve = createRemoteJWKSet(new URL(url), {
      timeoutDuration: OPS_JWKS_TIMEOUT_MS,
      cacheMaxAge: OPS_JWKS_CACHE_MS,
      cooldownDuration: OPS_JWKS_COOLDOWN_MS,
      [customFetch]: async (target, options) => {
        // Workers cannot share another request's in-flight I/O promise. Deny
        // concurrent cold/refresh reads instead; warm public keys are reusable.
        if (target !== url || busy || Date.now() < nextAttemptAt) throw new OpsKeyUnavailableError("ops-key-unavailable");
        busy = true;
        nextAttemptAt = Date.now() + OPS_JWKS_COOLDOWN_MS;
        const controller = new AbortController();
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const abort = () => controller.abort();
        options.signal.addEventListener("abort", abort, { once: true });
        if (options.signal.aborted) abort();
        try {
          const work = async () => {
            const response = await fetcher(url, {
              method: "GET", redirect: "manual", credentials: "omit",
              headers: { accept: "application/json" }, signal: controller.signal,
            });
            if (controller.signal.aborted || response.status !== 200 || !response.body) {
              await response.body?.cancel();
              throw new OpsKeyUnavailableError("ops-key-unavailable");
            }
            const declared = response.headers.get("content-length");
            if (declared && (!/^\d+$/.test(declared) || Number(declared) > OPS_JWKS_MAX_BYTES)) {
              await response.body.cancel();
              throw new OpsKeyUnavailableError("ops-key-unavailable");
            }
            reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let size = 0;
            while (true) {
              const part = await reader.read();
              if (controller.signal.aborted) throw new OpsKeyUnavailableError("ops-key-unavailable");
              if (part.done) break;
              size += part.value.byteLength;
              if (size > OPS_JWKS_MAX_BYTES) throw new OpsKeyUnavailableError("ops-key-unavailable");
              chunks.push(part.value);
            }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
            if (!parsed || typeof parsed !== "object" || !("keys" in parsed)
              || !Array.isArray(parsed.keys) || parsed.keys.length < 1 || parsed.keys.length > 16) throw new OpsKeyUnavailableError("ops-key-unavailable");
            return new Response(bytes, { headers: { "content-type": "application/json" } });
          };
          return await Promise.race([
            work(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => { abort(); reject(new OpsKeyUnavailableError("ops-key-unavailable")); }, OPS_JWKS_TIMEOUT_MS);
            }),
          ]);
        } catch {
          // Normalize all transport/body errors without retaining provider text.
          throw new OpsKeyUnavailableError("ops-key-unavailable");
        } finally {
          if (timer !== undefined) clearTimeout(timer);
          options.signal.removeEventListener("abort", abort);
          abort();
          // Cancellation must not hold an authorization response open.
          void reader?.cancel().catch(() => undefined);
          busy = false;
        }
      },
    });
    entry = { issuer, resolve };
    return resolve;
  }

  return async (request: Request, env: OpsJwtConfig): Promise<OpsJwtResult> => {
    const configuration = opsJwtConfiguration(env);
    if (!configuration) return deny("configuration-unavailable");
    const token = request.headers.get("cf-access-jwt-assertion");
    if (!token) return deny("assertion-missing");
    if (token.length > OPS_JWT_MAX_BYTES || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return deny("header-rejected");
    try {
      const header = decodeProtectedHeader(token);
      if (header.alg !== "RS256" || header.typ !== "JWT" || typeof header.kid !== "string"
        || !/^[A-Za-z0-9_-]{1,128}$/.test(header.kid)
        || ["jku", "jwk", "x5u", "x5c", "crit"].some(key => key in header)) return deny("header-rejected");
      const date = now();
      const { payload } = await jwtVerify(token, resolver(configuration.issuer), {
        algorithms: ["RS256"], typ: "JWT", issuer: configuration.issuer,
        audience: configuration.audience, clockTolerance: 0, currentDate: date,
        requiredClaims: ["exp", "iat", "nbf", "sub", "email", "type"],
      });
      const seconds = Math.floor(now().getTime() / 1_000);
      const { exp, iat, nbf } = payload;
      if (![exp, iat, nbf].every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
        || typeof exp !== "number" || typeof iat !== "number" || typeof nbf !== "number"
        || iat > seconds || nbf > seconds || exp <= seconds || exp <= iat || exp <= nbf
        || payload.type !== "app" || typeof payload.sub !== "string" || !payload.sub.trim()
        || typeof payload.email !== "string" || payload.email.trim().toLowerCase() !== OPS_ALLOWED_EMAIL) return deny("identity-rejected");
      return { authorized: true, email: OPS_ALLOWED_EMAIL };
    } catch (error) {
      return deny(error instanceof OpsKeyUnavailableError ? "key-unavailable" : "token-rejected");
    }
  };
}

/** Preserve the existing identity-only API and its authorization semantics. */
export function createOpsJwtVerifier(
  fetcher?: typeof fetch,
  now?: () => Date,
  onDenied?: (reason: OpsJwtDenialReason) => void,
) {
  const verify = createOpsJwtResultVerifier(fetcher, now, onDenied);
  return async (request: Request, env: OpsJwtConfig): Promise<string | undefined> => {
    const result = await verify(request, env);
    return result.authorized ? result.email : undefined;
  };
}

export const verifiedOpsJwtResult = createOpsJwtResultVerifier(undefined, undefined, reason => {
  console.warn("ops_access_denied", reason);
});

/** Shares the same verifier, key cache and diagnostic throttle as the route. */
export async function verifiedOpsJwtIdentity(request: Request, env: OpsJwtConfig): Promise<string | undefined> {
  const result = await verifiedOpsJwtResult(request, env);
  return result.authorized ? result.email : undefined;
}
