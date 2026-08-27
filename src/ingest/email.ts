import type { D1DatabaseLike } from "./persistence";
import { normalizeSourceUrl } from "./identity";
import { logOps } from "../lib/ops";

export const EMAIL_DOMAIN = "thevalleydesk.org";
export const EMAIL_DISCOVERY_VERSION = "email-discovery-v1";
export const EMAIL_MAX_RAW_BYTES = 512_000;
export const EMAIL_MAX_SUBJECT = 300;
export const EMAIL_MAX_EXCERPT = 1_500;
export const EMAIL_MAX_URLS = 20;
export const EMAIL_MAX_URL_LENGTH = 500;
export const EMAIL_MAX_MIME_PARTS = 12;
export const EMAIL_MAX_MIME_DEPTH = 3;
export const EMAIL_MAX_ADDRESS = 254;
export const EMAIL_MAX_MESSAGE_ID = 200;
export const EMAIL_MAX_DECODED_PART = 64_000;
export const EMAIL_MAX_HEADER_CHARS = 16_384;
export const EMAIL_RETENTION_DAYS = 90;
export const EMAIL_MAX_DOMAIN_PER_DAY = 250;
export const EMAIL_MAX_TOTAL_PER_DAY = 2_000;

export const EMAIL_LOCAL_PARTS = [
  "signals",
  "linkedin",
  "page",
  "pages",
  "newsletter",
  "newsletters",
] as const;

export type EmailCategory = "linkedin" | "page" | "newsletter" | "unknown";
export type EmailDiscoveryStatus = "review" | "ignored";
export type EmailHandlerOutcome =
  | "accepted"
  | "duplicate"
  | "rejected"
  | "too_large"
  | "unsupported_recipient"
  | "failed";

export type InboundEmailMessage = {
  from: string;
  to: string;
  headers: Headers;
  raw: ReadableStream<Uint8Array>;
  rawSize: number;
  setReject(reason: string): void;
};

export type EmailEnv = {
  VALLEY_DESK_DB: D1DatabaseLike;
};

export type AcceptedRecipient = {
  address: string;
  local: string;
  plus: string | null;
  categoryHint: EmailCategory | null;
};

export type EmailDiscoveryRecord = {
  id: string;
  messageId: string | null;
  envelopeTo: string;
  fromAddress: string | null;
  fromDomain: string;
  subject: string | null;
  category: EmailCategory;
  status: EmailDiscoveryStatus;
  urls: string[];
  excerpt: string | null;
  rawSize: number;
  truncated: boolean;
  instructionLike: boolean;
  receivedAt: string;
};

export type EmailHandlerResult = {
  outcome: EmailHandlerOutcome;
  id?: string;
  category?: EmailCategory;
  status?: EmailDiscoveryStatus;
  urlCount?: number;
  truncated?: boolean;
  instructionLike?: boolean;
  reason?: string;
};

const ACCEPTED_LOCAL = new Set<string>(EMAIL_LOCAL_PARTS);
const LOCAL_CATEGORY: Record<string, EmailCategory> = {
  linkedin: "linkedin",
  page: "page",
  pages: "page",
  newsletter: "newsletter",
  newsletters: "newsletter",
};

const LINKEDIN_SENDER_ROOTS = ["linkedin.com", "linkedinmail.com"];
const PAGE_SENDER_ROOTS = ["facebookmail.com", "facebook.com", "meta.com"];
const NEWSLETTER_SENDER_ROOTS = [
  "substack.com",
  "substackmail.com",
  "mailchimp.com",
  "mcsv.net",
  "rsgsv.net",
  "beehiiv.com",
  "convertkit.com",
  "convertkit-mail.com",
  "ck.page",
  "hubspotemail.net",
  "hs-sales-engage.com",
  "sendgrid.net",
  "mailgun.org",
  "constantcontact.com",
  "campaign-archive.com",
  "buttondown.email",
  "ghost.io",
  "klaviyo.com",
  "kmail-lists.com",
];

const INSTRUCTION_RE = /(ignore (all )?(previous|above) instructions|you are (an? )?(chatgpt|language model|helpful assistant)|system prompt|REVIEW_API_TOKEN|authorization:\s*bearer|auto-?publish|publish (this|now|immediately))/i;

class EmailLimitError extends Error {
  readonly code = "too_large" as const;
  constructor() {
    super("Inbound email exceeded the discovery size limit");
    this.name = "EmailLimitError";
  }
}

function clampText(value: string, max: number) {
  return value.length <= max ? value : value.slice(0, max);
}

function stripControls(value: string) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function headerGet(headers: Headers, name: string) {
  return headers.get(name) ?? headers.get(name.toLowerCase()) ?? "";
}

export function extractEmailAddress(raw: string | undefined | null) {
  if (!raw) return "";
  const trimmed = stripControls(raw).trim();
  const angle = trimmed.match(/<([^<>]+)>/);
  const value = (angle?.[1] ?? trimmed).replace(/^"+|"+$/g, "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > EMAIL_MAX_ADDRESS) return "";
  return value;
}

export function emailDomainOf(address: string) {
  const at = address.lastIndexOf("@");
  return at >= 0 ? address.slice(at + 1).toLowerCase() : "";
}

function hostMatches(hostname: string, roots: string[]) {
  return roots.some((root) => hostname === root || hostname.endsWith(`.${root}`));
}

export function acceptedEmailRecipient(to: string): AcceptedRecipient | null {
  const address = extractEmailAddress(to);
  const domain = emailDomainOf(address);
  if (!address || domain !== EMAIL_DOMAIN) return null;
  const localFull = address.slice(0, address.length - domain.length - 1);
  const plusAt = localFull.indexOf("+");
  const local = plusAt >= 0 ? localFull.slice(0, plusAt) : localFull;
  const plus = plusAt >= 0 ? localFull.slice(plusAt + 1) : null;
  if (!ACCEPTED_LOCAL.has(local)) return null;
  if (plus && local !== "signals") return null;
  const hintKey = plus && LOCAL_CATEGORY[plus] ? plus : local;
  return {
    address,
    local,
    plus,
    categoryHint: LOCAL_CATEGORY[hintKey] ?? null,
  };
}

function normalizeCharset(value: string) {
  const charset = value.trim().toLowerCase().replace(/_/g, "-");
  if (!charset || charset === "utf8" || charset === "utf-8") return "utf-8";
  if (charset === "us-ascii" || charset === "ascii") return "utf-8";
  if (charset === "iso-8859-1" || charset === "latin1" || charset === "latin-1") return "iso-8859-1";
  if (charset === "windows-1252" || charset === "cp1252") return "windows-1252";
  return "utf-8";
}

function decodeBytes(bytes: Uint8Array, charset: string) {
  try {
    return new TextDecoder(normalizeCharset(charset), { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

function decodeQuotedPrintable(input: string) {
  const cleaned = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let index = 0; index < cleaned.length; index += 1) {
    const char = cleaned[index];
    if (char === "=" && index + 2 < cleaned.length && /^[0-9A-Fa-f]{2}$/.test(cleaned.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(cleaned.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }
    bytes.push(cleaned.charCodeAt(index) & 0xff);
    if (bytes.length > EMAIL_MAX_DECODED_PART) break;
  }
  return new Uint8Array(bytes);
}

function decodeBase64Bounded(input: string) {
  const cleaned = input.replace(/\s+/g, "");
  if (!cleaned) return new Uint8Array();
  if (cleaned.length > EMAIL_MAX_DECODED_PART * 2) {
    return decodeBase64Bounded(cleaned.slice(0, EMAIL_MAX_DECODED_PART * 2));
  }
  try {
    const binary = atob(cleaned);
    const max = Math.min(binary.length, EMAIL_MAX_DECODED_PART);
    const bytes = new Uint8Array(max);
    for (let index = 0; index < max; index += 1) bytes[index] = binary.charCodeAt(index) & 0xff;
    return bytes;
  } catch {
    return new Uint8Array();
  }
}

function decodeRfc2047(value: string) {
  return value.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_all, charset: string, encoding: string, text: string) => {
    const bytes = encoding.toLowerCase() === "b"
      ? decodeBase64Bounded(text)
      : decodeQuotedPrintable(text.replace(/_/g, " "));
    return decodeBytes(bytes, charset);
  });
}

function parseHeaderBlock(raw: string) {
  const headers = new Headers();
  const unfolded = raw.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const split = line.indexOf(":");
    if (split <= 0) continue;
    const name = line.slice(0, split).trim();
    const value = decodeRfc2047(line.slice(split + 1).trim());
    if (!name) continue;
    try {
      headers.append(name, value);
    } catch {
      // Ignore invalid header names in untrusted mail.
    }
  }
  return headers;
}

function headerParam(value: string, name: string) {
  const match = value.match(new RegExp(`(?:^|;|\\s)${name}\\s*=\\s*("(?:\\\\.|[^"])*"|[^;]+)`, "i"));
  if (!match) return "";
  return match[1].trim().replace(/^"(.*)"$/, "$1").replace(/\\"/g, '"');
}

function mediaType(contentType: string) {
  return contentType.split(";")[0]?.trim().toLowerCase() || "text/plain";
}

function decodePartBody(body: string, encoding: string, charset: string) {
  const transfer = encoding.trim().toLowerCase();
  if (transfer === "base64") return clampText(decodeBytes(decodeBase64Bounded(body), charset), EMAIL_MAX_DECODED_PART);
  if (transfer === "quoted-printable") return clampText(decodeBytes(decodeQuotedPrintable(body), charset), EMAIL_MAX_DECODED_PART);
  return clampText(body, EMAIL_MAX_DECODED_PART);
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_all, hex: string) => fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_all, dec: string) => fromCodePoint(Number(dec)));
}

function fromCodePoint(code: number) {
  if (!Number.isFinite(code) || code < 9 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127 || code > 0x10ffff) {
    return "";
  }
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function stripHtml(html: string) {
  return stripControls(
    decodeHtmlEntities(
      html
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  ).replace(/\s+/g, " ").trim();
}

function isPublicHostname(hostname: string) {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (host === "0.0.0.0" || host === "127.0.0.1" || host === "::1") return false;
  if (host === "169.254.169.254") return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host.includes(":")) return false;
  return host.includes(".");
}

export function keepHttpsDiscoveryUrl(raw: string) {
  const trimmed = stripControls(decodeHtmlEntities(raw.trim())).replace(/[),.;]+$/g, "");
  if (!/^https:\/\//i.test(trimmed) || trimmed.length > EMAIL_MAX_URL_LENGTH * 2) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") return undefined;
  if (parsed.username || parsed.password) return undefined;
  if (!isPublicHostname(parsed.hostname)) return undefined;
  // Email links commonly carry bearer-like click, unsubscribe, and tracking
  // secrets under arbitrary parameter names. The path is the only safe
  // canonical discovery identity, so discard the entire query string.
  parsed.search = "";
  const normalized = normalizeSourceUrl(parsed.toString());
  if (!normalized || !normalized.startsWith("https://") || normalized.length > EMAIL_MAX_URL_LENGTH) return undefined;
  return normalized;
}

function collectUrls(text: string, html: string, limit: number) {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    if (found.length >= limit) return;
    const url = keepHttpsDiscoveryUrl(raw);
    if (!url || seen.has(url)) return;
    seen.add(url);
    found.push(url);
  };
  for (const match of html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) add(match[1]);
  for (const match of `${text}\n${html}`.matchAll(/https:\/\/[^\s<>"'\\)]+/gi)) add(match[0]);
  return found;
}

type MimeExtract = {
  text: string;
  html: string;
  parts: number;
  truncated: boolean;
};

function parseMimeParts(raw: string, contentType: string, encoding: string, depth: number, state: MimeExtract) {
  if (state.truncated || state.parts >= EMAIL_MAX_MIME_PARTS || depth > EMAIL_MAX_MIME_DEPTH) {
    state.truncated = true;
    return;
  }
  const type = mediaType(contentType);
  if (type.startsWith("multipart/")) {
    const boundary = headerParam(contentType, "boundary");
    if (!boundary) {
      state.truncated = true;
      return;
    }
    const escaped = boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const boundaryRe = new RegExp(`(?:^|\\r?\\n)--${escaped}(--)?[ \\t]*(?:\\r?\\n|$)`, "gm");
    const boundaries = [...raw.matchAll(boundaryRe)];
    for (let index = 0; index < boundaries.length; index += 1) {
      const boundaryMatch = boundaries[index];
      if (boundaryMatch[1] === "--") break;
      if (state.parts >= EMAIL_MAX_MIME_PARTS) {
        state.truncated = true;
        break;
      }
      const start = (boundaryMatch.index ?? 0) + boundaryMatch[0].length;
      const end = boundaries[index + 1]?.index ?? raw.length;
      const chunk = raw.slice(start, end);
      if (!chunk.trim() || chunk.startsWith("--")) continue;
      const split = chunk.search(/\r?\n\r?\n/);
      const partHeaders = parseHeaderBlock((split >= 0 ? chunk.slice(0, split) : chunk).slice(0, EMAIL_MAX_HEADER_CHARS));
      const disposition = headerGet(partHeaders, "content-disposition").toLowerCase();
      if (/\battachment\b/.test(disposition)) {
        state.parts += 1;
        continue;
      }
      parseMimeParts(
        split >= 0 ? chunk.slice(split).replace(/^\r?\n\r?\n/, "") : "",
        headerGet(partHeaders, "content-type") || "text/plain",
        headerGet(partHeaders, "content-transfer-encoding"),
        depth + 1,
        state,
      );
    }
    return;
  }
  state.parts += 1;
  if (type.startsWith("image/") || type.startsWith("application/") || type.startsWith("audio/") || type.startsWith("video/")) {
    return;
  }
  const charset = headerParam(contentType, "charset") || "utf-8";
  const decoded = decodePartBody(raw, encoding, charset);
  if (type === "text/html") {
    if (state.html.length < EMAIL_MAX_DECODED_PART) state.html = clampText(`${state.html}\n${decoded}`.trim(), EMAIL_MAX_DECODED_PART);
    return;
  }
  if (type === "text/plain" || type.startsWith("text/")) {
    if (state.text.length < EMAIL_MAX_DECODED_PART) state.text = clampText(`${state.text}\n${decoded}`.trim(), EMAIL_MAX_DECODED_PART);
  }
}

function parseMimeMessage(raw: string, fallbackHeaders: Headers): MimeExtract {
  const split = raw.search(/\r?\n\r?\n/);
  const headerText = (split >= 0 ? raw.slice(0, split) : raw).slice(0, EMAIL_MAX_HEADER_CHARS);
  const body = split >= 0 ? raw.slice(split).replace(/^\r?\n\r?\n/, "") : "";
  const parsedHeaders = parseHeaderBlock(headerText);
  const contentType = headerGet(parsedHeaders, "content-type") || headerGet(fallbackHeaders, "content-type") || "text/plain";
  const encoding = headerGet(parsedHeaders, "content-transfer-encoding") || headerGet(fallbackHeaders, "content-transfer-encoding");
  const state: MimeExtract = { text: "", html: "", parts: 0, truncated: headerText.length >= EMAIL_MAX_HEADER_CHARS };
  parseMimeParts(body, contentType, encoding, 0, state);
  return state;
}

function classifyEmail(input: {
  recipient: AcceptedRecipient;
  fromDomain: string;
  subject: string;
  headers: Headers;
}): EmailCategory {
  if (input.recipient.categoryHint === "linkedin") {
    return hostMatches(input.fromDomain, LINKEDIN_SENDER_ROOTS) ? "linkedin" : "unknown";
  }
  if (input.recipient.categoryHint === "page") {
    return hostMatches(input.fromDomain, PAGE_SENDER_ROOTS) ? "page" : "unknown";
  }
  if (input.recipient.categoryHint === "newsletter") {
    return hostMatches(input.fromDomain, NEWSLETTER_SENDER_ROOTS) ? "newsletter" : "unknown";
  }
  if (hostMatches(input.fromDomain, LINKEDIN_SENDER_ROOTS)) {
    if (/\b(page|company|showcase)\b/i.test(input.subject)) return "page";
    return "linkedin";
  }
  if (hostMatches(input.fromDomain, PAGE_SENDER_ROOTS)) return "page";
  if (hostMatches(input.fromDomain, NEWSLETTER_SENDER_ROOTS)) return "newsletter";
  const listId = headerGet(input.headers, "list-id") || headerGet(input.headers, "list-unsubscribe");
  if (listId) return "newsletter";
  if (/\bnewsletter\b|\bdigest\b/i.test(input.subject)) return "newsletter";
  return "unknown";
}

function authenticatedEnvelopeSender(headers: Headers, fromDomain: string) {
  if (!fromDomain || fromDomain === "unknown") return false;
  const authentication = [
    headerGet(headers, "authentication-results"),
    headerGet(headers, "arc-authentication-results"),
  ].filter(Boolean).join(" ").toLowerCase();
  if (!authentication || !/(?:spf|dkim|dmarc)\s*=\s*pass\b/.test(authentication)) return false;
  return authentication.includes(fromDomain.toLowerCase());
}

function excerptFrom(text: string, html: string) {
  const plain = stripControls(text).replace(/\s+/g, " ").trim();
  const fromHtml = stripHtml(html);
  const chosen = plain.length >= 80 || !fromHtml ? plain || fromHtml : fromHtml;
  if (!chosen) return null;
  return clampText(chosen, EMAIL_MAX_EXCERPT);
}

async function discoveryId(recipient: string, messageId: string | null, rawDigest: string) {
  return sha256Hex(`${EMAIL_DISCOVERY_VERSION}:${recipient}:mid:${messageId ?? ""}:raw:${rawDigest}`);
}

export async function parseEmailDiscovery(input: {
  envelopeFrom: string;
  envelopeTo: string;
  headers: Headers;
  raw: string;
  rawSize: number;
  receivedAt?: string;
}): Promise<EmailDiscoveryRecord | { error: "unsupported_recipient" }> {
  const recipient = acceptedEmailRecipient(input.envelopeTo) ?? acceptedEmailRecipient(headerGet(input.headers, "to"));
  if (!recipient) return { error: "unsupported_recipient" };

  const mime = parseMimeMessage(input.raw, input.headers);
  const urls = collectUrls(mime.text, mime.html, EMAIL_MAX_URLS);
  const truncated = mime.truncated
    || urls.length >= EMAIL_MAX_URLS
    || mime.text.length >= EMAIL_MAX_DECODED_PART
    || mime.html.length >= EMAIL_MAX_DECODED_PART;
  const subject = clampText(
    stripControls(decodeRfc2047(headerGet(input.headers, "subject") || "")).replace(/\s+/g, " ").trim(),
    EMAIL_MAX_SUBJECT,
  ) || null;
  const envelopeFrom = extractEmailAddress(input.envelopeFrom);
  const fromAddress = envelopeFrom || null;
  const fromDomain = emailDomainOf(envelopeFrom) || "unknown";
  const messageIdRaw = clampText(stripControls(headerGet(input.headers, "message-id")).trim(), EMAIL_MAX_MESSAGE_ID);
  const messageId = messageIdRaw || null;
  const excerpt = excerptFrom(mime.text, mime.html);
  const category = classifyEmail({ recipient, fromDomain, subject: subject ?? "", headers: input.headers });
  const instructionLike = INSTRUCTION_RE.test(`${subject ?? ""}\n${excerpt ?? ""}`);
  const receivedAt = input.receivedAt || new Date().toISOString();
  const rawDigest = await sha256Hex(input.raw);
  const senderAuthenticated = authenticatedEnvelopeSender(input.headers, fromDomain);
  const status: EmailDiscoveryStatus = instructionLike || !senderAuthenticated || (urls.length === 0 && category === "unknown")
    ? "ignored"
    : "review";
  return {
    id: await discoveryId(recipient.address, messageId, rawDigest),
    messageId,
    envelopeTo: recipient.address,
    fromAddress,
    fromDomain,
    subject,
    category,
    status,
    urls,
    excerpt,
    rawSize: input.rawSize,
    truncated,
    instructionLike,
    receivedAt,
  };
}

function isConstraintError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /unique|constraint|SQLITE_CONSTRAINT/i.test(message);
}

function changedRows(result: unknown) {
  if (!result || typeof result !== "object") return 0;
  const direct = (result as { changes?: unknown }).changes;
  const nested = (result as { meta?: { changes?: unknown } }).meta?.changes;
  const value = typeof nested === "number" || typeof nested === "bigint" ? nested : direct;
  return typeof value === "number" || typeof value === "bigint" ? Number(value) : 0;
}

export async function persistEmailDiscovery(
  db: D1DatabaseLike,
  record: EmailDiscoveryRecord,
): Promise<"accepted" | "duplicate" | "quota_exceeded"> {
  const existing = await db.prepare("SELECT id FROM email_discoveries WHERE id = ?").bind(record.id).first<{ id: string }>();
  if (existing) {
    await db.prepare(`
      UPDATE email_discoveries
      SET last_seen_at = ?, receive_count = receive_count + 1
      WHERE id = ?
    `).bind(record.receivedAt, record.id).run();
    return "duplicate";
  }
  try {
    const dayCutoff = new Date(new Date(record.receivedAt).getTime() - 86_400_000).toISOString();
    const inserted = await db.prepare(`
      INSERT INTO email_discoveries (
        id, message_id, envelope_to, from_address, from_domain, subject, category, status,
        url_count, urls_json, excerpt, raw_size, truncated, instruction_like, receive_count,
        first_seen_at, last_seen_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
      WHERE (SELECT COUNT(*) FROM email_discoveries WHERE first_seen_at >= ?) < ?
        AND (SELECT COUNT(*) FROM email_discoveries WHERE from_domain = ? AND first_seen_at >= ?) < ?
    `).bind(
      record.id,
      record.messageId,
      record.envelopeTo,
      record.fromAddress,
      record.fromDomain,
      record.subject,
      record.category,
      record.status,
      record.urls.length,
      JSON.stringify(record.urls),
      record.excerpt,
      record.rawSize,
      record.truncated ? 1 : 0,
      record.instructionLike ? 1 : 0,
      record.receivedAt,
      record.receivedAt,
      dayCutoff,
      EMAIL_MAX_TOTAL_PER_DAY,
      record.fromDomain,
      dayCutoff,
      EMAIL_MAX_DOMAIN_PER_DAY,
    ).run();
    return changedRows(inserted) > 0 ? "accepted" : "quota_exceeded";
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    await db.prepare(`
      UPDATE email_discoveries
      SET last_seen_at = ?, receive_count = receive_count + 1
      WHERE id = ?
    `).bind(record.receivedAt, record.id).run();
    return "duplicate";
  }
}

export async function cleanupEmailDiscoveries(db: D1DatabaseLike, now = new Date()) {
  const retentionCutoff = new Date(now.getTime() - EMAIL_RETENTION_DAYS * 86_400_000).toISOString();
  return db.prepare("DELETE FROM email_discoveries WHERE last_seen_at < ?").bind(retentionCutoff).run();
}

async function readRawBounded(stream: ReadableStream<Uint8Array>, maxBytes: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new EmailLimitError();
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Stream may already be cancelled.
    }
  }
  return decodeBytes(concatBytes(chunks), "utf-8");
}

function logEmail(result: EmailHandlerResult, extra: Record<string, unknown> = {}) {
  const level = result.outcome === "failed"
    ? "error"
    : result.outcome === "rejected" || result.outcome === "too_large" || result.outcome === "unsupported_recipient"
      ? "warn"
      : "info";
  logOps("email", {
    outcome: result.outcome,
    id: result.id,
    category: result.category,
    status: result.status,
    urlCount: result.urlCount,
    truncated: result.truncated,
    instructionLike: result.instructionLike,
    ...extra,
  }, level);
}

export async function handleInboundEmail(message: InboundEmailMessage, env: EmailEnv): Promise<EmailHandlerResult> {
  const recipient = acceptedEmailRecipient(message.to);
  if (!recipient) {
    message.setReject("Mailbox unavailable");
    const result: EmailHandlerResult = { outcome: "unsupported_recipient", reason: "Mailbox unavailable" };
    logEmail(result, { fromDomain: emailDomainOf(extractEmailAddress(message.from) || message.from) });
    return result;
  }
  if (!Number.isFinite(message.rawSize) || message.rawSize < 0 || message.rawSize > EMAIL_MAX_RAW_BYTES) {
    message.setReject("Message too large");
    try {
      await message.raw.cancel();
    } catch {
      // Best-effort; rejection already recorded.
    }
    const result: EmailHandlerResult = {
      outcome: "too_large",
      category: recipient.categoryHint ?? "unknown",
      reason: "Message too large",
    };
    logEmail(result, { rawSize: message.rawSize, recipient: recipient.address });
    return result;
  }

  let raw = "";
  try {
    raw = await readRawBounded(message.raw, EMAIL_MAX_RAW_BYTES);
  } catch (error) {
    if (error instanceof EmailLimitError) {
      message.setReject("Message too large");
      const result: EmailHandlerResult = {
        outcome: "too_large",
        category: recipient.categoryHint ?? "unknown",
        reason: "Message too large",
      };
      logEmail(result, { rawSize: message.rawSize, recipient: recipient.address });
      return result;
    }
    const result: EmailHandlerResult = { outcome: "failed", reason: error instanceof Error ? error.message : "read failed" };
    logEmail(result, { recipient: recipient.address });
    return result;
  }

  try {
    const parsed = await parseEmailDiscovery({
      envelopeFrom: message.from,
      envelopeTo: message.to,
      headers: message.headers,
      raw,
      rawSize: message.rawSize,
    });
    if ("error" in parsed) {
      message.setReject("Mailbox unavailable");
      const result: EmailHandlerResult = { outcome: "unsupported_recipient", reason: "Mailbox unavailable" };
      logEmail(result);
      return result;
    }
    if (parsed.category === "unknown" || parsed.status !== "review") {
      message.setReject("Mailbox unavailable");
      const result: EmailHandlerResult = { outcome: "rejected", reason: "Message did not meet discovery policy" };
      logEmail(result, { recipient: parsed.envelopeTo, fromDomain: parsed.fromDomain });
      return result;
    }
    const persisted = await persistEmailDiscovery(env.VALLEY_DESK_DB, parsed);
    if (persisted === "quota_exceeded") {
      message.setReject("Mailbox unavailable");
      const result: EmailHandlerResult = { outcome: "rejected", reason: "Discovery quota exceeded" };
      logEmail(result, { recipient: parsed.envelopeTo, fromDomain: parsed.fromDomain });
      return result;
    }
    const outcome = persisted;
    const result: EmailHandlerResult = {
      outcome,
      id: parsed.id,
      category: parsed.category,
      status: parsed.status,
      urlCount: parsed.urls.length,
      truncated: parsed.truncated,
      instructionLike: parsed.instructionLike,
    };
    logEmail(result, {
      recipient: parsed.envelopeTo,
      fromDomain: parsed.fromDomain,
      rawSize: parsed.rawSize,
    });
    return result;
  } catch (error) {
    const result: EmailHandlerResult = {
      outcome: "failed",
      reason: error instanceof Error ? error.message : "Unknown inbound email failure",
    };
    logEmail(result, { recipient: recipient.address });
    return result;
  }
}
