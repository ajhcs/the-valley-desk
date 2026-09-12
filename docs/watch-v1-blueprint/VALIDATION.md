# Blueprint Validation Receipt

Prepared 2026-09-12. This receipt covers the documentation, reference laboratory,
and offline mockup only. It is not an application release receipt.

## Scope and Environment

- Repository checkout: `29e6a4e32fbccf79127815768bc322f0c3eb22fe`.
- Staged policy candidate inspected: `23972f4`; recorded production build
  `e0d03be` comes from dated operational notes, not a fresh production readback.
- Local Node: `v24.14.0`; TypeScript from the repository installation.
- Browser plugin not available. Used existing Playwright `1.56.1` and Chromium
  `141.0.7390.37` for the offline file, without installing dependencies.
- Chromium required scoped execution outside the filesystem sandbox after its
  initial socket setup was denied. The test blocked HTTP requests and used
  task-owned mounted scratch for screenshots. No server was started.

## Checks Performed

| Check | Result | What it proves |
| --- | --- | --- |
| Reference TypeScript behavior | 28 tests passed | Date precision, identity, literal binding, dependency changes, regional eligibility, license/recency screening, planned county/source scope |
| SQLite laboratory | 7 tests passed | NULL uniqueness demonstration, explicit identity constraints, snapshot pagination, tombstones, transaction rollback, stale acceptance, decision replay |
| Package integrity | 6 tests passed | Requirement/test traceability, valid acyclic work dependencies, repository-relative links, JSON, fences, ASCII, and whitespace |
| Standalone reference typecheck | Passed | `examples/contracts.ts` compiles under its declared strict configuration |
| Mockup JavaScript syntax | Passed | Browser script parses |
| Repository secret scan | Passed, 247 tracked/untracked files enumerated | Existing scanner reported no matching secret patterns; its configured exclusions still apply |
| Offline Playwright | 41 checks passed | Seven surfaces at four widths, filters/navigation/save/evidence/representatives/license/recency/events/state/keyboard interactions |
| Browser console / external requests | Zero errors / zero HTTP requests | Offline mockup did not contact data/provider services |
| Screenshots | 17 captured | Desktop/mobile list/detail/representative/News/Event views, first-viewport previews, and stale state |

The package-integrity tests additionally check 12 requirements, 14 work packages,
34 implementation acceptance cases, dependency acyclicity, repository-relative links, JSON
examples, balanced fences, ASCII, and trailing whitespace. All six passed.

The secret scan initially encountered sandbox `spawnSync git EPERM`; the same
read-only repository script passed under scoped execution. No Git metadata was
written. Reference/integrity tests total 41; browser checks are a separate set of
41, not 41 additional production integration tests.

Local browser evidence:
[machine-readable report](/mnt/d/tmp/plumbob/tvd-watch-blueprint-qa-20260912/report.json),
[Policy first viewport](/mnt/d/tmp/plumbob/tvd-watch-blueprint-qa-20260912/policy-preview.png),
[ORCA first viewport](/mnt/d/tmp/plumbob/tvd-watch-blueprint-qa-20260912/technology-orca-preview.png).
These are task-owned scratch evidence paths on this host, not portable repository
assets or deployed pages.

## Reproduction

The direct invocations below expose individual test counts in this host's output;
the equivalent `node --test` invocations also exit successfully.

```bash
node --import tsx/esm docs/watch-v1-blueprint/examples/contracts.test.ts
node docs/watch-v1-blueprint/examples/sql.test.mjs
node docs/watch-v1-blueprint/examples/blueprint.test.mjs
node node_modules/typescript/bin/tsc -p docs/watch-v1-blueprint/examples/tsconfig.json
node --check docs/watch-v1-blueprint/mockups/mockup.js
```

Offline browser reproduction on this host:

```bash
/home/plumbob/bin/with-dev-storage env \
  PLAYWRIGHT_MODULE=/mnt/d/cache/plumbob/npm/_npx/a4d0c66fe73b166b/node_modules/playwright \
  CHROMIUM_EXECUTABLE=/mnt/d/cache/plumbob/ms-playwright/chromium-1194/chrome-linux/chrome \
  node docs/watch-v1-blueprint/examples/check-mockup.mjs
```

The browser script writes screenshots/report below `$TMPDIR`, rejects HTTP
requests, and closes the browser in `finally`. Paths above are the observed host
installation, not a portable project dependency requirement. On another machine,
use a qualified installed Playwright/browser and set the same environment inputs.

## Browser Flows

Entry routes: Policy list, policy detail, Representatives, Technology directory,
ORCA profile, News, and Events. Each rendered at 320, 390, 768, and 1440 pixels;
mobile viewport height 844, larger viewport height 1000.

Checked page identity, meaningful content, missing-framework-overlay, loaded mark,
document horizontal overflow, and bounds for headings/body text/labels. Exercised
PA filtering with URL/reload; search/reset; Active/Agenda views; evidence disclosure
and browser back; saved preference persistence; NJ two-member representation and
PA chamber reset; representative search; OSS filtering that excludes ORCA;
baseline-vs-release view; paper view; virtual/cancelled events; stale/error/retry/
empty states; and skip-link keyboard focus without breaking hash routing.

Initial browser checks exposed a test-harness race between hash change and render;
the harness now waits for a rendered-route marker. A keyboard test initially reused
a document's existing focus; it now tests first-tab behavior from a fresh document.
UI proofing corrected dependent jurisdiction/chamber defaults and chronological
deadline ordering before final browser checks.

## Logical Review

The specification explicitly resolves these common implementation traps:

- Nullable session/version keys are not reliable unique identities.
- A timestamp filter over mutable rows does not provide stable pagination.
- Changed PDFs and external definitions invalidate the applicable interpretation.
- An accepted relationship is artifact-specific and not an automatic publish grant.
- Code visibility, license, local provenance, and clinical readiness are separate.
- A larger selection cap does not guarantee completion within the model deadline.
- A timely blocker is not the same as a useful reviewed policy brief.
- Legacy nested enum changes can break v1 even without a new top-level kind.
- True all-day events require a versioned date representation, not fake midnight.
- A database outage and an actual empty result require different delivery states.
- A previous-code rollback must preserve later unrelated News/Event writes.

The SQL lab uses a coarse global generation guard to make stale acceptance visible.
Production should compare the relevant accepted subject revision inside its atomic
batch, or explicitly accept the extra contention/retries of a global guard. The lab
does not implement the full production schema, source authorization, or D1 runtime.

## Limitations and Remaining Gates

The 28 reference tests include multiple assertions and parameterized cases, but
they are not complete semantic publication tests. The seven SQLite checks are
in-memory examples, not proof of Cloudflare migration/runtime behavior. Node 22 CI
compatibility must be checked during application implementation.

The mockup intentionally uses synthetic policies, officeholders, News, and Events.
It starts Technology in Directory to expose the researched ORCA baseline; the
production specification starts with Latest Releases. It omits production API
pagination, live source qualification, real district lookup, full county filters,
calendar generation/subscription, home-page integration, and the existing animated
fold. Local saves and hash routes demonstrate interactions, not production routing.
All displayed filter controls have fixture behavior; the full UI specification is
the implementation contract. Production fonts are not bundled into the mockup;
local fallbacks are intentional.

No full application test/build, production D1 inspection, source ingestion, paid
model comparison, live representative validation, clinical evaluation, or deployment
was run. No new runtime dependencies, production schemas/configuration, credentials,
automations, or service schedules were changed. Existing unrelated files were left
untouched. No Git commit or branch metadata operation was performed.

Remaining product qualification: real source-family/county coverage, actual
regional artifact/license evidence, provider privacy/access/spend, batch runtime,
review staffing, all application acceptance cases, 200% browser zoom, cross-browser
and assistive-technology checks, exact-candidate release/rollback, and natural-cycle
timeliness measurements. No claim of formal proof or production readiness is made.
