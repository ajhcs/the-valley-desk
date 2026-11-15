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
| [WP03](receipts/WP03-preparation.json) | Preparation reviewed; package incomplete | Reference protocol, manifest checks, cohort metrics and exposure safeguards; 21 synthetic tests | Astra / Terra |
| [WP04](receipts/WP04.json) | Accepted | Additive D1 catalog, stable identities, immutable revisions, typed relations and transactional write checks | Sol / Astra |
| [WP05](receipts/WP05.json) | Accepted | Evidence ledger, scoped removal, provenance, integrity quarantine and first-response intake; [independent acceptance tests](reviews/wp05-terra.md) | Sol / Astra, with Terra tests |
| [WP06](receipts/WP06.json) | Accepted within local implementation scope | Source registry, qualification, credentials, exact endpoint rules, bounded transport/budgets, guarded retention and six synthetic adapter contracts | Sol registry / Terra transport / Astra review, with independent Sol tests |
| [WP07](receipts/WP07.json) | Accepted within local implementation scope | Frozen ordered rounds, linked leases, atomic raw/lead/page/checkpoint commit, restart replay, conservative accounting and scoped progress | Sol store / Terra collector / Astra review, with independent Sol tests |
| [WP08](receipts/WP08.json) | Accepted within local implementation scope | Independent GitHub repository/account/search acquisition, retained-baseline lists, native identities, source stages/dates and authenticated pagination | Sol / Terra; root integration |
| [WP09](receipts/WP09.json) | Accepted within local implementation scope | Independently qualified PubMed search/fetch, durable scope/batch binding, historical author candidates, partial dates and truthful gaps | Sol / Terra tests / Astra review; root integration |
| [WP10](receipts/WP10.json) | Accepted within local implementation scope | Independent Crossref work/institution queries, explicit DOI subset, partial dates and unresolved contributors, retained cursor ancestry and private metadata replay | Sol / Terra tests / Astra review and fixes; root integration |
| [WP11](receipts/WP11.json) | Accepted within local implementation scope | Independent arXiv queries, base/version identity, qualified Atom, retained numeric-offset ancestry and private replay | Sol / Terra tests / Astra review; root integration |

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

## Validation and remaining release blockers

The [WP11 integration receipt](wp11-integration-validation.json) records final
commands and hashes. The [WP10 receipt](wp10-integration-validation.json),
[WP09 receipt](wp09-integration-validation.json),
[WP08 receipt](wp08-integration-validation.json),
[WP07 receipt](wp07-integration-validation.json),
[WP06 receipt](wp06-integration-validation.json),
[WP05 receipt](wp05-integration-validation.json) and
[earlier foundation receipt](integration-validation.json) remain historical evidence.
With the qualified Node 22.23.2 runtime:

- All 1,318 enumerated tests passed in completed bounded groups: 937 primary,
  146 Watch and 235 discovery, with zero failures/skips/cancellations. Six shorter
  discovery commands cover exactly all 16 explicitly enumerated files. No combined
  long discovery command was used for WP11. Earlier WP09/WP10 SIGTERM attempts
  remain historical evidence and are not reported as exit0. Discovery contract
  typechecking passed.
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
  amended runtime. All provider responses and qualifications remain synthetic.
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
- `npm audit --audit-level=high`: failed with four high-severity advisories,
  seven total. The dependency lockfile is unchanged; see the
  [audit and remediation record](dependency-audit.json).

Exact-head CI state is recorded in [execution.json](execution.json). The prior
WP10 head dcb2b10 CI passed tests/PDF/build/smoke, then failed audit and skipped its later
secret scan. Current local secret scan passes. The PR stays draft; local package
acceptance does not complete release qualification. The baseline
inventory originally identified 11 omitted legacy regional test files; WP09 adds
the Wistar publication file, leaving ten outside the scripts. These are not counted
as executed. A bundle-size warning remains.
The model receipt states the bounds and assumptions of every proof/check. Its
native inputs did not change during WP11; no new native proof claim is made.
All 584 runtime qualification inputs matched during tests. Three authored XML
fixtures then received blank-line whitespace cleanup; namespace-aware parsed-tree
comparisons passed, and both original and delivery hash manifests are retained.
All other inputs are unchanged. Independent suites also record stable inputs. Earlier failing candidates and adjudicated fixture changes
remain preserved; a mutation that outlives a timeout is reconciled as uncertain,
not assumed cancelled or refunded.

Use [validation environments](validation-environments.md) for runtime, credential
isolation and workspace-cache requirements. Task evidence is retained under
`.discovery-work/`, excluded from Git; portable receipts record the relevant
hashes and limits. The PDF bootstrap's missing `ensurepip` failure and subsequent
hash-verified local wheel provisioning are retained in that evidence directory.

## Continue from the accepted dependencies

1. Begin [WP12](../discovery-engineering/work-packages/WP12.md), qualified forum acquisition.
   WP12–WP13 are eligible against the accepted registry/transport contracts.
   Integrate provider parsers with WP07's trusted provisional parse and private
   receipt boundary; preserve exact native keys, stages and source dates. Keep
   provider access qualification distinct from synthetic route fixtures.
   Native network egress has no default; no real source is enrolled or activated.
   GitHub, PubMed, Crossref and arXiv remain locally verified only: real access/rights and E04 source-class
   qualification are still required. Requests are unconditional, unsolicited304
   fails, and full pages without a usable next Link remain partial.
2. Preserve WP07's explicit round creation and one-attempt slots. A completed
   scheduling round does not prove complete source coverage. Expired continuations
   require a new inventory cohort; failed/uncertain work stays charged. Do not
   introduce automatic retries or production scheduling through an adapter.
3. Continue WP03 reference preparation where permitted inputs are available.
   Keep it incomplete until its real corpus and independent adjudication exist.
   [EX07](implementation-decisions.md) moves the admitted-item audit to WP24
   without weakening its thresholds. WP14 still requires WP03.
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
