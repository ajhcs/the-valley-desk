import { resolvePublicOrigin } from "../lib/canonical";
import { handleReviewApi, type ReviewApiOptions } from "./review-api";

export const OPS_PATH = "/ops";
export const OPS_API_PATH = "/ops/api";
export const OPS_ALLOWED_EMAIL = "clyons@ajhcs.org";

export type AccessIdentity = { email?: unknown };
export type WorkerAccessContext = {
  access?: {
    getIdentity?: () => Promise<AccessIdentity | null | undefined>;
  };
};

export function isOpsPath(pathname: string) {
  return pathname === OPS_PATH
    || pathname === `${OPS_PATH}/`
    || pathname === OPS_API_PATH
    || pathname.startsWith(`${OPS_API_PATH}/`);
}

/**
 * Access identity comes from the platform execution context. Request headers
 * are intentionally ignored because a direct workers.dev caller can spoof
 * any cf-access-* header.
 */
export async function trustedOpsIdentity(ctx: WorkerAccessContext | undefined) {
  if (!ctx?.access?.getIdentity) return undefined;
  try {
    const identity = await ctx.access.getIdentity();
    const email = typeof identity?.email === "string" ? identity.email.trim().toLowerCase() : "";
    return email === OPS_ALLOWED_EMAIL ? email : undefined;
  } catch {
    return undefined;
  }
}

function privateNotFound() {
  return new Response(JSON.stringify({ error: "not_found" }), {
    status: 404,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function sameOriginMutation(request: Request, publicOrigin: string) {
  const origin = request.headers.get("origin");
  return Boolean(origin) && origin === resolvePublicOrigin(publicOrigin);
}

export async function handleOpsRequest(
  request: Request,
  env: Parameters<typeof handleReviewApi>[1],
  ctx: WorkerAccessContext | undefined,
  origin: string,
  loadShell: () => Promise<string>,
) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  // Access is configured on the public custom domain. A workers.dev request
  // must not become an alternate private entry point even if a context object
  // is accidentally supplied by a local adapter or future platform change.
  const hostname = url.hostname.toLowerCase();
  if (hostname === "workers.dev" || hostname.endsWith(".workers.dev")) return privateNotFound();
  const email = await trustedOpsIdentity(ctx);
  if (!email) return privateNotFound();

  if (url.pathname === OPS_PATH || url.pathname === `${OPS_PATH}/`) {
    if (method !== "GET" && method !== "HEAD") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          allow: "GET, HEAD",
        },
      });
    }
    const html = await loadShell();
    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  }

  if (!url.pathname.startsWith(`${OPS_API_PATH}/`) && url.pathname !== OPS_API_PATH) return privateNotFound();
  if (method === "POST" && !sameOriginMutation(request, origin)) return privateNotFound();
  const options: ReviewApiOptions = {
    trustedAccessEmail: email,
    routePrefix: OPS_API_PATH,
  };
  return handleReviewApi(request, env, options);
}
