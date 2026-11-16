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

## EX16 — arXiv identity, version and offset scope

**Status:** Accepted local implementation; see [WP11 receipt](receipts/WP11.json).
Affects WP02/WP04's missing
identifier decision and WP11/WP14/WP23. No migration, threshold or frozen model
change. The handoff's expected preexisting arXiv normalizer was not implemented
in the generic provider identity contract.

`arxiv-base-version-v1` explicitly supports modern monthly identifiers with the
reviewed four/five-digit sequence transition and legacy archive/month/sequence
forms. Invalid month, zero sequence, unsupported date/width, encoding, whitespace,
credentials, port, query and fragment forms fail. Bare identifiers, arXiv prefixes
and exact http(s) arxiv.org abstract wrappers are supported; public links use HTTPS.
Syntax is not proof that a submission exists. Future grammar extensions require
a new reviewed normalizer rule.

The [arXiv identifier guide](https://info.arxiv.org/help/arxiv_identifier.html)
and [interacting-services guide](https://info.arxiv.org/help/arxiv_identifier_for_services.html)
were checked on 2026-11-15. The latter explicitly documents legacy subject-class
aliases. Optional .CLASS is removed only for math, cs, nlin and q-bio; original
spelling/class remains available. Other archive/class combinations are rejected.
The canonical base identity excludes version; an explicit version remains a
separate native version. An unversioned ID has version=null and an unknown-version
hold, never inferred v1. A same-base explicit alternate may supply a version;
conflicting versions are rejected. Links reflect the final resolved version.

The [API manual](https://info.arxiv.org/help/api/user-manual.html) supports the
reviewed Atom/OpenSearch vocabulary and source fields. Category/term/date-window
queries, page size, caps and denominator derive a frozen scope identity. Only
the numeric start offset varies at the enrolled HTTPS export API endpoint. Feed
self/next links are descriptive and validated against that scope, never followed
as egress authority. Feed IDs may differ by page query. Feed freshness is not a
scientific activity date; entry submission/update fields remain source dates.

The supported parser subset is text-only Atom with qualified namespaces and
exact returned-entry counters. Ambiguous text, foreign vocabulary, unsafe XML,
unbound page offsets, short inconsistent pages and changing totals fail or yield
explicit gaps. A stricter subset may reject legitimate provider records; actual
source response/rights/pacing qualification remains E04 work before activation.
Authors, affiliations, identity links, DOI/journal relations, predecessor versions
and licenses remain proposals. Category and keyword matches do not establish
healthcare relevance, county or current employment. Stage remains preprint.

Offset pagination has no imported Crossref cursor lifetime. Live parsing requires
the actual current WP07 plan, current lease and configured continuation expiry.
Historical parents bind scope, offset and ancestry; read-only plan/nextPage are
progress proposals, not request authority. Retained replay uses the accepted page,
claim and chain readers without reviving a settled plan. No new shared store seam
is needed. Equal-total membership churn cannot be detected reliably by offsets;
bounded traversal completion is not an immutable snapshot or regional recall.

## EX17 — Selection receipts bind case descriptors and source snapshots

**Status:** Reviewed WP03 preparation correction; see the
[progress receipt](receipts/WP03-case-selection-binding-progress.json). Affects
WP03/WP14/WP22/WP24. No schema, threshold, corpus or native model change.

Independent review reproduced a valid signed fictional manifest remaining ready
after county/challenge edits. The old selection payload did not bind those
readiness inputs. `discovery-case-selection-review-v2` binds full case descriptors,
manifest revision/policy/rubric/design, existing sampling and sorted referenced
source snapshots. A missing source remains explicit null and fails the existing
unknown-source check. New valid source receipts cannot silently carry forward
a selection made against different source metadata under the same source ID.

The [attestation guide](wp03-case-selection-binding.md) specifies the exact
boundary. Cyclic annotation/adjudication/receipt refs remain outside selection,
with their separate verification unchanged. No legacy fallback or auto-signing
is permitted: old selections require accountable re-review and new authenticated
attestation. No real records need migration because the actual manifest is empty.
This is not whole-manifest signing, proof of truth or a freeze. WP03 remains
incomplete; real trust, permitted originals, humans and independent corpus
assembly remain missing.

## EX18 — Bounded forum software; qualification and lifecycle holds

**Status:** Software increment reviewed; full WP12 remains
in_progress. No actual installation, access or retention permission is established.

One versioned Discourse-shaped anonymous JSON subset is implemented. The frozen
scope binds installation/origin/version, category slug and ID, local time window,
caps, denominator and policy reference. The category route is exact
`/c/{slug}/{categoryId}/l/latest.json`; per-topic sources at `/t/{id}.json` derive
from a genuine retained listing, not caller-supplied topic lists or observed URLs.
Category and topic requests remain separately enrolled, qualified and budgeted.
The local window is a candidate filter, not an undocumented provider query.
[Official API documentation](https://docs.discourse.org/) and
[upstream route definitions](https://github.com/discourse/discourse/blob/main/config/routes.rb)
are reference evidence only. Normal richer responses may be unsupported; this
is not a universal forum parser or general native Discourse compatibility claim.

Because WP07 retains original response bytes, privacy checks reject the entire
response before successful preparation. Strict JSON rejects duplicate decoded
keys, malformed Unicode and lossy/unsupported numbers. Unknown/private fields,
restricted categories/messages, hidden/deleted content, contact-bearing values
and unsupported HTML cannot hide inside excluded records. Passive cooked HTML
checks raw, decoded and concatenated text/attributes; comments, hidden/active
markup, private URLs and unsupported Link headers fail. Failure reports contain
safe codes and counters, not offending bodies. These are explicit format checks,
not a universal sensitive-prose classifier or evidence of source permission.

Native topic/post/account IDs are installation-scoped. Accounts remain distinct
from people. Source instructions cannot change scope or authority. The scope's
policy must equal the actual enrolled source accessDecision used by capture; it
is not a new retention grant. Actual rights/permission controls remain separate.

Edits produce a new retained lead/version. Read-only removal proposals carry
requested reasons and revokeAuthorized=false, not verified deletion or authority.
Existing authorized ledger revocation invalidates affected claims and preserves
unrelated installation state. Automatic native-edit/deletion consumption into
current-claim invalidation remains unimplemented pending WP14/WP16 integration;
AC-WP12-06 is not fully met. No full package acceptance is granted by this increment.

## EX19 — Source-specific passive institutional HTML

**Status:** Software increment reviewed; full WP13 remains
in_progress until actual sources, access/rights and response profiles qualify.
No thresholds, shared runtime writes or native model changes.

A content-derived scope binds one reviewed endpoint/parameter grammar, source
family, semantic class-token mapping, record kind, source-date window, page caps
and denominator. Fields must come from actual unique matching nodes and literal
spans. This supports independent professionals, institutions/labs and associations
without an artifact prerequisite; it does not guess arbitrary HTML structures.

Only the explicit passive HTML subset can be retained. Whole-document preflight
rejects unsupported nodes/attributes, hidden/active content, comments, decoded or
split contacts, unsafe URL queries/fragments and unsupported HTTP Link metadata,
including outside selected records. The subset excludes stylesheets rather than
claiming to evaluate CSS visibility. Real profiles outside it require separately
reviewed format support and permission; arbitrary websites are not qualified.

Actual-unit county/role/date evidence is separate from headquarters, residence,
service area, publisher and adopter inputs. Current status remains an assessment
proposal; no employment or regional admission occurs. Source versions hash source
semantics, excluding extraction offsets and clock-dependent assessments. Native
card identity includes the complete canonical issued page endpoint, so document-
local HTML IDs on different pages do not merge. Source IDs are not person IDs.

Declared feeds/navigation are inert proposals unless already qualified. Fixed
queries are unsupported in this subset; only the registered numeric page query
may appear. Partial directories retain denominator gaps. Equal biography text or
an unresolved originReview ref cannot grant equivalence: distinct origin counts
use the existing reviewed evidence ledger. Real geographic truth and recall stay
future validation work. No full WP13 acceptance is granted by this increment.

The final institutional parser also rejects all HTML recovery diagnostics except
missing-doctype, plus non-HTML or public/system doctypes. A reproduced encoded
contact on a discarded closing-tag attribute could otherwise remain in raw bytes.
The permanent D1 regression rejects it before capture, while valid no-doctype
HTML remains supported. Earlier source/results are retained as superseded.

## EX20 — Signed labels bind the reviewed case/source context

**Status:** WP03 preparation correction reviewed; actual corpus
remains empty and not_frozen. Affects WP03/WP14/WP22/WP24. No schema, threshold or
reference truth is changed.

Independent genuine-signature tests showed that newly attested source/selection
context could reuse old signed annotations, blinding records and adjudication.
The correction binds all three v2 expectation wrappers to the digest of the exact
EX17 review context. Adjudication additionally binds the complete independent
annotation set, including signed annotation/blinding references. Changed evidence,
case meaning or disagreement basis therefore requires re-review and attestation.

The [label-context guide](wp03-label-context-binding.md) records the acyclic
signing dependencies and legacy rejection. Synthetic fixture hashing depth was
increased to construct that deeper graph; there is no runtime legacy fallback,
automatic signing or authority enrollment. Real independent humans, permitted
originals, source truth and accountable freeze remain absent.

The user confirmed continuing in dependency order after the WP03 corpus gate was
explained. [WP14 entry preparation](wp14-entry-plan.md) documents the concrete
existing authority/store gaps and planned interfaces/tests. It changes no route,
migration, rule or decision authority, and does not waive WP03.

## EX21 — Real source investigation and WP03 material staging

**Status:** Bounded manual ROR organization-evidence scope reviewed; automated
WP12/WP13 source qualification and full package acceptance remain ungranted.
WP03 remains in_progress and not_frozen; WP14 remains gated. No threshold,
reference manifest, model or production configuration changes.

The user explicitly requested real source qualification. This expands the earlier
local-only validation scope to anonymous public policy/access investigation and
source-specific permitted evidence capture. It grants no recurring collection,
production enrollment, paid/private access, provider outreach, human/trust
enrollment, editorial action or deployment. The
[qualification record](qualification/README.md) preserves the exact evidence and
separate rights/access/format outcomes; standalone HTTPS observations are not
WP06 registry/transport authority or authenticated WP03 permission statements.

Two fixed ROR API GETs returned exact CC0 Penn and CHOP organization JSON. Both
records passed independent native-byte/hash, field/URI and contact checks before
portable retention. They are staged as unannotated, development-exposed metadata,
with no actual-unit, county, person, creator or health-technology labels. ROR
metadata rights do not license linked pages. The related records share a publisher
and are not two independent reference cases or a recall roster.

OpenMRS robots/terms/basic-info probes returned 403; no discussion body was fetched
and native API/version qualification remains on hold. OHDSI/Slicer contribution
terms restrict commercial reuse, so general commercial redisplay remains excluded
absent compatible separate permission. Penn Medicine robots disallow query URLs,
conflicting with the existing mandatory page grammar; profile rights/format remain
unqualified. A code repository's license does not license its associated website.

Native ROR JSON and its fixed query-free endpoint cannot qualify WP13's paged HTML
contract. The exact Penn bytes already failed the preceding parser's URL checks.
Separate synthetic JSON/plain-text probes exposed a false healthy-empty outcome
under a declared zero roster. The minimal correction requires leading HTML markup
after UTF-8/BOM/whitespace handling and fails other formats before raw capture.
This does not implement JSON mapping or general MIME binding. Affected D1 tests,
exact-byte offline replay and independent adversarial checks passed with those
boundaries preserved.

WP03's strict manifest remains byte-identical with zero cases/reviewers. Authentic
evidence/permission statements, actual independent human review, family/partition
and sampling review, the required corpus and accountable freeze remain missing.
The subordinate staging index supplies none of that authority. E01–E06 remain
not_run; no source truth, full coverage or operational acceptance is claimed.

## EX22 — Repository/publication evidence and whole-payload metadata guards

**Status:** Bounded manual GitHub/Crossref metadata evidence and the local
raw-retention correction reviewed. WP03 remains incomplete and not_frozen;
no real source authority, automated publication join or deployment is granted.
No policy threshold, strict reference manifest, native model or production change.

The user requested real GitHub repositories and linked publications in the DVRPC
region. [QSIPrep and CaPTk dossiers](qualification/github-publication-qualification.md)
connect exact repository identities and commit-pinned citations to separately
identified papers and publication-time Philadelphia affiliation evidence. MRI
preprocessing and cancer-imaging software supply specific health-technology
purposes. GitHub organizations, human authors, creative roles, historical work
affiliation and present employment remain distinct. Outside/multiple affiliations
are preserved. A shared author name creates a possible cross-project family link;
two projects are not two established independent measurement units.

Two native GitHub repository JSON responses and two native provider-selected
Crossref bibliographic work lists passed independent whole-body/URI review before
portable retention. GitHub's first response was discarded after a capture-method
SSH false positive; the second was rate-limited. Two final fixed requests waited
until after the reported reset, with no credential/proxy or deliberate address
manipulation. A third selected Crossref request returned 429 without retry; its
missing contemporaneous receipt is retained as an explicit post hoc limitation.
Earlier unreceipted singleton metadata remains excluded from qualified portability.

The metadata rights decision covers this bounded factual research assessment.
QSIPrep's BSD license and CaPTk's component terms do not license article text,
contacts or linked websites. Crossref's provider-side factual-field selection
excludes abstracts before capture; it is not local projection masquerading as
native input. Article-specific full-text rights remain unqualified. All source
trust/enrollment and authenticated WP03 evidence/permission assertions remain absent.

Independent D1 probes also reproduced ignored contact bytes persisting through
GitHub/Crossref projections and a Crossref abstract retained under metadata-only
scope. A shared strict decoder/preflight now checks the complete original JSON,
including unknown fields and decoded key names, before any projection or capture.
It rejects duplicate keys, unsupported Unicode/numbers, demonstrated contact and
credential encodings, and nonempty Crossref abstract/full-text material. GitHub's
SSH exception requires an exact alias-bound value on a validated route-known
repository record. Known credential fields such as temp_clone_token permit null
absence but reject opaque nonnull values. Diagnostics contain fixed codes only.
These bounded rules do not establish universal privacy or interpret licenses.

The four native payloads pass offline checks and actual-D1 replay under synthetic
request authority. The GitHub baseline endpoint shape is supported; README/CITATION
parsing is not implemented. Crossref's actual DOI-filter/select request grammar
is outside WP10's qualified search/cursor contract, despite supported work-list
payloads. Neither replay enrolls a provider or supplies real WP06 transport authority.
Existing WP08/WP10 acceptance remains local software scope, with this correction
separately recorded; no new live-source acceptance is implied.

WP03 now stages six development-exposed native representations: two organization,
two repository and two publication records. It still has zero strict reference
cases/human reviewers. Independent labels/adjudication, trustworthy statements,
family/partition and independent sampling review, the required corpus and an
accountable freeze remain missing. WP14 remains gated; E01–E06 remain not_run.

## EX23 — Fixed DOI requests and additional real source material

**Status:** Local fixed-DOI request/parser/retention contract reviewed with exact
native request/response evidence. WP03 remains incomplete and not_frozen. No
threshold, strict reference manifest, native model, production source or deployment
change is made.

The user's follow-up requests closure of the Crossref request-qualification gap
and more real source material. [The fixed-DOI guide](crossref-fixed-doi-qualification.md)
defines the separate strict scope, original DOI literal versus canonical identity,
fixed factual fields, singleton denominator and absence of a date-window claim.
The adapter preserves the existing work/institution search and cursor contract.
No shared endpoint canonicalization is relaxed to fit an earlier capture.

EX22's selected bodies had been replayed under a different search request. The
new mode instead registers the exact canonical `/v1/works` DOI-filter/field-select
lookup and matches issued endpoint, original observation, retained request and
unchanged body. Prior observations retain their different query serialization.
Two fresh requests for the original works returned the same body bytes, but are
new acquisition observations rather than new independent works.

Fixed parsing requires the actual local collection claim bound by issued plan ID.
It rejects copied/unqualified scopes, wrong source/configuration/lease bindings,
noninitial chains, changed fields/rows, missing/wrong/extra results, cursors and
continuation metadata before capture. Fixed projection failures cannot become
healthy-empty success. A valid result has one requested DOI, one terminal page and
no continuation. Retained replay uses historical evidence rather than a settled
live transport lease. Existing whole-body material/privacy guards remain in force.

Six canonical Crossref requests and four new GitHub baseline requests succeeded
with bounded anonymous standalone HTTPS and pacing. Independent review preceded
portable copying. New dossiers cover AutoGVP, ImmunoTar, Phenomantics and DeepCNV,
with separately sourced Philadelphia affiliations, outside/multiple units and
clinical-use limits. Phenomantics' historical alias and directional publication
links are preserved. Article CC BY observations do not license repository code;
ImmunoTar's separate software terms restrict commercial redistribution.

The staging index now has 16 acquisition records and 14 distinct native body
hashes across six project dossiers. Shared authors, preprints, aliases and origin
families remain unreviewed. All material is development-exposed; no route quota,
reference label or independent denominator credit is added. The strict reference
manifest remains byte-identical with zero cases and zero human reviewers.

The accepted scope closes request compatibility for this fixed metadata mode.
Actual external source/trust enrollment, authenticated corpus statements,
independent blinded human review, sampling/family decisions and accountable
freeze remain separate gates. WP14 stays not_started; E01–E06 stay not_run.

## EX24 — Independent human-review workflow and blank source preparation

**Status:** Bounded local workflow implementation and independent engineering
review. WP03 remains incomplete and not_frozen; WP14's dependency is unmet.

The user requested an independent human-review workflow and preparation of the
existing corpus. The [operating procedure](human-review/operating-procedure.md),
[rubric](human-review/rubric.md), [private worksheet](human-review/worksheet.md)
and [CLI guide](human-review/tooling.md) allocate the accountable roles, conflicts,
blinding, rights, source/rubric access, external assignment ledger, preserved
returns and adjudication. No participant was recruited or enrolled, and no
policy, native label taxonomy, reference threshold or source permission changed.

The offline command separates blocked source preparation from authenticated
strict-context dispatch. A single recipient sees permitted original bytes and
neutral source/claim metadata, without machine verdicts, family conclusions,
peer annotations or adjudication. Dispatch checks exact EX17 context, original
digests, permitted uses and reviewer authority under the existing signed store.
Held-out and recall dispatch additionally check complete applicable structure,
all current family/selection records, sampling/assembly and exposure history.
Audit dispatch remains WP24. Preliminary annotation has no labels to satisfy
later outcome quotas; existing full native intake still enforces those quotas.

Unsigned returns emit detached expectations only. Signed return checks preserve
the existing EX20 context/annotation/blinding bindings and original return files.
Two-return handoff preserves both first reviews and disagreements and leaves
adjudication null; an already-integrated annotation set is refused so no third
review can disappear. Full-set adjudication remains the native accountable path.
Inputs are snapshotted before asynchronous verification to prevent later mutation
from replacing authenticated content. Private files are bounded, no-clobber and
locally checked, using the existing intake guards; fixed diagnostics omit content.

The actual preparation covers six project groups and two organization-background
groups, all 16 acquisition records and 14 body hashes. It leaves 16 reviewer slots
and 128 label cells blank, adds no strict reference case and explicitly forbids
dispatch. Grouping is source organization, not adjudicated family identity. The
source index, original representations and strict manifest remain unchanged.

Independent genuine-signature fixtures verify the local protocol; they do not
create actual authority or prove human truth, source rights or independence.
Native EX20 does not authenticate a new delivery round; same-context replay and
same-person aliases require the external ledger. The full rubric's revision-to-
content mapping and controlled source/rights access also remain accountable
external work. Complete fresh frames, actual independent annotations/adjudication,
authenticated statements and separate corpus freeze are still required. There
was no source request, external outreach, key enrollment, merge or deployment.

## EX25 — Orchestrator ownership and next delivery

**Status:** Execution priorities selected by the orchestrator under the user's
instruction to own the project and its decisions. This is a direction update;
no work package is accepted, dependency relaxed or implementation started by it.

The product outcome remains an evidence-backed answer to who is doing relevant
health-technology work in the nine-county DVRPC region, what they are doing,
why it qualifies, and how a reader finds and explores it. The next product
milestone is the [WP30 complete discovery journey](../discovery-engineering/work-packages/WP30.md),
including a creator without indexed work, a paper without code, supported
repository/publication links, unresolved joins and a correction. A collection
of independently passing adapters does not demonstrate that journey.

The orchestrator owns prioritization, technical tradeoffs, bounded assignments,
independent review and engineering acceptance. Existing Sol/Terra/Astra package
allocations remain in [ownership](ownership.md). Routine implementation decisions
are resolved within the authorized scope and recorded when consequential.

1. Resolve the dependency-audit failure through a separately reviewed dependency
   change. A fresh audit still reports four high, two moderate and one low
   affected-package entries; it proposes a major Zod update. Investigate and
   qualify the actual compatibility changes before adopting them. Retain the
   high-severity CI gate and actual audit findings. This work can proceed without
   the WP03 corpus, and it must preserve native validation, receipt and source
   contracts through the relevant regression checks.
2. Complete WP03's actual authority, source-use, independent-human and corpus
   prerequisites using the prepared workflow. Resolve applicable WP12/WP13
   implementation and source-qualification gaps in parallel. Preserve missing
   facts and development exposure; agents cannot supply independent human truth
   by assigning themselves reviewer identities.
3. Implement WP14 admission, then WP16 publication, followed by WP15 review and
   WP17 queries, WP18 reader journeys and WP30 integration when each recorded
   entry condition is met. Prefer the smallest complete useful journey before
   broad acquisition and feature expansion. Retain all six required source routes
   and the later whole-goal, operating and release obligations.

The reason for this order is to remove an independently tractable CI blocker,
preserve trustworthy evaluation, and focus the accepted architecture on a reader
outcome. Reconsider the sequence when dependency remediation exposes a material
compatibility problem, permitted human/source inputs change, or the first complete
journey reveals a contract mismatch. Adapt the affected packages with evidence;
do not change an obligation merely to match an incomplete implementation.

CI173 on `680deabf7a45ba36fb22d3f22deb66f0945b4987` finished with tests, PDF
regressions, build and local smoke passing, then dependency audit failing and its
later secret scan skipped. The earlier local secret scan passed. This direction
update changes documentation only; no new application test result is claimed.
The strict corpus remains empty and not_frozen. Deployment remains prohibited.

## EX26 — Dependency audit remediation

**Status:** Local dependency migration and independent engineering review passed; exact-head CI is recorded separately.

The user authorized resolving the CI dependency blocker with Sol/Terra implementation and Astra review. [The qualification guide](dependency-remediation.md) records the genuine Zod 4 migration, legacy string/default preservation, intentional unsafe-integer and required-value hardening, original signed-receipt compatibility, and independent router/XML and lock checks. Root retained the high-severity audit gate and pinned the direct patched dependency versions.

The full npm test chain passed 1401 executed tests; seven PDF regressions, build, local smoke, online audit and secret scan passed on 615 stable runtime inputs. The online audit changed from seven affected-package entries (four high) to zero reported vulnerabilities. All frozen handoff/model contracts and the empty not_frozen reference manifest remain unchanged. Actual source enrollment, independent human review, E01–E06 and deployment are still held. No work package changes acceptance by this dependency amendment.

## EX27 — Private forum-edit support invalidation and institutional source review

**Status:** Local removal-only increment qualified; WP12/WP13/WP03 remain in progress.

The user authorized advancing the reviewed plans with subagents. Sol implemented the exact-frame private edit consumer and dedicated invalidation capability, Terra investigated real institutional leads and independently tested D1 behavior, and Astra challenged source-frame, authority, history coverage and rollback. Root scoped the change, corrected migration metadata and ran full qualification. [The contract and evidence plan](wp12-edit-invalidation-plan.md) preserves all-old-copy coverage, stale-write suppression, bounded inventory, permitted historical content and existing admission/catalog bridges. Native deletion, unmapped qualification samples, cross-frame continuity, external operator revocation and WP14/WP16 public visibility remain held. No full AC-WP12-06 acceptance is claimed.

[Four institutional leads](qualification/institutional-expansion-20261116.md) remain unqualified for access, rights, query, privacy or format reasons. Policy research is not a native WP06 capture; no target page body was retained and no acquisition, case, reviewer or quota count changed. The source index and empty not_frozen corpus are unchanged. Native model and all 91 frozen handoff entries remain unchanged. There is no source enrollment, human enrollment, admission, remote migration or deployment.

## EX28 — Metadata-and-link pilot; separate richer reuse and benchmark validation

**Status:** User-authorized scope/dependency amendment; implementation and verification tracked in the separate MP00–MP04 ledger.

The user explicitly requested a metadata-and-link pilot, optional full-text reuse,
and benchmark review as a separate workstream. The [active pilot plan](metadata-link-pilot-plan.md)
supersedes the near-term delivery sequence for this finite intermediate product.
It uses existing retained factual metadata and supported outbound relationships,
under their recorded published API/license basis. Missing authenticated benchmark
permission statements, full-text redistribution grants and WP03 freeze are no
longer universal pilot-entry requirements. Source restrictions still apply to
the selected fields and intended use; this is not a blanket reuse grant.

The original automated admission/projection contracts retain their entry gates.
The pilot accepts no original work package, creates no benchmark labels or human
authority, and changes no empirical threshold. It renders a separate read-only
projection rather than admitting candidates through the private catalog bridge.
Historical source affiliations, organization-account owners and publication
authors remain distinct; current employment and work-creation location are not
inferred. Fourteen listings are neither fourteen independent projects nor proof
of regional coverage. Full-text and forum reuse can be added independently where
their actual terms and intended uses are established.

Terra owns source-field and use-basis selection, Sol owns deterministic offline
projection/query/API, the orchestrator owns UI/Worker integration and delivery,
and Astra independently challenges the amendment and implementation. Public
activation is disabled by default. No deployment, remote migration, production
collector, actual human enrollment or sealed corpus freeze is authorized here.

## EX29 — Repair discovery and mobile usability after Astra product review

**Status:** Product findings and repairs independently reviewed; fresh local
qualification passed on `2f013debf1e499e072830f7a820fe416db3b3cfc`. Delivered-head CI is tracked separately on PR30; deployment remains held.

The user asked Astra to review the pilot and take ownership of needed
improvements. The [product review](metadata-link-pilot-product-review.md) records
fresh task-based desktop/mobile evidence and six concrete gaps: missing known
citation matches, incomplete source-author search, omitted repository purpose,
mobile hierarchy, author/affiliation pairing and unclear evidence actions.
The orchestrator implemented the repairs; Astra independently challenged the
revised source projection, response boundary and actual reader journeys.

The v2 pilot adds complete retained Crossref author rosters and four short
source-reported GitHub descriptions. Search and local metadata navigation use
only the two existing citation observations, with explicit match context and no
transfer of authorship or geography to a related record. A reproduced citation
summary/result contradiction and the duplicate main landmark were also fixed.
There are still fourteen listings, fourteen retained bodies and two citation
edges. The 109 authorship entries are not distinct-person or regional-coverage
credit. Source acquisition, full-text reuse, the strict reference manifest and
human reviewer enrollment are unchanged.

MP01–MP03 were reopened for this amendment's field/query/UI changes and
requalification, then locally accepted against the new EX29 receipt; their
earlier local acceptances remain in history. MP04 public
activation is not authorized. Existing package, empirical and model evidence is
not rewritten to fit the repaired implementation. A new receipt binds final
source, tests and review; delivered-head CI is recorded separately on PR30.


## EX30 — Expand the finite pilot with four evidenced project pairs

**Status:** Source/projection, browser review and fresh local qualification passed
on `84bb755e48b9985707e8ccfa5b9241d11b93d8bc`. Delivered-head CI remains
separately tracked on PR30. Deployment remains held.

The user authorized real GitHub and linked-publication expansion with Sol/Terra
and Astra review, commits and PR updates. The selected batch adds ASLPrep,
GaNDLF, HistoReg and ModelArray using eight bounded native metadata captures and
four independently reread immutable repository citations. Terra's source
comparison and Astra's whole-body/source/behavior review precede local acceptance.

The existing v2 builder/API and direction semantics suffice. The orchestrator
integrated the source selection and catalog, removed obsolete two-citation copy
and formats HistoReg's deposited ampersands as plain display text; raw values stay
exact. Sol preserves the named fourteen-record baseline while checking the new
pairs and adverse source/relationship bindings. An inherited fourteen-record
routing expectation was corrected to twenty-two. No new source activation,
collector, D1 write, navigation promotion or production flag change is included.

Separate publisher observations establish historical author/Philadelphia
selection rationale where the native API supplies no affiliations. They do not
fill those arrays or transfer location to repositories. Current employment,
individual software contributions and clinical validity remain unestablished.
The pilot-only material index adds no WP03 case, human label or held-out credit.
Original package/model/benchmark evidence and earlier receipts remain unchanged.
MP01–MP03 were reopened for this amendment, then locally accepted against the
new receipt, preserving acceptance history; MP04 remains held. A new receipt records actual final results and source
commit; PR30 records final delivered-head CI separately.


## EX31 — Broaden county/institution discovery without inventing native geography

**Status:** Source/projection, browser and fresh full local qualification passed.
Delivered-head CI is tracked separately on PR30 before handoff completion.
Deployment remains held.

The user authorized expansion beyond Penn/Philadelphia with Sol/Terra and Astra
review, commits and PR updates. Select three pairs with Princeton/Mercer,
Rutgers–Camden/Camden and historical Rowan–Glassboro/Gloucester coauthor evidence.
Eight new anonymous captures succeeded; six are selected and two exact-preprint
THREAD leads remain research-only. County mapping, source access limits, personal
account ownership, an author-name correction and an archived collaboration are
separately documented. No institution-wide or postal shortcut locates authors.

All new native affiliations are empty, so a data-only expansion would not answer
institution/county searches. The v3 amendment adds explicitly separate regional
facts and native snapshot/author binding, distinct match explanations, related
publication support for repo-only results, and visible source/campus context.
It preserves all twenty-eight native record objects and their unknown county
fields. Original twenty-two records and historical evidence remain unchanged.

Review caught missing neighbor-only binding, weak county references, an
unsupported native-name rewrite, misleading publication-source wording and
full-phrase/hyphen query misses. Fixes precede acceptance; intermediate v2/static
and pre-fix browser evidence remain historical rather than restamped as final.
The [county record](metadata-link-pilot-counties.md) and new receipt retain actual
checks, scope and source commit. MP01–MP03 reopen for this increment, preserving
acceptance history. MP04 release, original 31-package/model/benchmark gates,
source enrollment and deployment authority are unaffected.

## EX32 — Internal-first public go-live with broad, lean discovery

**Status:** User-selected product direction; detailed adaptive plan only. No
implementation or operational acceptance is supplied by this decision.

The user requested an end-to-end plan addressing the seven launch priorities,
with subagents able to adapt to findings. They explicitly removed the need for a
public pilot phase and emphasized internal use with public availability. Broad
coverage, including repositories outside prominent journals/news, is central.
Useful factual fields, links and affiliations suffice; complete biographies,
exhaustive research dossiers and linked papers are not prerequisites.

The [new plan](go-live/README.md) and [GL00–GL11 register](go-live/plan.json)
define lean source-backed admission, independent discovery routes, quiet/personal/
paperless repository discovery, ordinary search, home/results/detail journeys,
maintenance, scoped breadth checks and direct release readiness. Bounded batches,
miss investigation, explicit gap states and independent review govern adaptation.
A PR-reviewed snapshot can be the initial release mechanism; it does not accept
the unfinished general authenticated admission/publication system.

The prior MP ledger, original 31-package acceptance, native model/contracts,
benchmark manifest, full-system E01–E06 thresholds and historical evidence remain
unchanged. Full-text reuse and independent benchmark review are separate. Scoped
launch does not require universal six-route completion, complete current-person
verification or the original 360-case benchmark. These full-system obligations
remain unearned and cannot be advertised as completed.

The public product is The Valley Desk's health-tech discovery service, without
pilot branding. Existing internal names/APIs can retain a compatibility period;
there is no reason to rename every internal module before useful delivery.
GL11 prepares a concrete candidate, source/coverage scope, operations and rollback
before any missing release authorization is requested. This task changes plans
and navigation to those plans only; application behavior, enrollment, recurring
collection, merge and deployment remain unchanged.
