// WebMCP page tools (W3C Web Machine Learning CG draft, 19 November 2026).
// Offers the site's read-only MCP tools to an in-browser agent through document.modelContext.
// Does nothing in a browser without the API, and pages never depend on it.
(() => {
  const context = document.modelContext || navigator.modelContext;
  if (!context || typeof context.registerTool !== "function") return;
  const version = "2026-07-28";
  const meta = {
    "io.modelcontextprotocol/protocolVersion": version,
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": { name: "valley-desk-webmcp", version: "1.0.0" },
  };
  let next = 0;
  async function rpc(method, params, signal) {
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": version, "mcp-method": method };
    if (params.name) headers["mcp-name"] = params.name;
    const response = await fetch("/mcp", {
      method: "POST",
      headers,
      signal,
      credentials: "omit",
      body: JSON.stringify({ jsonrpc: "2.0", id: ++next, method, params: { ...params, _meta: meta } }),
    });
    const message = await response.json();
    if (message.error) throw new Error(message.error.message);
    return message.result;
  }
  rpc("tools/list", {})
    .then(({ tools }) =>
      Promise.all(
        tools.map((tool) =>
          context.registerTool({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: { readOnlyHint: true },
            async execute(input, options) {
              const result = await rpc("tools/call", { name: tool.name, arguments: input || {} }, options && options.signal);
              if (result.isError) throw new Error(result.content[0].text);
              return result.structuredContent;
            },
          }),
        ),
      ),
    )
    .catch(() => {});
})();
