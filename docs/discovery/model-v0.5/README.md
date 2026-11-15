# TVD-CONCEPT-0.5: discovery contract refinement

This successor preserves the v0.4 system boundary, native IDs, 32 historical obligation families and independent documentary expectations. It adds typed review targets, artifact rights, immutable public rows, complete dependency vectors, explicit continuation failure, provider identity and temporal-domain contracts. The authoritative model is [model/tvd-discovery.sysml](model/tvd-discovery.sysml); TypeScript correspondence is governed by [the interface contract](../interface-contracts.md).

The frozen v0.4 model remains byte-identical at SHA-256 `2db650c71d7a8703ff01b814e1db84629b33c9de99b702e2d90bad30235387a9`. Its separate reproduction is recorded in [the baseline reproduction receipt](../reviews/wp02-baseline-reproduction.json). Neither a historical pass nor this successor's model/schema checks qualify source truth, authenticated authority, real D1 concurrency, provider access, reader value or deployment. E01–E06 remain unexecuted for discovery.

## Retained and extended scope

- `proof-scope.json`, its digest, finite model/manifest/function-flow inputs, evidence sources, and original mathematics/control drivers are retained byte-identically. Fresh runs identify the successor model hash.
- `review-scope.json` and its digest retain all 60 independent historical expectations unchanged. `review-scope-v0.5.json` adds the accepted WP01 policy source and three verification plans. All original expectation records remain exact; no scope item is dropped.
- `model-contract-scope.json` retains the 44 selected field roles and seven original specializations. Exactly two field types change: `SearchSnapshot.results` and `creatorResults` now reference immutable `PublicRowReference`. Additional checks cover new records and target subtypes. [scope-refinement.json](scope-refinement.json) records the changes; the original exact type expectations remain in the frozen baseline.
- `refinement-scope.json` retains RF01–RF09 before execution. `doc tvdRefinements` in the native model defines the modeled rules checked against that additional scope. Those documentary rules are not arbitrary native SysML execution.
- The English profile's source hash and finite native-binding model hash identify the successor. Their selected terminology and finite mappings retain original IDs. The finite slice remains an abstraction, not an implementation of creator decisions or database transactions.

## Correspondence and meaning

| Contract | Native successor role | TypeScript role | Required implementation evidence |
| --- | --- | --- | --- |
| Independent review | Abstract `ReviewTarget`, four specialized target records, `ReviewDecision`, F_REVIEW | `ReviewTarget`, `DiscoveryReviewDecision.expectedDependencies` | Server-authenticated review/rule authority and claim-specific admission in WP14. |
| Creator publication | `PublicCreatorProjection`, F_PUBLISH creator output | Creator target and immutable person/organization `PublicRowRef` | Independent creator path with no artifact prerequisite. |
| Rights | `LicenseAssessment.artifact`, artifactVersion, `MaterialScope`, individual permission fields | `ArtifactRightsAssessment` | Exact version/material rights, retention/removal and permitted public DTOs. Native `metadataMaterial` maps to runtime `metadata`; it avoids a reserved SysML keyword. |
| Complete dependencies | `DependencyVector`, `DependencyRevision`, `DependencyRole` | Required/entry keys, revisions, expiry and commit-guard/validity roles | Trusted manifest completeness, atomic SQL failure guards and later current-read checks. |
| Immutable delivery | `PublicRevision`, `PublicRowReference`, F_PUBLISH | `DiscoveryPublicRevision`, `PublicRowRef` | Real immutable rows, full transaction rollback and durable operation replay. |
| Query/recovery | `SearchSnapshot`, `SnapshotCursor`, `SnapshotContinuation`, F_SEARCH | Query/snapshot/cursor schemas and continuation helper | One coherent primary observation, no-store headers, 400 mismatch, 410 restart and external recovery-incarnation storage. |
| Dates | `PrecisionDate`, `RegionalEligibility.contributionDate`, `SortKey` | `DiscoveryDate`, date construction/containment | Calendar coordinates remain distinct from actual instants; unknown timezone cannot become an instant; current and creation-time location stay separate. |
| Acquisition | `ProviderIdentity`, `DiscoverySourceRequest`, `DiscoverySourceCapture`, `DiscoverySourcePage` | Source identity/request/capture/acknowledgment schemas | Installation-bound access, provisional capture before durable acknowledgment, atomic checkpoint advancement and six actual provider qualifications. |

Provider identity uses provider, installation, kind and native ID. Historical P09 proves a smaller provider/native-ID key; RF09 checks the full new tuple separately. Historical P11/P28 use abstract evidence/policy heads. RF03 adds the full named vector obligations but still assumes inputs, atomic storage and trusted manifest derivation; it does not prove a real transaction.

Publication generation has two roles. The expected predecessor is a per-target commit guard; global/snapshot generation is an immutable coordinate. Neither is a requirement that all older rows match the newest global generation after an unrelated addition. Other materially used dependencies remain validity checks. A current projection cannot outlive their expiry.

A valid snapshot may preserve its membership across additions. Correction, withdrawal, rights/permission/rule/policy change, identity or relevant endpoint change, and expiry terminate continuation. P20/P21 partition guarantees apply only while valid. Restoring an old database can restore matching old epochs: external incarnation rotation and reconciliation of post-backup removals remain mandatory recovery work.

## Verification and reproduction

Run programs only from a fresh scratch copy on verified `/workspace`: the retained drivers write beneath their parent directory. The complete selected command history and input/output hashes are linked by `validation/receipt.json`. Keep earlier failing attempts and their original inputs.

The historical checks cover native parse/selected terminology, selected record structure, retained documentary scope, finite workflow/native binding, 74 SMT lemmas, the 320-state/2,348-transition abstraction, replay and 30 negative controls. RF01–RF09 add authored rule inventories, symbolic guards and identity examples, plus exhaustive snapshot-flag outcomes. Structural and rule-inventory checks are explicitly distinguished from symbolic results. Actual TypeScript tests are separate application evidence; they cannot discharge real SQL, API, provider or external-truth obligations.

The selected package does not include every earlier v0.3 comparison, diagram or full original environment. Inherited historical references to those supplemental artifacts are not a claim that they were reproduced. No frozen source was edited, no source was enrolled, and no production or persistent service was started.
