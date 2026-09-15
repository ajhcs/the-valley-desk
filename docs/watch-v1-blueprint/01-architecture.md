# Architecture and Design Decisions

## 1. Baseline Reconciliation Is a Prerequisite

Observed locally on 2026-09-12:

| Candidate | Meaning | Required action |
| --- | --- | --- |
| `29e6a4e` / `codex/valley-desk-hardening` | Current checkout | Inventory its tests and untracked documents; do not overwrite them |
| `e0d03be` | Last recorded production build in the September 7 operational note | Compare source, model diagnostics, slug, and deadline fixes; freshly read back production only within authorized scope |
| `23972f4` / `codex/pa-release-acceptance` | Local policy candidate with migration `0028` and PDF review | Review and reuse `policy-pdf.ts`, `policy-provisions.ts`, `PolicyBaselinePage`, protected routes, and tests |

W00 produces a base manifest: commit/tree hashes, migration head, included fixes,
excluded work with reasons, unresolved review holds, and baseline test results.
Do not mechanically cherry-pick whole branches without comparing ancestry and
overlapping changes. Creating a branch/worktree or other Git metadata write uses
the repository's scoped escalation procedure. No such operation is part of this
planning deliverable.

The staged PDF implementation is not proof of live extraction or reader delivery.
Keep its evidence limits, including unresolved amendment/definition review. Preserve
the recorded 8,239.929-second policy disposition miss; do not reset its start time
or overwrite it with a later successful observation.

## 2. System Shape

```text
Enrolled public sources              Qualified batch runner
API / RSS / Atom / ICS / HTML         PA ZIP/XML / NJ Access / PDF preparation
             |                                      |
             +-- bounded adapters / evidence packets+
                                |
                 immutable raw observation in D1
                   + source health + durable cursor
                                |
             typed parsing, identity, date, region, materiality
                                |
               normalized subjects / versions / evidence
                                |
            Muse classification -> proposed copy/enrichment
                                |
        existing deterministic gates + independent verification
        + human evidence-specific policy interpretation where required
                                |
              accepted public revision / ContentItem
                                |
         transactional public read projection + generation
                                |
       React pages / crawler HTML / v2 API / feeds / sitemap
                                |
           News and Events remain first-class consumers
```

No arrow leads directly from a collector, model completion, or arbitrary row in
`policy_instruments` to a public response. Discovery metadata may be useful
internally without being ready for readers. A complete extraction is not an
approved interpretation.

### Module ownership

| Boundary | Existing anchors | Proposed additions |
| --- | --- | --- |
| Shared content | `src/content/schema.ts`, `publication.ts`, `queries.ts` | `watch-schema.ts`, public projection types, v2 content extension |
| Collection | `src/ingest/official-source-discovery.ts`, `source-health.ts`, `identity.ts` | Source adapters under `src/ingest/watch/`; registry qualification metadata |
| Durable state | `src/ingest/persistence.ts`, migrations `0027` and staged `0028` | Focused `watch-persistence.ts`; additive normalized/projection tables |
| Editorial | `editor-model.ts`, `editor.ts`, `verification.ts`, `editor-work.ts` | Task-specific proposed enrichment schemas; model evaluation harness |
| Policy | `policy-baseline.ts`; staged `policy-pdf.ts`, `policy-provisions.ts` | Jurisdiction mappings, people/terms, accepted fact projection |
| Technology | `product-watch.ts`, `fixtures/product-watch.json` | Resource/artifact/development contracts; regional relationship validation |
| Delivery | `worker.js`, `src/router.tsx`, feed/canonical/crawler helpers | Versioned Watch reads, list/detail routes, compatible feed adapters |

Do not move every existing ingestion module into the new directory. Keep related
changes small enough that failures can be localized and rolled back.

## 3. Architecture Decisions

| ADR | Decision and reason | Rejected alternative / revisit trigger |
| --- | --- | --- |
| A01 | Extend Workers/D1 and the existing editorial system; it already carries provenance, review, and published fallback | New CMS or service rewrite adds migration risk without reader benefit |
| A02 | A dossier is a stable subject; a development is a dated editorial item | Treating every sync as news produces duplicate stories and false freshness |
| A03 | Store source-native facts and reviewed meaning separately | A single model summary cannot distinguish amendment text, advocacy, and law |
| A04 | Normalize identity/relationships; retain rich bounded evidence as JSON | A graph database is unnecessary for these bounded joins; reconsider only after measured query limitations |
| A05 | Add immutable public revisions for Watch reads and cursor stability | `asOf` plus mutable `updatedAt` does not provide a snapshot; offset pagination shifts during publication |
| A06 | Explicit v2 content delivery, frozen v1 adapter | Quietly widening enums breaks strict existing clients |
| A07 | Use the existing Worker for small reads; an ingestion-only batch endpoint for heavy formats | Parsing every archive inside the current editorial deadline causes starvation |
| A08 | Local-browser saved subjects and URL filters in v1 | Accounts/email require unrelated authentication, consent, deliverability, and operations work |
| A09 | Prefer verified institution-to-artifact links over global trend ranking | GitHub popularity, a profile location, or broad healthcare usefulness does not prove local eligibility |
| A10 | No automatic provider fallback; qualify the exact Contributor model | A fallback can silently change price, data handling, and output behavior |
| A11 | Keep bounded PDF storage already staged; measure growth before adding R2 | A second artifact store now duplicates an unqualified workflow |
| A12 | Default batch hosting recommendation is a separately authorized managed job with pinned dependencies, initially operator-triggered | Do not create a new systemd service, persistent crawler, or production schedule during feature coding |

A12 is conditional: W05 must choose the actual host after checking available
infrastructure, secrets, per-job limits, archive tooling, cost, and scheduling
timeliness. GitHub Actions is a candidate for reconciliation jobs, not a promise
of exact-minute scheduling. If the host cannot meet source-family requirements,
the collection slice remains blocked; it is not silently moved into cron.

## 4. Invariants and Their Enforcement

| ID | Invariant | Enforcement points | Required counterexample |
| --- | --- | --- | --- |
| I01 | Raw evidence exists before a model call | Collector persistence acknowledgment; editor input resolver | D1 write fails: zero model calls |
| I02 | A model cannot grant source trust or publication | Enrollment is code/review owned; publication stays in `evaluateCandidate`/`validateForPublication` | Completion says `publish: true`: ignored/rejected |
| I03 | Every public technology record has a verified artifact-specific regional relationship | Typed relationship resolver and public projection validator | Generic GitHub location or vendor marketing claim: held |
| I04 | Unknown and date-only times remain distinct from instants | Date union, adapter mappings, serializers | Source says only a day: no invented midnight or precision metric |
| I05 | Identical input is replay-safe | Unique external/development keys; immutable evidence hash | Replay after timeout yields one observation/development |
| I06 | A changed evidence dependency invalidates the relevant interpretation | Version/artifact/page/provision/definition binding | Same URL, new PDF bytes: old approval is not current |
| I07 | Historical sponsors are not rewritten as current officeholders | Date-bounded membership and role edges | Term changes: old bill retains original sponsor |
| I08 | Source omission does not imply disappearance | Completeness-aware existing reconciliation | Rolling RSS omits event: no withdrawal |
| I09 | Re-fetch/hydration is not publication or material development | Separate timestamps and substantive fingerprints | README whitespace refresh does not enter Latest |
| I10 | Public delivery contains only accepted fields | Explicit public DTO construction; private evidence not spread into JSON | Private note/token/raw source is absent in every public route |
| I11 | News/Events retain service under expanded load | Durable fair dispatch, capacity measurements, deadline guards | Large federal backlog cannot suppress NJ/DE, News, or Events |
| I12 | Existing URLs and v1 contracts remain valid | Frozen serializers and route matrix tests | `technology` does not appear in `/feed.json` v1 |
| I13 | A failed refresh does not erase the last accepted evidence | Append-only observations; no destructive upsert of good payload | Timeout after success leaves published revision available |
| I14 | A database outage is not a fresh empty result | Bundled accepted fallback with actual as-of; explicit unavailable state | D1 error does not become `items: [], fresh` |
| I15 | Public revision and listing generation change atomically | D1 transactional batch; unique current revision | Failure in final statement rolls back the entire publication projection |

These are application invariants, not a claim of formal verification. The
reference tests prove selected local examples; application and operational tests
must prove the integration.

## 5. State Models

### Source state

Reuse `SourceRunState` exactly from `src/ingest/source-health.ts`. The real enum
also includes scheduling/access distinctions such as `backoff` and
`upstream-blocked`; do not copy a shortened list from prose into production.
Keep fetch result, completeness, and schedule eligibility separate. An HTTP 304
can reuse a known good representation; without one it cannot create a valid
empty snapshot. A successful partial page is not a full reconciliation.

### Observation and editorial state

```text
received -> persisted -> parsed -> eligible -> proposed -> validated -> accepted
                        |           |            |            |
                        +-> held    +-> rejected +-> held     +-> held
```

Use existing candidate states where available, with typed reason codes rather
than a competing generic workflow engine. Transport retry is independent of
editorial rejection. Terminally irrelevant observations should not be repeatedly
sent to the model until their substantive evidence changes.

### Policy state

A policy record has independent dimensions:

- `instrumentType`: bill, resolution, proposal memo, proposed rule, rule,
  guidance, enforcement action, or local ordinance.
- `lifecycle`: proposed, active, adopted, failed, withdrawn, vetoed, expired,
  superseded, rescinded, or unknown, with a source-specific mapping/version.
- `latestAction`: source action code/text, responsible chamber/body, and date.
- `legalEffect`: not-in-effect, future-effective, in-effect, stayed,
  ceased, or unknown, supported separately from lifecycle.
- `interpretationReadiness`: metadata-only, text-pending, extraction-pending,
  review-pending, reviewed, or evidence-changed.

This avoids encoding "amended" as a permanent lifecycle, "passed House" as
enacted, or "signed" as already effective. Rules and ordinances need their own
status mappings. Veto overrides, corrections, replacements, and court stays are
separate sourced actions, not forbidden backward transitions.

Only official action evidence advances normalized status. A disagreement between
official sources creates a conflict hold; higher numeric stage or later fetch
time does not resolve it. Within a source, use action identity, source sequence,
effective document relationship, and source-reported ordering. Date-only ties
retain source order; unresolved cross-source ties remain unresolved.

### Technology state

`eligibility` (pending/verified/rejected) is separate from `availability`
(public/restricted/private-link/unknown), `licenseClassification`, and
`evidenceLevel` (documentation/research evaluation/pilot/reported use).
These labels are not a maturity ladder or a clinical endorsement. An older
project can be accepted into the directory without creating a new development.

Verified historical creation/research remains a local connection after a transfer
if the evidence still holds. "Used here" cannot remain a current-use claim after
its dated evidence is superseded. Preserve the historical relationship with its
validity period instead of erasing it or changing its meaning.

## 6. Concurrency, Public Revisions, and Failure Recovery

Each substantive observation has a deterministic identity. Persist observation,
normalized change, and checkpoint together when their limits permit. Otherwise
persist the observation first, process pages/chunks idempotently, and advance the
source checkpoint only when every required page is acknowledged. Crashes before
the checkpoint cause replay, not loss.

Public Watch data uses accepted immutable revisions with `[validFrom, validTo)`
generation intervals. In one D1 `batch`, increment a singleton generation, close
the subject's old public revision, insert the accepted revision, and persist the
publication audit link. Prepared statements bind all values. D1 batches provide
transactional rollback on statement failure; separate batches do not form one
transaction. [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)

Do not use `INSERT OR REPLACE` on parent records: replacement can destroy identity
or child relationships. Use explicit `ON CONFLICT` behavior and an expected
revision predicate/constraint for concurrent acceptance. A stale reviewer receives
a conflict, not a success that overwrites a newer decision.

Keep removed public revisions long enough to service issued cursors; suggested
cursor TTL is 15 minutes and revision retention floor 24 hours. This floor is
for pagination history only, not evidence/audit retention. Retractions must take
effect immediately even for an older cursor: apply current tombstones as a final
delivery filter, so a snapshot is stable except for safety withdrawals. State
this exception in the API contract.

Existing ContentItem publication and Watch projection should commit together
where they share D1. If integration requires a separate projection job, add a
durable outbox in the same publication transaction. Serve the last accepted
projection, retry idempotently, and report projection lag. Never acknowledge a
completed publication and rely on an unawaited in-memory task to finish it.

## 7. Migration and Rollback Design

Use expand -> backfill -> verify -> switch readers -> retain compatibility.
Add tables/columns first. Backfill on bounded ID pages with a durable progress
record; compare counts, relationships, and JSON parse results. Do not infer a
missing session or legal identity merely to fill a non-null column.

Stage `0027` contains nullable session/version fields inside unique constraints.
SQLite permits multiple NULLs in UNIQUE constraints. Add separately normalized,
non-null identity keys after a collision audit; quarantine unresolved identities
and merge only reviewed duplicates with all child references preserved.
[SQLite constraints](https://www.sqlite.org/lang_createtable.html)

Keep legacy ContentItems and their first published slugs. Build dossier-to-story
links without turning old News permalinks into dossier redirects. Revisions of a
policy or a technology license do not rewrite a historical story silently.

Feature controls are proposed additions, not existing env vars:
`WATCH_PUBLIC_ENABLED`, `WATCH_TECH_COLLECTION_ENABLED`, and
`WATCH_POLICY_COLLECTION_ENABLED`, default false until qualified. Public exposure
and collection are independent. Existing collection remains as configured; a new
flag must not disable all legacy policy processing accidentally.

Code rollback is safe only after testing the previous code against expanded data
and preserving v1 parsing. Stop new writers before a rollback. Do not drop tables
or restore an old database as a routine feature rollback. A destructive restore
requires explicit approval, backup/bookmark, and accounting for later unrelated
News/Event writes. Keep the accepted model configuration separately reversible.
