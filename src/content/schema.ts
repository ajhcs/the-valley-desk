import { z } from "zod";

export const Region = z.enum(["PA", "NJ", "DE", "regional", "federal"]);
export const Status = z.enum(["draft", "review", "published"]);
export const SourceKind = z.enum(["editorial", "ingest"]);
export const Kind = z.enum([
  "news",
  "event",
  "voice",
  "policy",
  "ai",
  "briefing",
  "interview",
]);

export const Source = z.object({
  kind: SourceKind,
  origin: z.string(),
  url: z.string().url().optional(),
  fetchedAt: z.string().datetime().optional(),
  externalId: z.string().optional(),
});

export const Author = z.object({
  name: z.string(),
  org: z.string().optional(),
});

const Base = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  dek: z.string(),
  body: z.string(),
  status: Status,
  publishedAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime(),
  topics: z.array(z.string()),
  orgs: z.array(z.string()),
  region: Region,
  authors: z.array(Author),
  hero: z.string().optional(),
  source: Source,
});

export const NewsItem = Base.extend({
  kind: z.literal("news"),
  relatedEventIds: z.array(z.string()),
  relatedVoiceIds: z.array(z.string()),
});

export const EventItem = Base.extend({
  kind: z.literal("event"),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  timezone: z.string(),
  venue: z.string().optional(),
  city: z.string().optional(),
  hostOrg: z.string(),
  registrationUrl: z.string().url().optional(),
  partner: z.enum([
    "dvhimss",
    "chapter",
    "health-system",
    "vendor",
    "other",
  ]),
  autoPublish: z.boolean().default(false),
});

export const VoiceItem = Base.extend({
  kind: z.literal("voice"),
  person: z.string(),
  role: z.string().optional(),
  org: z.string().optional(),
  platform: z.enum(["x", "linkedin", "site", "other"]),
  originalUrl: z.string().url(),
});

export const PolicyItem = Base.extend({
  kind: z.literal("policy"),
  jurisdiction: Region,
  issuer: z.enum([
    "CMS",
    "PA-DOH",
    "NJ-DOH",
    "DE-DHSS",
    "legislature",
    "other",
  ]),
  effectiveDate: z.string().optional(),
  changeType: z.enum(["rule", "guidance", "legislation", "enforcement"]),
});

export const AiItem = Base.extend({
  kind: z.literal("ai"),
  vendor: z.string(),
  product: z.string(),
  announcedAt: z.string().datetime(),
});

export const BriefingItem = Base.extend({
  kind: z.literal("briefing"),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  itemIds: z.array(z.string()),
});

export const InterviewItem = Base.extend({
  kind: z.literal("interview"),
  exclusive: z.literal(true),
  guest: z.string(),
  guestOrg: z.string(),
});

export const ContentItem = z.discriminatedUnion("kind", [
  NewsItem,
  EventItem,
  VoiceItem,
  PolicyItem,
  AiItem,
  BriefingItem,
  InterviewItem,
]);

export type ContentItem = z.infer<typeof ContentItem>;
export type EventItem = z.infer<typeof EventItem>;
export type NewsItem = z.infer<typeof NewsItem>;
export type VoiceItem = z.infer<typeof VoiceItem>;
export type PolicyItem = z.infer<typeof PolicyItem>;
export type AiItem = z.infer<typeof AiItem>;
export type BriefingItem = z.infer<typeof BriefingItem>;
export type InterviewItem = z.infer<typeof InterviewItem>;
