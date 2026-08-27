import { ContentItem, type ContentItem as ContentItemType } from "../content/schema";
import { eventCopyMarksCancelled } from "../lib/calendar";
import { isOfficialChapterEvent, validateForPublication } from "../content/publication";
import type { EditorEnrichment } from "./editor-model";
import { matchingProductUses } from "./product-watch";
import { professionalizeHeadline } from "../lib/editorialCopy";
import { looksInstructionLike } from "./untrusted-text";

export const EDITOR_POLICY_VERSION = "tvd-auto-editor-v4";

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
    publishedAt: item.status === "published" && item.publishedAt ? item.publishedAt : now.toISOString(),
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

export function evaluateCandidate(
  item: ContentItemType,
  enrichment: EditorEnrichment | null,
  now = new Date(),
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
  const threshold = isProductNews ? 97 : 95;
  if (enrichment.relevanceScore < threshold || enrichment.confidence < threshold / 100) {
    return review("relevance-threshold", [`Required confidence ${threshold}%`], enrichment.confidence);
  }
  if (enrichment.decision !== "priority_review") {
    return review("model-not-priority", enrichment.reasons);
  }
  if (!OFFICIAL_HEALTH_SYSTEM_ORIGINS.has(item.source.origin)) {
    return review("primary-corroboration-required", ["Discovery source requires first-party corroboration"]);
  }
  const content = withEditorialFields(item, enrichment, now);
  const publishedContent = isProductNews
    ? ContentItem.parse({ ...content, topics: [...new Set([...content.topics, "product-watch"])] })
    : content;
  const verdict = validateForPublication(publishedContent, policyContext);
  if (!verdict.ok) {
    return review(verdict.blocking[0]?.code ?? "publication-policy", verdict.blocking.map((row) => row.message));
  }
  return {
    action: "publish",
    rule: isProductNews ? "verified-product-change" : "official-health-system-change",
    confidence: enrichment.confidence,
    reasons: enrichment.reasons,
    content: publishedContent,
  };
}
