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
  ["candidate-philadelphia", "Philadelphia Council legislation inventory", "policy", "PA", "legislation", "html", "https://phila.legistar.com/Legislation.aspx", "https://phila.legistar.com/Legislation.aspx", "robots-check"],
  ["candidate-de-news", "Delaware government news RSS", "news", "DE", "news", "rss", "https://news.delaware.gov/feed/", "https://news.delaware.gov/", "robots-check"],
] as const;

export const launchCandidates = definitions.map(([id,name,desk,jurisdiction,family,transport,endpoint,discoveryUrl,accessMode]) => {
  const url = new URL(endpoint), github = transport === "github-json";
  const source = SourceEnrollment.parse({id,name,desk,jurisdiction,family,transport,
    state:"pending",parserId:github?"watch-github":transport==="rss"?"watch-rss":"candidate-parser-unavailable",
    parserVersion:"1",endpoints:[endpoint],linkScopes:[{host:github?"github.com":url.hostname,
      pathPrefix:github?url.pathname.replace(/^\/repos/,""):"/"}],
    authority:github?"first-party":"official",dateTimezone:"America/New_York",requiresAuth:false,
    collectionMode:"rolling",maxBytes:500_000,maxItems:50,qualificationReceiptId:null});
  return {source,discoveryUrl,accessMode,accessDocumentation:github?"https://docs.github.com/en/rest/repos/repos#get-a-repository":null,
    enrollmentStatus:"candidate" as const,engineeringOwnerId:null,editorialOwnerId:null,rightsDecision:null,
    captureClaim:transport==="html"||transport==="official-json"?"inventory-only-parser-unavailable":"parser-preparation",
    blockers:["named-reviewers-unassigned","rights-review-pending","two-time-separated-samples-required",
      ...(github?["regional-evidence-review-pending","license-bytes-review-pending"]:[]),
      ...(transport==="html"||transport==="official-json"?["watch-parser-not-implemented"]:[])]};
});

export function launchCandidate(id: string) {
  const candidate = launchCandidates.find(value=>value.source.id===id);
  if (!candidate) throw Error("unknown-launch-candidate");
  return candidate;
}
