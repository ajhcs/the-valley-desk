# WP06 independent review — Astra

2026-11-14. Independent review complete; recommend local implementation acceptance
after root integration qualification. Root retains package acceptance. Scope is the
selected `tvd-discovery-implementation-20261113` checkout, actual isolated local
D1, synthetic adapters and injected mock egress. No production source activation,
provider request, credential setup, qualification, scheduling or deployment is
authorized or established by this review.

The accepted WP05 receipt is the entry boundary. Its source-response rights and
provisional-origin seam supersedes the earlier design's finite pre-enrolled
concrete-URL restriction. Any amendment to accepted WP05 code needs root approval
and renewed verification. Its old passes cannot qualify a new composition API.

## Initial review invariants

- Qualification binds installation, source/config/parser, exact material rights,
  access, reviewed endpoint grammar, owners and expiry. Activation is a separate
  authenticated event. Bounded first-sample authorization works for pending
  enrollment without the completed qualification it is intended to produce.
- No body authority, arbitrary lease/budget reference or caller `ready:true`
  substitutes for durable current rows. Registry activation/qualification,
  configuration, permission, rights, real lease owner/fence/expiry and budget
  predicates must guard the same D1 transaction that retains the response.
- Request admission is charged before each external attempt, including redirects
  and retries. A dispatched-but-unfinished operation stays charged/uncertain after
  restart; replay cannot silently repeat its external effect for free.
- Exact origin/path/query constructors reject extra and duplicate parameters,
  normalization ambiguity and unbound page tokens. Continuations bind their
  committed parent and full query/config/parser/window scope. A provider URL or
  host match alone cannot authorize a fetch.
- Credential resolution is server-only and exact-origin/header scoped. Missing,
  expired or mismatched credentials send zero unauthorized requests. Raw secrets,
  provider error bodies and resolver exception text never enter durable logs,
  failures or receipts. Mutable resolver objects cannot change a validated grant.
- Pure URL filtering is not DNS-locality proof. No default native egress is
  supplied. Cross-origin/private redirects fail before a second send or header
  forwarding; every permitted hop rechecks authority and consumes a new permit.
- The persisted absolute deadline and per-invocation monotonic deadline cover
  credential resolution, egress admission, fetch and every body read. Ignored
  abort signals and hanging cancellation cannot prolong the operation indefinitely
  or let a late continuation write successful state.
- Byte accounting distinguishes reserved response capacity, admitted/retained
  bytes, observed chunks and actual wire traffic. An oversized chunk may already
  have arrived before cancellation; logical retention bounds are not wire caps.
  Aggregate reservations and committed retention stay within durable caps under
  independent concurrent registry instances and restart.
- Retry-After/backoff persists across restart, is not shortened by an earlier
  outcome or local deadline, and does not become retry-now on overflow. Failure
  preserves last-good evidence without renewing health, completeness or coverage.
- WP06 representation retention is not a committed page/checkpoint acknowledgment.
  WP07 must compose raw material, normalized observations, page receipt, budget
  settlement and contiguous checkpoint mutation in one actual D1 transaction.
  Separate successful calls and cross-store writes are not atomic.

The SQL admission transaction is the external-request authorization linearization
point. An ordinary database cannot atomically revoke a socket send. A concurrent
revocation after admission may precede physical dispatch; every subsequent attempt
and stale retention must fail. Stronger physical zero-post-revocation-send claims
would require a separately qualified serialized egress authority.

## Initial evidence plan (superseded by final results)

The initial plan required all six actual ACs to receive independent source/SQL
inspection and local execution.
Review artifacts belong only under `.discovery-work/wp06-astra/`; earlier failures
and exact reviewed hashes will be retained. Tests use Node 22.23.2, `env -i`,
original HOME, workspace TMPDIR/XDG paths, no env secret files, no remote bindings
and explicitly injected synthetic egress. External rights, human authentication,
provider access, legal sufficiency and deployment remain separate claims.

## Intermediate adversarial results (not acceptance)

The first transport draft review identified missing successful-body digest,
credential expiry after an awaited permit, mutable chunk aliasing, excessive
Retry-After shortening, incorrect redirect status, eager work after deadline, and
cleanup extending the deadline. The owner corrected these before the independent
closed-egress run. Root separately identified external exception leakage; the
independent stream-error canary probe now also passes. `transport-v1` preserves
that run; `transport-v2` includes the revised exact-endpoint redirect rule and
slow-plan/frozen-clock case. Pure transport doubles are not registry authority.

`registry-v1` ran the real local D1 migration chain and reproduced two blockers:
a publicly callable completion function accepted a fabricated received digest
without any external send, and a normally invalidated parent representation still
authorized a child continuation. Root required a safe factory whose transport owns
private reserve/finish closures and a trusted page-receipt resolver with a retained
parent guard. `registry-v3` confirms the exposed methods are absent and the stale
parent is denied. The first counterexamples and code snapshots remain preserved.

`registry-v3` reproduced a third blocker: deleting the enrolled budget row in an
isolated malformed-state fixture left the counter UPDATE affecting zero rows,
yet a request was sent and its attempt became received. Admission and settlement
must verify an existing matching budget row in the same transaction. No claim is
made against an adversary with unrestricted database rewrite authority.

The same runs verify that a retained sample remains usable after the short
request deadline, can support later qualification, and cannot authorize a new
attempt on the expired plan. Full private-table scans found no raw request-binding
token; scoped rights revocation removed source endpoint copies and prevented plan
replay. These passes concern logical current-state deletion only.

`registry-v2` is retained as an unsuccessful fixture run across the public factory
API change, not evidence against the revised implementation. Final recommendation
requires a stable candidate, updated receipt/adapter contracts, item-cap binding,
all six package ACs and the corrected budget and transaction probes.

## Further dispositions and stable reruns

The malformed-state probes in `registry-v5` confirmed that a quarantined sample
could still authorize activation, dispatch and retention, and that a quarantined
current grant could authorize activation and dispatch. The fixture temporarily
removed only the content UPDATE guard, changed one payload without its stored
hash, then restored the normal guard. It represents malformed imported state,
not an unrestricted adversarial rewrite. The owner added the bounded WP05
integrity reader before using controls or qualification samples as authority;
normal expiry, revision and invalidation races remain checked in SQL.

All 13 independently inspected cases in `registry-v6` produce their required
outcomes, on unchanged before/after hashes. This includes the corrected malformed
samples and controls, exact retained-byte settlement, atomic rollback after a
lease-fence change or deleted budget inside the batch, final-statement rollback,
scoped removal, invalidated continuation parents, and conservative loss of an
initial one-time binding token. The item-cap probe retains two raw records but
admits only one lead under a one-item allowance, marking the result truncated,
partial and nonterminal. A wrong body digest, changed request, fabricated receipt
object and default unresolved adapter all fail.

The independently relocated package suite passed 20/20 in `full-ac-v3`, including
all six ACs; both its embedded thirteen-input audit and the review's before/after
hash audit were stable. The final clock-adjusted transport was separately tested
in `transport-v3`: frozen and backward wall time cannot extend a 25-ms credential
through a 60-ms reservation; each leaves one charged permit and zero sends.
`full-ac-v1` passed 19/19 on the earlier transport; `full-ac-v2` is retained as a
copy-fixture path failure introduced when the test owner added input-hash audit
paths. It did not execute package cases or modify implementation files.

At that intermediate revision, one final IF02 reporting defect remained open.
When plan readiness fails before assignment, transport substitutes `planId` for
both source and operation identity; missing egress follows the same path. Root
identified the defect and `registry-v7` reproduced known missing-budget, known
missing-egress and unknown-plan cases. A known plan's typed failure must carry
its actual trusted source/operation binding; an unknown plan needs an explicit
unresolved outcome. Earlier passing tests do not waive this identity requirement.

## Final independent disposition

Recommend root acceptance of the local WP06 implementation and EX09 composition
amendment after root completes integration qualification. This review does not
itself accept the package. No concrete blocker remains in the reviewed candidate.

The final candidate passed 21/21 in the independently relocated package suite
`full-ac-v5`. All six actual ACs were exercised on isolated D1 with migrations
0001–0043. The review's before/after hashes and the suite's thirteen-input audit
are unchanged. `registry-v9` contains 16 independent adversarial probes with all
expected outcomes inspected and no harness errors. `transport-v5` repeats the
closed-egress timing, credential, redirect, chunk and endpoint probes on the final
transport/runtime hashes. Root's full application tests, build and secret scan
remain a distinct integration record. Synthetic capabilities and fixtures validate
implementation behavior, not authenticated reviewer identity, actual permissions
or source truth.

| Criterion | Reviewed result |
| --- | --- |
| AC01 | Changed parser/configuration and expired rights reject activation/dispatch; malformed imported current controls or qualification samples also quarantine before use. SQL rechecks normal head, expiry and invalidation races. |
| AC02 | Missing, expired or mismatched credentials produce typed failures with no unauthorized send. Frozen/backward clocks cannot extend credential validity. Exceptions and raw headers do not enter failure receipts. |
| AC03 | A trusted synthetic page-receipt resolver binds the retained parent, full request scope and next token. Extra/duplicate parameters and stale/invalidated parents fail. There is no default production receipt resolver. |
| AC04 | Cross-origin, private-address and changed-endpoint redirects stop before a second send. Same-origin grammar validity does not override the exact issued endpoint. |
| AC05 | Concurrent actual-D1 attempts cannot overdraw request/byte capacity. Missing or changed budget rows fail closed. Injected lease changes, budget deletion and late batch failure roll back capture and settlement together. |
| AC06 | Six separate synthetic adapters preserve native identity/version distinctions and unresolved people/accounts. Exact retained bytes, request binding and reserved item allowance constrain parsing; output never grants publication. |

The final reporting correction resolves failures through permanent verified
issuance audit metadata, independently of readiness. Known stale, erased or
otherwise blocked plans preserve the actual source and issue-operation IDs;
unknown plans use explicit reserved unresolved markers. Neither marker can be
registered as a real source/operation. A permanent uniqueness index prevents a
removed issued-plan ID from being rebound to another source; the original audit
identity remains stable. These checks close the `registry-v7` finding without
turning historical audit identity into an access grant.

## Required limits for handoff

- The safe registry factory owns transport completion and supplies both the
  WP05 issued-request resolver and capture composer. Low-level injected helpers
  are trusted server integration seams, not request-body authority.
- Initial plan/audit lookup has a 300-second ceiling because the source cap is
  not yet known. Once resolved, elapsed monotonic time is charged against the
  source cap immediately; a late lookup cannot start dispatch. A shorter source
  cap cannot retroactively cancel an earlier lookup before that cap is known.
- SQL admission and a physical network send are separate events. Revocation
  after admission can precede dispatch; subsequent attempts and retention must
  fail. No cross-database, object-storage or database/socket atomicity is claimed.
- Endpoint syntax is not DNS evidence. There is no default egress or activation;
  a production connection-time public-destination authority, credential ownership
  and source-specific permissions still require qualification.
- The exact issued endpoint is the only permitted URL. A changed redirect URL
  needs a new reviewed issuance. Item counters reserve parse capacity and byte
  counters reserve/admit retention capacity; neither is a census, coverage proof
  or bound on every byte already delivered over the wire.
- An issuance binding token is returned once and never stored raw. Lost initial
  delivery cannot be recovered by replay: a new authorized issue and charged
  attempt are required, and uncertain earlier reservations remain charged.
- Scope removal erases current source-bearing registry/evidence contents in the
  same D1 transaction while retaining explicitly permitted audit/accounting
  metadata. It is not physical erasure from backups, Time Travel or prior exports;
  WP26 must reconcile removals during recovery.
- The six synthetic receipt stores and resolvers establish test behavior only.
  They do not qualify real providers or constitute production SourcePage receipts.
  WP07 must compose representations, normalized observations, durable page
  acknowledgment, budget settlement and contiguous checkpoint progress in one
  transaction, with its own recovery and lease rules. WP14 still owns reviewed
  per-selector provenance and publication integration.

The initial `full-ac-v4` run retained a missing-import error in its newly added
identity test; the owner corrected that test-only defect before `full-ac-v5`.
The production implementation hashes did not change for that correction.

Historical failures and superseded passes remain in their original scratch
subdirectories. They are not relabeled as evidence for later hashes. The final
machine-readable review record is `.discovery-work/wp06-astra/final-review.json`.

## Exact final reviewed inputs

| File | SHA-256 |
| --- | --- |
| `test/discovery-transport.test.ts` | `8ed479d609ea1e3886b2ece5111170ad7d1326450123ae21492f60a989af0b37` |
| `test/fixtures/discovery-d1/wrangler.jsonc` | `09fb2382d6eacc70562601e1ad91bff271d205a641d3691a1b1aa16acb6bb500` |
| `src/content/discovery-evidence.ts` | `463bd9800f627302f32dc181ffdc86832532afad8b703fc4cd8c717fd4f7d5a6` |
| `src/ingest/discovery-evidence-store.ts` | `b366224eb46276f5143df0fc0df2b9b9ea546b98c363863fb0e0cdab96ce3ea6` |
| `src/ingest/discovery/runtime-contract.ts` | `fc2d2d85c30d462a3dee68a80dfc452cfcdd330bce1c42599d578e084b8566fc` |
| `src/ingest/discovery/source-registry.ts` | `d30741724aed9ad051c689f91edcaa49649aad2e3c55c8757d5b019f9b42ffa9` |
| `src/ingest/discovery/endpoint.ts` | `c68b45e9f1bda9d4ee86a13876a963a75ed9c420ac25a00f1c5567bd64c055dc` |
| `src/ingest/discovery/transport.ts` | `2776bf5ea043300ddd984456e69957248f199a3a70cd5332f1c8a637907fdd6c` |
| `src/ingest/discovery/adapter.ts` | `187236b801bf0191e894ff65552fca63352f6c1907f2ff6a57eac5a03ca993ad` |
| `src/ingest/discovery/source-contract.ts` | `ee6e59565c85e6391b843c1047e39ee686f94e5ef716984eaafc0c9fb11a671b` |
| `migrations/0042_discovery_evidence.sql` | `e8fd2e35521450de9b1baf3f6b126d561cd53bde0e280d02b66745a4101d5231` |
| `migrations/0043_discovery_registry.sql` | `733332e836bfe0c3c0dba2d5af343529e7f783aa4a0274b63e9518a02bf28b89` |
| `package-lock.json` | `f90749d123fe5d553057a037188af6a827367aa6bc427e84ccc25a3c4218fe05` |
