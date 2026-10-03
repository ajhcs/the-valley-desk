# St. Luke's leadership source: bounded read-only audit

Source: `src-st-lukes-leadership`. Institution: St. Luke's University Health Network; this is an explicit edge system in the existing coverage pack.

## Historical evidence supplied by the parent

The parent relayed an October 1, 2026 21:34 UTC timeout alert for this source, with four successes and one failure in the same run, and a next scheduled retry of October 2, 2026 03:31 UTC. This relay has not been independently re-read from the alert store. It describes one source failure, not failure of every source or loss of all institutional coverage.

## Current observation result

Recovery is **unverified** in this audit. A due retry timestamp is not proof that a retry ran, succeeded, or failed. No current post-due source receipt was found in the examined BuilderBob release/diagnostic artifacts or established Plumbob diagnostic paths. The existing BuilderBob-to-Plumbob connection and production operations note were read; that note records historical release/runtime evidence, not a current St. Luke's retry observation. An authorized current protected-state readback was not available through the examined evidence/configuration paths. No credentials or account settings were changed to obtain one.

No St. Luke's leadership-page request, forced cron, alternate page request, schedule reset, state write, copied collector, tail watcher or duplicate poller was started. No all-institution incident or current targeted repair is asserted.

The existing monitor derives due status from `scheduled_source_state.next_attempt_at`, retains `last_success_at` on failed attempts and backs failures off. Its durable state and captured snapshots are authoritative for this question. See the accompanying [source-specific SELECTs](st-lukes-source-audit.sql), prepared against migration 0012 and the existing executive persistence code. These SELECTs have not been run against production by this workstream.

## Acceptance for the parent's existing authorized diagnostic reader

- Read the single durable schedule row and at most the ten latest snapshots for the exact source ID. Keep observation time, source attempt time, last success and next retry distinct.
- A post-due `healthy`/`unchanged` schedule receipt with a matching successful/unchanged complete extraction supports recovery. The scheduled row is necessary because a fetched snapshot can still fail completeness checks.
- A post-due failed/blocked/timed-out or incomplete receipt supports a source-specific investigation. Preserve the retained successful snapshot and deterministic affiliation/departure safeguards; inspect failure details before changing timeout, parser or fallback configuration.
- No post-due attempt leaves this as pending/unobserved, not a new failure and not recovery. A new alert alone is likewise not a substitute for the exact source receipt.
- Keep the other four successful checks and any recent successful coverage from independent registered sources separate. Do not infer institution-wide outage, departures, empty leadership, or a missing public person from this timeout.

This audit adds review evidence only. The regional implementation and its 29 new tests/96 existing ingestion regressions remain independent of this pending operational readback.
