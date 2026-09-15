import { FrozenV1ContentItem } from "./v1-schema.ts";

// Every name, event, policy, and resource in this file is synthetic.
// Reserved .invalid URLs are never fetched. No fixture is a publication approval.
export const FIXTURE_TIME = "2026-09-12T12:00:00.000Z";
const base = {
  title: "Synthetic legacy contract example",
  dek: "Synthetic summary for an offline compatibility test.",
  body: "This synthetic example exercises a contract and does not describe an actual institution or development.",
  status: "published",
  publishedAt: "2026-09-10T12:00:00.000Z",
  updatedAt: FIXTURE_TIME,
  topics: ["synthetic-topic"],
  orgs: [],
  region: "PA",
  authors: [{ name: "Synthetic Test Author", org: "Synthetic Test Desk" }],
  hero: "/synthetic-fixture-only.png",
  source: {
    kind: "ingest",
    origin: "synthetic-legacy-source",
    url: "https://source.invalid/synthetic-example",
    fetchedAt: FIXTURE_TIME,
    externalId: "synthetic-external-id",
  },
  geo: "Synthetic location",
  impactSentence: "The synthetic example changes no real service.",
  contextSentence: "An earlier synthetic record provides test context.",
  citations: [{ name: "Synthetic evidence", url: "https://evidence.invalid/synthetic" }],
  previousSlugs: ["synthetic-previous-slug"],
  featured: false,
  annotations: [{ type: "ask", text: "Synthetic annotation." }],
  verifiedAt: FIXTURE_TIME,
  singleSource: true,
};

const details = [
  {
    kind: "news", relatedEventIds: ["synthetic-event"], relatedVoiceIds: ["synthetic-voice"],
    clockAt: FIXTURE_TIME,
  },
  {
    kind: "event", startsAt: "2026-10-10T16:00:00.000Z", endsAt: "2026-10-10T17:00:00.000Z",
    timezone: "America/New_York", venue: "Synthetic Test Venue", city: "Synthetic Test City",
    hostOrg: "Synthetic Test Host", registrationUrl: "https://registration.invalid/synthetic-event",
    format: "in-person", whyAttend: "Compare a synthetic interoperability exercise.",
    whoYoullMeet: ["Synthetic Test Speaker"], healthSystemRelevance: "Synthetic regional workflow.",
    relatedOrgIds: ["synthetic-org"], relatedProductIds: ["synthetic-product"],
    registrationDeadline: "2026-10-09T16:00:00.000Z", partner: "chapter", autoPublish: false,
    cancelled: false,
  },
  {
    kind: "voice", person: "Synthetic Test Person", role: "Synthetic Test Role",
    org: "Synthetic Test Organization", platform: "site", originalUrl: "https://voice.invalid/synthetic",
  },
  {
    kind: "policy", jurisdiction: "PA", issuer: "legislature", effectiveDate: "2027-01-01",
    changeType: "legislation",
    policyIdentity: {
      jurisdiction: "PA", session: "synthetic-session", instrumentId: "SYNTHETIC-HB-1",
      versionId: "SYNTHETIC-PN-1", stage: "floor-action", developmentAt: FIXTURE_TIME,
      historyUrl: "https://policy.invalid/synthetic-history", textUrl: "https://policy.invalid/synthetic-text",
    },
    applicability: {
      jurisdiction: "PA", regulatedEntityTypes: ["hospital"],
      evidenceSpans: ["Synthetic hospitals only."], sourceUrl: "https://policy.invalid/synthetic-text",
    },
    advocacy: {
      organization: "Synthetic Test Association", position: "concerns",
      substantiveConcerns: ["Synthetic concern."], evidenceSpans: ["Synthetic concern."],
      sourceUrl: "https://advocacy.invalid/synthetic-position",
    },
    background: false,
  },
  {
    kind: "ai", vendor: "Synthetic Test Vendor", product: "Synthetic Test Product",
    announcedAt: FIXTURE_TIME,
  },
  { kind: "briefing", windowStart: "2026-09-11T12:00:00.000Z", windowEnd: FIXTURE_TIME, itemIds: ["synthetic-news"] },
  { kind: "interview", exclusive: true, guest: "Synthetic Test Guest", guestOrg: "Synthetic Test Organization" },
];

export const syntheticV1Items = details.map((item) => FrozenV1ContentItem.parse({
  ...base,
  ...item,
  id: `synthetic-${item.kind}`,
  slug: `synthetic-${item.kind}`,
  source: { ...base.source, url: `https://source.invalid/synthetic-${item.kind}` },
  previousSlugs: [`synthetic-${item.kind}-old`],
}));
