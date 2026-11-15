# Implementation decisions after WP00

These decisions extend the active execution record. They preserve the frozen
handoff and historical receipts; each package still needs independent review.

## EX06 — Local validation isolation and reproducibility

The baseline test run failed eight social-intake assertions because their August
fixtures expired against the November wall clock. Sol reproduced the actual
`observed_at_invalid` response before persistence. The orchestrator accepted a
test-only Date mock aligned to the fixture, with six exact freshness-boundary
cases. Production validation remains unchanged. The repaired existing suites
passed; see [the baseline receipt](baseline-validation.json).

The local smoke command now selects a dedicated fake D1 configuration and a
separate checkout-local persistence path. Both commands retain `--local`; the
smoke no longer loads production bindings, routes or schedules. Sol inspected
the diff. Its actual execution is recorded in the integration receipt. This
does not turn the smoke's sequential in-memory batch mock into transaction proof;
WP04 uses real local D1, and later publication requires its own race tests.

Affected: WP00 validation setup, WP04 migration checks, WP23 CI qualification.
Reconsider if the runtime, lockfile, clock boundary or test configuration changes.

## EX07 — Separate reference preparation from the later admitted-item audit

WP03 precedes WP14 admission. Requiring a completed audit of 100 admitted
discovery items before accepting WP03 would create a dependency cycle. WP03 must
freeze the audit selection procedure and denominator rules; WP24 must select and
evaluate the actual admitted-item sample after the system can admit items.
The 100 independent-item minimum, precision threshold, Wilson lower bound and
critical-error gates are unchanged. Actual held-out and independently assembled
recall references remain required for WP03 acceptance.

Within a held-out partition, distinct works may share a creator or project.
Their families must not cross into development. Mirrors, versions and equivalent
underlying cases count once; shared creators alone do not reduce the mandated
360-case quota. Audit and recall overlap is a sampling-design question, recorded
explicitly rather than forbidden by an invented rule. Clustering is still
reported and affects the scope of statistical claims.

Admission precision uses audited admitted items. Candidate prediction precision
is a separate diagnostic. Unresolved admitted items remain in the denominator
and do not become true positives. Captured, admitted and published recall remain
distinct; an unavailable stage cannot borrow another stage's result.

Basis: the actual dependency graph and a review of the first validator. Owner:
orchestrator; implementation: Astra; independent review: Terra. Affected: WP03,
WP14, WP24, R17 and E02/E03. The native source-truth and statistical-assumption
limits remain unchanged. Reconsider if the evaluation design or sampling frame
changes; freeze a new revision before examining new evaluation outcomes.

## EX08 — Evidence ownership and first acquisition

Design adopted on 2026-11-14 during WP05 implementation. Package acceptance
requires separate final receipts; this decision is not a test result. The
orchestrator owns the decision, Sol implements it, Terra authors independent
acceptance cases and Astra challenges the implementation and transactions.
Affected: WP05, WP06, WP07, WP14, WP16, WP22, WP26; C_EVIDENCE,
F_CAPTURE/F_RESOLVE/F_LINK, IF02–IF05/IF07, P07/P09/P10/P12/P27/P32.

The private ledger separates immutable revision identities, dependency edges and
permitted audit records from removable content. Reviewed removal deletes the
scoped content and its dependent quotes, values, claims, rationales and notes.
It preserves only audit fields expressly permitted by the trusted capability
resolver. Operation records retain the verified capability receipt binding;
opaque tokens are never persisted. Replaying a removed operation reports a
tombstone and cannot restore its content.

Ownership is explicit. Every source-bearing origin rationale names its retention
rights, including revisions no capture has used yet. Shared source controls carry
machine identifiers, not quoted source material. Removal traverses dependents of
all revisions of the revoked material scope. It must preserve separately permitted
material sharing the same enrollment, configuration, parser or policy. The
rejected reverse traversal and its two actual D1 counterexamples remain in
[Astra's review](reviews/wp05-astra.md).

New evidence use checks the entire ancestor chain for expiry, tombstones and
invalidation within the committing transaction. Rights, permission and enrollment
ancestors must still have their pinned current heads. Historical representation
revisions remain exact: observing a changed representation does not rewrite an
earlier quote. Grant renewal requires explicit requalification of earlier
bindings; it cannot silently make them current. WP14 must implement that
requalification and the full WP02 public dependency vector. Fresh, authorized
removal can erase expired material; expired use permission must not prevent its
removal.

An evidence read observes the target and its ancestor state in one SQL query.
It verifies canonical content hashes and retained representation bytes, normalized
text and supported transform versions before returning usable content. A corrupt
ancestor quarantines its dependents without rewriting history. The initial read
bound is 512 ancestors and 4 MiB of ancestor content; exceeding either is an
explicit failure. Individual captures retain at most 48,000 supplied body bytes
and must also satisfy the 262,144-byte canonical JSON bound. These are application
bounds, not measured provider capacity. Hash agreement establishes retained-byte
integrity, not source truth.

WP04's temporary catalog anchors do not qualify evidence. Until WP14 supplies a
reviewed publication/removal bridge, both creation orderings of a bridge from the
WP05 ledger into immutable catalog decision, relation or alias payloads fail
closed. This prevents source content from escaping the removal graph. Existing
independent catalog identity behavior remains covered by its own tests.

First acquisition needs a separate source-response material scope. A permitted
directory or API response can exist before the system knows any discovered person
or work. Assigning fabricated artifact and original-work identities to that
response would confuse retention authority with evidence about the region.
The adopted contract therefore distinguishes:

- Artifact material: the actual artifact ID, version and material class.
- Source-response material: source, installation, enrolled scope, enrollment and
  configuration revisions, endpoint constructor/template digest and normalized
  request-scope digest, plus the permitted response material class.

Capture, permission and rights must agree on the complete material scope.
Source-response intake additionally resolves an issued request through a trusted
server integration. Its exact request identity/digest, concrete endpoint,
provenance member, rights, permission and expiry bind the mutation; missing or
mismatched resolution fails closed. A caller-supplied digest or readiness flag
cannot establish issuance. WP06 owns the actual registry/qualification and
transactional issuance predicates. Local resolver fixtures do not qualify a
provider or permit production collection.

Each issued response may have provisional provenance with no original-work ID.
The numeric independent-origin counter refuses unresolved provenance. Parsing or
HTTP success cannot promote it to a reviewed original. A response may contain
several works; WP14 must explicitly adjudicate exact evidence selectors/revisions
to their reviewed origins before such evidence can support independent
corroboration. A page-level origin is insufficient for that claim.

WP05 acknowledges an evidence revision only. WP07 must compose its guarded
retention statements with normalized observations, page receipt, lease and budget
checks, and contiguous checkpoint advancement in one D1 transaction. Separate
successful calls cannot substitute for that atomic page commit. The existing
IF02 provisional-capture/durable-page distinction remains in force.

The implementation tests logical removal in the current database. Physical erasure
from backups or D1 Time Travel is not established; WP26 must reconcile removals
after restore and rotate recovery incarnation before reopening discovery. Real
rights, authentic reviewers, provider access and public admission retain their
separate evidence gates. Reconsider this decision when adding storage outside D1,
new content-bearing fields, a publication bridge or a new retention scope.

## EX09 — Registry guards in the evidence transaction

Design adopted on 2026-11-14 for WP06, after WP05 acceptance. The orchestrator
owns this amendment and its narrow evidence-store change; Sol owns the registry,
Terra owns transport, a separate Sol agent authors acceptance tests and Astra
reviews independently. Affected: WP05, WP06, WP07, WP08–WP13, WP22, WP23, WP26.
The original [WP05 receipt](receipts/WP05.json) and its exact accepted files remain
preserved under `.discovery-work/wp05/accepted-candidate/`. They describe the
previous implementation. This amendment requires new integration evidence before
WP06 acceptance; it does not rewrite those historical hashes or results.

The server-side registry factory supplies the evidence store with both its issued
request resolver and its capture-transaction composer. The composer derives the
actual successful transport attempt from durable issuance, endpoint, received-byte
digest and byte length. A caller-supplied attempt, lease reference or readiness
flag cannot establish those facts. Source activation or bounded sampling authority,
qualification, configuration, current grants, lease ownership/fence/expiry and
remaining reservation must be checked against current rows in the same D1 batch
that retains the response.

The evidence store accepts a trusted prepared-statement composer for new
source-response captures. It passes detached input values and the digest of its
actual supplied bytes. Precondition statements run after the evidence guard and
before revision writes. Settlement statements run after the immutable evidence
operation insert, before guard cleanup. Any statement failure rolls the whole
batch back. The evidence store copies the returned statement arrays. Replaying
an already committed evidence operation returns its current availability without
composing or settling again. The optional low-level seam preserves isolated
WP05 use; runtime source intake must use the registry factory that binds both
resolver and composer. No request body can supply statements.

A request deadline limits dispatch and new capture; it is not the lifetime of
evidence already retained. The issued ledger anchor uses the source retention
valid-through bound, while the source's exact permission and rights ancestors
continue to impose earlier expiry or revocation. The runtime retains the short
request deadline separately and checks it in the capture transaction. Advancing
past that deadline must deny a new capture without invalidating a previously
retained sample solely because the network attempt has ended.

The initial registry allows an attempt only at its exact issued endpoint. A
redirect to a changed endpoint, including another valid URL on the same origin,
requires separate reviewed issuance and is not followed automatically. This is
a declared limitation for provider qualification. Valid pagination remains a new
request bound to its actual retained parent; it does not inherit arbitrary URL
authority from a redirect or response body.

SQL request admission is the authorization point for a network attempt. Every
attempt, retry and permitted redirect consumes a durable request permit and
reserves response capacity before dispatch. An uncertain dispatch remains charged;
replaying its ID cannot send again. A database transaction and a physical socket
send are not atomic: revocation after admission may precede the actual send.
Subsequent admission and retention must fail once their current predicates fail.
An injected egress authority must enforce public destinations at connection time;
URL syntax alone does not prove DNS safety. An absent egress integration fails
closed, and synthetic transport checks do not qualify real network enforcement.

Byte limits distinguish reserved response capacity, supplied and retained bytes
from wire traffic. A received chunk can exceed the bound before cancellation;
that response cannot be retained. Oversized, expired, failed and uncertain
attempts cannot silently free their permit for another external effect. Provider
backoff persists across registry recreation. Credentials remain in ephemeral
header bindings, and dependency exceptions cannot contribute secret-bearing
messages to failure receipts.

The management interface cannot reserve an external attempt or supply a received
result directly. Its transport factory closes over those operations; the trusted
egress implementation supplies the actual response. This constrains the runtime
API, not code that already owns unrestricted database or egress authority.

Issuance returns its opaque binding token once. Durable plans and operation
receipts retain its digest, never the token. Replaying issuance returns metadata
with no recovered token. Losing the first result therefore requires a newly
authorized request and charged attempt; an earlier uncertain reservation remains
charged. WP07 must preserve this recovery limitation until a separately reviewed
capability recovery design replaces it.

Failure attribution resolves the immutable source and issuance-operation IDs from
the permitted issuance audit before checking readiness. This lookup grants no
acquisition authority and remains available after source-bearing plan removal.
A missing or unusable audit returns the reserved `source:unresolved` and
`operation:unresolved` markers; the plan ID is never substituted for a source ID.
These markers cannot be enrolled as a real source or registry operation. Future
health stores must handle unresolved failures without creating a source record.
Issued plan identities are permanently unique in the audit, including after
scoped removal; a new operation cannot reuse an erased plan's identity.

The registry has no built-in provider parser or default page-receipt resolver. A
trusted integration must resolve continuation receipts into their exact parent
request, retained representation and next token. WP06's six route fixtures use
an explicitly synthetic receipt store. They do not establish a production
SourcePage. Parent evidence must pass integrity/currentness checks, and its normal
expiry, invalidation and control-head changes are checked again in the issuance
transaction. A body containing `committed: true` is not such a receipt.

Each actual attempt reserves an item allowance along with its request and byte
capacity. The retained-representation resolver supplies that durable allowance to
the parser. Parsed output cannot exceed it; an oversized logical page yields
explicit rejected rows, truncation and partial completeness. Counts reserve
capacity conservatively; they are not an inventory census or proof of coverage.
Scoped removal also erases registry copies of parameters, continuations and
sample endpoints, while preserving unrelated revisions and consumed budget
accounting.

WP06 still acknowledges only evidence revision retention. WP07 must extend this
transaction to normalized observations, a page receipt and contiguous checkpoint
advancement, with its own reviewed recovery and lease rules. Synthetic provider
fixtures, authentication resolvers and sampling grants are implementation evidence
only. No actual provider has been activated or qualified by this amendment.


## EX10 — Durable collection composition and bounded round policy

**Status:** Accepted design and local WP07 implementation, following independent
Sol/Terra/Astra checks and root integration qualification. See the
[WP07 receipt](receipts/WP07.json) and
[WP06 compatibility amendment](receipts/WP06-WP07-collection.json).
The accepted WP05/WP06 source files and original receipts are preserved. The
WP06 twenty-file accepted snapshot matched the current tree before this work
began. This decision specializes the existing trusted transaction-composition
seam without granting a parser publication or persistence authority.

A discovery round freezes a finite, ordered eligible set of source revisions and
their query/window bindings. Its round ID identifies that membership snapshot.
The separate inventory `cohortId` freezes policy and each source's continuation
lineage across rounds; a later round may add another selected source, but cannot
change an existing source's query, window, configuration or inventory caps. Each source gets one bounded page attempt per round. A
completed failure, timeout, blocked or revoked slot advances the cursor just as a
committed page does. A source enrolled after the snapshot enters a later round.
Only continued dispatch and eventual lease recovery establish conditional slot
fairness; neither condition guarantees upstream success or complete coverage.
The implementation must preserve the cohort and cursor across process restart.

Migration 0044 strengthens the runtime beneath WP06 without editing its accepted
source: one actual lease per source and an admission guard for plans bound to
collection rounds. Existing duplicate leases make migration fail without choosing
an owner. Compatibility under the new migration requires a separate WP06
requalification receipt; its original receipt remains historical evidence.

A collection factory owns the same D1 connection, registry, continuation resolver
and evidence-store composition. The retained-only WP06 adapter contract stays
unchanged. A new trusted provisional parser receives detached acquired bytes and
the exact issued request with its reserved item allowance. Its result is a draft,
with no durable acknowledgment or publication authority. The collection store
validates the draft and binds its representation hash, parser, request and source
to the actual received transport attempt. This is an implementation contract for
trusted provider code, not an assertion that arbitrary source statements are true.

The safe factory owns the trusted parser dependency. Preparation returns an
opaque process-local handle bound to privately copied bytes and validated parser
output. Commit cannot accept arbitrary caller-authored leads with a matching body
hash. A lost uncommitted handle supplies no authority after restart; committed
operations reconcile through durable receipts. The parser's semantic correctness
still requires provider qualification and independent evaluation.

The trusted parser explicitly selects the existing JSON or UTF-8 text retention
format. This lets Atom/XML and HTML/text metadata use the same atomic collection
path without mislabeling them as JSON. Candidate records preserve source stage
and a bounded set of named, precision-aware source dates. No ingestion timestamp
is substituted for an unknown source date. Different versions/stages may share
one native candidate key without merging their separate observations.

The normalized observations in this package are private candidate leads. Their
provider/native identity, kind, label and unresolved links are bound to the actual
retained representation and parser. They do not invent catalog subjects, selected
evidence or identity adjudication. `DiscoveryCollectionPageReceipt` acknowledges
this private acquisition stage. It is deliberately distinct from the shared
`DiscoverySourcePage`, whose observations require actual evidence references.
WP14 supplies the later materialization/adjudication bridge. A representation ID
is never placed in an evidence-reference field to satisfy that shared schema.

Issued-request and provisional-origin anchors may be prepared before a page
transaction. Raw bytes, normalized observations, the durable page receipt,
contiguous checkpoint, settlement, success state and cursor advancement must
commit together under current registry and collection lease/fence guards. An
empty nonterminal page is retained but cannot establish completed inventory. A
rejected row, truncation, token loop, missing terminal page or failed transaction
prevents complete coverage. Existing one-time issuance binding tokens remain
ephemeral: a lost uncommitted token requires a newly authorized issue and charged
attempt in a later round; uncertain reservations are never reclaimed merely
because a worker died.

Claiming or taking over a collection slot must atomically establish its linked
registry source lease, including owner, fence and expiry. An old collector cannot
acquire a replacement source lease after losing its slot. Stop invalidates that
linked lease for later admission. The accepted SQL admission point still cannot
retract a physical request already admitted; subsequent capture remains guarded.
A timed-out database mutation has an uncertain result until its durable operation
is reconciled. Timeout alone never authorizes a compensating write or free retry.

The run policy records retry limits, stop behavior and page bounds before work.
Continuation across rounds keeps its source revision, query and inventory window.
An expired token or changed binding ends that inventory chain and requires an
explicit new cohort identity; prior retained evidence remains inspectable. Last
attempted, last successful collection, last complete inventory and last public
refresh are distinct. This package cannot advance public freshness.

Every new source-bearing table carries the exact material-scope hash for scoped
removal. Removal must not depend on the execution order of the existing registry
removal trigger or on rows that trigger may already have erased. Budget and
minimal audit identities remain conservative and cannot be reused after removal.

Acceptance requires actual local D1 transaction failures, competing worker and
restart traces, an ordered dispatch ledger, page-chain fixtures and reconciled
request/byte/item counters. The native model's conditional fairness assumptions
remain explicit; implementation checks do not establish real provider coverage,
reader usefulness, production operation or deployment readiness.

The implementation relies on D1's documented batch rollback semantics, checked
on 2026-11-14. Query, parameter and row bounds apply inside each batch; actual
local D1 tests must exercise the composition rather than a sequential mock.
[Batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/) and
[platform limits](https://developers.cloudflare.com/d1/platform/limits/) describe
the platform contract, not evidence that this package satisfies it.

## EX11 — GitHub pagination and rate-limit transport metadata

**Status:** Accepted design and local WP08 implementation after independent Terra
review and root qualification; original WP06/WP07 behavior requalified in the
[composition receipt](receipts/WP06-WP07-WP08-composition.json). Affected: WP06,
WP07, WP08 and later provider/operational qualification. No policy threshold changes.

GitHub source parsing needs its observed pagination header. A body-only acquisition
cannot validate an unqualified next URL. The transport now supplies an optional,
bounded `responseLink` value. GitHub acquisitions include an explicit string or
null; legacy acquisitions preserve their optional-field-free shape. The exact
value is part of the existing canonical `finish_sha256`. WP07 validates that digest
before provisional parsing and retains the value in its integrity-checked private
page receipt. No new migration or header blob store is introduced. A caller cannot
replace a next link with null while preserving the recorded finish binding.
Scope withdrawal removes the copied header with the existing page payload.

The adapter validates observed Link relations against the exact enrolled origin,
path, query parameters and page bounds. It derives the next checkpoint from a
validated next relation. Missing metadata cannot prove completion. A full page
without a next relation stays partial; short terminal search pages also need
consistent reported counts. This service continues to describe a selected scope
and window, not a complete geographic census or a stable upstream snapshot.

GitHub primary/secondary rate-limit responses may use 403. Explicit remaining=0
or Retry-After headers distinguish rate-limited 403 from plain auth-failed 403.
429 retains rate-limited semantics. For GitHub limits, backoff honors the longest
of a conservative one-minute floor, Retry-After and a valid rate-reset epoch;
overflow saturates to the supported timestamp ceiling. Non-GitHub 403 behavior
is unchanged;404 does not reveal whether a private repository exists.

GitHub requests also use the existing product User-Agent, JSON media type and pinned
API version 2022-11-28. These are server policy, not credential-supplied headers.
All requests remain unconditional. The closed transport never sends a conditional
validator, and an unsolicited 304 fails without new success/checkpoint. Retained
same-endpoint ETag refresh is a later optimization requiring its own qualification;
this increment does not claim that implementation or fabricate cached bytes.

The platform basis was checked on 2026-11-15 against GitHub's
[rate-limit troubleshooting](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api),
[pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api)
and [search constraints](https://docs.github.com/en/rest/search/search), and
[supported API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions).
The pinned version remains supported; revalidate its status before live qualification.
The compatibility amendment and WP08 receipt must record exact changed sources,
actual D1 results and retained limitations before local acceptance. Original
WP06/WP07 receipts and snapshots remain historical evidence.

## EX12 — PubMed search and metadata are separate durable scopes

**Status:** Accepted for local WP09 implementation after independent Terra/Astra
review and root qualification; see [WP09 receipt](receipts/WP09.json). Affects WP09, WP14, WP21, WP23 and WP24. No shared runtime or policy
threshold changes.

An ESearch response is retained with its exact institutional scope, query, window,
offset, requested page size, reported count and ordered PMIDs. Nonempty search
receipts remain incomplete while metadata is pending. Search cannot call EFetch
from its parser. EFetch has a separately enrolled source/template, request budget,
qualification and explicit collection round.

Qualified scope IDs derive from the complete validated evidence, declared scope
identifier/revision, exact accepted DVRPC county/state relation, query/window,
limits and denominator. The original declared ID remains inspectable. This avoids
changing geography or search meaning behind a durable source.scopeId. The adapter
uses the accepted PA/NJ nine-county keys; legacy broader regional geography cannot
expand discovery scope. First-party literal evidence produces private qualification
and author-at-publication candidates, not current employment or public admission.

A fetch source ID derives from its genuine retained search receipt, request/body
hashes, content-derived qualified scope, query/window/offset and ordered PMIDs.
The external lookup only locates that parent; changing it cannot authorize another
batch behind the same durable source ID. Source, plan and parse resolution enforce
the commitment after restart. Short inconsistent search pages fail instead of
skipping IDs. Root and result error/warning diagnostics are checked before any
healthy-empty completion; only the documented empty WarningList shapes pass. Valid capped search pages may supply a metadata batch while keeping
the inherited search-cap gap and inventoryComplete=false.

Budget exhaustion remains incomplete. A later source revision with separately
qualified permissions and an explicit new budget window/cohort may resume the
same batch; it cannot refund or reset the earlier consumed budget. A completed
metadata batch covers only those requested PMIDs. Missing PMIDs and partial author
coverage remain visible, and a publication needs no repository/project.

XML handling is conservative: only the selected unnamespaced PubMed vocabulary
and narrowly permitted stripped NLM external declaration are supported. No entity
resolution occurs. Mixed text/child content is rejected because the shared XML
projection cannot preserve its word order. Year/month precision is retained;
unknown reported dates and all candidate display/contact fields are redacted.
Correction/retraction metadata yields a new source version under the same PMID.
Restrictive parser/size behavior remains a real-source qualification limitation.

The existing Wistar implementation is unchanged and its tests become explicitly
enumerated. Live E-utilities provider-wide request pacing, access/rights and route
qualification must precede activation. There is no native network fallback or
new scheduler. The code does not claim current author employment, semantic source
truth, whole inventory coverage or empirical acceptance.

## EX13 — Offline signatures authenticate receipt bytes under operator pins

**Status:** Preparation increment independently reviewed by Terra/Astra and root;
see [signed intake receipt](receipts/WP03-signature-intake-progress.json).
Affects WP03/WP14/WP22/WP24. The real reference corpus remains absent and unfrozen.

A separate offline store verifies Ed25519 receipt and authority-statement envelopes
under independently supplied operator pins. Domain, algorithm, key identifier and
canonical payload digest are signed. Authority purpose/principal/grant validity
and existing manifest expectation bindings remain mandatory. Issuance/expiry is
rechecked after awaited cryptography. Bounded UTF-8 preflight precedes deep schema
cloning and refuses executable/non-JSON shapes.

Operator trust enrollment, current policy selection, trusted clock and anti-rollback
remain external responsibilities. Revocation is an explicit versioned expiring
snapshot that requires store replacement; no live feed or maximum policy TTL is
claimed. Signatures prove integrity under the supplied pins, not human identity,
rights, source truth or independent adjudication. The helper never issues a freeze.

## EX14 — Bounded Crossref identity and retained chain composition

**Status:** Accepted for local implementation; see the [WP10 receipt](receipts/WP10.json)
and [composition receipt](receipts/WP07-WP10-composition.json). Affects WP02/WP04's missing DOI rule and WP07/WP10/WP14/WP23.
No policy threshold, native model, schema migration or prior receipt is rewritten.

The WP10 handoff expected a previously frozen DOI normalizer. Inspection found
only opaque provider identifiers in WP02/WP04. This decision closes that missing
precondition explicitly. `crossref-doi-ascii-v1` accepts a bounded subset: printable
ASCII bare DOI, case-insensitive `doi:` prefix or exact `https://doi.org/` wrapper,
with optional outer ASCII spaces. The bare grammar is
`10\.[0-9]{4,9}/[A-Za-z0-9._;()/:+-]+`. ASCII letters fold to lowercase. Original
input, canonical DOI, native provider identity and normalizer version remain
separate. Public URLs must round-trip through the accepted subset. Slashes and
trailing punctuation are preserved, so `10.1234/a` and `10.1234/a/` remain distinct.
Controls, internal whitespace, Unicode, percent encoding, dot path segments, URL
credentials/ports/query/fragment and other wrappers are unsupported and yield
explicit rejected-item gaps. This is not a complete DOI grammar.

The [DOI Foundation resolution documentation](https://www.doi.org/the-identifier/resources/factsheets/doi-resolution-documentation/)
allows a broader character set and distinguishes trailing slashes. The limited
subset avoids silently changing those identifiers; extending it requires a new
reviewed normalizer version and equivalence evidence. DOI spelling normalization
does not grant person identity, regional relevance, artifact merge or independent
provenance.

Qualified scopes bind declared revision, reviewed literal/work or affiliation
query, date window, page size, chain caps and denominator into a content-derived
ID. The sole dynamic parameter is an opaque cursor. Exact `/works` or `/v1/works`
paths on `https://api.crossref.org` are permitted.
[Crossref's current API guidance](https://www.crossref.org/documentation/retrieve-metadata/rest-api/tips-for-using-the-crossref-rest-api/)
and [Swagger reference](https://api.crossref.org/swagger-ui/index.html) were checked
on 2026-11-15; the latter documents five-minute unused-cursor expiry. Real endpoint
behavior remains an E04 qualification obligation.

A small additive `resolveChainPage(chainId, pageOrdinal)` read-only store method
looks up existing collection rows, then delegates to `resolvePage` and rechecks
chain/ordinal. It cannot manufacture a receipt or bypass integrity/removal checks.
The adapter uses it to reconstruct exact predecessor pages, original claim
snapshots, request/body digests and checkpoints. Current parse/inspect resolves
the actual live issued plan. Historical replay resolves authentic retained pages
and bytes instead of attempting to revive a settled plan. No new write authority
or API endpoint is added.

The original parent claim expiry caps local cursor usability conservatively: a
WP07 claim lasts at most five minutes from before the response. The effective
deadline is the minimum of that immutable expiry, the issued continuation expiry
and parent commit plus five minutes. This may shorten a still-valid provider
cursor; it cannot extend one from delayed commit time. Expiry demands a new bounded
cohort rather than silently resetting the old budget. The accepted WP07 token-loop
rule remains enforced; providers that reuse a cursor will yield an incomplete
collection until a separately reviewed protocol can qualify that behavior.

## EX15 — Offline file intake is readiness reporting, not corpus acceptance

**Status:** WP03 preparation increment independently reviewed; see the
[CLI progress receipt](receipts/WP03-cli-intake-progress.json). Affects
WP03/WP14/WP22/WP24; thresholds and actual manifest remain unchanged.

The CLI accepts three explicit bounded local JSON files and an independently
supplied raw policy checksum. It invokes existing Ed25519 verification and
readiness checks, then creates a private no-clobber aggregate report. No network,
credential, key generation, signing, human enrollment or freeze path is added.
Exit 0 means ready for accountable freeze review; every report still says
not_frozen, freezeIssued=false and packageAccepted=false. Invalid inputs exit 3;
valid but blocked inputs exit 2. Raw input hashes support reproducibility without
disclosing receipt data.

Strict JSON rejects duplicate decoded keys, lossy/unsupported numbers and invalid
Unicode. Files, paths, byte limits, private output permissions and concurrent
no-clobber behavior are tested through actual subprocesses. Inputs must be stable
local snapshots. A hostile process under the same trusted Unix identity remains
outside this filesystem boundary. Policy byte integrity does not establish
operator authority, freshness, revocation administration or source truth.

Sol implemented the CLI; Terra tested it independently, including a wholly
fictional complete signed corpus returning exit 0 without freeze; Astra found and
verified the fix for symlink/space-containing executable paths that previously
skipped argument validation. The actual corpus remains empty and blocked.
