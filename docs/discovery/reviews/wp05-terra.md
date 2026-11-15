# WP05 independent acceptance test plan — Terra

Status: in progress; this is not package acceptance. Fixtures are synthetic and execute against an isolated local D1 instance. No source access, production retention authority, publication, or legal sufficiency is established.

| Criterion | Independent scenario and observable result |
| --- | --- |
| AC01 | Capture original bytes and separately normalized text, preserving their distinct SHA-256 values. Change a character outside an exact quoted span, retain a second revision, and resolve the original evidence against the original revision. Neither revision's hashes or binding are overwritten. |
| AC02 | Accept an exact UTF-16 quote and structured pointer/value; reject incorrect offsets, surrogate-splitting boundaries, a changed quote, missing pointer and mismatched value. Compare all discovery table rows and counts before and after each failure. |
| AC03 | Replay the same key and payload, obtaining the original durable result without another representation or decision. A later observation of identical bytes is recorded separately; a changed payload with an old key is rejected. |
| AC04 | Three mirror endpoints of one press release count as one provenance origin. An authorized origin merge or split advances the reviewed ledger and invalidates affected corroboration decisions; missing authority and stale heads fail. |
| AC05 | Preserve contradictory affiliation claims and their cited evidence concurrently. A supported correction advances the accepted decision head once; superseded/rejected records remain inspectable, and replay does not advance it again. |
| AC06 | A failed refresh preserves previously permitted evidence while recording failure rather than fresh health. A separate reviewed retention revocation removes content from representations and related evidence, claims, decisions and operation receipts, invalidates dependents, and blocks resurrection on an old operation key. Only explicitly permitted minimal audit information remains. |

Transaction challenges: race two updates from the same expected head and require exactly one winner; prefix a stale transaction with an unrelated write to expose non-aborting zero-row updates; force a final SQL failure and compare complete pre/post images and row counts. Validate durable acknowledgment against committed bytes and metadata, including intentionally mismatched digests. Inspect logs or test-captured errors for forbidden content. UTF-16 offsets are code-unit indices, and offsets in the middle of a surrogate pair are invalid.

Tests must use migrations 0001–0042 and local-only D1. They show behavior for synthetic fixtures and the tested implementation, not external access qualification, real source permission, editorial authority, legal interpretation, or production recovery.

## Historical local D1 result (superseded)

The fifth run below was superseded by subsequent code changes and newly identified ancestral-rights and SQL guard defects. It is not evidence for the current candidate.

The fifth independent run passed all nine subtests (10 tests including the parent), with migrations 0001–0042 applied to an ephemeral local D1 instance on Node 22.23.2. The first run exposed a revocation transaction failing on an immutable-row trigger; Sol corrected it. Runs 2 and 3 passed the then-current fixtures, but do not cover the subsequent ownership and origin changes. The fifth run covers:

- Different original and normalized byte hashes, exact revision binding, UTF-16 and JSON-pointer negatives with complete discovery-table comparisons, unchanged-byte observation and idempotent conflict/replay.
- Three mirrors, two distinct origins, reviewed retirement and full member transfer, a later split, member/endpoint refusal and invalidation of the earlier dependent decision and evidence.
- Two contradictory claims and a single correction, stale concurrent writes, injected prefix and final-statement rollback, and catalog bridge refusal in both orderings.
- Failed refresh, explicit scoped revocation across both rights revisions, uncaptured-origin/claim/decision/private-note and raw-byte canaries, old-key replay refusal or tombstone, and continued use of an unrelated artifact sharing controls. Captured console output and all discovery table rows were checked for the selected synthetic canaries.

The successful run is `.discovery-work/wp05-terra/run-5.log`, SHA-256 `eb694302da2665db0b53ce235aec8be07220453921131fc3a8c55e4a177901e4`; the failed first run remains in the same directory. Candidate hashes: schema `34170f099d7f8587d5cf0018abb1921b0801391def18a04c57752d3426d63651`, store `01e28b2b1c2b8f7d31e2ed33ceb929f4f2bf036e90efea920e6c01eaa7afa18e`, migration `3136be6ebfbdebfc07fb1b0a35da570459c00791b8b90c457e207fc9e57c9f52`, test `c7e73eb1a8b9e242e570b31bea4cecec9d1ba83e35c459ef8121f563f32eba6d`. These hashes must be refreshed and the tests rerun if any inputs change.

This test does not qualify real reviewer authentication, provider rights, downstream public projection/snapshot invalidation, complete log sinks, backup erasure, or production migration and recovery. Hashes are computed by the store from bytes rather than supplied by a caller, so this suite checks retained values against independently computed hashes, not an externally supplied digest mismatch. The root owns final integration and package disposition.

## Known-artifact candidate after rights correction

Run 10 passed 10 local-D1 subtests (11 tests including the parent) with all 42 migrations. It adds expiry and rights-head changes across evidence, claim, decision and observation; removal after expiry; cross-scope origin rejection; a fresh evidence extraction from historical representation v1 after v2; exact JSON numeric and Unicode key distinctions; duplicate-key refusal; and direct decision-scope replacement refusal. Runs 6–8 retain intermediate fixture failures, and run 9 occurred while candidate files changed. Run 10 inputs were schema `afc66224b2977c81c55b87cba0d371ba2c4afbf73ddaadad46062149945b58a1`, store `3d438cf4807cf43f3b12ad43bccfcde9f828f4ce8051bd9156ae51c08423a352`, migration `8796e87976f231caf73b7440a507f34a24f1a173ff329fe2d7b09a2ff7f70789`, test `6d904a9de52373c176504eceaa3c13a1ef103f4d35b0db5f14d3732ac59465cf`; log `.discovery-work/wp05-terra/run-10.log` SHA-256 `ba3b10be5377289d886b373149410615a1a2ac2223bf39cf9f758aef88ab050a`.

This candidate is superseded for final disposition: it does not establish the first-acquisition source-response seam. That extension and its independent tests are in progress. The previously stated validation boundaries remain in force.

## First-acquisition candidate

Run 12 passed 11 independent local-D1 subtests (12 tests including the parent), using migrations 0001–0042. In addition to the earlier cases, the first response was committed while the discovery catalog held zero entities; no discovered entity was fabricated. A synthetic trusted issuance resolver bound the request, endpoint, scope and provisional origin. Missing or null resolver output and changed source, configuration, template, query, material, request digest or endpoint were rejected with unchanged discovery rows. Counting a provisional origin as corroboration failed closed. Separate stale-configuration and freshly revoked-grant cases rejected new captures; revocation removed an already retained response and replay could not restore it.

Run 12 candidate SHA-256 values: schema `56c368d5f742ceab93786e5e2cccd69e9682734e63119f90d46e8babf7b357f3`, store `71d3f09a5b35915fdac238c75f092daf628c37c4f49465ea0d3e90a45c8dc9e6`, migration `9446c353b0d2787b98e19d00ea80ab80c0bcbbc9bbaa4c1c818facbc6a35f339`, test `b13cabc8d97900f6c6fb1d739058583243b62f840e986183d5ff3f986ec6cd59`, log `.discovery-work/wp05-terra/run-12.log` `848c0113efaa25ab28b2460fd9dd0afdcc6566d6306ec872a7f11ccd07dc0ac2`. The prior candidate and failures remain preserved as historical evidence.

The resolver is synthetic, not a real source registry or network authorization. WP06/WP07 still need same-batch production issued-request, qualification, lease, budget, page and checkpoint integration. No provider was contacted and no package acceptance is claimed here.

## Revised revocation and integrity candidate

Run 13 passed all 12 local-D1 subtests (13 tests including the parent). It adds denied fresh rights and permission IDs for both revoked artifact and source-response scopes, rejected origin rationales, unchanged full discovery-table snapshots after each denial, and successful use of other scopes. It also simulates a corrupt import in the disposable database by temporarily dropping and restoring immutable-update triggers: both a stale payload hash and altered representation bytes with a recomputed enclosing payload hash produce a quarantined, unusable, content-free read and reject new dependent evidence and claims without changing rows. This is a corruption simulation, not qualification against unrestricted database administrators.

Run 13 inputs: schema `463bd9800f627302f32dc181ffdc86832532afad8b703fc4cd8c717fd4f7d5a6`, store `a91e848e2be895a50c7723b6b0ccd82af6cc69d0aec29d2e0ac8d32c4b277423`, migration `e8fd2e35521450de9b1baf3f6b126d561cd53bde0e280d02b66745a4101d5231`, test `ebcdaf88f289c2e4fc26ef1611fa9a56328eeab9b69c7eebe40ffeb87d7b9580`; log `.discovery-work/wp05-terra/run-13.log` `bd6c1a4d211ea90f12dd7c1178722b11999650e3a8e229fe05f9c53d4ce2e883`. Run 12 is superseded for candidate disposition. Synthetic capability, provider, registry and production integration limits above remain unchanged.
