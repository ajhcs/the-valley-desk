# WP12 private source-edit invalidation increment

This increment addresses the private evidence portion of AC-WP12-06 and the
evidence/currentness/withdrawal obligations in R04, R14, R16 and the frozen
dependency contract. P10's `F_REFRESH` correspondence is relevant context;
this increment does not claim a new formal proof.
It does not discharge native deletion, actual installation qualification,
WP14 admission, WP16 public projection invalidation or full WP12 acceptance.
The native model and original interface contract remain historical accepted
inputs; the additive implementation contract is recorded with this increment.

The server compares two retained, verified topic responses for the same qualified
installation, source revision, configuration and scope. The selected post must
have a later observation and strictly advanced native version. Missing posts,
403/404 responses, failed requests, incomplete parsing and an operator-entered
reason do not prove deletion. The deletion path remains held.

A dedicated, exact-request-bound source-support invalidation capability authorizes
the mutation. Existing note, capture, origin and retention-revocation authority
cannot substitute for it. The operation derives affected evidence from retained
native data; the caller cannot supply a smaller claim list. Ordinary source edits
preserve approved historical content and do not revoke retention rights.

Inventory all applicable retained copies within the exact supported source frame,
using each copy's own native post ID, version and selector position. A bounded
inventory that cannot establish complete usable coverage returns a hold. In one
guarded transaction, pin that inventory and current source/authorization heads,
append the change audit and monotonic post watermark, invalidate the affected
evidence and recursive claim/decision closure, and advance invalidation state.
New writes must also reject stale support; invalidating existing rows alone is
insufficient. Source-revision, configuration, generation and qualification
continuity changes remain explicit holds; no cross-frame cleanup is qualified.
The initial inventory limits are 128 captures and 4 MiB of usable representation
content. Retained history can eventually exceed them; the operation then holds
without partial mutation. These are implementation bounds, not qualified recurring
operating capacity. Revisit the indexing/cleanup design before a workload needs
larger histories, and carry a failed refresh into the later visibility integration
instead of reporting renewed current truth.

The available native binding path uses genuine WP07 page receipts. A usable
qualification sample containing the selected post but lacking such a receipt
therefore holds the operation, even when no evidence currently uses that sample.
The positive fixture qualifies its source separately without a selected native
post in the sample. This is an explicit operational limit; a later qualified
capture-binding path must not fabricate a page receipt to bypass it.

Operator capability authenticity/revocation remains the existing trusted-resolver
boundary. SQL must check its local action, request binding and expiry through the
last transaction statement; this increment supplies no external operator-identity
or revocation store. Actual authorization integration remains held.
An idempotent acknowledgement records the original committed operation; it does
not renew source truth, prove a later frame current, or make invalidated evidence
usable again.

The evidence method is actual local D1 testing with fictional authority and
retained synthetic responses. Inspect committed rows, read usability, append
results, audit history and transaction rollback. A mock batch loop cannot prove
atomicity. Planned checks are not executed results:

| Check | Required observation |
| --- | --- |
| Same post on two installations/topics | Only the exact authenticated binding is affected. |
| Post-array reorder and JSON-pointer boundaries | Select by native identity using each representation's own position; unrelated exact-post evidence remains usable. |
| Enclosing/root selectors and ambiguous text spans | Conservatively suppress stale support and report that scope explicitly. |
| V1 and V2 claims followed by a V2-to-V3 observation | All covered older support invalidates; approved historical bodies remain present. |
| New evidence ID on an old copy, including a later capture of older bytes | The write is rejected rather than resurrecting support. |
| Replay, reversed observations and nonadvanced native version | Exact replay remains idempotent under current authority; conflicting/stale input writes nothing. |
| New capture, erasure, source/control withdrawal or capability expiry during commit | The transaction detects the changed dependency and rolls back completely. |
| Failure at the last statement | No watermark, audit, invalidation, epoch or operation acknowledgement commits. |
| Missing/private post or failed source request | No inferred deletion or unsupported invalidation. |
| Existing evidence/registry/provider and catalog-bridge contracts | The prior guards continue to pass and no public/admission bridge opens. |

Sol owns implementation, Terra prepares independent D1 cases and source findings,
Astra challenges the design and final code, and the orchestrator controls shared
interfaces, migration numbering, integration checks and acceptance. Actual rights,
trust, human review, source coverage and public behavior remain separate gates.

## Recorded local qualification

Code `a60ba78179cc8b6be904bf606f10cf178bb64ed2` passed 1,407 executed tests (939 application, 146 Watch, 322 discovery), seven PDF regressions, build, local smoke, online audit with zero reported vulnerabilities, and secret scan on 619 stable runtime inputs. The six new normal groups are part of that count. Astra independently passed ten D1 groups; Terra passed four groups and a separate installation-isolation experiment. These overlap integration coverage and are not summed as unique tests.

The first full run exposed the stale application schema stamp; changing 0044 to 0045 restored the existing migration-version check. The failed run is retained. Independent review also reproduced and corrected a cross-source-revision evidence-write gap before integration. [The receipt](receipts/WP12-edit-invalidation-progress.json) binds actual inputs, outcomes and remaining holds. Delivered-head CI is tracked on PR30.
