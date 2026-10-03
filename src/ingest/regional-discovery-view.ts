import { redactRegionalContactEmails } from "./regional-privacy";
import { z } from "zod";
import { isCalendarDay } from "../content/watch-schema";
import { RegionalInventory, verifyRegionalEvidence, verifyInstitutionalRepository, regionalPublicUrlProjection } from "./regional-contracts";
import type { RetainedRepresentation } from "./regional-contracts";
import { parseRegionalFeed } from "./regional-discovery";
import { looksInstructionLike } from "./untrusted-text";
import { qualifyPublicationScope } from "./regional-publications";

const Id = z.string().regex(/^[a-z][a-z0-9-]+$/).max(200);
const Instant = z.string().datetime({ offset: true }).refine(value => isCalendarDay(value.slice(0, 10)));
const Day = z.string().refine(isCalendarDay);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Pointer = z.string().max(2048).refine(value => regionalPublicUrlProjection(value) === value);
const no = z.literal(false), Count = z.number().int().nonnegative();
const Provider = z.enum(["official-rss", "pubmed-metadata", "institution-linked-github"]);
const RecordId = z.string().regex(/^discovery-[a-f0-9]{24}$/);
const distinct = (values: string[]) => new Set(values).size === values.length;
const Cursor = z.object({ snapshotId: Hash, afterRecordId: RecordId, filterKey: z.string().max(2000) }).strict();
export const RegionalDiscoveryQuery = z.object({ institutionIds: z.array(Id).min(1).max(20).refine(distinct).optional(),
  providers: z.array(Provider).min(1).max(3).refine(distinct).optional(), limit: z.number().int().min(1).max(10).default(5),
  cursor: Cursor.nullable().optional() }).strict();
export const RegionalDiscoveryRecordQuery = z.object({ snapshotId: Hash, recordId: RecordId,
  authorLimit: z.number().int().min(0).max(20).default(8) }).strict();
const Citation = z.object({ evidenceId: Id, sourceUrl: Pointer, observedAt: Instant, sourcePublishedAt: Instant.nullable(),
  representationSha256: Hash, retainedSpanVerified: z.literal(true) }).strict();
const Provenance = z.object({ snapshotSourceUrl: Pointer, observedAt: Instant, retainedRepresentationSha256: Hash,
  verification: z.enum(["retained-source-bytes", "retained-redacted-metadata-projection"]),
  upstreamWireBytesVerifiedByThisAdapter: z.boolean(), upstreamWireSha256Declared: Hash.nullable(),
  citations: z.array(Citation).max(6), limitations: z.array(z.string().max(250)).max(8) }).strict();
const Summary = z.object({ recordId: RecordId, institutionId: Id, institutionName: z.string().max(200),
  institutionScopeDeclaration: z.enum(["core", "edge", "unverified"]), provider: Provider, sourceId: Id,
  title: z.string().max(2000).nullable(), url: Pointer, sourcePublishedAt: Instant.nullable(),
  reportedElectronicPublicationDay: Day.nullable(), reportedJournalPublicationDay: Day.nullable(),
  originalWorkPublicationDateConfirmed: no, relationship: z.enum(["institutional-repository-listing", "metadata-reports-institution-at-publication", "institution-links-repository"]),
  explicitRegionalAuthorAffiliationMatches: Count.nullable(), currentEmploymentConfirmed: no, organizationOwnershipVerified: no,
  status: z.literal("review"), publicationAuthorized: no, holds: z.array(z.string().max(200)).max(12), provenance: Provenance }).strict();
const Affiliation = z.object({ reportedText: z.string().max(600), contactEmailOmitted: z.boolean(), textTruncated: z.boolean(),
  institutionLiteralPresent: z.boolean(), geographicLiteralPresent: z.boolean(), instructionLike: z.boolean(),
  basis: z.literal("pubmed-author-affiliation-at-publication") }).strict();
const Author = z.object({ authorIndex: Count, name: z.string().max(300).nullable(), personId: z.null(), currentAffiliationConfirmed: no,
  affiliations: z.array(Affiliation).max(8) }).strict();
const Snapshot = z.object({ schemaVersion: z.literal(1), snapshotId: Hash, asOf: Instant, expiresAt: Instant }).strict();
const Limits = {
  scope: z.literal("retained-discovery-snapshots-only"), snapshotCompleteness: z.literal("partial"), untrustedText: z.literal(true),
  comprehensiveRegionalCoverageClaimed: no, currentSourceFreshnessConfirmed: no, collectionAuthorized: no,
  collectorActivatedByThisWorkstream: no, publicationAuthorized: no, modelCallAuthorized: no,
  sourceRequestsPerformedByThisRead: z.literal(0),
  urlProjection: z.literal("Public pointers omit query parameters and fragments."),
};
export const RegionalDiscoveryResult = z.object({ schemaVersion: z.literal(1), snapshot: Snapshot, ...Limits,
  counts: z.object({ recordsInFilter: Count, snapshotsInFilter: Count, inventoryInstitutionsWithoutDiscoverySnapshotInFilter: Count,
    acceptedPublications: z.null(), peopleWithCurrentAffiliation: z.null() }).strict(),
  scopeDescription: z.string().max(600), results: z.array(Summary).max(10), nextCursor: Cursor.nullable() }).strict();
export const RegionalDiscoveryRecordResult = z.object({ schemaVersion: z.literal(1), snapshot: Snapshot, ...Limits,
  record: Summary, details: z.object({ doi: z.string().max(200).nullable(), journal: z.string().max(300).nullable(),
    reportedAuthorCount: Count.nullable(), authorsReturned: Count, authorsTruncated: z.boolean(), authors: z.array(Author).max(20),
    literalContext: z.array(z.object({ evidenceId: Id, text: z.string().max(2000), kind: z.literal("verified-source-fact") }).strict()).max(4),
    repositoryNumericId: z.string().regex(/^[1-9]\d*$/).nullable(), clinicalEligibilityVerified: no, artifactLicensingVerified: no,
    abstractsRetained: no, fullTextRetained: no }).strict() }).strict();
const Capture = z.object({ url: z.string().max(2048), observedAt: Instant, body: z.string().max(524288), text: z.string().max(524288).optional() }).passthrough();
const sha = async (body: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))))
  .map(value => value.toString(16).padStart(2, "0")).join("");
const emailFree = redactRegionalContactEmails;
type Row = { summary: z.infer<typeof Summary>; details: z.infer<typeof RegionalDiscoveryRecordResult>["details"] };
export type PreparedRegionalDiscoveryView = Readonly<z.infer<typeof Snapshot>>;
const prepared = new WeakMap<PreparedRegionalDiscoveryView, { rows: Row[]; institutionIds: string[] }>();

/** Server-side replay only. Operator-supplied retained bytes never enter browser bundles or tool responses. */
export async function prepareRegionalDiscoveryView(input: { inventory: unknown; captures: unknown; publicationSnapshot?: unknown; asOf: string }) {
  const inventory = RegionalInventory.parse(input.inventory), asOf = Instant.parse(input.asOf);
  if (Date.parse(inventory.preparedAt) > Date.parse(asOf)) throw new Error("inventory-later-than-discovery-view");
  if (!input.captures || typeof input.captures !== "object" || Array.isArray(input.captures) || Object.keys(input.captures).length > 30) throw new Error("invalid-discovery-captures");
  const captures = Object.values(input.captures).map(value => Capture.parse(value));
  const keys = captures.map(row => row.url + "\n" + row.observedAt);
  if (new Set(keys).size !== keys.length || captures.some(row => Date.parse(row.observedAt) > Date.parse(asOf))) throw new Error("invalid-discovery-capture-binding");
  const retained = new Map<string, RetainedRepresentation>();
  for (const citation of inventory.evidence) {
    const capture = captures.find(row => row.url === citation.url && row.observedAt === citation.observedAt);
    const body = citation.representation === "normalized-text" ? capture?.text : capture?.body;
    if (!capture || !body || !await verifyRegionalEvidence(citation, { url: capture.url, observedAt: capture.observedAt, body })) throw new Error("unverified-discovery-evidence");
    retained.set(citation.id, { url: capture.url, observedAt: capture.observedAt, body });
  }
  const institutions = new Map(inventory.institutions.map(row => [row.id, row]));
  const citationFor = (ids: string[]) => ids.map(id => {
    const evidence = inventory.evidence.find(row => row.id === id); if (!evidence || !retained.has(id)) throw new Error("unknown-discovery-evidence");
    return Citation.parse({ evidenceId: id, sourceUrl: regionalPublicUrlProjection(evidence.url), observedAt: evidence.observedAt,
      sourcePublishedAt: evidence.sourcePublishedAt, representationSha256: evidence.representationSha256, retainedSpanVerified: true });
  });
  const details = (): Row["details"] => ({ doi: null, journal: null, reportedAuthorCount: null, authorsReturned: 0, authorsTruncated: false,
    authors: [], literalContext: [], repositoryNumericId: null, clinicalEligibilityVerified: false, artifactLicensingVerified: false, abstractsRetained: false, fullTextRetained: false });
  const rows: Row[] = [];
  const add = async (institutionId: string, values: Omit<Row["summary"], "recordId" | "institutionId" | "institutionName" | "institutionScopeDeclaration">, recordDetails = details()) => {
    const institution = institutions.get(institutionId); if (!institution) throw new Error("unknown-discovery-institution");
    const recordId = "discovery-" + (await sha(values.provider + "\n" + values.url + "\n" + values.provenance.retainedRepresentationSha256)).slice(0, 24);
    rows.push({ summary: Summary.parse({ ...values, recordId, institutionId, institutionName: institution.name, institutionScopeDeclaration: institution.regionalScope }), details: recordDetails });
  };
  const common = { reportedElectronicPublicationDay: null, reportedJournalPublicationDay: null, originalWorkPublicationDateConfirmed: false as const,
    currentEmploymentConfirmed: false as const, organizationOwnershipVerified: false as const, status: "review" as const, publicationAuthorized: false as const };
  for (const source of inventory.sources.filter(row => row.transport === "rss" || row.transport === "atom")) {
    const capture = captures.find(row => row.url === source.url); if (!capture) continue;
    const feed = parseRegionalFeed(capture.body, source, capture.observedAt), hash = await sha(capture.body);
    for (const candidate of feed.candidates) await add(source.institutionId, { ...common, provider: "official-rss", sourceId: source.id,
      title: emailFree(candidate.title), url: regionalPublicUrlProjection(candidate.url)!, sourcePublishedAt: candidate.sourcePublishedAt,
      relationship: "institutional-repository-listing", explicitRegionalAuthorAffiliationMatches: null,
      holds: [...candidate.holds, "editorial-review-required", "listing-does-not-confirm-author-affiliation"],
      provenance: { snapshotSourceUrl: regionalPublicUrlProjection(source.url)!, observedAt: capture.observedAt, retainedRepresentationSha256: hash,
        verification: "retained-source-bytes", upstreamWireBytesVerifiedByThisAdapter: true, upstreamWireSha256Declared: hash,
        citations: citationFor(source.evidenceIds), limitations: ["Partial retained feed listing; collector remains inactive.", "Listing date is not automatically the original research-work date."] } });
  }
  const repoCitation = inventory.evidence.find(row => row.id === "ev-penn-captk-link"), repoCapture = captures.find(row => row.url === "https://api.github.com/repos/CBICA/CaPTk");
  const penn = institutions.get("inst-regional-penn-university");
  if (repoCitation && repoCapture && penn) {
    const raw = JSON.parse(repoCapture.body);
    const repository = await verifyInstitutionalRepository({ institution: penn, evidence: repoCitation, retained: retained.get(repoCitation.id)!,
      repository: { id: String(raw.id), fullName: raw.full_name, private: raw.private, htmlUrl: raw.html_url }, repositoryCapture: repoCapture });
    if (!repository) throw new Error("unverified-discovery-repository");
    const recordDetails = details(); recordDetails.repositoryNumericId = repository.repositoryId;
    const context = inventory.evidence.find(row => row.id === "ev-penn-captk-research-use");
    if (context && !looksInstructionLike(context.quote)) recordDetails.literalContext.push({ evidenceId: context.id, text: emailFree(context.quote), kind: "verified-source-fact" });
    await add(penn.id, { ...common, provider: "institution-linked-github", sourceId: "qual-penn-captk-repository", title: repository.fullName,
      url: regionalPublicUrlProjection(raw.html_url)!, sourcePublishedAt: null, relationship: "institution-links-repository", explicitRegionalAuthorAffiliationMatches: null,
      holds: ["editorial-review-required", "organization-ownership-unverified", "clinical-and-license-review-required"],
      provenance: { snapshotSourceUrl: repoCapture.url, observedAt: repoCapture.observedAt, retainedRepresentationSha256: await sha(repoCapture.body),
        verification: "retained-source-bytes", upstreamWireBytesVerifiedByThisAdapter: true, upstreamWireSha256Declared: await sha(repoCapture.body),
        citations: citationFor([repoCitation.id, ...(context ? [context.id] : [])]), limitations: ["One institution-linked public repository; no organization-wide coverage or ownership claim."] } }, recordDetails);
  }
  if (input.publicationSnapshot !== undefined) {
    const scope = await qualifyPublicationScope(inventory, retained);
    const snapshot = input.publicationSnapshot as Record<string, unknown>;
    if (!snapshot || snapshot.provider !== "pubmed" || snapshot.collectionAuthorized !== false || snapshot.publicationAuthorized !== false ||
        snapshot.fullTextRequested !== false || snapshot.abstractsRetained !== false || snapshot.snapshotCompleteness !== "partial" ||
        typeof snapshot.retainedMetadataRepresentation !== "string" || new TextEncoder().encode(snapshot.retainedMetadataRepresentation).length > 524288 ||
        typeof snapshot.metadataProjectionSha256 !== "string" || await sha(snapshot.retainedMetadataRepresentation) !== snapshot.metadataProjectionSha256) throw new Error("unverified-discovery-metadata");
    const observedAt = Instant.parse(snapshot.observedAt);
    if (Date.parse(observedAt) > Date.parse(asOf)) throw new Error("future-discovery-metadata");
    const metadata = JSON.parse(snapshot.retainedMetadataRepresentation);
    if (metadata.schemaVersion !== 1 || metadata.source !== "pubmed-indexed-metadata" || !Array.isArray(metadata.records) || metadata.records.length > 5 ||
        JSON.stringify(metadata.records) !== JSON.stringify(snapshot.records)) throw new Error("discovery-metadata-binding-mismatch");
    const pmids = new Set<string>();
    for (const raw of metadata.records) {
      if (!/^[1-9]\d{0,9}$/.test(raw.pmid) || pmids.has(raw.pmid) || raw.status !== "review" || raw.publicationAuthorized !== false || raw.currentEmploymentConfirmed === true ||
          raw.metadataObservedAt !== observedAt || raw.sourceUrl !== `https://pubmed.ncbi.nlm.nih.gov/${raw.pmid}/` || !Array.isArray(raw.authors) || raw.authors.length > 100) throw new Error("invalid-discovery-metadata-record");
      pmids.add(raw.pmid);
      const recordDetails = details(); recordDetails.doi = typeof raw.doi === "string" && raw.doi.length <= 200 && emailFree(raw.doi) === raw.doi && /^10\.\d{4,9}\/\S+$/.test(raw.doi) ? raw.doi : null;
      recordDetails.journal = typeof raw.journal === "string" ? emailFree(raw.journal).slice(0, 300) : null;
      recordDetails.reportedAuthorCount = raw.authors.length;
      recordDetails.authors = raw.authors.map((author: any, index: number) => Author.parse({ authorIndex: index, name: typeof author.name === "string" ? emailFree(author.name).slice(0, 300) : null,
        personId: null, currentAffiliationConfirmed: false, affiliations: z.array(z.any()).max(8).parse(author.affiliations).map((affiliation: any) => {
          if (typeof affiliation.reportedText !== "string" || affiliation.reportedText.length > 2000) throw new Error("invalid-discovery-affiliation");
          const text = emailFree(affiliation.reportedText);
          return { reportedText: text.slice(0, 600), textTruncated: text.length > 600, contactEmailOmitted: text !== affiliation.reportedText || affiliation.contactEmailOmitted === true,
            institutionLiteralPresent: /\bWistar Institute\b/i.test(text), geographicLiteralPresent: /\bPhiladelphia\s*,\s*(PA|Pennsylvania)\b/i.test(text),
            instructionLike: looksInstructionLike(text), basis: "pubmed-author-affiliation-at-publication" };
        }) }));
      // Re-evaluate literal scope from each original redacted affiliation; never join authors or trust supplied match arrays.
      const matches = raw.authors.flatMap((author: any) => author.affiliations.filter((affiliation: any) =>
        /\bWistar Institute\b/i.test(emailFree(affiliation.reportedText)) && /\bPhiladelphia\s*,\s*(PA|Pennsylvania)\b/i.test(emailFree(affiliation.reportedText)) && !looksInstructionLike(affiliation.reportedText)));
      await add(scope.institutionId, { ...common, provider: "pubmed-metadata", sourceId: "qual-wistar-pubmed-metadata", title: typeof raw.title === "string" ? emailFree(raw.title).slice(0, 2000) : null,
        url: raw.sourceUrl, sourcePublishedAt: null, reportedElectronicPublicationDay: raw.electronicPublishedDay ?? null,
        reportedJournalPublicationDay: raw.journalPublishedDay ?? null, relationship: "metadata-reports-institution-at-publication",
        explicitRegionalAuthorAffiliationMatches: matches.length, holds: [...new Set([...z.array(z.string().max(200)).max(10).parse(raw.holds), ...(!matches.length ? ["explicit-regional-author-affiliation-missing"] : []), ...(looksInstructionLike(String(raw.title ?? "")) ? ["instruction-like-source-text"] : [])])],
        provenance: { snapshotSourceUrl: raw.sourceUrl, observedAt, retainedRepresentationSha256: snapshot.metadataProjectionSha256,
          verification: "retained-redacted-metadata-projection", upstreamWireBytesVerifiedByThisAdapter: false,
          upstreamWireSha256Declared: Hash.parse(snapshot.wireResponseSha256), citations: citationFor([scope.evidenceId]),
          limitations: ["Previously retained five-record manual qualification page; no fresh upstream request.", "Upstream XML bytes were not retained and cannot be reverified by this adapter.", "Publication affiliation metadata does not identify a unique current institutional employee."] } }, recordDetails);
    }
  }
  rows.sort((a, b) => a.summary.recordId.localeCompare(b.summary.recordId));
  if (new Set(rows.map(row => row.summary.recordId)).size !== rows.length) throw new Error("duplicate-discovery-record");
  const expiresAt = new Date(Date.parse(asOf) + 15 * 60000).toISOString();
  const snapshotId = await sha(JSON.stringify({ asOf, expiresAt, rows, institutionIds: [...institutions.keys()] }));
  const view: PreparedRegionalDiscoveryView = Object.freeze({ schemaVersion: 1, snapshotId, asOf, expiresAt });
  prepared.set(view, { rows, institutionIds: [...institutions.keys()] }); return view;
}
function snapshotFor(view: PreparedRegionalDiscoveryView, serverNow: string) {
  const snapshot = prepared.get(view), now = Date.parse(Instant.parse(serverNow));
  if (!snapshot) throw new Error("unprepared-discovery-view");
  if (now < Date.parse(view.asOf) || now >= Date.parse(view.expiresAt)) throw new Error("discovery-view-expired-or-future");
  return snapshot;
}
const limits = { scope: "retained-discovery-snapshots-only" as const, snapshotCompleteness: "partial" as const, untrustedText: true as const,
  comprehensiveRegionalCoverageClaimed: false as const, currentSourceFreshnessConfirmed: false as const, collectionAuthorized: false as const,
  collectorActivatedByThisWorkstream: false as const, publicationAuthorized: false as const, modelCallAuthorized: false as const,
  sourceRequestsPerformedByThisRead: 0 as const, urlProjection: "Public pointers omit query parameters and fragments." as const };
export function queryRegionalDiscoveryView(view: PreparedRegionalDiscoveryView, request: unknown, serverNow: string) {
  const snapshot = snapshotFor(view, serverNow), query = RegionalDiscoveryQuery.parse(request);
  if (query.institutionIds?.some(id => !snapshot.institutionIds.includes(id))) throw new Error("unknown-read-view-institution");
  const rows = snapshot.rows.filter(row => (!query.institutionIds || query.institutionIds.includes(row.summary.institutionId)) && (!query.providers || query.providers.includes(row.summary.provider)));
  const filterKey = JSON.stringify({ institutionIds: query.institutionIds ? [...query.institutionIds].sort() : null, providers: query.providers ? [...query.providers].sort() : null });
  let start = 0;
  if (query.cursor) {
    if (query.cursor.snapshotId !== view.snapshotId || query.cursor.filterKey !== filterKey) throw new Error("discovery-cursor-context-mismatch");
    const index = rows.findIndex(row => row.summary.recordId === query.cursor!.afterRecordId); if (index < 0) throw new Error("discovery-cursor-record-missing"); start = index + 1;
  }
  const page = rows.slice(start, start + query.limit);
  return RegionalDiscoveryResult.parse({ schemaVersion: 1, snapshot: { ...view }, ...limits,
    counts: { recordsInFilter: rows.length, snapshotsInFilter: new Set(rows.map(row => row.summary.provider + ":" + row.summary.sourceId)).size,
      inventoryInstitutionsWithoutDiscoverySnapshotInFilter: (query.institutionIds ?? snapshot.institutionIds).filter(id => !rows.some(row => row.summary.institutionId === id)).length,
      acceptedPublications: null, peopleWithCurrentAffiliation: null }, scopeDescription: "Partial replay of retained discovery snapshots for the six-institution regional proposal inventory, separate from the larger configured inventory. Supported families are official RSS, institution-linked repositories and a bounded Wistar PubMed metadata page. Missing snapshots are not evidence of no activity; dates describe past source observations.",
    results: structuredClone(page.map(row => row.summary)), nextCursor: start + page.length < rows.length ? { snapshotId: view.snapshotId, afterRecordId: page[page.length - 1].summary.recordId, filterKey } : null });
}
export function queryRegionalDiscoveryRecord(view: PreparedRegionalDiscoveryView, request: unknown, serverNow: string) {
  const snapshot = snapshotFor(view, serverNow), query = RegionalDiscoveryRecordQuery.parse(request);
  if (query.snapshotId !== view.snapshotId) throw new Error("discovery-cursor-context-mismatch");
  const row = snapshot.rows.find(row => row.summary.recordId === query.recordId); if (!row) throw new Error("discovery-cursor-record-missing");
  const details = structuredClone(row.details), authors = details.authors.slice(0, query.authorLimit);
  return RegionalDiscoveryRecordResult.parse({ schemaVersion: 1, snapshot: { ...view }, ...limits, record: structuredClone(row.summary),
    details: { ...details, authors, authorsReturned: authors.length, authorsTruncated: details.authors.length > authors.length } });
}
