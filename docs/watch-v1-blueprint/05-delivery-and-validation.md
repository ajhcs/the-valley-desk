# Delivery, Acceptance, and Release Plan

## 1. Delivery Rules

Each work package has an owner role, prerequisites, implementation steps, tests,
reviewer, and a stop condition. Assign actual people before scheduling work. An
engineer may implement multiple packages, but cannot self-attest policy meaning
or a source's legal reuse rights merely because the code passes tests.

Keep PRs bounded by one behavior/contract. A useful PR includes a failing fixture,
the implementation, integration tests, documentation, and a short receipt. Do not
merge an API with a knowingly incompatible client under a shared feature flag.
Feature flags hide unqualified product exposure; they do not excuse broken types,
unguarded publication, missing migration safety, or secret leakage.

## 2. Dependency Graph

```text
W00 Reconcile base
  +-- W01 Freeze contracts / baseline fixtures
  |     +-- W02 Muse evaluation -> W03 qualified model configuration
  |     +-- W04 Watch contracts and public projection
  |            +-- W05 collection foundation / batch qualification
  |            |      +-- W06 policy actions / versions / review
  |            |      +-- W07 jurisdictions / representatives / coverage
  |            |      +-- W08 technology identity / discovery / licenses
  |            +-- W09 UI built first with approved synthetic fixtures
  |                   (final acceptance depends on W06 + W07 + W08)
  +-- W10 focused News / Events improvements (after W01)

W03 + W06 + W07 + W08 + W09 + W10 -> W11 compatibility integration
W11 -> W12 exact-candidate qualification -> authorized exposure
authorized exposure -> W13 natural-cycle observation -> full launch acceptance
```

Source qualification can proceed as read-only documented investigation alongside
contract work. No need to block UI scaffolding on live data: use explicit fixtures,
but do not count those fixtures as real source acceptance. Earlier internal
previews or a separately gated model upgrade do not waive tri-state Watch scope.

## 3. Work Packages

### W00: Establish the implementation base

Owner: engineering lead. Reviewer: release owner. Dependencies: none.

1. Read README, repository instructions, current operational note, and both
   worktrees. Record status without cleaning another task's untracked files.
2. Compare ancestry/diffs for `29e6a4e`, recorded `e0d03be`, and `23972f4`.
   Inventory deployed fixes and staged PDF behavior, including unresolved holds.
3. Select an isolated reconciled base through the authorized worktree procedure.
   Record exact included commits/tree and migration head; do not guess numbering.
4. Run baseline tests/build/secret scan and appropriate local-only smoke in the
   mounted development environment. Separate pre-existing failures from new ones.
5. Produce `docs/evidence/watch-base-manifest-<date>.md` and source ownership sheet.

Done: reproducible base with preserved historical receipts and no unexplained
lost changes. Stop: unresolved overlapping changes or a production-state claim
that cannot be freshly verified within authorized scope. Local planning/coding
can proceed with that production uncertainty explicitly bounded.

### W01: Freeze legacy behavior and prepare fixtures

Owner: full-stack engineer. Reviewer: API/editorial owner. Depends on W00.

Touch: `content/schema.ts`, feed/canonical/publication tests, test fixture folders.

1. Capture the actual v1 schema and serialization contract before extending kinds.
2. Snapshot existing News/Event/Voice/policy/AI permalinks, aliases, tombstones,
   featured lead behavior, and bundled fallback semantics.
3. Add representative positive and negative fixtures for each of the 12 requirements.
4. Create the 100-case model-evaluation manifest with editors; hash evidence and
   freeze holdout selection. Real evaluations are a separate authorized action.
5. Add new test files to the explicit `npm test` list.

Done: legacy fixtures fail when enums/URLs/dates are misrepresented. Stop: fixture
data has unclear origin, rights, private information, or an unsupported gold label.

### W02: Run and analyze the Muse comparison

Owner: model integration engineer. Reviewers: editor plus engineering lead.
Depends on W01; requires separately authorized provider access/spend.

Touch: proposed `scripts/evaluate-watch-model.mjs`, frozen corpus/receipt format;
reuse `editor-model.ts` and verifier wrappers rather than writing a second client.

1. Validate credentials/account policy with a bounded public smoke fixture.
2. Run paired calibration, freeze request configuration, then run the holdout.
3. Record model/provider/request parameters, prompt/schema versions, source hashes,
   raw disposition categories, token usage, latency, and grounded claim results.
4. Review blinded copy quality and every critical disagreement. Do not tune to
   the holdout and continue describing it as unseen evidence.
5. Produce comparison, residual errors, cost estimate, and accept/reject decision.

Done: the model acceptance rubric passes without weakening gates. Stop: provider
access failure, Contributor data-policy mismatch, spending cap, critical regression,
or missed deadline budget. A failed qualification is a result, not a reason to
silently route to another model.

### W03: Prepare the qualified model switch

Owner: model integration engineer. Reviewer: release owner. Depends on W02.

Touch: `editor-model.ts`, `verification.ts`, `wrangler.jsonc`, `.dev.vars.example`,
README/operations documentation, configuration tests.

1. Update the exact model ID in all runtime/default/example locations together.
2. Preserve separate classification/copy/verifier contracts and qualified settings.
3. Add durable call/spend accounting and bounded review-only shadow selection.
4. Test no-key, blocked-policy, timeout, invalid JSON, unsupported parameter, and
   zero-budget outcomes. Model failure must not stop deterministic chapter events.
5. Save old/new configuration hashes and a tested rollback instruction.

Done: local configuration tests and authorized shadow evidence pass. This package
does not independently authorize deployment or new Watch publication.

### W04: Implement shared contracts and accepted public projection

Owner: backend engineer. Reviewers: data/API owner and editorial gate owner.
Depends on W01.

Touch: proposed `content/watch-schema.ts`, `ingest/watch-persistence.ts`, additive
migrations, public projection tests; extend existing D1 interfaces minimally.

1. Implement typed dates, evidence references, subject/development identities,
   local relationships, accepted field shapes, and explicit public DTOs.
2. Audit nullable identity collisions; add normalized unique keys without
   destroying `policy_versions` IDs or staged PDF relationships.
3. Implement public revision generation, atomic acceptance projection, keyset
   pagination, current tombstone filtering, and bounded fallback behavior.
4. Add generation retention/expiry handling and indexes for actual query shapes.
5. Run pure tests plus local D1 transaction, concurrency, migration, and query-plan
   tests against legacy/backfilled datasets.

Done: replay, stale acceptance, rollback, cursor stability, field redaction, and
legacy compatibility hold. Stop: rows cannot be backfilled without inventing facts.

### W05: Collection foundation and batch qualification

Owner: ingestion engineer. Reviewers: operations and source/editorial owner.
Depends on W04; host/credential/schedule provisioning requires explicit scope.

Touch: existing registries, `source-health.ts`, scheduler helpers, proposed
`ingest/watch/*`, protected ingestion route, batch scripts and fixture manifests.

1. Implement enrollment metadata and source-family ownership. Reuse existing
   fetch bounds, health taxonomy, retry state, and raw-before-model persistence.
2. Implement checkpoint replay/partial-page behavior and persistent fair dispatch.
3. Qualify actual PA ZIP/NJ Access tools and samples. Select batch host based on
   access, deterministic packaging, limits, secrets, cost, and observed scheduling.
4. Implement ingestion-only packet validation, idempotent receipts, and dedicated
   credential boundaries. Do not reuse review authorization.
5. Load-test sources and model calls together with simulated delays and realistic
   payload sizes; report effective service capacity and oldest due work.

Done: required data paths have qualified samples and a host decision; retries,
rate limits, archive caps, cursor loss, and lane starvation tests pass. Stop: a
mandatory format cannot be processed within a qualified runtime. No automatic
PDF interpretation or background host service is smuggled into this package.

### W06: Policy actions, versions, and interpretation delivery

Owner: policy backend engineer. Reviewer: policy editor plus evidence owner.
Depends on W04/W05.

Touch: policy baseline/discovery mappings, staged PDF/provision modules, additive
policy actions and dependencies, accepted dossier projection.

1. Implement native-to-normalized mappings separately for federal/PA/NJ/DE/local
   legislation and regulations. Retain raw action code and responsible body.
2. Handle proposal-to-bill links, printer/text changes, veto/withdrawal/supersession,
   legal effect, and unknown/date-only cases without a monotonic progress model.
3. Reuse staged capture/extraction/review APIs. Extend dependency binding to
   definitions, exceptions, cross-references, and amendments where required.
4. Project only accepted metadata and current reviewed interpretation; show
   evidence-changed/review holds instead of outdated applicability.
5. Walk one real accepted example from each of federal, PA, NJ, DE, and local
   through collection, evidence, status, review, and public response.

Done: R01/R10/R11 fixtures and real cited examples pass editor review. Stop:
missing text/definition/amendment meaning. A stronger model does not remove it.

### W07: Geography, representatives, and coverage accounting

Owner: policy data engineer. Reviewer: regional editor. Depends on W04/W05.

Touch: jurisdiction registry, membership/office records, representative API,
`source-plan.json` implementation counterpart, public coverage page data.

1. Qualify member/committee/official lookup sources for federal and all states.
2. Implement date-bounded offices, memberships, roles, multi-seat districts, and
   evidence-backed vacancies. Preserve historical sponsor context.
3. Inventory exact local bodies across the 11 counties; record municipal gaps.
4. For each county, qualify a source or assign a named editor with cadence,
   evidence log, backup, review date, and disclosed scope. An unassigned role in
   this planning file is not a staffed monitoring assignment.
5. Test selected-district behavior and current/historical projections against
   official rosters. Never infer exact representatives from ZIP alone.

Done: every source family and county obligation has a truthful disposition;
tri-state directory and historical cases pass. Stop: stale member data is being
treated as current or launch coverage is being overstated.

### W08: Technology eligibility, artifacts, and developments

Owner: technology ingestion engineer. Reviewer: technology editor.
Depends on W04/W05.

Touch: product-watch registry migration, technology schema/adapters, artifact
identity/license/local relationship validators, proposed paper/repository collectors.

1. Separate creator, rights holder, repository owner, supporting platform, and
   using institution. Migrate ORCA's existing ID through an alias map.
2. Qualify institution-to-repository/paper links and artifact-specific local
   relationships. Resolve campus/lab identity and temporal relation labels.
3. Collect repository metadata/releases/tags and paper records with provenance;
   no repository execution or installation of discovered packages.
4. Implement code/data/weights license records, custom/unknown handling,
   release-vs-baseline rules, and meaningful-change fingerprints.
5. Build reviewed profiles for ORCA plus software, paper, and data/database
   examples only after each qualifies. If a type lacks a real local example,
   show an honest empty filter; do not invent an artifact to satisfy a demo.

Done: local and license negative cases fail closed; old projects do not enter
Latest as new releases. Stop: local relationship or release/license fact is missing.

### W09: Policy and Technology UI

Owner: frontend engineer. Reviewers: product/editorial and accessibility reviewer.
Starts after W04; real-data acceptance depends on W06/W07/W08.

Touch: new Watch list/detail/representative components, existing baseline page,
router/nav metadata, scoped styles, frontend fixtures/tests.

1. Translate the UI specification, not the mockup's standalone routing/runtime.
2. Implement URL-backed views/filters, list/detail navigation, evidence disclosures,
   local saves, accessible state handling, and responsive context columns.
3. Preserve existing mark/fold, fonts, canonical story links, and editorial copy.
4. Test keyboard, deep links/back/reload, unknown/held/stale/error/empty states,
   long names, 320-1440 widths, and 200% zoom.
5. Run reader task checks on real accepted content, record confusion, and resolve
   mislabeling of policy status, local connection, or access conditions.

Done: no mock data reaches production; every visible action works and every
consequential field comes from accepted DTOs. Stop: screenshots are the only
evidence of functionality or a loading failure is disguised as an empty result.

### W10: News continuity and Events calendar improvements

Owner: full-stack engineer. Reviewer: News/Events editor. Depends on W01.

Touch: `HomePage.tsx`, `KindListPage.tsx`, `EventsPage.tsx`, content query helpers,
versioned event time contract, qualified ICS library integration.

1. Add focused filters/search and related-development links without changing the
   featured lead or treating hydrated articles as new.
2. Extend events with source-backed optional price/registration state and correct
   all-day representation; preserve legacy instant-based events.
3. Implement calendar serialization/subscription with stable UID/sequence,
   cancellation/reschedule history, independent parser tests, and cache behavior.
4. Keep policy comment deadlines out of Events; cross-list genuine relevant public
   hearings only with normal attendance/source standards.
5. Compare existing flows and schedule capacity to the W01 baseline.

Done: prior URLs, event withdrawal safeguards, calendar round-trip, and date tests
pass. Stop: a library requires unqualified runtime shims or calendars invent times.

### W11: Integrate navigation, feeds, crawler delivery, and fallbacks

Owner: full-stack integration engineer. Reviewer: API/release owner.
Depends on W03/W06/W07/W08/W09/W10.

1. Expose the four-section navigation; keep Voices archive and paused collector.
2. Add v2 feeds/API and section RSS with stable GUIDs and proper canonical links.
3. Run the entire route/metadata/sitemap/alias/HEAD matrix against dynamic and
   bundled data; verify no private fields in crawler hydration or feeds.
4. Verify database-unavailable fallback, stale labeling, and partial new-data
   compatibility with previous code. Test source license/review retractions.
5. Recheck all 12 requirements and resolve every integration assumption.

Done: a single candidate integrates all surfaces coherently. Stop: enum drift,
duplicate canonicals, wrong structured data, or unsupported fallback publication.

### W12: Exact-candidate qualification and authorized exposure

Owner: release owner. Reviewers: engineering lead, editor, operations owner.
Depends on W11.

1. Capture exact candidate tree/configuration/registry/schema versions.
2. Run required repository gates and targeted tests; read the current release-gate
   skill and operations instructions for the actual release procedure.
3. Review real content/source coverage and model evidence. Confirm batch host,
   credentials, editor/backup, budgets, and monitoring are actually provisioned.
4. Rehearse compatible code/model/feature rollback and verify backups/bookmarks
   where a migration requires them. Record what writes must be paused first.
5. Obtain explicit operational authorization for migrations/deployment/exposure;
   use the exact tested artifacts and record readback evidence.

Done: exposure has a traceable exact-candidate receipt. Stop: required family
unqualified, NJ/DE absent, critical test failure, unstaffed review commitment,
unresolved privacy/license issue, or insufficient rollback evidence.

### W13: Natural-cycle observation and launch acceptance

Owner: operations owner with editorial backup. Depends on authorized W12 exposure.

Observe at least seven normal days and actual developments across the required
families. Record sample counts, source availability, first discovery, first
brief/blocker, time to useful reviewed content, and unresolved age. A forced run
may diagnose a problem but does not replace independent scheduled-cycle evidence.

Done: source coverage, correctness, service capacity, reader tasks, and rollback
conditions are met with disclosed sample sizes. A quiet family remains
"insufficient timeliness sample," not a measured pass. Close the full launch
only after outstanding mandatory acceptance is genuinely complete.

## 4. Test Matrix

| Test | Requirement / assertion | Layer |
| --- | --- | --- |
| T01 | Missing/NULL policy session cannot bypass identity uniqueness | Unit + migration |
| T02 | Same instrument number in different jurisdiction/session remains distinct | Unit + D1 |
| T03 | Identical source replay and crash-before-checkpoint create no duplicate | Adapter + D1 |
| T04 | Day-only/unknown source dates never become fabricated instants | Contract + UI/feed |
| T05 | New PDF/version/definition dependency invalidates current interpretation | Staged PDF integration |
| T06 | Passed chamber, signed, effective, withdrawn, vetoed, and superseded remain distinct | Policy adapter + projection |
| T07 | Conflicting official sources hold consequential status | Editorial integration |
| T08 | NJ multi-member and Philadelphia at-large representation work | Data + UI |
| T09 | Term rollover preserves historical sponsor and updates current directory | Data integration |
| T10 | ZIP/county does not select an exact legislative district | UI + API |
| T11 | No local evidence / profile location / generic vendor claim is rejected | Technology gate |
| T12 | Exact local research/creation evidence qualifies only the linked artifact | Technology gate |
| T13 | ORCA custom restriction and unknown license never become OSS | License projection |
| T14 | Transfer retains stable repo ID and historical creation evidence | Adapter + identity |
| T15 | Tag, release, paper, indexing, commit, and baseline are distinct | Development classifier |
| T16 | Source body refresh does not change publication/sort dates | Regression |
| T17 | Raw persistence fails: no provider invocation | Orchestration |
| T18 | Invalid schema/evidence/model approval cannot publish | Existing gate integration |
| T19 | Paid calls from every stage consume durable spend reservation | Model accounting |
| T20 | Effective cap 1/4/32 and timeout load do not permanently starve lanes | Simulated scheduler |
| T21 | Federal/PA backlog cannot suppress NJ/DE/local due work | Scheduler |
| T22 | Partial/empty/blocked/304/no-cache outcomes retain truthful health | Adapter + operations |
| T23 | Cursor survives concurrent update/new publication; current tombstones win | D1 + API |
| T24 | Expired/bad/mismatched cursor and oversized query fail explicitly | API |
| T25 | v1 closed nested enums and existing routes remain compatible | Contract snapshot |
| T26 | Public DTO/feed/HTML contains no private or unaccepted fields | Integration |
| T27 | D1 outage yields accepted stale fallback or 503, never fresh-empty | API + UI |
| T28 | Calendar DST/all-day/UID/sequence/escaping/reschedule/cancellation round-trip | Calendar library integration |
| T29 | Rolling event feed omission and registration close do not cancel events | Existing regression |
| T30 | Nav/filter/save/source/deep-link/back/keyboard/mobile flows work | Playwright |
| T31 | All required federal/state families and 11 county obligations resolve | Coverage manifest |
| T32 | Transaction failure and stale concurrent acceptance do not publish partial state | D1 |
| T33 | Existing featured lead and News/Events service remain intact | Query + load regression |
| T34 | Previous-code/expanded-data rollback and model rollback are proven | Release rehearsal |

Reference examples in this package exercise a subset of T01/T02/T04/T05/T11/T12/
T13/T15/T23/T25/T31. They are not the implementation's test suite and do not claim
T06-T34 integration has run. See the actual validation receipt for exact coverage.

## 5. Release Evidence and Commands

Required implementation checks from this repository:

```bash
npm test
npm run build
npm run secret-scan
npm run ops:smoke
npm audit --audit-level=high
```

Inspect the current smoke script before execution; use local test configuration
without production secrets or accidental external ingestion. CI uses Node 22;
repeat qualification under that supported CI version, not only the developer's
local Node. Browser checks need an isolated local server only when the application
requires one; check `ss -tlnp` first and preserve other services.

Receipt fields: commit/tree, build artifact hashes, schema head, feature flags,
model/prompt configuration hash, registry version, test commands/versions/results,
source qualification receipts, content examples/reviewer, screenshots, query/load
measurements, authorized release scope, rollback candidate, and remaining limits.
Any candidate change after gating invalidates the exact-candidate receipt for
affected artifacts and requires the relevant checks again.

## 6. Planning Estimates and Critical Path

Do not promise a calendar date before W00/W02/W05 reveal the base, provider, and
source/runtime complexity. Size work in reviewable slices of roughly one to three
engineering days; packages such as W06/W07/W09 need multiple slices. Source
qualification and policy review have external/editorial elapsed time that does
not shrink merely by adding junior engineers.

For staffing, assign a lead/integration owner, backend/ingestion capacity, frontend
capacity, and an editor with a backup. Roles can overlap, but critical publication
review and release approval need an independent accountable reviewer. After the
first three representative adapters and the model experiment, re-estimate from
observed effort and throughput. Reserve explicit time for the seven-day operating
window and remediation; do not hide it inside "QA complete."

## 7. Risk Register

| Risk | Consequence | Mitigation / stop condition |
| --- | --- | --- |
| Wrong branch/base or missing production fixes | Reintroduces known failures | W00 manifest and regression fixtures before integration |
| Broader sources exceed Worker/model capacity | Stale News/Events or regional starvation | Measured dispatch capacity, durable fairness, separate batch path |
| Missing regulatory or county coverage | Misleading product promise | Required family gates; named county monitoring and public scope |
| Unreviewed policy meaning | Incorrect compliance information | Dependency-specific human review; accepted metadata only while held |
| Reviewer unavailable | Timely blockers but no useful briefs | Staffing/backup and unresolved-age metrics before SLO commitment |
| Source/GitHub identity ambiguity | Nonlocal or duplicate technology | Stable IDs and exact institutional/artifact provenance |
| Public code mistaken for OSS | Misleading usage guidance | Artifact-specific primary license evidence and custom/unknown labels |
| Feed enum/date migration breaks clients | Consumer failures | Frozen v1 and explicit v2; nested contract tests |
| New data incompatible with rollback code | Failed rollback or lost News writes | Expand/backfill/read switch; previous-code rehearsal; no casual restore |
| Contributor data handling mismatch | Private data exposure | Public-evidence-only prompts, exact provider policy qualification |
| Copyright/source access restrictions | Unusable fixtures or redistribution | Minimal evidence excerpts, access/terms assessment, explicit gaps |
| Brittle scrapers | Silent incomplete coverage | Parser-shape fixtures, completeness, typed health, source owner |

## 8. Proofing Checklist for Every PR

Is each claimed source actually qualified? Does a date retain its precision? Is
this a new development or baseline? Can the same input replay after a crash? Can
an old approval survive changed evidence incorrectly? Can this field leak from
review into public HTML/feed? Can a short run starve another lane? Can a nested
enum break v1? Does a failure preserve last accepted data? Does rollback preserve
later unrelated writes? Do the UI labels mean what the evidence actually proves?

Record answers with tests or a clearly owned qualification hold. A confident
sentence without evidence is not a completed acceptance criterion.
