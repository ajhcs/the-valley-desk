# Validation, launch evidence and release

EX33 authorizes implementation with Terra and independent Sol review, and deployment of the readiness-qualified existing-site candidate. The methods and thresholds below remain proposed until their package is executed; earlier planning-only language describes EX32 and does not revoke that later authorization. No deployment has occurred.

This is a future evidence plan. The GL checks below are **not run**. The historical source baseline and CI results are in the plan overview. Neither those earlier results nor a review of this document establishes the future service's usefulness, breadth or operational acceptance.

## Scope and evidence types

Verify the implemented contracts with source inspection, deterministic tests and actual Worker/browser behavior. Validate the intended use with representative discovery tasks and an independent scoped miss investigation. Rehearse updates/removals/recovery in isolation. After separately authorized go-live, read back the served system.

The original WP03/E01–E06 reference benchmark remains separate. These development records, curated topic cases, internal reader observations and known-project diagnostics cannot be promoted into fresh held-out labels or region-wide accuracy estimates. No 360-case benchmark or public pilot phase is required for this explicitly scoped lean launch.

## Required evidence by goal

| Goal | Claim to assess | Method / observable | Owner / challenge |
| --- | --- | --- | --- |
| G01 | A new reader can find work from the homepage. | Browser demonstration of home → query/browse → result → original source; observe copy comprehension and route preservation. | Terra / Sol |
| G02 | Ordinary supported vocabulary produces useful results. | Freeze query cases before tuning; verify actual result IDs, explanations, negative cases, facet counts and stable order. | Terra / Sol |
| G03 | Compact results support a decision without hiding qualifications. | Inspect claim-to-source bindings, then observe a reader explaining purpose, health relevance, region/date and next action. | Terra / Sol |
| G04 | Lean creator/institution paths have correct identities. | Adverse same-name/account tests and actual detail/institution journeys, including unresolved people and missing optional links. | Terra / Sol |
| G05 | Discovery reaches less visible eligible work and exposes scoped gaps. | Execute frozen bounded exploration, compare declared explored account inventories and perform an independent miss/bias review. | Terra / Sol |
| G06 | The small team can maintain public facts. | Actual permitted batch, measured effort/backlog, suggestion triage and isolated update/correction/removal plus search/cache checks. | Terra / Sol |
| G07 | The candidate is usable and recoverable in its declared envelope. | Browser/accessibility/performance tests, private-output/intake probes, full required CI, isolated release/rollback and actual release readback. | Orchestrator / Sol |

## Freeze the task and measurement envelope

GL00/GL01 select the initial examples and success definitions. GL02 freezes the explored inventory and miss diagnostic before acquisition. GL10 freezes device, data, timing and observation conditions before performance or reader evaluation. Preserve the versions, actual inputs, commands, resulting artifacts and failures.

Initial engineering targets below are **proposed planning defaults**, not measured results or contractual claims. The orchestrator and Sol can replace them before a run with an evidence-based envelope. A replacement after a failed run creates a new decision and run; it does not change the failed result.

| Item | Proposed initial envelope / criterion | Meaning and revision rule |
| --- | --- | --- |
| Catalog | Measure actual release data and a 2,000-work growth fixture with representative links, sparse facts and unusually large details. | 2,000 is a design probe, not an admission quota or proof of maximum capacity. Revise from the first acquisition/size measurement. |
| List delivery | 25 default items, no more than 50 per page; response at most 256 KiB decoded JSON, including necessary support. | Never truncate a required binding silently. Split list/detail or reduce page size if a valid case cannot fit. |
| Query response | Server p95 at most 500 ms across 100 recorded representative local/staging queries after a separately recorded warm-up. | State environment, concurrency and cold-start observations separately. This is not a production SLO or internet end-to-end result. |
| Reader interaction | Under the selected mobile test profile, p95 search-to-updated-results at most 1 second and first usable results within 3 seconds across ten runs. | Record network/CPU profile, timing boundaries and sample limits. Change only through a pre-run decision or a documented redesign/retest. |
| Viewports/browsers | At least 390×844 and 1440×1000; Chromium plus one other supported engine/browser. | Small widths, keyboard and long strings must not hide essential actions or create horizontal overflow. |
| Reader observations | Start with two available internal users and four critical tasks per user; repeat repaired failures. | Small formative evidence, not statistical validation. Use existing authorized participation; no external recruitment is implied. |
| Operating effort | Begin with the proposed manual batch in operations.md; measure actual active time and unresolved queue. | Choose approved effort/request caps before the batch. No paid plan, hiring or recurring schedule is assumed. |

If two human readers are unavailable, do not fabricate a panel or make recruitment a new universal gate. Record which actual internal-use observations exist, run independent engineering task demonstrations, and obtain a scoped usability-risk disposition from the accountable release owner. Missing human validation stays explicitly unclaimed. Correctness, privacy and essential interaction failures cannot be waived by calling the service internal-first.

Measure every rate with its numerator, denominator, exclusions and observation window. Cache the exact input fixture for local performance experiments. Keep release data and synthetic growth fixtures distinguishable. A generated 2,000-work fixture supplies load, not additional real coverage.

## Frozen functional and adverse cases

Keep explicit expected native/public identities rather than fuzzy title-only assertions. Add new genuine cases as discoveries emerge; retain the original cases through repair.

- Search `sleep`, `Camden sleep`, `sleep AI`, Mercer County, Camden County, Gloucester County and Rutgers-Camden variants. Verify a supported AI topic rather than raw substring matches in unrelated words.
- Look up exact repository IDs/paths, DOI and source-scoped names. Preserve all nine historical citation-pair regressions and 22/28-record source-object comparisons while the compatibility adapter is relevant.
- Find a paperless user-owned repository via account/institution discovery and a standalone paper/preprint via an independent publication route. A missing paper or optional person must not remove a valid listing.
- Find a supported non-Philadelphia Pennsylvania connection and follow the remaining Burlington/other-county exploration outcomes. Keep inaccessible or unresolved routes explicit.
- Reject a generic AI project without a health-tech contribution, a hospital dataset used as geography, headquarters transferred to every campus, and a star/fork used as local-creator proof.
- Keep a GitHub account, a same-named publication author and a verified person distinct. An account page can exist without person resolution.
- Preserve repository→paper and paper→code relation directions. Include a related support record without treating it as an extra result or allowing an unrelated neighbor to satisfy a combined query.
- Rehash a deliberately changed source observation or review manifest; reject wrong identity, source pointer, author index, date, relation endpoint and unapproved field despite matching the altered hash.
- Handle source transfer/rename, supported substantive fork, mirror, archived project, unknown date and a sparse record. Last checked, first seen and source-event dates must remain distinct.
- Reject unsafe URL schemes, unexpected fields, duplicate query keys, oversized requests/responses, hostile source text and unauthorized mutation. Suggestions cannot initiate arbitrary remote fetches or publish facts.
- Correct a campus association and remove it from old county searches, cards, details, support records, counts and applicable caches. Invalidate old cursors explicitly.
- Roll back to older code/data after a removal; reconcile current tombstones and verify the removed content stays absent.
- Run with JavaScript unavailable, keyboard-only input and an available screen reader. Exercise empty/error, long-title, disclosure, focus/back, withdrawn-record and expired-snapshot states.

Use existing test infrastructure and meaningful contract-level adverse cases. Add any new suite to the actual enumerated package command; an uninvoked test file is not CI evidence. Avoid implementation-mirroring tests with no plausible failure mode.

## Breadth acceptance and gap decisions

GL09 acceptance requires actual diverse discovery, not just successful retrieval of the current 13 repositories. The first exploration cap is not the final catalog target. Repeat small batches when the first cycle reveals a significant blind spot.

At release review, retain:

1. The frozen county/source/account inventory and the actual attempted/completed/incomplete states.
2. At least account enumeration and an independent topical/institutional route, plus an independent publication/preprint route. The launched public type set matches actual qualified content.
3. Demonstrated admission without publication evidence, supported user-account work and work discovered through a non-news route. These describe admission/acquisition properties; they do not claim no paper or news article exists anywhere.
4. An anti-concentration review comparing the attempted frontier and admitted set with the original dominant institution cluster, with neglected-route follow-ups.
5. Independent investigation and repair of known eligible misses within declared explored sources. Repeat the relevant enumeration, filter or review check after the fix.
6. A reviewed disposition for every material remaining gap: cause, user impact, visible wording, owner and next bounded investigation. Consider the combined gaps, not only each in isolation.

A refused optional forum is not an automatic whole-site hold. A dataset that still systematically requires papers or excludes personal accounts fails the chosen scope. Incomplete pages cannot be labeled fully explored. A numerical catalog total, nine map dots or a high score on the development diagnostic cannot prove region-wide recall.

## Reader success definitions

Ask readers to find unfamiliar work relevant to a stated health-tech problem, identify its supported regional connection and follow an appropriate original link. Include a quiet repository, a standalone publication and a sparse record across the observations. Ask what the visible dates, owner/author labels and regional wording mean without coaching.

Success means the reader reaches an eligible source-backed result, correctly understands the relevant affiliation/ownership/date boundary and can identify a useful next action. Record assistance, dead ends, misleading results and time as observed. A correct click reached only through author coaching is an assisted attempt. New topic/search behavior returns to GL01/GL05; confusing cards to GL06; false identity to GL04/GL07; missing work to GL02–GL04/GL09.

An available internal user can be the business owner using the service in an actual research task. A developer who already knows all target records is not an independent discoverability test. Agent/browser scripts supply repeatable engineering checks; report them under that label.

## Release blockers, acceptable gaps and readback

Block release for a materially false local/creator claim, private or sensitive-data exposure, publication-authority bypass, unauthorized source action, broken required legacy consumer, failed essential reader interaction, unsafe update/removal or unverified recovery. Hold the affected record or feature when a narrower safe release remains useful. Source incompleteness and optional enrichment have their own explicit dispositions; they are not blanket permission or hiring barriers.

Freeze the exact code/data/alias/source-policy versions and build/configuration identities. Reuse earlier evidence only when its input and scope still apply. After implementation changes, preserve the existing full application tests, mandatory PDF checks, build/typecheck, isolated ops smoke, dependency audit and secret scan, with required exact-head CI. Existing slow suites should run at integration/release checkpoints rather than after every copy edit.

Rehearse disabling discovery without damaging News/Events/Watch, switching to a permitted prior projection, preserving removals and returning to the candidate. Document additive migration and recovery behavior only if a measured design change actually introduces storage changes. Do not acquire a database migration or scheduler merely for a naming change.

Prepare a release packet containing the candidate, checks, operating roles/channel, source/coverage limits, stopping thresholds, release commands, rollback target and readback cases. Verify applicable deployment authority before execution. Then read back home, ordinary search, paperless work, publication, creator/institution path, source actions, correction channel, coverage labels and legacy feeds/routes from the actual service. Check served code/data identity, error signals and withdrawal behavior. Deployment success and operating acceptance are separate recorded outcomes.

## Planning-document verification

Before delivering this handoff, inspect the seven-goal mapping, work-package dependencies, source-file anchors, local links, proposed-versus-observed wording and adaptation rules. Confirm that original package objects, frozen models/manifests, source bytes and historical receipts/reviews remain unchanged. Run appropriate documentation/secret checks. Retain the independent plan review separately from all unexecuted implementation and launch evidence.
