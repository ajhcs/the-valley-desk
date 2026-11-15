# WP07 implementation handoff — Sol

Candidate for independent review and orchestrator disposition. This package adds
private local collection persistence and scheduling contracts. It does not qualify
real providers, credentials, permissions, egress, publication or deployment. Sol
does not accept this package. The frozen engineering handoff remains unchanged.

## Round and inventory policy

An authenticated caller selects at most 128 currently active enrolled sources.
The store freezes their actual revisions, reviewed query parameters, configuration
and material scope in binary source-ID order for one round. Empty selection means
zero round slots; it does not establish complete regional inventory. New sources
may enter a later explicitly authorized round.

An inventory cohort is separate from a round. The cohort fixes policy version,
maximum pages, continuation lifetime, one attempt per slot and zero automatic
retries. Each source's query/window/configuration binding within that cohort is
immutable. Later rounds may add another selected source to the cohort, but cannot
silently change an existing binding or extend its caps. Expired continuations and
incomplete chains require an explicitly new cohort. The collector never creates
rounds or retries locally on its own.

Each slot admits one page attempt, then advances to the next source. Blocked,
failed, timed-out and revoked slots have durable typed outcomes. A still-live
claimed slot returns busy; a source busy in another round records a bounded skip.
An abandoned expired claim is finalized as timed-out/uncertain and advances the
cursor, rather than obtaining another attempt in the same slot. A later authorized
round can retry the unchanged committed checkpoint. Conditional fairness means
continued dispatch over the finite frozen membership gives each slot a turn; it
does not guarantee upstream delivery or availability.

## Actual fences and atomic capture

Migration 0044 requires one actual WP06 source lease per source. Existing duplicate
leases make the migration fail transactionally; it never merges or chooses an
owner. Claiming a slot creates its collection claim and updates that actual source
lease in the same D1 batch. The owner, exact fence and expiry are linked to the
claim. Another round using the same owner string cannot steal a live claim.
Stop, expiry recovery and scoped revocation invalidate the exact linked fence.

The new BEFORE INSERT dispatch guard runs inside WP06's actual attempt reservation
batch. It requires the active round/cursor, current slot/claim and its exact bound
issued plan, source lease and processing deadline. A plan orphaned between the
registry issuance transaction and the collection binding transaction cannot fetch;
concurrent issuers cannot turn the losing plan into another request. Request and
uncertain reservations remain charged under the existing WP06 policy.

The collection factory constructs its registry and evidence store on the same
database. Issued-request and provisional-origin anchors may be prepared separately;
they contain no response body, normalized observations or checkpoint success.
The final capture uses the existing WP05 composition hook and WP06 guard to commit
the raw representation, actual byte settlement, normalized private observations,
private page receipt, full seen-token history, contiguous checkpoint, item settlement,
slot outcome, cursor and health timestamps in one D1 batch. Empty pages use the
same commit path. A failed final statement rolls the whole batch back.

Committed normalized items settle the unused portion of the actual attempt's
`max_items` reservation once. Raw bytes settle from the attempt ceiling to the
retained body length. Failed/uncertain attempts retain their conservative prior
reservations. Received network chunks can exceed the retained-byte ceiling before
cancellation; no wire-traffic bound is claimed.

## Parser and private observation boundary

`collection-contract.ts` defines a new provisional parser input/draft and
`DiscoveryCollectionPageReceipt`. These are structurally separate from accepted
`DiscoverySourcePage` and `DiscoverySourceObservation`; no catalog subjects or
evidence references are invented. WP14 owns later selector evidence, identity and
original-work adjudication. Every normalized observation carries the real issued
request, request/parser/hash and representation references. Its private candidate
key reuses the provider identity hash without inserting any catalog row.

Native identity, stage, version, optional artifact subtype and at most eight named
source dates remain distinct. Dates use the accepted precision/domain schema;
an explicit empty sourceDates array records no reported dates. Collection time
never substitutes for a source date. Same native identity with distinct stages or
versions can produce separate observations. Publication authority is always false.
Trusted parsers explicitly select JSON or text representation format, so XML/HTML
can retain their exact UTF-8 response using the existing text normalizer.

The store injects and captures its trusted parser dependency. `preparePage` copies
the acquired bytes/request before awaits, checks the actual received attempt and
its item allowance, and performs read-only eligibility checks around parsing.
The parser receives a separate copy; its output is strictly validated and bounded
to 256 KiB. It returns an opaque, expiring, store-local prepared handle, not a
caller-writable normalization authority. At most 128 handles are retained.
`commitPage` consumes that handle plus the separately supplied one-time issued
token. Tokens and prepared drafts never enter permanent operation audit.

The prepared deadline is anchored before asynchronous work to both wall and
monotonic time. Parser work cannot restart the clock, and late parser results do
not create a handle or commit. Synchronous JavaScript parser CPU is not preempted;
production parser and capacity qualification remain separate work.

## Progress, replay and removal

Only a contiguous chain under the exact cohort/source/query/window/configuration
can become complete. The full seen-token set includes the initial request token
and each accepted continuation. Repeated tokens, missing terminal state, rejected
rows, truncation, provider limitation and a nonterminal page cap permanently leave
that chain incomplete. A terminal page at the cap may complete a valid chain.

Continuation resolves only from the actual private durable receipt and current
retained representation. The issued deadline is no later than the source wall-time
cap, collection processing deadline, linked source lease and parent token expiry;
the collection transaction rechecks the expected chain and expiry. Receipt reads
validate strict relations, canonical hashes, scalar bindings, normalized row counts
and hashes, and WP05 representation integrity/usability. Malformed or removed
payloads return no usable receipt, while minimal operation metadata remains.

An already-complete skip requires current source/control/qualification and retained
receipt checks. Its transaction repeats source generation, active qualification,
current permission/rights and recursive receipt ancestry checks. A disabled source
or unusable receipt produces a gap, not current complete coverage. Historical
lastAttempted, lastSuccessful and lastComplete instants are separate; failures
preserve last-good history. lastPublicRefresh stays null. A historical timestamp
alone cannot qualify another configuration or prove current coverage.

Operation audit retains IDs, hashes, result references and verified authority only.
Replay resolves current erasable page data; conflicting prepared content is denied.
Loss of the one-time issuance token or an uncertain dispatched request cannot cause
a free refetch. The caller reconciles the durable operation or waits for fenced
expiry recovery, then uses a later explicitly authorized round.

Every copied source-bearing binding, page, lead, chain, token and claim checkpoint
owns its exact scope hash. The revocation trigger does not depend on registry rows
surviving another trigger's execution order. It erases scoped payloads and invalidates
the linked lease, while preserving minimal ordered membership so a revoked slot
can still be skipped without reconstructing removed content. Unrelated source
revisions and scopes remain separate. This is logical current-D1 removal, not
physical memory erasure, backup reconciliation or resistance to coherent unrestricted
database rewriting.

## Validation and retained failures

The final independent collection suite passed **33/33**, with zero failures,
skips or cancellations, in approximately 191 seconds. Its 16 monitored inputs
matched before/after execution. The TAP log is
`.discovery-work/wp07-tests-sol/run-4-frozen.log`; structured actual-D1 results are
`.discovery-work/wp07-tests-sol/runs/2026-11-14T03-41-13-061Z-3399727/local-d1-results.json`.
Astra separately reports **21/21** adversarial checks passed with stable inputs.
Those are independent findings, not owner acceptance.

The owner app TypeScript check passes under workspace Node 22.23.2 with sanitized
environment; its log is `.discovery-work/wp07-sol/typecheck-candidate.log`.
The relevant commands are `node node_modules/typescript/bin/tsc --project
tsconfig.app.json --noEmit` and `node --import tsx/esm --test
--test-concurrency=1 test/discovery-collection.test.ts`. The Node prefix is
`/workspace/build/builderbob/runtimes/node-v22.23.2-linux-x64/bin`; scratch, config
and cache locations stay on `/workspace`. Tests and probes use isolated local D1,
migrations 0001–0044, no secret environment files and closed synthetic egress.
No installed service, live editorial data or remote D1 was changed.

Frozen implementation and independent test hashes:

| File | SHA-256 |
| --- | --- |
| src/ingest/discovery/collection-contract.ts | `9fb85d794584a99724ff02db4fbe63713411b2cd66bbd79ea0e827b9832e0ba0` |
| src/ingest/discovery/collection-store.ts | `f800b375f5e86e1f4764c8bb2bc9de69fff33cc419f2e77443e0fa115e720084` |
| migrations/0044_discovery_collection.sql | `94c84e6421620087b92919ee8550949d22922f4b679138257d1a2f96ee1f83fd` |
| src/ingest/discovery/collector.ts (Terra) | `abfcf200a6dcbbb0f562efb40ecf6b05a529091f2bf590b5c69c5202f448bb6f` |
| test/discovery-collection.test.ts (independent Sol) | `374c343130becc7d94cafd1b62c16c6a3c8c1e27bed817eb43b76bbfd213e26a` |

Preserved diagnostic failures include stale busy-skip overwriting a fresh claim,
orphan plan admission, expired-slot redispatch, mutable receipt completeness,
complete-coverage preflight racing disable, parser lifetime resetting after work,
and a default collector deadline exceeding the source's shorter wall-time cap.
Owner/test-author/Astra logs retain their actual failed candidate versions.
The short-TTL loop diagnostic was resolved as fixture timing: its one-second
continuation expired while a noncancellable commit remained in flight. The collector
returned uncertain and the commit completed later; disposing that diagnostic D1
session produced a generic error in the earlier trace. The loop fixture now uses
a 60-second lifetime to observe the repeated-token behavior; separate short-expiry
and uncertain-commit checks remain. Timeline evidence is retained under the test
author's scratch directory and owner diagnostic copies under
`.discovery-work/wp07-sol/`. No earlier passing run is relabeled as final evidence.
Root owns full npm/build/smoke/secret-scan qualification and package acceptance.
