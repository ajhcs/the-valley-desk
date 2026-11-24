// Stateless, unauthenticated, read-only MCP server over Streamable HTTP.
// Serves the 2026-07-28 revision (no handshake, no sessions) and, on the same endpoint, the
// legacy initialize handshake that 2025-era clients still send. One POST, one JSON response.
import { callTool, hasTool, definitionsFor, type ToolContext } from "./tools";

export const modernVersion = "2026-07-28";
export const legacyVersions = ["2025-11-25", "2025-06-18", "2025-03-26"];
export const serverInfo = { name: "the-valley-desk", title: "The Valley Desk", version: "1.0.0" };
export const maxRequestBytes = 16_384;
const listTtlMs = 3_600_000;
const metaPrefix = "io.modelcontextprotocol/";
const instructions =
  "The Valley Desk lists healthcare research software projects and publications connected to the nine-county Delaware Valley. Use search to find records, fetch for one record, whats_new for recent additions, and the two list tools for filter values. Cite each record's url. A Verified label means a source ties the work to the region; Listed means an observed association. A listing does not establish employment, ownership or clinical validation. Dates are labelled: published (paper appeared), pushed (code last changed), added (entered the directory).";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers":
    "content-type, accept, authorization, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, last-event-id",
  "access-control-max-age": "86400",
};
// Responses are never cached, so a removal takes effect on the next call.
const headers = {
  ...cors,
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "cdn-cache-control": "no-store",
  "x-robots-tag": "noindex",
};

type RateLimiter = { limit(options: { key: string }): Promise<{ success: boolean }> };
export type McpEnv = { limiter?: RateLimiter } & ToolContext;
type Id = string | number | null;

const reply = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...headers, ...extra } });
const failure = (status: number, id: Id, code: number, message: string, data?: unknown) =>
  reply(status, { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } });

function headerValue(value: string | null) {
  const encoded = /^=\?base64\?(.*)\?=$/.exec(value ?? "");
  if (!encoded) return value;
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(encoded[1]), (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
}

async function readBody(request: Request) {
  if (Number(request.headers.get("content-length")) > maxRequestBytes) return undefined;
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxRequestBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) joined.set(chunk, offset), (offset += chunk.length);
  return new TextDecoder().decode(joined);
}

export async function serveMcp(request: Request, env: McpEnv): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") {
    const message = "This MCP endpoint accepts POST only. It keeps no sessions and opens no event stream.";
    return reply(405, { jsonrpc: "2.0", id: null, error: { code: -32600, message } }, { allow: "POST, OPTIONS" });
  }
  // The server holds no cookies or credentials, so any web origin may call it. A present but
  // malformed Origin is still refused, as the transport requires.
  const origin = request.headers.get("origin");
  if (origin !== null && !/^https?:\/\/[^\s/]+$/i.test(origin)) return failure(403, null, -32600, "Invalid Origin header.");
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) {
    return failure(415, null, -32600, "Content-Type must be application/json.");
  }
  const body = await readBody(request);
  if (body === undefined) return failure(413, null, -32600, `Request body exceeds ${maxRequestBytes} bytes.`);
  let message: Record<string, any>;
  try {
    message = JSON.parse(body);
  } catch {
    return failure(400, null, -32700, "Parse error.");
  }
  if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0") {
    return failure(400, null, -32600, "Send one JSON-RPC 2.0 message per request. Batches are not supported.");
  }
  const { method } = message;
  // Notifications and client responses need no answer from a stateless server.
  if (typeof method !== "string" || message.id === undefined || message.id === null) return reply(202, null);
  const id: Id = typeof message.id === "string" || typeof message.id === "number" ? message.id : null;
  const params = message.params && typeof message.params === "object" ? (message.params as Record<string, any>) : {};

  const versionHeader = request.headers.get("mcp-protocol-version");
  const requested = params._meta?.[metaPrefix + "protocolVersion"];
  const modern = method !== "initialize" && (requested !== undefined || versionHeader === modernVersion);
  const unsupported = (version: unknown) =>
    failure(400, id, -32022, "Unsupported protocol version", {
      supported: [modernVersion, ...legacyVersions],
      requested: String(version).slice(0, 40),
    });
  if (modern) {
    if (typeof requested !== "string" || typeof params._meta?.[metaPrefix + "clientCapabilities"] !== "object") {
      return failure(400, id, -32602, `Every request needs _meta["${metaPrefix}protocolVersion"] and _meta["${metaPrefix}clientCapabilities"].`);
    }
    if (requested !== modernVersion) return unsupported(requested);
    const name = method === "tools/call" ? params.name : undefined;
    if (
      versionHeader !== requested ||
      request.headers.get("mcp-method") !== method ||
      (name !== undefined && headerValue(request.headers.get("mcp-name")) !== name)
    ) {
      return failure(400, id, -32020, "HeaderMismatch: MCP-Protocol-Version, Mcp-Method and Mcp-Name must be present and match the request body.");
    }
  } else if (versionHeader !== null && !legacyVersions.includes(versionHeader)) {
    return unsupported(versionHeader);
  }
  const info = { [metaPrefix + "serverInfo"]: serverInfo };
  const result = (value: Record<string, unknown>) =>
    reply(200, { jsonrpc: "2.0", id, result: modern ? { resultType: "complete", ...value, _meta: { ...(value._meta as object), ...info } } : value });
  const capabilities = { tools: { listChanged: false } };

  switch (method) {
    case "server/discover":
      return result({ supportedVersions: [modernVersion], capabilities, instructions, ttlMs: listTtlMs, cacheScope: "public" });
    case "initialize": {
      const asked = params.protocolVersion;
      return result({ protocolVersion: legacyVersions.includes(asked) ? asked : legacyVersions[0], capabilities, serverInfo, instructions });
    }
    case "ping":
      return result({});
    case "tools/list":
      if (params.cursor !== undefined) return failure(modern ? 400 : 200, id, -32602, "Invalid cursor. The tool list has one page.");
      return result({ tools: await definitionsFor(env), ...(modern ? { ttlMs: listTtlMs, cacheScope: "public" } : {}) });
    case "tools/call": {
      if (!hasTool(params.name)) return failure(modern ? 400 : 200, id, -32602, "Unknown tool.");
      if (env.limiter) {
        const { success } = await env.limiter.limit({ key: request.headers.get("cf-connecting-ip") ?? "unknown" });
        if (!success) return failure(429, id, -32000, "Too many requests. Wait a minute and try again.");
      }
      return result(await callTool(params.name, params.arguments, env));
    }
    default:
      return failure(modern ? 404 : 200, id, -32601, "Method not found.");
  }
}
