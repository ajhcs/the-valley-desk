import { handleRegionalWorkerRead } from "./regional-worker-read";
import { resolvePublicOrigin } from "../lib/canonical";
import { handleReviewApi, type ReviewApiOptions } from "./review-api";

export const OPS_PATH = "/ops";
export const OPS_API_PATH = "/ops/api";
export { OPS_ALLOWED_EMAIL } from "./ops-jwt";
import { verifiedOpsJwtIdentity, type OpsJwtConfig } from "./ops-jwt";

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
  env: Parameters<typeof handleReviewApi>[1] & OpsJwtConfig,
  _ctx: WorkerAccessContext | undefined,
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
  if (url.origin !== resolvePublicOrigin(origin)) return privateNotFound();
  if (method === "POST" && !sameOriginMutation(request, origin)) return privateNotFound();
  // Static Assets does not forward ctx.access. Only a signature-verified
  // application JWT with explicitly reviewed issuer/audience authorizes Ops.
  const email = await verifiedOpsJwtIdentity(request, env);
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
  if (url.pathname.startsWith(`${OPS_API_PATH}/agent/`)) return handleRegionalWorkerRead(request);
  const options: ReviewApiOptions = {
    trustedAccessEmail: email,
    routePrefix: OPS_API_PATH,
  };
  return handleReviewApi(request, env, options);
}
