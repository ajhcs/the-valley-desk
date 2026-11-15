# WP06 implementation handoff — Sol

Candidate for independent Astra review and orchestrator disposition. Sol does not
accept this package. All executed acquisition uses closed synthetic egress and
isolated local D1; no real provider, reviewer authentication, source permission,
production credentials, source enrollment, scheduling or deployment is established.

## Implemented boundary

`runtime-contract.ts` defines strict source/qualification/sampling/endpoint records
and the internal transport dependency types. `source-registry.ts` owns private D1
source revisions, separate activation generations, authenticated mutation receipts,
scoped sampling, lease ownership/fences, issued bindings, request/item/byte/page
reservations, backoff and retention settlement. Migration 0043 seeds no enrollment,
activation or credential data. Terra owns exact endpoint grammar and transport;
Sol's WP05 agent owns the independent test file. Root owns the WP05 composition
extension, package wiring, migration stamp and acceptance.

Source records require installation, current enrollment/configuration/permission/
rights/parser/normalizer references, reviewed constructor/scope digests, owner
identities, explicit operating-cost basis and bounded UTC budget windows.
Qualification additionally binds the source revision, complete source digest,
parser, access/display assessment references, engineering/editorial owners,
expiry and actual retained sample representation references/hashes/endpoints.
Samples must match current exact source-response material scope. Sampling has a
separate authenticated bounded grant and does not require or create qualification.

The acquisition authority is the exact current scoped permission's fetch field;
retain/transform rights are checked independently. Access/display policy references
are separately pinned evidence controls, not a grant to publish an artifact.
An explicitly unassessed display reference remains unassessed. Source-response
intake has provisional provenance; WP14 owns later artifact display/reuse and
selector-to-original adjudication. Fixture policy values and capability resolvers
are synthetic assertions, not findings about provider terms or actual reviewers.

Mutation capabilities resolve opaque tokens server-side, bind action/target/
operation/digest, expiry and explicit minimal audit retention. Inputs are strict
private snapshots before awaits; the resolver receives a separate request copy,
and permanent authority audit serializes the verified capability snapshot.
Same-operation conflicting content fails; ordinary replay resolves the committed
result. Failed authorized mutations retain a bounded rejection receipt.

Transport resolves source/operation identity separately from readiness using the
permanent verified issuance audit. Known expired, disabled, malformed-current-state,
missing-egress and removed-plan failures retain the actual source and issued
operation IDs. Unknown/prelookup failures use reserved `source:unresolved` and
`operation:unresolved` markers; local enrollment/operation schemas forbid real
identities colliding with these markers. Future health storage must preserve their
unresolved meaning rather than register them as actual sources. The identity
lookup grants no readiness, credential access or retention permission. A permanent
unique index reserves issued plan IDs after scoped content removal, so a new
operation/source cannot inherit an old plan's audit identity.

## Request and retention integrity

Before activation, issuance, plan resolution, dispatch and retention, the registry
uses WP05's bounded integrity/quarantine reader for current source controls and
qualification samples. SQL guards independently recheck current heads, full
ancestor expiry/tombstones/invalidations, exact material permissions, activation,
qualification, actual lease owner/fence/expiry and budget rows in the mutation
transaction. This detects malformed import/storage content within WP05's bounds;
it does not resist unrestricted coherent database rewriting.

`registry.createTransport` owns dispatch/finish closures. The public registry
does not expose methods that can manufacture a received body. The standalone
transport constructor accepts an explicitly trusted dependency interface for
fixture doubles. A reservation consumes one request and marks dispatch uncertain
before egress; replay of the same plan/attempt cannot obtain another send. Successful
transport records exact acquired-byte SHA-256 and length. The safe
`registry.createEvidenceStore` wires both issued-request resolution and the WP05
same-batch capture guard. That guard matches the actual received attempt/body,
issued reference/digest/final endpoint and current runtime authority. Settlement
requires the matching WP05 evidence operation and occurs in the same batch;
stale lease, absent budget and final-statement failure roll everything back.

Dispatch/capture deadlines are separate from retained-evidence validity.
`retainedThrough` uses the source retention expiry, with earlier permission/rights
ancestor expiry still enforced. A five-minute request deadline does not expire a
still-permitted retained qualification sample; it does prohibit new dispatch or
capture through that operation.

## Conservative accounting and continuation

Every attempted send reserves its entire response-byte ceiling, a page slot and
an actual item allowance at most 100 and at most remaining declared item budget.
Requests and uncertain reservations are never refunded on process restart.
Successful retention converts its byte reservation to exact committed bytes once.
Known failed attempts conservatively retain their reservation in this package.
`reservedBytes + retainedBytes` and aggregate shared-budget counters remain capped
in SQL. Counts currently mean admitted network attempts/maximum normalized items,
not observed provider inventory. WP07 owns exact page/item settlement.

`resolveRetainedRepresentation` reads the actual settled capture and attempt's
`max_items`, exact issued request and usable WP05 bytes. Synthetic adapters consume
that trusted resolver, compare SHA/request bindings and cap output at the actual
allowance. Excess records produce rejected/truncated/partial output, never healthy
complete. The six strict synthetic registrations preserve repository artifact+
account, paper author labels, institutional author/unresolved people, arXiv base+
version, forum account and independent institutional creator distinctions.

A continuation requires an explicitly provisioned trusted receipt resolver.
There is no production resolver/default in WP06. Tests persist a clearly synthetic
receipt after parse/retention; it is not `DiscoverySourcePage` or a production
checkpoint acknowledgment. Registry independently checks the returned parent
capture/plan/representation/hash and current WP05 integrity, and SQL rechecks
parent ancestry during issue/dispatch/capture. WP07 must replace that fixture
boundary with its atomic raw/observation/page/checkpoint receipt store.

## Remaining limits and operational gaps

- Raw binding tokens are returned only on initial issuance; plans/operation
  receipts persist hashes or IDs, never the raw token. Replay cannot recover a
  lost token. A fresh bounded operation is needed; an earlier uncertain request
  stays charged.
- Redirects are deliberately restricted to the exact issued endpoint. Changed
  endpoints, including another grammar-valid URL on the same origin, need new
  issuance. Cross-origin/private targets receive no second request or credential.
- Native fetch has no default. A future reviewed egress must enforce public
  destination at connection time; URL grammar alone is not DNS qualification.
- Before plan lookup completes, transport has a 300-second absolute lookup bound;
  after lookup, the persisted deadline and monotonic remaining time both apply.
  Expired lookup results cannot dispatch. Promise racing cannot preempt synchronous
  parser CPU; inputs/cardinality are bounded and no CPU-isolation claim is made.
- Stream cancellation bounds retained bytes, not network traffic already delivered
  in an oversized chunk. Received byte counts may exceed the retained ceiling.
- D1 admission is the request linearization point. A subsequent revocation cannot
  atomically retract an already admitted socket send; later attempts and stale
  retention fail. No stronger physical timing guarantee is claimed.
- Source-bearing endpoint/parameter/continuation/sample payloads have exact scoped
  removal in the WP05 revocation transaction. A different current revision/material
  is preserved. Minimal authorized IDs/hashes/authority and numeric accounting remain.
- Real parser/access qualification and provider costs belong to WP08–WP13/WP24;
  production scheduling and complete page/fair-round behavior belong to WP07.

## Validation status

Owner execution of the independently authored local-D1 suite passed **19/19**
tests after the final integrity/quarantine refinement (18 subtests and parent,
zero failed/skipped/cancelled, approximately 108 seconds). The final run is retained
at `.discovery-work/wp06-design/owner-transport-validation.log`. App TypeScript
passed under Node 22.23.2 with sanitized environment. Tests use migrations 0001–0043,
`persist:false`, `remoteBindings:false`, `envFiles:[]` and no real egress.

This owner full-suite run precedes Terra's final transport monotonic credential-
expiry correction. Terra's direct frozen-wall regression passes; the current
combined freeze uses endpoint `c68b45e9` and transport `e26cd824`. The independent
test author and Astra are rerunning against that combined freeze. The earlier
19/19 result remains evidence for its captured transport candidate.

Root subsequently reopened the candidate narrowly for audit-bound failure identity,
permanent issued-ID nonreuse and reserved unresolved markers. The source/runtime/
migration hashes below include those corrections; independent final qualification
must use those hashes and Terra's associated transport identity patch. Prior
19/19 and 20/20 runs are historical, not relabeled as final patched results.

Frozen owner implementation hashes:

| File | SHA-256 |
| --- | --- |
| src/ingest/discovery/source-registry.ts | `d30741724aed9ad051c689f91edcaa49649aad2e3c55c8757d5b019f9b42ffa9` |
| src/ingest/discovery/runtime-contract.ts | `fc2d2d85c30d462a3dee68a80dfc452cfcdd330bce1c42599d578e084b8566fc` |
| src/ingest/discovery/adapter.ts | `187236b801bf0191e894ff65552fca63352f6c1907f2ff6a57eac5a03ca993ad` |
| migrations/0043_discovery_registry.sql | `733332e836bfe0c3c0dba2d5af343529e7f783aa4a0274b63e9518a02bf28b89` |

Preserved failures include the initial token-in-plan persistence, wrong issued
retention expiry, absent-budget dispatch, stale-parent continuation admission,
unbound item counter, public completion ingress and quarantined authority use.
Independent historical probes remain under `.discovery-work/wp06-astra/`; they
remain failures for their captured candidates. Root integration/requalification,
Astra disposition and provider/production qualification are separate claims.
