# Regional health-technology discovery: engineering handoff

**TVD-ENGINEERING-HANDOFF-1.0 · Planning only · November 13, 2026**

Build a public service that helps readers find regional health-technology creators
and work, understand the evidence, and take a useful next step. The scope is the
nine-county DVRPC region, with independent GitHub, PubMed, Crossref, arXiv, public
forum and institutional/association discovery. People and work do not require a
repository. Patents and unrelated expansions remain deferred.

This package turns the agreed 101-item plan into **31 work packages**, assigned
owners/reviewers, a dependency graph, explicit acceptance criteria and evidence
gates. **No application behavior, target-model semantics, source enrollment,
scheduler, credential, database or production service changed.** All core packages
remain `not_started`; WP28 and WP29 are conditional later work.

## Start here

1. Read [execution and assignments](EXECUTION.md). When implementation is requested,
   begin WP00; do not treat this document as an instruction to start now.

2. Read [shared architecture/contracts](ARCHITECTURE.md) and
   [requirements/scenarios](REQUIREMENTS.md). WP02 must reconcile the stated model
   refinements before downstream implementation.

3. Use [evidence and release gates](EVIDENCE.md) to distinguish package verification,
   empirical validation, operating readiness and public acceptance.

4. Dispatch the relevant package below using the execution template. Check its
   prerequisite outputs and reserve shared files before parallel edits.

## Delivery and source of truth

- [plan.json](plan.json): package metadata, dependencies, assignments, states and trace IDs.
- [101-item coverage map](SCOPE.md) and [scope.json](scope.json): every original change mapped to work.
- [Requirement index](requirements-index.json): R01–R18 package allocation.
- [Verification index](verification-index.json): all P01–P32 families and E01–E06 gates.
- [Frozen model and historical evidence](baseline/README.md): portable selected baseline, manifest and reproduction limits.
- [Operating inputs and risks](INPUTS-AND-RISKS.md): missing resources, owners and decision triggers.
- [Handoff validation](VALIDATION.md): documentation checks and independent review findings; not implementation results.

Existing native semantics remain authoritative in the frozen model. This handoff
proposes explicit changes to creator/relationship reviews, artifact rights,
projection dependencies, snapshot invalidation and recovery. A pass for the old
model does not prove these refinements or future code. Maintain one new model
revision through WP02 and retain the frozen baseline unchanged.

## Work packages

Dependencies are accepted-output prerequisites. Contract-bound mock/fixture work
can begin earlier as described in EXECUTION, but cannot satisfy package acceptance.
The named reviewer is distinct from the owner; the orchestrator owns integration.

| Package | Capability | Phase | Owner / reviewer | Dependencies |
| --- | --- | --- | --- | --- |
| [WP00](work-packages/WP00.md) | Reconcile baseline and establish orchestration | I01 | Astra / Sol | None |
| [WP01](work-packages/WP01.md) | Product, geography, relevance and business policy | I01 | Terra / Astra | [WP00](work-packages/WP00.md) |
| [WP02](work-packages/WP02.md) | Model refinements and shared interface contracts | I01 | Astra / Sol | [WP01](work-packages/WP01.md) |
| [WP03](work-packages/WP03.md) | Independent reference corpus and evaluation freeze | I01 | Astra / Terra | [WP02](work-packages/WP02.md) |
| [WP04](work-packages/WP04.md) | Typed catalog, identities, dates and additive schema | I02 | Sol / Astra | [WP02](work-packages/WP02.md) |
| [WP05](work-packages/WP05.md) | Evidence, provenance, claims and decision history | I02 | Sol / Astra | [WP04](work-packages/WP04.md) |
| [WP06](work-packages/WP06.md) | Source registry, transport, credentials and budgets | I03 | Sol / Astra | [WP02](work-packages/WP02.md), [WP05](work-packages/WP05.md) |
| [WP07](work-packages/WP07.md) | Durable collection, checkpoints and fair scheduling | I03 | Sol / Astra | [WP06](work-packages/WP06.md) |
| [WP08](work-packages/WP08.md) | Independent GitHub acquisition | I03 | Sol / Terra | [WP06](work-packages/WP06.md) |
| [WP09](work-packages/WP09.md) | Independent PubMed acquisition | I03 | Sol / Astra | [WP06](work-packages/WP06.md) |
| [WP10](work-packages/WP10.md) | Independent Crossref acquisition | I03 | Sol / Astra | [WP06](work-packages/WP06.md) |
| [WP11](work-packages/WP11.md) | Independent arXiv acquisition | I03 | Sol / Astra | [WP06](work-packages/WP06.md) |
| [WP12](work-packages/WP12.md) | Qualified public forum acquisition | I03 | Sol / Terra | [WP06](work-packages/WP06.md) |
| [WP13](work-packages/WP13.md) | Institutional, association and independent creator discovery | I03 | Sol / Terra | [WP06](work-packages/WP06.md) |
| [WP14](work-packages/WP14.md) | Deterministic admission and authenticated review API | I04 | Sol / Astra | [WP03](work-packages/WP03.md), [WP05](work-packages/WP05.md), [WP06](work-packages/WP06.md) |
| [WP15](work-packages/WP15.md) | Review workspace and suggestion or correction intake | I04 | Terra / Astra | [WP14](work-packages/WP14.md), [WP16](work-packages/WP16.md) |
| [WP16](work-packages/WP16.md) | Atomic publication, projections and invalidation | I05 | Sol / Astra | [WP05](work-packages/WP05.md), [WP14](work-packages/WP14.md) |
| [WP17](work-packages/WP17.md) | Exact discovery query, snapshots and public API | I05 | Sol / Astra | [WP16](work-packages/WP16.md) |
| [WP18](work-packages/WP18.md) | Home, work, people, organization and project journeys | I06 | Terra / Sol | [WP17](work-packages/WP17.md) |
| [WP19](work-packages/WP19.md) | Worker routing, crawlers, metadata and legacy compatibility | I06 | Terra / Sol | [WP17](work-packages/WP17.md), [WP18](work-packages/WP18.md) |
| [WP20](work-packages/WP20.md) | Accessibility, performance and interaction qualification | I06 | Terra / Astra | [WP15](work-packages/WP15.md), [WP18](work-packages/WP18.md), [WP19](work-packages/WP19.md) |
| [WP21](work-packages/WP21.md) | Refresh, coverage, corrections and operator controls | I07 | Terra / Sol | [WP07](work-packages/WP07.md), [WP14](work-packages/WP14.md), [WP15](work-packages/WP15.md), [WP16](work-packages/WP16.md), [WP17](work-packages/WP17.md) |
| [WP22](work-packages/WP22.md) | Authorization, privacy and hostile input qualification | I08 | Astra / Sol | [WP06](work-packages/WP06.md), [WP14](work-packages/WP14.md), [WP15](work-packages/WP15.md), [WP17](work-packages/WP17.md), [WP19](work-packages/WP19.md), [WP21](work-packages/WP21.md) |
| [WP23](work-packages/WP23.md) | Formal correspondence, integration and actual CI coverage | I08 | Astra / Sol | [WP02](work-packages/WP02.md), [WP04](work-packages/WP04.md), [WP05](work-packages/WP05.md), [WP06](work-packages/WP06.md), [WP07](work-packages/WP07.md), [WP08](work-packages/WP08.md), [WP09](work-packages/WP09.md), [WP10](work-packages/WP10.md), [WP11](work-packages/WP11.md), [WP12](work-packages/WP12.md), [WP13](work-packages/WP13.md), [WP14](work-packages/WP14.md), [WP15](work-packages/WP15.md), [WP16](work-packages/WP16.md), [WP17](work-packages/WP17.md), [WP18](work-packages/WP18.md), [WP19](work-packages/WP19.md), [WP20](work-packages/WP20.md), [WP21](work-packages/WP21.md), [WP22](work-packages/WP22.md), [WP30](work-packages/WP30.md) |
| [WP24](work-packages/WP24.md) | Whole-goal empirical acceptance E01 to E06 | I08 | Astra / Terra | [WP03](work-packages/WP03.md), [WP08](work-packages/WP08.md), [WP09](work-packages/WP09.md), [WP10](work-packages/WP10.md), [WP11](work-packages/WP11.md), [WP12](work-packages/WP12.md), [WP13](work-packages/WP13.md), [WP20](work-packages/WP20.md), [WP21](work-packages/WP21.md), [WP22](work-packages/WP22.md), [WP23](work-packages/WP23.md) |
| [WP25](work-packages/WP25.md) | Operating pilot, capacity and business sustainability | I08 | Terra / Astra | [WP21](work-packages/WP21.md), [WP24](work-packages/WP24.md) |
| [WP26](work-packages/WP26.md) | Migration, restart, restore and rollback rehearsal | I09 | Sol / Astra | [WP04](work-packages/WP04.md), [WP16](work-packages/WP16.md), [WP19](work-packages/WP19.md), [WP21](work-packages/WP21.md), [WP22](work-packages/WP22.md), [WP23](work-packages/WP23.md) |
| [WP27](work-packages/WP27.md) | Exact-candidate release and public operational acceptance | I09 | Astra / Terra | [WP24](work-packages/WP24.md), [WP25](work-packages/WP25.md), [WP26](work-packages/WP26.md) |
| [WP28](work-packages/WP28.md) | Conditional legacy retirement and consumer transition | AFTER | Terra / Sol | [WP27](work-packages/WP27.md) |
| [WP29](work-packages/WP29.md) | Deferred expansion and funding experiments | AFTER | Terra / Astra | [WP25](work-packages/WP25.md), [WP27](work-packages/WP27.md) |
| [WP30](work-packages/WP30.md) | Early complete cross-source vertical slice | SLICE | Astra / Terra | [WP08](work-packages/WP08.md), [WP09](work-packages/WP09.md), [WP13](work-packages/WP13.md), [WP15](work-packages/WP15.md), [WP17](work-packages/WP17.md), [WP18](work-packages/WP18.md) |

WP30 is the early complete vertical slice. WP23–WP24 qualify the whole goal;
WP25–WP26 establish operating and recovery readiness. WP27 alone owns the later
scoped release and public readback. A negative pilot can be a completed study
while still blocking release. WP28/WP29 do not block the core product.

## Inspected baseline and known inputs

The source baseline is `c8b36d7e9b27376bf121d9d6670c500a25c62423`; upstream HEAD/main
were checked during handoff preparation and matched. The target baseline is
TVD-CONCEPT-0.4, model SHA-256
`2db650c71d7a8703ff01b814e1db84629b33c9de99b702e2d90bad30235387a9`.
Reconcile both before implementation; this is a revision-specific inspection.

The source uses React/Vite/TypeScript and Cloudflare Worker/D1. Its existing CI
requests Node 22 and explicitly enumerates tests. New discovery tests need actual
CI wiring. Existing Watch/source machinery is reuse material, not proof of broad
source access or a ready discovery catalog.

Actual provider access, a suitable forum installation, reviewer/backup staffing,
spending/hour caps, permitted reader-pilot recruitment, current operating runbooks
and recovery objectives are inputs with assigned package owners. They are not
fabricated facts or reasons to stop unrelated local work. Read-only public/model
inspection does not establish private deployment configuration.

## Scope of this repository change

The top-level README links here. All other changes are this documentation package
and byte-preserved authored baseline artifacts. No application test/build, parser
or proof execution was required for unchanged application/model bytes. The
handoff validation report lists the checks that actually ran. Nothing was
committed, pushed, deployed or enrolled by this documentation task.
