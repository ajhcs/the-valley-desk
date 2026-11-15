# WP00 independent review — Sol

Review status: complete; recommend acceptance for the bounded WP00 baseline and
orchestration scope. Orchestration acceptance remains pending. This review
records read-only source inspection and receipt checks, not executed application
tests, provider qualification, operational acceptance or deployment.

## Source and receipt checks

The selected checkout remains
`/workspace/worktrees/builderbob/thevalleydesk/tvd-discovery-implementation-20261113`.
The receipt identifies branch `codex/discovery-implementation-20261113` and source
`c8b36d7e9b27376bf121d9d6670c500a25c62423`. Its dirty inventory is a timestamped
snapshot and explicitly preserves the handoff/orchestration changes. Its retained
read-only upstream result identifies the same GitHub main revision while retaining
the different local-origin revisions. The reviewer independently compared every
recorded source-file and migration SHA-256 with current bytes: no mismatch.

The missing historical production note is named exactly:
`/home/plumbob/.codex/memories/plumbob-server/the-valley-desk-prod.md`.
`docs/OPERATIONS.md`, README and inspected scripts support bounded synthetic local
validation; they do not establish current production configuration. No deployed
health request or private inspection was made by this reviewer. The receipt
correctly leaves runtime identity and source/runtime equivalence unverified.

## Runtime and command findings

| Check | Source-supported behavior and required boundary |
| --- | --- |
| Node | CI selects Node 22. Locked Vite 8.2.2, React plugin 6.1.0 and Rolldown require `^20.19.0 || >=22.12.0`; Wrangler 4.143.1 and Miniflare require Node >=22. Tests and smoke import `node:sqlite`. Installed Node 22.23.2 is the baseline. Node 24.21.0 meets declared engines but needs separate observed qualification; system Node 18.19.1 is unsuitable. |
| `npm ci` | Uses lockfile v3. Root package has no install lifecycle hook, but locked esbuild/workerd dependencies have install scripts; optional fsevents is platform-specific. Installation writes `node_modules`, downloads npm artifacts and may execute dependency installation code. Root owns this action and lock/package changes. Pin `PATH`, npm cache and temp paths to approved `/workspace` locations; do not upgrade packages implicitly. |
| PDF bootstrap | `policy:pdf:bootstrap` creates `node_modules/.policy-pdf` with system Python, then pip downloads binary-only, hash-required pypdf 6.9.0 and PyMuPDF 1.27.2. The latter is AGPL/commercial licensed. No global Python installation is required. Use Python 3.12 to match CI. |
| `npm test` | Runs the explicit primary list and then `posttest`, which runs `test:watch-launch`. The PDF integration regression requires the bootstrapped Python and renders the retained 79 official PDF pages. SQLite fixtures are synthetic/in-memory. Real D1 tests use their dummy fixture config with `envFiles: []`, `persist: false`, `remoteBindings: false`. |
| Test selection | Primary plus posttest enumerate 67 files and omit 11 existing regional tests. New files are not automatically discovered by this command. Root must explicitly wire required discovery/regional qualification into actual commands/CI; preserve existing required checks. |
| Temp files | PDF integration, evaluation and review-packet tests use `os.tmpdir()`. Set `TMPDIR` to a task-owned path on verified `/workspace` before running them. Do not permit working-data fallback to `/tmp` on the root disk. |
| `npm run build` | npm first runs `prebuild`: fixture-only `build-feed.mjs` rewrites `public/feed.json`, `public/feed.xml`, `public/sitemap.xml`, `public/robots.txt`, `public/llms.txt`, `worker-published.js`, and `src/content/published-catalog.json`. It performs no fetch. The build then writes `dist` and TypeScript build info under `node_modules/.tmp`. Record generated diffs; do not reset unrelated work. |
| `npm run ops:smoke` | Invokes Wrangler local migrations and a local table query using root `wrangler.jsonc`; default local persistence is `.wrangler`. It separately applies every migration to in-memory SQLite and invokes automation with injected empty/mock collectors. It does not invoke the Worker scheduled handler or real source collector. The production-shaped config is still loaded: root must bound config, credentials, persistence and Wrangler state before execution. |
| `npm audit --audit-level=high` | Contacts the npm audit service; it is an advisory check, not an installation fix. Do not run `npm audit fix` implicitly. |
| `npm run secret-scan` | Reads tracked plus untracked nonignored files through `git ls-files`. It does not inspect ignored evidence/state and has explicit exclusions. It is a bounded source scan, not a proof of complete credential absence. |
| Excluded commands | No ingestion, backfill/capture, provider fetch, cron trigger, deploy, remote D1 command or production integration follows from these local checks. Do not copy `.dev.vars.example` into a credential-bearing file as a setup side effect. |

Only `.dev.vars.example` was present among root `.dev.vars*`/`.env*` files during
inspection. Root `npm ci` does not install the separate package/lock under
`scripts/agents`, whose MCP SDK serves the independent agent-preview tooling.

The omitted existing tests are `regional-agent-transport.test.mjs`,
`regional-context.test.ts`, `regional-discovery-view.test.ts`,
`regional-discovery.test.ts`, `regional-document-boundaries.test.mjs`,
`regional-independent-review.test.mjs`, `regional-nearby-adversarial.test.mjs`,
`regional-publications.test.ts`, `regional-second-review.test.mjs`,
`regional-transport-corrections.test.ts` and `regional-worker-read.test.ts`.

## Compatibility findings

- Existing news/events/feed envelopes, Watch policy/technology/representative APIs,
  calendar/ICS, protected review and Ops routes, email/PDF intake, and three cron
  expressions remain existing consumers. Discovery should use separate additive
  tables and independently disabled controls until their own acceptance.
- `regional-contracts.ts` has five legacy channels and institution-level
  `core|edge|unverified` geography; it is not the six-route/nine-county discovery
  policy. Coverage reports explicitly say inventory-only and retain false
  collection/publication authority.
- The existing regional Worker read bundle is historical, protected Ops data with
  no D1/fetch/model/SDK dependency. Refreshing its pagination timestamps does not
  establish fresh source evidence. It cannot become a public current catalog
  fallback.
- Watch accepts `policy|technology` subjects. Its date schema supports
  instant/day/unknown, not discovery year/month semantics; its public revisions
  and dependency machinery are useful patterns but are not the complete new
  contract. Preserve legacy behavior while implementing discovery semantics.
- Actual source schema is `0040`, backed by 40 migration files through
  `0040_leadership_markup_captures.sql`. `docs/OPERATIONS.md` still calls `0037`
  the expected schema in historical launch text. README provisioning still names
  Muse 1.2 while the current config/intro use 1.3. Preserve these as baseline
  documentation drift, not verified production facts.
- Root Wrangler config contains real account/database identifiers, public flags,
  email binding, public domains and cron schedules. Those source values do not
  prove current provisioned state or authorize their use. No second Worker or
  `env.staging` deployment is required for isolated local evidence.

## Acceptance criterion review

The completed `baseline-receipt.json`, `decision-register.md`, `ownership.md` and
`validation-environments.md` were reviewed together. The source/migration receipt
contains 56 files whose hashes independently match. The reviewer independently
checked all 70 handoff-manifest files and all 21 frozen-baseline files by SHA-256
and byte length: no mismatch. All 17 historical assumptions exactly match the
frozen proof scope; all six empirical gates remain `not_run`. All 31 package rows
have owner/reviewer/dependencies matching `plan.json`, with no self-review.

| Criterion | Reviewer disposition | Evidence and limit |
| --- | --- | --- |
| AC-WP00-01 | Satisfied for baseline reconciliation. | Exact checkout/branch/HEAD, timestamped dirty inventory, source hashes and separate local-origin/GitHub observations are retained. This is not a clean-tree claim. |
| AC-WP00-02 | Satisfied as explicit runtime uncertainty and hold. | No deployed observation was authorized/run by WP00; deployed revision and source/runtime equivalence remain unverified. A future observation must retain any divergence. No deployment compatibility is accepted. |
| AC-WP00-03 | Satisfied. | Retained successful unprivileged Samsung mount verification; exact missing note, bounded maintained local replacement and resolution owner recorded. Production/provider-connected actions and remote/production migrations remain held. Task-owned local development/preproduction/cache/temp/evidence directories exist. |
| AC-WP00-04 | Satisfied for engineering allocation. | All 31 independent owner/reviewer/dependency rows match the frozen plan. Shared writers, input resolution owners, six independent routes and independent creator/paper paths are explicit. Engineering assignments do not confer real editorial/provider/participant authority. |
| AC-WP00-05 | Satisfied for historical evidence preservation. | Both manifests and 17 assumptions match; the 74 historical lemmas/32 families remain documentary results under assumptions. E01–E06 and fresh proof reproduction remain unrun. |

No blocking WP00 defect remains. The command-side-effect findings above and the
production documentation discrepancies are preserved limitations, with owners
and dependent holds. The orchestrator may accept WP00 and proceed with dependent
local contract/fixture work within the user's existing scope.

After the owner's baseline snapshot, root reported a Node 22 locked install with
`--ignore-scripts --no-audit --no-fund`. Standard PDF bootstrap failed because
system `ensurepip` is unavailable; root retained the failure and provisioned a
project-local `venv --without-pip` using the exact hash-verified locked wheels.
The reviewer read `.discovery-work/evidence/pdf-runtime-provisioning.json`, which
retains that alternative method. These setup observations do not alter WP00's
original timestamps or establish a test/build/CI pass. Later validation must
record actual runtime outcomes separately.
