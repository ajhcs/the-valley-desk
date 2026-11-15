# Orchestrator execution guide

This is a handoff, not a running task queue. The current instruction authorizes
planning documents only. All core packages are `not_started`; conditional later
packages are `deferred`. Begin implementation only when the user requests it.

## First execution assignment

When implementation is requested, start WP00. Read this guide, README,
ARCHITECTURE, REQUIREMENTS, EVIDENCE, plan.json and the relevant package documents.
Reconcile source HEAD and upstream before selecting an isolated implementation
checkout. Preserve this planning branch, historical model files, unrelated dirty
work and evidence. Never run repository commands at the worktree container root.
Keep projects, builds, environments and caches on verified Samsung `/workspace`.

Use the selected identity and repository instructions. Read the current runbook
before runtime/deployment work. The historical project instruction names a
Plumbob production note that was unavailable during planning; locate the current
authorized operating documentation before dependent operations. Its absence
does not block independent local document, contract or fixture work. Do not start
copied crons, integrations, coordination workers, or production-connected tools.

WP00 produces a current source/configuration inventory, environment findings,
compatibility map and input-owner register. Then complete WP01 policy and WP02
model/interface reconciliation. WP03 freezes evaluation design and development/
holdout separation. Review contracts before implementation agents diverge.

## Assignment and ownership

`plan.json` is authoritative for package ID, phase, owner, reviewer, dependency,
status and document path. Detailed instructions and acceptance criteria live in
the package document. Change them together. `requirements-index.json` and
`scope.json` provide traceability indexes; they do not replace SysML semantics.

| Role | Initial responsibility |
| --- | --- |
| Orchestrating engineer | Contract ownership, sequencing, conflict resolution, integration, evidence freshness, engineering acceptance and scope tracking. |
| Sol (`gpt-6.1-sol`) | Typed storage, evidence, acquisition, scheduler, admission APIs, publication/query and recovery work. |
| Terra (`gpt-6.1-terra`) | Product policy, review/reader experience, delivery boundaries, accessibility, operational UX and sustainable operating plans. |
| Astra (`gpt-6-astra`) | Model/contract reconciliation, reference design, adversarial qualification, correspondence and release-evidence challenge. |
| Accountable editorial/operating people | Real editorial authority, source-access decisions, participant arrangements, staffing/spending and operational acceptance where applicable. |

Assignments are starting choices. Reassign based on demonstrated fit or capacity,
recording the reason and replacement reviewer. Preserve independent challenge.
No agent approves its own consequential package. The orchestrator inspects
decisive evidence rather than aggregating optimistic summaries.

## Dependency rules and parallel work

Dependencies mean **accepted prerequisite outputs before package acceptance**.
Contract review, mocks and isolated fixtures may start earlier against a frozen
interface, but this cannot mark a dependent package complete. Do not use a shared
file as an implicit communication channel for incompatible interface changes.

After WP02, WP03 and WP04 can proceed in parallel. WP05 follows the schema;
WP06 establishes source transport. Provider packages WP08–WP13 and scheduler WP07
can then proceed independently. WP14 needs frozen rubric/reference design,
evidence and source contracts; it need not wait for every live provider. WP16
publication precedes accepted review UI integration and WP17 queries. Reader
work WP18–WP20 follows the API and routing contract.

Run WP30 as soon as its limited GitHub/PubMed/institutional dependencies and reader
path exist. It is the early integration checkpoint, not an authorization for
broad enrollment. Finish remaining providers and operations in parallel where
contracts permit. WP23 collects complete correspondence; WP24 evaluates the
whole goal; WP25 and WP26 establish operating and recovery readiness; WP27 owns
actual release/readback. WP28/WP29 are conditional later work.

Phases I01–I09 express capability increments, not an artificial whole-phase
barrier. Follow actual dependency edges. Do not invent a deadline by dividing
work by the number of agents: estimate after the first slice using observed
review, integration and provider-access effort.

One writer owns each file/interface at a time. The orchestrator controls
`worker.js`, central router/navigation, migration numbering, package/lock files,
shared schemas, CI configuration and model/profile revisions. Reserve a short
integration window or designate one owner for these files; provider owners should
work in their assigned modules. Use separate worktrees for implementation where
it helps preserve dirty work; integrate reviewed commits without unrelated edits.

## Dispatch template

```text
Package and purpose: WPxx / linked requirement and model IDs.
Baseline: exact source SHA; model, policy, interface and fixture revisions.
Owned paths: explicit writable files; shared files reserved to the integrator.
Inputs: accepted dependency receipts and known unavailable external inputs.
Deliverables: artifacts/code/docs listed in the package; no extra service scope.
Acceptance: AC-WPxx-nn and required adverse/recovery cases.
Tools/skills: selected relevant workflows, qualified runtime and test state.
Boundaries: no production calls, enrollment, outreach, deployment or deletion
unless the current execution scope specifically includes that action.
Handoff: changed-file list, evidence paths/commands, failure history, open issues,
review request, and whether any dependent contract must change.
```

Local reversible work within an implementation request should proceed without
repeated approval requests. When an action needs missing access or operating
scope, prepare the concrete change and evidence first, then resolve that specific
input. Do not ask the user to run commands without inspecting available tools and
permissions. Do not interpret this planning task as implementation authorization.

## Skills and dependency policy

Use installed CSE coordination, architecture, scenarios, measures, evidence and
change-review skills for their stated deliverables. Resolve the actual runtime
and pinned parser, use a private cache and preserve model IDs. For UI work use
product-design audit and frontend testing/debugging; apply accessibility review
to complete flows. Use targeted security review for authority, untrusted content,
intake and public/private boundaries. Literature/reference skills can support
source claims but cannot confer authorship, rights or regional truth.

Begin with the existing application repository and installed libraries. Propose
new libraries only against an identified need; review maintenance, runtime,
license, size and reproducible locking. Avoid unrelated package upgrades and
cross-repository copying. Public discovered repositories are data sources, not
code to execute as part of collection.

## Change and evidence control

For every material change record the question, evidence, selected decision,
affected model/requirement/interface/package IDs, alternatives rejected for a
reason, and a reconsideration trigger. Reuse existing model decision/evidence
records where applicable. New implementation decisions do not silently amend
the frozen v0.4 model or retained proof scopes.

If a change touches query, identity, rights, authority, policy or visibility,
reopen its dependent contracts and tests. Review reverse dependencies from
plan.json and model mappings; do not claim a complete impact analysis when native
coverage is incomplete. Mark old results stale, retain counterexamples and rerun
the relevant checks. Broadening a check set is appropriate when mapping is weak.

Classify a failed result as implementation defect, inadequate evidence, source
failure, bad observation, contract ambiguity or proposed scope change. Repair
within accepted meaning; never narrow the reference set or lower thresholds
after seeing results to manufacture success. An unavailable optional field can
remain unknown while independent work continues. A missing required route or
critical authority failure blocks full-scope acceptance.

## Package acceptance and status

Future statuses may progress `not_started → in_progress → in_review → accepted`.
Use `blocked` for a specific unmet dependency/input with an owner and next action;
use `deferred` for conditional later scope. `accepted` means the specified package
criteria and prerequisite outputs have actual reviewed evidence; it does not
automatically mean deployment, editorial publication, or business acceptance.

At handoff, require: exact revisions, accepted dependency receipts, output paths,
all AC dispositions, tests/observations actually run, retained failures, unresolved
limitations, reviewer challenge and orchestrator disposition. Keep a concise
sanitized integration receipt in the repo and sensitive observations in the
authorized evidence store. Do not overwrite the historical planning validation
report with implementation success labels.

## Stop and continuation rules

Stop the affected action on suspected publication bypass, private-field leakage,
unsupported identity merge, missing critical source permission, unsafe migration,
unreconciled production configuration, or breached trial budget. Preserve state,
contain affected visibility if within authorized operating scope, and retain
evidence. Continue unrelated contract, fixture and local work where safe.

For source infeasibility or poor reader outcomes, present the observed failure
and revised plan. A narrower pilot remains narrower; it cannot count as complete
six-route delivery. For staff/cost overload, adjust extraction, enrollment or
staffing transparently, preserving public truth gates. The user-facing completion
claim is the set of gates actually achieved, not the number of packages written.
