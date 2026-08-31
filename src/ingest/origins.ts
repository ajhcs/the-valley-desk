import { z } from "zod";
import originsDoc from "../../fixtures/origins-first-wave.json";

export type SocialKind = "organization" | "person";

const Region = z.enum(["PA", "NJ", "DE", "regional", "federal"]);
const SourceStatus = z.enum(["enabled", "disabled", "misconfigured"]);

const RssSource = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  fallbacks: z.array(z.string().url()).optional(),
  htmlFallbacks: z.array(z.object({
    url: z.string().url(),
    adapter: z.literal("cooper-newsroom"),
  })).optional(),
  /**
   * Independent discovery is deliberately separate from first-party
   * fallbacks. Its items remain non-authoritative and must be corroborated by
   * the health system before the editor can publish them.
   */
  independentFallbacks: z.array(z.object({
    url: z.string().url(),
    adapter: z.literal("cooper-independent"),
  })).optional(),
  kind: z.literal("news"),
  origin: z.string().min(1).optional(),
  orgIds: z.array(z.string().min(1)).optional(),
  status: SourceStatus.default("enabled"),
  reason: z.string().optional(),
});

const EventSource = z.object({
  id: z.string().min(1),
  origin: z.string().min(1),
  url: z.string().url(),
  orgs: z.array(z.string().min(1)).min(1),
  adapter: z.enum(["dvhimss-rest", "njdvhimss-page"]),
  status: SourceStatus.default("enabled"),
  reason: z.string().optional(),
});

const LinkedInOrigin = z.object({
  slug: z.string().min(1),
  kind: z.enum(["organization", "person"]),
  person: z.string().min(1),
  orgs: z.array(z.string().min(1)),
  url: z.string().url(),
  region: Region,
});

const XOrigin = z.object({
  handle: z.string().min(1),
  kind: z.enum(["organization", "person"]),
  person: z.string().min(1),
  orgs: z.array(z.string().min(1)),
  url: z.string().url(),
  region: Region,
  verifiedAt: z.string().optional(),
});

const FirstWaveOrigins = z.object({
  asOf: z.string(),
  source: z.string(),
  notes: z.array(z.string()),
  rss: z.array(RssSource),
  events: z.array(EventSource),
  linkedin: z.array(LinkedInOrigin),
  x: z.array(XOrigin),
  hold: z.object({
    x: z.array(z.string()),
    linkedin: z.array(z.string()),
    notes: z.array(z.string()),
  }),
});

export type RssSource = z.infer<typeof RssSource>;
export type EventSource = z.infer<typeof EventSource>;
export type LinkedInOrigin = z.infer<typeof LinkedInOrigin>;
export type XOrigin = z.infer<typeof XOrigin>;
export type FirstWaveOrigins = z.infer<typeof FirstWaveOrigins>;
export type SourceStatus = z.infer<typeof SourceStatus>;

/** Typed registry is the single runtime authority for configured origins. */
export const sourceRegistry = FirstWaveOrigins.parse(originsDoc);
export const firstWaveOrigins = sourceRegistry;

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

export function eventSourceById(id: string) {
  return sourceRegistry.events.find((source) => source.id === id);
}

export function rssSources() {
  return sourceRegistry.rss;
}
