# Architecture and shared contracts

Status: planning decisions for implementation; no application or target-model
change has been made. WP02 reconciles these decisions with the frozen v0.4 model
and records the new model revision before dependent implementation begins.

## Mission and boundaries

Help people discover useful regional health-technology work and its creators,
understand the evidence, and take a supported next step. The system contains
enrollment, acquisition, observations, claims, decisions, public projections,
search, reader views, corrections, and operations. Source authors, source access
policies, authentic external facts, reader outcomes, and clinical effectiveness
are external to the software's guarantees.

The nine county keys are `PA:Bucks`, `PA:Chester`, `PA:Delaware`, `PA:Montgomery`,
`PA:Philadelphia`, `NJ:Burlington`, `NJ:Camden`, `NJ:Gloucester`, and `NJ:Mercer`.
Use these exact keys rather than a legacy regional flag. The public catalog
covers healthcare technology, informatics and health AI with evidenced technical
development, application, evaluation or explanation. Generic AI, routine clinical
content, incidental computer use and local adoption alone are insufficient.

## Decisions to carry into WP02

| ID | Selected planning decision | Reconsideration trigger |
| --- | --- | --- |
| D01 | Add discovery to the existing React/Vite/TypeScript Worker and D1 application. Preserve old feed and Watch envelopes. | A measured platform constraint prevents a required contract within the approved operating budget. |
| D02 | Separate creators, accounts, work, observations, claims, decisions and public revisions. Use discovery-owned tables where Watch enums or foreign keys do not fit. | A verified existing structure already satisfies the same types, authority and temporal guarantees. |
| D03 | Support six independent acquisition routes. GitHub, PubMed, Crossref, arXiv, an enrolled public forum and institutional/association discovery are required for full scope. | A route proves unavailable: record a scope decision; do not silently declare full completion. |
| D04 | A creator needs no indexed artifact; a paper or discussion needs no repository or project. | Only a deliberate product-scope change, with evidence and explicit acceptance. |
| D05 | Current professional presence and local-at-creation work are distinct relations. People default to current verified presence; historical profiles remain discoverable in the historical mode. | Reader evidence shows misunderstood semantics; preserve both underlying distinctions when revising labels/defaults. |
| D06 | Work defaults to evidenced regional contribution at the relevant creation/contribution time. A now-local person's older nonlocal work may appear as contextual history, clearly excluded from regional-work results/counts. | An explicit second discovery mode is justified and separately tested. |
| D07 | Qualified deterministic rules or authenticated accountable review authorize claims. Model output is a proposal. Engineering-agent signoff is not editorial authority. | Never relax authority solely to improve throughput. |
| D08 | Publish immutable revisions with complete dependency vectors and atomic guards. Public data is allowlisted. | An alternative demonstrates equivalent transaction and visibility guarantees. |
| D09 | Normalize literal query terms and governed aliases; OR within facets, AND between facets. Initial ranking uses distinct matching terms and supported dates, without opaque similarity scores. | Held-out retrieval and reader evidence demonstrate a better rule; revise the contract and comparator checks before adoption. |
| D10 | Snapshot pagination binds query, sort, generation, as-of, invalidation epoch and expiry. Material invalidation requires a restart. | A more selective invalidation design demonstrates equivalent correctness and an operating benefit. |
| D11 | Initially use primary D1 reads and no public discovery response caching. Cache upstream representations separately. | Measured latency/cost warrants caching or replicas, with current-claim invalidation qualified across every path. |
| D12 | Use durable bounded scheduling with fixed eligible cohorts per round, transactional reservations and fenced progress. | Measured scale requires another dispatch mechanism preserving these obligations. |
| D13 | Basic discovery stays free. Rank and admit by evidence; defer billing and paid monitoring until actual demand and sustainable delivery are demonstrated. | A documented funding experiment meets independence and fully loaded cost criteria. |
| D14 | Preserve legacy routes and consumers during additive rollout. Retirement is a separate conditional package. | Consumer inventory, replacement evidence and scoped cutover are complete. |
| D15 | Keep patents, general crawling, reader accounts, social features, vector search and mobile apps deferred. | A specific observed need, maintenance owner, budget and evidence plan justify one extension. |
| D16 | Rotate a recovery incarnation outside the restored D1 state after restoration; reject all older cursors and keep public discovery closed until post-backup corrections/removals are reconciled. | A recovery design demonstrates equivalent non-resurrection and continuation invalidation guarantees. |

## Required model refinements

The [frozen model](baseline/tvd-concept-v0.4/model/tvd-discovery.sysml) retains
`ReviewDecision.candidate : Work`, `LicenseAssessment.repository : Repository`,
and snapshot references without explicit public-row revisions. These are known
mapping gaps, not proof that the implemented system already handles those cases.
WP02 must define creator/work/relationship decision targets, rights for every
artifact/version/material scope, immutable projection row identities and complete
dependency manifests. Extend native review/publish functions for creator admission.

Add explicit valid-snapshot and restart outcomes to P20/P21 correspondence. A
partition guarantee applies only while a snapshot is valid; it cannot coexist
with silently deleting members as their claims are revoked. Add people and
organization ordering cases, concrete revision/ABA cases, effective-time regional
semantics, and field-level removal/withdrawal cases to the refinement scope.

## Logical allocation and proposed storage

| Module | Responsibility | Proposed storage families |
| --- | --- | --- |
| Registry and transport | Qualified source scope, endpoint constructors, access, budgets | enrollments, access qualifications, runs, reservations |
| Collection | Bounded pages, durable capture, provenance and checkpoints | observations, representations, page receipts, cohorts, leases |
| Catalog | Identity and temporal relationships, work/version families | creators, accounts, source identities, works, aliases, relationships |
| Claims and review | Evidence links, ambiguity, conflicts and decisions | claims, evidence references, decisions, current heads, review queue |
| Public delivery | Guarded public revisions, change generation and invalidation | public revisions, dependency vectors, generations, invalidation state |
| Query | Admitted tokens/facets and versioned search sets | public revision tokens/facets, snapshot descriptors, cursors |
| Operations | Source health, coverage, correction and recovery | source checks, coverage receipts, corrections, operation receipts |

These are logical table families, not a migration already written. WP04 chooses
exact names and keys in a reviewed schema. Use composite typed keys or separate
tables so an account cannot become an author-person through a plain untyped FK.
Index identity tuples, claim heads, evidence dependencies, due sources, accepted
public revisions, and supported query facets. Do not create a graph database or
ORM merely to represent relationships.

Keep source-native IDs, cross-provider equivalence and continuing project identity
separate. A repository transfer retains its native identity; a fork has its own.
An arXiv base ID and versions are separate from a journal DOI. Publication copies
from the same underlying deposit do not become independent corroboration.

## Interface contracts

WP02 owns definitions; downstream owners consume the same version. Every exchange
needs a schema version, durable identity, payload bound, idempotency semantics,
permitted caller, typed error, acknowledgment and retry rule. The fields below
are required semantics, with exact TypeScript names finalized by WP02.

| ID | Producer → consumer | Required content and behavior |
| --- | --- | --- |
| IF01 | Registry → transport | Source/provider/installation/scope, qualified access revision, endpoint constructor and allowed parameters, parser revision, checkpoint and budget reservation. Unqualified or changed scope cannot fetch under an old receipt. |
| IF02 | Transport/collector → evidence store | Provider object ID, representation digest, permitted bytes or normalized content, fetched time, source date/precision, source-origin ID, response/page receipt and completeness. Commit receipt precedes checkpoint advancement. |
| IF03 | Evidence → candidate claims | Typed subject/predicate/value, supported span or structured field, evidence revision, parser/model revision when used, conflicting alternatives and unresolved fields. No authority flag derived from source text. |
| IF04 | Review/rule → decision store | Typed target, authenticated authority or qualified rule revision, expected claim/evidence/policy heads, result and reason, operation key. Duplicate operation returns its prior outcome. |
| IF05 | Decision store → public projection | Complete dependency vector, admitted allowlisted values, subject and immutable public revision, expiry semantics. The commit validates all heads and authority atomically. |
| IF06 | Query → search/read delivery | Canonical query, sort, publication generation, eligibility-as-of time, invalidation epoch, external recovery incarnation, expiry, page size and keyset position bound to immutable row revisions. Invalid continuation produces a typed restart. |
| IF07 | Correction/expiry → invalidation | Affected claims and dependencies, materiality, authority, retained reason and expected heads. Publication update and invalidation state change are atomic. |
| IF08 | Operator client → protected API | Verified authentication context, action-specific authorization, same-origin mutation checks, bounded body, expected revision and idempotency key. Reviewer identity is never trusted from body fields. |
| IF09 | Public DTO → React/Worker/crawler | Identical admitted meaning, stable canonical identity, supported source and regional dates, statuses, evidence links and next actions. Candidate-only fields cannot cross this boundary. |
| IF10 | Acquisition/review/delivery → coverage/ops | Run, scope, cohort, time window, outcome and applicable identities. Counts for captured/admitted/published stages use the same denominator and distinguish partial or failed collection. |

## Temporal, relevance and rights rules

Represent year/month/day/instant/unknown dates with their original precision and
supported half-open interval. For a positive date filter, the whole interval must
fit; unknown dates do not satisfy the filter. With no date filter, unknown records
remain eligible. Keep source-event, first-observed, checked, reviewed and expiry
times separate. An unknown relationship end is not positive current evidence.

Work admission requires supported identity, healthcare purpose, technical
contribution, an applicable regional creator role, publication authority and
valid dependencies. A local contributor to an otherwise nonlocal project can
qualify the documented contribution; stars, membership and adoption cannot. A
qualified organization-authored artifact can remain visible with unresolved
optional individual authors. Independent professional profiles can rely on
reviewed public professional evidence without an employment or residence claim.

Rights assessments apply to a particular artifact version and material scope.
Code, data, weights, text, figures and forum content may differ. Display supported
terms and unknowns; do not infer reuse rights from public access. Permission to
fetch, retain, transform and display are separate source-qualification fields.

## Atomicity, retries and visibility

Use immutable revisions or monotonic version identities for every guarded head;
values that change A→B→A must still have a different revision. A publication batch
must reject the entire write if authority, expected revision, dependency heads,
relationship endpoints or relevant policy changed. A zero-row conditional update
does not inherently abort subsequent SQL: implement and fault-test a real abort
guard. Store a durable operation result so timeout/retry resolves the earlier
commit rather than duplicating it. Fence leases and budget reservations in the
actual committing transaction.

A read is valid at its defined coherent database observation point. This does
not recall material already downloaded by a reader. Revalidate client navigation
and define a withdrawal notice where appropriate. A source failure retains
permitted prior evidence but does not renew a current claim. Discovery failure
may return unavailable; a stale bundled record cannot masquerade as a current
discovery fallback.

Cloudflare documents transactional [D1 batches](https://developers.cloudflare.com/d1/worker-api/d1-database/)
and session [sequential consistency](https://developers.cloudflare.com/d1/best-practices/read-replication/).
Neither eliminates the application's responsibility for atomic guards and frozen
application-level snapshots. Revalidate current documentation during WP00/WP02.

## Search defaults to freeze in WP02

For nonempty literal searches, admit records matching at least one normalized
query term, then rank by distinct matched terms descending. In relevance mode,
follow with known-source-date first, supported date lower bound descending, and
binary stable ID. Recent mode omits the term-count coordinate. Duplicate terms
cannot increase score. Govern aliases explicitly; no hidden keyword expansion.
People/organization empty queries use normalized display name then stable ID;
nonempty creator queries use match count followed by that stable name order.

OR applies within each facet and AND between facets. Work regional-at-creation
and creator-current-presence filters must expose their different meanings. Facet
counts and total counts use the same snapshot and eligibility rules as items.
No positive unknown fact may be manufactured to satisfy a filter.

Initial limits proposed for qualification: 25 items/page, maximum 100; 200 input
query characters; at most 12 distinct normalized terms; at most 20 selected values
per facet; cursor lifetime at most 15 minutes and no later than relevant dependency
expiry. Reject over-limit input; never truncate silently. These are starting
engineering limits, not measured capacity or externally mandated values. WP02
freezes them before tests, and WP17 measures actual SQL/bound-parameter/byte cost.

Use immutable public revisions and a versioned generation view for snapshot
membership. Persist a descriptor containing the actual canonical query, sort,
generation, epoch, as-of, expiry and page contract. An opaque server cursor refers
to that descriptor and the full last sort tuple; do not trust caller-edited
positions. Keep necessary old revisions until all valid snapshots expire.

Bind descriptors to the current recovery incarnation as well. Store that value
outside the database state being restored, for example a separately managed
Worker configuration value. An isolated rehearsal uses its own value. Restoring
an old database can restore a matching old epoch and old revoked records, so
rotating an epoch inside that database is insufficient by itself. Rotate the
external incarnation, invalidate all earlier cursors, and keep public discovery
disabled until post-backup withdrawals/removals are reconciled from separately
retained evidence or affected restored claims are requalified. If reconciliation
cannot be established, retain the hold; do not infer current truth from restored
matching heads. WP26 tests this case and WP27 applies the qualified procedure.

New additions need not invalidate existing snapshots. Initially use a conservative
catalog-wide invalidation epoch for material public correction, withdrawal,
identity change or relevant policy change. Bound snapshot expiry by the earliest
relevant dependency expiry. An invalidated continuation returns HTTP 410 with
`discovery-snapshot-invalidated` or `discovery-snapshot-expired`; a query/cursor
mismatch returns 400. The UI offers restart with the original filters. Never
silently omit members of an ostensibly unchanged snapshot.

WP17/WP20 measure restart frequency and usable snapshot lifetime under realistic
correction and expiry cadence. Frequent correctness-preserving restarts can still
make search unusable. Change invalidation granularity only with equivalent
correctness evidence and a reviewed revision, not by ignoring an expiry.

## Evidence and open operating inputs

The implementation needs actual source enrollments/access, spending and operator
hour limits, a named editor and backup, a permitted reader-pilot recruitment
route, deployment bindings/runbooks, and a verified recovery destination. These
are inputs to WP01, WP06, WP24–WP27, not facts supplied by a model. Work independent
of a missing input can continue with isolated fixtures; dependent operational
actions remain unexecuted until that input and its scope are established.

Every material decision change must update the affected native model/contracts,
requirement and package mappings, and evidence status. See [execution](EXECUTION.md)
and [evidence](EVIDENCE.md). A changed implementation cannot retroactively turn the
historical v0.4 receipt into verification of the new behavior.
