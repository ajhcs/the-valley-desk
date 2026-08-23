import originsDoc from "../../fixtures/origins-first-wave.json";

export type SocialKind = "organization" | "person";

export type LinkedInOrigin = {
  slug: string;
  kind: SocialKind;
  person: string;
  orgs: string[];
  url: string;
  region: "PA" | "NJ" | "DE" | "regional" | "federal";
};

export type XOrigin = {
  handle: string;
  kind: SocialKind;
  person: string;
  orgs: string[];
  url: string;
  region: "PA" | "NJ" | "DE" | "regional" | "federal";
};

export type FirstWaveOrigins = {
  asOf: string;
  source: string;
  notes: string[];
  rss: { id: string; name: string; url: string; fallbacks?: string[]; kind: string }[];
  events: { id: string; url: string; orgs: string[] }[];
  linkedin: LinkedInOrigin[];
  x: XOrigin[];
  hold: { x: string[]; linkedin: string[]; notes: string[] };
};

export const firstWaveOrigins = originsDoc as FirstWaveOrigins;

function norm(value: string) {
  return value.replace(/^@/, "").trim().toLowerCase();
}

const LIVE_KEY_BLOCK = new Set(["voice-01", "cio-note-workforce-ai", "jane doe", "janedoe"]);

export function isHeldHandle(platform: "x" | "linkedin", handle: string): boolean {
  const key = norm(handle);
  if (LIVE_KEY_BLOCK.has(key)) return true;
  const list = platform === "x" ? firstWaveOrigins.hold.x : firstWaveOrigins.hold.linkedin;
  return list.some((row) => norm(row) === key);
}

export function liveLinkedInOrigins(): LinkedInOrigin[] {
  return firstWaveOrigins.linkedin.filter((row) => !isHeldHandle("linkedin", row.slug));
}

export function liveXOrigins(): XOrigin[] {
  return firstWaveOrigins.x.filter((row) => !isHeldHandle("x", row.handle));
}

export function isLiveSocialKey(id: string): boolean {
  const key = norm(id);
  if (LIVE_KEY_BLOCK.has(key)) return false;
  if (key.startsWith("voice-01")) return false;
  return true;
}
