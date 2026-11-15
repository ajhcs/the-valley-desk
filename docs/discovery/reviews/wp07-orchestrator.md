# WP07 orchestrator review

Status: accepted for isolated local collection after independent review and
integration qualification. Deployment remains prohibited. The twenty accepted
WP06 input hashes matched before changes. Original accepted runtime sources and
receipts remain preserved; migration 0044's behavior is separately requalified.
The [package receipt](../receipts/WP07.json) and
[integration receipt](../wp07-integration-validation.json) bind the final inputs.

The following findings came from contract/code inspection unless an executed
probe is identified. They are not claims that each defect was reproduced before
repair. Final actual-D1 and focused collector tests verify the repaired behavior.

| Finding | Correction and final evidence | Disposition |
| --- | --- | --- |
| Retained-only parsing cannot precede an atomic raw/page commit | Factory-owned provisional parser, detached bytes and an opaque prepared handle; injected final-statement failure rolls back raw/lead/page/checkpoint/settlement | Closed: Sol atomicPage/handles/rollback; Astra 1/7 |
| Candidate leads cannot supply real evidence references or canonical subjects | Separate private collection receipt; stable native candidate key; no fabricated evidence or publication authority | Closed: strict schemas and Sol stageDates/formats |
| Collection takeover could leave a valid independent source lease | Atomic linked source fence; one actual source lease; reject ambiguous upgrades | Closed: Sol parseTakeover/preAdmission; final migration probe |
| An expired claimed slot could acquire another claim and repeatedly consume attempts | Recover abandoned slot into a durable gap and advance; retry only in another authorized round | Closed: Sol abandonedFairness; Astra 4/14 |
| Continuing a page called live resolvePlan on a released/expired parent | Resolve retained parent receipt/evidence, preserving exact query/window/configuration | Closed: Sol chains/crashReplay/contiguous |
| Registry issuance and collection binding are separate commits | SQL attempt guard rejects orphan and losing concurrent plans at actual reservation | Closed: Astra 5; Sol preAdmission/reservationRace |
| Outer cutoff or shorter returned deadline could reset under frozen clocks | Original-anchored wall and monotonic limits; clamp source/issued bounds; check actual egress | Closed: Terra focused tests; Sol outerCutoff/syncParser/sourceCap; Astra 20 |
| Strict lead shape lacked required source dates and stages | Preserve typed partial/multiple dates and stage/version distinctions; keep native key stable | Closed: Sol stageDates; Astra 12 |
| Mutable factory dependencies could change after setup | Snapshot trusted parser/capability dependencies and detached acquisitions | Closed: Sol handles; Astra 1 |
| Page counters confused reservations, retained bytes and parsed items | Once-only transactional settlement, restart and actual concurrent transport admission | Closed: Sol reservationRace/uncertainty/rollback; Astra 7/14 |
| Corrupt receipts or stale completion checks could claim current coverage | Canonical receipt/lead digests, usable retained body and transactional current-source/ancestry guard | Closed: Astra 2/11/15 |
| A stale busy-skip could overwrite a fresh claim | Compare slot state, claim, fence and cursor inside the finalizing batch | Closed: Sol skipCas; Astra 6 |
| Copied labels/tokens survived revocation or depended on trigger order | Exact scope ownership on copied payloads; removal preserves unrelated scopes and conservative charges | Closed: Sol removal; Astra 9 |

Astra subsequently reproduced two additional blockers against actual local D1.
Changing only a stored nonterminal receipt's `chainComplete` field returned a
false complete acknowledgment (`probes-v1.log`). A delayed busy-skip batch
overwrote a fresh claim at the same cursor (`probes-v3.log`). Both failures remain
under `.discovery-work/wp07-astra/`; the fixes require integrity-checked receipt
reads and slot-state/fence/claim compare-and-swap guards. These diagnostic runs
precede the final candidate and are not final qualification.

The initial actual local D1 migration probe used migration hash
`33c1af5d812fc27302e9ee541e3fc0a2477bd000a34b3daca9a7f5d64463dd4d`.
Two existing leases for one source caused the entire migration to roll back and
preserved both leases. After explicit removal of only the synthetic duplicate,
the migration succeeded; a new duplicate was rejected and no collection round
was created. Evidence: `.discovery-work/wp07/migration-probe/`. Later migration
changes were qualified separately; this result is not silently relabeled. The
final `94c84e64` migration passed all six checks again in
`.discovery-work/wp07/migration-probe-final/`.

Root prepared the existing WP06 acceptance suite under migrations 0001–0044 in
`.discovery-work/wp07/compat/`. Only paths, retained input locations and the
migration bound differ from the accepted original test. All 21 tests passed
under 14 unchanged inputs. The [WP06 requalification receipt](../receipts/WP06-WP07-collection.json)
records this extension without replacing the original receipt.

The [verification plan](../wp07-evidence-plan.md) retains the six package ACs and
additional adverse cases. Sol's independent suite passed 33 tests with 16 stable
inputs; Astra passed 21 checks with 19 stable inputs; Terra passed six focused
collector tests. Root's full `npm test` passed 1,193 tests (937 primary, 146 Watch,
110 discovery), with zero failures, skips or cancellations. All 535 recorded
runtime, test, fixture and configuration inputs matched after the run. Build,
isolated smoke and secret scan passed. Frozen handoff/model manifests (70/21
entries) and the accepted native model/interface hashes remain unchanged.

Two test expectations were corrected without weakening runtime requirements.
Disabled at issuance records a durable `failure/disabled`; preclaim revocation
records a no-send skipped slot. A one-second loop fixture returned uncertain
before its in-flight commit completed; the retained timeline shows return at
2501.7 ms and commit success at 2939.8 ms. The loop fixture now uses 60 seconds
so it reaches the repeated-token observable. Dedicated short-expiry/deadline
checks remain. Astra's repeated-expiry expectation was also corrected to retain
the actual `timed-out` cause, with a separate nonexpired restart-required check.
All prior failing/mixed-input logs remain historical evidence.

The finite-round argument is conditional: for fixed size n, each guarded final
transition advances the cursor by one, so n transitions visit every slot. Tests
challenge the cursor/fence premises. Neither that argument nor local D1 checks
prove a live provider responds, yields a complete inventory, or supplies true
identity/geography/relevance evidence. This increment has no public routes,
catalog admission, provider activation or scheduler. WP03/WP14 and later gates
remain open. Mutation timeout is uncertainty, not cancellation; logical scoped
removal does not erase backups. Release remains unqualified, including the
unchanged dependency advisories.
