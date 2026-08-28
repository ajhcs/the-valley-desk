import { z } from "zod";
import coverageDoc from "../../fixtures/coverage-pack-v1.json";
import linkedInInventoryDoc from "../../fixtures/linkedin-notification-targets.json";
import { ENTITY_BOUNDARY } from "../content/entity";
import { normalizeSourceUrl } from "./identity";
import {
  LEADERSHIP_CANDIDATE_CAP,
  LEADERSHIP_CONCURRENCY,
  LEADERSHIP_MAX_BYTES,
  LEADERSHIP_MAX_REDIRECTS,
  LEADERSHIP_TIMEOUT_MS,
  SOURCE_KIND_PRECEDENCE,
} from "./leadership-config";

export const COVERAGE_PACK_SCHEMA_VERSION = 1;
export const FIRST_WAVE_COVERED_SHORT_NAMES = [
  "Penn",
  "Jefferson",
  "Main Line",
  "CHOP",
  "Cooper",
  "ChristianaCare",
  "Temple",
  "Virtua",
  "Tower",
  "Inspira",
  "LVHN",
  "Penn Princeton",
  "Penn Doylestown",
  "Nemours",
  "RWJBarnabas",
  "St. Luke's",
] as const;

const HttpsUrl = z.string().url().refine((value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}, "URL must be credential-free HTTPS");

const CoverageTier = z.enum(["core", "extended", "inventory"]);
const SourceKind = z.enum([
  "leadership-page",
  "about-page",
  "person-bio",
  "newsroom-bio",
  "linkedin-organization",
  "linkedin-person",
]);
const SourceCadence = z.enum(["hourly", "daily", "weekly", "inventory"]);
const SourceStatus = z.enum(["enabled", "inventory-only", "disabled"]);
const Region = z.enum(["PA", "NJ", "DE"]);

export const CoverageInstitution = z.object({
  id: z.string().regex(/^inst-[a-z0-9-]+$/),
  name: z.string().min(1),
  shortName: z.string().min(1),
  orgIds: z.array(z.string().min(1)),
  regions: z.array(Region).min(1),
  coverageTier: CoverageTier,
  covered: z.boolean(),
  inBox: z.boolean(),
  edge: z.boolean(),
  aliases: z.array(z.string().min(1)).min(1),
  website: HttpsUrl.optional(),
  linkedinNames: z.array(z.string().min(1)).default([]),
});

const CoverageSourceBase = z.object({
  id: z.string().regex(/^src-[a-z0-9-]+$/),
  institutionId: z.string().regex(/^inst-[a-z0-9-]+$/),
  kind: SourceKind,
  url: HttpsUrl,
  host: z.string().min(1),
  precedence: z.number().int().min(0).max(100),
  monitor: z.boolean(),
  cadence: SourceCadence,
  status: SourceStatus,
});

const LinkedInUrl = HttpsUrl.refine((value) => {
  try {
    return isLinkedInHost(new URL(value).hostname);
  } catch {
    return false;
  }
}, "URL must be a LinkedIn HTTPS URL");

export const CoverageSource = CoverageSourceBase.superRefine((source, ctx) => {
  let sourceHost = "";
  try {
    sourceHost = new URL(source.url).hostname.replace(/\.$/, "").toLowerCase();
  } catch {
    // HttpsUrl already reports malformed URLs.
  }
  const declaredHost = source.host.replace(/^www\./, "").replace(/\.$/, "").toLowerCase();
  const canonicalSourceHost = sourceHost.replace(/^www\./, "");
  if (sourceHost && declaredHost !== canonicalSourceHost) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Source host must match source URL host", path: ["host"] });
  }
  if (source.kind.startsWith("linkedin") && !isLinkedInHost(source.host)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "LinkedIn sources must use a LinkedIn host", path: ["host"] });
  }
  if (isLinkedInHost(source.host) && source.monitor) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "LinkedIn hosts cannot be monitored", path: ["monitor"] });
  }
  if (source.kind.startsWith("linkedin")) {
    if (source.monitor) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "LinkedIn sources cannot be monitored", path: ["monitor"] });
    }
    if (source.status !== "inventory-only" || source.cadence !== "inventory") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "LinkedIn sources must remain inventory-only",
        path: ["status"],
      });
    }
  }
  if (source.monitor && source.status !== "enabled") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Monitored sources must be enabled", path: ["status"] });
  }
  if (source.monitor && source.kind.startsWith("linkedin")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "LinkedIn hosts are blocked", path: ["kind"] });
  }
});

export const CoveragePerson = z.object({
  id: z.string().regex(/^person-[a-z0-9-]+$/),
  displayName: z.string().min(1),
  aliases: z.array(z.string().min(1)).min(1),
  institutionIds: z.array(z.string().regex(/^inst-[a-z0-9-]+$/)).min(1),
  knownTitle: z.string().min(1).optional(),
  sourceIds: z.array(z.string().min(1)).optional(),
  linkedinUrl: LinkedInUrl.optional(),
});

export const CoverageGeography = z.object({
  label: z.string().min(1),
  states: z.tuple([z.literal("PA"), z.literal("NJ"), z.literal("DE")]),
  counties: z.object({
    PA: z.array(z.string().min(1)).min(1),
    NJ: z.array(z.string().min(1)).min(1),
    DE: z.array(z.string().min(1)).min(1),
  }),
  edgeOnly: z.array(z.string().min(1)),
});

export const CoveragePackDocument = z.object({
  schemaVersion: z.literal(COVERAGE_PACK_SCHEMA_VERSION),
  packId: z.string().min(1),
  asOf: z.string().min(1),
  source: z.string().min(1),
  notes: z.array(z.string().min(1)),
  geography: CoverageGeography,
  blockedHosts: z.array(z.string().min(1)),
  institutions: z.array(CoverageInstitution).min(16),
  sources: z.array(CoverageSource),
  people: z.array(CoveragePerson),
}).superRefine((pack, ctx) => {
  const institutionIds = new Set(pack.institutions.map((row) => row.id));
  const sourceIds = new Set<string>();
  const covered = pack.institutions.filter((row) => row.covered);
  if (covered.length !== 16) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Coverage pack must declare exactly 16 covered institutions" });
  }
  const shortNames = covered.map((row) => row.shortName);
  if (new Set(shortNames).size !== shortNames.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Covered short names must be unique" });
  }
  for (const expected of FIRST_WAVE_COVERED_SHORT_NAMES) {
    if (!shortNames.includes(expected)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Missing covered system ${expected}` });
    }
  }
  if (new Set(pack.institutions.map((row) => row.id)).size !== pack.institutions.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Institution ids must be unique" });
  }
  for (const source of pack.sources) {
    if (sourceIds.has(source.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate source id ${source.id}` });
    }
    sourceIds.add(source.id);
    if (!institutionIds.has(source.institutionId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown institution ${source.institutionId}`, path: ["sources"] });
    }
  }
  const sourceUrls = new Set<string>();
  for (const source of pack.sources) {
    const normalized = normalizeSourceUrl(source.url);
    if (!normalized) continue;
    if (sourceUrls.has(normalized)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate normalized source URL ${normalized}`, path: ["sources"] });
    }
    sourceUrls.add(normalized);
  }
  const personIds = new Set<string>();
  for (const person of pack.people) {
    if (personIds.has(person.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate person id ${person.id}` });
    }
    personIds.add(person.id);
    for (const institutionId of person.institutionIds) {
      if (!institutionIds.has(institutionId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown institution ${institutionId}`, path: ["people"] });
      }
    }
    for (const sourceId of person.sourceIds ?? []) {
      if (!sourceIds.has(sourceId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown source ${sourceId}`, path: ["people"] });
      }
    }
  }
  for (const host of pack.blockedHosts) {
    if (!isLinkedInHost(host)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unexpected blocked host ${host}` });
    }
  }
});

const LinkedInInventory = z.object({
  version: z.number().int().positive(),
  organizations: z.array(z.object({
    name: z.string().min(1),
    url: LinkedInUrl,
    orgs: z.array(z.string()),
    region: z.string().min(1),
    tier: z.enum(["core", "extended"]),
  })),
  people: z.array(z.object({
    name: z.string().min(1),
    url: LinkedInUrl,
    orgs: z.array(z.string()),
  })),
});

export type CoverageInstitution = z.infer<typeof CoverageInstitution>;
export type CoverageSource = z.infer<typeof CoverageSource>;
export type CoveragePerson = z.infer<typeof CoveragePerson>;
export type CoveragePackDocument = z.infer<typeof CoveragePackDocument>;
export type CoverageGeography = z.infer<typeof CoverageGeography>;
export type SourceKind = z.infer<typeof SourceKind>;

function hostFromUrl(url: string) {
  return new URL(url).hostname.replace(/\.$/, "").toLowerCase();
}

export function isLinkedInHost(hostname: string) {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  return host === "linkedin.com" || host === "lnkd.in" || host.endsWith(".linkedin.com");
}

function slugFromUrl(url: string) {
  const parsed = new URL(url);
  const last = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean).at(-1) ?? "page";
  return last.toLowerCase().replace(/%[0-9a-f]{2}/g, "-").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "page";
}

function withHost(source: Omit<CoverageSource, "host"> & { host?: string }): Omit<CoverageSource, never> {
  return {
    ...source,
    host: source.host ?? hostFromUrl(source.url),
  };
}

function linkedinSource(kind: "linkedin-organization" | "linkedin-person", institutionId: string, url: string): CoverageSource {
  return CoverageSource.parse(withHost({
    id: `src-linkedin-${kind === "linkedin-organization" ? "org" : "person"}-${slugFromUrl(url)}`.slice(0, 80),
    institutionId,
    kind,
    url,
    precedence: SOURCE_KIND_PRECEDENCE[kind],
    monitor: false,
    cadence: "inventory",
    status: "inventory-only",
  }));
}

export function institutionForLinkedInName(institutions: readonly CoverageInstitution[], name: string) {
  return institutions.find((institution) => institution.linkedinNames.includes(name));
}

function assembleCoveragePack(
  document: unknown,
  inventory: unknown,
): CoveragePackDocument {
  const base = z.object({
    schemaVersion: z.literal(COVERAGE_PACK_SCHEMA_VERSION),
    packId: z.string().min(1),
    asOf: z.string().min(1),
    source: z.string().min(1),
    notes: z.array(z.string().min(1)),
    geography: CoverageGeography,
    blockedHosts: z.array(z.string().min(1)),
    institutions: z.array(CoverageInstitution).min(16),
    sources: z.array(CoverageSourceBase.omit({ host: true }).extend({ host: z.string().min(1).optional() })),
    people: z.array(CoveragePerson),
  }).parse(document);
  const linkedin = LinkedInInventory.parse(inventory);

  const sources = base.sources.map((source) => CoverageSource.parse(withHost(source)));
  const seenUrls = new Set(sources.map((source) => normalizeSourceUrl(source.url) ?? source.url));
  const people = [...base.people];

  for (const org of linkedin.organizations) {
    const institution = institutionForLinkedInName(base.institutions, org.name);
    if (!institution) {
      throw new Error(`LinkedIn inventory org ${org.name} is not mapped to a coverage-pack institution`);
    }
    const source = linkedinSource("linkedin-organization", institution.id, org.url);
    const key = normalizeSourceUrl(source.url) ?? source.url;
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);
    sources.push(source);
  }

  for (const row of linkedin.people) {
    const person = people.find((entry) => (
      entry.displayName === row.name
      || entry.aliases.includes(row.name)
      || entry.linkedinUrl === row.url
    ));
    const institutionId = person?.institutionIds[0] ?? institutionForLinkedInName(
      base.institutions,
      row.orgs[0] ?? "",
    )?.id;
    if (!institutionId) {
      const byOrgId = base.institutions.find((institution) => institution.orgIds.some((id) => row.orgs.includes(id)));
      if (!byOrgId) throw new Error(`LinkedIn inventory person ${row.name} is not mapped to a coverage-pack institution`);
      if (!person) {
        people.push({
          id: `person-${slugFromUrl(row.url)}`.slice(0, 80),
          displayName: row.name,
          aliases: [row.name],
          institutionIds: [byOrgId.id],
          linkedinUrl: row.url,
        });
      }
      const source = linkedinSource("linkedin-person", byOrgId.id, row.url);
      const key = normalizeSourceUrl(source.url) ?? source.url;
      if (!seenUrls.has(key)) {
        seenUrls.add(key);
        sources.push(source);
      }
      continue;
    }
    if (person && !person.linkedinUrl) {
      person.linkedinUrl = row.url;
    }
    const source = linkedinSource("linkedin-person", institutionId, row.url);
    const key = normalizeSourceUrl(source.url) ?? source.url;
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);
    sources.push(source);
  }

  return CoveragePackDocument.parse({
    ...base,
    sources,
    people,
  });
}

/** Assembled, versioned coverage registry. LinkedIn inventory is seeded but never fetched. */
export const coveragePack = assembleCoveragePack(coverageDoc, linkedInInventoryDoc);

export function coveredInstitutions(pack: CoveragePackDocument = coveragePack) {
  return pack.institutions.filter((institution) => institution.covered);
}

export function monitorableSources(pack: CoveragePackDocument = coveragePack) {
  return pack.sources.filter((source) => (
    source.monitor
    && source.status === "enabled"
    && !source.kind.startsWith("linkedin")
    && !isLinkedInHost(source.host)
  ));
}

export type OfficialSourceCoverage = {
  institutionId: string;
  shortName: string;
  status: "active" | "degraded";
  sourceIds: string[];
};

/**
 * Every canonical covered institution has an explicit source posture. A
 * degraded row is intentional when no verified first-party URL is registered;
 * this function never manufactures a URL to make coverage look complete.
 */
export function officialSourceCoverage(pack: CoveragePackDocument = coveragePack): OfficialSourceCoverage[] {
  return coveredInstitutions(pack).map((institution) => {
    const sources = monitorableSources(pack).filter((source) => source.institutionId === institution.id);
    return {
      institutionId: institution.id,
      shortName: institution.shortName,
      status: sources.length ? "active" : "degraded",
      sourceIds: sources.map((source) => source.id),
    };
  });
}

export function inventorySources(pack: CoveragePackDocument = coveragePack) {
  return pack.sources.filter((source) => source.status === "inventory-only" || source.kind.startsWith("linkedin"));
}

export function leadershipHostAllowlist(pack: CoveragePackDocument = coveragePack): ReadonlySet<string> {
  const hosts = new Set<string>();
  for (const source of monitorableSources(pack)) {
    const host = source.host.replace(/^www\./, "").toLowerCase();
    hosts.add(host);
    hosts.add(`www.${host}`);
    hosts.add(source.host.toLowerCase());
  }
  for (const blocked of pack.blockedHosts) {
    hosts.delete(blocked.toLowerCase());
  }
  return hosts;
}

export function hostsForSource(source: CoverageSource): ReadonlySet<string> {
  const host = source.host.replace(/^www\./, "").toLowerCase();
  return new Set([host, `www.${host}`, source.host.toLowerCase()]);
}

export function sourceById(id: string, pack: CoveragePackDocument = coveragePack) {
  return pack.sources.find((source) => source.id === id);
}

export function preferSource<T extends { sourceId: string }>(
  rows: readonly T[],
  pack: CoveragePackDocument = coveragePack,
): T | undefined {
  return [...rows].sort((left, right) => {
    const leftSource = sourceById(left.sourceId, pack);
    const rightSource = sourceById(right.sourceId, pack);
    return (rightSource?.precedence ?? 0) - (leftSource?.precedence ?? 0);
  })[0];
}

export function coverageBoundsAreClosed() {
  return (
    LEADERSHIP_MAX_BYTES <= 512_000
    && LEADERSHIP_TIMEOUT_MS <= 8_000
    && LEADERSHIP_MAX_REDIRECTS <= 3
    && LEADERSHIP_CONCURRENCY <= 2
    && LEADERSHIP_CANDIDATE_CAP <= 16
  );
}

export function geographyMatchesEntityBoundary(pack: CoveragePackDocument = coveragePack) {
  return (
    pack.geography.counties.PA.join() === ENTITY_BOUNDARY.pa.join()
    && pack.geography.counties.NJ.join() === ENTITY_BOUNDARY.nj.join()
    && pack.geography.counties.DE.join() === ENTITY_BOUNDARY.de.join()
    && pack.geography.edgeOnly.join() === ENTITY_BOUNDARY.edgeOnly.join()
  );
}
