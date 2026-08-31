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
const PERSON_NAME_RE = /^[a-z][a-z.'-]+(?: [a-z][a-z.'-]+){0,5}$/i;
const CHALLENGE_RE = /\b(?:access denied|captcha|checking your browser|cloudflare|enable javascript|just a moment|robot|unusual traffic|verify you are human)\b/i;

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
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(html))) {
    const name = htmlToText(match[2] ?? "");
    const following = html.slice(match.index + match[0].length, match.index + match[0].length + 500);
    const titleMatch = /<(?:p|div|span|dd|h[4-6])\b[^>]*>([\s\S]*?)<\/(?:p|div|span|dd|h[4-6])>/i.exec(following);
    const title = htmlToText(titleMatch?.[1] ?? following.split(/<h[1-4]\b/i)[0] ?? "");
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

export function extractLeaders(html: string): ExtractedLeader[] {
  const jsonLd = extractJsonLdLeaders(html);
  const headings = extractHeadingLeaders(stripNonContent(html));
  const merged = new Map<string, ExtractedLeader>();
  for (const row of [...jsonLd, ...headings]) {
    if (!merged.has(row.normalizedName)) merged.set(row.normalizedName, row);
  }
  return [...merged.values()];
}

export function normalizeLeadershipText(html: string) {
  return clipText(htmlToText(stripNonContent(html)));
}

function extractionStatus(normalizedText: string, extracted: readonly ExtractedLeader[]): LeadershipExtractionStatus {
  if (!normalizedText) return "empty-unverified";
  if (!extracted.length && CHALLENGE_RE.test(normalizedText)) return "challenge";
  if (!extracted.length) return "unrecognized";
  return "complete";
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
  if (snapshot.state === "blocked" || snapshot.state === "failed") {
    return [{
      ...base,
      id: `obs-${source.id}-fetch-failed-${createdAt}`,
      kind: "fetch-failed",
      payload: { error: snapshot.error, finalUrl: snapshot.finalUrl },
    }];
  }
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
      const page = await fetchAllowlistedArticlePage({
        url: source.url,
        fetchImpl: options.fetchImpl,
        allowedHosts: hostsForSource(source),
        maxBytes: LEADERSHIP_MAX_BYTES,
        timeoutMs: LEADERSHIP_TIMEOUT_MS,
        maxRedirects: LEADERSHIP_MAX_REDIRECTS,
      });
      if (!page.ok) {
        const blocked = /allowlist|linkedin/i.test(page.error);
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
          state: blocked ? "blocked" : "failed",
          error: clipError(page.error),
          httpStatus: httpStatusFromError(page.error),
          instructionLike: false,
        };
        return { snapshot, previous, fetchedUrl: source.url };
      }
      const normalizedText = normalizeLeadershipText(page.body);
      const contentHash = await sha256Hex(normalizedText);
      const extracted = extractLeaders(page.body);
      const extraction = extractionStatus(normalizedText, extracted);
      const instructionLike = looksInstructionLike(
        page.body,
        normalizedText,
        extracted.map((row) => `${row.name} ${row.title}`).join("\n"),
      );
      const unchanged = Boolean(previous?.lastHash && previous.lastHash === contentHash);
      const hostile = instructionLike || extraction === "challenge";
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
        state: hostile ? "hostile" : unchanged ? "unchanged" : "success",
        error: instructionLike
          ? "Instruction-like text in untrusted page"
          : extraction === "challenge" ? "Challenge-like page in untrusted source" : null,
        instructionLike: instructionLike || extraction === "challenge",
      };
      return { snapshot, previous, fetchedUrl: page.url };
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
