# Discovery evaluation preparation v1

WP03 preparation candidate · 2026-11-14 · design `wp03-evaluation-design-v1`.
The reference manifest is **not_frozen** and contains zero cases, sources or
reviewers. No real labels, independent corpus, participant recruitment, provider
access or empirical results have been supplied. This protocol fixes a proposed
local evaluation design for review; it does not mark WP03 accepted or E01–E05
executed. WP02 interfaces are still subject to their independent review.

The governing inputs are [WP03](../discovery-engineering/work-packages/WP03.md),
[EVIDENCE](../discovery-engineering/EVIDENCE.md),
[policy v1](../discovery-policy.md) and [shared interfaces](interface-contracts.md).
Use the typed subject, provider identity and revision references from
`src/content/discovery-schema.ts`. Provider/native identities remain distinct from
reviewed cross-provider equivalence. `institutional` includes associations and is
one of six routes, alongside `github`, `pubmed`, `crossref`, `arxiv` and `forum`.

## Sets and selection

| Set | Prespecified requirement | Assembly and use |
| --- | --- | --- |
| Development | Nonempty, separately identified | Rule/classifier/ranking development; never a replacement held-out evaluation. |
| Held-out | Exactly 360 canonical cases; exactly 60 per primary route | Independently assembled frame, frozen selection method and positive, negative and ambiguous cases within each route. Distinct works may share a creator or project within this partition. |
| Recall | At least 100 independently assembled eligible canonical cases | External research frame with source scopes and time window; assembled without product retrieval, published output or model suggestions as truth. Report remaining statistical clustering. |
| Admitted audit | Freeze the selection procedure in WP03; execute ≥100 independent admitted items in WP24 | Prespecify complete admitted-frame definition, interval rule and random/systematic selection or complete enumeration. WP24 supplies actual frame, interval, seed/order, exclusions and observations. Never select only successful examples. |
| Challenge | Separately identified cases when needed | Targeted failure diagnosis; never mixed into prevalence estimates or the audit denominator. |

Assign whole person, project and provenance-origin families to one side of the
development/held-out boundary before selection. Distinct works from the same
creator/project may share the held-out partition; retain their correlation for
metric interpretation. Recall and audit may overlap each other or the reference
sets according to their separately documented sampling design. They do not create
additional disjoint-family quotas. If the actual canonical-case quotas cannot be
met, extend permitted collection or retain the hold; never invent eligibility.

One canonical case has one primary route. Other route appearances remain
attributes supported by source identities; they add no quota credit. Review DOI
copies, arXiv base/version and journal relationships, repository mirrors/forks,
syndicated pages, account aliases and source-origin relationships. Do not infer a
person or project join from a matching name/title. Store reviewed equivalence
keys and every relevant people/project/origin family. The validator additionally
detects identical subject IDs, provider/native tuples and representation bytes.
Connected overlaps are transitive. Only underlying-case/origin-equivalent copies,
versions or mirrors collapse quota credit; shared creator/project membership alone
does not merge distinct works. A missing real-world equivalence cannot be
discovered from invented IDs by a schema: independent family review is required.

Cases must cover ambiguous names, account/person confusion, expired affiliation,
local adoption without creation, generic AI, repository-free papers, creators
without work, partial dates, retractions, mirrors and unsupported project joins.
Include geographic and organization-type variation where independently eligible
cases exist. Report every exact county key, outside/unknown and every route;
record gaps without fabricating subjects. Do not treat these balanced frames as
an estimate of regional prevalence or complete discovery coverage.

## Evidence, labels and authority

Each source records a versioned reference, provider/native identity, observation
time, representation digest, provenance origin, retained evidence receipt and
permission receipt. Access, retention, annotation and evaluation permission must
be supported for the actual source/material; public accessibility alone is
insufficient. Original sources, private review records and participant data stay
in the authorized evidence store, outside Git. The manifest holds references and
digests, not copied source bodies or credentials.

Two distinct accountable human reviewers inspect original evidence independently
without product predictions or each other's labels. Preserve their original
labels, rationale, confidence, evidence references, rubric revision, timestamps
and blinding receipts. An accountable adjudicator records the resulting labels
and rationale after both annotations, retaining disagreements. The adjudicator
may be one of the two reviewers; this does not replace their independent first
annotations. A confidence score cannot resolve unsupported evidence.

Label identity, professional technical basis, relevance, current professional
presence, regional contribution at creation, creator role and rights separately
as supported/refuted/ambiguous. Record overall eligible/ineligible/ambiguous for
the case's prespecified claim and temporal mode. A standalone creator requires
no artifact. A paper requires no repository. Present professional presence does
not establish where older work was created; historical affiliation does not
establish current employment. Rights restrictions can hold affected material
without negating technical relevance. Missing facts are not negative facts.

Before viewing outputs, classify person/account merges, fabricated regional
creator links and false-current-affiliation claims as critical errors. Any such
observed error fails the corresponding gate and requires correction, impact
review and a fresh evaluation of the affected class. Zero observed errors applies
only to the audited sample and supplies no guarantee of future correctness.

`assessDiscoveryReferenceReadiness` is a pure preparatory validator. It validates
strict schemas, complete quotas, joins, labels, grouping and exposure history.
Every evidence, permission, reviewer-authority, sampling/procedure, selection, independent
annotation, blinding, adjudication and history receipt must resolve through an
externally supplied trusted verifier. The verifier must authenticate actual
records and bind their receipt digest, purpose, subject, principal and canonical
content digest. Caller-supplied Boolean fields and an invented reviewer ID cannot
satisfy that contract. A function returning matching strings is not itself an
authentication mechanism; production verifier integration is a missing input.

No verifier is supplied by this module. Without one the result is blocked. Even
with verified receipt bindings, the strongest return value is
`ready_for_accountable_freeze_review`, with status still `not_frozen`. The schema
rejects a self-issued `frozen` status. The accountable corpus owner and independent
reviewer must inspect evidence, adjudication and selection, then issue a separately
authenticated sealed freeze receipt before any evaluation claim. This local
implementation neither issues that receipt nor promotes labels to source truth.

## Measures and worked cases

Use Wilson's two-sided nominal 95% interval with **z = 1.96**, prespecified before
inspection. For x successes among n trials, p = x/n, d = 1 + z²/n; center is
(p + z²/(2n))/d and half-width is z√(p(1−p)/n + z²/(4n²))/d. At n = 0 report
no estimate and no passing gate. Reject negative, fractional, nonfinite or
inconsistent counts.

For the admitted audit, precision is correctly admitted independent items divided
by all audited admitted independent items. An unresolved admitted item
remains in the denominator and counts as an error in the conservative analysis.
Do not drop ambiguous items, count them as correct, or substitute a classifier's
calibration score for final admission quality. Report automated and human paths,
rejected/held/referred cases and unresolved counts separately.

Recall's primary denominator is the independently assembled eligible roster.
Report captured with sufficient evidence, admitted and published recall separately.
Published recall is explicitly unavailable unless every observation supplies its
publication status; admission does not imply public delivery.
If later evidence makes a reference item's eligibility unresolved, retain it in
a separate conservative denominator with no success credit pending adjudication;
do not erase it from the frozen roster. Explicitly adjudicated ineligible cases
are reported as exclusions by ID and reason. Record inaccessible, not found,
captured/awaiting review, falsely rejected and published outcomes in the execution
evidence. Provider failure cannot become a true negative or healthy-empty result.

`summarizeDiscoveryEvaluation` accepts explicitly prepared per-case observations
with required explicit cohort membership: `admitted-audit`, `recall-roster`, and/or
`candidate-evaluation`. Designed overlap is permitted on one row; missing or
duplicate membership is rejected. Each numerator/denominator uses only its named
cohort. An `admitted-audit` row must retain `admitted: true` at the defined sampling
observation; contradictory membership is rejected rather than dropping that row.
Later withdrawal/rejection remains in that selected audit denominator through
its ineligible/ambiguous truth label and explicit publication status, not by
rewriting admission-at-selection to false. Combined input does not count
non-reference audit items as recall
cases or non-audited reference admissions as audited positives. The helper
collapses origin-equivalent case copies. `precision`/`admissionPrecision` uses
only audited admitted members: a component is successful only when all its admitted
members are adjudicated eligible. Unadmitted model proposals have no admission
precision denominator or gate credit. `candidatePrecision` separately reports
predicted-positive outcomes and has no E02 gate. An ambiguous admitted member is
an error even if the candidate classifier predicted negative.

A recall component is one trial when any member is eligible or ambiguous,
successful only when all such members are eligible and captured (or admitted or
explicitly published for the other measures). The helper additionally reports
connected people/project clusters and their conservative admission summary.
Shared creator/project membership does not merge distinct underlying works for
case quotas or canonical descriptive rates. It does flag dependence and blocks
an independent-binomial numerical gate until a prespecified clustered method or
qualified independent sample supports the inferential claim. Report raw cases,
canonical components, clusters, unresolved cases and exclusions. Remaining
undeclared clustering and purposive selection limit inference independently.

| Worked synthetic input | Result |
| --- | --- |
| 95 correct of 100 independent admitted items | Precision 0.95; Wilson lower ≈0.888248; fails required lower bound 0.90. |
| 100 correct of 100 independent admitted items | Precision 1; Wilson lower ≈0.963005; numerical precision criterion passes. No corpus or operating acceptance follows. |
| One correct, one ambiguous admitted item, one incorrect admitted item | Admission precision 1/3, not 2/3 or 1/2; unresolved ID remains visible. |
| Three items linked transitively by a shared creator and an origin duplicate, one unresolved admitted item | Two canonical cases with precision 1/2; separate conservative shared-family summary 0/1. The independent-binomial gate remains blocked. |
| 100 correct model proposals, none admitted | Candidate precision 1; admission precision unavailable with denominator 0 and gate false. |

Proposed WP24 gates remain precision ≥0.95 and lower bound ≥0.90 with ≥100
independent audited items, recall ≥0.80 and lower bound ≥0.70 with ≥100
independent eligible reference cases, and zero observed critical identity/currentness
errors. The metric helper reports observed critical errors descriptively and
always leaves the critical-identity acceptance gate unevaluated/false: its inputs
do not authenticate a qualified public-output audit. Neither candidate-only rows
nor a Boolean claim of publication establishes E01. Numerical helpers report
the statistical conditions separately from authentication,
selection, access and acceptance. Report route, all county keys, unknown/outside,
creator/work and automatic/human strata with x, n, uncertainty and limitations.
Small strata may have insufficient evidence; a pooled pass cannot waive a route
failure. Source-balanced/purposive samples yield scoped descriptive summaries,
not population confidence or a guarantee of full regional recall.

E05 remains a separate future formative study: 12 intended readers, at least 10
completing assigned core tasks without substantive help, no repeated major
misconception. Balance creator/work and six-route tasks, preserve assistance,
completion time and interpretations, and use measured correction/expiry cadence
to record restart frequency and usable snapshot lifetime. Before sessions, freeze
the rule that repeated restart disruption or material confusion requires repair.
No participants, invitations, consent or actual session results exist here.

## Exposure and change procedure

1. Seal complete manifests, source/rubric/policy versions, grouping, independent
   annotations, held-out/recall sampling frames, audit selection procedure and accountable freeze receipt
   before tuning or scoring. Keep held-out labels inaccessible to tuners.
2. Log every evaluation, label access, tuning exposure or rubric change in a
   separately retained authenticated history. Preserve failed results and the
   original input digests. Absence of an access log is not proof of no exposure.
   Current exposure IDs must resolve to known cases; unknown IDs block readiness.
   Compute connected components across all current case family keys, including
   intermediate recall/audit/challenge cases. Any exposed case connected to a
   heldout case blocks freshness, even through several different keys. An untouched
   ID does not make its already exposed person/project/origin family fresh.
3. Export `heldoutHistory.caseIds` and `.familyKeys` from readiness review, which
   include every case/key in heldout-connected components, resolved
   subject/native/byte keys as well as declared families. Retain
   these exact keys with the old revision even if later IDs or URLs change.
4. After tuning based on held-out results, any exposure of intended fresh cases,
   or a rubric change, advance the manifest revision and acquire a newly reviewed,
   untouched held-out set satisfying all quotas. Block reused cases or families
   from exposed or differently labeled prior revisions. Relabeling IDs does not
   create a new holdout. Historical results retain their original rubric.
5. An independent reviewer checks source permission, new-family separation,
   adjudication and complete history before a new freeze. Until that evidence and
   accountable approval exist, retain `not_frozen`. Changing thresholds to rescue
   a failed result requires a reviewed design revision and fresh evaluation.

## Current disposition

AC-WP03-01, -02 and -03 remain incomplete: actual cases, original evidence,
permissions, independent adjudicators, selection frames and authenticated records
are missing. AC-WP03-04 has local synthetic calculation evidence only; an actual
evaluation and its independently reviewed denominators are absent. AC-WP03-05 has
an implemented refusal mechanism and documented procedure; actual sealed history
and an accountable freeze process remain missing. WP03 is not accepted.

The executable fixtures live only inside `test/discovery-evaluation.test.ts` and
are invented test data. They are never written into the empty reference manifest.
The orchestrator owns package/CI registration and acceptance. Terra independently
reviews this preparation; local test success is not that review or upstream CI.

## Offline intake progress (2026-11-15)

The bounded [offline receipt intake](wp03-intake.md) now supplies strict record,
expectation, authority, validity and revocation binding checks through a caller-owned
authenticated-store capability. Its read-only report keeps the actual empty manifest
blocked and not_frozen. The store authentication integration, permitted evidence,
independent human review and sealed freeze remain missing. The new progress receipt
records synthetic tests only; the corpus and E01–E06 remain incomplete/not_run.
