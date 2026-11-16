# Independent product review and improvement check

16 November 2026. Astra reviewed the actual reader journey at baseline `4c87611`,
then independently reviewed and exercised the orchestrator's resulting changes.
This is a fresh product review, distinct from the earlier correctness qualification.
The user wanted the directory to make it easier to find who is doing what and
understand the regional/source connection. No production deployment was requested.

## Product findings and disposition

| Priority | Baseline finding and reproduction | Reviewed improvement |
| --- | --- | --- |
| P1 | Search `CaPTk` with Publications: zero results despite a retained citation. `MRI` found the paper but missed its linked repository. | The two existing citation edges supply bounded related-record search context. CaPTk now finds its paper with an explicit explanation; MRI finds QSIPrep's repository. Internal metadata links work in both browsing directions while preserving repository-to-paper citation meaning. |
| P1 | Search `Philip Cook`: zero results despite the retained QSIPrep author. Only seven of 109 native author entries were projected. | All 109 source author entries are preserved and searchable, without merging people. Philip A. Cook appears in the matching preview; QSIPrep exposes all 42 entries. |
| P1 | Repository names, owners and dates did not explain what the work did. Four short source descriptions were already retained. | Those four `/description` values are traced and rendered as plain source-reported metadata. The other two remain null. No README or article body is copied. |
| P2 | At 390×844, search began at y=688, Apply at y=833, the first card at y=1,114 and its original-source action at y=1,785. | Compact copy, a collapsed provider filter and earlier actions move these to approximately y=456, 591, 770 and 973. Search and submission are visible without scrolling; the first result title starts at y=816, with its first line visible in the first viewport. |
| P2 | AutoGVP flattened Rockville and Philadelphia affiliations into an unassigned block, then repeated them when named authors expanded. | The default preview attaches affiliation text to names; a matching author is prioritized. Opening the complete roster removes that preview. Naqvi's Philadelphia text remains with Naqvi; Kim's Rockville text remains with Kim. |
| P2 | Citation links ran together, the mobile evidence target was about 102×19 px, and useful source information competed with hashes and exact timestamps. | Metadata, original-source and citation-evidence actions are separate. Capture dates are readable; hashes/pointers remain under a technical-trace disclosure. Related actions have at least 44 px CSS height. |

These changes materially address all six findings within the accepted finite
metadata scope. They do not establish a complete regional directory, current
employment, clinical efficacy, individual software contributions or new citation
relationships. A repository found through a paper retains its own empty author
array and unestablished work location; the result explains the related match.

## Additional implementation finding repaired

During independent v2 review, the response schema accepted a citation summary
whose publication title and HTTPS URL contradicted the displayed publication
with the same ID. The UI consumed that summary for related links. The
orchestrator repaired the boundary before freeze: selected endpoint summaries,
selected-repository link/evidence fields, match direction, unique items/citation
pairs, necessary context and count coherence are now checked. The reproduced
wrong-title response is rejected both by the schema and by the actual browser,
which shows the fixed unavailable state. This validates internal consistency;
it does not create a new external source-authentication claim.

The orchestrator also corrected an inherited nested main landmark/duplicate
`main-content` ID in the pilot shell. Fresh browser inspection sees one main
landmark and one such ID.

## Independent checks

Nine new targeted Node groups pass. They cover exact v2 projection, all source
author entries and affiliations, incomplete/reordered/duplicate author rejection,
description pointer/value drift, the reproduced search tasks, related-result
filtering without copying identities/geography, prevention of term aggregation
across different neighbors, citation endpoint/result consistency, author preview
mapping, partial dates, safe directory links, strict response fields, response
size and disabled-loader behavior. Three retained assembled Worker/bundle groups
also pass on the revised files: exact disabled routing and methods, encoded
near-route nonexposure, and no tested catalog/private-data markers in browser
assets. These counts overlap normal regressions and are not additional unique
coverage claims.

One initial probe expected Davatzikos to find only CaPTk's repository. The newly
complete source roster correctly also finds QSIPrep through its existing edge.
The probe was corrected to preserve both matches and verify each unchanged
repository; the initial failed log is retained as a harness assumption, not a
product failure or a clean initial run.

Fresh browser steps and results:

1. Enter the desktop directory: fourteen meaningful cards, readable descriptions
   and dated source labels.
2. Search CaPTk within publications: the expected paper appears with a
   citing-repository explanation.
3. Follow its local repository metadata action: CaPTk opens within the directory,
   with its source description and separate publication/evidence actions.
4. Search Philip Cook: QSIPrep appears and the author preview names Philip A. Cook;
   the complete roster contains 42 entries.
5. Enter the mobile directory: search and submission fit in the first viewport;
   no horizontal overflow at 390 px.
6. Search Naqvi and inspect the mobile result: his Philadelphia affiliation stays
   attached to his name.
7. Expand AutoGVP's roster: fourteen named entries appear, the preview disappears,
   and the 2024 publication-affiliation qualifier remains visible.
8. Recheck the final rebuilt mobile and desktop shell: one main landmark and one
   `main-content` ID; final mobile measurements are recorded above. The last
   compact result-count/About row was separately rechecked: About opens at
   350px width and wraps within the 390px viewport without horizontal overflow.
   Fresh screenshots `12-final-mobile-compact-row.png` and
   `13-final-mobile-about-open.png` record this final layout.
9. Supply a contradictory citation response: the browser rejects it with a bounded
   unavailable state and renders no cards.
10. Supply HTML-shaped description text: it renders literally, creates zero image
    elements and executes no injected handler.
11. Search MRI within repositories: QSIPrep appears with its functional description
    and local publication action.
12. Tab from search: focus reaches the labeled record-type control. No uncaught
    application error occurred in this exercised sequence.

Playwright 1.64.1 and existing Chromium headless shell 1248 ran against the
loopback preview at `http://127.0.0.1:4178`, with 1440×1000 and 390×844 viewports.
The Browser plugin was unavailable; the established fallback and workspace
library path were reused without installation. Actual existing Google Fonts
loaded. Original-source DOI navigation in the baseline audit was intercepted;
no publication body was fetched. The Product Design audit skill, its router,
critical overrides, context preflight and audit framework guided the review.
No saved Product Design context was present.

## Source-field review

The four exact descriptions are short functional metadata: QSIPrep 30 characters,
CaPTk 165, Phenomantics 87 and DeepCNV 73. Inspection found no contact address,
markup, patient information or copied README/article passage in these values.
CaPTk's documentation URL stays passive text. Exact values, pointers and retained
body hashes are recorded privately. GitHub's official API terms were checked
again; use remains subject to those terms, not a blanket software/full-text
license or CC0 dedication. No new native source request was made. The author
rosters come from the same six retained Crossref metadata bodies, and only the
same two citation observations supply related context.

## Evidence, remaining polish and limits

Private current-run evidence lives under
`/workspace/build/builderbob/tvd-pilot-product-review-20261116/astra/`.
`product-review.md` contains the baseline's twelve inspected screenshots and
full reproduction notes; `descriptions.json` records exact field inspection.
The `fixed/` directory contains inspected after-change screenshots, DOM snapshots,
`captures.json`, `core-probes.mjs`, `core-probes.log`, the retained initial probe
log, `worker.log`, `review-result.json` and `reviewed-input-sha256.json`.
The final latter manifest binds the nine changed implementation/test inputs
reviewed here. The earlier qualification review and receipt are left unchanged.

Remaining polish is bounded: further compact the inherited mobile site header,
explain mixed source-date sorting near its control, and consider a more readable
internal record address than a numeric-ID search. The default mobile record title
now starts within the first viewport, with its first line visible; its complete
long title and original-source action still require scrolling. Search/action
placement and distance to that action are substantially improved.
Long author rosters remain intentionally expandable. Only two projects currently
have represented citation context; additional relationships require their own
field/observation review, not a guessed title join.

No remaining finding blocks this local improvement pass. Full-suite qualification,
final metadata reconciliation and delivered-head CI remain the orchestrator's
separate evidence. This was an expert task-based review, not a user study or
complete accessibility conformance audit. Other browsers, assistive-technology
coverage and production operation remain unqualified. Public activation,
deployment and benchmark acceptance were not authorized by this review.

## Final EX29 metadata reconciliation — 2026-11-16

The preceding pending-qualification statement records the earlier review point.
Final reconciliation now binds the reviewed implementation to source commit
`2f013debf1e499e072830f7a820fe416db3b3cfc`. All nine implementation/test hashes
match both my independent freeze and that commit. All 630 runtime-input hashes
remain unchanged. Before this append, all nine runtime outputs, eight document
outputs and 105 private-artifact hashes in the EX29 receipt matched their files.
This append changes only the receipt's hash for this review; the orchestrator
must refresh that entry before committing the final metadata.

I read the retained final test summaries: 939 application, 146 Watch and 352
Discovery tests passed, totaling 1,437 with zero failures, skips or cancellations.
The seven PDF regressions, build, isolated smoke and secret scan passed; the
dependency audit reports zero vulnerabilities. The retained post-build Worker
log has three passing groups, and the root browser result records 25 passing
assertions without application errors. These are reconciled results from the
orchestrator's run, not newly executed independent tests or additive coverage.

Byte/hash comparisons confirm all 91 frozen manifest entries, the three native
model/contract/receipt files, material index and strict reference manifest are
unchanged. The original 31 package objects and existing release controls are
unchanged. All 99 earlier tracked receipt/review files match the pre-amendment
baseline. MP01–MP03 retain their previous acceptance objects in history; MP00
and MP04 are unchanged. The actual benchmark still contains zero cases and zero
human reviewers and remains `not_frozen`.

The EX29 receipt, execution state, decision record, README, plan, source note,
preview instructions and product report agree on the bounded result: fourteen
source records, 109 source authorship entries rather than distinct people, four
short descriptions, two existing directed citation edges, and no new acquisition
or full-text inclusion. The source projection has 209 native field pointers and
six references to the existing derived observation. I found no claim of verified
current roles, regional completeness, benchmark acceptance or deployment.

No metadata discrepancy remains. Exact delivered-head CI is still a separate
handoff requirement on PR30; MP04 and public activation remain held. The private
`fixed/ex29-metadata-reconciliation.json` records this check. The earlier review
and receipt remain historical and were not modified.
