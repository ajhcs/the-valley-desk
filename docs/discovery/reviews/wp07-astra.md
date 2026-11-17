# WP07 independent review — Astra

2026-11-14. Final independent review: recommend local synthetic qualification,
subject to root integration gates and acceptance. No blocking finding remains in
the reviewed candidate. Root retains acceptance. This review owns
only this document and `.discovery-work/wp07-astra/`. The selected checkout is
`tvd-discovery-implementation-20261113`; there are no provider calls, actual
scheduling, production mutations, deployment or commits in scope.

The accepted WP06 implementation inputs match its original receipt; the check is
retained in `accepted-entry-inputs.json`. Original WP05/WP06 receipts and accepted
snapshots remain historical boundaries. Any necessary accepted-seam amendment
requires root adjudication and requalification.

## Protocol invariants and early challenges

1. **Draft parsing is not retained evidence.** The accepted WP06 adapter requires
   trusted retained input, which is circular for a new atomic raw/page commit.
   Root approved a new WP07 provisional parser contract without changing that
   accepted adapter. Draft parsing receives detached bytes/request/parser values,
   grants no durable authority, and cannot advance progress. The eventual batch
   must bind the exact draft digest/length and request to the real received
   attempt and its item allowance. Retain-then-parse-then-ack is insufficient.
2. **Every page fact commits together.** Raw representation, normalized records,
   receipt, contiguous checkpoint, health success and reservation settlement must
   be in one actual D1 batch under current source controls and collection lease.
   Issued/provisional-origin anchors may be prepared earlier only without body or
   progress. A late failing statement must roll back all new page facts. Replay
   returns the original durable outcome; conflicting content under an operation
   identity fails; neither path repeats external acquisition or settlement.
3. **Collection and source lease fencing must agree.** WP06 admission guards its
   real source lease, not a new collection slot lease. Takeover must atomically
   advance the linked source fence, with expiry no later than the slot lease, or
   put an equivalent collection guard in the admission transaction. A preflight
   slot check followed by dispatch is not sufficient. Separate slot claim and
   source-lease acquisition can let a losing worker reacquire the source lease.
4. **A frozen cohort is durable and bounded.** Persist the eligible membership,
   source/scope/configuration/query/window bindings, deterministic order and
   cursor. Each source receives one bounded page attempt per slot; continuation
   belongs to a later round. Newly enrolled sources enter a later round; existing
   inventory-cohort source bindings remain fixed.
   Failure, blocked readiness, revocation and timeout cannot hold a current slot
   indefinitely. Continued dispatch over a finite fixed cohort promises slots,
   not upstream success, population coverage or complete inventory.
5. **Recovery observes durable state.** A timed-out storage promise may commit
   later. Success commit and failure finalization must contend on the same slot
   state/fence/cursor; at most one can win. If storage never answers, return an
   uncertain result and reconcile under a later lease rather than inventing a
   committed failure. Lost one-time issue tokens require fresh authorization and
   charging; an uncertain earlier request is never refunded or replayed for free.
6. **Page chains do not manufacture completeness.** Empty nonterminal pages,
   missing terminal pages, repeated tokens/page identities, rejected records,
   truncation and changed query/window/configuration cannot establish completed
   inventory. Token expiry creates an explicitly new bounded cohort. Separate
   last-attempted, last-successful, last-complete and last-public-refresh values;
   failure/disablement preserves prior evidence and records an explicit gap.
7. **Observations and evidence must be real.** WP06 candidate leads are not the
   accepted `DiscoverySourceObservation` shape. That shape requires subject/native
   identity, dates, provenance and actual evidence references. The implementation
   must create those anchors atomically or use an explicitly adjudicated private
   draft/lead receipt; it must not pass a representation ID as an evidence ID,
   invent evidence references, or label an incompatible shape `SourcePage`.
8. **New copies need removal ownership.** Every token, normalized record, sample,
   endpoint, page/checkpoint payload and receipt copy needs the exact material
   scope hash on its own row, so revocation does not depend on trigger order or
   source rows already deleted by WP06. Only explicitly permitted minimal audit
   metadata may remain. Replays and recovered old state cannot restore removed
   material. Logical current-D1 deletion is not backup erasure.
9. **Deadlines cover the whole step.** Bound parser, storage, replay lookup and
   cancellation as well as transport. Snapshot mutable parser inputs before an
   await and ignore late output. A Promise.race alone does not cancel pending
   database work; persisted fencing/deadlines and reconciliation must handle it.

## Planned independent evidence

Read actual SQL and implementation, then run all six WP07 ACs and distinct local
D1 race/crash probes with synthetic clocks/egress/capability resolvers. Preserve
failed and superseded attempts, exact input hashes and whole-batch before/after
observations. In particular challenge crash-after-commit/lost acknowledgment,
repeated first-source failure, takeover between parsing and write, empty/missing/
looping page chains, concurrent budget exhaustion and uncertain dispatch, and
mid-run source disablement. Fixtures are bounded implementation evidence, not
provider permission, authenticated human judgment, source truth or release proof.

## Design adjudications during review

Root selected a new strict private normalized-lead schema and
`DiscoveryCollectionPageReceipt`, distinct from `DiscoverySourcePage`. This
satisfies private intake normalization without fabricated catalog/evidence IDs;
WP14 remains responsible for materialization and selector adjudication. Tests
must reject interchange with the shared SourcePage schema.

Root also selected a factory-owned trusted parser and opaque prepared-page
handles. Matching byte hashes alone could not authenticate a caller-supplied
normalization draft. The handle must privately bind the detached acquisition,
validated parser output, claim/fence and actual reserved allowance. Forged,
cross-factory, mutated, reused and conflicting-operation handles are adversarial
targets. A durable committed receipt can be resolved without a lost local handle;
uncommitted lost state does not authorize a free replacement acquisition.

The initial migration adds global uniqueness of the registry lease's source ID.
This changes WP06 runtime semantics under migration 0044 even though accepted
source files remain unchanged. Existing duplicate leases must fail migration
explicitly, and active bootstrap leases cannot be stolen because their owner
string matches. Root is preparing compatibility execution of the accepted WP06
suite under migrations 0001–0044.

The collector's outer deadline must guard the actual egress send, not just waiting
for an inner transport whose monotonic clock starts later. Root identified that
nested-deadline issue; Terra added a send wrapper without changing accepted WP06
transport. Actual D1 delayed-admission/frozen-clock checks remain pending.

A dependent-contract review found that strict leads without source dates or stage
would block WP08 release/tag/commit distinctions, WP09 partial-date precision,
WP10 online/print/update dates and WP11 preprint submission/update semantics. The
recommendation is a small typed stage/artifact-kind and bounded named-source-date
extension using existing DiscoveryDate, with no ingestion-date substitution or
generic metadata bag. Stage/version distinction must participate in observation
deduplication without inventing a new canonical native candidate identity.

## Actual D1 diagnostic challenges (not final qualification)

`probes-v1` reproduced a false durable acknowledgment after changing only a
stored page payload's `chainComplete` from false to true. The returned value was
`committed:true`, `chainComplete:true`, `terminal:false` with a continuation token.
The assertion failed; the run and input hashes are retained. `probes-v2` retained
that failure while passing forged/cross-factory/reused handle rejection,
authorized historical replay, existing binding/policy drift denial, expired
uncertain-slot advancement, and concurrent issuance with orphan admission denied.
The orphan test pauses one collection binding batch after its registry issuance,
lets a second issuance bind the slot, and proves only the winner can create one
actual attempt and one synthetic egress call.

`probes-v3` independently reproduced a stale skip race: a busy-source finalizer
read a pending slot and paused before its batch; after the prior source lease
expired, another worker acquired the slot; resuming the old busy finalizer changed
the fresh claim's slot to finished and advanced the cursor. The slot retained the
fresh claim ID but lost its processing opportunity. A cursor check alone is
insufficient: every skip must compare the expected slot state, fence and claim ID
inside its mutation batch. This failed attempt is retained for fix verification.

Root clarified the membership terminology: each round freezes its own sorted
selection; the inventory cohort freezes global chain policy and each existing
source's query/configuration/window binding. A new source may join a later round
under that inventory cohort. This is an explicit design decision, not an implied
fixed global source census. Existing source bindings and cohort policy remain
immutable; changed queries or expired chains need a new inventory cohort.

The revised `probes-v4` passed six independent challenges with identical
before/after inputs (contract `548f9a6d`, store `cba50bd5`, collector `8df6aa38`,
SQL `94c84e64`). This verifies the receipt-hash and skip-CAS corrections at that
intermediate snapshot; it is not the final candidate receipt.

`probes-v5` passed nine checks, including final-statement whole-page rollback,
stop after parsing, and scope removal of normalized labels and continuation
copies. Its tenth check reproduced the direct prepare deadline defect: with a
frozen wall clock and a 1000 ms issued deadline, a parser that slept 1100 ms
received a new prepared handle after 1175 ms. The owner anchored the timer before
all preparation awaits and bounded the parser wait; the final qualification below rechecks the corrected behavior.

`probes-v6` reproduced two further defects: a previously completed chain was
reported already-complete after source deactivation, and a healthy source with a
30-second limit was denied by a collector configured with its 300-second default.
`probes-v8` additionally proved the first eligibility correction was only a
preflight check: disabling the source after that check but before the final skip
batch still committed an already-complete outcome. Current availability requires
a transactional eligibility/ancestry guard, distinct from historical completion.

Fairness across two A/B/C rounds passed independently: A failed parsing twice;
B and C still received ordered slots and completed their chains. The first AC05
probe contained a test-only snake_case/camelCase error for `reservedBytes`; the
failed run is retained. Its corrected version proves a charged received response
without page commit remains charged across restart and cannot fetch a free
replacement. `probes-v9` passed lost-final-acknowledgment replay after factory
restart without a second fetch/debit, and empty nonterminal, missing-terminal and
repeated-token incompleteness checks.

Capability and lease checks authorize admission of an atomic D1 transaction.
They do not claim validity at a separate physical commit instant; no external
await occurs between statements of the submitted transaction. A final capability
assertion on page commit is an additional check, not a cross-system atomicity
claim. A remote request admitted before fencing can remain physically in flight;
its stale result cannot authorize collection writes.


## Final candidate and qualification

The final independent run is `.discovery-work/wp07-astra/probes-v14.log`:
**21 tests passed, zero failed**, on Node.js 22.23.2 with fresh actual local D1
instances applying migrations 0001–0044. All **19 monitored inputs** match their
before/after SHA256 manifests. The fixtures use closed synthetic egress and
synthetic server authority; there were no provider calls, production actions,
deployments, installations or commits.

| Reviewed implementation | SHA256 |
| --- | --- |
| collection-contract.ts | `9fb85d794584a99724ff02db4fbe63713411b2cd66bbd79ea0e827b9832e0ba0` |
| collection-store.ts | `f800b375f5e86e1f4764c8bb2bc9de69fff33cc419f2e77443e0fa115e720084` |
| collector.ts | `abfcf200a6dcbbb0f562efb40ecf6b05a529091f2bf590b5c69c5202f448bb6f` |
| 0044_discovery_collection.sql | `94c84e6421620087b92919ee8550949d22922f4b679138257d1a2f96ee1f83fd` |

The original accepted WP05/WP06 runtime files remain unchanged. The accepted
entry comparison flags only `src/lib/ops.ts`: replacing its root-owned schema
stamp 0044 with 0043 reproduces the accepted WP06 hash exactly. Migration 0044's
new source-lease uniqueness and collection admission trigger intentionally alter
runtime behavior under the newer schema; root owns that compatibility gate.

| WP07 criterion | Independent final evidence |
| --- | --- |
| AC01 | Cases 1, 7 and 16: opaque-handle isolation and replay; injected final-statement failure rolls back raw bytes, leads, receipt, progress and settlement; lost final acknowledgment replays after factory restart without another fetch or debit. |
| AC02 | Cases 4, 6 and 13: expired uncertain slot advances once; stale busy finalizer cannot overwrite a fresh claim; A repeatedly fails while B/C receive ordered slots across two finite rounds. |
| AC03 | Cases 6, 8 and 15: slot CAS fences stale finalization; stop between preparation and commit denies all page writes; source deactivation after completion preflight is rejected by the actual finalizing transaction. |
| AC04 | Cases 17 and 21: empty nonterminal, missing terminal and repeated token remain incomplete; expired and partial chains retain truthful typed outcomes. |
| AC05 | Cases 5, 7 and 14: competing issuance leaves only its bound winner able to send once; failed page settlement rolls back; charged but uncommitted receive remains charged across restart and cannot obtain a free replacement. |
| AC06 | Cases 8, 9, 11 and 15: stop/withdrawal deny new page state, scoped normalized labels and continuation copies are erased, replay cannot restore them, and disabled source completion is not relabeled as currently available. |

Additional cases verify stored receipt corruption is withheld; existing query
and policy bindings cannot drift; direct parser and whole-collector deadlines do
not restart after awaited work; default outer bounds respect shorter source
limits; XML/text bytes and typed partial source dates survive trusted private
normalization; and delayed D1 lookup or issuance under frozen wall clocks cannot
cause late egress. The last issued-deadline correction is covered by case 20.

All superseded and failed logs remain. `v12` passed 20 checks but its store input
changed during the run, so it is historical evidence only. `v13` had identical
inputs and passed 20 checks; its remaining failure was a test expectation that
an already-expired restart-required chain should become unavailable. Root
adjudicated that retaining `timed-out` preserves the actual cause. `v14` checks
that persistent expiry and separately checks unavailable for a nonexpired
restart-required chain. No implementation was changed to satisfy that correction.

## Recommendation and limits

Recommend root acceptance of this candidate for the specified local synthetic
implementation scope after its integration gates. This is not operational
activation or a claim of real provider rights, source truth, production reviewer
authentication, inventory completeness or publication eligibility.

The atomicity claim is one D1 transaction for captured body, private normalized
observations, collection receipt, contiguous progress, health success and
settlement. External acquisition is separately admitted and charged; uncertain
requests remain charged. There is no cross-database or object-storage atomicity
claim. A missing uncommitted one-time token or prepared handle requires new
bounded authorized work; replay never recovers that secret or supplies a free
fetch. A source gets one attempt per selected round slot; exhausted/expired
chains require a new explicit inventory cohort.

The new private collection receipt is deliberately incompatible with the shared
SourcePage contract and with WP14 materialized catalog/evidence identities.
Provider adapters and downstream materialization still need their own reviewed
qualification. Source health timestamps are historical; current completed
availability requires the guarded usable receipt and source controls. Logical
current-D1 erasure does not erase backups or Time Travel, and restored state must
reapply removal. Corruption probes model isolated malformed stored state, not an
attacker coherently rewriting every row, digest and trusted dependency.

Root retains full regression, compatibility, migration, build, local smoke,
secret-scan and acceptance responsibilities. The machine review is
`.discovery-work/wp07-astra/final-review.json`, SHA256 `8e84ff6b510d532b52f24e00d31e20511ba2e0e94b775ea8c75111bf2e0f918b`.
