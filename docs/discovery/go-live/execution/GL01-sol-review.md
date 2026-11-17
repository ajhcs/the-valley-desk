# GL01 independent review — Sol

**Disposition: PASS for the bounded GL01 contract increment; no remaining blocking finding.** This reviews the strict public work/snapshot shapes and separate private frontier boundary against accepted GL00 commit `5a395043fd3bbcad2cf8a2b8b08d84e0bcb572e9`. Root owns acceptance and integrated checks. No source is admitted, publication authorized, runtime activated or original WP14/WP16 obligation accepted by this review.

Reviewed 16 November 2026. Terra owns the implementation and contract explanation; Sol independently inspected the source, exercised adverse inputs and checked baseline preservation. Fictional test records establish structural behavior only. They are not acquired works, independent labels, source qualification or evidence of external truth.

## Findings and repairs

- **Sparse regional claims:** mandatory institution/municipality/county fields excluded supported independent work and encouraged invented county values. They are now nullable, with explicit PA/NJ state, a county/municipality/campus basis, matching required fields and referenced geographic evidence. Unknown county remains null; GL04 must establish the actual nine-county connection. One observation may support affiliation and geography when its content explicitly supports both.
- **Identity and shared-reference consistency:** snapshot checks now reject duplicate canonical native IDs, duplicate global claim IDs, conflicting reused evidence/review identities and duplicate directed relation triples. Installation-scoped IDs have an explicit HTTPS namespace. Independent probes also found that universal Unicode normalization merged distinct opaque IDs, and colon-concatenated tuple keys could collide. Other-provider IDs now retain exact spelling and use an unambiguous tuple key. Known DOI aliases normalize; explicit arXiv versions remain distinct. No cross-provider identity or person-name equivalence is inferred.
- **Impossible freshness:** an observation dated after `checkedAt` parsed successfully. The contract now rejects that ordering; source-event dates, regional as-of dates and checked dates remain separate fields.
- **Private staging boundary:** the first draft deferred all candidate outcomes. The separate private frontier now reuses `DiscoveryCollectionLead`, preserves source/scope/page/digest/index references, and has explicit provisional dispositions. Both outer and nested `publicationAuthorized` must be false. Needs-evidence, ineligible and duplicate outcomes require reasons; a duplicate requires a distinct target. Root requested the final module split, which prevents the public DTO importing private ingestion contracts.
- **Source links and malformed inputs:** safe post/line fragments are allowed on public and evidence links; installation namespaces exclude query/fragment components. A malformed namespace initially made `safeParse` throw. Both URL constructions are now guarded. The original pointer expression also exceeded a two-second timeout on only 30 slashes followed by an invalid escape; Terra replaced its overlapping repetitions. A 900-slash malformed input now rejects promptly, while valid escaped and root pointers remain supported.

All reported implementation findings were repaired by Terra and independently rechecked. Sol changed no application implementation or fixture.

## Acceptance criteria and scope

| Criterion | Independent disposition |
| --- | --- |
| GL01-A1 | **Pass for contract examples.** Paperless User- and Organization-owned repositories, a standalone project with null provider identity, independent publication/preprint/discussion kinds and absent optional owners are structurally valid. No GitHub/Crossref-only kind mapping is imposed. |
| GL01-A2 | **Pass for identity/relation guards and the documented admission boundary.** Missing health purpose, dangling/misdirected relations and identity/reference substitutions reject. Same-name works with different stable IDs remain separate. Generic AI, hospital-dataset geography, stars and campus/headquarters transfers require substantive evidence review at GL04; string syntax alone cannot detect a dishonest assertion. |
| GL01-A3 | **Pass for provenance and temporal shape.** Claims require known local evidence and review references; geographic roles bind to claim evidence. Invalid dates, county/state mismatches and post-check observations reject. Unknown county/current employment are not filled. Permitted source use, actual value support and real reviewer authority remain mandatory GL04 checks. |
| GL01-A4 | **Pass.** No biography, image, complete affiliation history, publication relation, popularity threshold or known software license is required. A permitted observation can support a reviewed short purpose despite a missing native description. |
| GL01-A5 | **Pass for the changed structural contract.** Native fields remain distinct from reviewed claims; malformed hashes, missing references, mismatched subjects/author scope and contradictory shared identities reject. A well-formed substituted hash or unsupported text can still parse, as explicitly tested: GL04 must reconstruct the retained observation and bind exact identity, field, value, date and review receipt before projection. No semantic hash-validation claim is made here. |

The bounded adaptation leaves public professional/project roles, creator resolution, first-seen history, archive/fork/successor labels and correction/removal references for reviewed versioned extensions before their first emission. Their absence is unknown, not false. This does not waive those later reader/maintenance requirements. GL03 now has the essential private staging shape; it must still resolve page/draft/index/duplicate references and implement durable state transitions. A ready disposition never grants publication authority.

Root's `GL01-D01` records this same scope and dependent GL03/GL04/GL06/GL07/GL08 obligations without changing the acceptance criteria. Independent readback agrees; the adaptation does not claim that optional creator or maintenance fields are already implemented.

## Independent verification

- **73 private adverse/positive probes passed**, including nested strict-field rejection, sparse paperless records, unsafe URLs, source/ref/date substitutions, scoped identity collisions, directed relations, private/public separation, provisional dispositions and malformed-input behavior.
- The actual focused file passed **21 tests**, none skipped, using `.discovery-work/wp12/run.sh node --import tsx/esm --test test/discovery-directory.test.ts`. App TypeScript passed under the same isolated Node 22.23.2 wrapper. `git diff --check` passed.
- **19 baseline/registration checks passed.** The existing catalog/selection, routing, pilot core, configuration and lock bytes remain exact against accepted GL00. All 28 record objects retain canonical digest `7d21281dfd8da10fe9b6d2f107d08558e80b695e1e5fb1560ee34aea281d6f01`; original 31-package objects, MP subtree and 91 frozen manifest entries remain unchanged.
- Root registered the new focused test exactly once in the actual enumerated `test:discovery` command. Removing that one token restores the prior package object exactly; dependencies and lock are unchanged. The new modules have no runtime consumers, and the public DTO has no ingestion import.

These counts overlap and are not an additive test total. No full suite, browser/Worker qualification, new native capture, enrollment, migration or deployment was performed by Sol for GL01. Root's integrated/exact-head checks remain separate. Restricted evidence is under `/workspace/build/builderbob/tvd-go-live-implementation-20261116/sol/GL01/`; immutable GL00 artifacts were not overwritten. The initial failed probe result is retained there separately from the repaired result.

## Scoped compatibility follow-up

**GL10 input robustness, with GL11 compatibility review:** the overlapping legacy pointer expression also exists in `src/content/discovery-pilot.ts:16` and the structured-evidence form in `src/content/watch-schema.ts:97`. These files are unchanged. Source tracing found no anonymous request-to-pointer path: the pilot handler accepts only GET/HEAD with `q`, `kind`, `provider` and `sort`, then imports its server-owned catalog; the page/client parse the same server response. The builder consumes local selection/evidence. Watch's proposal path reaches structured pointers through `EditorialProposal` after `handleReviewApi` authorization and POST rate limiting; public Watch requests supply filters/IDs, not evidence pointers. A malformed committed artifact or authenticated proposal could still consume parser CPU. This is a latent compatibility/input-robustness issue, not a demonstrated anonymous public exploit. Before later reusing or accepting less-trusted pointer inputs, assign a reviewed linear-pattern replacement, preserve each schema's root-pointer semantics and run the affected pilot/Watch suites. No legacy file was patched during GL01 review.

## Reviewed bindings

| Output | SHA-256 |
| --- | --- |
| [Public DTO](../../../../src/content/discovery-directory.ts) | `584f733c5679adb306d809899510028f4c5afc9e6f0991299dc25e11ec0b8fb8` |
| [Private frontier](../../../../src/ingest/discovery/directory-frontier.ts) | `9ffc3e427cb74f15199453f78b444e72ef18f4b28888e57a077685b4d8686990` |
| [Focused tests](../../../../test/discovery-directory.test.ts) | `47f490cfbbc5579c9df4c82b806d04ba8cc31dab32dfa251148e0107280d292f` |
| [Contract explanation](GL01-contracts.md) | `0f1479bc2133d9dafb2f73b60b224e8b9100c92503e2ecea6266c00a00c68ec4` |
| [Test registration](../../../../package.json) | `d541b63f7cbb24111f591d63efd0143a81baf7e8e21a6f319879ecd394ea76e1` |

Private probe result SHA-256: `84aee3ee2ef201e52c581524a933695848f7c3d4760d4b65a73de55073fbd900`. Baseline/registration result SHA-256: `89b449b76c0d0c50327ed77a897ed624189bcc4dd4e74dd340658d7efb0c2db2`. Changes to these reviewed contracts require a scoped recheck before acceptance or downstream use.
