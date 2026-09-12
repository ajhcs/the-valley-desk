# The Valley Desk: Watch V1 Engineering Blueprint

Status: implementation specification, not implementation approval or release evidence.
Prepared 2026-09-12. Product scope confirmed by Cole. Repository baseline inspected:
`29e6a4e`; staged policy candidate inspected: `23972f4`.

## Read This First

This package expands the [research plan](../watch-pages-improvement-plan-2026-09-12.md)
into a delivery contract. It specifies the recommended design, explains why the
boundaries exist, provides runnable examples, and defines what must be proved
before launch. Where this package is more specific than the research plan, follow
this package. Production behavior remains unchanged.

The result is four primary sections: **News, Events, Policy Watch, Technology
Watch**. News and Events retain their current editorial character. Watch pages
combine useful dated developments with durable, source-backed reference records.
Voices leaves primary navigation; its existing public URLs and attribution survive.

The most important distinction is between **a collected observation**, **an
accepted fact**, **a durable subject**, and **a published development**. They are
not interchangeable. A more capable model can help produce better proposed copy;
it cannot confer trust, create geographic eligibility, or authorize publication.

## Package Map

| Read | Purpose | Primary reader |
| --- | --- | --- |
| [Architecture](01-architecture.md) | Decisions, system boundaries, state machines, invariants, migration strategy | Engineering lead; every implementer before coding |
| [Contracts and data](02-contracts-and-data.md) | Entities, keys, dates, evidence, APIs, pagination, compatibility, examples | Backend and frontend engineers |
| [Collection and model](03-collection-and-model.md) | Source qualification, adapters, scheduling, batch path, Muse evaluation, operations | Ingestion engineer and editor |
| [UI specification](04-ui-specification.md) | Screens, behavior, components, responsive/accessibility requirements, copy | Frontend engineer and product reviewer |
| [Delivery and validation](05-delivery-and-validation.md) | Work packages, dependency graph, tests, acceptance, rollout, risks | Delivery owner and reviewers |
| [Research register](06-research-register.md) | Primary references, reusable patterns, tool choices, qualification limits | Implementers choosing integrations |
| [Handoff templates](07-handoff-templates.md) | Qualification, evaluation, PR/release receipts, worked policy trace | Every work-package owner |
| [Source plan](source-plan.json) | Machine-readable first-release source-family and county obligations | Ingestion owner |
| [Implementation map](implementation-map.json) | Requirement-to-work/test mapping and acyclic dependencies | Engineering lead |
| [Clickable mockup](mockups/index.html) | Policy, representatives, technology, News, Events, detail and empty states | Product and frontend reviewers |
| [Reference contracts](examples/contracts.ts) | Executable identity/date/evidence/eligibility examples | Junior engineers |
| [Reference tests](examples/contracts.test.ts) | Expected behavior and counterexamples | Implementers and reviewers |
| [SQL laboratory](examples/schema.sql) | Isolated examples of uniqueness and revisioned pagination | Backend engineers |
| [Validation receipt](VALIDATION.md) | What was actually checked for this documentation package | Everyone assessing readiness |

The mockup opens directly as a local HTML file. It does not contact collectors,
model providers, production APIs, or public data services. Its sample policies,
officials, News, and Events are explicitly synthetic. ORCA is a researched example,
not a claim that a current release has occurred. Mockup behavior is not production
frontend implementation.

## Non-Negotiable Scope

| ID | Requirement | Design and acceptance home |
| --- | --- | --- |
| R01 | Federal plus PA, NJ, and DE policy in the first public Watch release | Collection source matrix; W06/W07 |
| R02 | Philadelphia and the existing 11-county footprint have explicit coverage dispositions | `source-plan.json`; W07 coverage test |
| R03 | Technology requires verified, artifact-specific Delaware Valley provenance | Contract `technologyEligible`; W08 negative fixtures |
| R04 | Technology explains purpose, workflow, access, evidence, and license, not just links | UI technology dossier; W09 ORCA acceptance |
| R05 | Representatives are accurate for office, district, role, and time; no ZIP-based guesses | Contracts membership model; W07/W09 |
| R06 | Muse 1.3 is qualified with unchanged deterministic publication gates first | Model experiment; W02/W03 |
| R07 | Broader collection preserves source provenance, health, fairness, and replay safety | Architecture invariants; W04/W05 |
| R08 | News and Events receive focused improvements without editorial or URL regression | UI specification; W10 |
| R09 | Existing permalinks, editorial lead, legacy feed contracts, and review records survive | Contract compatibility matrix; W01/W11 |
| R10 | Changed policy evidence never inherits an old interpretation approval | Evidence dependency binding; W06 tests |
| R11 | Every public consequential fact is supported; unknown facts remain unknown | Public projection rules; W04/W08 |
| R12 | Release claims require exact-candidate tests and natural-cycle observation | W12/W13; release ledger |

Regional counties: PA Philadelphia, Bucks, Montgomery, Chester, Delaware; NJ
Camden, Burlington, Gloucester, Salem, Atlantic; DE New Castle. This preserves
`fixtures/coverage-pack-v1.json`, including its existing edge-system exclusions.
An institution name containing "Penn" is not sufficient identity evidence.

## Decision Summary

1. Extend the current React/TanStack/Workers/D1 application. Do not introduce a
   second CMS, general graph database, vector database, or replacement crawler.
2. Reconcile the checkout, recorded deployed fixes, and staged policy/PDF work
   before selecting migration numbers or writing integration code.
3. Separate public dossiers from dated `ContentItem` developments. Both are
   materialized from accepted evidence, not directly from raw collector tables.
4. Preserve source-native policy statuses and model lifecycle, latest action,
   legal effect, and interpretation readiness as separate dimensions.
5. Use immutable observations, explicit document/version hashes, and idempotent
   development keys. Mutable titles, URLs, and fetch times are not identity keys.
6. Add a `technology` development kind through explicit v2 delivery. Freeze the
   existing v1 schema instead of widening its enum behind consumers' backs.
7. Keep small API/feed collection in the Worker; use a bounded, separately
   qualified batch collector for archives and Access exports. PDF interpretation
   remains operator-reviewed in v1, reusing the staged workflow.
8. Ship URL-backed filters and local-browser saves, not new accounts or email
   notification infrastructure. Current paused social work stays paused.
9. Treat source enrollment as a measured operating process. "Configured," "last
   succeeded," "currently usable," and "complete coverage" are different facts.
10. Use thin, reviewable work packages and explicit launch holds. Do not describe
    a PA-only preview as the requested first release.

## How a Junior Engineer Starts

1. Read the architecture invariants and the relevant work package in the delivery
   guide. Identify its upstream deliverable and named reviewer role.
2. Follow repository `AGENTS.md`. Read operational notes before runtime work.
   Do not run ingestion, deploy, migrate remotely, or change provider privacy
   settings as an incidental part of implementing a local change.
3. Work only from the reconciled candidate established in W00. Inspect current
   changes before editing; preserve other tasks' files and historical receipts.
4. Add a failing fixture test for the relevant requirement before changing code.
   Extend the existing module/API first; new proposed paths below are not claims
   that those files already exist.
5. Implement the smallest end-to-end behavior: parsed observation -> persisted
   fact -> deterministic decision -> public projection -> rendered state.
6. Run targeted tests, inspect the diff, and attach evidence to the work package.
   New tests must be added to `package.json`: the current test command explicitly
   lists files, so creating a test file alone does not add it to CI.
7. Request specialist review for policy interpretation, source authority, license
   labels, API compatibility, or operations. Do not decide these by model score.

Documentation examples run without credentials or network:

```bash
node --import tsx/esm --test docs/watch-v1-blueprint/examples/contracts.test.ts
node --test docs/watch-v1-blueprint/examples/sql.test.mjs
node --test docs/watch-v1-blueprint/examples/blueprint.test.mjs
node node_modules/typescript/bin/tsc -p docs/watch-v1-blueprint/examples/tsconfig.json
```

The SQL laboratory uses Node's `node:sqlite` and was checked on the host version
recorded in `VALIDATION.md`; it is not a substitute for Wrangler/D1 testing or a
change to the application's Node support policy. The standalone TypeScript
reference has its own no-emit typecheck configuration.

## Definition of Ready vs. Done

**Ready for implementation:** decisions are stated; examples have been tested;
source qualification and operational dependencies have owners, gates, and
fallbacks. This document aims to meet that standard.

**Done for launch:** required sources work, real evidence passes review, the exact
application candidate passes tests and browser checks, deployment is authorized,
rollback is proven, and normal scheduled processing has been observed. This
planning task does not meet or claim that separate standard.

The biggest remaining uncertainty is qualified operating capacity: upstream
source behavior, batch hosting, editorial review availability, and provider
latency under the expanded workload. These are measured in early work packages,
not concealed inside optimistic delivery dates.
