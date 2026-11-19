import {
  publishedEventSlugs,
  publishedHead,
  publishedNewsSlugs,
  publishedSlugRedirects,
  publishedVoiceSlugs,
} from "./worker-published.js";
import { runAutomation } from "./src/ingest/automation.ts";
import { cleanupEmailDiscoveries } from "./src/ingest/email.ts";
import { handleCloudflareInboundEmail, resolvePendingEmailAuthentication } from "./src/ingest/email-auth.ts";
import { handleReviewApi, isReviewApiPath } from "./src/ingest/review-api.ts";
import { policyBaselineView } from "./src/ingest/policy-pdf.ts";
import { handleWatchRead, isWatchReadPath } from "./src/ingest/watch-api.ts";
import { handleRepresentativeRead } from "./src/ingest/representative-api.ts";
import { resolveRepresentativeSourcePolicy } from "./src/ingest/representative-runtime.ts";
import { handleEventCalendar } from "./src/ingest/event-calendar.ts";
import { WATCH_CRON, watchSchedulePhase, runScheduledWatchCollection, runScheduledWatchPublication } from "./src/ingest/watch-scheduled.ts";
import { handleWatchUpdatesRead } from "./src/ingest/watch-updates-api.ts";
import { cleanupSocialEvidencePackets, handleSocialCollectorRuns, handleSocialEvidence, handleSocialManifest, isSocialCollectorRunsPath, isSocialEvidencePath, isSocialManifestPath } from "./src/ingest/social-evidence.ts";
import { handleOpsRequest, isOpsPath } from "./src/ingest/ops-access.ts";
import { FeedDocument } from "./src/ingest/feed-contract.ts";
import { feedXml, mergePublishedContent, mergedFeed, sitemapXml } from "./src/ingest/public-feed.ts";
import {
  cleanupNewsArticleExtractions,
  findPublishedContent,
  findPublishedSlugAlias,
  readPublicationTombstones,
  readPublishedContent,
} from "./src/ingest/persistence.ts";
import { loadEntities } from "./src/content/store.ts";
import { llmsTxt, resolvePublicOrigin, robotsTxt } from "./src/lib/canonical.ts";
import { decorateHtml, decorateWatchHtml, watchPrimaryNoscript } from "./src/lib/crawler-html.ts";
import { isWatchPagePath, readWatchPage } from "./src/lib/watch-page.ts";
import { publicFeaturesFromEnv } from "./src/lib/public-features.ts";
import { decodedPublicPath, retiredEditorialRoute } from "./src/lib/editorial-retirement.ts";
import { applySecurityHeaders, asHeadResponse, canonicalHostRedirect, handlePublicHealth, logOps } from "./src/lib/ops.ts";
import { dispatchOperationalAlert, dispatchOperationalDigest, dispatchOperationalRecovery, interruptOperationalAlertRecovery, recordOperationalAlert, resolveOperationalAlertWithTransition } from "./src/lib/alerts.ts";
import { conditionStateForSourceState, SOURCE_FRESHNESS_SLO_MS } from "./src/lib/operational-status.ts";
import { handleDiscoveryPilot } from "./src/ingest/discovery-pilot.ts";
import { handleDiscoveryPilotPage } from "./src/ingest/discovery-pilot-page.ts";
import { handleDirectoryRoutes } from "./src/ingest/discovery-directory-runtime.ts";

const PUBLIC_MACHINE_PATHS = new Set([
  "/feed.json",
  "/api/content",
  "/feed.xml",
  "/sitemap.xml",
  "/robots.txt",
  "/llms.txt",
]);

// One Worker handles both lanes. The daily trigger is intentionally a
// separate cron expression so the catch-up pass has its own scheduled
// invocation and never depends on an in-memory timer.
const DAILY_DEEP_SCAN_CRON = "17 3 * * *";

function notFoundHeaders() {
  return {
    "content-type": "text/html; charset=utf-8",
    "x-robots-tag": "noindex",
    "cache-control": "no-store",
  };
}

async function notFound(env, request, path, origin, nonce) {
  if (env.DIRECTORY_PUBLIC_ENABLED === "true") {
    const { directoryNotFound } = await import("./src/ingest/public-directory.ts");
    return directoryNotFound(origin, nonce, request.method === "HEAD");
  }
  const url = new URL(request.url);
  const asset = await env.ASSETS.fetch(new URL("/index.html", url.origin));
  const html = decorateHtml({
    html: await asset.text(),
    path,
    origin,
    nonce,
    notFound: true,
    publicFeatures: publicFeaturesFromEnv(env),
  });
  return new Response(html, {
    status: 404,
    headers: notFoundHeaders(),
  });
}

const newsSlugs = new Set(publishedNewsSlugs);
const eventSlugs = new Set(publishedEventSlugs);
const voiceSlugs = new Set(publishedVoiceSlugs);
const SPA_PATH = /^\/(?:(?:news|events|voices)(?:\/[^/]+)?|policy|lab(?:\/(?:briefing|systems|horizon|calendar))?)?\/?$/;

function stripSlash(path) {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function permalinkRedirect(path) {
  const p = stripSlash(path);
  const match = /^\/(news|events|voices)\/([^/]+)$/.exec(p);
  if (!match) return null;
  const dest = publishedSlugRedirects?.[match[2]];
  if (!dest?.slug) return null;
  const section = dest.kind === "event" ? "events" : dest.kind === "voice" ? "voices" : "news";
  if (dest.slug === match[2]) return null;
  return `/${section}/${dest.slug}`;
}

/** Ops: migration 0007 content_slug_aliases. Static redirects stay first; D1 aliases 301 after. */
async function lookupPublishedSlugAlias(env, path) {
  const match = /^\/(news|events|voices)\/([^/]+)$/.exec(stripSlash(path));
  if (!match) return null;
  try {
    const dest = await findPublishedSlugAlias(env.VALLEY_DESK_DB, match[1] === "events" ? "event" : match[1] === "voices" ? "voice" : "news", match[2]);
    if (!dest?.slug || dest.slug === match[2]) return null;
    const section = dest.kind === "event" ? "events" : dest.kind === "voice" ? "voices" : "news";
    return `/${section}/${dest.slug}`;
  } catch (error) {
    console.error("published-slug-alias-fallback", JSON.stringify({
      message: error instanceof Error ? error.message : "D1 slug alias unavailable",
    }));
    return null;
  }
}

/** false = unpublished or unknown item permalink. null = not an item permalink. */
function publishedItemPath(path) {
  const p = stripSlash(path);
  const news = /^\/news\/([^/]+)$/.exec(p);
  if (news) return newsSlugs.has(news[1]);
  const events = /^\/events\/([^/]+)$/.exec(p);
  if (events) return eventSlugs.has(events[1]);
  const voices = /^\/voices\/([^/]+)$/.exec(p);
  if (voices) return voiceSlugs.has(voices[1]);
  return null;
}

function sectionKind(path) {
  if (path.startsWith("/events/")) return "event";
  if (path.startsWith("/voices/")) return "voice";
  if (path.startsWith("/news/")) return "news";
  return undefined;
}

function itemMatchesSection(item, section) {
  if (section === "event") return item.kind === "event";
  if (section === "voice") return item.kind === "voice";
  return section === "news" && new Set(["news", "policy", "ai", "interview"]).has(item.kind);
}

async function dynamicOverlay(env) {
  try {
    const [items, withdrawnIds] = await Promise.all([
      readPublishedContent(env.VALLEY_DESK_DB),
      readPublicationTombstones(env.VALLEY_DESK_DB),
    ]);
    return { items, withdrawnIds };
  } catch (error) {
    logOps("published-content-fallback", {
      message: error instanceof Error ? error.message : "D1 public content unavailable",
    }, "error");
    return { items: [], withdrawnIds: [] };
  }
}

async function staticFeed(env, request) {
  const url = new URL(request.url);
  const response = await env.ASSETS.fetch(new URL("/feed.json", url.origin));
  return FeedDocument.parse(await response.json());
}

const PUBLIC_HEADERS = {
  "cache-control": "public, max-age=60",
  "cdn-cache-control": "public, max-age=300",
  "access-control-allow-origin": "*",
};

function compactAutomation(result) {
  if (!result || typeof result !== "object") return {};
  const {
    notes,
    ...rest
  } = result;
  return {
    ...rest,
    sourceCount: Array.isArray(notes?.sources) ? notes.sources.length : undefined,
    rssCount: notes?.rss,
    eventCount: notes?.events,
  };
}

function safeAlertError(error) {
  const raw = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : error && typeof error === "object" && typeof error.message === "string"
        ? error.message
        : "Unknown automation failure";
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\bauthorization\b\s*[:=]\s*bearer\s+\S+/gi, "authorization=[redacted]")
    .replace(/\b(bearer|authorization|token|secret|password|api[-_]?key)\b\s*[:=]?\s*\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240) || "Unknown automation failure";
}

function safeAlertDetails(error, context = {}) {
  const candidate = error && typeof error === "object" ? error : {};
  const errorClass = typeof context.errorClass === "string"
    ? context.errorClass
    : typeof candidate.name === "string"
      ? candidate.name
      : typeof error === "string" ? "string" : "unknown";
  const httpStatus = Number.isInteger(context.httpStatus)
    ? context.httpStatus
    : Number.isInteger(candidate.httpStatus) ? candidate.httpStatus : undefined;
  const nextRetryAt = typeof context.nextRetryAt === "string"
    ? context.nextRetryAt
    : typeof candidate.nextAttemptAt === "string" ? candidate.nextAttemptAt : undefined;
  return {
    ...(typeof context.stage === "string" ? { stage: context.stage } : {}),
    ...(typeof context.sourceId === "string" ? { sourceId: context.sourceId } : {}),
    errorClass,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(nextRetryAt ? { nextRetryAt } : {}),
    reason: safeAlertError(error),
  };
}

function sourceInstitutionIds(source) {
  const values = [];
  if (typeof source?.institutionId === "string") values.push(source.institutionId);
  if (Array.isArray(source?.institutionIds)) values.push(...source.institutionIds);
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.slice(0, 120)))].slice(0, 8);
}

function sourceAlertScope(source, sourceId) {
  const institutionIds = sourceInstitutionIds(source);
  const subsystem = typeof source?.type === "string" && source.type.trim() ? source.type : "automation";
  const institutionId = institutionIds.length === 1 ? institutionIds[0] : undefined;
  return {
    ...(institutionId ? { institutionId } : {}),
    subsystem,
    groupKey: `valley-desk:${subsystem}:${institutionId ?? sourceId}`.slice(0, 240),
  };
}

export async function sendAutomationAlerts(env, result, now = new Date()) {
  // Alert delivery is best-effort and must never turn a successful content
  // run into a false automation failure. Durable state is still written when
  // the send binding is unavailable, and each helper isolates its own D1 or
  // provider error.
  const completedAt = Date.parse(result?.finishedAt ?? "");
  const recoveryTime = Number.isFinite(completedAt) && completedAt <= now.getTime()
    ? new Date(completedAt) : now;
  // Completion time is stable across replay even for legacy results without runId.
  const observationId = typeof result?.runId === "string" && result.runId
    ? result.runId : recoveryTime.toISOString();
  const dispatch = async (input) => {
    try {
      return await dispatchOperationalAlert(env.VALLEY_DESK_DB, env.NOTIFY_OPS, { ...input, now: recoveryTime, observationId });
    } catch (error) {
      logOps("ops-alert", {
        outcome: "record-failed",
        fingerprint: input.fingerprint,
        message: safeAlertError(error),
      }, "warn");
      return undefined;
    }
  };
  const recordWarning = async (input) => {
    try {
      return await recordOperationalAlert(env.VALLEY_DESK_DB, { ...input, now: recoveryTime, notify: false, observationId });
    } catch (error) {
      logOps("ops-alert", {
        outcome: "record-failed",
        fingerprint: input.fingerprint,
        message: safeAlertError(error),
      }, "warn");
      return undefined;
    }
  };
  const recoveredFingerprints = new Set();
  const recover = async (fingerprint, requiredSuccesses = 2, details = {}) => {
    if (recoveredFingerprints.has(fingerprint)) return undefined;
    recoveredFingerprints.add(fingerprint);
    try {
      // A declared completion clock must be valid; run identity cannot repair it.
      if (result?.finishedAt != null && (!Number.isFinite(completedAt) || completedAt > now.getTime())) return undefined;
      const hasSourceTimestamp = details.observedAt != null;
      const sourceObservedAt = Date.parse(details.observedAt ?? "");
      const validSourceTimestamp = Number.isFinite(sourceObservedAt) && sourceObservedAt <= recoveryTime.getTime();
      // Explicit invalid/future evidence is not replaced by completion time.
      if (hasSourceTimestamp && !validSourceTimestamp) return undefined;
      const stableCompletion = Number.isFinite(completedAt) && completedAt <= now.getTime();
      const stableRunId = typeof result?.runId === "string" && result.runId.trim().length > 0;
      if (!stableRunId && !stableCompletion && !validSourceTimestamp) return undefined;
      const observedAt = validSourceTimestamp
        ? new Date(sourceObservedAt).toISOString() : recoveryTime.toISOString();
      const recoveryObservationId = stableRunId || stableCompletion ? observationId : observedAt;
      const recovery = await resolveOperationalAlertWithTransition(
        env.VALLEY_DESK_DB,
        fingerprint,
        new Date(observedAt),
        requiredSuccesses,
        { ...details, outcome: "healthy", observedAt, observationId: recoveryObservationId },
      );
      if (recovery.resolved && recovery.row) {
        await dispatchOperationalRecovery(env.VALLEY_DESK_DB, env.NOTIFY_OPS, recovery.row);
      }
      return recovery.row;
    } catch (error) {
      logOps("ops-alert", {
        outcome: "recovery-record-failed",
        fingerprint,
        message: safeAlertError(error),
      }, "warn");
      return undefined;
    }
  };
  const interrupt = async (fingerprint, conditionState, details) => {
    try {
      await interruptOperationalAlertRecovery(env.VALLEY_DESK_DB, fingerprint, conditionState, recoveryTime, details);
    } catch (error) {
      logOps("ops-alert", { outcome: "recovery-interruption-failed", fingerprint, message: safeAlertError(error) }, "warn");
    }
  };
  if (result?.skipped) {
    await dispatch({
      fingerprint: "valley-desk:automation-lock-busy",
      event: "automation-lock-busy",
      severity: "warning",
      conditionState: "degraded",
      subsystem: "automation",
      groupKey: "valley-desk:automation:lock",
      threshold: 3,
      now,
      details: { reason: "automation-already-running" },
    });
    return;
  }
  await recover("valley-desk:automation-lock-busy", 2);
  const sourceNotes = Array.isArray(result?.notes?.sources) ? result.notes.sources : [];
  const sourceCoverageLost = (source) => {
    const institutionIds = sourceInstitutionIds(source);
    if (institutionIds.length === 0) return false;
    const peers = sourceNotes.filter((candidate) => (
      candidate && candidate.type === source.type
      && candidate.state !== "disabled"
      && candidate.state !== "misconfigured"
      && sourceInstitutionIds(candidate).some((institutionId) => institutionIds.includes(institutionId))
    ));
    const hasFreshCoverage = (candidate) => {
      if (candidate.state === "healthy" || candidate.state === "healthy-empty") return true;
      const lastSuccess = Date.parse(candidate.lastSuccessAt ?? "");
      const age = recoveryTime.getTime() - lastSuccess;
      return Number.isFinite(lastSuccess) && age >= 0 && age <= SOURCE_FRESHNESS_SLO_MS;
    };
    return peers.length > 0 && peers.every((candidate) => (
      !hasFreshCoverage(candidate)
    ));
  };
  for (const source of sourceNotes) {
    if (!source) continue;
    const sourceId = typeof source.id === "string" ? source.id.slice(0, 100) : "unknown";
    const fingerprint = `valley-desk:source:${sourceId}`;
    if (source.state === "disabled") {
      await recover(fingerprint, 1);
      continue;
    }
    if (source.state === "misconfigured") {
      // Missing configuration is not a successful source observation.
      // Preserve an existing outage and interrupt its recovery streak.
      await interrupt(fingerprint, "degraded", {
        sourceId, state: source.state, reason: "source-configuration-unavailable",
        affectedCoverage: "collection-unavailable", countSemantics: "condition-evaluations",
      });
      continue;
    }
    const freshnessDetails = {
      observedAt: source.checkedAt ?? undefined,
      primaryState: source.primaryState ?? "unknown",
      primaryLastSuccessAt: source.primaryLastSuccessAt ?? null,
      fallbackLastSuccessAt: source.fallbackLastSuccessAt ?? null,
      servingPath: source.servingPath ?? "unknown",
      countSemantics: "condition-evaluations",
    };
    const currentFallback = Boolean(source.fallbackUrl) && source.servingPath !== "unavailable";
    if (source.state === "backoff") {
      logOps("source-backoff", {
        sourceId,
        nextRetryAt: source.nextAttemptAt,
        failures: source.consecutiveFailures,
      });
      if (currentFallback) {
        const fallbackFingerprint = `valley-desk:source-fallback:${sourceId}`;
        await recordWarning({
          fingerprint: fallbackFingerprint,
          event: "source-fallback-active",
          severity: "warning",
          conditionState: "degraded",
          threshold: 1,
          now,
          ...sourceAlertScope(source, sourceId),
          details: {
            sourceId,
            state: source.state,
            fallbackActive: currentFallback,
            currentFallback,
            primaryBackoff: true,
            ...freshnessDetails,
            itemCount: source.itemCount,
            lastSuccessAt: source.lastSuccessAt ?? null,
            nextRetryAt: source.nextAttemptAt ?? null,
            affectedCoverage: currentFallback ? "fallback-serving-during-backoff" : "fallback-unavailable-during-backoff",
          },
        });
        // A pre-0022 source alert may have been critical before the source
        // was classified as public-blocked/backoff. Fallback coverage removes
        // that critical condition, but the fallback warning remains active.
        await recover(fingerprint, 2, { ...freshnessDetails, affectedCoverage: "fallback-serving-during-backoff" });
      } else if (source.servingPath === "unavailable") {
        // No usable snapshot interrupts both availability and primary recovery.
        // Update existing incidents only; a quiet cooldown does not create one.
        const unavailableDetails = {
          sourceId, state: source.state, ...freshnessDetails,
          currentFallback: false, nextRetryAt: source.nextAttemptAt ?? null,
          affectedCoverage: "fallback-unavailable-during-backoff",
        };
        await interrupt(fingerprint, "backoff", unavailableDetails);
        await interrupt(`valley-desk:source-fallback:${sourceId}`, "backoff", unavailableDetails);
      }
      continue;
    }
    if (source.state === "healthy" || source.state === "healthy-empty") {
      const fallbackFingerprint = `valley-desk:source-fallback:${sourceId}`;
      if (source.fallbackUrl) {
        const lastSuccessMs = Date.parse(source.lastSuccessAt ?? "");
        await recordWarning({
          fingerprint: fallbackFingerprint,
          event: "source-fallback-active",
          severity: "warning",
          conditionState: "degraded",
          threshold: 1,
          now,
          ...sourceAlertScope(source, sourceId),
          details: {
            sourceId,
            state: source.state,
            fallbackActive: true,
            ...freshnessDetails,
            itemCount: source.itemCount,
            lastSuccessAt: source.lastSuccessAt ?? null,
            collectionAgeMs: Number.isFinite(lastSuccessMs) ? Math.max(0, recoveryTime.getTime() - lastSuccessMs) : null,
            currentFallback: true,
            nextRetryAt: source.nextAttemptAt ?? null,
            affectedCoverage: "fallback-serving",
          },
        });
      } else {
        await recover(fallbackFingerprint, 2, freshnessDetails);
      }
      await recover(fingerprint, 2, {
        ...freshnessDetails,
        affectedCoverage: source.fallbackUrl ? "fallback-serving" : "primary-serving",
      });
      continue;
    }
    await interrupt(`valley-desk:source-fallback:${sourceId}`, conditionStateForSourceState(source.state), {
      sourceId, state: source.state, ...freshnessDetails,
      currentFallback: false, nextRetryAt: source.nextAttemptAt ?? null,
      affectedCoverage: "all-serving-paths-unavailable",
    });
    const lastSuccessMs = Date.parse(source.lastSuccessAt ?? "");
    const coverageLost = sourceCoverageLost(source);
    const alert = {
      fingerprint,
      event: "source-degraded",
      severity: coverageLost && !source.fallbackUrl ? "critical" : "warning",
      conditionState: conditionStateForSourceState(source.state, Boolean(source.fallbackUrl)),
      threshold: coverageLost && !source.fallbackUrl ? 1 : 3,
      now,
      ...sourceAlertScope(source, sourceId),
      details: {
        sourceId,
        state: source.state,
        failures: source.consecutiveFailures,
        coverageLost,
        affectedCoverage: coverageLost ? "all-source-peers" : "remaining-source-peers",
        lastSuccessAt: source.lastSuccessAt ?? null,
        failureAgeMs: Number.isFinite(lastSuccessMs) ? Math.max(0, recoveryTime.getTime() - lastSuccessMs) : null,
        currentFallback,
        ...freshnessDetails,
        nextRetryAt: source.nextAttemptAt ?? null,
        // URLs are stripped from alert details; keep a non-sensitive fallback signal.
        hasFallback: Boolean(source.fallbackUrl),
        ...safeAlertDetails(source.error ?? source.state, {
          stage: "source-health",
          sourceId,
          httpStatus: source.httpStatus,
          nextRetryAt: source.nextAttemptAt,
        }),
      },
    };
    if (alert.severity === "critical") await dispatch(alert);
    else await recordWarning(alert);
  }

  const leadership = result?.leadership;
  if (leadership) {
    const runtimeCoverage = Array.isArray(leadership.runtimeCoverage) ? leadership.runtimeCoverage : [];
    const activeCoverage = runtimeCoverage.filter((row) => row?.configuredStatus === "active");
    const runtimeCoverageAvailable = activeCoverage.length > 0;
    const runtimeCoverageLost = activeCoverage.filter((row) => row.coverageLost);
    const runtimeDegraded = activeCoverage.filter((row) => row.state !== "healthy");
    const stageFailed = leadership.outcome === "failed";
    const legacyCoverageLost = !runtimeCoverageAvailable
      && Number(leadership.failed ?? 0) > 0
      && Number(leadership.failed) >= Number(leadership.coverage?.length ?? 1);
    const currentFailures = Array.isArray(leadership.failureDetails) ? leadership.failureDetails : [];
    const issues = new Map();
    const issueClass = (failure, reason) => {
      const http = Number.isInteger(failure?.httpStatus) ? failure.httpStatus : Number(/\bHTTP (\d{3})\b/.exec(reason ?? "")?.[1]);
      if (http >= 100 && http <= 599) return `http-${http}`;
      const reported = failure?.errorClass;
      if (["empty-unverified", "unrecognized", "partial", "challenge", "hostile-content", "timeout", "blocked"].includes(reported)) return reported;
      if (/no readable leadership/.test(reason ?? "")) return "empty-unverified";
      if (/no recognized leadership/.test(reason ?? "")) return "unrecognized";
      if (/extraction was incomplete/.test(reason ?? "")) return "partial";
      return "no-usable-observation";
    };
    for (const row of activeCoverage) {
      for (const source of Array.isArray(row.sourceStates) ? row.sourceStates : []) {
        if (source.state === "healthy" && !row.coverageLost) continue;
        const failure = currentFailures.find((entry) => entry.sourceId === source.sourceId && (!entry.institutionId || entry.institutionId === row.institutionId));
        issues.set(source.sourceId, {
          institutionId: row.institutionId, sourceId: source.sourceId, state: source.state,
          errorClass: issueClass(failure, source.reason), failures: source.consecutiveFailures,
          nextRetryAt: source.nextRetryAt,
        });
      }
    }
    for (const failure of currentFailures) {
      if (issues.has(failure.sourceId)) continue;
      issues.set(failure.sourceId, {
        institutionId: failure.institutionId ?? null, sourceId: failure.sourceId,
        state: failure.httpStatus === 401 || failure.httpStatus === 403 ? "blocked" : "failed",
        errorClass: issueClass(failure, failure.reason), nextRetryAt: failure.nextRetryAt ?? null,
      });
    }
    const sourceIssues = [...issues.values()];
    // A quiet backoff pass is not a successful fetch or a recovery. Persistent
    // losses remain visible even when no source is currently due.
    const canRecover = leadership.outcome === "ok" && Number(leadership.failed ?? 0) === 0
      && Number(leadership.backoff ?? 0) === 0 && runtimeCoverageAvailable
      && runtimeCoverageLost.length === 0 && runtimeDegraded.length === 0
      && sourceIssues.length === 0;
    if (canRecover) {
      await recover("valley-desk:leadership-monitor", 2, {
        fetched: Number(leadership.fetched ?? 0), failed: 0, backoff: 0, coverageLost: 0,
      });
    } else {
      const critical = stageFailed || legacyCoverageLost || runtimeCoverageLost.length > 0;
      const severity = critical ? "critical" : "warning";
      const scopes = new Set([
        ...runtimeCoverageLost.map((row) => row.institutionId),
        ...sourceIssues.map((issue) => issue.institutionId),
      ].filter(Boolean));
      // Attribute a single institution only when every known issue shares it.
      const institutionId = scopes.size === 1 && sourceIssues.every((issue) => issue.institutionId === [...scopes][0])
        ? [...scopes][0] : undefined;
      const affected = runtimeCoverageLost.length ? runtimeCoverageLost : runtimeDegraded;
      const failureSummary = currentFailures.slice(0, 4)
        .map((failure) => `${failure.sourceId ?? "source"}: ${safeAlertError(failure.reason ?? failure.errorClass)}`)
        .join(" | ").slice(0, 240);
      const evidence = {};
      let included = 0;
      for (const issue of sourceIssues.slice(0, 6)) {
        const encoded = JSON.stringify(issue);
        // Alert scalars are capped at240chars; never store truncated JSON.
        if (encoded.length <= 240) evidence[`sourceIssue${++included}`] = encoded;
      }
      const alert = {
        fingerprint: "valley-desk:leadership-monitor", event: "leadership-monitor-failed",
        severity, conditionState: critical
          ? runtimeCoverageLost.some((row) => row.state === "blocked") ? "blocked"
            : runtimeCoverageLost.length > 0 && runtimeCoverageLost.every((row) => row.state === "backoff") ? "backoff" : "failed"
          : "degraded",
        threshold: critical ? 1 : 2, now, institutionId: institutionId ?? null,
        subsystem: "leadership", groupKey: institutionId ? `valley-desk:leadership:${institutionId}` : "valley-desk:leadership:monitor",
        details: {
          outcome: leadership.outcome, fetched: Number(leadership.fetched ?? 0), failed: Number(leadership.failed ?? 0),
          backoff: Number(leadership.backoff ?? 0), coverageLostCount: runtimeCoverageLost.length,
          sourceIssueCount: sourceIssues.length, sourceIssuesOmitted: sourceIssues.length - included,
          countSemantics: "condition-evaluations",
          ...(affected.length ? { affectedInstitutions: affected.map((row) => row.shortName ?? row.institutionId).join(", ") } : {}),
          affectedCoverage: runtimeCoverageLost.length ? "institution-coverage-lost" : runtimeCoverageAvailable ? "institution-coverage-degraded" : "runtime-coverage-unavailable",
          stage: "leadership-monitor",
          reason: stageFailed && leadership.error ? safeAlertError(leadership.error)
            : runtimeCoverageLost.length ? `${runtimeCoverageLost.length} institutions lack current leadership observations`
            : !runtimeCoverageAvailable ? "Leadership runtime coverage is unavailable"
              : safeAlertError(leadership.error ?? leadership.outcome),
          ...(failureSummary ? { failureSummary } : {}), ...evidence,
        },
      };
      if (severity === "critical") await dispatch(alert);
      else await recordWarning(alert);
    }
  }

  const selected = Number(result?.modelSelectedCount ?? 0);
  const modelFailed = Number(result?.modelOperationalFailedCount ?? result?.modelFailedCount ?? 0);
  const validationRejected = Number(result?.modelValidationRejectedCount ?? 0);
  if (selected > 0 && modelFailed > 0) {
    await recordWarning({
      fingerprint: "valley-desk:model-enrichment",
      event: "model-enrichment-failed",
      severity: "warning",
      conditionState: "degraded",
      subsystem: "model",
      groupKey: "valley-desk:model:enrichment",
      threshold: 2,
      now,
      details: {
        selected,
        failed: modelFailed,
        succeeded: Number(result?.modelSucceededCount ?? 0),
        validationRejected,
      },
    });
  } else if (selected > 0) {
    await recover("valley-desk:model-enrichment", 2, {
      selected,
      succeeded: Number(result?.modelSucceededCount ?? 0),
      failed: 0,
      validationRejected,
    });
  }

  const verifierAttempted = Number(result?.verifierAttemptedCount ?? 0);
  const verifierFailed = Number(result?.verifierFailedCount ?? 0);
  if (verifierAttempted > 0 && verifierFailed > 0) {
    await recordWarning({
      fingerprint: "valley-desk:model-verifier",
      event: "model-verifier-failed",
      severity: "warning",
      conditionState: "degraded",
      subsystem: "model",
      groupKey: "valley-desk:model:verifier",
      threshold: 2,
      now,
      details: { attempted: verifierAttempted, failed: verifierFailed },
    });
  } else if (verifierAttempted > 0) {
    await recover("valley-desk:model-verifier", 2, { attempted: verifierAttempted, failed: 0 });
  }

  await recover("valley-desk:automation-run-failed", 2);
}

async function sendDailyOpsDigest(env, now = new Date()) {
  // Run once at a predictable UTC hour; D1 claim state makes retries and
  // duplicate cron deliveries safe.
  if (now.getUTCHours() !== 8) return;
  try {
    await dispatchOperationalDigest(env.VALLEY_DESK_DB, env.NOTIFY_OPS, now);
  } catch (error) {
    logOps("ops-digest", { outcome: "record-failed", message: safeAlertError(error) }, "warn");
  }
}

async function handleFetch(request, env, origin, nonce, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (env.DIRECTORY_PUBLIC_ENABLED === "true" && (path === "/" || path.startsWith("/discover") || path.startsWith("/api/directory/"))) {
    const { isPublicDirectoryPath, servePublicDirectory } = await import("./src/ingest/public-directory.ts");
    if (isPublicDirectoryPath(path)) return servePublicDirectory(request, env.VALLEY_DESK_DB, origin, nonce);
  }

  if (path.startsWith("/api/discovery/v1/")) return handleDirectoryRoutes(request, env);
  if (/^\/discover\/(?:works(?:\/|$)|work\/)/.test(path)) return handleDirectoryRoutes(request, env);
  if (/^\/api\/discovery-pilot\/?$/.test(path)) return handleDiscoveryPilot(request, env);
  if (/^\/discover\/?$/.test(path)) return handleDiscoveryPilotPage(request, env, origin, nonce);

  if (path === "/api/health") {
    return handlePublicHealth(request, env);
  }
  if (path === "/events.ics") return handleEventCalendar(request, env);
  if (/^\/api\/v2\/watch\/(policy|technology)\/updates\/?$/.test(path)) return handleWatchUpdatesRead(request, env);
  if (path === "/api/v2/watch/representatives") {
    try {
      const policy = env.WATCH_PUBLIC_ENABLED === "true" && env.VALLEY_DESK_DB
        ? await resolveRepresentativeSourcePolicy(env.VALLEY_DESK_DB)
        : { officialSources: new Map(), sourceUrlAllowed: () => false, officialPublicUrlAllowed: () => false, maxRosterAgeHours: 168 };
      return handleRepresentativeRead(request, env, policy);
    } catch {
      return new Response(request.method === "HEAD" ? null : JSON.stringify({ error: { code: "representative-unavailable" } }),
        { status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
  }
  if (isWatchReadPath(path)) return handleWatchRead(request, env);
  if (isWatchPagePath(path)) {
    let result = await readWatchPage(request, env.WATCH_PUBLIC_ENABLED === "true", input => handleWatchRead(input, env));
    let html;
    try {
      const asset = await env.ASSETS.fetch(new URL("/index.html", url.origin));
      if (asset.ok) html = await asset.text();
    } catch { /* A shell failure must not turn hidden pages into successful responses. */ }
    if (!html) {
      if (result.status === 200) result = { route: result.route, status: 503, error: "unavailable" };
      html = `<!doctype html><html lang="en"><head><title>The Valley Desk</title></head><body><main>${watchPrimaryNoscript(result, origin)}</main></body></html>`;
    }
    const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
      "cdn-cache-control": "no-store", "x-robots-tag": "noindex" };
    if (result.status === 405) headers.allow = "GET, HEAD";
    if (result.data) headers["x-watch-data-state"] = result.data.stale ? "stale" : "unknown";
    if (result.deliveryAsOf) headers["x-watch-delivery-as-of"] = result.deliveryAsOf;
    return new Response(decorateWatchHtml({ html, result, origin, nonce, publicFeatures: publicFeaturesFromEnv(env) }), { status: result.status, headers });
  }
  if (stripSlash(path) === "/policy" && !publicFeaturesFromEnv(env).policyBackground) {
    const response = await notFound(env, request, path, origin, nonce);
    response.headers.set("cdn-cache-control", "no-store");
    return response;
  }
  if (path === "/api/policy-watchlist") {
    const headers = { "content-type": "application/json", "cache-control": "no-store", "cdn-cache-control": "no-store", "x-robots-tag": "noindex" };
    if (!publicFeaturesFromEnv(env).policyBackground) return new Response(JSON.stringify({error:"policy-background-not-enabled"}), {status:503,headers});
    if (method !== "GET" && method !== "HEAD") return new Response(null, {status:405,headers:{...headers,allow:"GET, HEAD"}});
    try { return new Response(JSON.stringify(await policyBaselineView(env.VALLEY_DESK_DB)), {headers}); }
    catch { return new Response(JSON.stringify({error:"policy-background-unavailable"}), {status:503,headers}); }
  }
  if (isSocialManifestPath(path)) {
    return handleSocialManifest(request, env);
  }
  if (isSocialCollectorRunsPath(path)) {
    const response = await handleSocialCollectorRuns(request, env);
    if (method === "POST" && response.status === 202 && ctx && typeof ctx.waitUntil === "function") {
      const report = await response.clone().json().catch(() => ({}));
      if (report.pauseRequired) {
        ctx.waitUntil(dispatchOperationalAlert(env.VALLEY_DESK_DB, env.NOTIFY_OPS, {
          fingerprint: "valley-desk:social:vale",
          event: "social-collector-paused",
          severity: "warning",
          conditionState: "failed",
          threshold: 1,
          subsystem: "social",
          groupKey: "valley-desk:social:vale",
          details: {
            runId: report.runId,
            outcome: report.outcome,
            consecutiveFailures: report.consecutiveFailures,
            pauseRequired: true,
          },
        }).catch((error) => {
          logOps("ops-alert", { outcome: "dispatch-failed", fingerprint: "valley-desk:social:vale", message: safeAlertError(error) }, "warn");
        }));
      } else if (report.recoveryObserved) {
        ctx.waitUntil(resolveOperationalAlertWithTransition(
          env.VALLEY_DESK_DB,
          "valley-desk:social:vale",
          new Date(),
          2,
          { outcome: "healthy", collector: "vale" },
        ).then((recovery) => (
          recovery.resolved && recovery.row
            ? dispatchOperationalRecovery(env.VALLEY_DESK_DB, env.NOTIFY_OPS, recovery.row)
            : undefined
        )).catch((error) => {
          logOps("ops-alert", { outcome: "recovery-failed", fingerprint: "valley-desk:social:vale", message: safeAlertError(error) }, "warn");
        }));
      }
    }
    return response;
  }
  if (isSocialEvidencePath(path)) {
    return handleSocialEvidence(request, env);
  }
  if (isOpsPath(path)) {
    return handleOpsRequest(
      request,
      env,
      ctx,
      origin,
      async () => {
        const asset = await env.ASSETS.fetch(new URL("/index.html", url.origin));
        return decorateHtml({
          html: await asset.text(),
          path: "/ops",
          publicFeatures: publicFeaturesFromEnv(env),
          origin,
          nonce,
        });
      },
    );
  }
  if (isReviewApiPath(path)) {
    return handleReviewApi(request, env);
  }
  const sitemapRequest = stripSlash(decodedPublicPath(path)) === "/sitemap.xml";
  if ((method === "GET" || method === "HEAD") && (PUBLIC_MACHINE_PATHS.has(path) || sitemapRequest)) {
    if (path === "/robots.txt") {
      return new Response(robotsTxt(origin), {
        headers: { ...PUBLIC_HEADERS, "content-type": "text/plain; charset=utf-8" },
      });
    }
    if (path === "/llms.txt") {
      return new Response(llmsTxt(origin, env.DIRECTORY_PUBLIC_ENABLED === "true"), {
        headers: { ...PUBLIC_HEADERS, "content-type": "text/plain; charset=utf-8" },
      });
    }
    const seed = await staticFeed(env, request);
    let feed = seed;
    try {
      feed = await mergedFeed(env.VALLEY_DESK_DB, seed);
    } catch (error) {
      logOps("dynamic-feed-fallback", {
        message: error instanceof Error ? error.message : "D1 feed unavailable",
      }, "error");
    }
    if (path === "/feed.xml") {
      return new Response(feedXml(feed, origin), {
        headers: { ...PUBLIC_HEADERS, "content-type": "application/rss+xml; charset=utf-8" },
      });
    }
    if (sitemapRequest) {
      const headers = { ...PUBLIC_HEADERS, "content-type": "application/xml; charset=utf-8" };
      if (env.DIRECTORY_PUBLIC_ENABLED === "true") {
        headers["cache-control"] = "no-store";
        headers["cdn-cache-control"] = "no-store";
        try {
          const { publicDirectorySitemap } = await import("./src/ingest/public-directory.ts");
          const directory = await publicDirectorySitemap(env.VALLEY_DESK_DB, origin);
          return new Response(sitemapXml(feed, origin, directory), { headers });
        } catch {
          return new Response(null, { status: 503, headers });
        }
      }
      return new Response(sitemapXml(feed, origin), { headers });
    }
    return new Response(JSON.stringify(feed), {
      headers: { ...PUBLIC_HEADERS, "content-type": "application/json; charset=utf-8" },
    });
  }
  if (path === "/org" || path.startsWith("/org/")) {
    return notFound(env, request, path, origin, nonce);
  }
  if (path === "/briefing" || path.startsWith("/briefing/")) {
    return notFound(env, request, path, origin, nonce);
  }
  const redirected = permalinkRedirect(path) || await lookupPublishedSlugAlias(env, path);
  if (redirected) {
    return Response.redirect(`${url.origin}${redirected}`, 301);
  }
  if (SPA_PATH.test(path)) {
    const overlay = await dynamicOverlay(env);
    const seed = await staticFeed(env, request);
    let published = mergePublishedContent(seed.items, overlay.items, overlay.withdrawnIds);
    const withdrawnIds = new Set(overlay.withdrawnIds);
    const section = sectionKind(path);
    const slug = stripSlash(path).split("/").at(-1);
    const staticPathState = publishedItemPath(path);
    const staticHead = slug ? publishedHead[slug] : undefined;
    const staticWithdrawn = Boolean(staticHead?.id && withdrawnIds.has(staticHead.id));
    // Resolve signed seed items as well as D1-only items so crawler HTML for
    // every permalink receives article metadata, JSON-LD, and noscript copy.
    let dynamicItem = section && slug
      ? published.find((item) => item.slug === slug && itemMatchesSection(item, section))
      : undefined;
    if (!dynamicItem && staticPathState === false && section && slug) {
      const requested = await findPublishedContent(env.VALLEY_DESK_DB, section, slug).catch(() => undefined);
      if (requested && itemMatchesSection(requested, section)) {
        const safeSupplement = mergePublishedContent(seed.items, [requested], overlay.withdrawnIds);
        dynamicItem = safeSupplement.find((item) => item.id === requested.id);
        if (dynamicItem && !published.some((item) => item.id === dynamicItem.id)) published = [...published, dynamicItem];
      }
    }
    if ((staticPathState === false && !dynamicItem) || (staticPathState === true && staticWithdrawn && !dynamicItem)) {
      return notFound(env, request, path, origin, nonce);
    }
    const asset = await env.ASSETS.fetch(new URL("/index.html", url.origin));
    const html = decorateHtml({
      html: await asset.text(),
      path,
      search: url.search,
      origin,
      nonce,
      item: dynamicItem,
      items: path === "/lab" || path.startsWith("/lab/") ? published : published.filter(item => item.kind === "voice"),
      withdrawnIds: overlay.withdrawnIds,
      entities: loadEntities(),
      publicFeatures: publicFeaturesFromEnv(env),
    });
    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        ...(path.startsWith("/lab") ? { "x-robots-tag": "noindex, nofollow" } : {}),
      },
    });
  }
  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404) return asset;
  return notFound(env, request, path, origin, nonce);
}

export default {
  async email(message, env) {
    const result = await handleCloudflareInboundEmail(message, env);
    if (result.outcome === "failed") {
      throw new Error(`Inbound email discovery failed: ${result.reason || "unknown error"}`);
    }
  },
  async scheduled(event, env, ctx) {
    if (event?.cron === WATCH_CRON) {
      if (!env.VALLEY_DESK_DB) return;
      const phase = watchSchedulePhase(event.scheduledTime);
      const work = phase === "collection"
        ? runScheduledWatchCollection(env.VALLEY_DESK_DB, { enabled: env.WATCH_COLLECTION_ENABLED === "true", publishRepresentatives: env.WATCH_SOURCE_RULE_ENABLED === "true" })
        : runScheduledWatchPublication(env.VALLEY_DESK_DB, { enabled: env.WATCH_SOURCE_RULE_ENABLED === "true" });
      ctx.waitUntil(work.then(result => logOps("watch-" + phase, result))
        .catch(error => logOps("watch-" + phase, { outcome: "failed", message: error instanceof Error ? error.message : "Watch dispatch failed" }, "error")));
      return;
    }
    const cadence = event?.cron === DAILY_DEEP_SCAN_CRON ? "daily" : "hourly";
    ctx.waitUntil(
      cleanupEmailDiscoveries(env.VALLEY_DESK_DB).catch((error) => {
        logOps("email-cleanup", {
          outcome: "failed",
          message: error instanceof Error ? error.message : "Unknown email cleanup failure",
        }, "warn");
      }),
    );
    const emailAuthentication = resolvePendingEmailAuthentication(env).catch((error) => {
        logOps("email-auth", {
          outcome: "failed",
          message: error instanceof Error ? error.message : "Unknown email authentication failure",
        }, "warn");
      });
    ctx.waitUntil(
      cleanupNewsArticleExtractions(env.VALLEY_DESK_DB).catch((error) => {
        logOps("news-extraction-cleanup", {
          outcome: "failed",
          message: error instanceof Error ? error.message : "Unknown news extraction cleanup failure",
        }, "warn");
      }),
    );
    ctx.waitUntil(
      cleanupSocialEvidencePackets(env.VALLEY_DESK_DB).catch((error) => {
        logOps("social-evidence-cleanup", {
          outcome: "failed",
          message: error instanceof Error ? error.message : "Unknown social evidence cleanup failure",
        }, "warn");
      }),
    );
    ctx.waitUntil(
      emailAuthentication.then(() => runAutomation(env, undefined, undefined, { mode: cadence })).then((result) => {
        logOps("cron", {
          outcome: result.skipped ? "skipped" : "succeeded",
          cadence,
          ...compactAutomation(result),
        });
        return sendAutomationAlerts(env, result).then(() => sendDailyOpsDigest(env));
      }).catch((error) => {
        logOps("ingest-scheduled-failed", {
          message: safeAlertError(error),
        }, "error");
        return dispatchOperationalAlert(env.VALLEY_DESK_DB, env.NOTIFY_OPS, {
          fingerprint: "valley-desk:automation-run-failed",
          event: "automation-run-failed",
          severity: "critical",
          threshold: 2,
          details: safeAlertDetails(error, { stage: "scheduled" }),
        }).catch((alertError) => {
          logOps("ops-alert", { outcome: "dispatch-failed", message: safeAlertError(alertError) }, "warn");
        });
      }),
    );
  },
  async fetch(request, env, ctx) {
    const origin = resolvePublicOrigin(env.PUBLIC_ORIGIN);
    const nonce = crypto.randomUUID();
    const retired = retiredEditorialRoute(new URL(request.url).pathname);
    const head = request.method.toUpperCase() === "HEAD";
    let response;
    if (retired?.kind === "page") {
      const { retiredDirectoryPage } = await import("./src/ingest/public-directory.ts");
      response = retiredDirectoryPage(retired.section, origin, nonce, head);
    } else if (retired?.kind === "data") {
      response = new Response(head ? null : JSON.stringify({ error: "retired" }), {
        status: 410,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "cdn-cache-control": "no-store", "x-robots-tag": "noindex" },
      });
    } else {
      response = canonicalHostRedirect(request, origin) ?? await handleFetch(request, env, origin, nonce, ctx);
    }
    const contentType = response.headers.get("content-type") || "";
    const html = contentType.includes("text/html");
    const secured = applySecurityHeaders(response, {
      request,
      publicOrigin: origin,
      html,
      nonce: html ? nonce : undefined,
    });
    if (head) return asHeadResponse(secured);
    return secured;
  },
};
