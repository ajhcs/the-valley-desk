/** No response strings, prompts, reasoning, or native parser messages leave
 * this module. Diagnostics describe structure, never the response's content. */
export type ModelResponseDiagnostic = {
  startedAt: string; endedAt?: string;
  phase: "transport" | "outer_json" | "content_json" | "parsed";
  failure?: string;
  status?: number; requestId?: string; responseId?: string;
  finishReason?: string; maxTokens: number;
  responseFormat: "json_object" | "json_schema" | "other";
  creditLimitSource?: "openrouter_credits" | "openrouter_key_limit" | "openrouter_in_flight_budget";
  creditLimitReason?: "in_flight_budget_exhausted" | "weight_exceeds_budget";
  retryAfterSeconds?: number;
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

/** Preserve only literal documented 402 metadata; never infer an account balance.
 * Error diagnostics may use at most 8192 bytes and 200ms, never trigger retries. */
export async function readCreditLimitDiagnostic(response: Response): Promise<Pick<ModelResponseDiagnostic,
  "creditLimitSource" | "creditLimitReason" | "retryAfterSeconds">> {
  const result: Pick<ModelResponseDiagnostic, "creditLimitSource" | "creditLimitReason" | "retryAfterSeconds"> = {};
  if (response.status !== 402) return result;
  const retry = response.headers.get("retry-after");
  if (retry && /^\d{1,5}$/.test(retry) && Number(retry) > 0 && Number(retry) <= 86400) result.retryAfterSeconds = Number(retry);
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) return result;
  const reader = response.body?.getReader();
  if (!reader) return result;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 200); });
  try {
    const decoder = new TextDecoder();
    let text = "", bytes = 0;
    while (true) {
      const part = await Promise.race([reader.read(), deadline]);
      if (!part) return result;
      if (part.done) { text += decoder.decode(); break; }
      bytes += part.value.byteLength;
      if (bytes > 8192) return result;
      text += decoder.decode(part.value, { stream: true });
    }
    const error = JSON.parse(text)?.error;
    if (!error || error.code !== 402 || !error.metadata || typeof error.metadata !== "object") return result;
    const { limit_source, reason } = error.metadata;
    if (limit_source === "openrouter_credits" || limit_source === "openrouter_key_limit" || limit_source === "openrouter_in_flight_budget") result.creditLimitSource = limit_source;
    if (reason === "in_flight_budget_exhausted" || reason === "weight_exceeds_budget") result.creditLimitReason = reason;
  } catch { /* Failure classification never depends on optional diagnostic data. */ }
  finally {
    clearTimeout(timer);
    try { void reader.cancel().catch(() => {}); } catch { /* Already closed. */ }
    reader.releaseLock();
  }
  return result;
}
