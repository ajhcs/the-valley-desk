# Discovery validation environments

WP00 inspected source and commands; it did not execute application tests, a build, local D1, proof drivers, provider requests, or a deployment. The orchestrator owns setup and subsequent validation receipts. [The baseline receipt](baseline-receipt.json) contains exact source hashes, commands, timestamps and outputs.

## Qualified location and runtime selection

The selected checkout is `/workspace/worktrees/builderbob/thevalleydesk/tvd-discovery-implementation-20261113`. Unprivileged `bob-admin workspace-status` verified a read/write Samsung SSD 990 PRO mount at `/workspace`. `bob-admin capabilities` and the installed runbook were read; no privileged operation was needed.

Use the existing `/workspace/build/builderbob/runtimes/node-v22.23.2-linux-x64/bin` first on PATH. The shell's `/usr/bin/node` is 18.19.1, while CI specifies Node 22 and smoke uses `node:sqlite`. Python 3.12.3 is installed; PDF regressions still require their hash-locked project environment. Existing dependencies and tools are not proof that tests pass.

The orchestrator provisions and excludes `.discovery-work/` from Git. Its `development/`, `preproduction/`, `evidence/`, `cache/`, and `tmp/` directories are local task state, not deployed services. Each run uses a new package/run directory and records the exact source, model, policy, interface, fixture, and configuration revisions. Preproduction evidence is separate from development fixtures; untouched holdout inputs must remain inaccessible to tuning. No sensitive provider or participant material is present or authorized by creating these directories.

Set `TMPDIR` and package/tool caches beneath `.discovery-work/` before setup and validation. Keep `HOME` and `CODEX_HOME` unchanged. Do not copy real credential files or `.dev.vars` into local fixtures. Explicitly inspect/sanitize inherited runtime credentials before a command that might use them. Disable Wrangler telemetry for local checks and keep its configuration/log state on the workspace. No new persistent service, Cloudflare Worker, or staging deployment is authorized.

## Existing command and side-effect map

All rows below are preserved obligations; their WP00 execution status is `not_run`.

| Check | Actual entry and behavior | Qualification boundary |
| --- | --- | --- |
| Locked install | `npm ci` consumes `package-lock.json`; dependency lifecycle scripts may run, including esbuild/workerd. | Registry/network downloads and project-local writes; orchestrator inspects and qualifies setup, with workspace npm cache/temp. No host packages. |
| PDF bootstrap | `npm run policy:pdf:bootstrap` invokes `scripts/policy-pdf-runtime.mjs bootstrap`; creates `node_modules/.policy-pdf`, then pip installs only binary, hash-required requirements. | Downloads tools, not source articles; preserve `scripts/requirements-policy-pdf.txt`. Use workspace temp. |
| Existing tests | `npm test` runs the explicit test list in `package.json`, then `posttest` invokes `test:watch-launch`. | Retain both lists. PDF-dependent cases require bootstrap. Verify mocks and synthetic state; a skipped PDF test is not a pass. |
| Mandatory PDF tests | `npm run test:policy-pdf` invokes Python unittest discovery for `policy_pdf_test.py`. | Uses the qualified project PDF environment and retained regression bytes. Temporary PDF output stays on workspace. |
| Typecheck/build | `npm run build` runs `prebuild` (`scripts/build-feed.mjs`), then `tsc -b && vite build`. | Rewrites `public/feed.json`, `public/feed.xml`, `public/sitemap.xml`, `public/robots.txt`, `public/llms.txt`, `worker-published.js`, and `src/content/published-catalog.json`, plus build outputs. Inspect resulting diff. No source acquisition in inspected feed generator. |
| Local D1/scheduled smoke | `npm run ops:smoke` executes `scripts/ops-smoke.mjs`: Wrangler migrations/queries use `--local`; the automation call uses injected empty results/404 fetch and in-memory SQLite. | Default Wrangler config is production-shaped and state defaults to checkout `.wrangler`. Before execution, qualify local bindings, sanitized environment and isolated persistence. Do not assume `--local` alone resolves every side effect. |
| Dependency audit | `npm audit --audit-level=high` queries the registry using dependency metadata. | Network read and cache/log writes; retain actual vulnerabilities/errors, do not turn an unavailable registry into a pass. |
| Secret scan | `npm run secret-scan` invokes `scripts/secret-scan.mjs`, scanning tracked and nonignored untracked files. | Local read; exclude runtime/cache state through reviewed ignore rules, not arbitrary evidence suppression. |
| New discovery tests | Add package-specific commands to actual enumerated tests and CI under orchestrator ownership. | A test file existing in the tree does not mean CI executes it. Retain finalized candidate CI separately from local results. |
| Native/formal reproduction | WP02 copies the frozen model selection to fresh workspace scratch; executes retained drivers and independent scopes with pinned Z3 and private CSE parser cache. | Drivers write beside their inputs; never run them in `docs/discovery-engineering/baseline/`. Retain exact runtime, driver adjustments, outputs and unavailable checks. |

The existing smoke's in-memory `batch()` loops over statements without a real transaction. Its success cannot qualify discovery's atomic commit, concurrency, rollback, or D1 behavior. WP16/WP23 require actual D1 transaction/interleaving evidence. Source text, README and health schema labels also cannot prove the remote migration ledger.

## Runtime and operating holds

The historical production note `/home/plumbob/.codex/memories/plumbob-server/the-valley-desk-prod.md` is unavailable. The authorized bounded replacement is `docs/OPERATIONS.md` plus README Local verification and the inspected scripts. It supports isolated local synthetic validation. It does not settle current production configuration; the operating owner and orchestrator own that reconciliation.

No deployed-health request was made. Record any later permitted observation separately with timestamp and reported revision, retaining disagreement with source. Do not equate a healthy endpoint, matching source hash, or code-level schema label with complete discovery delivery or database state.

At the original local-validation baseline, real source acquisition, enrollment, retention/display permission, participant recruitment, real editorial actions, paid/recurring trials, remote migration, deployment, recovery and host service changes were outside scope. The following dated amendment expands only bounded public source investigation. Fixtures do not qualify providers or E01–E06. Never launch ingestion scripts, a scheduler, or `wrangler dev --test-scheduled` merely because README lists them.

## 15 November 2026: authorized real source qualification

The user's request to perform real source qualification authorizes bounded anonymous
public policy/access reads and source-specific permitted evidence capture. EX21 in
[implementation decisions](implementation-decisions.md) records this amendment;
[the qualification record](qualification/README.md) records results and limits.
The original local-only baseline above remains historical evidence.

Six fixed root GETs inspected OpenMRS robots/terms/basic-info, ROR robots, and the
Penn/CHOP organization endpoints. Four separately recorded institution-research GETs
read ROR/Penn robots and official API/data-policy documentation. Primary web-policy
research is recorded separately, not counted as native capture requests. No forum
discussion or institutional profile body was acquired. Exact CC0 organization JSON
was retained only after a source-specific rights and bounded privacy decision;
independent full field/URI review preceded the portable copy.

Root requests used standalone certificate-verifying, public-IP-pinned Python HTTPS,
no credentials/proxy/redirects, identity encoding, byte caps and an outer 25-second
subprocess deadline. They did not exercise WP06 transport or create source authority.
The preserved first receipt's `native_transport: true` means this standalone method,
not project transport qualification. Other receipts make that distinction explicit.

Production enrollment/activation, recurring collection, private or paid access,
provider outreach, real human/trust enrollment, editorial admission, remote migration,
deployment and host service changes remain outside this investigation. No freeze or
empirical gate is waived. HTTP/rights/format/corpus results remain separate outcomes.

## 15 November 2026: GitHub and linked-publication qualification

The user's follow-up explicitly includes real GitHub repositories and linked
publications in the DVRPC region. [EX22](implementation-decisions.md) records the
bounded investigation and local retention correction. Sol and Terra performed
source work and independent actual-D1 checks; Astra reviewed native material and
adversarial corrections. Earlier EX21 observations remain historical evidence.

Four direct anonymous GitHub source GETs covered two fixed repository endpoints.
The initial 200 body was discarded by a method false positive and the next request
hit a rate limit. Two final requests occurred after the observed reset and retained
the exact reviewed bodies. DNS-selected destination addresses are recorded; no
proxy, credential or deliberate address change was used to evade a limit. The
GitHub connector's earlier metadata/ref/file reads remain separately identified
tool-mediated observations, not native HTTP byte receipts.

Crossref work included two exploratory singleton responses without complete
acquisition receipts, excluded from portable qualified evidence, then three fixed
provider-selected work-list requests. Two returned retained factual metadata;
the third returned 429 with no retry and only a marked post hoc failure observation.
Crossref's original method records fewer headers than GitHub's; absent header
records mean unknown. Native requests used standalone pinned/certificate-verifying
HTTPS and byte caps, with caller-bounded invocations, rather than WP06 transport.

Four portable native bodies were copied only after independent source/field/URI
review. Runtime format/D1 checks replay their unchanged bytes under synthetic local
authority, with original request grammar and acquisition limitations preserved.
No model output becomes a human label, authenticated source grant, regional
admission, publication decision or corpus freeze. No source enrollment, recurring
collector, deployment, remote migration or external outreach was performed.

## 15 November 2026: exact Crossref fixed requests and expansion

The follow-up user request authorizes closure of the request-contract gap and
bounded real-source expansion. EX23 records the new fixed-DOI mode. Ten native
GETs covered six exact canonical Crossref URLs and four public GitHub repository
baselines. Calls were spaced at least 3.2 seconds, with one attempt per endpoint,
no credentials/proxy/redirects, certificate-verifying public-IP-pinned HTTPS,
48,000-byte caps and caller-enforced 25-second limits. All ten returned 200 and
passed the strict material/identity preflight before persistence. There was no
rate-limit failure or retry in this batch. Earlier failures remain historical.

Independent full field/URI review preceded portable copying. Crossref raw bodies,
issued local requests and observed URLs now match the actual fixed-mode grammar;
no local response projection or substitute search scope is used. Local D1
qualification still uses synthetic authority and injected transport responses.
The actual network captures remain standalone acquisition, not production WP06
enrollment. Historical replay does not reacquire a released live lease.

Two recaptures repeat prior bytes, so ten new acquisitions add eight distinct
body hashes. All source material is development-exposed. Independent case counts,
human labels, source trust, regional/clinical truth, operational acceptance,
production collection and deployment are not supplied by this qualification.

## WP03 independent human-review workflow preparation

The subsequent user instruction authorizes local human-review workflow setup
and preparation of the existing source corpus. The offline `discovery:review`
command reads explicitly selected files only; it performs no network requests,
signing, enrollment, manifest update, freeze, migration or deployment. See the
[tooling guide](human-review/tooling.md) for exact operations, inputs, exit codes,
file limits and controlled distribution requirements.

The actual local preparation writes eight blocked groups from 16 acquisitions
and 14 distinct bodies, with 16 blank reviewer slots and 128 null label cells.
The private request and output are retained under
`.discovery-work/wp03-human/root/preparation/`, with a `0700` parent and `0600`
files. Preparation exits 2 by design; it creates zero strict cases or permissions
and dispatches nothing. All inputs remain development-exposed; no sampling credit
or human independence follows from local mode bits or checksums.

Sol implementation, Terra procedural and independent fixture checks, and Astra
adversarial review use explicitly fictional authority and ephemeral signing keys
only. Full-frame 360-heldout/100-recall fixtures exercise structural, sampling,
exposure and native receipt bindings without labeling any real case. Same-context
replay, actual human identity/blinding and the rubric revision-to-text mapping
require accountable external records and controlled delivery. Audit dispatch
remains WP24. The strict reference manifest, 91 frozen handoff entries and native
model contracts remain unchanged. Broader qualification is recorded separately
in the progress receipt; the dependency-audit hold remains.

## Repeatable WP00 evidence review

From the selected checkout, the reviewer can rerun the receipt's `commands[].argv` as read-only observations. Source status may change as authorized work proceeds; compare timestamps and retained file hashes rather than replacing the original snapshot. Recompute each frozen manifest entry's SHA-256 and byte length against its manifest. The baseline records 70 handoff entries and 21 frozen entries checked without mismatch.

Check all 31 ownership rows against `docs/discovery-engineering/plan.json` and confirm owner differs from reviewer. Confirm active statuses belong to `execution.json`; frozen statuses remain historical. Read all five AC dispositions in the receipt, challenge their limits, and record independent review before the orchestrator accepts WP00. That acceptance authorizes dependent local package work only within the existing user scope.
