# Pilot product review and repairs — EX29

The user requested an Astra review of the pilot and expected ownership of its
improvements. The review began from `4c87611` with fresh screenshots and actual
desktop/mobile tasks. The existing default-disabled metadata scope, optional
full-text reuse, separate benchmark and deployment hold remain in force.

## Findings and decisions

1. **Known citation context was missing from search.** CaPTk plus Publications
   returned nothing; MRI missed the repository associated with its retained paper.
   Search now considers a record's own metadata and at most one validated citation
   neighbor. The result explains an indirect match. It never combines separate
   neighbors to manufacture a match or adds guessed relationships.
2. **People search omitted retained authors.** Only seven of 109 authorship
   entries were projected. All six source rosters are now preserved and searchable
   (42, 25, 14, 9, 9 and 10 entries). Philip Cook finds QSIPrep. This is neither
   109 distinct people nor 109 verified regional creators; names remain attached
   to their source publication and affiliations. Source order is retained.
3. **Repository purpose was hard to understand.** Four retained short GitHub
   descriptions are now displayed as passive, source-reported metadata. Two null
   descriptions stay null. No README, article body or new source fetch is needed.
4. **Mobile layout delayed access to the work.** The introduction and secondary
   provider selector occupied most of the first screen. The revised view uses
   compact copy, a secondary-filter disclosure, a single count/About row, and
   earlier original-source actions. In the same root 390×844 capture setup with
   fonts intercepted consistently, the first card moves from y≈1,205 to y≈770;
   its title begins at y≈816. The full long title and source action still require
   scrolling. This is a layout observation, not a user-study speed claim.
5. **Affiliations lost their author pairing and repeated.** The revised preview
   pairs each name with its own source affiliation. A query-matched author is
   prioritized; opening the complete roster removes the preview. Raw affiliation
   text is no longer flattened into a second aggregate block. Publication dates
   and unverified current roles remain explicit.
6. **Evidence actions lacked a clear hierarchy.** Local metadata, original-source
   and citation-evidence actions are now distinct. Both browsing directions use
   the same repository-to-paper citation evidence, without asserting a reciprocal
   citation. Readable capture dates precede the optional technical trace.

The [independent review](reviews/metadata-link-pilot-product-astra.md) records
Astra's twelve baseline audit steps, revised interactions, source inspection and
remaining polish. All six findings were addressed before the runtime freeze.

## Additional defects found during the repair

Independent v2 review reproduced a response that supplied a false citation title
and URL while displaying the correct paper with the same ID. The repaired result
boundary checks selected endpoint summaries and evidence, duplicate records and
citation pairs, needed context, match direction and counts. The browser rejects
the contradictory response. This checks consistency, not external authenticity.
Permanent regressions retain the case.

The root review also found that the pilot nested a main landmark and repeated
`main-content` inside Layout's existing main. The pilot is now a labeled section;
browser checks find one main and verify the skip link reaches it. Existing site
header styling was retained. No public navigation or production flags changed.

## Observed reader journey

| Step | Task | Result in the reviewed build |
| --- | --- | --- |
| 01 | Enter desktop directory | Fourteen source records, clear purpose and source dates. |
| 02 | Search MRI within repositories | QSIPrep is found with its retained description. |
| 03 | Search CaPTk within publications | Its paper is found through the retained citing repository. |
| 04 | Inspect the repository | Owner remains an account role; purpose and dates are visible. |
| 05 | Inspect provenance | Source/use basis is readable; exact hashes/pointers stay available. |
| 06 | Search Philip Cook | QSIPrep appears; its complete 42-entry roster is inspectable. |
| 07 | Search Naqvi | His source affiliation remains under his name. |
| 08 | Expand authors | All source entries appear; the shorter preview disappears. |
| 09 | Enter mobile directory | Search, filters and the beginning of the first result are visible. |
| 10 | Inspect mobile result | Named affiliation context replaces repeated address blocks. |
| 11 | Follow local metadata / citation evidence | Local and external actions have separate labels and targets. |
| 12 | Open an original source | Correct DOI/repository action; automated DOI navigation is intercepted. |

The root's final browser verification exercises twenty-five assertions, including
filter URLs, empty states, secondary-provider filtering, source-role separation,
main/skip behavior, mobile overflow and the JavaScript-disabled citation lookup.
Astra independently exercises nine new core groups and three retained assembled
Worker/bundle groups plus browser and hostile-response probes. These overlap the
normal suite and are not summed as independent coverage.

## Environment and evidence limits

The Browser plugin is absent. The established existing Playwright 1.64.1 /
Chromium headless shell 1248 setup was reused against the isolated loopback Worker
at `127.0.0.1:4178`. Root captures use 1440×1000 and 390×844 with external font
requests fulfilled locally, matching its before/after setup. Astra also captured
with the existing fonts loaded and inspected every accepted screenshot. No new
dependency was installed. Source-provider pages were not automatically acquired.

Current-run artifacts are outside Git under
`/workspace/build/builderbob/tvd-pilot-product-review-20261116/`. Root retains
baseline captures, first-pass captures, final captures, DOM/geometry observations
and browser scripts/results. Astra retains the initial twelve-step report,
description inspection, independent probes, repaired-build captures and input
manifest. One independent probe initially expected Davatzikos to find only CaPTk;
the complete source roster correctly also finds QSIPrep. The corrected expectation
and failed initial log are retained. A later optional baseline query encountered
the stopped preview and was not used as audit evidence.

Expert review and the exercised keyboard/responsive checks do not establish full
accessibility compliance, other-browser behavior, measured relevance accuracy,
regional completeness, clinical validity or current employment. Only the two
existing citation edges are represented. Further source coverage, additional
reviewed relations and current creator profiles remain future work. The inherited
large main-bundle warning remains. Full-suite and exact-head CI results are linked
from the new receipt; earlier receipts retain their historical scope.

## Local qualification

Source commit `2f013debf1e499e072830f7a820fe416db3b3cfc` passed 939 application,
146 Watch and 352 Discovery tests: 1,437 executed, zero failures, skips or
cancellations. Seven PDF regressions, build/typecheck, isolated local smoke,
dependency audit (zero reported vulnerabilities) and secret scan passed. All
630 runtime inputs stayed stable. After the final build, the root reran all
25 browser assertions and the three assembled Worker/bundle groups; fresh
desktop/mobile captures were inspected. These reruns overlap suite coverage.

The EX29 receipt binds these results, source inputs and independent review.
PR30 separately records final delivered-head CI before handoff completion.
MP01–MP03 are locally reaccepted for this amendment; their previous acceptance
records remain in history. MP04 stays held.

## Handoff

The [active plan](metadata-link-pilot-plan.md#ex29--product-review-improvements),
[source-use basis](metadata-link-pilot-sources.md#ex29-field-expansion-after-product-review)
and [preview tasks](metadata-link-pilot-preview.md) describe v2. The new API/catalog/
selection versions identify the changed complete-roster and citation-context
contract. The [EX29 receipt](receipts/metadata-link-pilot-product.json) records
qualification after the final run. Delivered-head CI is tracked on PR30.
The original 31-package ledger, frozen model, source-material index and empty
WP03 benchmark remain unchanged. No merge, public activation or deployment occurs.
