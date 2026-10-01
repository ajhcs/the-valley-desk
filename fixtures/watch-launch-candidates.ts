import { SourceEnrollment } from "../src/ingest/watch/source-enrollment";

// Candidate configurations only. No rights decision, qualification receipt or activation.
const definitions = [
  ["candidate-orca", "ORCA-CDS repository metadata", "technology", "regional", "technology", "github-json", "https://api.github.com/repos/Stephonomon/orca-cds", "https://github.com/Stephonomon/orca-cds", "documented-api"],
  ["candidate-captk", "Penn CBICA CaPTk repository metadata", "technology", "regional", "technology", "github-json", "https://api.github.com/repos/CBICA/CaPTk", "https://github.com/CBICA/CaPTk", "documented-api"],
  ["candidate-pa-memos", "PA House co-sponsorship memos", "policy", "PA", "legislation", "rss", "https://www.palegis.us/house/rss/legislation/memos", "https://www.palegis.us/data", "robots-check"],
  ["candidate-pa-members", "PA House members", "policy", "PA", "members", "rss", "https://www.palegis.us/house/rss/session/members", "https://www.palegis.us/data", "robots-check"],
  ["candidate-de-introduced", "Delaware introduced legislation", "policy", "DE", "legislation", "rss", "https://legis.delaware.gov/RSSFeeds/IntroducedLegislation", "https://legis.delaware.gov/RSSFeed", "robots-check"],
  ["candidate-nj-downloads", "NJ Legislature downloads inventory", "policy", "NJ", "legislation", "html", "https://www.njleg.state.nj.us/downloads", "https://www.njleg.state.nj.us/downloads", "robots-check"],
  ["candidate-federal-cms", "Federal Register CMS document inventory", "policy", "federal", "regulation", "official-json", "https://www.federalregister.gov/api/v1/documents.json?per_page=5&conditions%5Bagencies%5D%5B%5D=centers-for-medicare-medicaid-services", "https://www.federalregister.gov/developers/documentation/api/v1", "robots-check"],
  ...["hb1925", "hb1993", "sb1113", "hb2787"].map(bill => [
    `candidate-pa-${bill}`, `PA 2025–2026 ${bill.toUpperCase()} official bill page`, "policy", "PA", "legislation", "html",
    `https://www.palegis.us/legislation/bills/2025/${bill}`, "https://www.palegis.us/data", "robots-check",
  ] as const),
  ["candidate-pa-export", "PA 2025–2026 selected bill export", "policy", "PA", "legislation", "official-zip-xml", "https://www.palegis.us/data/file?documentType=BillHistoryData&session=2025_0", "https://www.palegis.us/data", "robots-check"],
  ["candidate-philadelphia", "Philadelphia Council legislation inventory", "policy", "PA", "legislation", "html", "https://phila.legistar.com/Legislation.aspx", "https://phila.legistar.com/Legislation.aspx", "robots-check"],
  ["candidate-de-news", "Delaware government news RSS", "news", "DE", "news", "rss", "https://news.delaware.gov/feed/", "https://news.delaware.gov/", "robots-check"],
] as const;

export const launchCandidates = definitions.map(([id,name,desk,jurisdiction,family,transport,endpoint,discoveryUrl,accessMode]) => {
  const url = new URL(endpoint), github = transport === "github-json", federal = id === "candidate-federal-cms";
  const paExport = id === "candidate-pa-export";
  const paBill = /^candidate-pa-(?:hb1925|hb1993|sb1113|hb2787)$/.test(id);
  const source = SourceEnrollment.parse({id,name,desk,jurisdiction,family,transport,
    state:"pending",parserId:paExport?"watch-pa-bill-history-export":paBill?"watch-pa-bill-history":github?"watch-github":transport==="rss"?"watch-rss":federal?"watch-federal-register":"candidate-parser-unavailable",
    parserVersion:"1",endpoints:[endpoint],linkScopes:[{host:github?"github.com":url.hostname,
      pathPrefix:github?url.pathname.replace(/^\/repos/,""):paBill?url.pathname:"/"}],
    authority:github?"first-party":"official",dateTimezone:"America/New_York",requiresAuth:false,
    collectionMode:"rolling",maxBytes:paExport?2_000_000:paBill?350_000:500_000,maxItems:paExport?4:50,qualificationReceiptId:null,
    ...(paExport?{paExport:{sessionYear:2025,session:0,selectedBills:["HB1925","HB1993","SB1113","HB2787"],memberName:"PA-Bill-History-2025-RegularSession.xml",maxExpandedBytes:67108864,maxEntries:100,normalizerVersion:"watch-pa-zip-xml-v1"}}:{})});
  return {source,discoveryUrl,accessMode,accessDocumentation:github?"https://docs.github.com/en/rest/repos/repos#get-a-repository":null,
    enrollmentStatus:"candidate" as const,engineeringOwnerId:null,editorialOwnerId:null,rightsDecision:null,
    captureClaim:transport==="html"&&!paBill?"inventory-only-parser-unavailable":"parser-preparation",
    blockers:["named-reviewers-unassigned","rights-review-pending","two-time-separated-samples-required",
      ...(github?["regional-evidence-review-pending","license-bytes-review-pending"]:[]),
      ...(paBill||paExport?["access-review-pending"]:[]),...(paExport?["publisher-access-held","library-research-is-not-upstream-qualification"]:[]),...(transport==="html"&&!paBill?["watch-parser-not-implemented"]:[])]};
});

export function launchCandidate(id: string) {
  const candidate = launchCandidates.find(value=>value.source.id===id);
  if (!candidate) throw Error("unknown-launch-candidate");
  return candidate;
}
