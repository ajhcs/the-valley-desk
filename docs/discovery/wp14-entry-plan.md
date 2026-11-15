# WP14 entry handoff

**Preparation proposal only; WP14 deferred pending WP03, not accepted.** Sol
owns preparation; Astra independently reviews; the orchestrator accepts packages.
Inspected baseline: `84b801bd0905e2759e6ee6afca1c2f4e4088f910`, 2026-11-15.
This document changes no source, migration, routing, model, threshold or real
editorial authority. Every future check below is `mode: plan`, `result: not_run`.

## Entry decision

Frozen [WP14](../discovery-engineering/work-packages/WP14.md) says “Stop on
missing authority mappings, unresolvable evidence or unfrozen rubric.” The
user's instruction to continue in order preserves that dependency. Contract
review can finish now; rule/admission/endpoint implementation remains stopped.

| Gate | Current evidence | Required before entry/activation |
| --- | --- | --- |
| WP03 | [Actual manifest](reference-manifest.json): not_frozen, zero cases/reviewers/sources, null sampling/history. [Latest progress](receipts/WP03-case-selection-binding-progress.json): blocked, freeze=false, E01–E06 not_run. | Accepted freeze/rubric with permitted originals, real independent annotations/adjudication/disagreements, verified trust/rights/revocation, family-disjoint development and 360-case held-out sets (60 per route), independent ≥100 eligible recall roster, sampling/exposure history and accepted gate definitions. Selection-v2 signatures/intake exit 0 do not issue a freeze or prove truth. |
| WP02 | [Accepted receipt](receipts/WP02.json), [IF04/IF08/IF09](interface-contracts.md): four targets, two authority variants, 18 dependency kinds. | Concrete action grants, full-vector storage mapping and new API envelope review. Existing schemas authenticate nobody. |
| WP05/WP06 | [WP05](receipts/WP05.json)/[WP06](receipts/WP06.json) accepted private storage/registry with synthetic capabilities/source samples. | Authentic scoped reviewer/rule resolver, selector→reviewed-origin adjudication, safe catalog/removal bridge, real source permissions/qualification before real material use. No accepted provider access or editorial identity follows from local tests. |
| Authority/operations | [Ownership](ownership.md) leaves accountable editors, source rights and operational inputs external. | Named responsible human/action/scope/expiry/revocation grants; registered qualified rule/version; separate source, participant, spending and release scope where applicable. Agent ownership is engineering responsibility only. |

[EX07](implementation-decisions.md#ex07--separate-reference-preparation-from-the-later-admitted-item-audit)
requires WP03 to freeze the audit selection procedure; the actual ≥100 admitted
item audit occurs later in WP24. Do not create a WP03↔WP14 dependency cycle.
Thresholds remain unchanged. Held-out cases used to repair rules are consumed;
a fresh accuracy claim needs newly frozen untouched evaluation material.

## Authority and existing store gaps

Accepted restrictions come from WP02 and frozen WP14; the integration assignments
below are **proposals**, requiring accountable review before implementation.

| Actor | Proposed action | Boundary / current gap |
| --- | --- | --- |
| Unauthenticated/wrong origin | No private access | Preserve Ops private 404 before dispatch/body/detail lookup. |
| Verified human Ops principal | Approved private reads/proposals | Existing verifier returns one allowlisted human email, not a discovery authentication-context/action grant. |
| Appointed discovery reviewer | Accept/hold/reject/supersede within explicit grant | Server derives identity, context, action, request digest, operation, target/scope, expiry/revocation and minimal audit permission. Body reviewer/authority fields never authorize. |
| Authenticated model/service | Stage bounded suggestions in approved scope | No decision, publish, rule or human impersonation. Current Ops verifier admits no service role; do not broaden its human allowlist as a shortcut. Service-auth design remains unresolved. |
| Server qualified-rule executor | Run registered rule/version with current scoped qualification | Reconstruct retained inputs; no public execute-rule action, caller rule flag or model confidence supplies authority. Registry/qualification path is absent. |
| Source operator / WP16 publisher | Separate source controls / separate guarded publication | Neither source permissions nor admission grant the other's power. WP14 creates no public row. |

`ops-access.ts` already rejects workers.dev/alternate origin, checks POST Origin
and verifies JWT before dispatch. `ops-jwt.ts` checks RS256/JWT, configured
issuer/audience, bounded JWKS and required temporal/identity claims.
`watch-editorial-api.ts` supplies useful strict/bounded JSON patterns, but its
routes/storage are not discovery. `review-api.ts` uses process-local Maps for
idempotency/rate control; these cannot provide durable discovery replay.

| Required seam | Actual existing anchor | Missing work, not implemented here |
| --- | --- | --- |
| Candidate reconstruction | WP07 `src/ingest/discovery/collection-store.ts`, 0044 pages/leads/chains/operations; `resolvePage`/`resolveChainPage` | Monotonic materialized review candidate/head and canonical context digest. Private parser leads are not catalog subjects or evidence. |
| Evidence/decision history | WP05 `src/ingest/discovery-evidence-store.ts`, 0042 revisions/contents/heads/edges/operations | `appendDecision` is claim-only and always emits authenticated-reviewer. Need four-kind admission adapter, qualified-rule path and atomic multi-claim outcomes. Sequential successful calls are not one transaction. |
| Catalog qualification | WP04 `src/ingest/discovery-store.ts`, 0041 entities/relations/aliases/decision refs | 0042 evidence-backed decision/alias/relation bridge triggers deliberately abort. Keep them until a reviewed removal-safe replacement exists; copying payloads evades removal. |
| Source controls | WP06 registry, 0043 source heads/revisions/qualifications and WP05 control refs | Current configuration/generation/active/permission/qualification/expiry must guard admission. `composeCaptureGuard` protects acquisition, not admission authority. |
| Durable API replay | Existing WP04/05/07 operation tables each cover their own mutation | Need reviewed operation outcome across all admission effects, bound to principal/action/target/semantic payload and immutable result refs. Root reserves any later migration/shared API change. |
| Removal/publication | 0042 tombstones/invalidations/revoked_scopes and invalidation epoch; 0043/0044 scope-removal triggers | WP14 invalidates dependent admissions/catalog copies; WP16 invalidates public rows/snapshots atomically. WP26 handles backups/restore and external recovery incarnation. A publication reservation is no public authority. |

## Proposed private wire contract

Namespace proposal: `/ops/api/discovery`; no route is installed. Authenticate and
authorize before route/body/storage dispatch; legacy `/api` bearer access cannot
bypass it. Reuse strict accepted WP02 primitives; these are design types only.

```typescript
type CandidateVersion = { id: DiscoveryId; revision: Revision; sha256: Sha256 };
type ReviewContext = {
  candidate: CandidateVersion; target: ReviewTarget;
  expectedDecisionHead: RevisionRef | null;
  expectedDependencies: DependencyVector; policy: RevisionRef; rubric: RevisionRef;
};
type ReviewInput = {
  schemaVersion: "discovery-review-v1"; operationId: DiscoveryId;
  context: ReviewContext; claimRefs: RevisionRef[]; evidenceRefs: RevisionRef[];
};
type ProposalRequest = ReviewInput & {
  suggestion: "accept" | "hold" | "reject"; rationale: string;
};
type DecisionRequest = ReviewInput & {
  action: "accept" | "hold" | "reject"; reason: string; unresolved: DiscoveryId[];
};
type CandidateSummary = {
  candidate: CandidateVersion; target: ReviewTarget; label: string;
  state: "unreviewed" | "held" | "accepted" | "rejected" | "stale";
  provider: ProviderIdentity; stage: string | null; observedAt: DiscoveryInstant;
};
type PrivateEvidence = {
  ref: RevisionRef; representation: RevisionRef; representationSha256: Sha256;
  selector: DiscoveryEvidenceInput["selector"]; // existing strict literal selector
  origin: RevisionRef; originStatus: "reviewed" | "provisional";
  material: DiscoveryArtifactMaterialScope["material"]; usable: boolean;
};
type CandidatePage = {
  schemaVersion: "discovery-review-v1"; items: CandidateSummary[];
  nextCursor: string | null;
};
type CandidateDetail = {
  schemaVersion: "discovery-review-v1"; item: CandidateSummary;
  context: ReviewContext; claimRefs: RevisionRef[];
  evidence: PrivateEvidence[]; unresolved: DiscoveryId[];
};
type ProposalAck = {
  schemaVersion: "discovery-review-v1"; operationId: DiscoveryId;
  proposal: RevisionRef; candidate: CandidateVersion; state: "staged"; published: false;
};
type DecisionAck = {
  schemaVersion: "discovery-review-v1"; operationId: DiscoveryId;
  decision: RevisionRef; candidate: CandidateVersion;
  action: "accepted" | "held" | "rejected"; usable: boolean; published: false;
};
type ReviewFailure = { error: "invalid-request" | "payload-too-large" |
  "json-required" | "action-denied" | "not-found" | "method-not-allowed" |
  "stale-review" | "operation-conflict" | "review-unavailable" };
```

Every object is strict. Refs are distinct, 1..128; unresolved codes 0..128;
rationale/reason 1..2000 characters; label ≤500; page ≤50; cursor ≤2048.
Use accepted primitive/string rules and a proposed 262144 UTF-8 byte streaming
body cap, consistent with WP02's initial envelope bound. Reject duplicate decoded
JSON keys, lossy numbers, invalid Unicode, unrelated refs, unknown fields and
route/context target mismatches. No body authority/reviewer/rule/publish/token
fields or raw representations. Server derives IDs, revisions, authority,
operation binding, timestamps, digests and supersession. Vector/policy/evidence
inputs are optimistic expectations; the server reconstructs and exactly compares
the complete required set. One request targets one review resource; no implicit
acceptance of accounts, works or relations and no cross-target batch.

| Route/result | Status and required behavior |
| --- | --- |
| GET candidates / candidates/:id | 200 allowlisted page/detail; HEAD same headers/status, no body/mutation. List supports `after` once only; malformed/unknown/repeated query fails 400, stale opaque cursor 409 and restart. Detail accepts no query parameters. |
| POST proposals / candidates/:id/decisions | 201 only after new durable result. |
| Identical durable replay | 200, original result IDs/outcome; current usability may become false. No duplicate effects, renewed authority or erased-content disclosure. |
| Stale candidate/head/vector/policy/rubric/expiry | 409 `stale-review`, no partial mutation; fresh read and deliberate re-review, never silent retry with new heads. |
| Same key, changed semantic payload/actor/action/target | 409 `operation-conflict`, preserve prior result. |
| Invalid request / oversize / unsupported POST content type | 400 / 413 / 415; declared Content-Length cannot bypass streaming cap. |
| Authenticated caller lacks action grant | 403, zero writes; valid service acceptance/publication attempts receive no authority. Outer invalid auth/origin remains private 404. |
| Missing/unreadable resource / unsupported method | 404 / 405 with Allow; fixed errors reveal no candidate contents. |
| Unavailable/inconsistent store or unknown integrity failure | 503 fixed error; reconcile uncertain commit with same operation key/body. |

All success/error responses: JSON, `Cache-Control: no-store`,
`CDN-Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`. These bounds,
new envelope version and service-auth path require review before implementation.

## Reconstruction, guards and separation

Resolve the exact WP07 lead/page/ordinal/source installation and retained
representation digest/parser/configuration/version. Resolve WP05 exact selectors
with `readRevision`; unusable, tombstoned, quarantined, invalidated or expired
material cannot support acceptance. A quote elsewhere in a response or a
representation ID in an evidence-ref field is insufficient. Materialize typed
subjects/evidence/claims through the controlled WP04/05 bridge. Adjudicate each
selector/work to a reviewed origin, not a whole multi-work page;
`distinctOriginCount` must reject provisional origins and count mirrors once.
Rights remain artifact/version/material-specific; metadata permission cannot
authorize text, figures, code, data or weights. Grant renewal needs requalification.

Creator gate requires identity, professional health-tech basis and dated supported
nine-county professional location, without indexed work. Work gate requires
healthcare purpose, substantive technical contribution and regional creator role
at work time. Generic AI, routine clinical content, incidental computers, local
adoption or geography alone fail the corresponding claim. Identity/account,
grouping and reuse relations need separate accepted evidence/endpoints. Preserve
unknown/current versus historical affiliation, date precision and source stage;
headquarters, residence, service area and display names cannot substitute.
Executable rules remain stopped until rubric freeze.

Map the complete WP02 vector explicitly: evidence-observation→WP05 ancestry plus
WP07 source-bound lead; claim/decision→exact revision heads and future admission
mapping; relationship/endpoint/identity-resolution→WP04 relation/entity/alias plus
endpoint admission; rights-assessment→material-scoped controls; source-enrollment,
configuration, qualification and permission→WP05 controls plus WP06 current
revision/generation/active/expiry; verification-rule→missing registered rule and
qualification heads; geographic/relevance/review/public-field-policy→explicit
kind-to-generic-WP05-policy mapping where materially used; currentness→dated
claim validity/expiry head. Rubric/freeze links through reviewed review/rule
policy, not an invented dependency kind. Projection-generation is WP16's per-target
predecessor commit guard and is inapplicable to admission-only writes; do not
fabricate a global freshness dependency. Missing mapping blocks implementation.

Proposed transaction: reconstruct in coherent primary state; derive canonical
semantic digest and required vector; resolve durable operation; then **one D1
batch** inserts unconditional abort guards, appends immutable decision/atomic
claim outcomes and complete evidence/authority/supersession, advances exact heads,
records operation outcome and invalidation, and asserts final cardinalities and
expiry. Recheck candidate, all material heads/rights/source/qualification/policy/
rule/authority and recovery incarnation inside that batch. Zero-row UPDATE must
abort, not permit later statements. Monotonic revisions reject A→B→A reuse.
Actual composable statements/guards require independent review; current separate
store calls do not establish this guarantee. Concurrent identical key wins once;
changed payload conflicts; same-head different keys yield one winner. Replay
requires current scoped authorization and may reveal only permitted non-content
audit metadata after removal. Key reuse cannot resurrect erased material.

Forum edits/deletion/private transitions and institutional profile corrections/
expiry must identify and invalidate old observation→selector/origin→claim→decision
and relation dependencies. Fresh leads alone do not invalidate admitted claims.
AC-WP12-06 still needs future WP14/WP16 current-visibility/snapshot trace.
AC-WP13-06 specifically needs partial-directory accounting and one origin for
mirrored biographies; institutional deletion inherits the shared invalidation
contract separately. Failed refresh never renews support. Preserve only permitted
historical metadata; erasure covers copied proposal/rationale/projection content
as required by scoped rights, with backup reconciliation in WP26.

| Surface | Explicit allowlist / further gate |
| --- | --- |
| Private list/detail | Exact CandidatePage/CandidateDetail fields only; selected evidence content requires current reviewer/material permission. Never spread DB payloads. Redacted evidence cannot support unreviewed acceptance. |
| Acks/logs | Exact ack fields; diagnostics use operation/ref IDs, digests and fixed codes only. Permitted principal/auth-context refs stay private audit. No tokens, contact data, raw bodies or arbitrary errors. |
| Future public work/project | WP16 must strictly define admitted ID/revision/type, title/summary, stage/date precision, creator roles/relations, safe evidence links and scoped rights. |
| Future public person/organization | WP16 must strictly define admitted ID/revision/name, professional and dated regional basis, public professional links and separately admitted relations. |

Public DTOs exclude candidates/selectors, private notes, contacts, hidden forum
fields, rejected claims and reviewer/authentication context. No license inference
or artifact prerequisite. New public fields require public-field-policy revision;
private access supplies no public display/reuse permission. WP15 consumes reviewed
private contracts; UI work cannot activate a stopped backend.

## Ordered next work and planned acceptance evidence

```text
NOW: independent review of this entry contract/gap inventory
     WP12/WP13 offline work under accepted WP06; WP03 permitted preparation
STOP: actual WP03 acceptance + rubric freeze + accountable grants/store amendments
  → WP14 reconstruction → qualified rules/human decisions → atomic commit/private API
  → Astra independent review → orchestrator WP14 acceptance
  → WP16 publication/invalidation → WP15/WP17 consumers → WP23 CI → WP24 evaluation
```

| Planned check | Future observation and acceptance boundary |
| --- | --- |
| AC14-01/02 | Frozen development creator-without-work/paper-only positives and generic-AI/clinical/unknown-county/local-adoption negatives; exact decision/evidence trace. Held-out evaluation stays separate; no synthetic accuracy claim. |
| AC14-03 | Eventual authentic local signed service fixture reaches action authorization; accept/publish/impersonation attempts leave zero decision/public rows. Fixture authentication is not real enrollment. |
| AC14-04 | Actual transactional D1 barrier races for every required kind, missing head, expiry, ABA, source/rule/qualification replacement, origin split, endpoint and authority revocation; 409 plus readback of all affected tables proves no partial writes. Inject last-statement failure. |
| AC14-05 | Concurrent same-key identical/changed body; different keys same expected head; process restart/lost ack; removal then replay. One immutable outcome, stable replay, conflicts, no resurrection. |
| AC14-06 | JWT/origin/workers.dev/body-reader spies, strict JSON, byte cap, spoofed reviewer/rule and private sentinels; auth before dispatch and fixed errors/allowlists. |
| WP12-06 / WP13-06 | Later admission then edit/delete/revoke/profile expiry; decision unusable and WP16 current/public snapshot correction. Separately preserve partial directory denominator and mirror origin accounting. New lead alone fails this check. |

Use isolated existing D1 rollback harnesses and injected fetch/JWKS fixtures, no
provider calls/enrollment. Future `test/discovery-admission.test.ts` and
`test/discovery-review-api.test.ts` do not exist at this baseline; root must add
explicit package/CI wiring later and retain `test/ops-jwt.test.ts` regression.
No tests above ran for this document. CSE evidence-planning guidance supports
inspection now, controlled behavior tests later and independent intended-use
validation later; none substitutes for another.

This increment can close review of the handoff only. Source/rule/endpoint work,
qualified-rule registration, real authority enrollment, bridge activation,
admissions/publication, corpus accuracy, public visibility/package acceptance and
deployment remain stopped until their actual prerequisites and independent review
exist. Record preparation separately from WP14 acceptance.
