# Discovery ownership and scope

WP00 owner proposal for independent Sol review. Package acceptance belongs to the orchestrator. Active states and reviewed dependency dispositions live in [execution.json](execution.json); this table preserves the frozen handoff assignments without implying acceptance.

## Package register

Each package has one accountable agent owner and a different reviewer. The prerequisite IDs below require accepted outputs before package acceptance. Early contract/mock work requires a frozen interface and cannot discharge dependencies. No agent accepts its own consequential package.

| Package | Accountable owner | Independent reviewer | Prerequisites | Authority boundary |
| --- | --- | --- | --- | --- |
| [WP00](../discovery-engineering/work-packages/WP00.md) | Astra | Sol | None | Local engineering; integration accepted by orchestrator. |
| [WP01](../discovery-engineering/work-packages/WP01.md) | Terra | Astra | WP00 | Policy/review implementation; accountable editorial authority remains separate. |
| [WP02](../discovery-engineering/work-packages/WP02.md) | Astra | Sol | WP01 | Local engineering; integration accepted by orchestrator. |
| [WP03](../discovery-engineering/work-packages/WP03.md) | Astra | Terra | WP02 | Evaluation design/code; independent labels and permitted reader sessions remain external inputs. |
| [WP04](../discovery-engineering/work-packages/WP04.md) | Sol | Astra | WP02 | Local engineering; integration accepted by orchestrator. |
| [WP05](../discovery-engineering/work-packages/WP05.md) | Sol | Astra | WP04 | Local engineering; integration accepted by orchestrator. |
| [WP06](../discovery-engineering/work-packages/WP06.md) | Sol | Astra | WP02, WP05 | Fixture/code work; actual provider access/enrollment remains held. |
| [WP07](../discovery-engineering/work-packages/WP07.md) | Sol | Astra | WP06 | Fixture/code work; actual provider access/enrollment remains held. |
| [WP08](../discovery-engineering/work-packages/WP08.md) | Sol | Terra | WP06 | Fixture/code work; actual provider access/enrollment remains held. |
| [WP09](../discovery-engineering/work-packages/WP09.md) | Sol | Astra | WP06 | Fixture/code work; actual provider access/enrollment remains held. |
| [WP10](../discovery-engineering/work-packages/WP10.md) | Sol | Astra | WP06 | Fixture/code work; actual provider access/enrollment remains held. |
| [WP11](../discovery-engineering/work-packages/WP11.md) | Sol | Astra | WP06 | Fixture/code work; actual provider access/enrollment remains held. |
| [WP12](../discovery-engineering/work-packages/WP12.md) | Sol | Terra | WP06 | Fixture/code work; actual provider access/enrollment remains held. |
| [WP13](../discovery-engineering/work-packages/WP13.md) | Sol | Terra | WP06 | Fixture/code work; actual provider access/enrollment remains held. |
| [WP14](../discovery-engineering/work-packages/WP14.md) | Sol | Astra | WP03, WP05, WP06 | Policy/review implementation; accountable editorial authority remains separate. |
| [WP15](../discovery-engineering/work-packages/WP15.md) | Terra | Astra | WP14, WP16 | Policy/review implementation; accountable editorial authority remains separate. |
| [WP16](../discovery-engineering/work-packages/WP16.md) | Sol | Astra | WP05, WP14 | Local engineering; integration accepted by orchestrator. |
| [WP17](../discovery-engineering/work-packages/WP17.md) | Sol | Astra | WP16 | Local engineering; integration accepted by orchestrator. |
| [WP18](../discovery-engineering/work-packages/WP18.md) | Terra | Sol | WP17 | Local engineering; integration accepted by orchestrator. |
| [WP19](../discovery-engineering/work-packages/WP19.md) | Terra | Sol | WP17, WP18 | Local engineering; integration accepted by orchestrator. |
| [WP20](../discovery-engineering/work-packages/WP20.md) | Terra | Astra | WP15, WP18, WP19 | Local engineering; integration accepted by orchestrator. |
| [WP21](../discovery-engineering/work-packages/WP21.md) | Terra | Sol | WP07, WP14, WP15, WP16, WP17 | Local engineering; integration accepted by orchestrator. |
| [WP22](../discovery-engineering/work-packages/WP22.md) | Astra | Sol | WP06, WP14, WP15, WP17, WP19, WP21 | Local engineering; integration accepted by orchestrator. |
| [WP23](../discovery-engineering/work-packages/WP23.md) | Astra | Sol | WP02, WP04, WP05, WP06, WP07, WP08, WP09, WP10, WP11, WP12, WP13, WP14, WP15, WP16, WP17, WP18, WP19, WP20, WP21, WP22, WP30 | Local engineering; integration accepted by orchestrator. |
| [WP24](../discovery-engineering/work-packages/WP24.md) | Astra | Terra | WP03, WP08, WP09, WP10, WP11, WP12, WP13, WP20, WP21, WP22, WP23 | Evaluation design/code; independent labels and permitted reader sessions remain external inputs. |
| [WP25](../discovery-engineering/work-packages/WP25.md) | Terra | Astra | WP21, WP24 | Operating study; named people, caps and trial scope required for actual pilot. |
| [WP26](../discovery-engineering/work-packages/WP26.md) | Sol | Astra | WP04, WP16, WP19, WP21, WP22, WP23 | Local preparation; production migration, recovery and deployment are not authorized. |
| [WP27](../discovery-engineering/work-packages/WP27.md) | Astra | Terra | WP24, WP25, WP26 | Local preparation; production migration, recovery and deployment are not authorized. |
| [WP28](../discovery-engineering/work-packages/WP28.md) | Terra | Sol | WP27 | Conditional later scope; no retirement or expansion authorized. |
| [WP29](../discovery-engineering/work-packages/WP29.md) | Terra | Astra | WP25, WP27 | Conditional later scope; no retirement or expansion authorized. |
| [WP30](../discovery-engineering/work-packages/WP30.md) | Astra | Terra | WP08, WP09, WP13, WP15, WP17, WP18 | Local engineering; integration accepted by orchestrator. |

## Writer reservations and decisions

Astra owns WP00's `baseline-receipt.json`, `decision-register.md`, `ownership.md`, and `validation-environments.md` during preparation and review. Sol reviews these outputs without editing them. The orchestrator owns active `execution.json`, integration receipts, shared-file reservations, and acceptance. The orchestrator reserves `worker.js`, central routing/navigation, migration numbering, package/lock files, shared schemas, CI, and model/profile revisions unless explicitly delegated.

The installed model assignments are Sol (`gpt-6.1-sol`), Terra (`gpt-6.1-terra`), and Astra (`gpt-6-astra`). These are engineering roles, not authenticated editorial identities. No real editor, backup, reference reviewer, participant, or spending authority is assigned by this document.

WP01 freezes the geography/relevance/editorial policy. WP02 reconciles the frozen native model and versions IF01–IF10 before downstream implementation. An owner must reserve affected files with the orchestrator before writing a shared interface. The decision register governs changes; dependent evidence becomes stale when its inputs change.

## Required scope register

The six independent acquisition routes remain separate acceptance obligations. Route qualification requires actual permitted access later; all six currently lack new discovery qualification.

| Route | Package | Required independent journey |
| --- | --- | --- |
| GitHub | WP08 | A repository with evidenced creator role and regional contribution reaches review and discovery. |
| PubMed | WP09 | A paper can qualify without a repository or project; optional person identity may remain unresolved. |
| Crossref | WP10 | DOI metadata can independently discover work; duplicate deposits do not become independent corroboration. |
| arXiv | WP11 | A versioned preprint can qualify without a repository; preprint/journal identities remain distinct. |
| Public forum | WP12 | A qualified installation yields a technical discussion with scoped evidence, rights and regional creator basis. |
| Institution/association | WP13 | Public professional evidence can discover an independent creator without employment, residence, organization membership, or an indexed artifact. |

Creator-first discovery and artifact-first discovery are distinct. People and organizations have continuing identities; works have versions, contributions, and dated regional relations. The nine county keys are `PA:Bucks`, `PA:Chester`, `PA:Delaware`, `PA:Montgomery`, `PA:Philadelphia`, `NJ:Burlington`, `NJ:Camden`, `NJ:Gloucester`, and `NJ:Mercer`. Current professional presence and regional-at-creation work are separate filters and denominators. WP30 must exercise the independent professional, repository-free paper, and repository paths, including hold and correction cases. It cannot substitute for six-route acceptance.

Patents, general crawling, reader accounts, social features, vector search, mobile apps, billing, and legacy retirement remain deferred under the handoff's decisions. No required route may disappear because a provider is difficult to qualify.

## External input ownership

| Input | Resolution owner | Dependent action held |
| --- | --- | --- |
| U01: current operating runbook/runtime | Orchestrator and accountable operating owner; Astra records evidence | Production-connected runtime and release operations; local synthetic work uses the scoped replacement. |
| U02/U03: provider permissions and forum installation | Sol, WP06 and provider owner | Real acquisition, retention/display, enrollment and route acceptance. |
| U04/U05: editor, backup, hours and spending caps | Terra, WP01/WP25, with accountable people | Real admission, paid use and recurring operating pilot. |
| U06: independent reviewers and participants | Astra, WP03/WP24, with accountable research owner | Accepted external-truth labels and reader sessions. |
| U07: recovery objectives and isolated destination | Sol, WP26, with operating owner | Recovery rehearsal acceptance. |
| U08: release bindings and operational scope | Orchestrator/Astra, WP27, with operating owner | Live migrations, scheduler changes and deployment. |
| U09: source/intake retention and removal | Sol/Astra, WP05/WP06/WP22 | Retaining or displaying affected real material. |

Evidence may resolve an input; an agent assignment cannot supply missing permission, staff time, money, or source truth. Available independent local work continues while a specific operational action is held.
