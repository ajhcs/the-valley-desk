# Requirements and operational scenarios

These are implementation obligations derived from the accepted discovery goal
and the 101-item plan. They remain unimplemented. WP02 reconciles the proposed
refinements with the frozen authoritative model. The delivery indexes preserve
traceability; they do not assert that prose requirements have been formally proved.

## System requirements

| ID | Required behavior and acceptance boundary |
| --- | --- |
| R01 | Apply exactly the selected nine county keys to evidenced professional relations. Distinguish current presence, historical affiliation and regional contribution at the relevant time. Unknown or outside location cannot satisfy positive regional eligibility. |
| R02 | Admit health-tech work only with evidenced healthcare purpose and substantive technology/informatics/health-AI development, application, evaluation or explanation. Incidental computing, generic AI and adoption alone are negative cases. |
| R03 | Keep people, organizations and source-scoped accounts distinct. Admit qualified independent creator profiles without artifacts, and independent papers/preprints/discussions without repositories or project groups. Names alone cannot merge identity. |
| R04 | Bind every public factual claim to permitted versioned evidence and accountable decisions. Preserve conflicts, source-origin equivalence, parser revisions and the difference between occurrence and observation. Duplicate copies cannot inflate corroboration. |
| R05 | Model supported contribution, affiliation, project and artifact relations with appropriate times; preserve partial dates; support rights by artifact/version/material. Unknown or restricted terms cannot become reuse permission. |
| R06 | Provide qualified independent GitHub, PubMed, Crossref, arXiv, public-forum and institutional/association acquisition, plus the same governed extension interface for other sources. A missing required route prevents full-scope acceptance. |
| R07 | Bound requests, decompressed/retained bytes, retries and concurrent reservations. Persist capture before interpretation/checkpoint progress, fence workers, resume safely, and expose typed health and incomplete collection. |
| R08 | Only authenticated authorized review or a qualified deterministic rule may admit public claims. Model suggestions and public submissions cannot mint authority. Review shows evidence, conflicts, expected revisions and durable outcomes. |
| R09 | Commit allowlisted immutable public revisions only against valid complete dependency heads and authority in an atomic operation. Reject stale writers and prevent private candidate leakage across all delivery surfaces. |
| R10 | Apply one normalization/query/facet contract, precise partial-date filtering and deterministic total orders. Support explainable relevance and recent-source sorting without ingestion-date boosts. Counts match the same eligible result set. |
| R11 | Bind continuation to an immutable revision set, actual canonical query, sort, generation, as-of, epoch and expiry. Valid pages partition that snapshot; material invalidation ends continuation explicitly rather than silently dropping records. |
| R12 | Provide usable work, people, organization and supported project journeys, source explanations, current/historical and publication-stage labels, and valid next actions. Empty, incomplete, unknown, unavailable and error states remain distinguishable. |
| R13 | Qualify public and operator flows for WCAG 2.2 AA and supported mobile/keyboard/screen-reader use. Measure frontend and query performance against declared workload and budgets; automated checks alone do not establish accessibility. |
| R14 | Support reviewable suggestions/corrections, material withdrawal, expiry, source refresh and public coverage explanation. Failure retains permitted evidence but cannot renew current truth or claim empty/complete coverage. |
| R15 | Preserve existing news/event/Watch routes, feeds, metadata and consumers through additive rollout. Redirect only identity-preserving replacements; retire services only after a concrete consumer transition. |
| R16 | Enforce source and operator boundaries, bounded retention and removal, actionable observability, pause/replay controls, recoverable migrations and exact-candidate rollback. Keep real operating scope distinct from local test authority. |
| R17 | Retain independent formal obligations, source/reference cases and actual exact-revision verification/validation results. Connect requirements to implementation and E01–E06 without claiming source truth, operating acceptance or reader value from parsing or unit tests. |
| R18 | Preserve free basic evidence-based discovery, initial audience focus and a funded maintainable operating model. Measure review/correction capacity and useful reader outcomes before expansion or paid-service commitments. |

The [requirement index](requirements-index.json) maps these IDs to responsible
packages. The [formal correspondence index](verification-index.json) maps every
P01–P32 family to its historical guarantee, assumption, implementation owners and
verification owner. [EVIDENCE](EVIDENCE.md) defines all six empirical gates.

## Scenario obligations

WP02 records these in the next model revision; package owners retain fixture or
observation IDs. Each scenario needs initial state, trigger, actor, inputs,
expected public/private output, recovery, and exact evidence revision.

| ID | Trigger and expected result | Primary packages |
| --- | --- | --- |
| S01 | Qualified independent professional with no artifact: a supported creator profile is searchable without invented employment or work. | WP04, WP14, WP18, WP30 |
| S02 | Paper/preprint with no code: independent discovery, evidence, admission and reader path succeed. | WP09–WP11, WP14, WP18, WP24 |
| S03 | Institution publishes work with ambiguous individual authors: the qualified work remains visible; unsupported person joins remain absent. | WP13, WP14, WP18 |
| S04 | Local technical contributor to a nonlocal project: display the supported contribution and time, without claiming all project activity is regional. | WP04, WP14, WP18 |
| S05 | Creator moves into the region after older work: current profile may qualify, but the older nonlocal work does not enter local-at-creation results/counts. | WP01, WP04, WP14, WP17 |
| S06 | Creator moves out after local work: historical contribution remains supported; expired current presence is not presented as current. | WP04, WP16, WP18, WP21 |
| S07 | Same name or ambiguous handle: no automatic merge; accepted correction can split mistaken identities and invalidate affected projections. | WP04, WP14, WP21 |
| S08 | Repository rename/transfer/fork: original identity persists through rename/transfer; fork remains distinct with an evidenced relationship. | WP04, WP08 |
| S09 | Preprint receives journal publication: version/relationship evidence connects artifacts while preserving stage, identifiers, dates and rights. | WP10, WP11, WP14, WP18 |
| S10 | Paper corrected/retracted or forum post removed: retain permitted history, label supported status and withdraw unsupported current claims without inventing reasons. | WP10, WP12, WP16, WP21 |
| S11 | Year-only date or unknown county: preserve precision/unknowns; conservative filters do not invent a day or positive geographic match. | WP04, WP14, WP17 |
| S12 | Conflicting first-party pages or repeated syndicated records: retain competing claims and provenance groups, not last-write-wins truth or multiplied corroboration. | WP05, WP14 |
| S13 | Timeout, rate limit, partial page or empty enrollment: preserve typed failure and previous evidence; do not report healthy-empty or completed coverage. | WP06, WP07, WP21 |
| S14 | Worker crashes after capture or loses its lease: replay resolves the retained operation; checkpoint, budgets and source fairness remain correct. | WP07, WP23, WP26 |
| S15 | Another reviewer changes a dependency between validation and publication: stale commit aborts without partial rows or generation advance. | WP14, WP16, WP23 |
| S16 | Correction or expiry between search pages: old cursor yields a restart; a still-valid snapshot has no duplicate/omitted members. | WP16, WP17, WP21 |
| S17 | Model/source text requests approval or carries hostile markup/URL: text remains data, authority is unchanged and public output is safe. | WP06, WP14, WP22 |
| S18 | Public client forges reviewer fields or requests private candidate data: unauthorized mutation is rejected and no private fields leak through API/HTML/crawler. | WP14–WP16, WP19, WP22 |
| S19 | Database unavailable or migration interrupted: discovery reports an honest failure, independent legacy behavior remains compatible, and recovery is reproducible. | WP19, WP21, WP26 |
| S20 | Operating queue or trial spend reaches its cap: pause the affected intake under the trial scope, preserve evidence and report capacity rather than weaken admission. | WP21, WP25 |
| S21 | Keyboard/mobile/screen-reader user searches, filters, returns from detail and encounters invalidation: state and focus remain understandable, with a usable next action. | WP18–WP20, WP24 |
| S22 | Legacy URL/feed consumer after rollout: identity and contract remain valid or have a verified equivalent redirect; no silent regional relabeling. | WP19, WP26–WP28 |
| S23 | Restore an older database containing a revoked claim and its matching old epoch: external recovery incarnation rejects old cursors; public reads stay closed until post-backup corrections/removals are reconciled or affected claims requalified. | WP16, WP17, WP26, WP27 |

These cases augment the original finite model; describing them here is not an
executed scenario result. WP23 checks coverage of all cases and their relevant
failure/recovery paths; WP24 evaluates external truth and intended-reader meaning.

## Nonfunctional and operating inputs

WP01/WP03 freeze inclusion, temporal, label and evaluation criteria before tuning.
WP02 freezes query limits and publication/read consistency semantics. WP06 freezes
per-provider permitted access and collection budgets before requests. WP20 defines
the representative device/data/load envelope before performance acceptance. WP25
freezes trial duration, staff/spend caps and stopping criteria before the pilot.
WP26 freezes recovery objectives before rehearsal. None of these unknown measured
capacities may be filled in by copying a legacy news SLO or inventing resources.
