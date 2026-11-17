import { z } from "zod";

export const DISCOVERY_SCHEMA_VERSION = "discovery-v1" as const;
export const DISCOVERY_COUNTY_KEYS = [
  "PA:Bucks",
  "PA:Chester",
  "PA:Delaware",
  "PA:Montgomery",
  "PA:Philadelphia",
  "NJ:Burlington",
  "NJ:Camden",
  "NJ:Gloucester",
  "NJ:Mercer",
] as const;
export const DISCOVERY_PROVIDERS = [
  "github",
  "pubmed",
  "crossref",
  "arxiv",
  "forum",
  "institutional",
] as const;
export const DISCOVERY_LIMITS = {
  defaultPageSize: 25,
  maxPageSize: 100,
  maxQueryCharacters: 200,
  maxTerms: 12,
  maxFacetValues: 20,
  maxCursorLifetimeMs: 900000,
  maxEnvelopeBytes: 262144,
  maxDependencies: 512,
  maxPageObservations: 100,
  maxEvidenceRefs: 128,
} as const;
export const DiscoveryId = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
export type DiscoveryId = z.infer<typeof DiscoveryId>;
export const Revision = z.number().int().safe().positive();
export type Revision = z.infer<typeof Revision>;
const nonnegative = z.number().int().safe().nonnegative();
const bounded = (max: number) => z.string().min(1).max(max);
const refList = () =>
  z
    .array(RevisionRef)
    .max(DISCOVERY_LIMITS.maxEvidenceRefs)
    .refine(
      (a) => new Set(a.map((x) => `${x.id}\0${x.revision}`)).size === a.length,
      "duplicate reference",
    );
export const RevisionRef = z
  .object({ id: DiscoveryId, revision: Revision })
  .strict();
export type RevisionRef = z.infer<typeof RevisionRef>;
export const DiscoverySubject = z
  .object({
    kind: z.enum(["person", "organization", "account", "project", "artifact"]),
    id: DiscoveryId,
  })
  .strict();
export type DiscoverySubject = z.infer<typeof DiscoverySubject>;
export const ProviderIdentity = z
  .object({
    provider: z.enum(DISCOVERY_PROVIDERS),
    installation: DiscoveryId,
    nativeId: bounded(512).refine((x) => !/[\x00-\x1f\x7f]/.test(x)),
    kind: DiscoverySubject.shape.kind,
  })
  .strict();
export type ProviderIdentity = z.infer<typeof ProviderIdentity>;
export const ReviewTarget = z.union([
  z
    .object({
      kind: z.literal("creator"),
      subject: z
        .object({ kind: z.enum(["person", "organization"]), id: DiscoveryId })
        .strict(),
      revision: Revision,
    })
    .strict(),
  z
    .object({
      kind: z.literal("work"),
      subject: z
        .object({ kind: z.enum(["project", "artifact"]), id: DiscoveryId })
        .strict(),
      revision: Revision,
    })
    .strict(),
  z
    .object({ kind: z.literal("claim"), id: DiscoveryId, revision: Revision })
    .strict(),
  z
    .object({
      kind: z.literal("relationship"),
      id: DiscoveryId,
      revision: Revision,
    })
    .strict(),
]);
export type ReviewTarget = z.infer<typeof ReviewTarget>;
export const DecisionAuthority = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("authenticated-reviewer"),
      principalId: DiscoveryId,
      authenticationContextId: DiscoveryId,
    })
    .strict(),
  z
    .object({
      kind: z.literal("qualified-rule"),
      rule: RevisionRef,
      qualification: RevisionRef,
    })
    .strict(),
]);
export type DecisionAuthority = z.infer<typeof DecisionAuthority>;

const isLeapYear = (y: number) =>
  y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
const daysInMonth = (y: number, m: number) =>
  [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    m - 1
  ] ?? 0;
const pad = (n: number, l = 2) => String(n).padStart(l, "0");
function isValidCalendarDay(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = m.slice(1).map(Number);
  return (
    y >= 1 &&
    y <= 9999 &&
    mo >= 1 &&
    mo <= 12 &&
    d >= 1 &&
    d <= daysInMonth(y, mo)
  );
}
function instantEpochMs(s: string): number | null {
  const m =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      s,
    );
  if (!m || !isValidCalendarDay(m[1])) return null;
  const hh = +m[2],
    mm = +m[3],
    ss = +m[4];
  if (hh > 23 || mm > 59 || ss > 59) return null;
  let offset = 0;
  if (m[6] !== "Z") {
    const oh = +m[6].slice(1, 3),
      om = +m[6].slice(4);
    if (oh > 23 || om > 59) return null;
    offset = (oh * 60 + om) * (m[6][0] === "+" ? 1 : -1);
  }
  const [y, mo, d] = m[1].split("-").map(Number);
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);
  dt.setUTCHours(hh, mm, ss, +(m[5] || "").padEnd(3, "0"));
  const result = dt.getTime() - offset * 60000;
  return Number.isSafeInteger(result) ? result : null;
}
export const DiscoveryInstant = z
  .string()
  .refine((x) => instantEpochMs(x) !== null, "invalid RFC3339 instant");
export type DiscoveryInstant = z.infer<typeof DiscoveryInstant>;
export const DiscoveryPublicUrl = z
  .string()
  .max(2048)
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === "https:" && !u.username && !u.password && !u.hash;
    } catch {
      return false;
    }
  });
export type DiscoveryPublicUrl = z.infer<typeof DiscoveryPublicUrl>;
const rawDate = z.union([
  z
    .object({
      precision: z.literal("unknown"),
      reportedValue: z.string().min(1).max(200).nullable(),
    })
    .strict(),
  z
    .object({
      precision: z.enum(["year", "month", "day"]),
      value: z.string(),
      calendar: z.literal("proleptic-gregorian"),
      lowerDate: z.string(),
      upperDate: z.string(),
    })
    .strict(),
  z
    .object({
      precision: z.literal("instant"),
      value: z.string(),
      lowerEpochMs: z.number().int().safe(),
      upperEpochMs: z.number().int().safe(),
    })
    .strict(),
]);
type RawDate = z.infer<typeof rawDate>;
export function makeDiscoveryDate(
  precision: RawDate["precision"],
  value: string | null,
): RawDate {
  if (precision === "unknown")
    return rawDate.parse({ precision, reportedValue: value });
  if (value === null) throw new Error("date value required");
  if (precision === "instant") {
    const n = instantEpochMs(value);
    if (n === null) throw new Error("invalid instant");
    return { precision, value, lowerEpochMs: n, upperEpochMs: n + 1 };
  }
  const re =
    precision === "year"
      ? /^\d{4}$/
      : precision === "month"
        ? /^\d{4}-\d{2}$/
        : /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(value)) throw new Error("invalid date precision");
  const [y, m = 1, d = 1] = value.split("-").map(Number);
  if (y < 1 || y > 9998 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m))
    throw new Error("invalid calendar date");
  const lo = `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
  let yy = y,
    mo = m,
    day = d;
  if (precision === "year") {
    yy++;
    mo = 1;
    day = 1;
  } else if (precision === "month") {
    mo++;
    day = 1;
    if (mo === 13) {
      yy++;
      mo = 1;
    }
  } else {
    day++;
    if (day > daysInMonth(yy, mo)) {
      day = 1;
      mo++;
      if (mo === 13) {
        yy++;
        mo = 1;
      }
    }
  }
  return {
    precision,
    value,
    calendar: "proleptic-gregorian",
    lowerDate: lo,
    upperDate: `${pad(yy, 4)}-${pad(mo)}-${pad(day)}`,
  };
}
export const DiscoveryDate = rawDate.superRefine((d, ctx) => {
  try {
    if (
      JSON.stringify(d) !==
      JSON.stringify(
        makeDiscoveryDate(
          d.precision,
          d.precision === "unknown" ? d.reportedValue : d.value,
        ),
      )
    )
      ctx.addIssue({ code: "custom", message: "date bounds mismatch" });
  } catch {
    ctx.addIssue({ code: "custom", message: "invalid date" });
  }
});
export type DiscoveryDate = z.infer<typeof DiscoveryDate>;
export function discoveryDateContained(
  date: DiscoveryDate,
  fromDate: string,
  untilDate: string,
): boolean {
  const d = DiscoveryDate.parse(date);
  if (
    !isValidCalendarDay(fromDate) ||
    !isValidCalendarDay(untilDate) ||
    fromDate >= untilDate
  )
    throw new Error("invalid date filter");
  if (d.precision === "unknown") return false;
  if (d.precision === "instant")
    return (
      d.lowerEpochMs >= instantEpochMs(`${fromDate}T00:00:00Z`)! &&
      d.upperEpochMs <= instantEpochMs(`${untilDate}T00:00:00Z`)!
    );
  return d.lowerDate >= fromDate && d.upperDate <= untilDate;
}

export const DEPENDENCY_KINDS = [
  "evidence-observation",
  "claim",
  "decision",
  "relationship",
  "endpoint",
  "identity-resolution",
  "rights-assessment",
  "source-enrollment",
  "source-configuration",
  "source-qualification",
  "source-permission",
  "verification-rule",
  "geographic-policy",
  "relevance-policy",
  "review-policy",
  "public-field-policy",
  "projection-generation",
  "currentness",
] as const;
export const DependencyKey = z
  .object({ kind: z.enum(DEPENDENCY_KINDS), id: DiscoveryId })
  .strict();
export type DependencyKey = z.infer<typeof DependencyKey>;
export const DependencyRevision = DependencyKey.extend({
  revision: Revision,
  role: z.enum(["commit-guard", "validity"]),
  expiresAt: DiscoveryInstant.optional(),
})
  .strict()
  .refine(
    (x) => (x.kind === "projection-generation") === (x.role === "commit-guard"),
    "dependency role mismatch",
  );
export type DependencyRevision = z.infer<typeof DependencyRevision>;
const depKey = (x: { kind: string; id: string }) => `${x.kind}\0${x.id}`;
export const DependencyVector = z
  .object({
    entries: z
      .array(DependencyRevision)
      .min(1)
      .max(DISCOVERY_LIMITS.maxDependencies),
    required: z
      .array(DependencyKey)
      .min(1)
      .max(DISCOVERY_LIMITS.maxDependencies),
  })
  .strict()
  .superRefine((v, ctx) => {
    const a = v.entries.map(depKey),
      b = v.required.map(depKey);
    if (
      new Set(a).size !== a.length ||
      new Set(b).size !== b.length ||
      a.length !== b.length ||
      a.some((k) => !b.includes(k))
    )
      ctx.addIssue({
        code: "custom",
        message: "dependency keys must be unique and match exactly",
      });
  });
export type DependencyVector = z.infer<typeof DependencyVector>;
export const DiscoveryReviewDecision = z
  .object({
    schemaVersion: z.literal(DISCOVERY_SCHEMA_VERSION),
    id: DiscoveryId,
    revision: Revision,
    target: ReviewTarget,
    decision: z.enum(["accepted", "held", "rejected"]),
    authority: DecisionAuthority,
    reason: bounded(2000),
    policy: RevisionRef,
    evidence: refList().refine((x) => x.length > 0),
    expectedDependencies: DependencyVector,
    supersedes: RevisionRef.optional(),
    operationId: DiscoveryId,
    decidedAt: DiscoveryInstant,
  })
  .strict();
export type DiscoveryReviewDecision = z.infer<typeof DiscoveryReviewDecision>;
const permission = z.enum(["allow", "deny", "unknown"]);
export const ArtifactRightsAssessment = z
  .object({
    schemaVersion: z.literal(DISCOVERY_SCHEMA_VERSION),
    id: DiscoveryId,
    revision: Revision,
    artifactId: DiscoveryId,
    artifactVersion: bounded(200),
    material: z.enum([
      "metadata",
      "code",
      "text",
      "figures",
      "data",
      "weights",
      "forum-content",
    ]),
    classification: z.enum(["permitted", "restricted", "unknown"]),
    permissions: z
      .object({
        fetch: permission,
        retain: permission,
        transform: permission,
        display: permission,
        reuse: permission,
      })
      .strict(),
    evidence: refList(),
    sourceUrl: DiscoveryPublicUrl.optional(),
    terms: bounded(2000).optional(),
    policy: RevisionRef,
    assessedAt: DiscoveryInstant,
  })
  .strict()
  .refine(
    (x) => x.classification !== "permitted" || x.evidence.length > 0,
    "permitted requires evidence",
  );
export type ArtifactRightsAssessment = z.infer<typeof ArtifactRightsAssessment>;
export const PublicRowRef = z
  .object({
    kind: z.enum(["work", "person", "organization"]),
    subjectId: DiscoveryId,
    rowId: DiscoveryId,
    revision: Revision,
  })
  .strict();
export type PublicRowRef = z.infer<typeof PublicRowRef>;
export const DiscoveryPublicRevision = z
  .object({
    schemaVersion: z.literal(DISCOVERY_SCHEMA_VERSION),
    row: PublicRowRef,
    generation: nonnegative,
    dependencies: DependencyVector,
    decision: RevisionRef,
    publishedAt: DiscoveryInstant,
    expiresAt: DiscoveryInstant,
  })
  .strict()
  .refine(
    (x) =>
      instantEpochMs(x.expiresAt)! > instantEpochMs(x.publishedAt)! &&
      !validityExpiresBefore(x.dependencies.entries, x.expiresAt),
  );
export type DiscoveryPublicRevision = z.infer<typeof DiscoveryPublicRevision>;
function validityExpiresBefore(
  entries: DependencyVector["entries"],
  expiresAt: string,
): boolean {
  const expiry = instantEpochMs(expiresAt)!;
  return entries.some(
    (entry) =>
      entry.role === "validity" &&
      entry.expiresAt !== undefined &&
      expiry > instantEpochMs(entry.expiresAt)!,
  );
}

function canonicalQueriesEqual(
  a: CanonicalDiscoveryQuery,
  b: CanonicalDiscoveryQuery,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const sortedUnique = (a: string[]) =>
  a.every((x, i) => i === 0 || a[i - 1] < x);
const facets = z
  .object({
    counties: z
      .array(z.enum(DISCOVERY_COUNTY_KEYS))
      .max(DISCOVERY_LIMITS.maxFacetValues),
    topics: z.array(DiscoveryId).max(DISCOVERY_LIMITS.maxFacetValues),
    providers: z
      .array(z.enum(DISCOVERY_PROVIDERS))
      .max(DISCOVERY_LIMITS.maxFacetValues),
    kinds: z.array(DiscoveryId).max(DISCOVERY_LIMITS.maxFacetValues),
    creators: z.array(DiscoveryId).max(DISCOVERY_LIMITS.maxFacetValues),
    organizations: z.array(DiscoveryId).max(DISCOVERY_LIMITS.maxFacetValues),
  })
  .strict()
  .refine(
    (x) => Object.values(x).every(sortedUnique),
    "facets must be sorted and unique",
  );
export function normalizeDiscoveryText(text: string): string {
  return text.normalize("NFKC").toLowerCase().trim().replace(/\s+/gu, " ");
}
export function discoveryTerms(text: string): string[] {
  return [...new Set(text.match(/[\p{L}\p{N}]+/gu) || [])].sort();
}
export const CanonicalDiscoveryQuery = z
  .object({
    schemaVersion: z.literal(DISCOVERY_SCHEMA_VERSION),
    entity: z.enum(["works", "people", "organizations", "projects"]),
    text: z
      .string()
      .refine(
        (value) =>
          Array.from(value).length <= DISCOVERY_LIMITS.maxQueryCharacters,
        "query text exceeds codepoint limit",
      ),
    terms: z.array(z.string().min(1)).max(DISCOVERY_LIMITS.maxTerms),
    facets,
    regionalMode: z.enum([
      "current-professional",
      "historical-professional",
      "regional-at-creation",
    ]),
    dateFilter: z
      .object({
        fromDate: z.string().refine(isValidCalendarDay),
        untilDate: z.string().refine(isValidCalendarDay),
      })
      .strict()
      .refine((x) => x.fromDate < x.untilDate)
      .nullable(),
    sort: z.enum(["relevance", "recent", "name"]),
    pageSize: z.number().int().min(1).max(DISCOVERY_LIMITS.maxPageSize),
    aliasPolicy: RevisionRef,
  })
  .strict()
  .superRefine((x, ctx) => {
    const terms = discoveryTerms(x.text);
    if (
      x.text !== normalizeDiscoveryText(x.text) ||
      JSON.stringify(terms) !== JSON.stringify(x.terms) ||
      (x.text.length > 0 && terms.length === 0)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "query text and terms must be canonical and nonempty when supplied",
      });
    const work = x.entity === "works" || x.entity === "projects";
    if (
      work
        ? x.regionalMode !== "regional-at-creation" || x.sort === "name"
        : x.regionalMode === "regional-at-creation" || x.sort === "recent"
    )
      ctx.addIssue({
        code: "custom",
        message: "unsupported entity, mode or sort",
      });
  });
export type CanonicalDiscoveryQuery = z.infer<typeof CanonicalDiscoveryQuery>;
export const DiscoverySnapshot = z
  .object({
    schemaVersion: z.literal(DISCOVERY_SCHEMA_VERSION),
    id: DiscoveryId,
    query: CanonicalDiscoveryQuery,
    generation: nonnegative,
    invalidationEpoch: nonnegative,
    recoveryIncarnation: DiscoveryId,
    asOf: DiscoveryInstant,
    expiresAt: DiscoveryInstant,
    rows: z.array(PublicRowRef).max(10000),
    dependencies: DependencyVector,
  })
  .strict()
  .superRefine((x, ctx) => {
    const keys = x.rows.map((r) => `${r.kind}\0${r.subjectId}`),
      ids = x.rows.map((r) => r.rowId);
    const allowed =
      x.query.entity === "people"
        ? "person"
        : x.query.entity === "organizations"
          ? "organization"
          : "work";
    if (
      new Set(keys).size !== keys.length ||
      new Set(ids).size !== ids.length ||
      x.rows.some((r) => r.kind !== allowed)
    )
      ctx.addIssue({
        code: "custom",
        message: "snapshot rows duplicate or incompatible with query",
      });
    const a = instantEpochMs(x.asOf)!,
      e = instantEpochMs(x.expiresAt)!;
    if (
      e <= a ||
      e - a > DISCOVERY_LIMITS.maxCursorLifetimeMs ||
      validityExpiresBefore(x.dependencies.entries, x.expiresAt)
    )
      ctx.addIssue({ code: "custom", message: "invalid snapshot expiry" });
  });
export type DiscoverySnapshot = z.infer<typeof DiscoverySnapshot>;
export const DiscoveryCursor = z
  .object({
    schemaVersion: z.literal(DISCOVERY_SCHEMA_VERSION),
    tokenId: DiscoveryId,
    snapshotId: DiscoveryId,
    query: CanonicalDiscoveryQuery,
    recoveryIncarnation: DiscoveryId,
    afterRowId: DiscoveryId.nullable(),
  })
  .strict();
export type DiscoveryCursor = z.infer<typeof DiscoveryCursor>;
export const DiscoveryContinuationResult = z.union([
  z.object({ status: z.literal(200), kind: z.literal("valid") }).strict(),
  z
    .object({
      status: z.literal(400),
      kind: z.literal("discovery-cursor-mismatch"),
    })
    .strict(),
  z
    .object({
      status: z.literal(410),
      kind: z.enum([
        "discovery-snapshot-invalidated",
        "discovery-snapshot-expired",
      ]),
      restart: z.literal(true),
    })
    .strict(),
]);
export type DiscoveryContinuationResult = z.infer<
  typeof DiscoveryContinuationResult
>;
const continuationCurrent = z
  .object({
    query: CanonicalDiscoveryQuery,
    invalidationEpoch: nonnegative,
    recoveryIncarnation: DiscoveryId,
    now: DiscoveryInstant,
  })
  .strict();
export function checkDiscoveryContinuation(
  snapshot: unknown,
  cursor: unknown,
  current: unknown,
): DiscoveryContinuationResult {
  const s = DiscoverySnapshot.safeParse(snapshot),
    c = DiscoveryCursor.safeParse(cursor),
    n = continuationCurrent.safeParse(current);
  if (!s.success || !c.success || !n.success)
    return { status: 400, kind: "discovery-cursor-mismatch" };
  const a = s.data,
    b = c.data,
    v = n.data;
  if (
    instantEpochMs(v.now)! < instantEpochMs(a.asOf)! ||
    b.snapshotId !== a.id ||
    !canonicalQueriesEqual(b.query, a.query) ||
    !canonicalQueriesEqual(v.query, a.query) ||
    (b.afterRowId !== null && !a.rows.some((r) => r.rowId === b.afterRowId))
  )
    return { status: 400, kind: "discovery-cursor-mismatch" };
  if (
    b.recoveryIncarnation !== a.recoveryIncarnation ||
    v.recoveryIncarnation !== a.recoveryIncarnation ||
    v.invalidationEpoch !== a.invalidationEpoch
  )
    return {
      status: 410,
      kind: "discovery-snapshot-invalidated",
      restart: true,
    };
  if (instantEpochMs(v.now)! >= instantEpochMs(a.expiresAt)!)
    return { status: 410, kind: "discovery-snapshot-expired", restart: true };
  return { status: 200, kind: "valid" };
}
