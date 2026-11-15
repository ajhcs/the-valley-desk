# WP11 owner handoff — Sol

Implementation candidate only; independent review and root acceptance remain
separate. No real provider collection, enrollment, credentials, installation,
commit, deployment or editorial admission was performed. The owner changed only
the new arXiv adapter, authored fixtures and this review. Accepted provider and
shared runtime implementations remain unchanged.

Entry review found that WP04 had not frozen an arXiv-specific normalizer. Root
adjudicated the new bounded EX16 identifier rule against official documentation
and independent Astra review. Actual endpoint access, rights/retention,
maintenance/throttling qualification and real E04 evidence remain external
preconditions. Local synthetic parser success cannot establish them.

The frozen query scope contains declared ID/revision, sorted distinct reviewed
category tokens, quoted literal terms, submitted-date window, page size,
page/item caps and an explicit candidate denominator. Its content-derived scope
ID binds those exact values. A category/name/keyword hit does not establish
health-tech relevance, county, person identity or current affiliation. Terms
cannot inject query operators: field syntax, quotes, brackets and colons are
not accepted in literal inputs. Category subclasses retain reviewed case and
allow values such as `cs.AI` and `physics.med-ph`.

The only acquired endpoint is exact `https://export.arxiv.org/api/query`, with
fixed `search_query`, `max_results`, `sortBy=submittedDate` and
`sortOrder=ascending`; `start` is the only required dynamic integer/page
parameter. Windows are at most 366 days, page sizes 1–100, chains 1–100 pages
and 1–1,000 raw entries. WP06 can impose lower byte/request/item budgets. Bodies
are bounded to 48,000 bytes. Numeric offsets advance only after a full qualified
page and cannot skip a short page that still reports outstanding results.
OpenSearch start, total and returned itemsPerPage must agree with the actual
entries and enrolled request. The adapter intentionally accepts only exact
itemsPerPage equal to returned count; unsupported provider variations fail
qualification rather than produce false completion.

Every real request remains separately issued and budgeted by WP06/WP07. Live
parser/inspect uses the actual current issued plan. Continuations bind parent
receipt, query digest, source revision/configuration/scope/parser/permission,
checkpoint/token and authenticated expiry. Retained claims and the existing
read-only chain-page lookup bind ancestry, original ordinals, predecessor
receipt IDs/checkpoints and body/request hashes without reopening old live
plans. Changed totals, duplicate IDs, missing/short entries, malformed entries
and caps remain rejected counts or typed gaps. Future committed receipts and
invalid clocks fail. Public plan/nextPage helpers are read-only proposals and
cannot issue a request or bypass registry continuation authority.

Offset proposals do **not** inherit Crossref's five-minute cursor TTL. The
actual live issued continuation and configured WP07 expiry govern each request;
a historical parent claim lease proves collection continuity, not present send
authority. `replay(receiptId)` reconstructs metadata from usable retained bytes
and historical claim/chain bindings after leases settle, without old plan
lookups or a requirement that the historical lease remain live. It checks the
reconstructed draft against the committed receipt. Even chainComplete describes
only bounded contiguous query traversal, not a stable snapshot, regional recall
or complete provider inventory. Equal-total membership churn between offset
requests is not detectable and remains a qualification limitation.

The XML parser accepts only Atom, OpenSearch and arXiv namespaces and checks
reserved semantic element names against the correct vocabulary. Foreign or
misqualified entries cannot disappear into a healthy empty page. Entities and
DOCTYPE declarations are rejected; only standard/numeric XML references are
supported. Titles and other projected fields are text-only: HTML/XHTML,
structured or mixed text cannot be reordered into invented source wording.
The feed self link is checked against the exact decoded query/window, offset,
page size and sort. Documented arxiv.org/export.arxiv.org HTTP/HTTPS self-link
aliases are metadata only and are never followed. API error-entry IDs fail
safely. Feed.updated is returned separately and never becomes scientific activity
or a source publication date.

EX16's `arxiv-base-version-v1` subset preserves the stable base separately from
an explicit positive version and metadata revision. Modern IDs use four sequence
digits from 0704–1412 and five from 1501–9912, with valid months/nonzero sequences.
Legacy IDs cover 9107–0703 and retain archive/three-digit monthly sequence.
Optional uppercase two-letter subject class is stripped from canonical base
**only** for math, cs, nlin and q-bio, while raw ID/class metadata is retained.
This is the explicitly documented provider alias rule; no existence or
cross-provider equivalence is inferred. Other archive.CLASS forms fail.
Supported forms are bare, `arXiv:` prefixed, or exact documented HTTP/HTTPS
arxiv.org/abs wrappers. Credentials, ports, query/fragment, percent escapes,
interior whitespace, nested wrappers and unsupported grammar fail.

Valid unversioned identifiers remain version:null with source-version-unknown
hold. A same-base explicit versioned alternate can qualify that version;
conflicting explicit versions fail. Public metadata URLs are recomputed from the
final resolved version, so a v2 observation links to v2. No v1 is guessed from
dates. v2+ predecessor references remain unverified proposals, not manufactured
v1 entities or observations. Source versions combine explicit vN/unknown and a
qualified semantic metadata hash; original spelling, feed timestamps,
page/entry pointer and ingestion time do not change it.

Every candidate stays at preprint stage and publicationAuthorized=false. Entry
published and updated are retained as distinct reported instants. Journal
citations do not establish peer review, and DOI values use the separately
accepted bounded WP10 normalizer only as unverified link proposals. Same names
and sparse affiliations remain unresolved article-local authors, with current
employment unknown. Explicit author URIs remain identity-link proposals. Email
redaction covers displayed titles, authors, affiliations, comments and rights
text. License links/text, including unknown extensions, remain unadmitted hints
and never establish reuse or metadata collection permission. Source comments
suggesting withdrawal/correction/retraction produce review proposals/holds;
there is no unsupported structured status claim or automatic removal.

Owner checks use `.discovery-work/wp11/run.sh` with qualified Node 22.23.2 and
workspace caches. Explicit app-project typecheck passed. The authored identifier
probe passed six supported round-trips, twelve unsupported forms and scope
construction including physics.med-ph. Logs are under
`.discovery-work/wp11-sol/`. Two mistyped scratch shell assignments failed
without mutation before the correct wrapper run; no result from those commands
is counted as validation. Terra owns actual-D1 tests and Astra owns adversarial
review; owner checks do not accept this package.

Primary arXiv documentation consulted on 2026-11-15 (reference pages only):

- [API manual](https://info.arxiv.org/help/api/user-manual.html): exact query/offset/sort fields, Atom/OpenSearch/arXiv namespaces, source versus feed dates, explicit author affiliations and error feeds.
- [Identifier specification](https://info.arxiv.org/help/arxiv_identifier.html): modern width transition, legacy date/sequence grammar and explicit versions.
- [Identifiers for services](https://info.arxiv.org/help/arxiv_identifier_for_services.html): root/Astra-verified legacy subject-class aliases defining EX16.

No example provider query linked from those pages was fetched. The manual's
recommended spacing and actual route/retention/operating behavior require real
source qualification before any future activation.
