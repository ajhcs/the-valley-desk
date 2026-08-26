import type { ContentItem, EventItem, VoiceItem } from "../content/schema";

/** Closed display labels. One primary chip. topics[] stay richer and machine-readable. */
export const NEWS_DISPLAY_LABELS = [
  "AI",
  "POLICY",
  "CYBER",
  "EHR",
  "INTEROP",
  "WORKFORCE",
  "FINANCE",
  "HIT",
] as const;

export const VOICE_DISPLAY_LABELS = [
  "AI",
  "SECURITY",
  "EHR",
  "INTEROP",
  "POLICY",
  "FINANCE",
  "WORKFORCE",
  "LEADERSHIP",
  "CIO",
  "CLINICAL",
  "OPERATIONS",
] as const;

export const EVENT_DISPLAY_LABELS = ["CHAPTER", "WEBINAR", "EVENT"] as const;

export type NewsDisplayLabel = (typeof NEWS_DISPLAY_LABELS)[number];
export type VoiceDisplayLabel = (typeof VOICE_DISPLAY_LABELS)[number];
export type EventDisplayLabel = (typeof EVENT_DISPLAY_LABELS)[number];
export type DisplayLabel = NewsDisplayLabel | VoiceDisplayLabel | EventDisplayLabel | "BRIEFING" | "HIT";

const NEWS_TOPIC_TO_LABEL: Record<string, NewsDisplayLabel> = {
  ai: "AI",
  ambient: "AI",
  copilot: "AI",
  scribe: "AI",
  policy: "POLICY",
  cms: "POLICY",
  regulation: "POLICY",
  cyber: "CYBER",
  cybersecurity: "CYBER",
  ransomware: "CYBER",
  security: "CYBER",
  ehr: "EHR",
  epic: "EHR",
  mychart: "EHR",
  cerner: "EHR",
  downtime: "EHR",
  interop: "INTEROP",
  interoperability: "INTEROP",
  fhir: "INTEROP",
  tefca: "INTEROP",
  hsx: "INTEROP",
  workforce: "WORKFORCE",
  staffing: "WORKFORCE",
  finance: "FINANCE",
  contract: "FINANCE",
  payer: "FINANCE",
};

/** More specific news labels beat HIT. CYBER before AI when both appear. */
const NEWS_LABEL_PRIORITY: NewsDisplayLabel[] = [
  "CYBER",
  "AI",
  "POLICY",
  "INTEROP",
  "EHR",
  "WORKFORCE",
  "FINANCE",
  "HIT",
];

function norm(value: string) {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}

function hay(parts: Array<string | string[] | undefined>) {
  return parts
    .flatMap((part) => (Array.isArray(part) ? part : part ? [part] : []))
    .map(norm)
    .filter(Boolean)
    .join(" ");
}

function topicLabel(topic: string): NewsDisplayLabel | undefined {
  return NEWS_TOPIC_TO_LABEL[norm(topic)];
}

export function primaryNewsLabel(item: Pick<ContentItem, "kind" | "topics" | "title" | "dek" | "body">): NewsDisplayLabel {
  if (item.kind === "policy") return "POLICY";
  if (item.kind === "ai") return "AI";
  const labels = new Set<NewsDisplayLabel>();
  for (const topic of item.topics ?? []) {
    const mapped = topicLabel(topic);
    if (mapped) labels.add(mapped);
  }
  const text = hay([item.title, item.dek, ...(item.topics ?? [])]);
  if (/\b(ransomware|cyberattack|cyber |ciso|breach)\b/.test(` ${text} `)) labels.add("CYBER");
  if (/\b(fhir|tefca|interoperab|information exchange|healthshare)\b/.test(text)) labels.add("INTEROP");
  if (/\b(mychart|ehr|epic|cerner|order set)\b/.test(text)) labels.add("EHR");
  for (const label of NEWS_LABEL_PRIORITY) {
    if (label !== "HIT" && labels.has(label)) return label;
  }
  return "HIT";
}

function voiceRoleLabel(role: string | undefined): VoiceDisplayLabel | undefined {
  const r = norm(role ?? "");
  if (!r) return undefined;
  if (/\bciso\b|chief information security|security officer/.test(r)) return "SECURITY";
  if (/\bcmio\b|\bchio\b|chief medical information|chief health informatics|clinical informatics/.test(r)) {
    return "CLINICAL";
  }
  if (/\bciio\b|\bcio\b|\bcdio\b|chief information officer|chief digital and information|chief technology/.test(r)) {
    return "CIO";
  }
  if (/\bceo\b|president and ceo|^president$/.test(r)) return "LEADERSHIP";
  return undefined;
}

export function primaryVoiceLabel(
  item: Pick<VoiceItem, "role" | "person" | "title" | "dek" | "body" | "topics" | "org" | "platform">,
): VoiceDisplayLabel {
  // The statement's subject is more useful for scanning than the speaker's seniority.
  const subject = hay([item.title, item.dek, item.body, item.topics]);
  if (/\b(cyber|cybersecurity|hitrust|information security|ransomware|breach)\b/.test(subject)) return "SECURITY";
  if (/\b(ambient|copilot|scribe|generative ai|artificial intelligence|\bai\b)\b/.test(subject)) return "AI";
  if (/\b(fhir|tefca|interoperab|information exchange|data exchange|healthshare|health information exchange)\b/.test(subject)) return "INTEROP";
  if (/\b(mychart|ehr|epic|cerner|order set|electronic health record)\b/.test(subject)) return "EHR";
  if (/\b(policy|legislation|cms|regulation|rulemaking|medicaid|medicare)\b/.test(subject)) return "POLICY";
  if (/\b(finance|financial|margin|revenue|cost|contract|payer|payment|million|grant|endowment|community benefit)\b/.test(subject)) return "FINANCE";
  if (/\b(workforce|staffing|recruit|retention|burnout|labor|hiring|medical school|campus)\b/.test(subject)) return "WORKFORCE";
  if (/\b(partnership|medical provider|healthcare provider|tour|analytics|cloud|workflow|care transition)\b/.test(subject)) return "OPERATIONS";
  const fromRole = voiceRoleLabel(item.role);
  if (fromRole) return fromRole;
  const text = hay([item.role, item.person, subject, item.org]);
  if (/\b(analytic|cloud|operation|workflow|membership|care transition)\b/.test(text)) return "OPERATIONS";
  if (/official account/.test(norm(item.person ?? ""))) return "OPERATIONS";
  return "OPERATIONS";
}

export function primaryEventLabel(item: Pick<EventItem, "partner" | "format" | "title" | "topics">): EventDisplayLabel {
  if (item.partner === "dvhimss" || item.partner === "njhimss" || item.partner === "chapter") return "CHAPTER";
  const text = hay([item.title, item.format, item.topics]);
  if (item.format === "virtual" || /\bwebinar\b/.test(text)) return "WEBINAR";
  return "EVENT";
}

export function primaryDisplayLabel(item: Pick<ContentItem, "kind" | "topics" | "title" | "dek" | "body">): DisplayLabel {
  if (item.kind === "briefing") return "BRIEFING";
  if (item.kind === "voice") return primaryVoiceLabel(item as VoiceItem);
  if (item.kind === "event") return primaryEventLabel(item as EventItem);
  return primaryNewsLabel(item);
}

/** CSS paint group. Keep the existing four inks: news/event mute, policy ink, AI admiral, voice ink. */
export function chipPaintKind(
  item: Pick<ContentItem, "kind" | "topics" | "title" | "dek" | "body">,
): ContentItem["kind"] {
  if (item.kind === "voice" || item.kind === "event" || item.kind === "briefing") return item.kind;
  const label = primaryDisplayLabel(item);
  if (label === "AI") return "ai";
  if (label === "POLICY") return "policy";
  if (item.kind === "policy") return "policy";
  if (item.kind === "ai") return "ai";
  return "news";
}
