# Baseline social test clock repair — Sol

Status: implemented and targeted tests pass; root review pending.

## Failure and diagnosis

The original full baseline log is
`.discovery-work/evidence/baseline-tests.log`: 936 tests, 928 passed, eight failed.
All eight failures belong to `test/social-evidence.test.ts`, where valid-intake
assertions expected 202 but received 422.

Before editing, the assigned targeted command reproduced 17 tests, nine passing
and eight failing. Its unchanged output remains at
`.discovery-work/social-tests/before.log`. A separate scratch probe used the same
packet and the actual `handleSocialEvidence` handler with a database that would
throw on any persistence attempt. At `2026-11-14T00:05:57.897Z`, it returned
`422 {"error":"observed_at_invalid"}` with zero database calls. The probe and
result remain at `diagnose.mjs` and `diagnosis.json` in the same scratch directory.

The fixture observation is `2026-08-28T12:05:00.000Z`. Production
`validatePacketSemantics` correctly rejects observations older than 60 days from
the intake clock. Eight tests used the real clock; two neighboring automation
tests already used Node's Date mock at `2026-08-28T13:00:00.000Z`. Thus this is a
time-dependent baseline test defect, not evidence that the intake gate needs
relaxation.

## Change

Only `test/social-evidence.test.ts` changed among application/test sources. A
`beforeEach` hook uses each test context's existing Date-mock facility at the
shared fixture instant. The two redundant per-test Date-mock enables were removed.
Node resets each context's mock automatically. Authentication, packet contents,
review, deduplication, two-pass publication, quarantine and role assertions remain
unchanged.

One additional test exercises the actual intake handler with six timestamp cases:
observed at exactly 60 days old succeeds, one millisecond older fails; observed
at exactly ten minutes ahead succeeds, one millisecond later fails; posted at
exactly one day ahead succeeds, one millisecond later fails. Rejections assert
the precise error and zero persisted packet rows. Each case uses a fresh in-memory
SQLite database. Production source, timestamps and validity thresholds did not
change; no API clock-injection change is needed.

## Validation

Both targeted runs used Node 22.23.2, `env -i`, the existing HOME, USER
`builderbob`, LANG `C.UTF-8`, the explicit Node 22 PATH, task-owned TMPDIR and XDG
cache/config paths, and `WRANGLER_SEND_METRICS=false`:

```sh
node --import tsx/esm --test test/social-evidence.test.ts
```

The repaired run passed all 18 tests, with zero failures or skips. Output remains
at `.discovery-work/social-tests/after.log`. The run made no real provider calls;
automation, model and Worker scheduled tests retain their injected mock fetches
and synthetic state. This targeted pass does not claim a full-suite, build, CI,
provider, production or discovery acceptance result. Root owns independent review
and the next required complete baseline check.
