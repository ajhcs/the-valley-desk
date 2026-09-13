# Watch Updates Local Scale Qualification

## Scope and Reproduction

Run from a bootstrapped repository worktree:

```sh
node --import tsx --test test/watch-updates-scale.test.ts
```

This is an offline SQLite regression/measurement fixture. It is not a source
qualification, editorial acceptance, model evaluation, or Cloudflare load test.
All titles, approvals, source authority, and retained evidence are synthetic.
No implementation, migration, configuration, production data, or network calls
are changed by this task. The in-memory database closes at test completion.

The benchmark uses the real projection compiler, accepted-delivery staging,
publication persistence, dependency revision writer, and `readWatchUpdates`.
It creates 1,000 distinct policy subjects with separately bound action evidence,
100 invalidation/restoration histories, then 60 additional current invalidations.
The resulting database has 1,000 public revisions and 15,268 dependency records.
It captures the actual read SQL query plan without maintaining a copied query.

## Observed Result

Successful run on 2026-09-13, baseline
`a4836fbc430e71192f48b8ab2878dc483b5b7630`:

| Measurement | Result |
| --- | --- |
| Synthetic seed time | 31.0 seconds |
| First three cursor pages, requested limit 50 | 28 items per page |
| First three response sizes | 18,684 / 18,694 / 18,694 bytes |
| End-to-end page elapsed times | 436.6 / 452.9 / 438.8 ms |
| First page SQL elapsed time | 301.7 ms |
| Second page SQL elapsed time | 322.6 ms |
| Invalidated-prefix limit-1 SQL elapsed time | 345.2 ms |
| Invalidated-prefix result | `scale-policy-0060`, with continuation cursor |
| Test outcome | Passed, 32.8 seconds test duration |

These are individual local elapsed-time samples, not percentiles or service
objectives. The SQL timer excludes EXPLAIN; the end-to-end timer includes the
instrumented EXPLAIN call as well as hashing, parsing, and shaping. The test
prints runtime versions, timings, row counts, and a full first-page query plan
on each run. No timing threshold is asserted because host contention varies.

The 28-item page is expected: the existing 2.4 MB conservative query-body
budget includes full payloads/manifests and overhead, even though the final
Updates JSON is much smaller. A continuation cursor is required and verified.
Output rows never exceed the requested limit plus one. Sixty invalidated
leading subjects do not consume LIMIT or hide the next eligible update.

## Bottleneck and Remaining Qualification

The plan uses `watch_directory_page` to find the requested kind and primary-key
indexes for manifests, heads, expirations, and tombstones. It also materializes
`facts`, `dated`, `unique_items`, `eligible`, and `budgeted`, repeatedly scans
JSON group/dependency virtual tables, and uses temporary B-trees for ordering.
The current implementation bounds returned bodies, not total examined facts.
Cursor pages still perform per-kind eligibility work before applying position
and LIMIT. This is the principal scale risk; adding an unrelated ordinary
index would not remove JSON extraction and dependency checks.

No query refactor or index has been silently applied. Before declaring broad
traffic capacity, measure actual D1 rows-read/duration and Worker CPU under
concurrency with representative technology artifact multiplicity, large policy
timelines, closed public revisions, and near-limit payload sizes. This fixture
contains one dated action per policy subject and dependency history, not those
worst-case distributions. Local SQLite does not expose D1 billable rows-read;
EXPLAIN estimates are not substituted for that metric.

A separately reviewed optimization could introduce an accepted, manifest-bound
dated-item index maintained atomically with publication. It must preserve
current dependency/expiry/tombstone filtering before LIMIT and snapshot cursor
semantics. This report is evidence for that decision, not authorization to
weaken any publication or read gate.
