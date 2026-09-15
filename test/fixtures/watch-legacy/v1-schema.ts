import { z } from "zod";

// Frozen test oracle from 23972f4c04bd2cd891d11488c1580a14b9e14875.
// Do not import production schemas here or update it to accommodate Watch v2.
const Region = z.enum(["PA", "NJ", "DE", "regional", "federal"]);
const Status = z.enum(["draft", "review", "published", "unpublished"]);
const HttpsUrl = z.string().url().refine((value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, "URL must use HTTPS");

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
  authors: z.array(z.object({ name: z.string(), org: z.string().optional() })),
  hero: z.string().optional(),
  source: z.object({
    kind: z.enum(["editorial", "ingest"]),
    origin: z.string(),
    url: HttpsUrl.optional(),
    fetchedAt: z.string().datetime().optional(),
    externalId: z.string().optional(),
  }),
  geo: z.string().optional(),
  impactSentence: z.string().optional(),
  contextSentence: z.string().optional(),
  citations: z.array(z.object({ name: z.string(), url: HttpsUrl })).optional(),
  previousSlugs: z.array(z.string()).optional(),
  featured: z.boolean().default(false),
  annotations: z.array(z.object({
    type: z.enum(["ask", "spill"]), text: z.string(),
  })).optional(),
  verifiedAt: z.string().datetime().optional(),
  singleSource: z.boolean().optional(),
});

const News = Base.extend({
  kind: z.literal("news"),
  relatedEventIds: z.array(z.string()),
  relatedVoiceIds: z.array(z.string()),
  clockAt: z.string().datetime().optional(),
});
const Event = Base.extend({
  kind: z.literal("event"),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  timezone: z.string(),
  venue: z.string().optional(),
  city: z.string().optional(),
  hostOrg: z.string(),
  registrationUrl: HttpsUrl.optional(),
  format: z.enum(["in-person", "virtual", "hybrid", "unknown"]).optional(),
  whyAttend: z.string().optional(),
  whoYoullMeet: z.array(z.string()).optional(),
  healthSystemRelevance: z.string().optional(),
  relatedOrgIds: z.array(z.string()).optional(),
  relatedProductIds: z.array(z.string()).optional(),
  registrationDeadline: z.string().datetime().optional(),
  partner: z.enum(["dvhimss", "njhimss", "chapter", "health-system", "vendor", "other"]),
  autoPublish: z.boolean().default(false),
  cancelled: z.boolean().optional(),
});
const Voice = Base.extend({
  kind: z.literal("voice"),
  person: z.string(),
  role: z.string().optional(),
  org: z.string().optional(),
  platform: z.enum(["x", "linkedin", "site", "other"]),
  originalUrl: HttpsUrl,
});
const Policy = Base.extend({
  kind: z.literal("policy"),
  jurisdiction: Region,
  issuer: z.enum(["CMS", "PA-DOH", "NJ-DOH", "DE-DHSS", "legislature", "other"]),
  effectiveDate: z.string().optional(),
  changeType: z.enum(["rule", "guidance", "legislation", "enforcement"]),
  policyIdentity: z.object({
    jurisdiction: Region,
    session: z.string().min(1).optional(),
    instrumentId: z.string().min(1),
    versionId: z.string().min(1).optional(),
    stage: z.enum([
      "introduced", "committee", "hearing", "amended", "passed", "enacted", "floor-action",
      "proposed-rule", "final-rule", "guidance", "enforcement",
    ]),
    developmentAt: z.string().datetime(),
    historyUrl: HttpsUrl.optional(),
    textUrl: HttpsUrl.optional(),
  }).optional(),
  applicability: z.object({
    jurisdiction: Region,
    regulatedEntityTypes: z.array(z.enum([
      "hospital", "health-system", "health-care-facility", "health-care-provider",
      "insurer", "technology-vendor", "state-agency", "other",
    ])).min(1),
    evidenceSpans: z.array(z.string().min(3)).min(1),
    sourceUrl: HttpsUrl,
  }).optional(),
  advocacy: z.object({
    organization: z.string().min(1),
    position: z.enum(["support", "oppose", "concerns", "neutral"]),
    substantiveConcerns: z.array(z.string().min(3)).min(1),
    evidenceSpans: z.array(z.string().min(3)).min(1),
    sourceUrl: HttpsUrl,
  }).optional(),
  background: z.boolean().optional(),
});
const Ai = Base.extend({
  kind: z.literal("ai"),
  vendor: z.string(),
  product: z.string(),
  announcedAt: z.string().datetime(),
});
const Briefing = Base.extend({
  kind: z.literal("briefing"),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  itemIds: z.array(z.string()),
});
const Interview = Base.extend({
  kind: z.literal("interview"),
  exclusive: z.literal(true),
  guest: z.string(),
  guestOrg: z.string(),
});

export const FrozenV1Variants = { News, Event, Voice, Policy, Ai, Briefing, Interview };
const impactKinds = ["news", "policy", "ai", "interview"];
export const FrozenV1ContentItem = z.discriminatedUnion("kind", [
  News, Event, Voice, Policy, Ai, Briefing, Interview,
]).superRefine((item, ctx) => {
  if (item.status === "published" && impactKinds.includes(item.kind) && !item.impactSentence?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["impactSentence"], message: "impactSentence is required to publish news, policy, ai, or interview" });
  }
  if (item.annotations?.length && item.status !== "published") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["annotations"], message: "annotations are only allowed on published desk rows and the featured lead" });
  }
  if (item.status === "published" && item.kind === "event" && !item.registrationUrl) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["registrationUrl"], message: "registrationUrl is required to publish an event" });
  }
});
export const FrozenV1FeedDocument = z.object({
  product: z.literal("the-valley-desk"),
  version: z.literal("1"),
  generatedAt: z.string().datetime(),
  items: z.array(FrozenV1ContentItem),
});
