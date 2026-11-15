# WP08 owner handoff — Sol

Implementation candidate only; acceptance belongs to the independent reviewer and
orchestrator. No provider API was contacted, enrolled or activated. No deployment,
credential acquisition, migration, admission or publication occurred.

`createDiscoveryGithubAdapter` composes the WP06 runtime source and endpoint
constructor with the WP07 trusted provisional parser. Its `parser` property is
passed as `createDiscoveryCollectionStore(..., { parser })`. The caller supplies
trusted source/page/retained-representation resolvers; `baselineReceiptForSource`
selects a real committed repository page, not a boolean or caller-authored ID
binding. Repository lists independently resolve that page and its retained body,
verify representation/request hashes, current source revision/configuration,
permission, installation, scope and parser, and derive the native ID from bytes.
Deleted/corrupt/mismatched baselines fail parsing. The adapter does not edit accepted dependencies; the root-owned EX11 extension
adds authenticated Link metadata and GitHub rate-limit classification.

Supported exact API origin is `https://api.github.com`, with no alternate test
host: `/users/{login}`, `/orgs/{login}`, their `/repos` inventories,
`/search/repositories`, `/search/users`, `/repos/{owner}/{repo}` and its
`/releases`, `/tags`, `/commits`, `/contributors` lists. Paths and query values
must pass the genuine enrolled endpoint template. Templates retain the reviewed
query, collection window and page cap; the adapter does not expand them. Endpoint
examples are `/orgs/synthetic-org/repos?per_page=30&page=1` and
`/search/repositories?q=healthcare+org:synthetic-org&per_page=30&page=1`.
Templates and round parameters are required inputs, not access qualification.

Stable repository/account keys are safe positive numeric native IDs. Repository
baseline, numeric release ID, tag name and commit SHA remain distinct stages and
versions. Tags have no fabricated publication date. Commit personal author text
stays unresolved; linked accounts remain accounts, and owner/contributor/author
roles are distinct metadata. Metadata from `inspect` retains source revision,
request hash, body hash and parser reference; it is reconstructible from retained
bytes and is not a public claim or persisted admission. Profile URLs and SPDX
labels are declared hints only. Baseline aliases remain raw-backed; replaying the
same numeric repository ID under a new alias does not create another identity.
No README or release description instruction is executed or admitted.

The WP07 draft has no fields for aliases/license/profile/role claims. Those
remain private `inspect` output and retained raw bytes, with the normal draft
carrying only supported native leads, stages, dates and unresolved relations.
WP14 materialization and policy remain outstanding.

Pagination requires transport-authenticated `responseLink` metadata on every
list. The root-owned WP06/WP07 extension binds that header in the original attempt
finish digest and retained page receipt. Missing legacy metadata fails closed.
Every Link URL must match the enrolled origin/path/fixed values and original
query parameters except `page`; next must be exactly the following enrolled page.
Foreign URLs, changed query, duplicates, unsupported relations and out-of-cap
URLs fail parsing. A full page without a next link remains partial; no next URL
is manufactured. A short page with no next link may terminate only when search
counts do not contradict it. Search's 1,000-result cap, `incomplete_results`,
private repository rows and item limits produce explicit gaps. Counts are not a
proof of stable provider inventory. Tags include target SHA in source version so
retargeting remains a new version under the same repository identity.
The transport is unconditional: no conditional cache or 304 reuse is implemented.
Unsupported 304 responses cannot produce retained collection pages. GitHub 403
rate-limit headers are handled by the separately reviewed root transport change.

Owner check: qualified Node 22.23.2, isolated task cache/temp directories,
`tsc --noEmit --project tsconfig.app.json --pretty false` passed. Initial
`tsc --noEmit` referenced the empty root project and was not meaningful validation;
the explicit app-project check includes `github.ts`. Independent tests are
owned by Terra, not this owner. Synthetic fixtures under
`test/fixtures/discovery-sources/github/` are API-shaped authored examples and
establish no real access, regional relevance, identity merge or provider coverage.

Official documentation consulted on 2026-11-15 (reference retrieval only):

- [Repository endpoints](https://docs.github.com/en/rest/repos/repos): public inventories, repository native IDs, owner and license fields, page parameters.
- [Search endpoints](https://docs.github.com/en/rest/search/search?apiVersion=2022-11-28): query semantics, 1,000-result cap and incomplete search results.
- [Releases](https://docs.github.com/en/rest/releases/releases?apiVersion=2022-11-28): releases are separate from tags; published versus draft releases.
- [Commits](https://docs.github.com/en/rest/commits/commits?apiVersion=2022-11-28): linked accounts versus commit author/committer metadata.
- [Users](https://docs.github.com/en/rest/users/users?apiVersion=2022-11-28): profile fields and access/status boundaries.
- [Pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api): Link headers, now authenticated by EX11 and supplied to the provisional parser.

Owner replay of the independently authored suite (earlier in-progress test file):
15 tests, 12 passed and three failed (two clock assertion subtests and their
parent). Terra identified a mismatch between the injected transport clock and
fixture clock and corrected the test; this failed attempt is preserved in
`.discovery-work/wp08-sol/independent-suite-owner-replay.tap`. The actual D1
GitHub-only search, 304 rejection, unqualified Link rejection, durable baseline
stages, qualified continuation and conservative full-page boundary passed in
that replay. Final independent results belong to Terra's later run. The replay
is not a package acceptance or clean full-suite claim.
