# Independent review of the EX32 go-live plan

## Findings and disposition

**No unresolved material finding blocks this planning handoff.** This is acceptance of the plan's consistency and execution approach, not acceptance of GL implementation or public operation. All twelve GL packages remain `not_started` with null acceptance. Planning baseline: `60d6bd3aaba90a4970821f41fb2ca0329cbf8d20`; review date: 16 November 2026.

| Finding | Why it mattered | Resolution |
| --- | --- | --- |
| F01 — Standalone project admission was absent from the work-kind sketch. | The overview and source strategy allowed useful projects without a paper or repository, but the proposed DTO listed only repository, publication, preprint and discussion. An implementation following that sketch could introduce an unintended artifact prerequisite. | Sol added `project`, a stable internal identity and a nullable provider-native ID where none exists. The architecture now explicitly admits supported standalone project pages and keeps artifact-to-project grouping separately evidenced. I reread and accepted the bounded correction. |

No application code changed to resolve F01. The remaining recommendations below explain how the existing acceptance criteria should be applied; they add no new work packages, quotas or authorization gates.

## Product fit and proportionate scope

The [overview](README.md) maps all seven priorities to owners, packages and observable outcomes. The service is internal-first and publicly accessible, with direct go-live and no public pilot phase. Existing module names can remain during compatibility work. Public branding, navigation and route behavior receive deliberate review rather than a wholesale internal rename.

Lean admission requires useful supported facts and original links. Papers, complete biographies, resolved people, current employers, stars and journal prominence are optional. Repository, publication/preprint and project routes can stand independently. A source-scoped account page is useful without resolving a person. Missing enrichment cannot quietly become a rejection reason.

The [architecture](architecture.md) offers a feasible first release through a deterministic, reviewed snapshot. A PR workflow, existing maintained correction channel and operator-run batches avoid requiring a new editorial platform, scheduler or search service. Pagination and bounded list/detail responses address the actual 100-record contract limit. Further storage or retrieval complexity follows measured need.

The proposed performance and batch numbers are pre-run planning defaults. They are not promised throughput, a launch catalog quota or measured results. The separate reader-observation fallback avoids making recruitment a universal gate while leaving absent human validation unclaimed. Essential interactions, attribution, privacy and recovery still require evidence.

## Breadth must be demonstrated as a process

The [coverage plan](coverage.md) reaches beyond the current journal-linked examples. It combines institution/project routes, complete bounded account enumeration, topical discovery and independent publication/preprint discovery. User accounts, archived work, sparse descriptions and quiet repositories remain eligible. Caps and failed pages leave pending or incomplete states instead of apparent absence.

One admitted record may demonstrate several admission properties, but cannot establish broad coverage alone. GL09 also requires an explored-source inventory, scoped account completion, independent known-miss investigation, anti-concentration analysis and neglected-route follow-ups. Its combined-gap review matters: individually defensible deferrals cannot collectively leave the original narrow institution cluster as the effective product.

The nine-county exploration and non-Philadelphia Pennsylvania requirement permit a substantive gap decision when evidence or access prevents an admission. This is proportionate to a launch; equal county counts and fabricated records would be worse evidence. A gap decision must preserve the actual attempts, user impact, public wording and next investigation. It cannot convert blocked sources into exhausted ones or remove personal/paperless support.

These checks establish the declared exploration and useful discovery routes. They do not establish region-wide recall, a representative sample or completion of the original benchmark. Adding a handpicked missed item does not close a systematic enumeration or filtering defect; the responsible route must be repaired and rerun.

## Claim, interface and operating boundaries

The plan keeps native values, reviewed interpretations, historical affiliations and campus/county evidence separate. Ownership, authorship, contribution, identity resolution and citation directions remain different assertions. A postal label, hospital dataset or institutional headquarters cannot silently locate creators. The new project form extends that discipline without inventing a publication endpoint.

The proposed API and routes account for stable identities, renamed sources, versioned snapshots, bounded supporting records and cursor invalidation. Worker HTML and React consume shared validated contracts. Topic assignments can make `sleep AI` useful without treating an arbitrary substring or generic software as AI evidence. Compound queries cannot join unrelated neighbors to manufacture a match.

[Operations](operations.md) and [validation](validation.md) require correction/removal through lists, details, search, support records, counts and applicable caches. The latest removal ledger survives rollback. GL10 must exercise the integrated reader and correction paths after the independently developed components meet; an earlier component check cannot substitute for that final rehearsal.

Source methods, requests, retention and field use require their own bounded qualification. Public availability is insufficient, while richer-content permission is not a blanket prerequisite for factual links. Private candidates and suggestions cannot publish or trigger arbitrary remote fetches. A confirmed maintained report destination and an accountable operator with a real fallback or pause procedure precede release.

## Authority, adaptation and preservation

[Adaptation](adaptation.md) assigns Sol, Terra and Astra bounded roles and requires reviewers to inspect actual outputs. Routine implementation can proceed under existing authority. Material contract changes preserve old results, reopen affected consumers and repeat discriminating checks. New assumptions cannot retroactively turn a failed run into a pass.

The narrow reviewed-snapshot path does not accept WP14/WP16 or bypass their original storage guards. EX32 leaves the original model, 360-case benchmark and full-system E01–E06 obligations unearned. The current task authorizes documentation only. Future implementation, source actions and eventual release use their applicable authority; this review supplies none of those permissions.

The dependency graph contains twelve packages and twenty-two edges without a cycle. Every package reaches GL11, with seven goals and sixty distinct criteria represented. Work can overlap using shared fixtures, while acceptance and final integration retain their evidence obligations. The plan is sufficiently detailed without requiring every optional provider, a global person graph or comprehensive regional coverage before launch.

## Checks performed and limits

I read all seven planning documents, the machine-readable register and the five existing-document integrations. Independent local checks passed 310 structural and preservation assertions, including twenty-eight existing architecture anchors, the actual 100-record schema limit and current supporting-publication contract. Proposed new module paths are identified as proposals rather than existing capabilities.

The original thirty-one package objects and complete historical MP subtree compare equal to the baseline. All ninety-one frozen manifest entries retain their recorded hashes. Only the five intended existing documentation paths changed; no tracked application, configuration, model, source body, receipt or prior review changed. The historical catalog still contains twenty-eight records, 367 authorship entries and three separate regional contexts.

I also inspected the orchestrator's documentation check result: local file/heading links pass, the graph and criteria agree, and 1,106 other tracked files remain unchanged. Its secret scan passed over 1,096 files. The selected prose checks passed for the seven plan documents under declared lexical budgets; those checks do not establish technical correctness or formal model acceptance. The later sentence split in operations preserves its meaning and is included in my final input hashes.

Private review artifacts are retained under `/workspace/build/builderbob/tvd-go-live-plan-20261116/astra/`: `check-plan.py`, the initial `plan-check.json` and `plan-check-final.json`. These bind the inspected planning inputs before the final review link/status integration. The orchestrator should rerun documentation checks after adding that link and this review.

No application test suite, browser session, external acquisition, source enrollment, migration, merge or deployment was performed for this planning review. Historical EX31 qualification is referenced as history only. All GL implementation, reader, breadth, operating and release checks remain to be performed against their actual future inputs.
