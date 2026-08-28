import { ContentCatalog, ContentItem, type ContentItem as ContentItemType } from "../content/schema";
import publishedCatalog from "../content/published-catalog.json";
import { eventCopyMarksCancelled } from "../lib/calendar";
import { isOfficialChapterEvent, validateForPublication } from "../content/publication";
import type { EditorEnrichment } from "./editor-model";
import { matchingProductUses } from "./product-watch";
import { professionalizeHeadline } from "../lib/editorialCopy";
import { looksInstructionLike } from "./untrusted-text";
import { isHighRiskNews, verifyHighRisk, type VerificationInput, type VerificationResult } from "./verification";
import { validateClaimLedger } from "./claim-ledger";
import { editorContextForItem } from "./editor-context";

const VERIFIED_PUBLISHED_CONTEXT = ContentCatalog.parse(publishedCatalog);

export const EDITOR_POLICY_VERSION = "tvd-auto-editor-v5";

export type EditorAction = "publish" | "review" | "reject";
export type EditorDecision = {
  action: EditorAction;
  rule: string;
  confidence: number;
  reasons: string[];
  content: ContentItemType;
};

const OFFICIAL_CHAPTER_SOURCE_HOSTS: Record<string, string[]> = {
  "dvhimss-events": ["dvhimss.org"],
  "njhimss-events": ["njdvhimssevent.com", "njhimss.org"],
};
export const OFFICIAL_HEALTH_SYSTEM_ORIGINS = new Set([
  "christianacare-newsroom", "chop-newsroom", "cooper-newsroom",
  "jefferson-newsroom", "main-line-health-newsroom", "penn-medicine-newsroom",
  "temple-health-newsroom", "tower-health-newsroom",
]);
export const TRUSTED_REGIONAL_REPORTING_ORIGINS = new Set([
  "Inquirer Health", "Inquirer Business", "WHYY",
]);

/** Candidates from the exact-host official-source registry have already
 * passed its first-party/regulatory relevance gate. They still remain subject
 * to this editor and the second-pass verifier before publication. */
export function isOfficialRegistryOrigin(origin: string) {
  return origin.startsWith("official-ofs-");
}
const MATERIAL_CHANGES = new Set([
  "deployment", "workflow", "safety", "security", "outage",
  "interoperability", "commercial", "regulatory",
]);
const REGISTRATION_HOSTS = ["cvent.me", "web.cvent.com", "dvhimss.org", "njhimss.org", "njdvhimssevent.com"];

function httpsUrl(value?: string) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function officialChapterSource(item: ContentItemType) {
  const allowed = OFFICIAL_CHAPTER_SOURCE_HOSTS[item.source.origin];
  if (!allowed || !item.source.url) return false;
  try {
    const host = new URL(item.source.url).hostname.toLowerCase();
    return allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function trustedRegistrationUrl(value?: string) {
  if (!httpsUrl(value)) return false;
  const host = new URL(value!).hostname.toLowerCase();
  return REGISTRATION_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function eventIsCancelled(item: ContentItemType) {
  if (item.kind !== "event") return false;
  return eventCopyMarksCancelled(item);
}

function withEditorialFields(item: ContentItemType, enrichment: EditorEnrichment, now: Date) {
  const content = {
    ...item,
    title: professionalizeHeadline(item.title),
    body: enrichment.body?.trim() || item.body,
    status: "published" as const,
    // Keep the source publication time so a delayed/backfill run cannot make
    // an older article look like breaking news.
    publishedAt: item.publishedAt && Number.isFinite(Date.parse(item.publishedAt))
      ? item.publishedAt
      : now.toISOString(),
    impactSentence: enrichment.impactSentence?.trim() || item.impactSentence,
    contextSentence: enrichment.contextSentence?.trim() || item.contextSentence,
    verifiedAt: item.verifiedAt ?? now.toISOString(),
    featured: false,
    ...(item.kind === "event" ? {
      whyAttend: enrichment.whyAttend?.trim() || item.whyAttend,
      whoYoullMeet: enrichment.whoYoullMeet.length ? enrichment.whoYoullMeet : item.whoYoullMeet,
    } : {}),
  };
  return ContentItem.parse(content);
}

export function verificationInputForCandidate(
  item: ContentItemType,
  enrichment: EditorEnrichment,
): VerificationInput {
  const context = editorContextForItem(item, VERIFIED_PUBLISHED_CONTEXT);
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    dek: item.dek,
    body: item.body,
    impactSentence: enrichment.impactSentence,
    contextSentence: enrichment.contextSentence,
    topics: item.topics,
    changeType: enrichment.changeType,
    evidenceSpans: enrichment.evidenceSpans,
    contextEvidenceSpans: enrichment.contextEvidenceSpans,
    contextItemIds: enrichment.contextItemIds,
    contextHaystack: context.flatMap((row) => [row.title, row.summary]).join("\n"),
    allowedSourceIds: new Set(
      [item.id, item.source.origin, item.source.url, item.source.externalId]
        .filter((id): id is string => Boolean(id)),
    ),
    allowedContextIds: new Set(context.map((row) => row.id)),
    claimLedger: enrichment.claimLedger ?? null,
  };
}

export function evaluateCandidate(
  item: ContentItemType,
  enrichment: EditorEnrichment | null,
  now = new Date(),
  verification?: VerificationResult | null,
): EditorDecision {
  const review = (rule: string, reasons: string[], confidence = enrichment?.confidence ?? 0): EditorDecision => ({
    action: "review", rule, reasons, confidence, content: { ...item, status: "review", featured: false },
  });
  const reject = (rule: string, reasons: string[]): EditorDecision => ({
    action: "reject", rule, reasons, confidence: 1, content: { ...item, status: "review", featured: false },
  });
  const policyContext = { mode: "strict" as const, surface: "automatic" as const, now, enrichment };
  const safety = validateForPublication(item, { ...policyContext, mode: "delivery" });
  if (!safety.ok) {
    if (safety.blocking.some((row) => row.code === "event-cancelled")) {
      return reject("event-cancelled", ["Source marks the event cancelled or postponed"]);
    }
    const first = safety.blocking[0];
    return review(first?.code ?? "publication-policy", safety.blocking.map((row) => row.message));
  }
  if (!httpsUrl(item.source.url)) return review("source-https", ["No authoritative HTTPS source URL"]);

  if (item.kind === "event") {
    if (eventIsCancelled(item)) {
      return {
        action: "reject",
        rule: "event-cancelled",
        confidence: 1,
        reasons: ["Source marks the event cancelled or postponed"],
        content: { ...item, status: "review", featured: false, cancelled: true },
      };
    }
    if (!Number.isFinite(Date.parse(item.startsAt)) || Date.parse(item.startsAt) <= now.getTime()) {
      return {
        action: "review",
        rule: "event-not-future",
        reasons: ["Event is not in the future"],
        confidence: 1,
        content: { ...item, status: "review", featured: false },
      };
    }
    if (!httpsUrl(item.registrationUrl)) return review("event-registration-https", ["No verified HTTPS registration URL"]);
    if (
      isOfficialChapterEvent(item) &&
      officialChapterSource(item) &&
      trustedRegistrationUrl(item.registrationUrl) &&
      (item.partner === "dvhimss" || item.partner === "njhimss")
    ) {
      const content = ContentItem.parse({ ...item, status: "published", publishedAt: now.toISOString(), featured: false });
      const verdict = validateForPublication(content, policyContext);
      if (!verdict.ok) return review(verdict.blocking[0]?.code ?? "publication-policy", verdict.blocking.map((row) => row.message));
      return {
        action: "publish",
        rule: "official-chapter-event",
        confidence: 0.99,
        reasons: ["Official chapter source", "Future date", "Verified registration path"],
        content,
      };
    }
    if (!enrichment || enrichment.relevanceScore < 94 || enrichment.confidence < 0.94) {
      return review("regional-event-confidence", ["Regional event needs high-confidence relevance evidence"]);
    }
    if (enrichment.decision === "hold" || enrichment.decision === "drop") {
      return review("regional-event-model-hold", enrichment.reasons);
    }
    const content = withEditorialFields(item, enrichment, now);
    const verdict = validateForPublication(content, policyContext);
    if (!verdict.ok) return review(verdict.blocking[0]?.code ?? "publication-policy", verdict.blocking.map((row) => row.message));
    return {
      action: "publish", rule: "confirmed-regional-event", confidence: enrichment.confidence,
      reasons: enrichment.reasons, content,
    };
  }

  if (item.kind !== "news" && item.kind !== "policy" && item.kind !== "ai") {
    return review("unsupported-auto-kind", ["This content kind is not automatically published"]);
  }
  if (looksInstructionLike(item.title, item.dek, item.body, item.source.origin, item.source.url)) {
    return review("untrusted-source-instructions", ["Source text contains instruction-like content and is held from automatic publication"]);
  }
  if (
    item.publishedAt
    && Number.isFinite(Date.parse(item.publishedAt))
    && now.getTime() - Date.parse(item.publishedAt) > 45 * 24 * 60 * 60 * 1_000
  ) {
    return review("stale-source-publication", ["Source item is older than the 45-day automatic-publication window"]);
  }
  if (item.orgs.length === 0) return review("local-org-required", ["No verified regional health-system relationship"]);
  if (!enrichment) return review("model-evidence-required", ["Model evidence was unavailable"]);
  if (
    enrichment.affectedOrgIds.length === 0
    || !enrichment.affectedOrgIds.some((id) => item.orgs.includes(id))
  ) {
    return review("affected-org-evidence-required", ["Model evidence did not match a verified organization on the item"]);
  }
  if (!enrichment.impactSentence?.trim() || enrichment.evidenceSpans.length === 0) {
    return review("grounded-impact-required", ["No grounded impact sentence and evidence"]);
  }
  if (!MATERIAL_CHANGES.has(enrichment.changeType)) {
    return review("material-change-required", ["No material operating or technology change"]);
  }
  const products = matchingProductUses(item);
  const isProductNews = products.length > 0;
  if (isProductNews && !enrichment.productIds.some((id) => products.some((product) => product.id === id))) {
    return review("verified-product-evidence-required", ["Model did not ground the matched local product relationship"]);
  }
  if (enrichment.decision !== "priority_review") {
    return review("model-not-priority", enrichment.reasons);
  }
  const official = OFFICIAL_HEALTH_SYSTEM_ORIGINS.has(item.source.origin) || isOfficialRegistryOrigin(item.source.origin);
  const trustedRegional = TRUSTED_REGIONAL_REPORTING_ORIGINS.has(item.source.origin);
  if (!official && !trustedRegional) {
    return review("primary-corroboration-required", ["Discovery source requires first-party corroboration"]);
  }
  const minimum = official
    ? { score: isProductNews ? 75 : 65, confidence: isProductNews ? 0.85 : 0.8 }
    : { score: isProductNews ? 90 : 82, confidence: isProductNews ? 0.92 : 0.88 };
  if (enrichment.relevanceScore < minimum.score || enrichment.confidence < minimum.confidence) {
    return review(
      "relevance-threshold",
      [`Required relevance ${minimum.score} and confidence ${Math.round(minimum.confidence * 100)}%`],
      enrichment.confidence,
    );
  }

  // Claim-ledger: exact claims must be grounded; fail review if not
  if (enrichment.claimLedger && enrichment.claimLedger.claims.length > 0) {
    const hay = [item.title, item.dek, item.body].join("\n");
    const context = editorContextForItem(item, VERIFIED_PUBLISHED_CONTEXT);
    const sourceIds = new Set([item.id, item.source.origin, item.source.url, item.source.externalId].filter((id): id is string => Boolean(id)));
    const contextIds = new Set(context.map((row) => row.id));
    const ledgerResult = validateClaimLedger(
      enrichment.claimLedger,
      hay,
      context.flatMap((row) => [row.title, row.summary]).join("\n"),
      sourceIds,
      contextIds,
    );
    if (!ledgerResult.ok) {
      return review("claim-ledger-unverified", ledgerResult.errors.slice(0, 3));
    }
  }

  const content = withEditorialFields(item, enrichment, now);

  // Two-pass verification for high-risk news classes (financial, policy/regulatory, security/safety/outage, executive change)
  // Fail-closed: any objection => review
  const highRiskInput = verificationInputForCandidate(item, enrichment);
  if (isHighRiskNews(highRiskInput)) {
    const secondPass = verification === undefined ? verifyHighRisk(highRiskInput) : verification;
    if (!secondPass || !secondPass.approved) {
      return review("second-pass-failed", secondPass?.objections.map((o) => `${o.code}: ${o.reason}`) ?? ["Second-pass verification unavailable"]);
    }
  }

  const publishedContent = isProductNews
    ? ContentItem.parse({ ...content, topics: [...new Set([...content.topics, "product-watch"])] })
    : content;
  const verdict = validateForPublication(publishedContent, policyContext);
  if (!verdict.ok) {
    return review(verdict.blocking[0]?.code ?? "publication-policy", verdict.blocking.map((row) => row.message));
  }
  return {
    action: "publish",
    rule: isProductNews
      ? "verified-product-change"
      : trustedRegional ? "trusted-regional-health-system-change" : "official-health-system-change",
    confidence: enrichment.confidence,
    reasons: enrichment.reasons,
    content: publishedContent,
  };
}
