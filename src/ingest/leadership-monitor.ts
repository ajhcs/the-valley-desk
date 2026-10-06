import {
  coveragePack,
  hostsForSource,
  isLinkedInHost,
  monitorableSources,
  type CoveragePackDocument,
  type CoverageSource,
} from "./coverage-pack";
import {
  diffLeaders,
  normalizePersonName,
  normalizeTitle,
  resolvePersonId,
  type ExtractedLeader,
} from "./executive-history";
import {isLeadershipDomReviewSource,previewLeadershipDom} from "./leadership-dom-review";
import { normalizeSourceUrl } from "./identity";
import {
  LEADERSHIP_ERROR_MAX_CHARS,
  LEADERSHIP_CADENCE_MS,
  LEADERSHIP_CANDIDATE_CAP,
  LEADERSHIP_CONCURRENCY,
  LEADERSHIP_FAILURE_BASE_MS,
  LEADERSHIP_FAILURE_MAX_MS,
  LEADERSHIP_MAX_BYTES,
  LEADERSHIP_MAX_REDIRECTS,
  LEADERSHIP_SUCCESS_REFRESH_MS,
  LEADERSHIP_TIMEOUT_MS,
  LEADERSHIP_TEXT_MAX_CHARS,
} from "./leadership-config";
import { fetchAllowlistedArticlePage } from "./news-extraction";
import { looksInstructionLike } from "./untrusted-text";

import { MARKUP_CAPTURE_SOURCES, markupCaptureWindow, makeMarkupCapture, type LeadershipMarkupCapture } from "./leadership-markup-capture";

export type LeadershipSnapshotState = "success" | "unchanged" | "failed" | "blocked" | "hostile";
export type LeadershipExtractionStatus = "complete" | "empty-unverified" | "challenge" | "partial" | "unrecognized";

export type LeadershipSnapshot = {
  id: string;
  sourceId: string;
  fetchedAt: string;
  finalUrl: string;
  contentHash: string;
  normalizedText: string;
  byteCount: number;
  extracted: ExtractedLeader[];
  extractionStatus: LeadershipExtractionStatus;
  state: LeadershipSnapshotState;
  error?: string | null;
  httpStatus?: number | null;
  instructionLike: boolean;
  /** Quarantined diagnostic bytes, persisted separately; never role evidence. */
  markupCapture?: LeadershipMarkupCapture;
};

export type LeadershipObservationKind =
  | "unchanged"
  | "person-appeared"
  | "person-departed"
  | "title-changed"
  | "hostile-content"
  | "fetch-failed";

export type LeadershipObservation = {
  id: string;
  sourceId: string;
  snapshotId?: string;
  institutionId: string;
  personId?: string;
  kind: LeadershipObservationKind;
  status: "review" | "ignored";
  payload: Record<string, unknown>;
  instructionLike: boolean;
  createdAt: string;
};

export type ScheduledLeadershipState = {
  sourceId: string;
  state: "pending" | "healthy" | "unchanged" | "hostile" | "blocked" | "disabled" | "inventory-only" | "misconfigured" | "upstream-failed" | "timed-out";
  lastHash?: string | null;
  lastExtracted?: ExtractedLeader[];
  lastAttemptedAt?: string | null;
  lastSuccessAt?: string | null;
  nextAttemptAt: string;
  consecutiveFailures: number;
  lastError?: string | null;
};

export type LeadershipMonitorResult = {
  snapshots: LeadershipSnapshot[];
  observations: LeadershipObservation[];
  schedule: ScheduledLeadershipState[];
  fetchedUrls: string[];
};

const TITLE_HINT = /\b(chief|cio|ciso|cmio|cnio|cdoo|cdao|ceo|coo|cfo|president|svp|evp|vice president|\bvp\b|director|officer|interim|informatics)\b/i;
const PERSON_NAME_RE = /^[a-z](?:[a-z.'-]+)?(?: [a-z](?:[a-z.'-]+)?){0,5}$/i;
const CHALLENGE_RE = /\b(?:access denied|captcha|checking your browser|cloudflare|enable javascript|just a moment|robot|unusual traffic|verify you are human)\b/i;

// Article pages often expose one explicit leadership fact in a title, meta
// description, or opening paragraph instead of a roster-shaped h2/p pair. Keep
// this grammar deliberately narrow: only a named executive role may become an
// extracted leader, and the statement must be tied to the configured institution.
const ARTICLE_ROLE_PATTERN = "(?:chief executive officer|chief operating officer|chief information officer|chief medical information officer|chief nursing officer|chief nursing executive|chief digital and information officer|chief clinical officer|president(?:\\s+and\\s+(?:chief executive(?:\\s+officer)?|ceo))?|chief executive|ceo|coo|cfo|cio|ciso|cmio|cnio|cdao|cdoo|svp|evp|vice president|vp|director|officer)";
const ARTICLE_NAME_PATTERN = "[A-Z][A-Za-z.'’\\-]*(?:\\s+[A-Z][A-Za-z.'’\\-]*){1,5}";
const ARTICLE_CREDENTIAL_PATTERN = "(?:MD|DO|PhD|DNP|MBA|MPH|MS|BS|BSN|EMBA|CISM|RN|FACHE|JD|MPA|MHA|FNP|NP)";

function clipError(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, LEADERSHIP_ERROR_MAX_CHARS).trim();
}

function clipText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, LEADERSHIP_TEXT_MAX_CHARS).trim();
}

function decodeHtml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(Number.parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();
}

function htmlToText(html: string) {
  const withBreaks = html
    .replace(/<\/(p|div|h[1-6]|li|tr|section|blockquote|dt|dd)[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  return clipText(decodeHtml(withBreaks.replace(/<[^>]+>/g, " ")));
}

function stripNonContent(html: string) {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, "");
}

function compactEvidenceText(value: string) {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function documentEvidenceTexts(html: string) {
  const cleaned = stripNonContent(html);
  const texts: string[] = [];
  const titleRe = /<title\b[^>]*>([\s\S]*?)<\/title>/gi;
  let match: RegExpExecArray | null;
  while ((match = titleRe.exec(cleaned))) {
    const text = compactEvidenceText(match[1] ?? "");
    if (text) texts.push(text);
  }
  const metaRe = /<meta\b[^>]*>/gi;
  while ((match = metaRe.exec(cleaned))) {
    const tag = match[0] ?? "";
    const name = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (!name || !["description", "og:title", "og:description", "twitter:title", "twitter:description"].includes(name)) continue;
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    const text = compactEvidenceText(content ?? "");
    if (text) texts.push(text);
  }
  const headingRe = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  while ((match = headingRe.exec(cleaned))) {
    const text = compactEvidenceText(htmlToText(match[1] ?? ""));
    if (text) texts.push(text);
  }
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(cleaned)?.[1]
    ?? /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(cleaned)?.[1];
  if (main) {
    // Keep block boundaries before normalizing whitespace. Flattening a section
    // label and the following headline can invent "Announcement Alex Example".
    const blocks = main.replace(/<\/?(?:p|div|h[1-6]|li|tr|section|blockquote|dt|dd|br)\b[^>]*>/gi, "\n");
    for (const block of decodeHtml(blocks.replace(/<[^>]+>/g, " ")).split(/\n+/)) {
      const text = compactEvidenceText(block);
      if (text) texts.push(text);
    }
  }
  return [...new Set(texts)];
}

function extractArticleLeaders(html: string, institutionAliases: readonly string[]) {
  const aliases = institutionAliases
    .map(compactEvidenceText)
    .filter((alias) => alias.length >= 3)
    .map((alias) => alias.toLowerCase());
  if (!aliases.length) return [];

  const evidenceSentences: string[] = [];
  for (const text of documentEvidenceTexts(html)) {
    for (const sentence of text.split(/(?<=[!?])\s+|(?<![A-Z])\.\s+|\n+/)) {
      const compact = compactEvidenceText(sentence);
      const folded = compact.toLowerCase();
      if (compact && aliases.some((alias) => folded.includes(alias))) {
        evidenceSentences.push(compact);
      }
    }
  }

  const articleEvidence = articleDocumentEvidence(html).evidence;
  const merged = new Map<string, ExtractedLeader>();
  const add = (name: string, title: string) => {
    if (!/^[A-Z][A-Za-z.'’\-]*(?:\s+[A-Z][A-Za-z.'’\-]*){1,5}$/.test(name.trim())) return;
    const leader = asLeader(name, title);
    if (leader && !merged.has(leader.normalizedName)) {
      merged.set(leader.normalizedName, { ...leader, articleEvidence });
    }
  };
  // Every article grammar binds the role to the configured institution in
  // the same attribution, not merely to an alias elsewhere in the sentence.
  const escapePattern = (value: string) => [...value].map((char) => "^$.|?*+()[]{}\\".includes(char) ? "\\" + char : char).join("");
  const institutionPattern = aliases.sort((a, b) => b.length - a.length).map(escapePattern).join("|");
  const institution = "(?:" + institutionPattern + ")";
  const institutionEnd = "\\b(?=\\s*(?:[.,;!?\"'\u201c\u201d]|$))";
  const roleAcronym = "(?:\\s+\\((?:CMIO|CNIO|CEO|COO|CFO|CIO|CISO|CDAO|CDOO)\\))?";
  const prefixed = new RegExp(
    "\\b" + institution + "(?:['\u2019]s)?\\s+(?:(?:extends\\s+contract\\s+with|appoints|names)\\s+)?(" + ARTICLE_ROLE_PATTERN + ")\\s+(" + ARTICLE_NAME_PATTERN + ")\\b", "gi",
  );
  const afterRole = new RegExp(
    "\\b(" + ARTICLE_ROLE_PATTERN + ")\\s+(" + ARTICLE_NAME_PATTERN + ")\\s+(?:of|at|for)\\s+" + institution + institutionEnd, "gi",
  );
  const named = new RegExp(
    "\\b(" + ARTICLE_NAME_PATTERN + ")(?:\\s*,\\s*" + ARTICLE_CREDENTIAL_PATTERN + ")*(?:\\s*,)?\\s+(?:has been|was|is|will be|will serve as|serves as|appointed as|named|appointed|selected|elected|promoted to)\\s+("
      + ARTICLE_ROLE_PATTERN + ")" + roleAcronym + "\\s+(?:of|at|for)\\s+" + institution + institutionEnd, "gi",
  );
  const attributed = new RegExp(
    "\\bsaid\\s+(" + ARTICLE_NAME_PATTERN + ")(?:\\s*,\\s*" + ARTICLE_CREDENTIAL_PATTERN + ")*\\s*,\\s*("
      + ARTICLE_ROLE_PATTERN + ")" + roleAcronym + "\\s+(?:at|of|for)\\s+" + institution + institutionEnd, "gi",
  );
  for (const sentence of evidenceSentences) {
    let match: RegExpExecArray | null;
    while ((match = attributed.exec(sentence))) add(match[1] ?? "", match[2] ?? "");
    while ((match = prefixed.exec(sentence))) add(match[2] ?? "", match[1] ?? "");
    while ((match = afterRole.exec(sentence))) add(match[2] ?? "", match[1] ?? "");
    while ((match = named.exec(sentence))) add(match[1] ?? "", match[2] ?? "");
  }
  return [...merged.values()];
}

export async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function ldTypes(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(ldTypes);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  const slash = trimmed.lastIndexOf("/");
  return [(slash >= 0 ? trimmed.slice(slash + 1) : trimmed).toLowerCase()].filter(Boolean);
}

function textFromLd(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFromLd).filter(Boolean).join(" ");
  if (value && typeof value === "object" && "@value" in value) {
    return textFromLd((value as { "@value"?: unknown })["@value"]);
  }
  return "";
}

function parseJsonLdDocument(raw: string): unknown {
  const trimmed = decodeHtml(
    raw
      .replace(/^\s*<!--/, "")
      .replace(/-->\s*$/, "")
      .replace(/\/\/<!\[CDATA\[/, "")
      .replace(/\]\]>/, "")
      .trim(),
  );
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

/** Retain source publication dates verbatim; fetch/dateModified are not publication. */
function articleDocumentEvidence(html: string) {
  let isArticle = false;
  const dates = new Set<string>();
  const addDate = (value: unknown) => {
    if (typeof value !== "string") return;
    const date = value.trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):?[0-5]\d))?$/.exec(date);
    if (!match) return;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1]! || !Number.isFinite(Date.parse(date))) return;
    dates.add(date);
  };
  const walk = (node: unknown, depth = 0) => {
    if (depth > 8 || node == null) return;
    if (Array.isArray(node)) { for (const child of node) walk(child, depth + 1); return; }
    if (typeof node !== "object") return;
    const row = node as Record<string, unknown>;
    if (ldTypes(row["@type"]).some((type) => ["article", "newsarticle", "blogposting"].includes(type))) {
      isArticle = true;
      addDate(row.datePublished);
    }
    if (row["@graph"]) walk(row["@graph"], depth + 1);
    if (row.mainEntity) walk(row.mainEntity, depth + 1);
  };
  for (const match of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    walk(parseJsonLdDocument(match[1] ?? ""));
  }
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = decodeHtml(/\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "");
    if (name === "og:type" && content.toLowerCase() === "article") isArticle = true;
    if (name === "article:published_time") { isArticle = true; addDate(content); }
  }
  for (const match of stripNonContent(html).matchAll(/<time\b[^>]*>/gi)) {
    const tag = match[0];
    // A generic time may be an effective/update date; only explicit publication
    // semantics can supply sourcePublishedAt.
    const itemprop = /\bitemprop\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.split(/\s+/) ?? [];
    if (!itemprop.includes("datePublished") && !/\spubdate(?:\s|=|>)/i.test(tag)) continue;
    isArticle = true;
    addDate(decodeHtml(/\bdatetime\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? ""));
  }
  const candidates = [...dates].sort();
  return {
    // Registered roster contracts may use article as a card container. Generic
    // extraction has no such contract and must treat semantic articles as claims.
    explicitArticle: isArticle,
    isArticle: isArticle || /<article\b/i.test(stripNonContent(html)),
    evidence: {
      sourcePublishedAt: candidates.length === 1 ? candidates[0]! : null,
      sourcePublishedCandidates: candidates.slice(0, 8),
      currentAffiliationVerified: false as const,
    },
  };
}

function asLeader(name: string, title: string): ExtractedLeader | undefined {
  const cleanedName = decodeHtml(name).replace(/\s+/g, " ").trim();
  const cleanedTitle = decodeHtml(title).replace(/\s+/g, " ").trim();
  if (!cleanedName || !cleanedTitle) return undefined;
  if (looksInstructionLike(cleanedName, cleanedTitle)) return undefined;
  const normalizedName = normalizePersonName(cleanedName);
  if (!normalizedName || normalizedName.length < 3) return undefined;
  if (!PERSON_NAME_RE.test(normalizedName)) return undefined;
  if (!TITLE_HINT.test(cleanedTitle) && !TITLE_HINT.test(normalizeTitle(cleanedTitle))) return undefined;
  return {
    name: cleanedName.slice(0, 120),
    normalizedName,
    title: cleanedTitle.slice(0, 200),
    normalizedTitle: normalizeTitle(cleanedTitle),
  };
}

function walkLdPeople(node: unknown, out: ExtractedLeader[], depth = 0) {
  if (depth > 8 || node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) walkLdPeople(item, out, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  if (record["@graph"]) walkLdPeople(record["@graph"], out, depth + 1);
  if (record.mainEntity) walkLdPeople(record.mainEntity, out, depth + 1);
  const types = ldTypes(record["@type"]);
  if (types.includes("person")) {
    const name = textFromLd(record.name) || `${textFromLd(record.givenName)} ${textFromLd(record.familyName)}`.trim();
    const title = textFromLd(record.jobTitle) || textFromLd(record.roleName);
    const leader = asLeader(name, title);
    if (leader) out.push(leader);
  }
}

function extractJsonLdLeaders(html: string): ExtractedLeader[] {
  const out: ExtractedLeader[] = [];
  const re = /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    walkLdPeople(parseJsonLdDocument(match[1] ?? ""), out);
  }
  return out;
}

function extractHeadingLeaders(html: string): ExtractedLeader[] {
  const out: ExtractedLeader[] = [];
  const headingRe = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const roleHeading = new RegExp("^(?:" + ARTICLE_ROLE_PATTERN + ")$", "i");
  const inlineRole = new RegExp("^(" + ARTICLE_NAME_PATTERN + "),\\s*(" + ARTICLE_ROLE_PATTERN + ")$", "i");
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(html))) {
    const name = htmlToText(match[2] ?? "");
    const inline = inlineRole.exec(name);
    if (inline) {
      const leader = asLeader(inline[1] ?? "", inline[2] ?? "");
      if (leader) out.push(leader);
      continue;
    }
    // A role-bearing heading is not itself a person's name.
    if (TITLE_HINT.test(name)) continue;
    let following = html.slice(match.index + match[0].length, match.index + match[0].length + 500);
    const nextHeading = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/i.exec(following);
    let subordinateTitle = "";
    if (nextHeading) {
      const text = htmlToText(nextHeading[2] ?? "");
      // Only an explicit role-only subordinate heading belongs to this person.
      // Never read a paragraph through any subsequent heading, even with CEO.
      if (Number(nextHeading[1]) > Number(match[1]) && roleHeading.test(text)) subordinateTitle = text;
      following = following.slice(0, nextHeading.index);
    }
    const titleMatch = /<(?:p|div|span|dd)\b[^>]*>([\s\S]*?)<\/(?:p|div|span|dd)>/i.exec(following);
    const title = htmlToText(titleMatch?.[1] ?? following) || subordinateTitle;
    const leader = asLeader(name, title);
    if (leader) out.push(leader);
  }
  const pairRe = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
  while ((match = pairRe.exec(html))) {
    const leader = asLeader(htmlToText(match[1] ?? ""), htmlToText(match[2] ?? ""));
    if (leader) out.push(leader);
  }
  return out;
}

type LeadershipExtractionContract = NonNullable<CoverageSource["leadershipExtractionContract"]>;

function classBlocks(html: string, className: string) {
  const starts: number[] = [];
  const re = /<[^>]+\bclass=["']([^"']*)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    if ((match[1] ?? "").split(/\s+/).includes(className)) starts.push(match.index);
  }
  return starts.map((start, index) => html.slice(start, starts[index + 1] ?? html.length));
}

function classText(html: string, className: string) {
  const re = /<([a-z][a-z0-9]*)\b[^>]*\bclass=["']([^"']*)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    if (!(match[2] ?? "").split(/\s+/).includes(className)) continue;
    const body = new RegExp(`([\\s\\S]*?)<\\/${match[1]}>`, "i").exec(html.slice(re.lastIndex))?.[1] ?? "";
    return htmlToText(body);
  }
  return "";
}

function stripNameCredentials(value: string) {
  return value.replace(/,.*$/, "").trim();
}

function mergeLeaders(rows: readonly (ExtractedLeader | undefined)[]) {
  const merged = new Map<string, ExtractedLeader>();
  for (const row of rows) {
    if (row && !merged.has(row.normalizedName)) merged.set(row.normalizedName, row);
  }
  return [...merged.values()];
}

function extractContractLeaders(html: string, contract: LeadershipExtractionContract): ExtractedLeader[] {
  const cleaned = stripNonContent(html);
  if (contract === "tower-roster") {
    return mergeLeaders(classBlocks(cleaned, "people-teaser").map((block) => {
      const name = stripNameCredentials(classText(block, "people-teaser__name"));
      const titles = [...block.matchAll(/<span\b[^>]*\bclass=["'][^"']*people-teaser__meta[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)]
        .map((match) => htmlToText(match[1] ?? ""))
        .filter(Boolean);
      return asLeader(name, [...new Set(titles)].join(", "));
    }));
  }
  if (contract === "st-lukes-roster") {
    return mergeLeaders(classBlocks(cleaned, "card-text-overlay__item").map((block) => asLeader(
      stripNameCredentials(classText(block, "card-text-overlay__text")),
      classText(block, "tagline"),
    )));
  }
  if (contract === "virtua-roster") {
    return mergeLeaders(classBlocks(cleaned, "team-group__group-item").map((block) => asLeader(
      stripNameCredentials(classText(block, "team-group__item-name")),
      classText(block, "team-group__item-position"),
    )));
  }
  if (contract === "christianacare-roster") {
    return mergeLeaders(classBlocks(cleaned, "style-leadership").map((block) => asLeader(
      stripNameCredentials(classText(block, "cmp-pagecard__title_text")),
      classText(block, "cmp-pagecard__description"),
    )));
  }
  if (contract === "christianacare-profile") {
    const headings = [...cleaned.matchAll(/<h2\b[^>]*\bclass=["'][^"']*cmp-title__text[^"']*["'][^>]*>([\s\S]*?)<\/h2>/gi)];
    const heading = headings.find((match) => /randall\s+gaboriault/i.test(htmlToText(match[1] ?? "")));
    const following = heading ? cleaned.slice((heading.index ?? 0) + heading[0].length) : "";
    const name = stripNameCredentials(htmlToText(heading?.[1] ?? ""));
    const title = htmlToText(/<h6\b[^>]*\bclass=["'][^"']*cmp-title__text[^"']*["'][^>]*>([\s\S]*?)<\/h6>/i.exec(following)?.[1] ?? "");
    return mergeLeaders([asLeader(name, title)]);
  }
  const heading = /<h1\b[^>]*>([\s\S]*?luke\s+olenoski[\s\S]*?)<\/h1>/i.exec(cleaned);
  const following = heading ? cleaned.slice((heading.index ?? 0) + heading[0].length) : "";
  const name = stripNameCredentials(htmlToText(heading?.[1] ?? ""));
  const title = htmlToText(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(following)?.[1] ?? "");
  return mergeLeaders([asLeader(name, title)]);
}

export function extractLeaders(
  html: string,
  institutionAliases: readonly string[] = [],
  contract?: LeadershipExtractionContract,
  articleSourceContext = false,
): ExtractedLeader[] {
  const document = articleDocumentEvidence(html);
  if (contract) {
    const rows = extractContractLeaders(html, contract);
    return (articleSourceContext || document.explicitArticle) ? rows.map((row) => ({ ...row, articleEvidence: document.evidence })) : rows;
  }
  const article = extractArticleLeaders(html, institutionAliases);
  // Article headings/Person metadata do not by themselves link a role to the
  // target institution. Retain only the explicitly scoped article grammars.
  if (articleSourceContext || document.isArticle) return article;
  const jsonLd = extractJsonLdLeaders(html);
  const headings = extractHeadingLeaders(stripNonContent(html));
  const merged = new Map<string, ExtractedLeader>();
  for (const row of [...jsonLd, ...headings, ...article]) {
    const existing = merged.get(row.normalizedName);
    if (!existing) merged.set(row.normalizedName, row);
    else if (row.articleEvidence) {
      // Dedupe must not erase article provenance when a heading/Person record
      // happens to supply the same name on an otherwise undated page.
      merged.set(row.normalizedName, { ...existing, articleEvidence: row.articleEvidence });
    }
  }
  const rows = [...merged.values()];
  return (articleSourceContext || document.isArticle) ? rows.map((row) => ({ ...row, articleEvidence: document.evidence })) : rows;
}

export function normalizeLeadershipText(html: string) {
  return clipText(htmlToText(stripNonContent(html)));
}

function extractionStatus(
  normalizedText: string,
  extracted: readonly ExtractedLeader[],
  html: string,
  source: CoverageSource,
  previous?: readonly ExtractedLeader[],
): LeadershipExtractionStatus {
  // Some challenges contain only a vendor bootstrap script and no readable
  // text. Inspect its explicit script signature before classifying an empty page.
  const challengeBootstrap = /<script\b[^>]*\bsrc\s*=\s*["']\/_Incapsula_Resource(?:[?"'])/i.test(html);
  if (!extracted.length && (CHALLENGE_RE.test(normalizedText) || challengeBootstrap)) return "challenge";
  if (!normalizedText) return "empty-unverified";
  if (!extracted.length) return "unrecognized";
  // Re-fetching a historical (or undated) article cannot establish a current
  // roster. Preserve its claims/dates, but never infer arrivals or departures.
  if (extracted.some((row) => "articleEvidence" in row && row.articleEvidence)) return "partial";
  const contract = source.leadershipExtractionContract;
  if (contract) {
    const folded = decodeHtml(stripNonContent(html).replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .toLowerCase();
    const complete = contract === "christianacare-roster"
      ? extracted.length >= 5 && folded.includes("our leadership") && folded.includes("board of directors")
      : contract === "christianacare-profile"
        ? extracted.length === 1 && folded.includes("randall gaboriault")
        : contract === "mainline-profile"
          ? extracted.length === 1 && folded.includes("luke olenoski")
          : contract === "tower-roster"
            ? extracted.length >= 3 && folded.includes("tower health leadership")
            : contract === "st-lukes-roster"
              ? extracted.length >= 3 && folded.includes("executive leadership")
              : extracted.length >= 3 && folded.includes("senior leadership");
    if (!complete) return "partial";
    if (previous && previous.length >= 4 && extracted.length < Math.ceil(previous.length / 2)) return "partial";
  }
  return "complete";
}

/** Operator-facing reason for a fetched page that did not yield a usable roster. */
function incompleteExtractionError(status: LeadershipExtractionStatus) {
  if (status === "empty-unverified") {
    return "Page fetched, but no readable leadership content was found";
  }
  if (status === "unrecognized") {
    return "Page fetched, but no recognized leadership structure was found";
  }
  if (status === "partial") {
    return "Page fetched, but leadership extraction was incomplete";
  }
  return null;
}

function httpStatusFromError(error?: string | null) {
  const match = /\bHTTP\s+(\d{3})\b/i.exec(error ?? "");
  return match ? Number(match[1]) : undefined;
}

export function isEligibleLeadershipSource(source: CoverageSource) {
  if (!source.monitor || source.status !== "enabled") return false;
  if (source.kind.startsWith("linkedin")) return false;
  if (isLinkedInHost(source.host)) return false;
  const url = normalizeSourceUrl(source.url);
  if (!url || !url.startsWith("https://")) return false;
  try {
    if (isLinkedInHost(new URL(url).hostname)) return false;
  } catch {
    return false;
  }
  for (const alternateUrl of source.alternateUrls ?? []) {
    const normalizedAlternate = normalizeSourceUrl(alternateUrl);
    if (!normalizedAlternate || !normalizedAlternate.startsWith("https://")) return false;
    try {
      if (isLinkedInHost(new URL(normalizedAlternate).hostname)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function leadershipBackoffMs(
  state: LeadershipSnapshotState,
  attemptCount: number,
  successRefreshMs = LEADERSHIP_SUCCESS_REFRESH_MS,
) {
  if (state === "success" || state === "unchanged") return successRefreshMs;
  const safeCount = Math.max(1, Math.trunc(attemptCount) || 1);
  return Math.min(LEADERSHIP_FAILURE_MAX_MS, LEADERSHIP_FAILURE_BASE_MS * (2 ** (safeCount - 1)));
}

function refreshMs(source: CoverageSource) {
  return LEADERSHIP_CADENCE_MS[source.cadence] ?? LEADERSHIP_SUCCESS_REFRESH_MS;
}

export function isLeadershipSourceDue(
  source: CoverageSource,
  state: ScheduledLeadershipState | undefined,
  now: Date,
) {
  if (!isEligibleLeadershipSource(source)) return false;
  if (!state) return true;
  const next = Date.parse(state.nextAttemptAt);
  if (!Number.isFinite(next)) return true;
  return now.getTime() >= next;
}

function observationStatus(): "review" {
  return "review";
}

function nextSchedule(
  source: CoverageSource,
  snapshot: LeadershipSnapshot,
  previous: ScheduledLeadershipState | undefined,
  now: Date,
): ScheduledLeadershipState {
  const failed = snapshot.state === "failed"
    || snapshot.state === "blocked"
    || snapshot.state === "hostile"
    || snapshot.extractionStatus !== "complete";
  const consecutiveFailures = failed ? (previous?.consecutiveFailures ?? 0) + 1 : 0;
  const state: ScheduledLeadershipState["state"] = snapshot.state === "hostile"
    ? "hostile"
    : snapshot.state === "blocked"
      ? "blocked"
      : snapshot.extractionStatus !== "complete"
        ? "upstream-failed"
        : snapshot.state === "success"
          ? "healthy"
          : snapshot.state === "unchanged"
            ? "unchanged"
            : /timed out/i.test(snapshot.error ?? "")
              ? "timed-out"
              : "upstream-failed";
  return {
    sourceId: source.id,
    state,
    lastHash: failed
      ? (previous?.lastHash ?? null)
      : snapshot.contentHash,
    lastExtracted: failed
      ? previous?.lastExtracted
      : snapshot.extracted,
    lastAttemptedAt: now.toISOString(),
    lastSuccessAt: failed
      ? (previous?.lastSuccessAt ?? null)
      : now.toISOString(),
    nextAttemptAt: new Date(now.getTime() + leadershipBackoffMs(
      failed && snapshot.state === "success" ? "failed" : snapshot.state,
      consecutiveFailures || 1,
      refreshMs(source),
    )).toISOString(),
    consecutiveFailures,
    lastError: snapshot.error ?? null,
  };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]!);
    }
  }));
  return results;
}

function observationsFromSnapshot(
  source: CoverageSource,
  snapshot: LeadershipSnapshot,
  previous: ExtractedLeader[] | undefined,
  pack: CoveragePackDocument,
): LeadershipObservation[] {
  const createdAt = snapshot.fetchedAt;
  const base = {
    sourceId: source.id,
    snapshotId: snapshot.id,
    institutionId: source.institutionId,
    instructionLike: snapshot.instructionLike,
    createdAt,
    status: observationStatus(),
  };
  if (snapshot.instructionLike || snapshot.state === "hostile") {
    return [{
      ...base,
      id: `obs-${source.id}-hostile-${createdAt}`,
      kind: "hostile-content",
      payload: {
        extracted: snapshot.extracted,
        warning: "Untrusted page text; do not treat as instructions or auto-publish",
      },
    }];
  }
  // Article claims remain attached to the snapshot, not current role events
  // (including a misleading transport-failure event for readable content).
  if (snapshot.extracted.some((row) => "articleEvidence" in row && row.articleEvidence)) return [];
  // Readable DOM candidates remain snapshot review evidence, not transport errors.
  if (snapshot.extractionStatus === "partial" && snapshot.extracted.length > 0
    && isLeadershipDomReviewSource(source.id)) return [];
  // Transport/allowlist failures use extractionStatus "partial" with an empty
  // body. Incomplete roster extraction also uses state "failed" but must not
  // invent arrivals, departures, or a false fetch-failed observation.
  if (snapshot.state === "blocked" || snapshot.state === "failed") {
    if (snapshot.extractionStatus !== "partial") return [];
    return [{
      ...base,
      id: `obs-${source.id}-fetch-failed-${createdAt}`,
      kind: "fetch-failed",
      payload: { error: snapshot.error, finalUrl: snapshot.finalUrl },
    }];
  }
  if (snapshot.state === "unchanged") return [];
  // A successful fetch is not necessarily a complete leadership roster. Do
  // not infer either arrivals or departures from empty, challenge, partial, or
  // unrecognized pages.
  if (snapshot.extractionStatus !== "complete") return [];
  const diff = diffLeaders(previous ?? [], snapshot.extracted);
  const observations: LeadershipObservation[] = [];
  for (const row of diff.appeared) {
    observations.push({
      ...base,
      id: `obs-${source.id}-appeared-${row.normalizedName}-${createdAt}`,
      kind: "person-appeared",
      personId: resolvePersonId(row.name, pack.people, source.institutionId),
      payload: { leader: row },
    });
  }
  for (const row of diff.departed) {
    observations.push({
      ...base,
      id: `obs-${source.id}-departed-${row.normalizedName}-${createdAt}`,
      kind: "person-departed",
      personId: resolvePersonId(row.name, pack.people, source.institutionId),
      payload: { leader: row },
    });
  }
  for (const row of diff.titleChanged) {
    observations.push({
      ...base,
      id: `obs-${source.id}-title-${row.next.normalizedName}-${createdAt}`,
      kind: "title-changed",
      personId: resolvePersonId(row.next.name, pack.people, source.institutionId),
      payload: { previous: row.previous, next: row.next },
    });
  }
  return observations;
}

export type LeadershipMonitorOptions = {
  fetchImpl: typeof fetch;
  pack?: CoveragePackDocument;
  now?: Date;
  states?: ReadonlyMap<string, ScheduledLeadershipState>;
  candidateCap?: number;
  concurrency?: number;
  captureMarkupSourceIds?: ReadonlySet<string>;
  markupClock?: () => Date;
};

export async function monitorLeadershipSources(
  options: LeadershipMonitorOptions,
): Promise<LeadershipMonitorResult> {
  const pack = options.pack ?? coveragePack;
  const now = options.now ?? new Date();
  const requestedCap = Math.trunc(options.candidateCap ?? LEADERSHIP_CANDIDATE_CAP);
  const requestedConcurrency = Math.trunc(options.concurrency ?? LEADERSHIP_CONCURRENCY);
  const cap = Number.isFinite(requestedCap)
    ? Math.max(0, Math.min(LEADERSHIP_CANDIDATE_CAP, requestedCap))
    : LEADERSHIP_CANDIDATE_CAP;
  const concurrency = Number.isFinite(requestedConcurrency)
    ? Math.max(1, Math.min(LEADERSHIP_CONCURRENCY, requestedConcurrency))
    : LEADERSHIP_CONCURRENCY;
  const due = monitorableSources(pack)
    .filter((source) => isLeadershipSourceDue(source, options.states?.get(source.id), now))
    .slice(0, cap);

  const rows = await mapWithConcurrency(due, concurrency, async (source) => {
    const previous = options.states?.get(source.id);
    try {
      if (!isEligibleLeadershipSource(source)) {
        const snapshot: LeadershipSnapshot = {
          id: `snap-${source.id}-${now.toISOString()}`,
          sourceId: source.id,
          fetchedAt: now.toISOString(),
          finalUrl: source.url,
          contentHash: "",
          normalizedText: "",
          byteCount: 0,
          extracted: [],
          extractionStatus: "partial",
          state: "blocked",
          error: "Source is not eligible for fetch",
          instructionLike: false,
        };
        return { snapshot, previous, fetchedUrl: undefined };
      }
      const allowedHosts = hostsForSource(source);
      const candidateUrls = [source.url, ...(source.alternateUrls ?? [])];
      let lastSnapshot: LeadershipSnapshot | undefined;
      let lastFetchedUrl: string | undefined;
      let articleSnapshot: LeadershipSnapshot | undefined;
      for (const candidateUrl of candidateUrls) {
        try {
          const page = await fetchAllowlistedArticlePage({
            url: candidateUrl,
            fetchImpl: options.fetchImpl,
            allowedHosts,
            maxBytes: LEADERSHIP_MAX_BYTES,
            timeoutMs: LEADERSHIP_TIMEOUT_MS,
            maxRedirects: LEADERSHIP_MAX_REDIRECTS,
            scanMaxBytes: source.scanMaxBytes,
            retainSuffixBytes: source.retainSuffixBytes,
            retainMarkupBytes: options.captureMarkupSourceIds?.has(source.id)
              && MARKUP_CAPTURE_SOURCES[source.id] === source.url
              && markupCaptureWindow(now)
              && markupCaptureWindow(options.markupClock?.() ?? new Date()),
            markupClock: options.markupClock,
          });
          if (!page.ok) {
            const httpStatus = httpStatusFromError(page.error);
            const blocked = /allowlist|linkedin/i.test(page.error)
              || httpStatus === 401
              || httpStatus === 403;
            lastSnapshot = {
              id: `snap-${source.id}-${now.toISOString()}`,
              sourceId: source.id,
              fetchedAt: now.toISOString(),
              finalUrl: candidateUrl,
              contentHash: previous?.lastHash ?? "",
              normalizedText: "",
              byteCount: 0,
              extracted: [],
              extractionStatus: "partial",
              state: blocked ? "blocked" : "failed",
              error: clipError(page.error),
              httpStatus,
              instructionLike: false,
            };
            lastFetchedUrl = candidateUrl;
            continue;
          }
          const normalizedText = normalizeLeadershipText(page.body);
          const institution = pack.institutions.find((row) => row.id === source.institutionId);
          const domReview = isLeadershipDomReviewSource(source.id)
            ? previewLeadershipDom(source.id, page.body, normalizeSourceUrl(page.url) === normalizeSourceUrl(source.url) ? source.url : page.url) : null;
          const extracted = domReview ? domReview.candidates : extractLeaders(
            page.body,
            institution?.aliases ?? [],
            source.leadershipExtractionContract,
            // The trusted registry's newsroom primary is article context even
            // when the publisher omits semantic/structured article markers.
            source.kind === "newsroom-bio"
              && normalizeSourceUrl(candidateUrl) === normalizeSourceUrl(source.url),
          );
          const contentHash = await sha256Hex(source.leadershipExtractionContract
            ? JSON.stringify(extracted.map((row) => [row.normalizedName, row.normalizedTitle]))
            : normalizedText);
          // Repaired structure does not certify a roster or current affiliation.
          // No legacy regex fallback for scoped DOM sources, including wrong URLs.
          const fetchedExtraction = extractionStatus(normalizedText, extracted, page.body, source, previous?.lastExtracted);
          const extraction = domReview && fetchedExtraction === "complete"
            ? "partial" : fetchedExtraction;
          const instructionLike = looksInstructionLike(
            page.body,
            normalizedText,
            extracted.map((row) => `${row.name} ${row.title}`).join("\n"),
          );
          // A repeated incomplete page is still degraded. Treating it as merely
          // unchanged would let a persistent empty/unrecognized page recover the
          // source without ever proving a usable roster. Continue to an explicit
          // alternate only when this page is incomplete.
          const unchanged = extraction === "complete"
            && Boolean(previous?.lastHash && previous.lastHash === contentHash);
          const hostile = instructionLike || extraction === "challenge";
          const incompleteError = domReview && extracted.length
            ? "DOM parser candidates retained for review; current affiliation and roster qualification are unverified"
            : extracted.some((row) => "articleEvidence" in row && row.articleEvidence)
            ? "Article leadership claims retained for review; current affiliation is unverified"
            : incompleteExtractionError(extraction);
          const snapshot: LeadershipSnapshot = {
            id: `snap-${source.id}-${now.toISOString()}`,
            sourceId: source.id,
            fetchedAt: now.toISOString(),
            finalUrl: page.url,
            contentHash,
            normalizedText,
            byteCount: new TextEncoder().encode(page.body).byteLength,
            extracted,
            extractionStatus: extraction,
            // Fetch succeeded, but an incomplete roster is still a degraded source
            // for scheduling and operator alerts—never a healthy success.
            state: hostile
              ? "hostile"
              : unchanged
                ? "unchanged"
                : extraction === "complete"
                  ? "success"
                  : "failed",
            error: instructionLike
              ? "Instruction-like text in untrusted page"
              : extraction === "challenge"
                ? "Challenge-like page in untrusted source"
                : incompleteError,
            instructionLike: instructionLike || extraction === "challenge",
          };
          const capture = await makeMarkupCapture(source.id, source.url, candidateUrl, page);
          if (capture) snapshot.markupCapture = capture;
          lastSnapshot = snapshot;
          lastFetchedUrl = page.url;
          if (snapshot.state === "failed" && snapshot.extracted.some((row) => "articleEvidence" in row && row.articleEvidence)) {
            articleSnapshot ??= snapshot;
          }
          if (snapshot.state !== "failed") {
            return { snapshot, previous, fetchedUrl: page.url };
          }
        } catch (error) {
          lastSnapshot = {
            id: `snap-${source.id}-${now.toISOString()}`,
            sourceId: source.id,
            fetchedAt: now.toISOString(),
            finalUrl: candidateUrl,
            contentHash: previous?.lastHash ?? "",
            normalizedText: "",
            byteCount: 0,
            extracted: [],
            extractionStatus: "partial",
            state: "failed",
            error: clipError(error instanceof Error ? error.message : "Leadership source failed"),
            instructionLike: false,
          };
          lastFetchedUrl = candidateUrl;
        }
      }
      // A later empty/failed alternate must not discard the primary article's
      // dated claims. A usable complete alternate still wins above; this retained
      // snapshot remains partial and cannot establish current affiliation.
      if (articleSnapshot) return { snapshot: articleSnapshot, previous, fetchedUrl: articleSnapshot.finalUrl };
      if (lastSnapshot) return { snapshot: lastSnapshot, previous, fetchedUrl: lastFetchedUrl };
      throw new Error("Leadership source failed");
    } catch (error) {
      const snapshot: LeadershipSnapshot = {
        id: `snap-${source.id}-${now.toISOString()}`,
        sourceId: source.id,
        fetchedAt: now.toISOString(),
        finalUrl: source.url,
        contentHash: previous?.lastHash ?? "",
        normalizedText: "",
        byteCount: 0,
        extracted: [],
        extractionStatus: "partial",
        state: "failed",
        error: clipError(error instanceof Error ? error.message : "Leadership source failed"),
        instructionLike: false,
      };
      return { snapshot, previous, fetchedUrl: source.url };
    }
  });

  const snapshots: LeadershipSnapshot[] = [];
  const observations: LeadershipObservation[] = [];
  const schedule: ScheduledLeadershipState[] = [];
  const fetchedUrls: string[] = [];

  for (const row of rows) {
    snapshots.push(row.snapshot);
    if (row.fetchedUrl) fetchedUrls.push(row.fetchedUrl);
    observations.push(...observationsFromSnapshot(
      due.find((source) => source.id === row.snapshot.sourceId)!,
      row.snapshot,
      row.previous?.lastExtracted,
      pack,
    ));
    schedule.push(nextSchedule(
      due.find((source) => source.id === row.snapshot.sourceId)!,
      row.snapshot,
      row.previous,
      now,
    ));
  }

  return { snapshots, observations, schedule, fetchedUrls: [...new Set(fetchedUrls)] };
}
