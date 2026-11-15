# Discovery implementation

The accepted foundation implements discovery contracts, private catalog and
evidence persistence, provenance, scoped removal, bounded collection and evaluation
tooling. Public discovery routes and reader interfaces are still future packages.
No deployment or remote migration has occurred.

WP05–WP11 are accepted after independent tests, transaction challenges and
final integration checks. The source-response intake contract is recorded in
[EX08](implementation-decisions.md), and the guarded registry integration in
[EX09](implementation-decisions.md). [EX10](implementation-decisions.md) defines
durable collection over those contracts. The original WP05 receipt remains unchanged;
its small transaction-composition extension has a
[separate acceptance receipt](receipts/WP05-WP06-composition.json).
[EX11](implementation-decisions.md) adds authenticated GitHub pagination metadata,
API request headers and rate-limit classification. Its
[composition receipt](receipts/WP06-WP07-WP08-composition.json) requalifies the
changed WP06/WP07 runtime while preserving their original receipts.

The selected checkout is
`/workspace/worktrees/builderbob/thevalleydesk/tvd-discovery-implementation-20261113`,
on `codex/discovery-implementation-20261113`, based on
`c8b36d7e9b27376bf121d9d6670c500a25c62423`. The reviewed handoff and foundation
are committed; [draft PR #30](https://github.com/ajhcs/the-valley-desk/pull/30)
contains the implementation branch. No merge or deployment has occurred.
[execution.json](execution.json) is the active status register. The
[frozen engineering handoff](../discovery-engineering/README.md), its manifests
and historical model results remain unchanged. Its planning-only status describes
the earlier task; implementation was subsequently authorized on 2026-11-13.

## Reviewed package status

| Package | Disposition | Delivered scope | Owner / independent reviewer |
| --- | --- | --- | --- |
| [WP00](receipts/WP00.json) | Accepted | Source and handoff reconciliation, decisions, ownership and validation boundaries | Astra / Sol |
| [WP01](receipts/WP01.json) | Accepted | Nine-county healthcare technology policy and 26 synthetic calibration cases | Terra / Astra |
| [WP02](receipts/WP02.json) | Accepted within recorded scope | Model v0.5, strict shared contracts, dependency guards and formal counterexamples | Astra, with Terra types / Sol |
| [WP03](receipts/WP03-crossref-request-progress.json) | Preparation reviewed; package incomplete | Six project dossiers; 16 native acquisitions / 14 distinct bodies staged; zero reference cases | Sol/Terra source work; Astra review |
| [WP04](receipts/WP04.json) | Accepted | Additive D1 catalog, stable identities, immutable revisions, typed relations and transactional write checks | Sol / Astra |
| [WP05](receipts/WP05.json) | Accepted | Evidence ledger, scoped removal, provenance, integrity quarantine and first-response intake; [independent acceptance tests](reviews/wp05-terra.md) | Sol / Astra, with Terra tests |
| [WP06](receipts/WP06.json) | Accepted within local implementation scope | Source registry, qualification, credentials, exact endpoint rules, bounded transport/budgets, guarded retention and six synthetic adapter contracts | Sol registry / Terra transport / Astra review, with independent Sol tests |
| [WP07](receipts/WP07.json) | Accepted within local implementation scope | Frozen ordered rounds, linked leases, atomic raw/lead/page/checkpoint commit, restart replay, conservative accounting and scoped progress | Sol store / Terra collector / Astra review, with independent Sol tests |
| [WP08](receipts/WP08.json) | Accepted within local implementation scope | Independent GitHub repository/account/search acquisition, retained-baseline lists, native identities, source stages/dates and authenticated pagination | Sol / Terra; root integration |
| [WP09](receipts/WP09.json) | Accepted within local implementation scope | Independently qualified PubMed search/fetch, durable scope/batch binding, historical author candidates, partial dates and truthful gaps | Sol / Terra tests / Astra review; root integration |
| [WP10](receipts/WP10.json) | Accepted within local implementation scope | Crossref work/institution cursor queries plus separately reviewed fixed-DOI metadata requests, exact original endpoint/body matching, partial dates and unresolved contributors | Sol / Terra tests / Astra review; root integration |
| [WP11](receipts/WP11.json) | Accepted within local implementation scope | Independent arXiv queries, base/version identity, qualified Atom, retained numeric-offset ancestry and private replay | Sol / Terra tests / Astra review; root integration |
| [WP12](receipts/WP12-local-implementation.json) | Software increment reviewed; full package unaccepted | Installation-bound public forum subset, strict pre-retention privacy, retained category/topic ancestry; actual qualification and native change consumer open | Sol / Terra / Astra |
| [WP13](receipts/WP13-local-implementation.json) | Software increment reviewed; full package unaccepted | Source-specific passive profiles/directories, literal unit/role/date inputs, reviewed-origin boundary; actual qualification open | Sol / Terra / Astra |
| [WP14](receipts/WP14-entry-preparation.json) | Entry handoff reviewed; implementation not started | Concrete authority/store gaps, proposed API and planned tests; waits for WP03 | Sol preparation / Astra review |

WP07's private page receipt acknowledges collected leads; it does not fabricate
catalog subjects or evidence-backed `SourcePage` observations. Additional provider
parsers and WP14 materialization remain separate packages. The
[verification plan](wp07-evidence-plan.md) and
[orchestrator review](reviews/wp07-orchestrator.md) map crash, fairness, lease,
page-chain and budget experiments to all six acceptance criteria. Migration 0044
strengthens lease uniqueness and request admission beneath unchanged WP06 sources;
its [separate compatibility receipt](receipts/WP06-WP07-collection.json) preserves
the original WP06 acceptance.

WP03 has **zero real reference cases** and an unfrozen
[reference manifest](reference-manifest.json). Its 360-case held-out corpus,
independent annotations/adjudication and independent recall roster remain
outstanding. E01–E06 remain `not_run`. Neither synthetic fixtures nor formal
checks establish real-world identity, geographic relevance, source coverage or
reader usefulness.

The [initial real source qualification](qualification/README.md) acquired
and independently reviewed exact CC0 Penn and CHOP organization metadata. The
[later repository/publication investigation](qualification/github-publication-qualification.md)
adds QSIPrep and CaPTk, their explicit publication links and historical Philadelphia
affiliation evidence. Four additional native metadata bodies passed independent
field/URI review and offline replay. The
[staging index](qualification/wp03-material-index.json) preserves native bodies,
observation receipts and development exposure. EX23's
[fixed-DOI qualification](crossref-fixed-doi-qualification.md) closes the request
gap with six canonical Crossref captures and adds four new repository baselines:
AutoGVP, ImmunoTar, Phenomantics and DeepCNV. The inventory now has 16 acquisition
records and 14 distinct body hashes across six project dossiers. They have no human labels, trusted
permission/evidence attestations, family/partition assignments or strict manifest
membership. Two project dossiers may share a person/family connection; their
representations do not supply independent sampling credit. The bounded manual
metadata pass does not enroll providers. The fixed request mode is locally
qualified against exact new observations; older differently serialized observations
are preserved. Measured forum and institutional holds remain. The
[latest qualification receipt](receipts/crossref-request-qualification-20261115.json)
preserves the request, authority, rights and corpus distinctions.

WP03's [receipt-intake increment](receipts/WP03-receipt-intake-progress.json) adds
strict offline receipt/authority binding and a read-only readiness report, with
17 new tests and separate Terra review. The [intake guide](wp03-intake.md) lists
the exact store, evidence, human-review and sampling inputs still needed. It
does not provide an authenticated external registry or issue a corpus freeze.

The orchestrator required corrections before acceptance: stale revision checks
now bind the modeled commit predicate; source capture is distinct from durable
acknowledgment; catalog transactions reject incompatible artifact subtypes and
fractional revisions; evaluation partitions detect transitive exposure and keep
admission precision separate from candidate prediction. Reviews, failed attempts
and exact input hashes are retained with the linked receipts.

The [signed intake increment](receipts/WP03-signature-intake-progress.json) adds
Ed25519 record/authority verification under separately supplied operator pins.
[Its guide](wp03-signed-intake.md) specifies domains, limits, expiry and snapshot
revocation. It does not establish actual human trust, anti-rollback administration,
source rights or reference truth. The real corpus remains empty and unfrozen.

The [offline file command](wp03-cli-intake.md) and its
[progress receipt](receipts/WP03-cli-intake-progress.json) add bounded local-file
intake and private no-clobber readiness reporting. A complete fictional signed
corpus exercises ready/exit0 without freeze; the actual empty corpus stays
blocked/not_frozen. No human authority or source rights were enrolled.

The [case-selection integrity correction](wp03-case-selection-binding.md) now
binds every case descriptor, manifest context and referenced source snapshot to
the selection attestation. Its [progress receipt](receipts/WP03-case-selection-binding-progress.json)
records genuine synthetic-signature mutation/re-attestation tests. Old partial
selections require accountable re-review; the actual corpus stays empty.

The [signed label-context correction](wp03-label-context-binding.md) binds
annotation, blinding and adjudication to the exact reviewed case/source context.
Changed disagreements invalidate stale adjudication. Legacy labels require actual
re-review and authenticated re-attestation; no signing or fallback is added.
The [progress receipt](receipts/WP03-label-context-progress.json) retains the
genuine synthetic counterexample and fixes. The actual corpus remains empty.

## Validation and remaining release blockers

The [WP12/WP13 integration record](wp12-wp13-integration-validation.json) records
reviewed software and explicit unmet package conditions. Earlier
[WP11](wp11-integration-validation.json), [WP10](wp10-integration-validation.json),
[WP09](wp09-integration-validation.json), [WP08](wp08-integration-validation.json),
[WP07](wp07-integration-validation.json), [WP06](wp06-integration-validation.json),
[WP05](wp05-integration-validation.json) and [foundation](integration-validation.json)
records remain historical evidence.
The preceding WP12/WP13 increment used the qualified Node 22.23.2 runtime:

- All 1,361 enumerated tests passed in completed bounded groups: 937 primary,
  146 Watch and 278 discovery, with zero failures/skips/cancellations. Seven
  discovery commands cover exactly all 19 explicit files. No combined long
  discovery command was used. Earlier SIGTERM attempts remain historical evidence,
  not exit0 claims. Discovery contract typechecking passed.
- Seven mandatory PDF regressions passed using the pinned project runtime.
- Build, isolated local D1 smoke and secret scan passed. WP04 additionally has
  an independent nine-test local D1 challenge covering rollback and replay. WP05
  has 13 independent acceptance tests. WP06 has 21 independent tests and 16
  additional adversarial cases covering real D1 rollback, source identity, scoped
  removal, budgets, integrity quarantine and transport boundaries.
- WP07 has 33 independent actual-D1 tests, six focused collector tests and 21
  separate Astra adversarial checks. WP06's 21 tests also pass under migrations
  0001–0044; six migration checks verify duplicate-lease rejection and rollback.
  These counts overlap the integrated suite and are not added to its total.
- WP08's 25 independent actual-D1 tests verify repository and creator-first paths,
  native identities, retained baseline lists, unsafe pagination, 304, rate limits,
  API headers and scoped removal. The shared WP06/WP07 regressions pass on the
  amended runtime. That WP08 runtime run used synthetic provider responses and qualifications.
- WP09 has three comprehensive actual-D1 scenarios plus eleven existing regional
  contract checks in its independent run; Astra passed 40 separate geography,
  parent-binding and diagnostic probes. The ten original Wistar publication tests
  now run explicitly in the discovery command. Nineteen new signature tests and
  16 independent Astra signature probes also pass.
- WP10 has ten independent actual-D1 tests, including three-page ancestry,
  corrupted mappings, retained replay, caps and reviewed cross-provider origins.
  Astra passed 36 separate DOI/adapter checks; root reran those probes. WP03's 19
  CLI tests and 12 separate Astra subprocess scenarios include a fully fictional
  signed ready/exit0 run that still issues no freeze. Integrated counts overlap.
- WP11 has 21 independent actual-D1 tests. Astra passed 41 separate adapter
  probes and an additional D1 initial-offset guard experiment. WP03 adds one
  complete signed integrity test with 20 mutation cases and nine independent
  Astra checks. Old signed selections fail; fresh accountable re-attestation is
  required. These counts are not added again to the integrated total.
- WP12 has 27 actual-D1 tests; WP13 has 15. Both cover genuine three-page
  ancestry and whole-response raw-retention canaries. Astra passed 40 forum and
  48 institutional probes, including authentic-snapshot replay and ancestor failures.
  WP03 adds genuine signed stale-label rejection plus 14 independent context/DAG
  checks. These counts overlap or supplement the suite and are not added twice.
- `npm audit --audit-level=high`: failed with four high-severity advisories,
  seven total. The dependency lockfile is unchanged; see the
  [audit and remediation record](dependency-audit.json).

The later real-source investigation fixed a separate non-HTML healthy-empty gap.
The affected institutional suite now passes 19 tests; exact Penn bytes also pass
three rejection/replay tests under synthetic D1 authority. Astra passed 55 separate
institutional checks. Types, seven PDF regressions, build, local smoke and secret
scan passed again. These are targeted rechecks, not a fresh run of all 1,361 prior
tests; only the institutional source/test differ among the 607 runtime inputs.
The [qualification receipt](receipts/real-source-qualification-20261115.json)
preserves both the actual observations and the separate synthetic format defect.

The preceding GitHub/publication follow-up found and fixed ignored raw contact and
article-material retention. Its 39 GitHub/Crossref tests passed on the corrected
logic, with 16 independent actual-D1 checks and Astra's additional adversarial
matrices. Four exact native payloads replay under synthetic authority. Types,
seven PDF regressions, build and local smoke pass. Five runtime paths differ
from the preceding snapshot; 603 prior inputs are unchanged and the new helper
brings the total to 608. One trailing LF was removed after the full run, with
exact byte-equivalence evidence and independent direct checks retained. Historical
full-suite counts above are not described as a fresh full rerun.

EX23's final run passes all 43 GitHub/Crossref tests, including six exact native
Crossref endpoint/request/body/ledger replays. Terra passed 23 Crossref D1 checks
and four original query-free GitHub endpoint replays; Astra passed 27 adversarial
checks and one legacy-cursor regression. Types, seven PDF regressions, build and
local smoke passed with stable hashes for all 608 runtime inputs. Only Crossref's
module/test differ from the preceding snapshot; 606 inputs are unchanged.

Exact-head CI state is recorded in [execution.json](execution.json). Prior
head 59ba1bc CI169 passed tests/PDF/build/smoke, then failed audit and skipped its later
secret scan. Current local secret scan passes. The PR stays draft; local package
acceptance does not complete release qualification. The baseline
inventory originally identified 11 omitted legacy regional test files; WP09 adds
the Wistar publication file, leaving ten outside the scripts. These are not counted
as executed. A bundle-size warning remains.
The model receipt states the bounds and assumptions of every proof/check. Its
native inputs did not change during this increment; no new native proof claim is made.
The late institutional HTML-recovery fix changed only its module and test;
605 other inputs are unchanged. The full institutional suite, independent matrices
and global type/PDF/build/smoke checks passed again. Both 607-file manifests and
superseded results are retained. Independent suites retain stable final hashes. Earlier failing candidates and adjudicated fixture changes
remain preserved; a mutation that outlives a timeout is reconciled as uncertain,
not assumed cancelled or refunded.

Use [validation environments](validation-environments.md) for runtime, credential
isolation and workspace-cache requirements. Task evidence is retained under
`.discovery-work/`, excluded from Git; portable receipts record the relevant
hashes and limits. The PDF bootstrap's missing `ensurepip` failure and subsequent
hash-verified local wheel provisioning are retained in that evidence directory.

## Continue from the accepted dependencies

1. Complete WP12's real installation/version/access/rights/response qualification
   and native edit/deletion-to-current-claim consumer; complete WP13's actual
   source/profile/access/rights qualification. The reviewed local implementations
   do not grant full acceptance. Never broaden the strict response subset or
   enable real collection merely because synthetic inputs pass.
2. Preserve WP07's explicit round creation and one-attempt slots. A completed
   scheduling round does not prove complete source coverage. Expired continuations
   require a new inventory cohort; failed/uncertain work stays charged. Do not
   introduce automatic retries or production scheduling through an adapter.
3. Continue WP03 reference preparation where permitted inputs are available.
   Keep it incomplete until its real corpus and independent adjudication exist.
   [EX07](implementation-decisions.md) moves the admitted-item audit to WP24
   without weakening its thresholds. WP14 still requires WP03. Its
   [entry handoff](wp14-entry-plan.md) is reviewed preparation; no endpoint, rule,
   authority or migration implementation has started.
4. Preserve separate provider, empirical, security, migration and operating gates.
   Resolve the dependency audit before release qualification.

Sol, Terra and Astra own bounded packages; the independent reviewer challenges
each package and the orchestrator records its disposition. Follow accepted
dependency outputs before accepting a package. Drafts and isolated fixtures may
be prepared earlier, but cannot substitute for missing evidence. See
[ownership](ownership.md), [baseline receipt](baseline-receipt.json),
[initial decisions](decision-register.md) and
[implementation decisions](implementation-decisions.md).

Deployment remains prohibited. Do not start production collectors, copied
schedulers or services. Provider activation, real editorial admissions,
participant recruitment and production changes retain their separate operating
scope; this local increment does not authorize them.
