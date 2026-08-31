import {
  classifyFetchError,
  classifyHttpStatus,
  isFailureSourceState,
  type SourceRunState,
} from "./source-health";

export const SOURCE_TIMEOUT_MS = 12_000;
export const RSS_MAX_BYTES = 1_500_000;
export const SOCIAL_MAX_BYTES = 512_000;
export const EVENTS_MAX_BYTES = 1_500_000;
export const MAX_UPSTREAM_ATTEMPTS = 3;
export const MAX_RETRY_WAIT_MS = 2_000;
export const SOURCE_USER_AGENT = "TheValleyDesk/0.1 (+https://github.com/ajhcs/the-valley-desk)";

export class UpstreamError extends Error {
  readonly code: SourceRunState;
  readonly httpStatus?: number;

  constructor(code: SourceRunState, message: string, httpStatus?: number) {
    super(message);
    this.name = "UpstreamError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

function concat(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function retryDelayMs(res: Response | undefined, attempt: number, now = Date.now()) {
  const header = res?.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(MAX_RETRY_WAIT_MS, seconds * 1000);
    }
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.min(MAX_RETRY_WAIT_MS, Math.max(0, date - now));
  }
  const base = 50 * (2 ** attempt);
  const jitter = Math.floor(Math.random() * 50);
  return Math.min(400, base + jitter);
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function readBoundedText(res: Response, maxBytes: number) {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new UpstreamError("upstream-failed", `Response exceeded ${maxBytes} bytes`, 413);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new UpstreamError("upstream-failed", `Response exceeded ${maxBytes} bytes`, 413);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(concat(chunks));
}

export async function readBoundedJson<T>(res: Response, maxBytes: number): Promise<T> {
  const body = await readBoundedText(res, maxBytes);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new UpstreamError("parser-failed", "Upstream JSON could not be parsed");
  }
}

function isRetryableError(error: UpstreamError) {
  if (error.httpStatus) return RETRYABLE_STATUS.has(error.httpStatus);
  return error.code === "rate-limited" || error.code === "upstream-failed" || error.code === "timed-out";
}

export async function fetchUpstream(options: {
  url: string;
  fetchImpl: typeof fetch;
  maxBytes: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  attempts?: number;
  /** Public sources must not be mislabeled as authentication failures. */
  requiresAuth?: boolean;
  allowedRedirectHosts?: ReadonlySet<string>;
  maxRedirects?: number;
  /** Absolute wall-clock deadline shared across attempts and redirect hops. */
  deadlineAt?: number;
}): Promise<{ status: number; body: string; url: string; headers: Headers }> {
  const attempts = Math.max(1, options.attempts ?? MAX_UPSTREAM_ATTEMPTS);
  const timeoutMs = options.timeoutMs ?? SOURCE_TIMEOUT_MS;
  let lastError: UpstreamError | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let res: Response | undefined;
    try {
      let currentUrl = options.url;
      const redirectLimit = Math.max(0, Math.min(options.maxRedirects ?? 3, 5));
      for (let hop = 0; ; hop += 1) {
        const remaining = options.deadlineAt === undefined
          ? timeoutMs
          : Math.min(timeoutMs, options.deadlineAt - Date.now());
        if (remaining <= 0) throw new UpstreamError("timed-out", "Upstream deadline exceeded");
        res = await options.fetchImpl(currentUrl, {
          headers: options.headers,
          signal: AbortSignal.timeout(Math.max(1, remaining)),
          redirect: options.allowedRedirectHosts ? "manual" : "follow",
        });
        if (!options.allowedRedirectHosts || res.status < 300 || res.status >= 400) break;
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => undefined);
        if (!location || hop >= redirectLimit) {
          throw new UpstreamError("upstream-failed", "Upstream redirect limit exceeded");
        }
        let next: URL;
        try {
          next = new URL(location, currentUrl);
        } catch {
          throw new UpstreamError("upstream-failed", "Upstream redirect URL was invalid");
        }
        if (next.protocol !== "https:" || !options.allowedRedirectHosts.has(next.hostname.toLowerCase())) {
          throw new UpstreamError("upstream-failed", "Upstream redirect left the source allowlist");
        }
        currentUrl = next.toString();
      }
      if (res.ok) {
        const body = await readBoundedText(res, options.maxBytes);
        return { status: res.status, body, url: res.url || currentUrl, headers: res.headers };
      }
      await res.body?.cancel().catch(() => undefined);
      lastError = new UpstreamError(
        classifyHttpStatus(res.status, { requiresAuth: options.requiresAuth }),
        `HTTP ${res.status}`,
        res.status,
      );
      if (!RETRYABLE_STATUS.has(res.status) || attempt === attempts - 1) throw lastError;
      await sleep(retryDelayMs(res, attempt));
    } catch (error) {
      if (error instanceof UpstreamError) {
        lastError = error;
      } else {
        const state = classifyFetchError(error);
        lastError = new UpstreamError(
          state,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!isFailureSourceState(lastError.code) || !isRetryableError(lastError) || attempt === attempts - 1) {
        throw lastError;
      }
      await sleep(retryDelayMs(res, attempt));
    }
  }
  throw lastError ?? new UpstreamError("upstream-failed", "Upstream request failed");
}
