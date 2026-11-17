# WP07 collection verification

Status: verification completed for local implementation; results and limits are
in the [WP07 receipt](receipts/WP07.json), [orchestrator review](reviews/wp07-orchestrator.md)
and [integration receipt](wp07-integration-validation.json). This table preserves
the planned experiments. The frozen [WP07 scope](../discovery-engineering/work-packages/WP07.md)
and [EX10 decision](implementation-decisions.md) govern this increment.

The target is the private collection implementation using accepted WP05 evidence
and WP06 registry contracts. Observation points are actual local D1 rows,
transaction outcomes, injected egress calls, returned receipts, and the ordered
round ledger. Use isolated databases, deterministic clocks and synthetic bodies;
record candidate hashes before and after execution. No provider or production
coverage is inferred from these tests.

| Requirement | Discriminating experiment | Required observation |
| --- | --- | --- |
| AC-WP07-01 / P09 | Drop the response after the page transaction commits; recreate the store and retry the same operation | One representation, private candidate identity, page receipt and cursor transition; continuation resumes from that receipt |
| AC-WP07-02 / P24 | Freeze three sources, repeatedly fail the first, enroll a fourth during the round | The original three each receive an ordered slot; failure advances the cursor; the fourth enters a later snapshot |
| AC-WP07-03 | Take over the slot after parsing and before write; also pause an old worker before dispatch admission | Old fence cannot commit observations/checkpoint/success or admit another request; source and slot fences move together |
| AC-WP07-04 / P25 | Empty nonterminal, missing terminal, duplicate token, rejected row and truncated page chains | Durable partial evidence where allowed, no complete inventory; empty source selection never proves coverage |
| AC-WP07-05 / P22/P23 | Concurrent reservations, interrupted dispatch and store recreation | Durable request/byte/item counters remain within caps; uncertain requests stay charged; settlement occurs once |
| AC-WP07-06 / P10/P29 | Disable or change source authority between acquisition and commit | No later unauthorized admission or stale page commit; prior evidence persists; progress records the gap |
| Transaction composition | Fail a middle or final statement in the actual D1 batch | No raw representation, normalized observations, receipt, checkpoint, success or settlement from the failed page |
| Continuation identity | Change query, source revision, window, parser or chain policy; expire a token | No silent continuation or extension; an explicit new inventory cohort is required |
| Removal ownership | Revoke one exact material scope after successful pages | Source-bearing copies and continuations are removed together; unrelated scopes and consumed accounting remain |
| Trust boundary | Supply draft success flags, arbitrary references or a collection receipt to evidence-backed page consumers | No publication authority, fabricated evidence references or catalog identities; private collection and later evidence-backed pages stay distinct |
| Bounded execution | Stall parser, transport and mutating storage separately | Late work cannot start further mutations; an unknown transaction result remains uncertain until durable reconciliation |

The conditional fairness argument applies to a fixed ordered cohort of size
`n > 0`. A committed slot transition increments its cursor once, whether the
slot succeeds or fails. Given continued dispatch and eventual recovery of each
abandoned lease, after `n` such transitions every position has had a slot. This
does not bound wall-clock completion under a database outage or guarantee a
successful provider response. Tests must establish the implementation's
transition and fencing premises; the existing abstract proof alone does not.

A finished scheduling round is not completed source coverage. In particular, an
empty selected set may finish scheduling but has no complete inventory receipt.
Coverage must be read from the exact source/query/window chain; historical
`lastCompleteAt` timestamps cannot establish coverage for changed scope.

P26's admitted/published membership remains a later integration obligation.
WP07 only retains private candidates; no admission or public freshness is
created. Native model inputs remain unchanged unless a separately recorded
change requires requalification. Real source relevance, identity accuracy,
geographic coverage, usability and operating capacity remain WP03/WP14 and later
validation work.

Sol owns the store and migration; Terra owns the collector; a separate Sol owns
the acceptance tests; Astra independently challenges design and actual runtime
behavior. The orchestrator reviews the resulting code and evidence, fixes gaps,
and records the final disposition in `execution.json` and the package receipt.
