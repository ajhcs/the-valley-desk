# Watch Implementation Base

Recorded 2026-09-12. Local implementation evidence, not a deployment receipt.

## Authority and Isolation

The user authorized executing the blueprint with subagents and pausing when usage
resets to 100%. The read-only usage service has repeatedly timed out; reset
state is unavailable, not zero. No additional credits were purchased.
Root checks at work checkpoints and must stop agents on a confirmed reset or
user pause. At 05:16 UTC root also set a conservative latest stop of 06:10 UTC
because the reset time remained unavailable. This is a local stop boundary, not
evidence that the account has reset. Live ingestion, paid evaluation, migration, and deployment remain
separately gated as stated in the blueprint.

The original run was interrupted by a usage-limit approval failure before final
integration. At 13:14 UTC the user resumed work and explicitly authorized
appropriate testing, pushes, merges, and production deployment. The old time
boundary no longer applies. A qualified foundation release keeps public Watch
and policy-background exposure disabled; it does not waive source, model,
editorial, or operator qualification. See the implementation checkpoint for the
resumed release status and current remote-main reconciliation.

Implementation worktree: `/mnt/d/worktrees/plumbob/tvd-watch-implementation`.
Branch: `codex/tvd-watch-implementation`. Worktree-bootstrap task:
`tvd-watch-implementation`. Each writer command runs under its verified lock.
Subagents have their own bootstrapped worktrees and branches; root reviews and
integrates their bounded commits. There are no shared node_modules symlinks.

## Reconciled History

| Commit | Tree | Disposition |
| --- | --- | --- |
| `29e6a4e32fbccf79127815768bc322f0c3eb22fe` | `5dc9b63215996c52f83b230d8fdbd3462ba3da82` | Original planning checkout |
| `e0d03be90497cab70f1f35edb3e938bf4e587025` | `8f29e43292c249e9c75b2142a90d9b4f2e438e54` | Last recorded production build, seven commits after planning checkout |
| `23972f4c04bd2cd891d11488c1580a14b9e14875` | `8664de58c515276b119c78789a304c1051134513` | Exact selected base, two additional staged commits |

All three commits are on one linear ancestry. No conflicting branch merge or
lost production fix was needed. The selected base includes PA printer/action
corrections, relevance validation/retry capacity, slug preservation/repair,
upstream diagnostics, and staged checksum-bound PDF review/background work.

Selected migration head: `0028`. New additive migrations start after it. The
existing v1 policy enum includes `floor-action`; the compatibility freeze uses
this reconciled schema rather than the older planning checkout.

Original untracked instructions, coordination files and planning artifacts were
not cleaned or reverted. The research plan and blueprint were copied unchanged
into this implementation worktree. Other task files were not copied or committed.

## Baseline Verification

Environment: host Node 24.14.0, locked npm dependencies, separately installed
existing hash-locked Python PDF dependencies inside this worktree.

| Check | Observed result |
| --- | --- |
| Initial `npm test` | 372/375, three missing-PDF-runtime failures |
| After declared PDF bootstrap | 373/375, two wall-clock-dependent social tests failed |
| Fixture-clock correction | 375/375 passed; no production freshness change |
| `npm run build` | Passed; existing large client-chunk warning remains |
| `npm run ops:smoke` | Passed local D1 migration and mocked scheduled processing |
| `npm run secret-scan` | Passed, 259 enumerated tracked/untracked files before new Watch files |
| `npm audit --json` | Failed: three existing high advisories, Sharp -> Miniflare -> Wrangler |

The two social tests use August 28 fixture observations and had exceeded the
14-day intake window on September 12. Their test-local Date clock is now pinned
to the fixture date. Real timers and production freshness checks are unchanged.
The PDF integration suite passed after its declared bootstrap; no source PDFs
were downloaded during verification.

Baseline logs are under `/mnt/d/tmp/plumbob/`:
`tvd-watch-baseline-tests.log`, `tvd-watch-baseline-clock-fixed.log`, and
`tvd-watch-baseline-smoke.log`. Node 22 CI and final exact-candidate qualification
remain outstanding. The dependency advisory is a release hold, not concealed by
the passing functional checks.

## Local Follow-Up Verification

At 05:18 UTC, the first integrated explicit suite passed **582/582** tests,
including the real local D1 harness. The subsequent Watch UI integration and
delivery/routing work require fresh final checks; this result is not attributed
to later edits. Logs: `tvd-watch-integrated-tests-20260912.log` and
`tvd-watch-integrated-smoke-20260912.log` in mounted task scratch. The updated
local operations smoke passed at 05:21 UTC.

The existing advisory chain was addressed locally by updating Wrangler from
4.125.0 to published 4.131.1. Its locked Miniflare version is
5.20260911.0-alpha (the prior lock already used the Miniflare 5 alpha line),
Workerd is 1.20260911.1, and Sharp is 0.35.4. No other direct dependency was
upgraded. Lock changes are confined to that toolchain and its platform-specific
Sharp/libvips/Workerd packages. The install reported zero vulnerabilities; final
audit remains part of the integrated qualification. No global CLI, production
runtime configuration, compatibility date, or experimental feature was enabled.

Source checks: the [Sharp advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c)
identifies 0.35.4 as patched; [Wrangler 4.131.1 release](https://github.com/cloudflare/workers-sdk/releases/tag/wrangler%404.131.1)
and npm metadata identify the actual selected release. An initial metadata
probe for 4.130.1 returned404; that nonexistent version was never installed.

The new D1 test uses a dedicated synthetic configuration, `persist:false`,
`remoteBindings:false`, no environment files or account ID, and an all-zero
synthetic database ID. It checks migration/foreign keys, final-write rollback,
input races, exact replay and competing-review concurrency, generation-pinned
pagination, live withdrawal overrides, and indexed directory ordering. Wrangler's
locked test-only SQL splitter preserves trigger bodies. This verifies the local
D1 emulator, not distributed production concurrency or production data migration.

## Operational Holds

Production state was not freshly read back. The September 7 note records build
`e0d03be`, schema `0027`, Worker `29af8da5-807f-412d-a019-ac9d34e4ac0a` after the
social credential rotation. Staged `23972f4`/`0028` remain undeployed. No secrets,
provider account policy, model defaults, schedules, source activation, publication
decisions, production data, or deployment have changed in W00.

Preserve the historical 8,239.929-second policy disposition miss. A quiet source
or zero new samples does not demonstrate recovery. Existing PDF interpretation
holds, source qualification, tri-state county staffing, Contributor evaluation,
and PyMuPDF licensing review remain separately unresolved.

## Ownership

| Boundary | Implementation owner | Acceptance still required |
| --- | --- | --- |
| Base, migration, revision storage, integration | Root implementation agent | Release/data owner |
| Legacy v1 freeze | Legacy-contracts subagent | API/editorial owner |
| Watch contracts and pure projection | Contracts subagent | Evidence/policy/technology editors |
| News/Event filters and URL state | News-events subagent | Product/editorial/accessibility review |
| Model evaluation preparation | Model-evaluation subagent | Real corpus labels, editor decision and spending authorization |
| Federal/PA/NJ/DE and 11 county sources | Not yet staffed/qualified | Named source owners and backups; no coverage claim |

These implementation assignments do not fabricate human editorial staffing or
qualify any source. The original blueprint remains the product/release contract.
