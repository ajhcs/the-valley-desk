import { RegionalAgentResult, RegionalDiscoveryResult, RegionalDiscoveryRecordResult, RegionalAgentError, safeRegionalAgentError } from "./regional-agent-contract";
const definitions = [
  { name: "regional_source_inventory", endpoint: "/api/agent/regional-source-inventory", output: RegionalAgentResult },
  { name: "regional_discovery_candidates", endpoint: "/api/agent/regional-discovery-candidates", output: RegionalDiscoveryResult },
  { name: "regional_discovery_record", endpoint: "/api/agent/regional-discovery-record", output: RegionalDiscoveryRecordResult },
] as const;
type ModelContext = { registerTool: (tool: { name: string; title: string; description: string;
  inputSchema: Record<string, unknown>; annotations: Record<string, boolean>;
  execute: (args: unknown, context?: { signal?: AbortSignal }) => Promise<unknown> }, options?: { signal?: AbortSignal }) => Promise<void> };
const sessions = new WeakMap<Document, Promise<{ supported: boolean; registered: boolean; dispose: () => void }>>();
async function boundedJson(response: Response, byteCap: number) {
  if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw new Error("read-unavailable");
  const reader = response.body?.getReader(); if (!reader) throw new Error("read-unavailable");
  const parts: Uint8Array[] = []; let total = 0;
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; total += chunk.value.length;
    if (total > byteCap) { await reader.cancel(); throw new Error("read-unavailable"); } parts.push(chunk.value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
/** Fixed local-preview or authenticated Ops endpoints; native registration changes no visible UI. */
export function registerRegionalBrowserTools(doc: Document = document, mode: "preview" | "ops" = "preview", lifecycleSignal?: AbortSignal) {
  if (lifecycleSignal?.aborted) return Promise.resolve({
    supported: Boolean(doc.defaultView?.isSecureContext && typeof (doc as Document & { modelContext?: ModelContext }).modelContext?.registerTool === "function"),
    registered: false, dispose: () => {},
  });
  const existing = sessions.get(doc); if (existing) return existing;
  const registration = (async () => {
    const modelContext = (doc as Document & { modelContext?: ModelContext }).modelContext;
    if (!doc.defaultView?.isSecureContext || typeof modelContext?.registerTool !== "function")
      return { supported: false, registered: false, dispose: () => {} };
    const controller = new AbortController();
    const prefix = mode === "ops" ? "/ops/api/agent" : "/api/agent";
    const credentials = mode === "ops" ? "same-origin" : "omit";
    let disposed = false;
    const dispose = () => { if (disposed) return; disposed = true; controller.abort(); sessions.delete(doc); lifecycleSignal?.removeEventListener("abort", dispose); };
    lifecycleSignal?.addEventListener("abort", dispose, { once: true });
    try {
      const metadata = await boundedJson(await fetch(`${prefix}/tools`, { credentials, cache: "no-store", redirect: "error",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }), 65536);
      if (!Array.isArray(metadata.tools) || metadata.tools.length !== definitions.length) throw new Error("read-unavailable");
      for (const definition of definitions) {
        const matching = metadata.tools.filter((row: { name: string }) => row.name === definition.name);
        const tool = matching[0];
        if (matching.length !== 1 || tool.inputSchema?.type !== "object" || tool.inputSchema.additionalProperties !== false ||
          typeof tool.title !== "string" || tool.title.length > 100 || typeof tool.description !== "string" || tool.description.length > 1000) throw new Error("read-unavailable");
        await modelContext.registerTool({ name: definition.name, title: tool.title, description: tool.description,
          inputSchema: tool.inputSchema, annotations: { readOnlyHint: true, consequentialHint: false, untrustedContentHint: true },
          execute: async (args, context) => {
            try {
              const signals = [controller.signal, AbortSignal.timeout(10000), ...(context?.signal ? [context.signal] : [])];
              const body = JSON.stringify(args); if (new TextEncoder().encode(body).length > 16384) throw new Error("invalid-cursor-query");
              const response = await fetch(definition.endpoint.replace("/api/agent", prefix), { method: "POST", credentials, cache: "no-store", redirect: "error",
                headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.any(signals) });
              const result = await boundedJson(response, 131072);
              return result.isError ? RegionalAgentError.parse(result) : definition.output.parse(result);
            } catch (error) { return safeRegionalAgentError(error); }
          } }, { signal: controller.signal });
      }
      if (controller.signal.aborted) throw new Error("read-unavailable");
      return { supported: true, registered: true, dispose };
    } catch { dispose(); return { supported: true, registered: false, dispose: () => {} }; }
  })();
  sessions.set(doc, registration); return registration;
}
