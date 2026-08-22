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

export const IMPACT_PUBLISH_KINDS = ["news", "policy", "ai", "interview"] as const;
export type ImpactPublishKind = (typeof IMPACT_PUBLISH_KINDS)[number];

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

export const Citation = z.object({
  name: z.string(),
  url: z.string().url(),
});

/** Editorial marks on briefing rows and the featured lead only. Not a kind. */
export const Annotation = z.object({
  type: z.enum(["ask", "spill"]),
  text: z.string(),
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
  geo: z.string().optional(),
  impactSentence: z.string().optional(),
  citations: z.array(Citation).optional(),
  /** Editorial only. Ingest must never set true. Default false. */
  featured: z.boolean().default(false),
  annotations: z.array(Annotation).optional(),
});

export const NewsItem = Base.extend({
  kind: z.literal("news"),
  relatedEventIds: z.array(z.string()),
  relatedVoiceIds: z.array(z.string()),
  /** Go-live clock. ISO UTC. Newsroom wall is America/New_York. Not publishedAt. */
  clockAt: z.string().datetime().optional(),
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

const ContentItemUnion = z.discriminatedUnion("kind", [
  NewsItem,
  EventItem,
  VoiceItem,
  PolicyItem,
  AiItem,
  BriefingItem,
  InterviewItem,
]);

export function needsImpactSentence(kind: string): kind is ImpactPublishKind {
  return (IMPACT_PUBLISH_KINDS as readonly string[]).includes(kind);
}

export function canPublish(item: {
  kind: string;
  status: string;
  impactSentence?: string;
}): boolean {
  if (item.status !== "published") return false;
  if (needsImpactSentence(item.kind) && !item.impactSentence?.trim()) return false;
  return true;
}

export function isFeaturedPublishedNews(item: {
  kind: string;
  status: string;
  featured?: boolean;
}): boolean {
  return item.kind === "news" && item.status === "published" && item.featured === true;
}

function annotationsAllowed(item: {
  kind: string;
  featured?: boolean;
}): boolean {
  return item.kind === "briefing" || (item.kind === "news" && item.featured === true);
}

export const ContentItem = ContentItemUnion.superRefine((item, ctx) => {
  if (item.status === "published" && needsImpactSentence(item.kind) && !item.impactSentence?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["impactSentence"],
      message: "impactSentence is required to publish news, policy, ai, or interview",
    });
  }
  if (item.annotations?.length && !annotationsAllowed(item)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["annotations"],
      message: "annotations are only allowed on briefing rows and the featured lead",
    });
  }
});

export const ContentCatalog = z.array(ContentItem).superRefine((items, ctx) => {
  const featuredNews = items.filter(isFeaturedPublishedNews);
  if (featuredNews.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "at most one featured published news item at a time",
    });
  }
});

/** Editorial: feature this news row and clear featured on every other news row. */
export function setFeaturedNews<T extends { id: string; kind: string; featured?: boolean; annotations?: unknown }>(
  items: T[],
  id: string,
): T[] {
  const target = items.find((item) => item.id === id);
  if (!target || target.kind !== "news") return items;
  return items.map((item) => {
    if (item.kind !== "news") return item;
    const featured = item.id === id;
    if (item.featured === featured) return item;
    if (!featured && item.annotations) {
      return { ...item, featured: false, annotations: undefined };
    }
    return { ...item, featured };
  });
}

export type ContentItem = z.infer<typeof ContentItemUnion>;
export type Annotation = z.infer<typeof Annotation>;
export type EventItem = z.infer<typeof EventItem>;
export type NewsItem = z.infer<typeof NewsItem>;
export type VoiceItem = z.infer<typeof VoiceItem>;
export type PolicyItem = z.infer<typeof PolicyItem>;
export type AiItem = z.infer<typeof AiItem>;
export type BriefingItem = z.infer<typeof BriefingItem>;
export type InterviewItem = z.infer<typeof InterviewItem>;
export type Citation = z.infer<typeof Citation>;

export function citationUrl(item: {
  source: { url?: string };
  citations?: { name: string; url: string }[];
}): string | undefined {
  return item.source.url || item.citations?.[0]?.url;
}
