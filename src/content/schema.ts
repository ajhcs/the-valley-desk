import { z } from 'zod'

/**
 * The Valley Desk content envelope.
 *
 * One schema for humans and agents. Do not add a second agent-only shape.
 * FeedDocument.items[] is ContentItem[] (published only).
 */

export const contentStatusSchema = z.enum(['draft', 'review', 'published'])
export const regionSchema = z.enum(['PA', 'NJ', 'DE', 'regional', 'federal'])
export const sourceKindSchema = z.enum(['editorial', 'ingest'])
export const eventPartnerSchema = z.enum([
  'dvhimss',
  'chapter',
  'health-system',
  'vendor',
  'other',
])
export const voicePlatformSchema = z.enum(['x', 'linkedin', 'site', 'other'])
export const policyIssuerSchema = z.enum([
  'CMS',
  'PA-DOH',
  'NJ-DOH',
  'DE-DHSS',
  'legislature',
  'other',
])
export const policyChangeTypeSchema = z.enum([
  'rule',
  'guidance',
  'legislation',
  'enforcement',
])
export const contentKindSchema = z.enum([
  'news',
  'event',
  'voice',
  'policy',
  'ai',
  'briefing',
  'interview',
])

export const authorSchema = z.object({
  name: z.string().min(1),
  org: z.string().min(1).optional(),
})

export const heroSchema = z.object({
  src: z.string().min(1).optional(),
  alt: z.string().min(1),
})

export const sourceSchema = z.object({
  kind: sourceKindSchema,
  origin: z.string().min(1),
  url: z.string().url().optional(),
  fetchedAt: z.iso.datetime().optional(),
  externalId: z.string().min(1).optional(),
})

export const editorialSourceSchema = sourceSchema.extend({
  kind: z.literal('editorial'),
})

export const citationSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
})

export const IMPACT_PUBLISH_KINDS = ['news', 'policy', 'ai', 'interview'] as const

const contentBaseSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  dek: z.string().min(1),
  body: z.string().min(1),
  status: contentStatusSchema,
  publishedAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime(),
  topics: z.array(z.string().min(1)),
  orgs: z.array(z.string().min(1)),
  region: regionSchema,
  authors: z.array(authorSchema).min(1),
  hero: heroSchema.optional(),
  source: sourceSchema,
  impactSentence: z.string().min(1).optional(),
  geo: z.string().min(1).optional(),
  citations: z.array(citationSchema).optional(),
})

export const newsItemSchema = contentBaseSchema.extend({
  kind: z.literal('news'),
  relatedEventIds: z.array(z.string()),
  relatedVoiceIds: z.array(z.string()),
})

export const eventItemSchema = contentBaseSchema.extend({
  kind: z.literal('event'),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().optional(),
  timezone: z.string().min(1),
  venue: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  hostOrg: z.string().min(1),
  registrationUrl: z.string().url().optional(),
  partner: eventPartnerSchema,
  autoPublish: z.boolean(),
})

export const voiceItemSchema = contentBaseSchema.extend({
  kind: z.literal('voice'),
  person: z.string().min(1),
  role: z.string().min(1).optional(),
  org: z.string().min(1).optional(),
  platform: voicePlatformSchema,
  originalUrl: z.string().url(),
})

export const policyItemSchema = contentBaseSchema.extend({
  kind: z.literal('policy'),
  jurisdiction: z.string().min(1),
  issuer: policyIssuerSchema,
  effectiveDate: z.iso.date().optional(),
  changeType: policyChangeTypeSchema,
})

export const aiItemSchema = contentBaseSchema.extend({
  kind: z.literal('ai'),
  vendor: z.string().min(1),
  product: z.string().min(1),
  announcedAt: z.iso.datetime(),
})

export const briefingItemSchema = contentBaseSchema.extend({
  kind: z.literal('briefing'),
  windowStart: z.iso.datetime(),
  windowEnd: z.iso.datetime(),
  itemIds: z.array(z.string().min(1)),
})

/** Interviews are editorial-only. Ingest must never auto-publish them. */
export const interviewItemSchema = contentBaseSchema.extend({
  kind: z.literal('interview'),
  exclusive: z.literal(true),
  guest: z.string().min(1),
  guestOrg: z.string().min(1),
  source: editorialSourceSchema,
})

const contentItemUnionSchema = z.discriminatedUnion('kind', [
  newsItemSchema,
  eventItemSchema,
  voiceItemSchema,
  policyItemSchema,
  aiItemSchema,
  briefingItemSchema,
  interviewItemSchema,
])

export const contentItemSchema = contentItemUnionSchema.superRefine((item, ctx) => {
  if (
    item.status === 'published' &&
    (item.kind === 'news' ||
      item.kind === 'policy' ||
      item.kind === 'ai' ||
      item.kind === 'interview') &&
    !item.impactSentence
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['impactSentence'],
      message: 'impactSentence is required to publish news|policy|ai|interview',
    })
  }
})

export const feedDocumentSchema = z.object({
  product: z.literal('the-valley-desk'),
  version: z.literal('1'),
  generatedAt: z.iso.datetime(),
  items: z.array(contentItemSchema),
})

export type ContentStatus = z.infer<typeof contentStatusSchema>
export type Region = z.infer<typeof regionSchema>
export type SourceKind = z.infer<typeof sourceKindSchema>
export type EventPartner = z.infer<typeof eventPartnerSchema>
export type VoicePlatform = z.infer<typeof voicePlatformSchema>
export type PolicyIssuer = z.infer<typeof policyIssuerSchema>
export type PolicyChangeType = z.infer<typeof policyChangeTypeSchema>
export type ContentKind = z.infer<typeof contentKindSchema>
export type Author = z.infer<typeof authorSchema>
export type Hero = z.infer<typeof heroSchema>
export type Source = z.infer<typeof sourceSchema>
export type Citation = z.infer<typeof citationSchema>
export type NewsItem = z.infer<typeof newsItemSchema>
export type EventItem = z.infer<typeof eventItemSchema>
export type VoiceItem = z.infer<typeof voiceItemSchema>
export type PolicyItem = z.infer<typeof policyItemSchema>
export type AiItem = z.infer<typeof aiItemSchema>
export type BriefingItem = z.infer<typeof briefingItemSchema>
export type InterviewItem = z.infer<typeof interviewItemSchema>
export type ContentItem = z.infer<typeof contentItemSchema>
export type FeedDocument = z.infer<typeof feedDocumentSchema>

export const CONTENT_KINDS = contentKindSchema.options
export const PUBLIC_SECTION_KINDS = [
  'news',
  'event',
  'voice',
  'policy',
  'ai',
  'briefing',
] as const satisfies ReadonlyArray<Exclude<ContentKind, 'interview'>>
