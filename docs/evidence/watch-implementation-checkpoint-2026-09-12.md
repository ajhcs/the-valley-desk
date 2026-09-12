# Watch Implementation Checkpoint

Working checkpoint resumed on 2026-09-12 at 13:14 UTC. Implementation is ongoing, not a
completed launch or deployment receipt. See the final checkpoint update below
before resuming work.

## Workspace and Stop Boundary

- Implementation: `/mnt/d/worktrees/plumbob/tvd-watch-implementation`, branch
  `codex/tvd-watch-implementation`, exact starting commit
  `23972f4c04bd2cd891d11488c1580a14b9e14875`.
- Original planning checkout `/mnt/d/Coding Projects/thevalleydesk` and its
  untracked instructions/coordination/planning files are unchanged.
- Subagents used isolated branches and verified per-command writer locks.
  Commits are local only; nothing has been pushed or deployed.
- The original run paused when an approval attempt hit the usage limit, before
  the final integration checkpoint could be written. The usage service had
  timed out, so the exact reset was not observed. No credits were purchased.
- The user explicitly resumed work after the reset and authorized appropriate
  testing, pushes, merges, and production deployment. The former 06:10 UTC stop
  boundary no longer applies. Publication/source/model qualification still does.
- Remote `main` was fetched and reconciled at 13:18 UTC. Its exact commit was
  `d1a0bce9725a62057980a43c1b12e17160b91eec`; only three repository-guidance files
  were added by that merge. Unrelated draft PRs 12 and 13 remain untouched.

## Product Contract Still Binding

Policy Watch's first public release must include federal, PA, NJ, DE, and the
specified Delaware Valley layer. The regional inventory is Philadelphia, Bucks,
Montgomery, Chester, and Delaware counties in PA; Camden, Burlington, Gloucester,
Salem, and Atlantic counties in NJ; and New Castle County in DE. A PA-only
implementation cannot be relabeled a tri-state launch.

Technology Watch admits only artifact-specific verified Delaware Valley
connections. A GitHub account location, generic healthcare relevance, star,
conference appearance, or regional sales office is insufficient. Code, data,
and weights licenses are distinct. ORCA's existing identity/links must be
preserved in a reviewed migration; public GitHub visibility does not make it
permissive OSS. Nothing in this checkpoint publishes a new ORCA dossier.

News and Events retain their existing lead, chronology, chapter radar,
registration/calendar links, publication gates, v1 feeds, and permalinks.
Voices URLs/navigation and the paused social collector remain unchanged.

## Work Package Status

| Package | Local implementation | Not yet satisfied |
| --- | --- | --- |
| W00 | Exact linear-ancestry base selected; isolated bootstrap; baseline tests/build/local smoke and source/operational holds recorded | Fresh production readback and human release acceptance are not claimed |
| W01 | Legacy enum/URL/feed/attribution/tombstone/lead/fallback fixtures; explicit CI test additions | Real editor-labeled 100-case corpus and independently accepted labels |
| W02 | Offline manifest validation, paired wrapper replay, stratification, hashes and simulated cost ledger | Authorized real provider comparison, blind editorial scoring, actual usage/cost evidence |
| W03 | Exact target model ID is encoded in evaluation contracts | Runtime/default switch remains blocked on W02; current defaults stay 1.2 |
| W04 | Typed dates/identities/evidence, accepted public projections, immutable D1 generations, atomic CAS/replay, keyset cursors, withdrawal/retention, compiled delivery manifests, current dependency guards and aggregate byte-bounded pages | Real accepted-review/current-head resolvers and production-volume latency/load qualification |
| W05 | Qualification/enrollment contracts; RSS/Atom/GitHub snapshot parsing; raw-persistence/page acknowledgments; checkpoint guards | Actual source enrollment, live qualified samples, durable collection orchestration/fair dispatch, batch host, PA ZIP/NJ Access, protected packet intake |
| W06 | Existing staged policy/PDF gates preserved; pure interpretation dependency checks | Federal/PA/NJ/DE/local native action mappings, durable action/version/dependency writers, real editor-reviewed examples and public integration |
| W07 | Evidence-bound representatives, multi-seat offices, historical sponsorship, stale/vacancy semantics; exact county/family coverage accounting | Real official rosters, persistent resolver/API/UI, named editors/backups, complete source/county qualification |
| W08 | Artifact identity/local/license contracts and GitHub snapshot parsers | ORCA alias migration; qualified local paper/database/product sources and profiles; durable release/development ledger |
| W09 | Separate responsive Policy/Technology directory and dossier routes; URL filters, evidence disclosures, truthful states, local ID-only saves | Real-data task testing; representative/agenda/Latest views; final editorial/accessibility acceptance |
| W10 | News/Event search and focused filters, literal query grammar, filtered pagination and matching crawler/metadata behavior | Versioned all-day/price/registration facts, stable ICS UID/sequence/cancellation history, subscriptions, related developments |
| W11 | v1 compatibility frozen; current-evidence Watch Worker pages/API integrated; separate background public gate; filtered News/Event HTML and matching metadata | Cross-desk document-navigation fix under verification; final primary-nav/Voices archive transition remains gated |
| W12 | Local incremental test/build/smoke/audit/browser receipts, including Node 22 and Node 24 | Final exact candidate gate and hosted CI, real source/model/coverage qualification, qualified public exposure |
| W13 | Not started | Authorized natural-cycle observation, actual eligible samples and final acceptance |

These are deliberately partial work-package statuses. A pure validator, fixture,
receipt shape, or passing synthetic suite is not an editorial approval, staffed
monitoring assignment, live source qualification, or authorization to publish.

## Integrated Boundaries

Public API, disabled unless `WATCH_PUBLIC_ENABLED` is exactly `true`:

```text
GET /api/v2/watch/policy
GET /api/v2/watch/technology
GET /api/v2/watch/{kind}/{id}
GET /api/v2/watch/{kind}/{slug}?lookup=slug
```

GET/HEAD only. List queries are bounded and desk-specific. The directory is
alphabetical, not a Latest/release feed. A generation fixes accepted title/order
and membership history; current withdrawals override old snapshots. Retention
returns 410 for expired cursors rather than replaying page one. API errors are
structured; unavailable storage is never a healthy empty result. Review input
is not accepted through public routes.

`asOf` is the projection's generation/application time, not source freshness,
publication date, or release date. `verifiedAt` is the oldest contributing
accepted fact check. The API does not claim a fresh source check merely because
it successfully served data. Live delivery uses the separately labeled
`X-Watch-Delivery-As-Of` response header and preserves that distinction.

The source adapters are pure parsers. They do not fetch, register themselves,
enable a source, execute repository code, or authorize model/publication output.
The model replay harness has no live transport and always blocks live mode.
The representatives resolver uses server-owned accepted context, not caller
booleans or ZIP-to-person inference.

## Verification Receipts

| Checkpoint | Evidence and scope |
| --- | --- |
| Baseline | 375/375 after declared PDF bootstrap and two test-local Date fixes; production freshness unchanged |
| First integration | 582/582 tests, including real local D1 transaction/concurrency tests; no live sources/models |
| UI integration at 05:30 | 603/603 explicit tests; `tvd-watch-ui-integrated-tests-20260912.log` |
| Node 22 integration at 05:38 | 603/603 tests under Node 22.23.2; `tvd-watch-node22-tests-20260912.log`; local, not hosted CI |
| Builds at 05:24 and 05:39 | Passed on Node 24 and Node 22; Watch directory/detail/shared code are separate lazy chunks; existing >500KB base chunk warning remains |
| Operations smoke at 05:21 | Passed local migrations and mocked scheduled processing; zero model attempts or new publications |
| Dependency audit at 05:42 | Wrangler 4.131.1 -> Miniflare 5.20260911.0-alpha -> Sharp 0.35.4; `npm audit --audit-level=high` reported zero vulnerabilities; production config unchanged |
| Watch UI browser | 44 checks/27 screenshots, 320/390/768/1440 widths and real 200% Chrome zoom on all four views; synthetic intercepted responses only |
| Integrated News/Events browser | 20 checks/9 screenshots, 320/390/768/1440; actual bundled catalog; filters/history/reload/metadata/invalid URL states; zero console warnings/errors |

Mounted evidence directories:

```text
/mnt/d/tmp/plumbob/tvd-watch-ui-qa-20260912/report.json
/mnt/d/tmp/plumbob/tvd-watch-integration-browser-20260912/report.json
/mnt/d/tmp/plumbob/tvd-news-events-qa-20260912/report.json
```

Browser plugin was unavailable; the existing mounted Playwright/Chromium tools
were used. Remote font CSS was blocked, not downloaded. Native brand assets
rendered. No real screen-reader or cross-browser audit is claimed. Disposable
browser profiles and preview servers are stopped after each run. New edits
after a receipt require a new test result; counts are not summed across repeated
runs to inflate coverage.

## Review Findings and Holds

1. Fixed: a data-only OSI classification could satisfy the directory OSS filter.
   The filter now requires code-specific `oss` eligibility; a regression covers it.
2. Fixed: publication-projection time was mislabeled as the oldest fact check
   in the detail envelope. It now comes from the applied publication decision.
3. Fixed: browser normalization discarded reserved query keys; invalidity now
   survives normalization. Raw crawler URLs and control-only inputs also fail
   closed. Valid tracking parameters and existing literal queries are retained.
4. Fixed in the local implementation: compiled manifests and live dependency
   guards remove invalidated interpretation/orphan citations, withhold technology
   without an eligible local edge, and remove changed licenses from OSS filters.
   Actual Worker/local D1/browser retraction checks passed; real head resolvers
   and authorized review inputs remain required before public activation.
5. Still held: there is no real Watch editorial resolver/credential-bound review
   writer or qualified source/coverage rollout. A server-owned typed boundary
   is not proof that its future production inputs have been independently reviewed.
6. Still held: legacy PA PDF definitions/amendments/operator review, PyMuPDF reuse
   licensing review, prospective policy timeliness, and Contributor account/data
   policy/evaluation remain unresolved. Preserve the historical 8239.929-second
   miss; zero new samples do not prove recovery.
7. Fixed in the local implementation: 512,000-byte manifest admission and a
   2,400,000-byte charged aggregate body budget, plus one compact lookahead,
   bound materialized directory bodies. Large-record tests prove non-skipping
   pagination. Production-volume query latency/CPU acceptance is still required.
8. Fixed: inherited `/policy` and its public baseline API have their own exact
   `POLICY_BACKGROUND_PUBLIC_ENABLED` gate, explicitly false in configuration.
   Worker404/API503 without D1 reads and hidden browser/footer behavior are tested.
9. In progress: independent review found Watch-to-v1 SPA navigation can omit
   live publications and resurrect withdrawn bundled items. The actual local
   D1/browser run reproduced this; a document-navigation boundary is under test.

## Safe Resumption

1. Read this checkpoint, the base manifest, package-specific readiness notes,
   original blueprint, current Git status and worktree-bootstrap receipts.
2. Read the latest user authorization. The user resumed implementation and
   authorized qualified production operations after the original usage pause.
3. Resume only the recorded implementation worktree/task through its verified
   writer lock. Do not edit the original planning checkout or copy node_modules.
4. Review/integrate unfinished delivery and routing commits in dependency order,
   then add any new tests to the explicit package script. Keep Watch disabled.
5. Run the full suite, build, secret scan, dependency audit and local D1 smoke;
   validate browser/API transitions against the exact resulting tree.
6. Take W05/W06/W07/W08 live qualification and W02 model evaluation through their
   separate editor/operations/spend/data-policy prerequisites. Do not fill gaps
   with fabricated labels, officials, releases, licenses, or staffing.
7. Only an explicitly authorized, fully qualified release may update production
   migrations, model settings, collectors, navigation exposure or source schedules.

## Resumed Release Work

Delivery and routing changes are integrated; the cross-desk navigation regression
is being fixed in the routing worktree. An independent audit verified production
at 13:17-13:18 UTC as build
`e0d03be90497cab70f1f35edb3e938bf4e587025`, schema stamp `0027`; `/policy` and both
Watch pages still returned 404. A separate read-only D1 query verified the actual
27-entry migration ledger through `0027`; health alone is not a database probe.
The current rollback Worker is `29af8da5-807f-412d-a019-ac9d34e4ac0a` at 100 percent,
deployment `77461731-ecea-4fb1-bb35-b30414280e79`.

Read-only production receipts and local integration logs are restricted to
`/mnt/d/tmp/plumbob/tvd-watch-release-vg1rTv1Z`. No secret values are retained.
The Cloudflare script tag was verified as `22055e10a18247fe8124be7daa95b077`, but
the Builds trigger read returned 403. GitHub has no deployment workflow; that is
not proof that external Cloudflare automatic deployments are absent. The user
has been asked to clarify this before push/merge, so no release can be triggered
before its migration and artifact gates are ready.

Additional local evidence during resumption:

- Delivery source commits `9110f23` and `6e9aa49`, integrated as `769aa8c` and
  `298ef5d`; routing source `3385b88`, integrated as `723045e`.
- Independent review found and verified two delivery fixes: stable current
  regional heads across per-resource check days, and fact-scoped interpretation
  heads with shared definition invalidation retained. No remaining blocker in
  that reviewed delivery scope.
- Node 22 full integration: 622/622 after delivery; 647/647 after routing,
  including the explicit new test files. No hosted CI result is claimed.
- Previous unmodified production code `e0d03be` passed 28 compatibility checks
  against additive migrations `0028`-`0030`, preserving publications, tombstones,
  policy records and all 16 additive tables; mocked scheduled run had zero model
  attempts and released its lock. This was Node 24/transactional local SQLite,
  not a remote restore. Receipt:
  `/mnt/d/tmp/plumbob/tvd-watch-rollback-proof-final-20260912.json`, SHA-256
  `da434a34aa1a1ccd278066c071376a99e83c941f3d3824da475cef83fefb7ffe`.
- Actual Worker handlers plus local D1 and built React UI passed eight dossier,
  policy meaning, license and local-edge invalidation checks at 1440/390px.
  The same run reproduced the cross-desk navigation defect, so the overall
  browser run is not yet a pass. Initial harness diagnostics corrected a
  fetch-reserved port and an assertion that included inert noscript text.
- Locked Wrangler 4.131.1 dry-run bundle passed with 36 assets, 1,252.42 KiB
  Worker source bundle (272.35 KiB gzip); no deployment. Frontend build passed
  with the existing >500 KB main-chunk warning retained, not suppressed.
- The unchanged blueprint's 41 executable contract, SQLite and traceability
  tests passed again. Its dated original receipt remains a planning receipt.

Exact-candidate qualification, hosted CI, production backup/migration, push/merge
and deployment receipts are not yet complete. No deployment is claimed here.
