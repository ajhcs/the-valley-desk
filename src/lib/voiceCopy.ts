import type { VoiceItem } from "../content/schema";

/** Institutional notes vs named-person commentary. Derived from existing person/platform/URL fields. */
export function isInstitutionalVoice(item: Pick<VoiceItem, "person" | "platform" | "dek" | "body" | "originalUrl" | "source">) {
  if (/official account/i.test(item.person)) return true;
  if (/official (linkedin|handle|page|account)/i.test(`${item.dek} ${item.body}`)) return true;
  const url = item.originalUrl || item.source.url || "";
  if (/healthtechmagazine|bankinfosecurity|\/interviews\//i.test(url)) return false;
  if (item.platform === "site" && /\/news\/|newsroom|press-release|about-us\/news|open\.chop\.edu/i.test(url)) {
    return true;
  }
  return false;
}

export function voiceRegisterLabel(item: Pick<VoiceItem, "person" | "platform" | "dek" | "body" | "originalUrl" | "source">) {
  return isInstitutionalVoice(item) ? "Institutional note" : "Voice";
}
