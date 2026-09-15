# Handoff Templates

These are proposed record formats for implementation work, not executable runtime
configuration. Null fields are incomplete qualification, never implicit approval.
Keep credentials and private reviewer notes out of public artifacts.

## 1. Source Qualification Receipt

```json
{
  "version": "watch-source-qualification-1",
  "sourceId": "pa-legislation-bulk",
  "qualification": "pending",
  "discoveryUrl": "https://www.palegis.us/data",
  "fetchUrl": null,
  "finalAllowedHosts": [],
  "authority": "pending-official-link-verification",
  "accessAssessment": null,
  "contentReuseAssessment": null,
  "parser": { "id": "pa-bill-history", "version": null },
  "identityMapping": null,
  "dateMapping": null,
  "paginationAndCompleteness": null,
  "compressedByteCap": null,
  "expandedByteCap": null,
  "pollCadenceSeconds": null,
  "reconciliationCadenceSeconds": null,
  "samples": [],
  "checks": {
    "positiveParse": "not-run",
    "negativeParse": "not-run",
    "idempotentReplay": "not-run",
    "changedVersion": "not-run",
    "partialSnapshot": "not-run",
    "rateLimit": "not-run",
    "sourceComparison": "not-run"
  },
  "engineeringOwner": null,
  "editorialOwner": null,
  "qualifiedAt": null,
  "receiptHash": null
}
```

Qualification checklist: exact endpoint inspected; real sample retained legally;
two observation times recorded where feasible; semantic source-to-field comparison
done; malformed/partial/auth responses tested; retry/checkpoint replay proven;
observed update lag documented; owner and backup assigned. Only then can an
implementation registry change enable the source.

## 2. County Monitoring Assignment

Use only when a qualified automated source is not available for a county scope
that the launch plan permits to be staffed manually. This does not waive federal
or state source-family qualification.

```json
{
  "countyId": "nj-salem",
  "disposition": "assignment-pending",
  "monitoredBodies": [],
  "officialUrls": [],
  "namedEditor": null,
  "backupEditor": null,
  "checkCadence": null,
  "coverageHours": null,
  "evidenceLogLocation": null,
  "knownMunicipalGaps": [],
  "assignmentReviewedAt": null,
  "nextReviewAt": null,
  "publicScopeText": null
}
```

Assignment acceptance requires actual people and a workable cadence, not just a
role label. Record observed checks in the same coverage accounting used for
automated sources, without claiming automated freshness.

## 3. Model Evaluation Case

Synthetic example. In the real corpus, exact schema fields must match the
reconciled editor task. Hash the finalized case and source representation with
the existing SHA-256 helper; do not fill the hash with a plausible-looking value.

```json
{
  "caseId": "watch-license-negative-001",
  "fixtureType": "synthetic",
  "desk": "technology",
  "split": "holdout",
  "critical": true,
  "source": {
    "id": "synthetic-license-source",
    "url": "https://example.invalid/fixture-license",
    "text": "This sample license permits internal research only. Clinical use requires a separate agreement.",
    "sha256": null
  },
  "acceptedContext": {
    "resourceId": "synthetic-resource-001",
    "localRelationship": "separately-verified-fixture"
  },
  "expected": {
    "licenseClassification": "restricted-source",
    "mustNotClaim": ["permissive OSS", "approved for patient care"],
    "requiredSourceSpan": "Clinical use requires a separate agreement.",
    "publicationRule": "unsupported-license-claim-holds"
  },
  "reviewerLabels": [],
  "labelAdjudication": "pending",
  "caseHash": null
}
```

Evaluation result schema should record case/config hashes, model, prompt/schema
versions, attempt count, transport outcome, schema validity, evidence validity,
critical mistakes, allowed/unsupported claims, rubric scores, tokens, cost,
latency, and deterministic publication disposition. Never publish a raw model
completion to make an evaluation appear successful.

## 4. Adapter PR Checklist

```markdown
## Work Package
Wxx; requirement IDs; exact base commit/tree.

## Behavior
What source/reader behavior changes and what stays unchanged.

## Source Evidence
Qualification receipt; sample dates/hashes; source authority and reuse assessment.

## Mapping
Native identity -> normalized identity.
Source action/date -> typed action/date.
Completeness/checkpoint -> replay behavior.

## Tests
New fixture; parser-shape failure; partial page; replay; corrected date/version;
rate limit; no raw persistence/no model; compatibility tests where applicable.

## Operations
Cadence/host/payload/model budget; owner; typed health; rollback/disable behavior.

## Limits and Review
What was not qualified; required editor/security/API/operations reviewer roles.
No live ingestion/deployment authorization is implied by this PR.
```

## 5. UI PR Checklist

```markdown
## Work Package and Contracts
Wxx; public DTO version; real vs synthetic fixture status.

## Flows
Entry/deep link -> filter -> result -> detail -> source -> back.
Saved state -> reload; empty vs stale vs error; jurisdiction-dependent filters.

## Evidence
Desktop/mobile screenshots; keyboard/focus results; no horizontal overflow;
long-title case; no console errors; source/mark/font assets verified.

## Accuracy
No invented status/date/license/locality; held interpretation is not current;
historical sponsorship is not a current officeholder claim.

## Compatibility
Existing URLs/canonicals/feed/featured lead unchanged or explicitly migrated.
Mockup-only implementation details were not imported into production routing.
```

## 6. Exact-Candidate Release Receipt

```json
{
  "version": "watch-release-receipt-1",
  "status": "not-qualified",
  "commit": null,
  "tree": null,
  "schemaHead": null,
  "artifacts": [],
  "modelConfigurationHash": null,
  "registryHash": null,
  "featureFlags": {},
  "checks": [],
  "sourceQualificationReceipts": [],
  "countyDispositions": [],
  "contentReviewReceipts": [],
  "browserEvidence": [],
  "loadAndBudgetEvidence": [],
  "rollback": {
    "candidate": null,
    "previousCodeWithExpandedDataTest": "not-run",
    "writerPauseProcedure": null,
    "backupOrBookmark": null,
    "modelConfiguration": null
  },
  "operationalAuthorization": null,
  "deployedReadback": null,
  "naturalCycleObservations": [],
  "timelinessSampleCounts": {},
  "unresolvedHolds": []
}
```

## 7. Worked Policy Acceptance Trace

All identifiers and actions here are synthetic. This is an implementation test
scenario, not information about a real bill.

1. Adapter receives `DEMO-PA-01`, session `2025-2026`, printer `P1`, native action
   "referred to committee," source day `2026-09-10`. It persists O1 before any
   model request. Instrument/action keys exclude fetch time and display title.
2. Typed parsing accepts the instrument/session and date-only action. Its normalized
   lifecycle is active; legal effect remains unknown/not established. The model
   may propose a short change explanation supported by O1.
3. The ordinary editor accepts grounded metadata. The dossier can display the
   committee action and original source; applicability remains review-pending.
4. An operator captures text artifact A1 and extraction E1. A policy reviewer
   accepts interpretation R1 bound to A1, E1, provision evidence, definition D1,
   and the review-rule version. Only those accepted fields enter revision G1.
5. The next poll returns the same action and A1. `lastSeenAt` advances; no new
   development, model call, or public `materialUpdatedAt` is created.
6. An amendment supplies printer P2 and artifact A2. The source identity is still
   the same instrument, but version/action/evidence are new. R1 does not authorize
   A2, even when the source URL is unchanged.
7. Accepted current metadata says amended text is pending review. The current
   applicability block is held; historical R1 stays labeled as prior-version
   interpretation. A dated development is created only after materiality and
   publication gates, with one canonical ContentItem and one dossier link.
8. If a definition changes independently, compare that dependency hash too. If
   public content is retracted, current delivery tombstones override old cursors.

Expected proof: one stable instrument; separate P1/P2 versions; one replay of O1
without duplicate development; no inherited R1 approval for A2; no invented exact
action time; old story URL retained; current public projection has no private
reviewer fields. This trace should become an end-to-end fixture in W06/W11.
