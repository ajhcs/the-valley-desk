# GL03 bounded operator acquisition — implementation

This package adds a private, operator-run acquisition frontier. The SQLite journal contains **no HTTP client or publication writer**; the separate bounded capture client is described below. The package adds no public API, scheduler, migration or Worker activation. `src/ingest/discovery/directory-acquisition.ts` defines strict serializable plan, native receipt and reduced-fact packet schemas; `scripts/discovery-directory-acquire.mjs` is the Node-only SQLite journal. It embeds the existing GL01 `DirectoryPrivateFrontierSchema` and `DiscoveryCollectionLead`, preserving `publicationAuthorized: false`; it does not claim source enrollment or replace the original guarded WP06/WP14 authority contracts. Existing transport is not assumed to implement this batch's zero-redirect, identity-encoding or whole-body/retention rules.

## Operator boundary and exact bindings

An operator provides a reviewed finite page plan bound to the exact GL02 manifest file SHA and reviewed scope/qualification digest. Each predeclared page binds provider, installation, source, scope, route, exploration county, reason, chain/parent/page, parser revision and SHA. The request digest is SHA-256 of canonical JSON containing the exact GET URL, Accept, identity encoding, User-Agent, optional GitHub API version, byte and wall limits and zero redirects. The plan is deeply immutable after opening and its canonical SHA is persisted; a changed plan cannot reopen that journal. Plan validation and digest equality do **not** authenticate operator approval, provider qualification, source terms or factual truth; those depend on the separately reviewed preflight and accountable operator.

`reserve(pageId)` transactionally charges request count and worst-case page capacity before any send; `markAttempt(pageId, issuedAt)` commits the one-way transition and returns the exact request tuple and a unique deterministic attempt/operation ID **once**. The external root-owned, separately qualified sender must call it before the native request and enforce its own public-destination, TLS, timeout, content, no-redirect/no-retry and complete-body preflight rules. The journal has no capability to intercept an unrelated request: its budget guarantee applies only to sends actually routed through this operator procedure. Once issued, a crash leaves the attempt charged and uncertain; reopening cannot issue another permit. A reserved but unissued page can be marked once. A refused or rate-limited provider is held, including already-reserved pages that have not been sent; malformed/unavailable/unknown outcomes hold the affected source scope. No automatic retry or continuation bypass is provided.

`finish(receipt, packet)` binds the receipt to the exact issued page, source, scope, installation, plan, request, qualification, parser and timestamps. A successful receipt requires HTTP 200, identity content encoding, valid UTF-8, JSON MIME, zero redirects, at most the page byte cap and completion within the page's declared deadline. Failure receipts have no retained projection and may record a timeout after the deadline. Native-body SHA and reduced-facts SHA are different fields; the journal never stores the native body. A fact packet includes parser revision/hash, source pointers for the native ID, title, URL and every retained optional field/date, and the GL01 private lead. It is accepted only after external whole-payload preflight; its pointer and metadata assertions cannot be rechecked against discarded native bytes by this journal. GL04 must independently validate evidence/rights and reviewed publication authority. No result, including `ready-for-reviewed-projection`, can authorize public output.

The successful receipt includes `packetSha256`, the SHA-256 of the canonical complete fact packet, as well as `projectionSha256`, the SHA-256 of its canonical reduced `facts`. The complete packet commitment covers continuation, provider-incomplete status and observation date as well as the facts. An exact replay returns the existing outcome with no new candidate; a changed receipt, packet, request, page, source, parser or hash is rejected. Unique source-native identities deduplicate provider-scoped works while preserving each source/page observation; exploration county is a search context, not proof of a record's location. User-owned and paperless repositories and standalone publications can enter the private queue. The importer retains only a strict fact shape and rejects contact/credential-like material recursively before SQL writes; whole-source preflight remains necessary, and heuristic checks are not proof that arbitrary material is safe.

A `more` continuation records the next request digest. If a planned successor exists, it must match that digest and the prior page must have completed with `more` before it can be reserved. A missing planned successor or provider-incomplete result is `capped`; unknown continuation, malformed input or a zero-fact response is `unknown`, not healthy-empty or complete. Refusals, rate limits, unavailable responses and uncertainty remain distinct. Conservative worst-page capacity is reserved against county, total and queue limits before sending. A defensive cap retains a bounded private pending packet and count rather than silently discarding it; `pendingPacket` exposes it only to the local operator. No fixed lead count is a launch coverage claim.

The GL02 aggregate/provider request, page and lead limits are upper bounds. The store charges each reservation its full declared request timeout against the frozen total and county active-time ceiling, including uncertain attempts; operators also record non-network active time through idempotent `recordActivity`. This conservative accounting depends on the trusted operator recording that work and on host-clock and sender deadline integrity. It is not an attested clock or enforcement over independent network clients. The plan may specify stricter limits, including the five-record one-page first qualification probe.

## Storage and recovery

The caller supplies a real, existing owner-only directory beneath `/workspace/build/builderbob`; symlinked directories, non-private modes and symlink/hardlinked or non-private database files fail closed. The journal is a mode-0600 SQLite file in that directory, with full synchronous commit and `BEGIN IMMEDIATE` transactions. One private record holds each page result and candidate/observation; raw articles, provider bodies, contacts and credentials are outside the allowed packet. The 0700 directory is the isolation boundary against other Unix users; it does not claim to defend against a hostile process with the same trusted Unix authority or a compromised filesystem. Backup, deletion and storage lifecycle are separately scoped operator responsibilities.

Crash semantics are conservative: after reservation but before `markAttempt`, no send was permitted and an operator may mark it once; after marking, it remains charged and cannot be sent again automatically. A saved actual receipt can still be imported into the issued attempt after restart. A committed import replays idempotently; an interrupted transaction rolls back. `progress()` reports attempted page states and activity, `listCandidates()` returns the private queue and origin observations, and `pendingPacket(pageId)` returns an unimported bounded fact packet if a defensive capacity check triggered. These are private operator reads and do not publish or fetch.

## Evidence and remaining acceptance work

Synthetic local tests use temporary owner-only directories on `/workspace` and exercise permits, process restart and a two-process race, body/projection/source/parser mismatch, privacy guards, provider holds, pagination and caps, account/topic deduplication, a User-owned repository, a standalone publication, and no-publication frontier state. Full test results, exact final hashes and independent Sol probes are recorded separately by the orchestrator. Synthetic packets do not satisfy GL03-A1 or prove a provider's parser, current terms, native source, public visibility or repository-to-institution relationship.

Actual account enumeration and an independent topical or publication route require the separately accepted source preflight, root's reserved/issued native requests, whole-payload inspection, reviewed fact-only packets and receipts, and independent replay/qualification before being claimed. A failure, inaccessible source, partial page, capped frontier or missing continuation is an explicit gap, never complete coverage. The actual bounded source evidence and review are recorded in the source results and acceptance receipt; broader integration remains separate. GL04 owns any later public projection; GL09 reports actual scope, incompleteness and follow-up. No full-system benchmark, old package status or WP source enrollment is changed by this journal.

## Actual operator boundary

The [capture method](../../../../scripts/discovery-directory-capture.py) invokes
the [journal boundary](../../../../scripts/discovery-directory-journal.mjs)
immediately before HTTP; it accepts no saved send-permit file. Only the two
reviewed manifest identities are recognized. Both the source policy/manifest
and their actual private copies must match the frozen bindings before issue.
The exact plan is then bound by the durable journal. No source body is written.
The [inspector](../../../../scripts/discovery-directory-inspect.mjs) performs
whole-body privacy/material screening and closed field/type validation before
projecting facts. The exact Crossref search query, first offset, page size,
total and publication type are checked. Arbitrary provider metadata does not
become a publication merely because it comes from Crossref.

The original five-probe method intentionally stopped on three inspection gaps.
The new two-probe qualification preserved those failures and charged requests.
It did not expand the Organization field census. Its User inventory method
discards Link without reading or forwarding its value and always reports
continuation unknown; duplicate Link headers cannot change that method's
outcome. Its separate journal-article search independently checks the filtered
native type. The sender verifies all prior receipt hashes and carries any
provider refusal/rate-limit hold before obtaining a supplemental permit.

Actual results and limits are in [source results](GL03-source-results.md), with
the two immutable scopes in [internal evidence](../evidence/GL03/README.md).
There is no generic cross-batch reset or permission to add future requests.
GL04 must review relevance, regional evidence, rights and publication authority;
GL09 must investigate the unresolved Organization inventory and breadth gaps.
