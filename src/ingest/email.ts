import type { D1DatabaseLike } from "./persistence";
import { normalizeSourceUrl } from "./identity";
import { logOps } from "../lib/ops";
import { looksInstructionLike } from "./untrusted-text";

export const EMAIL_DOMAIN = "thevalleydesk.org";
export const EMAIL_DISCOVERY_VERSION = "email-discovery-v1";
export const EMAIL_MAX_RAW_BYTES = 5_000_000;
export const EMAIL_MAX_PDF_BYTES = 3_000_000;
export const EMAIL_MAX_PDF_ATTACHMENTS = 3;
export const EMAIL_PDF_CHUNK_BYTES = 48_000;
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
/** Deprecated compatibility constant. Raw MIME authentication headers are
 * never an authority, regardless of an authserv-id string in configuration. */
export const EMAIL_TRUSTED_AUTHSERV_ID = "";

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
/** Email is a discovery pointer, never an authoritative editorial source. */
export type EmailTrustState = "untrusted-pointer" | "authenticated-pointer";
export type EmailHandlerOutcome =
  | "accepted"
  | "duplicate"
  | "pending_auth"
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
  /** Set only by a trusted runtime adapter, never parsed from MIME headers. */
  authProvenance?: EmailAuthenticationProvenance;
  /** Set only by the runtime adapter when Analytics has not indexed the
   * matching route event yet. The row is quarantined and cannot be verified. */
  authenticationPending?: boolean;
  authenticationError?: string;
  authenticationAttemptedAt?: string;
  setReject(reason: string): void;
};

export type EmailEnv = {
  VALLEY_DESK_DB: D1DatabaseLike;
};

export type EmailAuthenticationProvenance = {
  source: "cloudflare-email-routing-adaptive";
  receiptId: string;
  sessionId: string;
  routeRuleId: string;
  observedAt: string;
  envelopeFrom: string;
  envelopeTo: string;
  messageId: string;
  eventType: "incoming";
  action: string;
  spf: "pass" | "fail" | "neutral" | "none" | "temperror" | "permerror";
  dkim: "pass" | "fail" | "neutral" | "none" | "temperror" | "permerror";
  dmarc: "pass" | "fail" | "bestguesspass" | "none";
  isSpam: boolean;
};

export type EmailAuthenticationState = "legacy" | "pending" | "authenticated" | "rejected" | "failed" | "exhausted";

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
  trustState: EmailTrustState;
  urls: string[];
  excerpt: string | null;
  rawSize: number;
  truncated: boolean;
  instructionLike: boolean;
  receivedAt: string;
  pdfAttachments: EmailPdfAttachment[];
  authProvenance: EmailAuthenticationProvenance | null;
  authProvenanceSha256: string | null;
  authState: EmailAuthenticationState;
  authAttemptCount: number;
  authAttemptedAt: string | null;
  authNextAttemptAt: string | null;
  authError: string | null;
};

export type EmailPdfAttachment = {
  id: string;
  filename: string;
  mimeType: "application/pdf";
  byteCount: number;
  sha256: string;
  bytes: Uint8Array;
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

async function sha256Hex(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
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
  // Plus aliases are an allowlist, not a free-form category input. This keeps
  // future-domain routing from accidentally collapsing into the generic inbox.
  if (plus && !LOCAL_CATEGORY[plus]) return null;
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

function decodeBase64Bounded(input: string, maxBytes = EMAIL_MAX_DECODED_PART) {
  const cleaned = input.replace(/\s+/g, "");
  if (!cleaned) return new Uint8Array();
  if (cleaned.length > maxBytes * 2) {
    return decodeBase64Bounded(cleaned.slice(0, maxBytes * 2), maxBytes);
  }
  try {
    const binary = atob(cleaned);
    const max = Math.min(binary.length, maxBytes);
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
  // Preserve only identifiers with a documented public meaning on exact
  // official paths. Every other query may contain tracking, unsubscribe, or
  // bearer-like secrets and is discarded in full.
  const safeQuery = new URLSearchParams();
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "haponline.org" && parsed.pathname.toLowerCase() === "/resource-center") {
    const resourceId = parsed.searchParams.get("resourceid");
    if (resourceId && /^\d{1,10}$/.test(resourceId)) safeQuery.set("resourceid", resourceId);
  } else if (host === "palegis.us" && parsed.pathname.toLowerCase() === "/house/co-sponsorship/memo") {
    const memoId = parsed.searchParams.get("memoID") ?? parsed.searchParams.get("memoid");
    const document = parsed.searchParams.get("document");
    if (memoId && /^\d{1,10}$/.test(memoId)) safeQuery.set("memoID", memoId);
    if (document && /^(?:HB|SB)\d{1,5}$/i.test(document)) safeQuery.set("document", document.toUpperCase());
  } else if (host === "palegis.us" && parsed.pathname.toLowerCase() === "/house/committees/committee-archives/archive-file") {
    const file = parsed.searchParams.get("file");
    if (file && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.pdf$/i.test(file)) safeQuery.set("file", file);
  }
  parsed.search = "";
  for (const [key, value] of safeQuery) parsed.searchParams.set(key, value);
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
  pdfAttachments: Array<{ filename: string; bytes: Uint8Array }>;
};

function safeAttachmentFilename(value: string) {
  const name = decodeRfc2047(value).split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001F\u007F]/g, "").trim() ?? "";
  return (name || "attachment.pdf").slice(0, 180);
}

function decodeBinaryPart(body: string, encoding: string) {
  const transfer = encoding.trim().toLowerCase();
  if (transfer === "base64") return decodeBase64Bounded(body, EMAIL_MAX_PDF_BYTES + 1);
  if (transfer === "quoted-printable") return decodeQuotedPrintable(body).slice(0, EMAIL_MAX_PDF_BYTES + 1);
  return new TextEncoder().encode(body).slice(0, EMAIL_MAX_PDF_BYTES + 1);
}

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
      const disposition = headerGet(partHeaders, "content-disposition");
      const partContentType = headerGet(partHeaders, "content-type") || "text/plain";
      const partType = mediaType(partContentType);
      if (/\battachment\b/i.test(disposition) || partType === "application/pdf") {
        state.parts += 1;
        if (partType === "application/pdf" && state.pdfAttachments.length < EMAIL_MAX_PDF_ATTACHMENTS) {
          const bytes = decodeBinaryPart(
            split >= 0 ? chunk.slice(split).replace(/^\r?\n\r?\n/, "") : "",
            headerGet(partHeaders, "content-transfer-encoding"),
          );
          if (bytes.byteLength > 0 && bytes.byteLength <= EMAIL_MAX_PDF_BYTES) {
            state.pdfAttachments.push({
              filename: safeAttachmentFilename(headerParam(disposition, "filename") || headerParam(partContentType, "name")),
              bytes,
            });
          } else {
            state.truncated = true;
          }
        } else if (partType === "application/pdf") {
          state.truncated = true;
        }
        continue;
      }
      parseMimeParts(
        split >= 0 ? chunk.slice(split).replace(/^\r?\n\r?\n/, "") : "",
        partContentType,
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
  const state: MimeExtract = { text: "", html: "", parts: 0, truncated: headerText.length >= EMAIL_MAX_HEADER_CHARS, pdfAttachments: [] };
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

export function canonicalEmailAuthenticationProvenance(value: EmailAuthenticationProvenance) {
  return JSON.stringify({
    source: value.source,
    receiptId: value.receiptId,
    sessionId: value.sessionId,
    routeRuleId: value.routeRuleId.toLowerCase(),
    observedAt: value.observedAt,
    envelopeFrom: value.envelopeFrom.toLowerCase(),
    envelopeTo: value.envelopeTo.toLowerCase(),
    messageId: value.messageId,
    eventType: value.eventType,
    action: value.action,
    spf: value.spf,
    dkim: value.dkim,
    dmarc: value.dmarc,
    isSpam: value.isSpam,
  });
}

export function emailAuthenticationProvenanceSha256(value: EmailAuthenticationProvenance) {
  return sha256Hex(canonicalEmailAuthenticationProvenance(value));
}

export function trustedEmailAuthenticationProvenance(input: {
  provenance?: EmailAuthenticationProvenance;
  envelopeFrom: string;
  envelopeTo: string;
  messageId: string | null;
}) {
  const value = input.provenance;
  if (!value || value.source !== "cloudflare-email-routing-adaptive") return false;
  if (!/^[^\s\u0000-\u001F\u007F]{8,200}$/.test(value.receiptId)) return false;
  if (!/^[^\s\u0000-\u001F\u007F]{4,200}$/.test(value.sessionId)) return false;
  if (!/^[A-Fa-f0-9-]{16,64}$/.test(value.routeRuleId)) return false;
  if (!Number.isFinite(Date.parse(value.observedAt)) || !input.messageId) return false;
  if (extractEmailAddress(value.envelopeFrom) !== extractEmailAddress(input.envelopeFrom)) return false;
  if (acceptedEmailRecipient(value.envelopeTo)?.address !== acceptedEmailRecipient(input.envelopeTo)?.address) return false;
  if (value.messageId.trim() !== input.messageId.trim()) return false;
  if (value.eventType !== "incoming" || !value.action.trim() || value.isSpam) return false;
  // Cloudflare Email Routing admission requires SPF or DKIM. For editorial
  // intake we impose the stronger DMARC-pass requirement as well.
  return value.dmarc === "pass" && (value.spf === "pass" || value.dkim === "pass");
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
  authProvenance?: EmailAuthenticationProvenance;
}): Promise<EmailDiscoveryRecord | { error: "unsupported_recipient" }> {
  // The platform-provided envelope recipient is the routing authority. A
  // MIME To header is sender-controlled and must never turn an invalid route
  // into an accepted alias.
  const recipient = acceptedEmailRecipient(input.envelopeTo);
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
  // The exact recipient alias is the only category signal trusted from the
  // forwarding path. Envelope/header senders can be rewritten by Gmail and
  // are retained solely for later public-source verification diagnostics.
  const category = recipient.categoryHint
    ?? classifyEmail({ recipient, fromDomain, subject: subject ?? "", headers: input.headers });
  const instructionLike = looksInstructionLike(subject, excerpt);
  const receivedAt = input.receivedAt || new Date().toISOString();
  const rawDigest = await sha256Hex(input.raw);
  const pdfAttachments = await Promise.all(mime.pdfAttachments.map(async (attachment, index) => {
    const sha256 = await sha256Hex(attachment.bytes);
    return {
      id: `${await sha256Hex(`${recipient.address}:${messageId ?? rawDigest}:${sha256}`)}-${index}`,
      filename: attachment.filename,
      mimeType: "application/pdf" as const,
      byteCount: attachment.bytes.byteLength,
      sha256,
      bytes: attachment.bytes,
    };
  }));
  const senderAuthenticated = trustedEmailAuthenticationProvenance({
    provenance: input.authProvenance,
    envelopeFrom: input.envelopeFrom,
    envelopeTo: input.envelopeTo,
    messageId,
  });
  const trustState: EmailTrustState = senderAuthenticated ? "authenticated-pointer" : "untrusted-pointer";
  const status: EmailDiscoveryStatus = instructionLike || (urls.length === 0 && category === "unknown")
    ? "ignored"
    : "review";
  const authProvenance = senderAuthenticated ? input.authProvenance! : null;
  return {
    id: await discoveryId(recipient.address, messageId, rawDigest),
    messageId,
    envelopeTo: recipient.address,
    fromAddress,
    fromDomain,
    subject,
    category,
    status,
    trustState,
    urls,
    excerpt,
    rawSize: input.rawSize,
    truncated,
    instructionLike,
    receivedAt,
    pdfAttachments,
    authProvenance,
    authProvenanceSha256: authProvenance ? await emailAuthenticationProvenanceSha256(authProvenance) : null,
    authState: senderAuthenticated ? "authenticated" : "pending",
    authAttemptCount: senderAuthenticated ? 1 : 0,
    authAttemptedAt: senderAuthenticated ? receivedAt : null,
    authNextAttemptAt: null,
    authError: null,
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
  if (existing) return "duplicate";
  try {
    const dayCutoff = new Date(new Date(record.receivedAt).getTime() - 86_400_000).toISOString();
    const inserted = await db.prepare(`
      INSERT INTO email_discoveries (
        id, message_id, envelope_to, from_address, from_domain, subject, category, status,
        trust_state, url_count, urls_json, excerpt, raw_size, wire_size,
        auth_provenance_json, auth_provenance_sha256, auth_state, auth_attempt_count,
        auth_attempted_at, auth_next_attempt_at, auth_error, truncated, instruction_like, receive_count,
        first_seen_at, last_seen_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
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
      record.trustState,
      record.urls.length,
      JSON.stringify(record.urls),
      record.excerpt,
      Math.min(record.rawSize, 512_000),
      record.rawSize,
      record.authProvenance ? canonicalEmailAuthenticationProvenance(record.authProvenance) : null,
      record.authProvenanceSha256,
      record.authState,
      record.authAttemptCount,
      record.authAttemptedAt,
      record.authNextAttemptAt,
      record.authError,
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
    return "duplicate";
  }
}

export async function persistEmailAuthenticationOutcome(
  db: D1DatabaseLike,
  discoveryId: string,
  outcome: {
    state: Exclude<EmailAuthenticationState, "legacy" | "pending">;
    attemptedAt: string;
    attemptCount: number;
    nextAttemptAt?: string | null;
    error?: string;
    provenance?: EmailAuthenticationProvenance;
    correlation: { envelopeFrom: string; envelopeTo: string; messageId: string };
  },
) {
  const authenticated = outcome.state === "authenticated" && outcome.provenance
    && trustedEmailAuthenticationProvenance({
      provenance: outcome.provenance,
      envelopeFrom: outcome.correlation.envelopeFrom,
      envelopeTo: outcome.correlation.envelopeTo,
      messageId: outcome.correlation.messageId,
    });
  if (outcome.state === "authenticated" && !authenticated) {
    throw new Error("Cannot persist an invalid email authentication receipt");
  }
  const provenanceJson = authenticated
    ? canonicalEmailAuthenticationProvenance(outcome.provenance!)
    : outcome.provenance ? canonicalEmailAuthenticationProvenance(outcome.provenance) : null;
  const provenanceSha256 = outcome.provenance
    ? await emailAuthenticationProvenanceSha256(outcome.provenance)
    : null;
  const result = await db.prepare(`
    UPDATE email_discoveries
    SET status = ?, trust_state = ?, auth_state = ?, auth_attempt_count = ?,
        auth_attempted_at = ?, auth_next_attempt_at = ?, auth_error = ?,
        auth_provenance_json = ?, auth_provenance_sha256 = ?
    WHERE id = ? AND auth_state IN ('pending', 'failed')
      AND LOWER(COALESCE(from_address, '')) = LOWER(?)
      AND LOWER(envelope_to) = LOWER(?)
      AND COALESCE(message_id, '') = ?
  `).bind(
    authenticated ? "review" : "ignored",
    authenticated ? "authenticated-pointer" : "untrusted-pointer",
    outcome.state,
    Math.max(1, Math.trunc(outcome.attemptCount)),
    outcome.attemptedAt,
    outcome.nextAttemptAt ?? null,
    outcome.error?.replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, 500) ?? null,
    provenanceJson,
    provenanceSha256,
    discoveryId,
    extractEmailAddress(outcome.correlation.envelopeFrom),
    acceptedEmailRecipient(outcome.correlation.envelopeTo)?.address ?? "",
    outcome.correlation.messageId,
  ).run();
  return changedRows(result);
}

export async function persistEmailPdfAttachments(db: D1DatabaseLike, record: EmailDiscoveryRecord) {
  let persisted = 0;
  for (const attachment of record.pdfAttachments) {
    const chunks: Uint8Array[] = [];
    for (let offset = 0; offset < attachment.bytes.byteLength; offset += EMAIL_PDF_CHUNK_BYTES) {
      chunks.push(attachment.bytes.slice(offset, offset + EMAIL_PDF_CHUNK_BYTES));
    }
    const statements = [
      db.prepare(`INSERT INTO email_pdf_attachments (
        id, discovery_id, filename, mime_type, byte_count, sha256, extraction_state, created_at
      ) VALUES (?, ?, ?, 'application/pdf', ?, ?, 'pending', ?)
      ON CONFLICT(discovery_id, sha256) DO NOTHING`).bind(
        attachment.id, record.id, attachment.filename, attachment.byteCount, attachment.sha256, record.receivedAt,
      ),
      ...chunks.map((chunk, index) => db.prepare(`INSERT INTO email_pdf_attachment_chunks
        (attachment_id, chunk_index, bytes) VALUES (?, ?, ?)
        ON CONFLICT(attachment_id, chunk_index) DO NOTHING`).bind(attachment.id, index, chunk)),
    ];
    await db.batch(statements);
    persisted += 1;
  }
  return persisted;
}

export async function persistEmailPdfPageEvidence(
  db: D1DatabaseLike,
  attachmentId: string,
  pages: Array<{ pageNumber: number; text: string; evidenceSpans?: string[] }>,
  now = new Date(),
  audit?: { method: string; receiptSha256: string; extractedBy: string },
) {
  if (pages.length === 0 || pages.length > 500) throw new Error("PDF extraction must contain 1-500 pages");
  const normalized = pages.map((page, index) => {
    if (page.pageNumber !== index + 1 || !page.text.trim() || page.text.length > 32_000) {
      throw new Error("PDF pages must be contiguous, non-empty, and bounded");
    }
    const evidenceSpans = (page.evidenceSpans ?? []).filter((span) => span.length >= 3 && page.text.includes(span)).slice(0, 20);
    return { ...page, text: page.text.trim(), evidenceSpans };
  });
  await db.batch(normalized.map((page) => db.prepare(`INSERT INTO email_pdf_pages
    (attachment_id, page_number, text, evidence_json) VALUES (?, ?, ?, ?)
    ON CONFLICT(attachment_id, page_number) DO UPDATE SET text = excluded.text, evidence_json = excluded.evidence_json`
  ).bind(attachmentId, page.pageNumber, page.text, JSON.stringify(page.evidenceSpans))));
  await db.prepare(`UPDATE email_pdf_attachments SET extraction_state = 'complete', extraction_error = NULL,
    page_count = ?, extraction_method = ?, extraction_receipt_sha256 = ?, extracted_by = ?, extracted_at = ?
    WHERE id = ? AND extraction_state = 'pending'`).bind(
    normalized.length,
    audit?.method ?? null,
    audit?.receiptSha256 ?? null,
    audit?.extractedBy ?? null,
    now.toISOString(),
    attachmentId,
  ).run();
}

export async function markEmailPdfExtractionFailed(
  db: D1DatabaseLike,
  attachmentId: string,
  error: unknown,
  now = new Date(),
  audit?: { method: string; receiptSha256: string; extractedBy: string },
) {
  const message = (error instanceof Error ? error.message : String(error)).replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, 500);
  await db.prepare(`UPDATE email_pdf_attachments SET extraction_state = 'failed', extraction_error = ?,
    extraction_method = ?, extraction_receipt_sha256 = ?, extracted_by = ?, extracted_at = ?
    WHERE id = ? AND extraction_state = 'pending'`).bind(
    message || "PDF extraction failed",
    audit?.method ?? null,
    audit?.receiptSha256 ?? null,
    audit?.extractedBy ?? null,
    now.toISOString(),
    attachmentId,
  ).run();
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
      receivedAt: message.authenticationAttemptedAt,
      authProvenance: message.authProvenance,
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
    if (parsed.trustState !== "authenticated-pointer" && !message.authenticationPending) {
      message.setReject("Sender authentication required");
      const result: EmailHandlerResult = { outcome: "rejected", reason: "Sender authentication required" };
      logEmail(result, { recipient: parsed.envelopeTo, fromDomain: parsed.fromDomain });
      return result;
    }
    const pendingAuthentication = parsed.trustState !== "authenticated-pointer";
    const attemptedAt = message.authenticationAttemptedAt || new Date().toISOString();
    const record = pendingAuthentication ? {
      ...parsed,
      status: "ignored" as const,
      authState: "pending" as const,
      authAttemptCount: 1,
      authAttemptedAt: attemptedAt,
      authNextAttemptAt: new Date(Date.parse(attemptedAt) + 5 * 60_000).toISOString(),
      authError: (message.authenticationError || "Cloudflare authentication event pending").slice(0, 500),
    } : parsed;
    const persisted = await persistEmailDiscovery(env.VALLEY_DESK_DB, record);
    if (persisted === "quota_exceeded") {
      message.setReject("Mailbox unavailable");
      const result: EmailHandlerResult = { outcome: "rejected", reason: "Discovery quota exceeded" };
      logEmail(result, { recipient: parsed.envelopeTo, fromDomain: parsed.fromDomain });
      return result;
    }
    if (persisted === "accepted" && record.pdfAttachments.length > 0) {
      await persistEmailPdfAttachments(env.VALLEY_DESK_DB, record);
    }
    const outcome = pendingAuthentication && persisted === "accepted" ? "pending_auth" : persisted;
    const result: EmailHandlerResult = {
      outcome,
      id: parsed.id,
      category: parsed.category,
      status: record.status,
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
