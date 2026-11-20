// Routes for AI-assistant access: the MCP endpoint, its server card, the setup page and the
// ChatGPT domain-verification file.
import { directoryCatalog } from "../ingest/public-directory-data";
import { renderDirectoryPage } from "../ingest/public-directory-page";
import { contactLink, html } from "../ingest/public-directory-ui";
import { legacyVersions, maxRequestBytes, modernVersion, serveMcp, serverInfo } from "./mcp";
import { limits, toolDefinitions } from "./tools";

export const connectPath = "/discover/connect";
export const mcpPath = "/mcp";
const cardPath = mcpPath + "/server-card";
const challengePath = "/.well-known/openai-apps-challenge";
const summary = "Search healthcare research connected to the Delaware Valley from Claude, ChatGPT and other AI assistants.";

export const isAssistantPath = (path: string) =>
  [mcpPath, cardPath, connectPath, challengePath].includes(path.replace(/(.)\/$/, "$1"));

type Env = {
  VALLEY_DESK_DB?: ConstructorParameters<typeof Object>[0];
  PUBLICATIONS_PUBLIC_ENABLED?: string;
  OPENAI_APPS_CHALLENGE?: string;
  MCP_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
};

// MCP Server Card (SEP-2127), served beside the endpoint it describes.
export const serverCard = (origin: string) => ({
  $schema: "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
  name: "org.thevalleydesk/directory",
  version: serverInfo.version,
  title: serverInfo.title,
  description: "Search healthcare research connected to the nine-county Delaware Valley. Read-only.",
  websiteUrl: origin + connectPath,
  repository: { url: "https://github.com/ajhcs/the-valley-desk", source: "github" },
  remotes: [{ type: "streamable-http", url: origin + mcpPath, supportedProtocolVersions: [modernVersion, ...legacyVersions] }],
});

function connectPage(origin: string) {
  const endpoint = origin + mcpPath;
  const code = (value: string) => `<pre><code>${html(value)}</code></pre>`;
  const json = (value: unknown) => code(JSON.stringify(value, null, 2));
  return `<article class="frame page prose-page">
    <nav class="breadcrumb" aria-label="Directory breadcrumb"><a href="/discover/works">Research directory</a></nav>
    <h1>Connect an AI assistant</h1>
    <p class="prose-intro">Search the directory from the assistant you already use. The Valley Desk runs a public, read-only <a href="https://modelcontextprotocol.io/">Model Context Protocol</a> server. It needs no account or key, and the assistant runs on your own subscription and device.</p>
    <section>
      <h2>Server address</h2>
      ${code(endpoint)}
      <p>Streamable HTTP, no sign-in. Protocol revisions ${[modernVersion, ...legacyVersions].join(", ")}.</p>
    </section>
    <section id="claude">
      <h2>Claude</h2>
      <p>In Claude on the web or desktop, open <strong>Customize</strong>, then <strong>Connectors</strong>, choose <strong>Add custom connector</strong>, name it The Valley Desk and paste the server address. Choose no sign-in when asked.</p>
      <p>In Claude Code:</p>
      ${code(`claude mcp add --transport http valley-desk ${endpoint}`)}
    </section>
    <section id="chatgpt">
      <h2>ChatGPT</h2>
      <p>On chatgpt.com, open <strong>Plugins</strong>, choose <strong>Add custom MCP server</strong>, paste the server address as the connection URL and choose no authentication. Custom servers depend on your ChatGPT plan and workspace settings.</p>
    </section>
    <section id="other">
      <h2>Other assistants and editors</h2>
      <p>VS Code, in <code>.vscode/mcp.json</code>:</p>
      ${json({ servers: { "valley-desk": { type: "http", url: endpoint } } })}
      <p>Cursor, in <code>.cursor/mcp.json</code>:</p>
      ${json({ mcpServers: { "valley-desk": { url: endpoint } } })}
      <p>A client that only starts local servers can bridge to the address with <code>mcp-remote</code>:</p>
      ${json({ mcpServers: { "valley-desk": { command: "npx", args: ["-y", "mcp-remote", endpoint] } } })}
    </section>
    <section id="tools">
      <h2>What an assistant can do</h2>
      <dl class="definition-list">${toolDefinitions
        .map((tool) => `<div><dt><code>${html(tool.name)}</code> · ${html(tool.title)}</dt><dd>${html(tool.description)}</dd></div>`)
        .join("")}</dl>
      <p>Each result carries its Valley Desk URL, the <a href="/discover/methodology#regional-evidence">Verified or Listed</a> label and dates marked as published, pushed or added. Removed listings are never returned. If removal records cannot be read, the tools return an error and no records, as the pages do.</p>
    </section>
    <section id="limits">
      <h2>Limits</h2>
      <p>Results come ${limits.pageSize} to a page, up to page ${limits.maxPage.toLocaleString("en")}. A response is capped near ${Math.round(limits.resultBytes / 1000)} kB and a request at ${Math.round(maxRequestBytes / 1024)} kB. Bylines show the first ${limits.bylineNames} names. Tool calls are limited to 60 a minute per IP address. Listing counts in the two list tools can lag by up to ${limits.facetMemoMs / 60_000} minutes. Responses are not cached. The tools search research records. They do not search by author.</p>
    </section>
    <section id="in-browser">
      <h2>In-browser agents</h2>
      <p>Directory pages offer the same tools to browser agents through the WebMCP proposal (<code>document.modelContext</code>) where the browser supports it. Pages work the same without it and without JavaScript.</p>
    </section>
    <section id="privacy">
      <h2>Privacy</h2>
      <p>The server asks for a search and nothing about you. It has no accounts, cookies or sign-in, and it does not receive your conversation. Your assistant sends only the tool inputs it chooses, such as search words and filters.</p>
      <p>The Valley Desk does not write tool inputs or results to its logs or database, and does not sell or share them. Our host, Cloudflare, processes each request to deliver it, including the IP address it came from, and keeps standard request logs (time, address requested, response status, country and client software) for a few days for reliability and abuse prevention. To limit abuse, tool calls are counted per IP address for one minute at a time. Search words travel in the request body, which those logs do not record.</p>
      <p>Results are public directory records. Your assistant’s provider handles your conversation under its own terms. ${contactLink("Email the directory team", undefined, "Valley Desk assistant access")} with questions or a removal request.</p>
    </section>
  </article>`;
}

export async function serveAssistantAccess(request: Request, env: Env, origin: string, nonce?: string): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/(.)\/$/, "$1");
  if (path === mcpPath) {
    return serveMcp(request, {
      db: env.VALLEY_DESK_DB as never,
      origin,
      publicationsEnabled: env.PUBLICATIONS_PUBLIC_ENABLED === "true",
      limiter: env.MCP_RATE_LIMITER,
    });
  }
  const head = request.method === "HEAD";
  if (request.method !== "GET" && !head) {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD", "cache-control": "no-store" } });
  }
  const send = (body: string, headers: Record<string, string>, status = 200) => new Response(head ? null : body, { status, headers });
  if (path === cardPath) {
    return send(JSON.stringify(serverCard(origin)), {
      "content-type": "application/mcp-server-card+json",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=3600",
    });
  }
  if (path === challengePath) {
    // ChatGPT domain verification: the exact token from the submission portal, as plain text.
    const token = env.OPENAI_APPS_CHALLENGE?.trim();
    return token && /^[\w.~+/=-]{8,512}$/.test(token)
      ? send(token, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" })
      : send("Not found", { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" }, 404);
  }
  const page = renderDirectoryPage(
    {
      kind: "research",
      title: "Connect an AI assistant",
      summary,
      path: connectPath,
      content: connectPage(origin),
      schema: { "@type": "WebPage", name: "Connect an AI assistant", url: origin + connectPath, description: summary },
    },
    directoryCatalog,
    origin,
    nonce,
  );
  return send(page, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "cdn-cache-control": "no-store" });
}
