/** No response strings, prompts, reasoning, or native parser messages leave
 * this module. Diagnostics describe structure, never the response's content. */
export type ModelResponseDiagnostic = {
  startedAt: string; endedAt?: string;
  phase: "transport" | "outer_json" | "content_json" | "parsed";
  failure?: string;
  status?: number; requestId?: string; responseId?: string;
  finishReason?: string; maxTokens: number;
  responseFormat: "json_object" | "json_schema" | "other";
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  shape?: { bytes: number; sha256: string; kind: string; fenced: boolean; parserCategory: string | null; parserOffset: number | null };
};

export class ModelResponseSizeError extends Error {}

export function diagnosticId(value: unknown): string | undefined {
  return typeof value === "string" && /^(?:gen-[0-9]{6,16}-[A-Za-z0-9]{4,80}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(value) ? value : undefined;
}

export async function diagnosticShape(text: string) {
  const bytes = new TextEncoder().encode(text);
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
  let parserCategory: string | null = null;
  let parserOffset: number | null = null;
  try { JSON.parse(text); } catch (error) {
    const message = error instanceof Error ? error.message : "";
    parserCategory = /unterminated|unexpected end/i.test(message) ? "unexpected_end" : "syntax";
    const offset = /position (\d+)/.exec(message)?.[1];
    parserOffset = offset ? Number(offset) : null;
  }
  const first = text.trimStart()[0];
  return { bytes: bytes.length, sha256, kind: first === "{" ? "object-like" : first === "[" ? "array-like" : "other", fenced: /```/.test(text), parserCategory, parserOffset };
}

export function diagnosticUsage(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 10_000_000 ? v : undefined;
  return { promptTokens: count(record.prompt_tokens), completionTokens: count(record.completion_tokens), totalTokens: count(record.total_tokens) };
}

export async function readBoundedModelBody(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) return text + decoder.decode();
      bytes += part.value.byteLength;
      if (bytes > 262144) {
        await reader.cancel();
        throw new ModelResponseSizeError("Model response exceeds byte limit");
      }
      text += decoder.decode(part.value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}
