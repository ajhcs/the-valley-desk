# Technology Dossier Workflow: 2026-09-12

## Scope and Authority

This increment implements review-only artifact-to-dossier persistence. It does
not enable Watch, enroll a scheduled collector, authorize publication, or
replace an existing product/news identity.

Migration 0033 adds four tables: immutable draft revisions, the current draft
head, artifact observations, and development observations. The write path
validates bounded input, literal retained evidence spans, exact artifact/version
relationships, scoped licenses, and chronological distinctions before a single
transaction commits. Optimistic revision checks fail closed under races.

The source plans use three exact numeric GitHub repository identities. Their
README and license SHA256 values are pinned to the researched bytes: changed
text requires a new source review instead of reusing old descriptions or terms.
The first 10 GitHub releases are retained; this is a bounded page, not an assertion
of complete project history. Source publication time never becomes discovery
time. Tags, inventory baselines, indexing, drafts, prereleases, undated entries
and releases older than 45 days are not current-release review candidates.

## Real Source Records

| Project | GitHub numeric ID | Local relationship evidence | License posture |
| --- | --- | --- | --- |
| ORCA-CDS |1308325438| Maintainer documentation identifies development/evaluation at CHOP | Restricted source: academic/nonprofit internal research; commercial and clinical uses need separate authorization |
| CaPTk |128938343| Maintainer documentation identifies Penn CBICA development/maintenance | Unknown aggregate classification: custom CBICA terms, dependency licenses and a separately noncommercial PHI Estimator |
| OpenPedCan-analysis |358689512| Project documentation identifies CHOP Division of Neurosurgery research support | Unknown scope: repository LICENSE combines CC0 and BSD3; data/weights rights are not inferred |

Sources:
- [ORCA repository](https://github.com/Stephonomon/orca-cds)
- [ORCA exact license](https://github.com/Stephonomon/orca-cds/blob/a6a1771bffcc6660dd0dfe02d4bd12cf561480a3/LICENSE.md)
- [CaPTk repository](https://github.com/CBICA/CaPTk)
- [CaPTk license manifest](https://github.com/CBICA/CaPTk/blob/cce88180d3159546a057b32ca9b4172d3ee2624d/LICENSE)
- [Penn CBICA terms](https://www.med.upenn.edu/cbica/software-agreement.html)
- [OpenPedCan repository](https://github.com/d3b-center/OpenPedCan-analysis)
- [OpenPedCan exact license](https://github.com/d3b-center/OpenPedCan-analysis/blob/f8a806ba3b54e7029f0a9600617acc7107939011/LICENSE.md)

No project code, installer, data download script or container was executed.
Setup is maintainer-documented, not Desk-tested. Facts remain proposals;
representation hashes and short excerpts are evidence handles, not independent
editorial approval. The complete captured representations are retained in
/mnt/d/tmp/plumbob/tvd-technology-dossiers-20260912. The committed JSON drafts
contain bounded excerpts and immutable representation hashes, not full README
copies or an accepted-fact receipt.

The three captured inputs yield 3 dossiers, 23 artifacts and 20 release observations.
ORCA has no GitHub release records in the captured response, so no new release
is invented. None of these software repositories is mislabeled as a database
engine, and no paper publication date is inferred from a repository timestamp.

## ORCA Identity

The existing product ID epic-orca-chop and news permalink remain unchanged.
The alias proposal distinguishes CHOP creation/rights ownership, Stephonomon's
repository ownership, and Epic as the supporting EHR platform. It is explicitly
review-required; no automatic alias or redirect is installed. Editorial review
must decide how the existing product ID maps to the numeric repository subject
and preserve existing news links.

## Implementation

Capture public sources explicitly into a new mounted output directory:

```sh
node --import tsx scripts/capture-technology-drafts.mjs \
  --capture --out /mnt/d/tmp/plumbob/technology-review-UNIQUE
```

The command makes 15 sequential, timeout/byte-bounded public HTTPS requests,
rejects redirects and unexpected identities, and creates files exclusively.
It has no D1 or production binding. Re-run with a new directory; it never
overwrites prior evidence. Source changes fail closed and require review of
the pinned source plan rather than silently updating a claim.

Use the server-owned draft service from the separately authenticated intake
path; pass the last observed revision for optimistic concurrency:

```ts
const prepared = await buildTechnologyDossierDraft(capturedInput);
const previous = await readTechnologyDossierDraft(db, prepared.subjectId);
const staged = await persistTechnologyDossierDraft(
  db, capturedInput, previous?.revision ?? 0,
);
```

Staging returns publicationAuthorized=false. It writes no accepted facts,
subject acceptances, Watch delivery heads, public projections or v1 content.
Do not cast a draft to PublicTechnologyProfile. A separate authorized reviewer
must load the full retained source bytes, establish source enrollment and
regional-entity authority, review each field and license scope, and then use
the existing accepted-fact/current-evidence projection path.

Integrators must add test/technology-dossiers.test.ts to the root explicit test
list. No shared package manifest, Worker route, cron, runtime flag or UI file
was changed in this increment.

## Validation and Remaining Work

104 focused tests passed across technology dossiers, adapters, Watch contracts,
and persistence. The new 8 tests include all 3 real captured drafts in local SQLite,
idempotent replay, history preservation, stale/racing revision rollback,
artifact-specific relationship checks, scoped/versioned licensing, literal
evidence, old/current release separation, and no public writes.

Build/typecheck passed; the existing >500KB main bundle warning remains.
This is not a release gate receipt or production deployment.

Still required: authorized review/acceptance bridge, scheduled collection
integration and monitoring, real paper/dataset artifacts with their own rights
and dates, public development delivery and reader journeys, current-region
registry binding, operational qualification, and launch approval. The recorded
historical relationships do not claim current clinical adoption or current
maintenance beyond the captured documentation.

## Editorial Bridge Follow-Up

The same additive migration now also includes immutable full source
representations, mutable current source heads, and CHECK-based review guards.
technology-editorial-adapter.ts converts stored drafts to the root
EditorialProposal structure without introducing accepted/verified flags.

The internal integration order is:

1. Resolve the source ID from server-owned enrollment; retain each bounded
   representation with persistTechnologySourceRepresentation. Do this before
   attempting a new pinned-source plan so changed bytes invalidate existing
   artifact/license heads even when the new source requires additional review.
2. Stage the qualified dossier draft. Retractions never approve a replacement.
3. Call prepareTechnologyEditorialProposal to obtain proposal, observations,
   currentArtifacts, and sourceHeadAssertions. Merge observations into the root
   resolver; continue independently checking enrolled source permissions,
   public URL policy, dated regional provenance and authorized reviewer identity.
4. Capture sourceHeadAssertions during resolution. Use
   technologyAcceptanceGuards(db, assertions, decisionId) in the same D1 batch,
   before decision/fact/projection writes. A mismatched head fails CHECK(valid=1)
   and rolls the entire transaction back. Do not re-resolve assertions after
   review to make a stale proposal appear current.
5. Existing retracted dependency heads require the root's explicit reviewed
   repair path. This adapter never creates or repopulates approval heads.

Changed captures transactionally retain new bytes and null-invalidate existing
artifact and code/data/weights license heads. Source refresh replay is
idempotent; out-of-order captures and racing head revisions fail closed.
The root must also retain its independent source-enrollment acceptance guards.

An offline integration proof loaded all 3 full captures into local SQLite,
converted all proposals through the actual root EditorialProposal schema,
checked all literal evidence references, and executed current-head guards.
ORCA produced 12 facts/4 evidence references; CaPTk and OpenPedCan each produced
22 facts/15 references. There were zero accepted facts or public writes.
Receipt: /mnt/d/tmp/plumbob/tvd-technology-dossiers-20260912/editorial-adapter-proof.json.

The new follow-up tests exercise literal retained observations, retract-only
license/artifact changes and a source refresh after resolution that rolls back
even earlier statements in an acceptance batch.
The final combined focused suite passes 107 tests (11 technology tests);
build/typecheck and the 369-file secret scan pass. Retraction is deliberately
representation-level: nonmaterial GitHub metadata changes can also require
review. Field-specific materiality may reduce those holds only with a separate
qualified normalization rule, not by silently ignoring changed source bytes.

## Dated Research Leads

[ORCA's publication record](https://pubmed.ncbi.nlm.nih.gov/40419254/) identifies
electronic publication on 2025-05-26 and CHOP/Penn Philadelphia author
affiliations, with DOI 10.1055/a-2620-6221. This supports review of a paper
research-affiliation at that date, not a claim that the GitHub repository was
created on that date. The dated paper artifact should be reviewed separately.

[Penn's official CaPTk page](https://www.med.upenn.edu/cbica/captk/) identifies
the exact toolkit and its Penn team, citing the 2018 paper
10.1117/1.JMI.5.1.011018 and earlier conference work. Do not turn publication
years or conference ranges into invented single-day repository start dates.
