# Incident delivery and fresh recovery evidence

This local successor is based on the independently accepted PR25 tree a90e0468f493b2c3b71682e30c7ac50b0adbb6e7. It is not deployed. It changes alert delivery identity and recovery qualification, without collector, source registry, schema, retention, notification cadence, or access changes.

## Measured production baseline

Read-only baseline 2026-10-06T19:09:50.016854Z has 17 durable fingerprint rows and three open groups: leadership blocked/critical (444 condition evaluations, 21 notification attempts, next slot 2026-10-06T23:35:15.591Z); Cooper fallback degraded/warning (one evaluation, zero attempts); model-enrichment degraded/warning (one evaluation, zero attempts). Leadership last evaluation was 19:03:26.805Z. Counts are current incident counters, not lifetime send history, source fetches, or inbox receipt. Cooper changed from resolved to open during a natural production cycle; its warning remains digest-only.

Existing D1 fingerprint identity and atomic claims already prevent simultaneous notification-slot claims. Immediate sustained-incident reminders run once after six hours, then at most daily. Related digest rows already group by subsystem/institution. The observed repeated leadership notices are consistent with a sustained source qualification incident and scheduled reminders; counters cannot establish every historical email cause. Retained source replay demonstrated incomplete parsing, and natural leadership attempts remain held until October 8. No private inbox was read or email sent during this work.

## Reproduced gaps and changes

Four regression probes failed on the released tree:

1. Three concurrent deliveries of one failed run advanced a three-condition threshold.
2. A later run carrying the same source checkedAt advanced recovery twice.
3. A repeated healthy receipt without runId used delivery time as a new recovery identity.
4. Different IDs at the same healthy evidence timestamp advanced recovery twice.

Failure recording now accepts a bounded internal observationId and stores it first in sanitized detail JSON. An atomic conflict guard prevents the same retained observation from incrementing the failure threshold, resetting recovery, or claiming mail. Older observations remain excluded by the existing monotonic evidence guards. Automation uses durable runId, or stable completion time for legacy results. Callers without this optional identity retain their existing interface. This is bounded latest-observation deduplication, not an unbounded delivery history.

Recovery uses the actual source observation timestamp when available, falls back to bounded completion time for legacy receipts, and requires strictly newer healthy evidence than the preceding recovery observation. Primary fallback recovery carries the same source freshness details. Equal-time failures still win; two genuinely fresh checks still resolve; a new true outage reopens and notifies at its threshold. Notification cadence and grouped digests are unchanged.

The prior stale-run test expected a later completion timestamp to qualify old pre-failure source evidence. It now explicitly rejects that evidence and verifies a newly collected check can advance recovery. This strengthens the freshness requirement.

## Verification and pending release

Four before-change failures are retained in /workspace/tmp/builderbob/tvd-alert-lifecycle-20261006/replay-before.log. Initial after-change focused checks: 87 pass. Independent review rejected 9691235 after finding residual invalid/future source timestamps, unidentified legacy receipt replay, and interleaved equal-time failure IDs. Rejection report SHA256: 083cfe4489e921ff2e640a8135fdb8cadcc79d4bfa32a001e21b8f79bc7a8bb4.

The successor rejects explicitly invalid/future source timestamps. Recovery requires a stable internal run ID, valid completion time, or valid source observation timestamp; missing all three cannot manufacture a check from delivery time. Equal-time identified failure conditions retain their count rather than adding threshold evidence, while newer failures and equal-time failure dominance remain intact. Five older synthetic normal-recovery fixtures now provide explicit completion receipts; their assertions remain unchanged. Historical first_seen_at can predate reopening and is not used to infer uninterrupted incident duration.

Successor focused checks, including all Cloudflare operational tests: 150 pass. Full npm test, build, secret scan and Ops smoke pass; exact counts/hashes are recorded in required-checks.json in the same artifact directory. Independent review is required before any release. No production mail, source fetch, hold reset, migration or deployment occurred.

Authenticated Ops remains blocked at owner-session acquisition: this execution exposes no authorized owner browser session. Provider CLI authorization does not authorize Ops. Existing Cloudflare Access was not changed and no credentials were generated or extracted.

A second independent review rejected 59a1408 for malformed/future finishedAt with otherwise valid run IDs. The final successor also rejects explicitly invalid/future completion clocks before any recovery update; run identity cannot substitute for a declared bad clock. Missing completion time with a stable run ID remains supported, as do valid source-only and completion-only legacy receipts. Targeted before-change failure is retained in completion-clock-before.log. Second rejection report SHA256: 8d8d14bbc9e2505382ce4c394d3173c65af4da6a1c6d12cd56bd65557894512d.
