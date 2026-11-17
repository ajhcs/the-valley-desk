# WP12 edit invalidation — independent review

The reviewed increment passes independent review within its declared private,
edit-only scope. Ten independent actual-D1 test groups passed with zero failures
or skips. The orchestrator's completed local qualification is recorded in the
[progress receipt](../receipts/WP12-edit-invalidation-progress.json). This is not
full AC-WP12-06 or WP12 acceptance.

The [implementation plan](../wp12-edit-invalidation-plan.md) preserves the
distinction between invalidating existing support and creating admission or
publication authority. The consumer accepts retained receipt references and a
native post identity, reconstructs the affected support, and requires the new
`invalidate-source-support` capability. A caller cannot supply a smaller list of
claims. The existing catalog bridge restrictions remain in place; the migration
adds no admission or public projection path.

## Findings addressed before this review

Processing V2→V3 must cover V1-backed support too. The implementation now
inventories retained WP06 captures for the source, including captures without
collection-page acknowledgements, within its 128-capture and 4-MiB usable-content
bounds. It resolves each older copy's native post position separately, derives
matching evidence roots in SQL, and invalidates their recursive dependents in the
same transaction. Enclosing selectors and ambiguous text spans are conservative
matches. Future writes consult the watermark so that a new evidence ID or a later
capture of old bytes cannot restore stale support.

The independent review reproduced a concrete frame gap: after a revision-1
watermark, a genuine WP06 capture under source revision 2 with unchanged
configuration and material controls could create new evidence. The pre-fix test
failed because the expected rejection did not occur. The corrected guard checks
the capture's actual source revision, installation, scope and configuration, plus
the source head's generation and qualification. Both the original reproduction
and the passing regression are retained.

Other corrections bind resolver receipt identity and native update time to the
retained data, use the immutable representation's capture timestamp rather than
page settlement time, detect new evidence on an otherwise unmapped capture, and
recheck local capability and source-frame conditions at the final transaction
statement. A native version, timestamp or caller flag alone is not mutation
authority.

## Independent executed checks

The private suite exercised ten groups against actual local D1 transactions:

1. V1/V2 support followed by V2→V3, reordered post arrays, RFC6901 index/escape
   negatives, replay/conflicting requests, preserved unrelated posts and another
   installation, and rejected old-copy/later-copy reuse.
2. A requested current version older than retained history, and conflicting
   content at one native version: both hold without writes.
3. Source deactivation during the composed completion checks: full rollback.
4. Input/context mutation across an awaited resolver and a wrong capability
   action: detached inputs and denied privilege substitution.
5. Capability expiry after operation insertion: the final guard rolls back.
6. Evidence added to an unmapped capture between inventory and commit: explicit
   hold without partial cleanup.
7. A retained native qualification capture without a WP07 page receipt: explicit
   coverage hold, with existing support left unchanged.
8. A genuine new source revision with unchanged configuration: no use of the old
   watermark to admit new support.
9. Deactivation/reactivation followed by two fresh same-revision captures: no
   silent migration of the watermark into the new generation.
10. A same-version capture with reordered JSON object keys: different raw bytes
    retain equal canonical post identity and valid support remains usable.

These tests establish the exercised private behavior, not provider compatibility,
real authorization or complete public currentness. The normal lifecycle suite
also exercises the evidence→claim→decision closure; full-suite results are
recorded separately by the orchestrator.

Private evidence is under `.discovery-work/wp12-edit/astra/`. The stable runs are
`final-probes.log` (8/8) and `frame-extras.log` (2/2).
`final-input-sha256.json` binds the tested implementation; `review-result.json`
records results and artifact hashes. Earlier harness mistakes and the reproduced
source-frame failure are retained separately and are not passing evidence.

The reviewed store SHA-256 is
`e9f12f31adfe9c30c3e2d7b723e6685c3f534ca3a1147009461bd17f2c147c1d`;
the migration SHA-256 is
`eccbd341c0cf15b9e47781d740e5c54588321e03cad041d9306747effa12622d`.
All five executable implementation/migration files remained unchanged after the
independent run. The schema module's subsequent `z.infer`→`z.input` alias change
was independently reconciled by reversing that single erased TypeScript change
and recovering the tested file hash. Its current SHA-256 is
`92247c2ddec4153b8555d91984390e7eb5fcb54f881bc12140a0425fa908fde5`.
The strict operation schema has no defaults or transforms that make its input
and output types differ. Compile-only examples cover omitted context defaults,
invalid string post IDs and disallowed editorial actions.

## Remaining boundaries

A genuine topic qualification sample can contain the selected post without a
WP07 page receipt. Such a sample holds this consumer even when no evidence uses
it yet. Positive fixtures qualify the source with a separate sample that contains
no selected native post. Consequently, edits to posts already present in a real
topic qualification sample are not established as operationally supported. A
future reviewed capture-binding path must resolve this without fabricating a
page receipt or omitting retained history.

Source revision, configuration, generation or qualification changes do not imply
continuity and cannot automatically reset the watermark. Broader propagation of
source controls into admission and public visibility remains gated on WP14/WP16.
The trusted capability resolver still owns real operator authenticity and
revocation. SQL checks local action, request binding and expiry; it does not
create an external identity or revocation store.

Native deletion/private transitions, actual installation qualification, rights,
source enrollment, independent human review, corpus freeze and deployment remain
held. The corrected [institutional lead note](../qualification/institutional-expansion-20261116.md)
accurately separates rendered leads, retrospective robots observations, rights
uncertainty and raw-format limits. No candidate qualified and no native target
body was added by that investigation.

The first full integration run executed 939 application tests with one schema
stamp mismatch: the new migration was 0045 while `SCHEMA_VERSION` remained 0044.
The reviewed correction changes only that constant to 0045, matching the latest
migration; it does not weaken the test. The failed run is retained at
`.discovery-work/wp12-edit/root/tests-final.log`. The restarted qualification under
`.discovery-work/wp12-edit/root/final/` passed 1,407 tests, seven PDF regressions,
build, local smoke, zero-advisory audit and secret scan. Final metadata review
verified the receipt's 32 referenced hashes, all 619 unchanged runtime inputs,
all 91 frozen entries, three unchanged native files, the empty `not_frozen`
reference manifest and unchanged package acceptance states. The source index
remains at 16 acquisition records and 14 distinct bodies. The institutional lead
note now explicitly records development exposure without held-out credit.
