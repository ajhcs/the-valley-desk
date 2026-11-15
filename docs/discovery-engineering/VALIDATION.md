# Handoff validation

Status: **passed for the declared documentation checks**. This record concerns
handoff quality only; every implementation package and E01–E06 investigation
remains unexecuted. The package contains 31 work packages, 171 numbered acceptance
criteria, 101 original scope mappings, 18 requirements, 32 retained formal
families and six empirical gates. The dependency graph is acyclic.

## Independent challenge and repairs

Sol, Terra and Astra authored bounded package sets, then reviewed other sets or
shared contracts. The orchestrator adjudicated the findings. The following
findings were retained and repaired in the planning documents; none represents
an implemented product fix.

| Finding | Disposition |
| --- | --- |
| Policy freeze accidentally requested later empirical results | WP01 uses calibration/rubric cases; final E01–E03 remain WP24. |
| Review UI acceptance lacked its publication dependency | WP15 depends on WP16; acceptance separates durable decision from public commit. |
| Accessibility qualification lacked actual review UI input | WP20 depends on WP15 as well as reader/routing packages. |
| UI acceptance depended implicitly on later final E05 | WP18/WP20 use formative development observations; WP24 owns final E05. |
| Public methodology was mapped but had no concrete deliverable | WP18 adds the page/route; WP21 owns its coverage data; WP23 checks integration. |
| Reporting performance measurements could count as passing | WP20 requires the frozen targets, with unresolved failures blocking qualification. |
| Completed overloaded pilot could count as release-ready | WP25 needs a separate `release_ready` disposition against frozen operating criteria. |
| General editorial scope had no capacity decision | WP01 sets new-content priority separately from legacy route/consumer support. |
| Provider qualification introduced a dependency loop | WP06 qualifies transport with a representative synthetic adapter; actual route access belongs to provider packages and E04. |
| Query limits, route naming and 410 codes differed | WP17 is reconciled with the shared architecture contract. |
| A restored old epoch could reactivate a revoked cursor/claim | External recovery incarnation and post-backup correction reconciliation added to architecture/WP26. |
| Retention was unconditional after permission revocation | WP05 distinguishes failed refresh from changed retention rights and dependent invalidation. |
| Repair based on held-out failures could reuse consumed evidence | WP14 uses development cases for iteration; changed candidates require untouched evaluation. |
| Funding wording implied an unplanned external funding prerequisite | G3 requires resourced capacity within approved caps. |
| Shared dependency vector omitted named source/rule revisions | WP02 explicitly includes enrollment/configuration, qualification, permission/revocation and verification-rule revisions. |
| Correspondence could stop at the historical proof inventory | WP23 includes new successor creator, rights, snapshot and recovery obligations. |
| Differential query tests omitted organizations/projects | WP23 requires every exposed query kind and distinct creator ordering. |
| Reader acceptance omitted recurring snapshot restarts | E05/WP24 consume measured restart counts/lifetimes under representative correction and expiry cadence. |
| Full qualification was implied before its first sample request | E04 distinguishes bounded qualification-only requests from subsequent routine collection/evaluation. |

The [check summary](validation.json) verifies metadata, scope/requirement
allocation, dependency acyclicity, acceptance identifiers, local links,
frozen-file hashes and the documentation-only diff. The [prose report](prose-validation.json)
checks selected lexical budgets on all 40 authored Markdown documents, including
visible table cells and command lines; frozen historical artifacts are excluded.
Budgets are 60 words per sentence, 160 per paragraph and 5,000 per document for
these technical specifications. This is a bounded lexical check, not a semantic
or full controlled-English verdict. These checks cannot establish
semantic completeness, software correctness, source truth, real access, clinical
validity, user usefulness or production acceptance.

Retained initial reports are in [validation-history](validation-history/).
The initial metadata check caught one newly added acceptance criterion missing
from the index; it was synchronized. Initial prose findings identified four
lists concatenated as long paragraphs; Markdown list-item spacing was clarified
without changing their meaning, then all documents passed. An earlier checker
orchestration syntax error occurred before execution and produced no verdict.

The [handoff manifest](HANDOFF-MANIFEST.json) binds the delivered package bytes.
The independent [baseline manifest](baseline/tvd-concept-v0.4/MANIFEST.json)
retains hashes for 21 byte-preserved authored baseline files. All original model
and selected-scope hashes match their retained source files.

No application tests/builds, model/proof reruns, live ingestion, source enrollment,
schema migration, scheduler changes, participant contact, deployment, commit or
push were performed. Frozen model bytes were copied and hash-compared only.
