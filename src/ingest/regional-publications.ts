import { legacyOffsetDatetime } from "../lib/schema-compat";
import { redactRegionalContactEmails } from "./regional-privacy";
import { z } from "zod";
import { XMLValidator } from "fast-xml-parser";
import { regionalXmlDocument } from "./regional-xml";
import type { RegionalXmlElement } from "./regional-xml";
import { isCalendarDay } from "../content/watch-schema";
import { RegionalInventory, verifyRegionalEvidence, permittedPublicUrl } from "./regional-contracts";
import type { RetainedRepresentation } from "./regional-contracts";
import { looksInstructionLike } from "./untrusted-text";

const Day = z.string().refine(isCalendarDay);
const Plan = z.object({ institutionId: z.literal("inst-regional-wistar"), startDay: Day, endDay: Day,
  limit: z.number().int().min(1).max(5).default(5), offset: z.number().int().min(0).max(100).default(0) }).strict()
  .refine(row => row.startDay <= row.endDay && Date.parse(row.endDay) - Date.parse(row.startDay) <= 90 * 86400000, "bounded publication window required");
export type PublicationDiscoveryPlan = z.input<typeof Plan>;
const ENDPOINT = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
const BYTE_CAP = 524288;
const array = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const plain = (value: unknown): string | null => typeof value === "string" ? value.trim() : null;
const emailFree = redactRegionalContactEmails;
const fullDay = (value: { Year?: unknown; Month?: unknown; Day?: unknown } | undefined) => {
  if (!value) return null;
  const parts = [value.Year, value.Month, value.Day].map(plain);
  if (parts.some(part => !part || !/^\d+$/.test(part))) return null;
  const day = `${parts[0]}-${parts[1]!.padStart(2, "0")}-${parts[2]!.padStart(2, "0")}`;
  return isCalendarDay(day) ? day : null;
};
const sha256 = async (body: string | Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", (typeof body === "string" ? new TextEncoder().encode(body) : Uint8Array.from(body)))))
  .map(value => value.toString(16).padStart(2, "0")).join("");
const qualifiedScopes = new WeakSet<object>();
export type QualifiedPublicationScope = Readonly<{ institutionId: "inst-regional-wistar"; institutionLiteral: "Wistar Institute";
  locationLiteral: "Philadelphia"; evidenceId: string; evidenceUrl: string; observedAt: string }>;

/** A search phrase is not affiliation evidence. Bind the only supported scope to retained first-party bytes. */
export async function qualifyPublicationScope(rawInventory: unknown, retained: ReadonlyMap<string, RetainedRepresentation>) {
  const inventory = RegionalInventory.parse(rawInventory);
  const institution = inventory.institutions.find(row => row.id === "inst-regional-wistar");
  if (!institution || institution.regionalScope !== "core") throw new Error("publication-scope-unqualified");
  const evidence = inventory.evidence.find(row => row.id === "ev-wistar-location" && institution.evidenceIds.includes(row.id));
  const representation = evidence && retained.get(evidence.id);
  if (!evidence || !representation || !permittedPublicUrl(evidence.url, ["www.wistar.org"]) || !representation.body.includes("Wistar Institute") || !evidence.quote.includes("Philadelphia") ||
    !await verifyRegionalEvidence(evidence, representation)) throw new Error("publication-scope-unqualified");
  const scope: QualifiedPublicationScope = Object.freeze({ institutionId: "inst-regional-wistar", institutionLiteral: "Wistar Institute",
    locationLiteral: "Philadelphia", evidenceId: evidence.id, evidenceUrl: evidence.url, observedAt: evidence.observedAt });
  qualifiedScopes.add(scope); return scope;
}

export function publicationSearchUrl(scope: QualifiedPublicationScope, rawPlan: PublicationDiscoveryPlan) {
  if (!qualifiedScopes.has(scope)) throw new Error("publication-scope-unqualified");
  const plan = Plan.parse(rawPlan);
  const term = `"${scope.institutionLiteral}"[Affiliation] AND ("${plan.startDay.replaceAll("-", "/")}"[Date - Publication] : "${plan.endDay.replaceAll("-", "/")}"[Date - Publication])`;
  const url = new URL("esearch.fcgi", ENDPOINT);
  for (const [key, value] of Object.entries({ db: "pubmed", term, retmode: "json", retmax: String(plan.limit), retstart: String(plan.offset), sort: "pub date", tool: "TheValleyDesk-regional-review" })) url.searchParams.set(key, value);
  return { url: url.href, plan };
}

/** Metadata projection only: no abstract, full text, contact email, current employment or unique-person enrollment. */
export async function projectPubMedMetadata(xml: string, ids: readonly string[], scope: QualifiedPublicationScope, observedAt: string) {
  if (!qualifiedScopes.has(scope) || new Set(ids).size !== ids.length || ids.length > 5 || ids.some(id => !/^[1-9]\d{0,9}$/.test(id)))
    throw new Error("invalid-publication-binding");
  legacyOffsetDatetime().parse(observedAt);
  if (new TextEncoder().encode(xml).length > BYTE_CAP || /<!ENTITY|<!DOCTYPE[^>]*\[/i.test(xml)) throw new Error("unsafe-publication-xml");
  // Permit only the external NLM PubMed DTD declaration. It is removed, never loaded or resolved.
  const declarations = xml.match(/<!DOCTYPE[^>]*>/gi) ?? [];
  if (declarations.length > 1 || declarations.some(value => !/^<!DOCTYPE\s+PubmedArticleSet\s+PUBLIC\s+"-\/\/NLM\/\/DTD PubMedArticle,[^"<>\[\]]+"\s+"https:\/\/dtd\.nlm\.nih\.gov\/ncbi\/pubmed\/out\/pubmed_\d{6}\.dtd"\s*>$/i.test(value)))
    throw new Error("unsafe-publication-dtd");
  const content = xml.replace(/<!DOCTYPE[^>]*>/gi, "");
  if (XMLValidator.validate(content) !== true) throw new Error("invalid-publication-xml");
  const roots = regionalXmlDocument(content);
  if (roots.length !== 1 || roots[0].name !== "PubmedArticleSet" || roots[0].namespace !== "") throw new Error("unsupported-publication-response");
  // NLM's unnamespaced vocabulary only. Foreign default namespaces cannot become author facts.
  const project = (element: RegionalXmlElement): any => {
    const children = element.children.filter(child => child.namespace === "");
    const attributes = element.attributes.filter(attribute => attribute.namespace === "");
    if (!children.length && !attributes.length) return element.text.trim();
    const value: Record<string, any> = Object.create(null);
    for (const attribute of attributes) value["@" + attribute.name] = attribute.value;
    if (element.text.trim()) value["#text"] = element.text.trim();
    for (const child of children) {
      const next = project(child);
      value[child.name] = Object.hasOwn(value, child.name) ? [...array(value[child.name]), next] : next;
    }
    return value;
  };
  const parsed = { PubmedArticleSet: project(roots[0]) };
  if (parsed.PubmedArticleSet?.PubmedBookArticle) throw new Error("unsupported-publication-response");
  const articles = array<any>(parsed.PubmedArticleSet.PubmedArticle);
  if (articles.length > ids.length) throw new Error("unexpected-publication-count");
  const seen = new Set<string>();
  const records = articles.map((entry: any) => {
    const med = entry.MedlineCitation, article = med?.Article;
    const pmid = plain(med?.PMID?.["#text"] ?? med?.PMID);
    if (!pmid || !ids.includes(pmid) || seen.has(pmid) || !article) throw new Error("unrequested-or-duplicate-pmid");
    seen.add(pmid);
    const title = plain(article.ArticleTitle);
    const holds = ["editorial-review-required", "current-person-affiliation-unverified"];
    if (!title || title.length > 2000) holds.push("structured-or-missing-title");
    if (title && looksInstructionLike(title)) holds.push("instruction-like-source-text");
    const authors = array<any>(article.AuthorList?.Author);
    if (authors.length > 100) throw new Error("publication-author-cap");
    const projectedAuthors = authors.map((author: any, index: number) => {
      const name = [plain(author.ForeName), plain(author.LastName)].filter(Boolean).join(" ") || plain(author.CollectiveName) || null;
      const affiliations = array<any>(author.AffiliationInfo).map((row: any) => plain(row.Affiliation)).filter((value): value is string => !!value);
      if (affiliations.length > 8 || affiliations.some(value => value.length > 2000)) throw new Error("publication-affiliation-cap");
      return { authorIndex: index, name: name ? emailFree(name).slice(0, 300) : null, personId: null, currentAffiliationConfirmed: false,
        affiliations: affiliations.map(literal => ({ reportedText: emailFree(literal), contactEmailOmitted: emailFree(literal) !== literal,
          institutionLiteralPresent: /\bWistar Institute\b/i.test(emailFree(literal)),
          geographicLiteralPresent: /\bPhiladelphia\s*,\s*(PA|Pennsylvania)\b/i.test(emailFree(literal)),
          instructionLike: looksInstructionLike(literal), basis: "pubmed-author-affiliation-at-publication" })) };
    });
    const regionalMatches = projectedAuthors.flatMap(author => author.affiliations.filter(row =>
      row.institutionLiteralPresent && row.geographicLiteralPresent && !row.instructionLike).map(row => ({ authorIndex: author.authorIndex,
      reportedText: row.reportedText, institutionId: scope.institutionId, institutionEvidenceId: scope.evidenceId,
      institutionEvidenceUrl: scope.evidenceUrl, institutionalEvidenceObservedAt: scope.observedAt,
      relationship: "metadata-reports-institution-and-location-at-publication", currentEmploymentConfirmed: false })));
    if (!regionalMatches.length) holds.push("explicit-regional-author-affiliation-missing");
    const electronicPublishedDay = fullDay(array<any>(article.ArticleDate).find(row => row["@DateType"] === "Electronic"));
    const journalDate = article.Journal?.JournalIssue?.PubDate;
    const journalPublishedDay = fullDay(journalDate);
    if (!electronicPublishedDay && !journalPublishedDay) holds.push("full-publication-date-unknown");
    if ([electronicPublishedDay, journalPublishedDay].some(day => day && day > observedAt.slice(0, 10))) holds.push("future-publication-date");
    const articleIds = array<any>(entry.PubmedData?.ArticleIdList?.ArticleId);
    const doi = articleIds.find(row => row["@IdType"] === "doi")?.["#text"] ?? null;
    return { pmid, sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, title: title && title.length <= 2000 ? emailFree(title) : null,
      doi: typeof doi === "string" && /^10\.\d{4,9}\/\S+$/.test(doi) && doi.length <= 200 && emailFree(doi) === doi ? doi : null,
      journal: plain(article.Journal?.Title) ? emailFree(plain(article.Journal?.Title)!).slice(0, 300) : null, electronicPublishedDay, journalPublishedDay,
      journalDateReported: journalDate ? JSON.stringify(journalDate).slice(0, 500) : null,
      metadataObservedAt: observedAt, authors: projectedAuthors, regionalMatches, holds,
      status: "review", publicationAuthorized: false, completeAuthorCoverageClaimed: false, untrustedSource: true };
  });
  const representation = JSON.stringify({ schemaVersion: 1, source: "pubmed-indexed-metadata", records });
  return { schemaVersion: 1, provider: "pubmed", observedAt, metadataProjectionSha256: await sha256(representation),
    wireResponseSha256: await sha256(xml), retainedMetadataRepresentation: representation,
    records, requestedPmidsMissing: ids.filter(id => !seen.has(id)), snapshotCompleteness: "partial",
    collectionAuthorized: false, publicationAuthorized: false, fullTextRequested: false, abstractsRetained: false };
}

/** Two sequential bounded requests per manual run, no retries, history server, credentials or alternate endpoints. */
export function createPublicationDiscoveryTransport(options: { fetch: typeof fetch; clock?: () => number; wait?: (ms: number) => Promise<void> }) {
  const clock = options.clock ?? Date.now, wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let active = false, nextRequestAt = 0;
  return async (scope: QualifiedPublicationScope, rawPlan: PublicationDiscoveryPlan) => {
    if (active) throw new Error("publication-transport-busy");
    const { url, plan } = publicationSearchUrl(scope, rawPlan);
    active = true; const receipts: { url: string; observedAt: string; state: string; byteCount: number; sha256: string | null; retryAfterSeconds: number | null }[] = [];
    try {
      const get = async (target: string, accept: string) => {
        const delay = nextRequestAt - clock(); if (delay > 0) await wait(delay);
        nextRequestAt = clock() + 1000;
        const observedAt = new Date(clock()).toISOString();
        const response = await options.fetch(target, { method: "GET", redirect: "error", credentials: "omit",
          headers: { Accept: accept }, signal: AbortSignal.timeout(15000) });
        if (!response.ok) {
          const state = response.status === 429 ? "rate-limited" : response.status === 401 || response.status === 403 ? "upstream-blocked" : "upstream-failed";
          const retry = response.headers.get("retry-after");
          receipts.push({ url: target, observedAt, state, byteCount: 0, sha256: null, retryAfterSeconds: retry && /^\d+$/.test(retry) ? Number(retry) : null });
          await response.body?.cancel(); throw new Error(state);
        }
        const expectedType = accept === "application/json" ? /application\/json/i : /(?:application|text)\/xml/i;
        if (!expectedType.test(response.headers.get("content-type") ?? "")) throw new Error("unexpected-publication-content-type");
        if (Number(response.headers.get("content-length")) > BYTE_CAP) { await response.body?.cancel(); throw new Error("publication-byte-cap"); }
        const reader = response.body?.getReader(); if (!reader) throw new Error("empty-publication-response");
        const chunks: Uint8Array[] = []; let bytes = 0;
        try { while (true) { const chunk = await reader.read(); if (chunk.done) break;
          bytes += chunk.value.length; if (bytes > BYTE_CAP) { await reader.cancel(); throw new Error("publication-byte-cap"); } chunks.push(chunk.value); } }
        finally { reader.releaseLock(); }
        const data = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
        const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
        receipts.push({ url: target, observedAt, state: "metadata-received", byteCount: bytes, sha256: await sha256(data), retryAfterSeconds: null });
        return { text, observedAt };
      };
      const search = await get(url, "application/json");
      const parsed = z.object({ esearchresult: z.object({ count: z.string().regex(/^\d+$/), retstart: z.string().regex(/^\d+$/),
        retmax: z.string().regex(/^\d+$/), idlist: z.array(z.string().regex(/^[1-9]\d{0,9}$/)).max(5) }).passthrough() }).passthrough().parse(JSON.parse(search.text)).esearchresult;
      if (parsed.idlist.length > plan.limit || Number(parsed.retstart) !== plan.offset || new Set(parsed.idlist).size !== parsed.idlist.length) throw new Error("invalid-publication-search-page");
      const fetchUrl = new URL("efetch.fcgi", ENDPOINT);
      for (const [key, value] of Object.entries({ db: "pubmed", id: parsed.idlist.join(","), retmode: "xml", tool: "TheValleyDesk-regional-review" })) fetchUrl.searchParams.set(key, value);
      const metadata = parsed.idlist.length ? await get(fetchUrl.href, "application/xml") : null;
      const projection = await projectPubMedMetadata(metadata?.text ?? "<PubmedArticleSet></PubmedArticleSet>", parsed.idlist, scope, metadata?.observedAt ?? search.observedAt);
      return { ...projection, plan, searchTotalReported: Number(parsed.count), nextPageOffset: plan.offset + parsed.idlist.length < Number(parsed.count) && parsed.idlist.length ? plan.offset + parsed.idlist.length : null,
        receipts, requestCount: receipts.length, productionCollectorActivated: false };
    } catch (error) {
      const code = error instanceof Error ? error.message : "publication-discovery-failed";
      const allowed = new Set(["rate-limited", "upstream-blocked", "upstream-failed", "publication-byte-cap", "unexpected-publication-content-type", "invalid-publication-search-page"]);
      return { schemaVersion: 1, state: allowed.has(code) ? code : "publication-discovery-failed", records: [], receipts,
        collectionAuthorized: false, publicationAuthorized: false, productionCollectorActivated: false };
    } finally { active = false; }
  };
}
