# Accepted Watch Updates Backend Qualification

Date: 2026-09-12. Local-only engineering qualification; not production approval.

## Contract

- `readWatchUpdates(db, {kind, cursor?, limit?}, now?)` returns the shared `watch-updates-1` schema.
- `handleWatchUpdatesRead(request, env)` serves GET/HEAD at `/api/v2/watch/{policy|technology}/updates`.
- Parent must wire this route before the generic subject-detail route and enroll the new test in its aggregate test command.
- Only cursor and limit are supported. Other filters fail with 400; the UI hides directory filters on Latest.
- Existing public enablement flag and database binding apply. Responses are no-store; errors never include SQL or private review payloads.

## Authority and Chronology

The query reads accepted public revisions, not policy capture or technology draft ledgers. Generation validity, tombstones, manifest bindings, required groups, evidence dependency heads, and regional eligibility are checked before source-date ordering and LIMIT.

Repeated manifest groups are mapped by their field ordinal to the accepted public fact. Timeline/latest-action duplicates share one item identity per subject. Only explicit day/instant source dates at or before the request clock enter Latest. A day remains a day; it is not converted into a fictitious UTC timestamp. Sorting compares source values descending, with subject and native item IDs as stable tie breakers. Instants sort before day-only observations within the same date; this is a deterministic presentation convention, not an inferred time for the day-only event.

Technology accepts only public release, paper, dataset, and product artifacts with accepted dates. Repository baselines, indexing times, documentation, unknown dates, and future events do not appear. Current source metadata or recent checking alone never creates an update.

Every returned row is re-parsed, payload/manifest checksummed, and shaped through the existing delivery validator. Date evidence must be present in the item's citations. A cursor pins the public generation but never preserves withdrawn or no-longer-current evidence.

## Bounds and Tests

SQL returns at most limit + 1 candidate rows, with a 2.4 MB conservative payload/manifest budget and bodyless lookahead. The emitted response is capped below the shared 1 MB limit; a short page's cursor advances only through emitted items. A single oversized row fails closed.

Focused tests cover accepted-only empty reads, source-date ordering, real timeline/latest deduplication, current evidence holds before LIMIT, withdrawals, cursor kind binding and expiry, accepted dated technology, undated baseline exclusion, future policy/release exclusion, revoked regional evidence, method/query validation and HEAD behavior. The accepted query also runs against real local D1 after the full available migration chain.

All approvals in tests are explicitly synthetic fixture authority. No production rows, approvals, permissions, representatives, scheduled source jobs, or external model calls are created by this slice.

## Remaining Operational Work

Parent route integration, aggregate tests and release gate remain required. Large-corpus query-plan/load qualification is not claimed: current code bounds transferred bytes, not total database scan cost for sorting JSON-derived event dates. A future accepted-development index may improve scaling but must preserve the same live dependency checks before pagination.
