import { z } from "zod";
import { isCalendarDay } from "../content/watch-schema";
import { regionalHtmlElements, regionalQuoteContainsElement } from "./regional-html";

export const REGIONAL_CHANNELS = ["news", "research", "people", "github", "conference"] as const;
export type RegionalChannel = typeof REGIONAL_CHANNELS[number];
const Instant = z.string().datetime({ offset: true }).refine(value => isCalendarDay(value.slice(0, 10)), "real observation day required");
const Day = z.string().refine(isCalendarDay, "real calendar day required");
const Id = z.string().regex(/^[a-z][a-z0-9-]+$/);
function sensitiveUrlParameters(url: URL, depth = 0): boolean {
  if (depth > 4 || [...url.searchParams].length > 64) return true;
  const sensitive = /^(?:access|refresh|id)?token$|^(?:api)?key$|^(?:client)?secret$|^(?:auth|authorization|bearer|jwt|credential|credentials|password|passwd|session|sessionid|signature|sig|code)$|^(?:xamz|xgoog)(?:credential|signature|securitytoken)$/;
  return [...url.searchParams].some(([key, value]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (sensitive.test(normalized)) return true;
    try { return /^https?:\/\//i.test(value) && sensitiveUrlParameters(new URL(value), depth + 1); } catch { return false; }
  });
}
/** Public pointers omit all query/fragment data; userinfo and non-public hosts still fail closed. */
export function regionalPublicUrlProjection(value: string) {
  try { if (value.length > 2048) return null; const url = new URL(value); url.search = ""; url.hash = "";
    return permittedPublicUrl(url.href) ? url.href : null; } catch { return null; }
}
export function permittedPublicUrl(value: string, allowedHosts?: readonly string[]): boolean {
  try {
    if (value.length > 2048) return false;
    const url = new URL(value), host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash && !sensitiveUrlParameters(url) &&
      !host.endsWith(".") && !host.includes(":") && !/^\d+(?:\.\d+){3}$/.test(host) &&
      host.includes(".") && !/(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host) &&
      !/(^|\.)(linkedin\.com|lnkd\.in)$/.test(host) &&
      (!allowedHosts || allowedHosts.includes(host));
  } catch { return false; }
}
const PublicUrl = z.string().max(2048).url().refine(value => permittedPublicUrl(value), "public credential-free HTTPS required");
export const RegionalEvidence = z.object({
  id: Id, url: PublicUrl, observedAt: Instant, sourcePublishedAt: Instant.nullable(),
  representationSha256: z.string().regex(/^[a-f0-9]{64}$/),
  quote: z.string().min(3).max(2000),
  representation: z.enum(["html", "normalized-text", "json"]),
}).strict();
export type RegionalEvidence = z.infer<typeof RegionalEvidence>;
export const RegionalInstitution = z.object({
  id: Id, name: z.string().min(2).max(200),
  kind: z.enum(["health-system", "university", "research-institute", "community-provider", "professional-association"]),
  existingInstitutionId: Id.nullable(),
  officialHosts: z.array(z.string().min(3)).min(1).max(12),
  regionalScope: z.enum(["core", "edge", "unverified"]),
  evidenceIds: z.array(Id).min(1), owner: z.string().min(1).max(200),
}).strict();
export type RegionalInstitution = z.infer<typeof RegionalInstitution>;
export const RegionalSource = z.object({
  id: Id, institutionId: Id, channel: z.enum(REGIONAL_CHANNELS), url: PublicUrl,
  allowedHosts: z.array(z.string().min(3)).min(1).max(8),
  transport: z.enum(["html", "rss", "atom", "github-json"]),
  status: z.enum(["inventory-only", "planned", "disabled"]),
  evidenceIds: z.array(Id).min(1), owner: z.string().min(1),
  maxAgeHours: z.number().positive().max(24 * 90),
  gaps: z.array(z.string().min(1)).min(1),
}).strict().refine(source => permittedPublicUrl(source.url, source.allowedHosts), "source outside exact host allowlist");
export type RegionalSource = z.infer<typeof RegionalSource>;
export const RegionalInventory = z.object({
  schemaVersion: z.literal(1), preparedAt: Instant,
  collectionAuthorized: z.literal(false), publicationAuthorized: z.literal(false),
  institutions: z.array(RegionalInstitution).max(200), sources: z.array(RegionalSource).max(500),
  evidence: z.array(RegionalEvidence).max(1000),
}).strict().superRefine((inventory, ctx) => {
  const evidence = new Map(inventory.evidence.map(row => [row.id, row]));
  const institutions = new Map(inventory.institutions.map(row => [row.id, row]));
  for (const rows of [inventory.institutions, inventory.sources, inventory.evidence]) {
    if (new Set(rows.map(row => row.id)).size !== rows.length) ctx.addIssue({ code: "custom", message: "duplicate inventory identity" });
  }
  for (const institution of inventory.institutions) {
    for (const id of institution.evidenceIds) {
      const citation = evidence.get(id);
      if (!citation || !permittedPublicUrl(citation.url, institution.officialHosts))
        ctx.addIssue({ code: "custom", message: "institution requires exact first-party evidence: " + institution.id });
    }
  }
  for (const source of inventory.sources) {
    if (!institutions.has(source.institutionId)) ctx.addIssue({ code: "custom", message: "unknown source institution" });
    const institution = institutions.get(source.institutionId);
    if (source.evidenceIds.some(id => !evidence.has(id))) ctx.addIssue({ code: "custom", message: "unknown source evidence" });
    if (institution && (!permittedPublicUrl(source.url, institution.officialHosts) ||
        source.allowedHosts.some(host => !institution.officialHosts.includes(host))))
      ctx.addIssue({ code: "custom", message: "source host lacks institutional authorization" });
    const sourceLinked = source.evidenceIds.some(id => {
      const citation = evidence.get(id); if (!citation) return false;
      if (citation.url === source.url) return true;
      if (citation.representation !== "html") return false;
      return regionalHtmlElements(citation.quote).some(element => {
        try { return new URL(element.attributes.href, citation.url).href === source.url; } catch { return false; }
      });
    });
    if (!sourceLinked) ctx.addIssue({ code: "custom", message: "source URL lacks exact cited source or link" });
    if (institution && source.evidenceIds.some(id => {
      const citation = evidence.get(id);
      return citation && !permittedPublicUrl(citation.url, institution.officialHosts);
    })) ctx.addIssue({ code: "custom", message: "source evidence belongs to another institution" });
  }
  for (const citation of inventory.evidence) {
    if (Date.parse(citation.observedAt) > Date.parse(inventory.preparedAt) ||
        (citation.sourcePublishedAt && Date.parse(citation.sourcePublishedAt) > Date.parse(citation.observedAt)))
      ctx.addIssue({ code: "custom", message: "evidence date later than inventory observation" });
  }
});
export type RegionalInventory = z.infer<typeof RegionalInventory>;
export type RetainedRepresentation = { url: string; observedAt: string; body: string };

/** Validate the actual retained representation, not a quote stored beside an arbitrary hash. */
export async function verifyRegionalEvidence(evidence: RegionalEvidence, retained: RetainedRepresentation) {
  const parsed = RegionalEvidence.safeParse(evidence);
  if (!parsed.success || typeof retained?.body !== "string" || new TextEncoder().encode(retained.body).length > 524288) return false;
  const citation = parsed.data;
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(retained.body))))
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  return citation.url === retained.url && citation.observedAt === retained.observedAt &&
    hash === citation.representationSha256 && retained.body.includes(citation.quote);
}

export const PublicAffiliation = z.object({
  id: Id, personId: Id, fullName: z.string().min(2), institutionId: Id, profileUrl: PublicUrl,
  role: z.string().min(2), evidenceId: Id,
  // Null means unknown. observedAt is an observation, never an inferred appointment date.
  validFrom: Day.nullable(), validUntil: Day.nullable(),
  observedAt: Instant, expiresAt: Instant,
}).strict().refine(row => Date.parse(row.expiresAt) > Date.parse(row.observedAt) &&
  Date.parse(row.expiresAt) - Date.parse(row.observedAt) <= 7 * 24 * 3_600_000 &&
  (!row.validFrom || !row.validUntil || row.validFrom <= row.validUntil), "invalid affiliation interval");
export type PublicAffiliation = z.infer<typeof PublicAffiliation>;
type AffiliationPayload = PublicAffiliation & { evidenceIds: readonly string[] };
const affiliationPayloads = new WeakMap<object, AffiliationPayload>();
export type VerifiedPublicAffiliation = Readonly<PublicAffiliation>;
export type AffiliationQualification = { profile: { evidence: RegionalEvidence; retained: RetainedRepresentation };
  term?: { evidence: RegionalEvidence; retained: RetainedRepresentation } };
/** Stable profiles require an independently retained, first-party ProfilePage/Person identity.
 * Name/role spans alone remain roster observations and cannot enroll publication authors. */
export async function verifyPublicAffiliation(row: PublicAffiliation, institution: RegionalInstitution,
  evidence: RegionalEvidence, retained: RetainedRepresentation, qualification?: AffiliationQualification) {
  const checked = PublicAffiliation.safeParse(row);
  if (!checked.success || !RegionalEvidence.safeParse(evidence).success || !RegionalInstitution.safeParse(institution).success) return null;
  const affiliation = checked.data;
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
  const profilePerson = (body: string) => {
    const page = JSON.parse(body), person = page.mainEntity;
    return page["@context"] === "https://schema.org" && page["@type"] === "ProfilePage" && page.url === affiliation.profileUrl &&
      person && person["@type"] === "Person" && person.name === affiliation.fullName && person.url === affiliation.profileUrl ? person : null;
  };
  let completeRoleRecord = false;
  if (typeof retained?.body !== "string") return null;
  if (evidence.representation === "normalized-text") {
    // No line break or cropped quote can manufacture a record boundary. This narrow
    // legacy format must retain the whole standalone identity/role record.
    const expected = affiliation.fullName + " " + affiliation.role;
    completeRoleRecord = normalize(evidence.quote) === expected && normalize(retained.body) === expected;
  } else if (evidence.representation === "json") {
    try {
      // Document context can surround one structured main person. Role authority is
      // the person's actual field, never an occurrence in another person or a quote.
      const person = profilePerson(retained.body);
      completeRoleRecord = evidence.quote.trim() === retained.body.trim() && person?.jobTitle === affiliation.role;
    } catch { return null; }
  }
  if (!completeRoleRecord || affiliation.institutionId !== institution.id || affiliation.evidenceId !== evidence.id ||
      affiliation.observedAt !== evidence.observedAt || affiliation.profileUrl !== evidence.url ||
      !permittedPublicUrl(evidence.url, institution.officialHosts) || !await verifyRegionalEvidence(evidence, retained) || !qualification) return null;
  const profile = qualification.profile;
  if (!profile || !RegionalEvidence.safeParse(profile.evidence).success) return null;
  if (profile.evidence.representation !== "json" || profile.evidence.url !== affiliation.profileUrl ||
      profile.evidence.observedAt !== affiliation.observedAt ||
      !permittedPublicUrl(profile.evidence.url, institution.officialHosts) ||
      !await verifyRegionalEvidence(profile.evidence, profile.retained)) return null;
  try {
    if (!profilePerson(profile.retained.body)) return null;
    if (affiliation.validFrom || affiliation.validUntil || qualification.term) {
      const term = qualification.term;
      if (!term || !RegionalEvidence.safeParse(term.evidence).success || term.evidence.representation !== "json" || term.evidence.observedAt !== affiliation.observedAt ||
          !permittedPublicUrl(term.evidence.url, institution.officialHosts) || !await verifyRegionalEvidence(term.evidence, term.retained)) return null;
      const declared = JSON.parse(term.retained.body);
      if (declared.personName !== affiliation.fullName || declared.role !== affiliation.role || declared.profileUrl !== affiliation.profileUrl ||
          declared.institutionName !== institution.name || declared.validFrom !== affiliation.validFrom || declared.validUntil !== affiliation.validUntil)
        return null;
    }
  } catch { return null; }
  const token = Object.freeze({ ...affiliation });
  const evidenceIds = Object.freeze([...new Set([evidence.id, profile.evidence.id, ...(qualification.term ? [qualification.term.evidence.id] : [])])]);
  affiliationPayloads.set(token, Object.freeze({ ...affiliation, evidenceIds })); return token;
}
export type PublicationAuthor = { name: string; institutionalProfileUrl?: string };
export function resolveInstitutionalAuthor(author: PublicationAuthor, verifiedAffiliations: readonly VerifiedPublicAffiliation[], asOf: string) {
  const at = Date.parse(Instant.parse(asOf));
  if (!Number.isFinite(at)) throw new Error("invalid author as-of date");
  // Known affiliation dates use UTC calendar days, independent of timestamp spelling/offset.
  const comparisonDay = new Date(at).toISOString().slice(0, 10);
  // The caller supplies only evidence-verified observations. A stable profile
  // match and matching full name are both required; name searches never enroll people.
  const matches = verifiedAffiliations.map(token => token && affiliationPayloads.get(token)).filter((row): row is AffiliationPayload => !!row && author.institutionalProfileUrl === row.profileUrl &&
    author.name.normalize("NFKC").toLowerCase().trim() === row.fullName.normalize("NFKC").toLowerCase().trim() &&
    at >= Date.parse(row.observedAt) && at < Date.parse(row.expiresAt) &&
    (!row.validFrom || comparisonDay >= row.validFrom) &&
    (!row.validUntil || comparisonDay <= row.validUntil));
  if (!author.institutionalProfileUrl) return { state: "unresolved" as const, reason: "name-only", personId: null };
  if (matches.length !== 1) return { state: "unresolved" as const, reason: matches.length ? "ambiguous" : "no-current-evidence", personId: null };
  return { state: "matched" as const, personId: matches[0].personId, institutionId: matches[0].institutionId,
    evidenceId: matches[0].evidenceId, evidenceIds: [...matches[0].evidenceIds], affiliationBasis: "observed-at" as const, termCalendarPolicy: "UTC" as const, currentAffiliationConfirmed: false };
}

/** Verify one repository link. It does not confer ownership of its GitHub organization. */
export async function verifyInstitutionalRepository(input: {
  institution: RegionalInstitution; evidence: RegionalEvidence; retained: RetainedRepresentation;
  repository: { id: string; fullName: string; private: boolean; htmlUrl: string };
  repositoryCapture: RetainedRepresentation;
}) {
  const { institution, evidence, retained, repository, repositoryCapture } = input;
  if (!/^[1-9]\d*$/.test(repository.id) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository.fullName) || repository.private ||
    repository.htmlUrl !== "https://github.com/" + repository.fullName ||
    repositoryCapture.url !== "https://api.github.com/repos/" + repository.fullName ||
    !permittedPublicUrl(evidence.url, institution.officialHosts) ||
    !await verifyRegionalEvidence(evidence, retained)) return null;
  try {
    Instant.parse(repositoryCapture.observedAt);
    const data = JSON.parse(repositoryCapture.body);
    if ((typeof data.id !== "string" && !Number.isSafeInteger(data.id)) || String(data.id) !== repository.id ||
      data.full_name !== repository.fullName || data.html_url !== repository.htmlUrl || data.private !== false ||
      `${data.owner?.login}/${data.name}` !== repository.fullName ||
      (data.visibility !== undefined && data.visibility !== "public")) return null;
    // An exact literal institutional link is required. A similarly named GitHub owner is insufficient.
    if (evidence.representation !== "html") return null;
    const links = regionalHtmlElements(retained.body, ["a"]).filter(element => regionalQuoteContainsElement(retained.body, evidence.quote, element));
    if (!links.some(element => { const link = element.attributes.href;
      try {
        const url = new URL(link);
        return permittedPublicUrl(link, ["github.com"]) && !url.search && !url.hash &&
          url.pathname.replace(/\/$/, "").toLowerCase() === "/" + repository.fullName.toLowerCase();
      } catch { return false; }
    })) return null;
    return { repositoryId: repository.id, fullName: repository.fullName, institutionId: institution.id,
      relationship: "institution-links-repository" as const, evidenceId: evidence.id,
      observedAt: evidence.observedAt, repositoryObservedAt: repositoryCapture.observedAt,
      organizationOwnershipVerified: false, publicationAuthorized: false };
  } catch { return null; }
}
