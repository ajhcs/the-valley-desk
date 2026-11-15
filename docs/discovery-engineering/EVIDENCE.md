# Verification, validation and acceptance

All implementation investigations below are **planned / not_run**. The copied
v0.4 receipt is historical formal evidence, not execution of this handoff. A
document completeness check cannot supply any of E01–E06.

## Evidence ownership and acceptance

The package owner produces evidence; the named reviewer challenges it; the
orchestrating engineer accepts implementation integration. Accountable editorial
and operating authorities accept their respective decisions. A model can assist
review but cannot authenticate a reviewer or authorize publication.

Keep raw source material, participant data, credentials and private annotations
outside Git in the authorized project evidence store. Commit concise sanitized
receipts and reproducible non-sensitive fixtures. Each receipt identifies the
claim, exact source/configuration/model/policy/fixture revisions, environment,
commands or observation procedure, timestamps, expected and observed behavior,
failures, limitations, reviewer and acceptance disposition. A check is not passed
when skipped, errored, unavailable, stale or outside its stated scope.

Use existing CSE `cseWorkflow` evidence entries for model verification targets,
with `mode: plan` and `result: not_run` until executed. `plan.json` indexes delivery
work; it does not introduce a competing model evidence authority.

## Gate sequence without a release dependency cycle

| Gate | Packages | Exit condition |
| --- | --- | --- |
| G0: baseline and contract | WP00–WP03 | Current source reconciled; accepted scope, model delta, interface versions, policy rubric, proposed limits and evaluation design frozen. External inputs have owners. |
| G1: first complete slice | WP30 and its dependencies | An independent professional, repository-free paper and repository each traverse evidence, decision, public projection, search and reader view, including a hold and correction case. This is not full-scope acceptance. |
| G2: candidate qualification | WP22–WP24 | All required routes qualified; fresh implementation/CI evidence; E01–E05 and **E06-preproduction** dispositions accepted. No unresolved critical publication, identity or private-field leak. |
| G3: operating and recovery readiness | WP25–WP26 | Scoped preproduction pilot and migration/recovery rehearsals pass; resourced capacity within approved caps, owner/backup and exact release/recovery plans are concrete. WP25 must return `release_ready`; a completed study with a stop or overload result does not satisfy this gate. |
| G4: public operational acceptance | WP27 | Authorized exact-candidate release and **E06-postdeployment** readback pass. No production success claim before this evidence. |
| Conditional later work | WP28–WP29 | A separate justified retirement or expansion decision; these are not mandatory core-release packages. |

G2 does not require a production deployment or final operational acceptance.
Provider qualification and reader sessions use an explicitly scoped isolated or
preproduction trial. G3's pilot also precedes public launch. Real provider calls,
participant invitations and spending need their concrete trial scope, not a
fictional production prerequisite. Missing access leaves that route's evidence
incomplete; it does not prevent independent fixture or code work elsewhere.

## E01: identity, creator role and regional truth

WP03 assembles independently reviewed public evidence; WP24 evaluates output.
Include same-name people, account/person ambiguity, independent professionals,
organizations, departments, dated affiliations, county boundaries, multiple sites,
relocation and conflicting evidence. Label identity, professional technical basis,
creator role, county, effective period and current-verification status separately.
Do not infer residence or current employment from a historic paper.

Two accountable reviewers label independently and retain disagreements for
adjudication. Agents can prepare evidence but are not independent external truth.
Ambiguous labels remain ambiguous and test appropriate abstention. Missing
optional author identity must not hide an independently qualified artifact.

Pilot gate: no observed critical person/account merge, fabricated regional
creator link, or false-current-affiliation claim in audited public output. Any
such error requires correction, impact review, and retest of that error class.
Zero observed errors is not a guarantee of zero future errors; report the audited
denominator, selection process and unresolved claims.

## E02: relevance, public precision and review burden

Create a development set and a separate held-out set. Initial held-out design:
360 cases, 60 per acquisition route (GitHub, PubMed, Crossref, arXiv, forum,
institutional/association), with positive, negative and ambiguous examples in
each. Freeze the sampling frame, rubric, labels, split IDs, duplicate/provenance
groups and acceptance targets before tuning. Cover counties and organization
types where independently eligible cases exist; a coverage gap is not a reason
to invent a case. Source-balanced cases do not estimate regional prevalence.

Group all manifestations of a person/project/provenance family into one split,
including DOI duplicates, preprint/journal versions, syndicated pages and mirrored
repositories. Keep challenge cases separate from unbiased or stratified audits.
Never construct the reference solely from the system's own accepted results.

Independently audit at least 100 admitted items, with one count per independent
underlying work/provenance family for the stated interval. Define precision as
correctly admitted, adjudicated in-scope items divided by all audited admitted
items. Unresolved admissibility must not be dropped from that denominator to
inflate success; report it and resolve or hold the item. Report automated versus
human-reviewed paths separately, plus candidates rejected, held and referred for
review. Distinguish classifier accuracy from final catalog admission quality.

Proposed pilot gate: precision ≥0.95 and nominal 95% Wilson lower bound ≥0.90.
Use z=1.96 and the prespecified Wilson score method; report n and x. The conjunction
matters: 95 correct of 100 does not meet the lower-bound condition. Correlated
observations require grouping or a justified clustered method fixed in advance.
For purposive or balanced panels, the interval is descriptive under its stated
sampling assumptions, not proof of production-wide or regional precision.

Report each route and material error class; a pooled pass cannot excuse a failed
source qualification or an unresolved systematic severe error. If a stratum is
small, show its count and uncertainty instead of inventing reliable percentages.
Any post-evaluation tuning needs a new untouched holdout for the next claim.

## E03: discovery and coverage

Assemble at least 100 eligible creator/work reference cases through independent
institutional and community research, retaining the discovery method and evidence.
Define the lookup time window and eligible source access before running the
system. Deduplicate related manifestations and preserve creator versus work
denominators. Report both creator-first and artifact-first performance.

Primary reference recall is independently eligible cases captured with sufficient
evidence to enter review divided by all independently eligible reference cases
in the declared scope/window. Also report admitted/public recall separately; a
review backlog must not disappear inside a single discovery score. Provider
inaccessible, not found, captured/awaiting review, falsely rejected and published
are separate outcomes. Correctly excluded out-of-scope examples belong in a
separate challenge report, not the eligible denominator.

Proposed gate: reference recall ≥0.80 with nominal 95% Wilson lower bound ≥0.70.
Report assumptions and uncertainty as for E02. Publish route/county/type breakdowns
and audit some discoveries outside the reference to challenge reference-set bias.
The unknown regional population prevents a claim of complete regional recall.
Coverage receipts use explicit enrolled scopes, cohorts and windows (P25/P26).

## E04: provider qualification

For each required route retain an access/enrollment receipt, successful bounded
response, parsing and identifier evidence, complete page traversal or declared
provider limit, rate/byte/request policies, checkpoint behavior, and failure and
recovery observations. Validate the installation, not just the API brand. Metadata
access does not establish full-text display rights or participant identity.

An approved qualification-only access scope and qualified bounded transport allow
the first controlled sample request. Complete provider qualification uses that
sample and failure evidence before enabling routine collection or evaluation.
Do not require a completed live qualification receipt before its own first
permitted qualification request; do not treat that limited request as enrollment
for unrestricted ongoing collection.

Exercise changed identifiers, duplicate pages, changing upstream results, partial
responses, rate limits, missing fields, HTTP failures, malformed content, redirects,
timeouts and interrupted commits. Never relabel a failed fetch as healthy-empty.
Account for chargeable failures and decompressed payloads. Requalify material
access/parser/scope changes. An adapter fixture suite is necessary but does not
replace actual permitted access evidence.

## E05: reader usefulness

Use 12 intended readers across practitioners/researchers, builders and collaboration
seekers. Prepare equivalent task variants and avoid teaching the expected answers.
Balance independent people, code, paper, preprint, forum, institution and historical
connection tasks across sessions. Ask readers to find an item/person, explain the
regional and technical basis, distinguish status/rights, and locate a supported
next action. Record success, assistance, time, misconception and uncertainty.

Proposed formative gate: at least 10 of 12 readers complete their assigned core
task set without substantive assistance and interpret the material claims
correctly. Each major journey must be exercised; a successful average cannot
hide a broken route. Three minutes per discovery task is an initial diagnostic
target, not an automatic failure threshold. Repeated material confusion about
current affiliation, research stage, reuse or clinical validity requires repair.
Use the representative correction/expiry cadence measured by WP17, retaining
restart counts, usable snapshot lifetimes and task-completion impact. Freeze
restart-usability disposition rules before observing results; recurrent restarts
that prevent assigned tasks or repeatedly confuse readers require repair.
Retest changed flows with fresh task variants. This small pilot is directional,
not a population estimate. Contact and consent scope must be established before
recruitment; no invitations are authorized by this handoff task.

## E06: correspondence and operating acceptance

**Preproduction:** map every P01–P32 obligation, new refinement obligation and
selected native record field to code, schema, transaction, DTO and tests. Run
independent differential tests, real D1 migration/transaction checks, adversarial
interleavings, route/crawler/browser journeys and required CI. Measure query and
frontend performance on a declared workload. Preserve exact input revisions and
negative controls. See WP23 and WP24.

**Postdeployment:** after the scoped WP27 release, verify the served candidate,
configuration, public/API/crawler/cache consistency, protected boundaries, legacy
consumers, source health, rollback readiness and operating ownership. A failed
readback leaves operational acceptance incomplete even if the deployment command
succeeded. This is a later gate, not a prerequisite to performing the deployment.

The historical formal assumptions A_FACTS through A_ORIGIN must each have an
implementation or external-evidence disposition. Abstract lifecycle checks do
not prove concrete concurrency, cache correctness, source truth or reader value.

## Required future repository checks

At the inspected baseline `.github/workflows/ci.yml` runs locked installation,
hash-locked PDF-tool bootstrap, `npm test` (including its posttest), mandatory PDF
regressions, production build, local D1/scheduled smoke, dependency audit and
secret scan. Preserve their scope until an explicitly retired obligation removes
it. New tests must enter the actual enumerated commands in `package.json`.

Future commands, only after WP00 qualifies an isolated implementation environment:

```text
npm ci
npm run policy:pdf:bootstrap
npm test
npm run test:policy-pdf
npm run build
npm run ops:smoke
npm audit --audit-level=high
npm run secret-scan
```

Bootstrap may download tools and smoke may execute local runtime behavior: inspect
current scripts and ensure local bindings/synthetic state first. These commands
were not run for this documentation handoff. Add package-specific discovery and
browser checks to the required CI job and retain its finalized exact-candidate
conclusion. An agent's local result is not an upstream CI result.

## Recheck rule

Failures are retained with the input that produced them. Repairs invalidate
dependent evidence until rerun. A policy or threshold change requires its reason,
impact, and a new untouched evaluation where relevant; it cannot rewrite a failed
result into a pass. When dependency coverage is incomplete, broaden rechecks.
