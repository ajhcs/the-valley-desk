# WP10 owner handoff — Sol

Implementation candidate only; independent review and root acceptance remain
separate. No real Crossref API collection, enrollment, activation, migration,
editorial admission, commit or deployment was performed by this owner. All
fixtures are authored synthetic examples. No accepted shared contract or other
provider was edited by the adapter owner; the root-owned EX14 composition adds
the read-only WP07 chain-page lookup and documents the new DOI subset.

`qualifyDiscoveryCrossrefScope` freezes the declared scope ID/revision, work or
institution query literal, publication-date window, page size, page/item caps
and explicit candidate denominator into a content-derived scope ID. This checks
query grammar, not the real location of an institution or provider permissions.
WP06 source qualification remains separate. A Crossref-only route has no
GitHub/PubMed/project prerequisite and cannot establish regional relevance or
person identity from a query match.

Supported exact enrolled endpoints are `https://api.crossref.org/works` and
`https://api.crossref.org/v1/works`. Fixed fields are precisely `query` or
`query.affiliation`, the frozen `from-pub-date`/`until-pub-date` filter, and
`rows`; `cursor` is the only dynamic required token/page parameter. Unsupported
query/filter names cannot broaden a request. Windows are at most 366 days,
page sizes 1–100, pages 1–100, and total raw items 1–1,000 per chain. WP06 budgets
can impose lower request/byte/item limits; parser bodies are bounded to 48,000
bytes. Caps count raw provider items, including rejected items, not only valid
leads. Short pages with contradictory reported totals, malformed/duplicate
items, missing cursors and exhausted caps remain incomplete with explicit gaps.
No global regional recall or stable provider snapshot is claimed.

The current parser validates the actual live issued plan through
`registry.resolvePlan(request.budgetReservation.id)`. Continuations bind the
actual plan descriptor to a genuine retained parent receipt, raw next-cursor,
exact source/configuration/scope/parser/permission/request hash and bounded chain
ancestry. `resolveChainPage` looks up retained same-chain ordinals; each returned
ID is independently read through the real receipt resolver. Historical immutable
claims additionally bind predecessor IDs/checkpoints, source, chain, original
ordinal, issued plan, round/slot and timestamps. Old ancestor plans are never
resurrected after leases settle. Missing, removed, changed or future-dated parent
receipts fail safely.

Cursor usability is clamped to the earlier of the original parent claim expiry,
the authenticated continuation expiry and the local five-minute ceiling.
The original claim lease is at most five minutes and predates token creation;
this conservatively bounds usability even if WP07's generic cohort TTL is longer.
It can reject a still-usable provider cursor. The historical `replay(receiptId)`
path reconstructs private metadata from usable retained bytes and immutable
ancestry without requiring a live plan or current cursor usability. It checks the
reconstructed draft against the committed receipt; future-dated evidence still
fails. Live `inspect` remains subject to live plan authority and is not a replay
API.

Crossref may return unchanged cursor tokens. The adapter does not assume tokens
increase, while accepted WP07 replay/cycle safeguards can stop such a chain.
No bypass or provider-specific automatic restart was added. Crossref's current
Tips page and Swagger can differ in cursor details; actual permitted source
qualification under E04 is still required. Provider errors, token expiry or
unsupported behavior cannot be reinterpreted as healthy empty discovery.

The DOI normalizer is a **new bounded WP10 rule**, not a pre-existing WP02/WP04
implementation. `crossref-doi-ascii-v1` accepts a bare `10.` prefix with 4–9
registration digits and a nonempty suffix using only ASCII letters/digits and
`._;()/:+-`. ASCII uppercase folds to lowercase. Supported wrappers are a
case-insensitive `doi:` prefix and exact credential-free `https://doi.org/`;
outer ASCII spaces are trimmed. Original value, canonical DOI and canonical
provider-native identity remain separate fields. Trailing slash and punctuation
are preserved as distinct values. Controls, Unicode, interior whitespace,
percent escapes, query/fragment/port/userinfo wrappers and dot path segments are
unsupported. Public DOI URLs must round-trip without URL canonicalization or
encoding changes. The fixture truth table records positive/negative forms.
Unsupported legitimate DOI syntax yields an explicit rejected-item gap instead
of a normalization guess. DOI equality proposes identity only within the
provider namespace; no cross-provider entity or preprint/article merge follows.

Qualified item fields are title arrays; bounded author/editor records and
reported affiliations; the explicitly supported publication types in source;
publication `published`, `published-online`, `published-print`, `issued`
date-parts; separate created/deposited/indexed metadata dates; bounded license
links and relationship/update metadata. Year/month/day precision is preserved.
Deposited/indexed dates never enter publication source dates or publication
stage. Names and affiliations remain unresolved and current employment remains
unknown. Contact email redaction covers displayed titles, names and affiliations.
Malformed heterogeneous items create rejected counts/gaps while valid items on
the same page remain captured. Raw bytes remain subject to qualified retention
rights; projection does not rewrite retained hashes.

Metadata versions hash qualified semantic values, including subtype/stage and
separate metadata dates, independently of ingestion time, page position and
JSONPointer evidence location. DOI spelling variants share native identity.
Changed supported metadata yields another private version and review holds;
no admitted canonical row is overwritten. Same-name contributors do not merge.
License metadata is only an artifact-rights hint, never collection/redisplay
permission. Public links reject queries, credentials, ports, fragments,
noncanonical URL changes and structural local/private host forms. No link is
fetched, and this is not DNS or target-access qualification.

Relationship candidates retain reported type/identifier and page-scoped exact
JSONPointer evidence locations. Endpoint absence or unsupported targets produce
review holds and incomplete page gaps. A DOI relation does not establish origin
or independent corroboration. `distinctReviewedOriginCount` delegates only
validated evidence references to the existing evidence store's
`distinctOriginCount`; provisional origins are rejected there and separately
reviewed representations of one original work count once. The adapter invents
no evidence, origin or catalog rows and cannot confer review authority.

Owner checks: qualified Node 22.23.2 with workspace-local TMP/XDG/npm caches;
explicit `tsc --noEmit --project tsconfig.app.json --pretty false` passed after
the final changes (empty `types-final.log`). The authored DOI truth-table probe
passed four supported round-trip cases, ten unsupported cases and frozen scope
construction (`doi-probe.log`). Earlier candidates and independent
findings remain retained in task evidence. Terra owns actual-D1 tests and Astra
owns adversarial review; owner checks are not package acceptance. Real provider
access/retention, E04 route qualification and WP14 admissions remain outstanding.

Official primary documentation consulted on 2026-11-15 (reference retrieval only):

- [Crossref REST API Tips and tricks](https://www.crossref.org/documentation/retrieve-metadata/rest-api/tips-for-using-the-crossref-rest-api/): exact work routes, date filters, rows/cursors, reindexing and distinct created/updated/indexed metadata.
- [Crossref relationships](https://www.crossref.org/documentation/schema-library/markup-guide-metadata-segments/relationships/): typed relation/identifier declarations and limited corroboration meaning.
- [Crossref Swagger](https://api.crossref.org/swagger-ui/index.html): root/reviewer-verified cursor expiry and endpoint schema; this owner did not send provider API collection requests.

Two obsolete documentation URLs returned failures; no provider data request or
access workaround was used to replace them. The primary Tips/relationship pages
and root's EX14 source notes provide the retained documentation trail.
