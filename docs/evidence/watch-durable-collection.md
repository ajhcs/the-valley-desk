# Durable Watch Collection

Implemented 2026-09-12. This is ingestion implementation, not a source-qualification
or public-launch approval. Migration 0031 is additive. No production source was
enrolled, activated, fetched, or published by this work.

## Operating Boundary

`runWatchCollection(db,{enabled:true})` executes real durable collection, without
model or public-write capabilities. It is not wired into the production schedule.
Maximum 8 due sources, 4 pages per source, 90 seconds per invocation, 12 seconds per
request, and 1 second per-host pacing. One database lease excludes concurrent runs;
due-time sorting prevents a continually failing source monopolizing dispatch.
Failures retain typed outcomes, exponential backoff (maximum 7 days), Retry-After,
last success and existing checkpoints. Credentials are intentionally not resolved;
authenticated sources stay misconfigured until a separately qualified resolver.

Sources resolve only from database configuration, a current configuration-bound
qualification receipt, existing named review authority, and separate activation.
The writer atomically updates source configuration, source-permission dependency
history/head, and expiration. Revocation uses `revokeWatchCollectionReview`;
deactivation uses `configureWatchCollectionSource` with null activation ID.
These are internal operator operations, not public request contracts. A model,
parser fixture, or source-provided JSON cannot create an accepted review row.

## Retention and Replay

Exact bounded bytes and strict UTF-8 decoding are retained before observation
acknowledgments. Representation and observation rows are immutable; repeated
fetches preserve firstSeenAt independently of write time. Page receipts include
empty pages and are stored in the same atomic batch. Only durable, successful,
nontruncated, ordered terminal page chains advance a discovery checkpoint.
Rolling RSS/Atom checkpoints never claim a complete active inventory, and no
missing item authorizes withdrawal. Partial pages remain durable for replay from
the enrolled first endpoint; this implementation does not claim resumable cursors
for an unqualified full-inventory service.

Conditional RSS/Atom and repository responses reuse only a retained successful
representation with matching config. Bare 304 fails. GitHub list 304 is held:
pagination headers must be freshly observed rather than inferred from a missing
Link header. Redirects and pagination require exact enrolled endpoints, not just
a matching host. GitHub endpoint order is repository metadata first, then optional
release/tag/commit list; metadata is persisted before the list binding is used.
Numeric repository identity is checked on refresh; alias reuse is held.

`resolveWatchCollectionEvidence(db,observationIds,now)` supplies integrity-checked
StoredObservation records, enrolledSourceIds, sourcePermissionDigests,
sourceRevisions, sourceUrlAllowed, publicUrlAllowed and acceptanceGuards.
Execute acceptanceGuards(decisionId) in the same D1 batch as first editorial
acceptance; its CHECK-backed inserts recheck source configuration, named review,
permission head and expiration, rolling back the entire batch after a race.
Normalized text is the
exact decoded representation, version `watch-utf8-v1`, not lossy HTML flattening.
Only exact enrolled response URLs qualify evidence; public citations additionally
use enrolled link scopes. The delivery reader must enforce
`watch_dependency_expirations` at read time (root integration owns that change).

## Local Execution

Node 22+ with the repository's installed tsx; mounted scratch only. Run through
`/home/plumbob/bin/with-dev-storage` to verify storage before executing these commands:

```sh
node --import tsx/esm scripts/collect-watch-local.mjs --db /mnt/d/tmp/plumbob/watch-local.sqlite --init-local
node --import tsx/esm scripts/collect-watch-local.mjs --db /mnt/d/tmp/plumbob/watch-local.sqlite
node --import tsx/esm scripts/collect-watch-local.mjs --db /mnt/d/tmp/plumbob/watch-local.sqlite --check-source SOURCE_ID
node --import tsx/esm scripts/collect-watch-local.mjs --db /mnt/d/tmp/plumbob/watch-local.sqlite --collect-public
```

Initialization creates no enrollment or approvals. Import real qualification
records only through the internal authenticated operator workflow after reviewing
their samples/rights/access evidence. The explicit collect flag may contact public
endpoints and writes only the named disposable local database. No D1 remote CLI,
Cloudflare account credentials, or model credentials are used.

## Remaining Qualification

Actual federal/PA/NJ/DE/county source receipts and operator review records, PA ZIP
and NJ Access batch tooling/host qualification, full inventory cursors, official
JSON/HTML parsers, credential provisioning, source load/freshness observation and
production schedule activation remain separate. This module does not silently
treat those source families as completed. Synthetic regression data proves
mechanics, not current source access, rights, coverage or editorial acceptance.

## Verification

The final focused and adjacent regression run passed 110 tests, including 18 new
SQLite integration cases. It covers byte retention, replay/304, qualification
drift and revocation, permission-head rollback, partial/empty terminal pages,
due-order dispatch, backoff, redirects, GitHub binding, lease replacement and
first-acceptance races. The production build and secret scan passed; the existing
frontend chunk-size warning remains. The disposable local CLI initialization and
empty status path were executed successfully. No full application release gate,
live source qualification, model run or production deployment is claimed.

```sh
node --import tsx/esm --test test/watch-collection.test.ts test/watch-adapters.test.ts test/watch-contracts.test.ts test/watch-delivery.test.ts
npm run build
npm run secret-scan
```
