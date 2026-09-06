# Policy detail audit validation — 2026-09-06

Target: deployed schema `0027`. Investigation remained read-only.

## Schema contract

Code and migration inspection established:

- `discovered_at` is set on insert and is not overwritten on conflict: first listing discovery.
- `last_seen_at` is updated on conflict: latest listing observation.
- detail hydration sets `detail_fetched_at` at the start of success, failed, blocked, or hostile attempts; persistence retains the latest supplied value.
- there is no detail-attempt history table and no first-attempt column. The first detail-attempt timestamp is unavailable and the audit returns it as `NULL`.

The repaired `policy-detail-failure-audit.sql` uses those schema-0027 columns. Its first query contains only active failed/blocked rows. Its second query contains active failures and filtered reconciliation rows, including disposition reason.

## Representative migrated database

`test/policy-detail-audit.test.ts` applies every migration through 0027 to an in-memory SQLite database, seeds one active and one filtered policy failure, executes both SQL statements verbatim, and checks timestamp aliases, the unavailable first-attempt value, retry state, disposition, and reason. Focused run: pass.

## Read-only production cross-check

Both statements executed successfully against production D1. The returned metadata for the individually executed SELECTs was `changes=0`, `changed_db=false`, and `rows_written=0`.

Current active population at the check:

| Source | Cause | Rows |
| --- | --- | ---: |
| `ofs-cms-newsroom` | redirect left allowlist | 13 |
| `ofs-ncsl-ai-legislation` | response exceeded 524,288 bytes | 2 |
| `ofs-nj-health` | detail redirect changed host | 1 |
| `ofs-onc-news` | response exceeded 524,288 bytes | 1 |

Current filtered population: 15 rows—7 CMS, 4 Delaware newsroom, 3 New Jersey health, and 1 New Jersey notices—with `outside-registered-policy-path` and no retry for the known filtered rows. The row-level result contained all 17 active plus 15 filtered rows and returned `first_detail_attempt_at=NULL` throughout. Counts are observational, not release constants; future collection can add or recover failures.

This issue is **implemented locally** and **verified in production read-only**. No D1 mutation, migration, retry reset, or backfill was performed.
