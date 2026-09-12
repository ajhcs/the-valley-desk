import { SourceEnrollment, type SnapshotInput, type WatchObservation } from "../../../src/ingest/watch/source-enrollment.ts";

// Synthetic parser mechanics only. None of these endpoints was fetched or enrolled.
export const SEEN_AT = "2026-09-12T12:00:00.000Z";
export function rssSource(overrides: Partial<SourceEnrollment> = {}): SourceEnrollment {
  return SourceEnrollment.parse({ id: "synthetic-rss", name: "Synthetic source", state: "pending", desk: "news",
    jurisdiction: "regional", family: "news", transport: "rss", parserId: "watch-rss", parserVersion: "1",
    endpoints: ["https://source.example/feed.xml"], linkScopes: [{ host: "source.example", pathPrefix: "/" }],
    authority: "unqualified", dateTimezone: null, requiresAuth: false, collectionMode: "rolling",
    maxBytes: 32_000, maxItems: 10, qualificationReceiptId: null, ...overrides });
}
export function rssItem(options: { id?: string | null; title?: string; url?: string; date?: string | null; description?: string } = {}) {
  const id = options.id === undefined ? "urn:synthetic:item-a" : options.id;
  const date = options.date === undefined ? "Sat, 12 Sep 2026 10:00:00 GMT" : options.date;
  return `<item><title>${options.title ?? "Synthetic research update"}</title><link>${options.url ?? "https://source.example/items/a"}</link>` +
    `${id === null ? "" : `<guid isPermaLink="false">${id}</guid>`}<description>${options.description ?? "Synthetic facts for a parser test."}</description>` +
    `${date === null ? "" : `<pubDate>${date}</pubDate>`}</item>`;
}
export function rssBody(items = rssItem()) {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Synthetic updates</title><link>https://source.example/</link><description>Synthetic feed.</description>${items}</channel></rss>`;
}
export function atomBody(entries = atomEntry(), extra = "") {
  return `<feed xmlns="http://www.w3.org/2005/Atom"><id>urn:synthetic:feed</id><title>Synthetic Atom</title><updated>2026-09-12T11:00:00Z</updated>${extra}${entries}</feed>`;
}
export function atomEntry(published: string | null = "2026-09-11T09:00:00Z") {
  return `<entry><id>urn:synthetic:atom-a</id><title>Synthetic Atom update</title><link href="https://source.example/items/atom-a"/>` +
    `<updated>2026-09-12T11:00:00Z</updated>${published === null ? "" : `<published>${published}</published>`}<summary>Synthetic summary.</summary></entry>`;
}
export function feedInput(body = rssBody(), source = rssSource()): SnapshotInput {
  return { source, body, finalUrl: source.endpoints[0]!, fetchedAt: SEEN_AT };
}
export function acknowledgments(observations: WatchObservation[]) {
  return new Map(observations.map(observation => [observation.id, { observationId: observation.id, sourceId: observation.sourceId,
    representationSha256: observation.representationSha256, payloadSha256: observation.payloadSha256,
    firstSeenAt: observation.fetchedAt, persistedAt: observation.fetchedAt, receiptId: "synthetic-write-receipt" }]));
}
export const repositoryBinding = { repositoryId: "4242", fullName: "synthetic-lab/clinical-db" };
export const repository = { id: 4242, full_name: repositoryBinding.fullName, name: "clinical-db", owner: { login: "synthetic-lab", location: "Philadelphia" },
  private: false, visibility: "public", html_url: "https://github.com/synthetic-lab/clinical-db", description: "Synthetic database.",
  created_at: "2020-01-01T00:00:00Z", updated_at: "2026-09-12T11:00:00Z", pushed_at: "2026-09-12T10:00:00Z",
  archived: false, fork: false, stargazers_count: 10000, license: { spdx_id: "MIT" } };
export const release = { id: 81, tag_name: "v1.0.0", name: "Synthetic release", draft: false, prerelease: false,
  html_url: "https://github.com/synthetic-lab/clinical-db/releases/tag/v1.0.0", body: "Synthetic release notes.",
  created_at: "2020-01-01T00:00:00Z", published_at: "2026-09-11T10:00:00Z", target_commitish: "main" };
export const commitSha = "a".repeat(40);
export const tag = { name: "v1.0.0", commit: { sha: commitSha, url: "https://api.github.com/repos/synthetic-lab/clinical-db/commits/unused" },
  zipball_url: "https://api.github.com/repos/synthetic-lab/clinical-db/zipball/v1.0.0" };
export const commit = { sha: commitSha, html_url: `https://github.com/synthetic-lab/clinical-db/commit/${commitSha}`,
  commit: { message: "Synthetic change\n\nA longer description.", author: { date: "2026-09-09T08:00:00Z" }, committer: { date: "2026-09-10T09:00:00Z" } } };
export function githubInput(mode: "repository" | "releases" | "tags" | "commits", value: unknown,
  alias = repositoryBinding.fullName): SnapshotInput {
  const endpoint = `https://api.github.com/repos/${alias}${mode === "repository" ? "" : `/${mode}`}`;
  const source = rssSource({ id: "synthetic-github", name: "Synthetic GitHub", transport: "github-json", desk: "technology", family: "technology",
    parserId: "watch-github", endpoints: [endpoint], linkScopes: [{ host: "github.com", pathPrefix: `/${alias}` }], collectionMode: "paged-inventory" });
  return { source, body: JSON.stringify(value), finalUrl: endpoint, fetchedAt: SEEN_AT, terminal: true };
}
