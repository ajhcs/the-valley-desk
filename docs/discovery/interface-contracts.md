# Discovery interfaces v1

WP02 contract candidate, 2026-11-14. Baseline source is `c8b36d7e9b27376bf121d9d6670c500a25c62423`; policy is `discovery-policy-v1`, accepted SHA-256 `25319e1e02733267dd5102b7c795f533088cede5be09eb7e9f79a036ae90df23`. The successor is TVD-CONCEPT-0.5; v0.4 and its independent scopes remain historical inputs. Sol independently reviews WP02; the orchestrator accepts it. Schema acceptance authenticates no caller, source, evidence, or publication.

## Frozen implementation surface

Terra owns `src/content/discovery-schema.ts`, `src/ingest/discovery/source-contract.ts`, and `test/discovery-contracts.test.ts`. Astra owns this contract and `docs/discovery/model-v0.5/`. Root owns package/CI wiring, migration numbering and Worker integration. Use installed Zod and TypeScript; add no dependency. Export each named schema below as a PascalCase Zod value and its same-name inferred type; every object is strict. Export constants as named below. Pure schema helpers cannot fetch, persist, publish, authenticate or start services.

`DISCOVERY_SCHEMA_VERSION = "discovery-v1"`. `DISCOVERY_COUNTY_KEYS` is the exact ordered nine-key policy list. `DISCOVERY_PROVIDERS = ["github", "pubmed", "crossref", "arxiv", "forum", "institutional"]`; association discovery is an institutional route, not a seventh provider. `DISCOVERY_LIMITS` contains `defaultPageSize:25`, `maxPageSize:100`, `maxQueryCharacters:200`, `maxTerms:12`, `maxFacetValues:20`, `maxCursorLifetimeMs:900000`, `maxEnvelopeBytes:262144`, `maxDependencies:512`, `maxPageObservations:100`, and `maxEvidenceRefs:128`. The last four are bounded initial serialization limits, not claimed provider or platform capacity. Exceeding a bound is an explicit error; no silent truncation. Review/revise limits before measured workloads require change.

The 200-character query bound counts Unicode code points (`Array.from(text).length`), not UTF-16 code units. Other stated string bounds count JavaScript UTF-16 code units, matching Zod `.length`/`.max`; the envelope-byte limit separately counts UTF-8 JSON bytes.

Primitive conventions: `DiscoveryId` is 1–200 ASCII characters matching `[A-Za-z0-9][A-Za-z0-9._:/-]*`; `Revision` is a positive safe integer. Generations and epochs are nonnegative safe integers. SHA-256 is 64 lowercase hexadecimal characters. An instant is a valid Gregorian RFC3339 timestamp with `Z` or numeric offset and at most millisecond precision; timezone-free timestamps are rejected as instants. A public URL is credential-free HTTPS with no fragment, at most 2048 characters; this structural schema alone does not qualify DNS, redirects, network locality or access. WP06 owns those checks.

```typescript
// All described records are strict, all unspecified optional fields are absent.
type DiscoverySubject = {
  kind: "person" | "organization" | "account" | "project" | "artifact";
  id: DiscoveryId;
};
type RevisionRef = { id: DiscoveryId; revision: Revision };
type ProviderIdentity = {
  provider: "github" | "pubmed" | "crossref" | "arxiv" | "forum" | "institutional";
  installation: DiscoveryId;
  nativeId: string; // 1..512, no control characters; preserve provider spelling
  kind: "person" | "organization" | "account" | "project" | "artifact";
};
type ReviewTarget =
  | { kind: "creator"; subject: {kind:"person"|"organization";id:DiscoveryId}; revision: Revision }
  | { kind: "work"; subject: {kind:"project"|"artifact";id:DiscoveryId}; revision: Revision }
  | { kind: "claim"; id: DiscoveryId; revision: Revision }
  | { kind: "relationship"; id: DiscoveryId; revision: Revision };
// Creator permits person|organization; work permits project|artifact.
// Accounts remain identities, never creators merely through this target union.
type DecisionAuthority =
  | { kind: "authenticated-reviewer"; principalId: DiscoveryId; authenticationContextId: DiscoveryId }
  | { kind: "qualified-rule"; rule: RevisionRef; qualification: RevisionRef };
type DiscoveryReviewDecision = {
  schemaVersion: "discovery-v1"; id: DiscoveryId; revision: Revision;
  target: ReviewTarget; decision: "accepted" | "held" | "rejected";
  authority: DecisionAuthority; reason: string; // 1..2000
  policy: RevisionRef; expectedDependencies: DependencyVector;
  evidence: RevisionRef[]; // 1..128 unique refs
  supersedes?: RevisionRef; operationId: DiscoveryId; decidedAt: string;
};
type ArtifactRightsAssessment = {
  schemaVersion: "discovery-v1"; id: DiscoveryId; revision: Revision;
  artifactId: DiscoveryId; artifactVersion: string; // 1..200
  material: "metadata" | "code" | "text" | "figures" | "data" | "weights" | "forum-content";
  classification: "permitted" | "restricted" | "unknown";
  permissions: { fetch: "allow"|"deny"|"unknown"; retain: "allow"|"deny"|"unknown";
    transform: "allow"|"deny"|"unknown"; display: "allow"|"deny"|"unknown";
    reuse: "allow"|"deny"|"unknown" };
  evidence: RevisionRef[]; // 0..128; a permitted classification needs evidence
  sourceUrl?: string; terms?: string; // bounded 2000; no invented license
  policy: RevisionRef; assessedAt: string;
};
```

A reviewer identity supplied in an HTTP body is not authenticated. IF08 obtains authority from verified server context, validates action permission, and constructs IF04 internally. A rule string alone is equally insufficient. Claims and relationships can be reviewed independently; accepting either does not automatically publish its endpoints. Rights bind artifact version and material; permission for metadata cannot authorize figures, code, data or weights. Reuse permission is explicit and separate from fetch, retention, transformation and display. Public or downloadable code is not thereby licensed for reuse. The schema represents unknowns instead of supplying a default license.

## Calendar and temporal contract

Export `DiscoveryDate`, `makeDiscoveryDate(precision, value)` and `discoveryDateContained(date, fromDate, untilDate)`. `makeDiscoveryDate` accepts `unknown|year|month|day|instant` and a string or null. Invalid dates throw. Unknown produces `{precision:"unknown", reportedValue:value}` with a bounded optional raw diagnostic (null or 1–200 characters); it never becomes today's date. Offset-free datetimes can be retained as unknown reported values, not promoted to instants.

The known-date union is exact:

```typescript
type DiscoveryDate =
 | { precision:"unknown"; reportedValue:string|null }
 | { precision:"year"|"month"|"day"; value:string;
     calendar:"proleptic-gregorian"; lowerDate:string; upperDate:string }
 | { precision:"instant"; value:string; lowerEpochMs:number; upperEpochMs:number };
```

All source year/month/day values have years 0001–9998. Year values are `YYYY`; month values are `YYYY-MM`; day values are valid `YYYY-MM-DD`. Query bounds and derived upper bounds permit valid dates in 0001–9999. Source 9998-12-31 may end at 9999-01-01; source dates in 9999 are rejected so no derived bound reaches five-digit year 10000. Calendar bounds are computed half-open coordinate bounds: `2024` becomes `[2024-01-01,2025-01-01)`, and leap-year February 2024 becomes `[2024-02-01,2024-03-01)`. They describe calendar precision, not actual UTC event instants or an asserted timezone. The schema rejects mismatched supplied bounds. For instants, require explicit offset, preserve the reported string, normalize its actual instant into safe integer epoch milliseconds, and set upper to lower+1 ms. Reject finer precision rather than round.

`discoveryDateContained` takes valid date-only bounds with from < until. For calendar records compare the whole calendar interval. For instant records compare against explicit UTC-midnight query bounds: the query is documented as a UTC date filter for instant-valued records; it does not reinterpret calendar-only evidence as UTC. Unknown never satisfies an active positive date filter. No filter leaves otherwise eligible unknown-date records available. WP17 must expose the date-filter convention and test both domains. The function does not establish location at creation: a year spanning relocation remains unresolved even if it fits a date filter. Current professional presence needs affirmative unexpired evidence; an unknown end is not current evidence.

## Immutable dependencies and publication

Export `DEPENDENCY_KINDS` with these exact keys:

```text
evidence-observation, claim, decision, relationship, endpoint, identity-resolution,
rights-assessment, source-enrollment, source-configuration, source-qualification,
source-permission, verification-rule, geographic-policy, relevance-policy,
review-policy, public-field-policy, projection-generation, currentness
```

```typescript
type DependencyKey = { kind: typeof DEPENDENCY_KINDS[number]; id: DiscoveryId };
type DependencyRevision = DependencyKey & { revision: Revision;
  role:"commit-guard"|"validity"; expiresAt?: string };
type DependencyVector = { entries: DependencyRevision[]; required: DependencyKey[] };
type PublicRowRef = {
  kind:"work"|"person"|"organization"; subjectId:DiscoveryId;
  rowId:DiscoveryId; revision:Revision;
};
type DiscoveryPublicRevision = {
  schemaVersion:"discovery-v1"; row:PublicRowRef; generation:number;
  dependencies:DependencyVector; decision:RevisionRef;
  publishedAt:string; expiresAt:string;
};
```

Both vector arrays contain 1–512 unique `(kind,id)` keys; their key sets must match exactly, even if revision values or optional expiry differ. The schema rejects missing/duplicate/extra entries relative to `required`. This comparison alone does not prove completeness: the trusted projection builder derives `required` from every materially used field and relation. Never trust a caller-supplied smaller list. Source activation/revocation, access qualification, configuration/parser scope, rule replacement and each distinct policy revision participate explicitly. Rights remain material-specific; identity resolutions and both relationship endpoint revisions are included. A creator with no work has its own identity/professional/location/authority dependencies and no fabricated artifact dependency.

The `projection-generation` entry is a per-target expected predecessor generation with `role:"commit-guard"`; it participates in publication CAS only. All other entry kinds use `role:"validity"`. Persist commit guards as provenance, not as required current heads after the successful write. The immutable public row generation and snapshot generation are coordinates, not a requirement that the global latest generation remain unchanged. An unrelated addition therefore does not invalidate old rows or snapshots. Validity dependencies alone govern ongoing visibility and expiry. `DiscoveryPublicRevision.expiresAt` must exceed `publishedAt` and not exceed any validity dependency expiry.

For first publication, WP04 reserves a target head at positive revision 1 with no public row and generation value 0; the first CAS advances that head. `Revision` never encodes a missing head as 0. The durable reservation is not publication authority.

Every head key has a monotonically advancing integer revision or a nonreusable immutable identity backed by a monotonic head revision. An A→B→A value transition still increments revision twice. Policy or evidence hashes supplement revision identity; they cannot replace it. Withdrawal/removal, expiry, revoked access, source configuration changes, replaced rules or endpoint changes invalidate every materially dependent projection and snapshot. All valid-through bounds are checked at read and commit; currentness expiry is explicit.

The following is a storage obligation and pseudocode, not implemented D1 evidence:

```text
authenticate and authorize action server-side; derive complete expected vector
begin one primary D1 batch
  resolve operationId against durable prior result; same request returns same result
  conflicting request for same operationId must fail
  guard_insert(expected_subject_head, expected_vector, expected_policy,
               expected_lease_fence, expected_budget_reservation, external_incarnation)
    trigger: RAISE(ABORT,'discovery-stale-dependency') on any mismatch,
             missing required key, expired authority/dependency or invalid fence
  insert immutable decision/public revision and all dependency rows
  advance subject head and generation using guarded expected revision
  persist operation outcome and applicable invalidation epoch in this same batch
  final guard checks exact affected cardinalities; any mismatch raises ABORT
commit; acknowledge durable operation outcome only after success
```

A zero-row conditional UPDATE does not abort subsequent SQL; neither does a JavaScript preflight protect the commit race. The actual migration must provide a SQL failure guard, and WP16/WP23 must fault/interleave-test the complete batch. Cloudflare documents rollback of a D1 batch when a statement fails and primary-only reads without Sessions API; these facts were checked on 2026-11-14. They do not prove this proposed guard or a multi-request snapshot. [D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/), [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/).

## Query, snapshot and continuation

Export `CanonicalDiscoveryQuery`, `DiscoverySnapshot`, `DiscoveryCursor`, `DiscoveryContinuationResult`, and pure `checkDiscoveryContinuation(snapshot, cursor, current)`.

```typescript
type CanonicalDiscoveryQuery = {
  schemaVersion:"discovery-v1"; entity:"works"|"people"|"organizations"|"projects";
  text:string; terms:string[]; // canonical text and sorted distinct derived tokens
  facets:{ counties:string[]; topics:string[]; providers:string[];
           kinds:string[]; creators:string[]; organizations:string[] };
  regionalMode:"current-professional"|"historical-professional"|"regional-at-creation";
  dateFilter:null|{fromDate:string;untilDate:string}; sort:"relevance"|"recent"|"name";
  pageSize:number; aliasPolicy:RevisionRef;
};
type DiscoverySnapshot = {
  schemaVersion:"discovery-v1"; id:DiscoveryId; query:CanonicalDiscoveryQuery;
  generation:number; invalidationEpoch:number; recoveryIncarnation:DiscoveryId;
  asOf:string; expiresAt:string; rows:PublicRowRef[]; dependencies:DependencyVector;
};
type DiscoveryCursor = {
  schemaVersion:"discovery-v1"; tokenId:DiscoveryId; snapshotId:DiscoveryId;
  query:CanonicalDiscoveryQuery; recoveryIncarnation:DiscoveryId;
  afterRowId:DiscoveryId|null;
};
type DiscoveryContinuationResult =
  | {status:200; kind:"valid"}
  | {status:400; kind:"discovery-cursor-mismatch"}
  | {status:410; kind:"discovery-snapshot-invalidated"|"discovery-snapshot-expired"; restart:true};
```

Canonical text is NFKC, lowercase, trim and collapse whitespace. Reject nonempty canonical text with zero letter/number tokens as an invalid query (HTTP 400 at the API); punctuation-only input must never broaden into an empty/all query. Tokens are maximal Unicode letter/number runs (`/[\p{L}\p{N}]+/gu`), sorted by binary string comparison and deduplicated. `terms` must exactly equal those derived from text; aliases only through the explicit governed alias policy in later query implementation. Facets are sorted/deduplicated bounded values; counties/providers use their exact enums, other values use `DiscoveryId`. Reject unsupported sort/entity combinations: works/projects support relevance/recent and regional-at-creation; people/organizations support relevance/name and current/historical-professional. Initial work ordering is distinct term matches descending, known source date before unknown, supported lower date coordinate descending, then binary stable ID. The comparable date-sort coordinate maps a calendar lowerDate to the proleptic Gregorian UTC-midnight epoch-millisecond ordinal solely for ordering; it makes no UTC event-time or timezone claim. An instant uses its actual lowerEpochMs. Keep precision/domain labels and the separate date-filter semantics; never emit the synthetic calendar ordinal as an occurredAt timestamp. Recent omits term count. Creator empty-query order is normalized display name then stable ID; nonempty relevance prepends match count. Normalization does not infer identity or unsupported aliases.

Snapshot rows have immutable row identities and no duplicate rowId or `(kind,subjectId)`, even across two revisions. People queries contain person rows, organization queries organization rows, and works/projects queries work rows; project filtering is a trusted membership obligation because row kind intentionally groups work subclasses. Rows can be bounded at 10,000 for the contract fixture representation; production snapshots may persist equivalent membership separately and must fail explicitly when their qualified capacity is exceeded. Snapshot expiry is later than asOf, within 15 minutes, and no later than any material dependency expiry. `current` for the pure continuation helper is `{query:CanonicalDiscoveryQuery; invalidationEpoch:number; recoveryIncarnation:DiscoveryId; now:string}`. Validate schema first; compare actual canonical query, snapshot ID and membership of a nonnull afterRowId. Mismatch returns 400. A current observation time earlier than snapshot.asOf also returns 400; a snapshot cannot be served before its recorded observation. A recovery incarnation or invalidation epoch mismatch returns 410 invalidated; otherwise now >= expiresAt returns 410 expired; otherwise 200. A changed publication generation alone does not invalidate an existing snapshot: additions may wait until the next query. The helper cannot retrieve/authenticate an opaque token or verify live heads; those are later database/API duties.

At the HTTP boundary bound raw query UTF-8 bytes to 16,384 and cursor-token UTF-8 bytes to 2,048 before decoding; the internal 200-character query and 200-character descriptor IDs do not replace these transport limits. Over-limit input returns 400 without truncation. These are frozen transport obligations for WP17, not new endpoint code in WP02.

A server-issued opaque random token resolves to a durable descriptor and full keyset position. Never accept caller-edited cursor fields as authority. On each page, one coherent primary observation (single query or qualified transactional batch) checks epoch/incarnation/expiry and selects immutable rows. Return `Cache-Control: no-store` and `CDN-Cache-Control: no-store` on API/HTML/error paths; client navigation revalidates. A change between pages returns 410 with original filters available for restart, not a silently reduced or mixed page. Partition P20/P21 applies only while valid. Restoring D1 may restore an old matching epoch and withdrawn rows: change the recovery incarnation outside restored state, reject all earlier continuations and keep discovery closed until post-backup corrections/removals are reconciled or affected claims requalified. A schema helper does not perform that recovery.

## Acquisition and exchange envelopes

`source-contract.ts` exports `DiscoverySourceRequest`, `DiscoverySourceObservation`, `DiscoverySourceCapture`, `DiscoverySourcePage`, `DiscoverySourceFailure`, and `DISCOVERY_SOURCE_FAILURES`. It imports shared schemas. No function in this module fetches.

```typescript
type DiscoverySourceRequest = {
 schemaVersion:"discovery-v1"; operationId:DiscoveryId; runId:DiscoveryId;
 sourceId:DiscoveryId; provider:ProviderIdentity["provider"]; installation:DiscoveryId;
 scopeId:DiscoveryId; enrollment:RevisionRef; configuration:RevisionRef;
 permission:RevisionRef; parser:RevisionRef;
 endpointConstructor:DiscoveryId; parameters:Record<string,string>; // <=20, key<=64,value<=512
 checkpoint:string|null; // <=4096, provider-opaque; not a URL to fetch blindly
 budgetReservation:RevisionRef; leaseFence:RevisionRef;
} & (
 | {purpose:"qualification-sample"; samplingAuthorization:RevisionRef}
 | {purpose:"collection"; qualification:RevisionRef}
);
type DiscoverySourceObservation = {
 schemaVersion:"discovery-v1"; id:DiscoveryId; identity:ProviderIdentity;
 subject:DiscoverySubject; representationSha256:string; provenanceOriginId:DiscoveryId;
 sourceUrl:string; observedAt:string; sourceDate:DiscoveryDate;
 sourceVersion?:string; // 1..200, separate from durable provider nativeId
 parser:RevisionRef; evidence:RevisionRef[]; // 1..128, retained representation/fields
};
type DiscoverySourceCapture = {
 schemaVersion:"discovery-v1"; request:DiscoverySourceRequest;
 observations:DiscoverySourceObservation[]; // 0..100
 outcome:"healthy"|"healthy-empty"|"partial";
 completeness:"complete"|"partial"|"provider-limited";
 proposedCheckpoint:string|null; limitationReceipt?:RevisionRef;
};
type DiscoverySourcePage = {
 schemaVersion:"discovery-v1"; request:DiscoverySourceRequest;
 pageReceipt:RevisionRef;
 observations:DiscoverySourceObservation[]; // 0..100
 outcome:"healthy"|"healthy-empty"|"partial";
 completeness:"complete"|"partial"|"provider-limited";
 nextCheckpoint:string|null; limitationReceipt?:RevisionRef; committed:true;
};
type DiscoverySourceFailure = {
 schemaVersion:"discovery-v1"; operationId:DiscoveryId; sourceId:DiscoveryId;
 outcome:"disabled"|"misconfigured"|"auth-failed"|"rate-limited"|"upstream-failed"|
         "parser-failed"|"timed-out"|"unavailable"|"permission-denied"|"budget-exhausted";
 retryAfter:string|null; checkpointUnchanged:true; code:string; // bounded, no raw provider body
};
```

A qualification-sample request uses a reviewed bounded sampling authorization and current access/permission/configuration plus a registered pending enrollment; it does not require the completed qualification receipt it is intended to produce. A collection request requires current installation-specific qualification. The strict union rejects qualification on the sample variant and samplingAuthorization on collection. A sample response cannot activate routine collection or prove complete provider qualification. Both paths remain outside the current no-provider-call implementation scope.

`DiscoverySourceCapture` is the provisional collector-to-evidence payload: it retains the provider continuation as `proposedCheckpoint` without claiming persistence. It has no durable page receipt or committed flag. `DiscoverySourcePage` is the durable acknowledgment emitted by the trusted store only after successful commit; it requires `committed:true`, a page receipt and the resulting `nextCheckpoint`. A capture schema parse cannot advance a checkpoint; failures use the unchanged prior checkpoint. Outcome/completeness/provider-binding constraints apply to both capture and acknowledgment.

Each page embeds the exact request binding, preserving provider, installation, scope, parser, configuration, purpose and qualification/sampling authorization. Observation identity provider/installation and parser reference must match that request. The trusted committing collector compares the embedded request with its retained issued request, validates subject/scope eligibility and rejects cross-request mixing; an untrusted response cannot define its own authorized scope.

Failure enum is exported verbatim. Healthy-empty requires zero observations and complete traversal. Healthy requires nonempty observations and complete traversal; partial covers incomplete/provider-limited results, including zero items. Complete has null nextCheckpoint; provider-limited always requires `limitationReceipt`, and may have a null checkpoint; this receipt identifies the retained declared provider limit, not proof of complete traversal. No failure becomes healthy-empty. A committed page receipt is necessary before a checkpoint advances; an uncommitted page cannot acknowledge durable progress. Payload UTF-8 JSON bytes must fit maxEnvelopeBytes; enforce with pure `assertDiscoveryEnvelopeBytes(value)` exported from source-contract. Parameters and checkpoints never bypass provider endpoint constructors or scope validation. Preserve representation/source version separately from native identity: an arXiv base ID remains stable while sourceVersion identifies v1/v2; GitHub numeric repository identity remains stable while sourceVersion may identify the captured commit. Provider/native identity and subject kind must agree; account observations cannot masquerade as people. Sources must independently admit creator-first and artifact-first inputs without repository fields.

## IF01–IF10 ownership, acknowledgment and retry

| ID | Producer → consumer | Contract, caller and durable result |
| --- | --- | --- |
| IF01 | Qualified registry → transport | `DiscoverySourceRequest`; internal scheduler with valid scope/permission/budget/fence and purpose-specific qualification or bounded sample authorization. Denial has typed failure and unchanged checkpoint. |
| IF02 | Collector → evidence | Capture input/page acknowledgment schemas; qualified collector. Commit representation, observation and page receipt before progress. Retry operation resolves the original durable page outcome. |
| IF03 | Evidence → claim builder | Typed subject/predicate/value and exact evidence revision/field/span references; internal extraction proposes only. WP05 adds claim values under these stable identities. |
| IF04 | Authenticated review/rule → decisions | `ReviewTarget`/decision; IF08 server-created authority and expected revisions. Replayed operation returns original outcome; conflicting content fails. |
| IF05 | Decision store → projection | Immutable `DiscoveryPublicRevision`, complete trusted dependency manifest and SQL abort contract. Success acknowledges entire atomic commit, never partial rows. |
| IF06 | Query → read delivery | Canonical query, snapshot and server-held cursor. Public read; 400 mismatch, 410 restart, or coherent page. Timeout cannot silently create a new snapshot. |
| IF07 | Correction/expiry → invalidation | Authenticated correction or qualified expiry; expected heads and complete affected dependency set. Correction/public change and epoch update commit atomically. |
| IF08 | Operator → protected mutation API | Verified server identity, action authorization, same-origin checks, bounded body, expected target/vector and operationId. Body authority fields cannot authorize mutation. |
| IF09 | Public DTO → browser/Worker/crawler | Identical allowlisted admitted meaning and immutable public revision. No candidate fields, raw evidence or private authority context. New DTO fields require policy revision. |
| IF10 | Acquisition/review/delivery → coverage | Run/scope/cohort/window IDs, outcome and captured/admitted/published stage. Idempotent operation receipt; distinct failures and partial limits remain visible. |

All ten exchanges carry `schemaVersion`, durable operation/identity, explicit size/cardinality bounds, permitted caller, typed failure and retry semantics. IF03/IF07/IF08/IF09/IF10 field-level storage/DTO schemas are subsequent package work, constrained here rather than falsely presented as implemented. Scope/cohort denominators are never a claim about the unknown regional population.

## Required contract cases and evidence

AC-WP02-01: independent person/organization review without artifact fields; work, claim and relationship review; reject creator=account, work=person and model authority. AC-WP02-02: metadata/text/figures/forum/code/data/weights at explicit artifact version; unknown and restricted preserved, no cross-material permission inheritance.

AC-WP02-03: enumerate one changed entry for every dependency kind; source configuration, qualification/permission revocation, rule replacement, subject/endpoint and A→B→A revision changes must reject a stale commit. Include timeout replay, conflicting operation ID, expiry during preparation, lease expiry, budget collision, failed final statement, and recovery incarnation change with matching restored internal heads. The native obligations and transaction sequence are specification evidence; real D1 qualification remains WP16/WP23/WP26.

AC-WP02-04: valid pages, material policy/claim/rights/permission invalidation, exact expiry, restore, malformed token and query mismatch. Never drop a row silently; preserve original query for restart. Test no-store/coherent-read requirements later at API/Worker boundaries, not by claiming a schema test serves HTTP headers.

AC-WP02-05: six fixtures: GitHub repository; PubMed paper without repository; Crossref organization-authored artifact with unresolved people; arXiv preprint version; forum work with account and independently supported local role, no person join; institutional independent creator without work. Add negative mismatched provider/subject kind and source-failure cases. Include year/month/leap-day, invalid calendar date, explicit offset instant, offset-free timestamp refusal, unknown date and relocation-overlap semantics. All fixtures are synthetic and do not qualify provider access or external truth.
