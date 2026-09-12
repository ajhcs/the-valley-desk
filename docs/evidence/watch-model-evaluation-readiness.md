# Watch Model Evaluation: Offline Preparation

Prepared 2026-09-12 against local base
`5a0857bb8f74d9259c4fe7a118c012abad3d244a`, which includes staged policy base
`23972f4c04bd2cd891d11488c1580a14b9e14875` and the frozen legacy v1 suite.

Status: **offline mechanics implemented; live evaluation not qualified or enabled**.
This is a bounded W01/W02 preparation slice, not completion of W01, W02, W03,
the model upgrade, or the Watch launch. No real 100-case gold corpus exists in
this change. No provider request, account configuration, source collection,
publication write, migration, deployment, or default-model switch is included.

## Delivered Boundaries

- `src/ingest/watch-model-evaluation.ts`: strict manifest/config/case schemas,
  canonical hashes, allocation and adjudication checks, paired request replay,
  and snapshot-preserving simulated spend accounting.
- `scripts/evaluate-watch-model.mjs`: bounded local-file validator/replay CLI.
  No arguments print offline help. `--mode live` always exits blocked before
  opening corpus/configuration files or accessing provider credentials.
- `test/watch-model-evaluation.test.ts`: synthetic contract, replay, accounting,
  and guarded subprocess tests. Add this file to the explicit `npm test` list
  during integration; this isolated assignment does not change `package.json`.
- `test/fixtures/watch-model-evaluation/`: one synthetic case factory and
  recorded completion helpers, never real model results or real gold labels.

The module is not imported by the Worker, scheduler, ingestion routes, feeds,
or production UI. It reuses `enrichWithEditorModel`,
`verificationInputForCandidate`, `verifyWithSecondModel`, and the pure
`evaluateCandidate` function. It never calls persistence or review APIs, and it
returns only the legacy decision's action/rule, not a publishable content row.

## Corpus Contract

Required distinct cases: News 20; Events 10; Policy 35; Technology 25;
cross-cutting failures 10. Policy requires seven cases each for federal, PA, NJ,
DE, and local coverage. The frozen split is 20 calibration and 80 holdout.

Both splits must represent every desk and every policy jurisdiction. This is a
conservative stratification check, not a new promise that every combination has
the same sample size. The tests use calibration counts 4/2/7/5/2, with at least
one calibration case from each policy jurisdiction. Editors choose the actual
cases before freezing; do not fill gaps with clones or synthetic substitutions.

Each case binds:

| Field | Requirement |
| --- | --- |
| `caseId`, desk, jurisdiction, split, critical | Explicit identity and evaluation stratum |
| `fixtureType` | `synthetic` never qualifies as real evaluation evidence |
| Source text/hash/URL | Exact normalized source representation and credential-free HTTPS URL |
| `legacyItem` | Unchanged editor-task input, `review` status, not featured |
| `inputMappingReceipt` | Editor-reviewed phase-one mapping, especially for technology |
| Expected identity/dates | Precision-preserving gold labels; day and unknown are not fabricated instants |
| Expected claims/holds/spans/rubric | Concrete assertions, exact literal spans, editorial usefulness criteria |
| Reuse/public-data assessments | Explicit external assessment receipts, not model inferences |
| Reviewer labels | Current case and expected-output hashes, decision, reviewer ID, timestamp |
| Adjudication | Named adjudicator, current case hash, receipt ID, timestamp, approved status |

Critical cases require at least two distinct approving reviewers. Duplicate
reviewer IDs, current disputed labels, stale hashes, missing adjudication, and
missing public-data assessments block qualification. Resolve disagreements in
the editorial review workflow and retain its history; this file format stores
the current labels plus references, not a complete review-history service.

Source text must equal the exact title/dek/body/optional event-host representation
used by the legacy editor. Bodies over its existing 6,000-character input limit
are rejected rather than silently truncating the labeled evidence. Technology
cases must have an explicit reviewed News/AI legacy-task mapping for phase one;
Watch-specific prompts and native Watch gate evaluation remain separate work.

These checks verify document structure, hash binding, and declared receipt
presence. They do not authenticate an editor, prove the contents of an external
receipt, establish source rights, or confer operational authorization. Even if
`qualificationRequirementsMet` is true, `liveExecutionEnabled` remains false.

## Hashing And Freeze

`evaluationHash` uses the existing SHA-256 helper over canonical JSON: object
keys are sorted, array order is retained, and absent optional values are omitted.
Source hashes cover exact UTF-8 source text. Case hashes cover parsed case
material, including source, input, expected labels, split, and critical status;
they exclude the case's self-hash and reviewer/adjudication records to avoid a
circular approval hash. Reviewer labels additionally bind the expected object.

The split hash covers sorted case IDs with their split and critical flag. The
corpus binds an exact configuration hash. The CLI also records the raw corpus
and configuration file hashes and the current editor/verifier/evaluator/harness
source-file hashes. Those implementation hashes are receipt evidence, not yet a
comparison against an independently signed approved-build manifest.

Changing evidence, expected labels, mapping, split, or critical status requires
resealing and fresh affected approvals. Hashing does not approve a case. The
synthetic helper explicitly refuses to attest a `public-source` case.

## Paired Replay And Accounting

The exact models are `meta/muse-spark-1.2-contributor` and
`meta/muse-spark-1.3-contributor`. There is no automatic model fallback. Phase one
keeps the existing split classification/copy wrapper, prompt version, JSON schema,
and deterministic validators. The captured requests prove the actual editor's
`minimal` reasoning and the independent verifier's `low` reasoning separately.

Replay supplies only recorded local responses through the wrappers' injected
fetch argument. It cannot take a transport callback or a provider key. A fixed
synthetic token satisfies the existing wrapper's configured-state check but is
never used on a real transport or written to a receipt. The subprocess guard
rejects unexpected fetches and reads of provider/review/social credentials.

Every started simulated request records model, role, case/config/request/input/
system-prompt/schema hashes, stage, repetition, max output tokens, timeout setting,
actual local timestamps, separately labeled scripted latency, transport outcome,
response hash, token usage, reserved cost, and reconciled cost. Headers, source
bodies, raw completions, and private reviewer notes are not emitted.

Held classifications create no fictional copy call. Deterministic verifier holds
create no fictional verifier call. Critical cases repeat three times per model;
repetitions are recorded separately and never increase `distinctCases`.

The plan computes a conservative upper bound of three calls per attempt per
model: classification, copy, and verifier. This is a harness bound, not full
production cost. It does not include collection, upstream source relevance,
retries outside this harness, operational shadow traffic, or all future Watch
stages. Those must enter the live daily ledger before qualification.

Amounts use integer nano-USD. A request reserves the configured maximum input
tokens plus that stage's actual output cap at explicitly supplied token rates.
The entire serialized request's UTF-8 byte length plus a 512-token margin is an
offline input-size check. It is not a qualified tokenizer or a proof of provider
billing overhead. No current price or tokenizer has been verified by this work.

Recorded usage reconciles actual cost even when it exceeds the reservation.
Excess reported tokens create a replay issue, not a clamped cost. Timeout,
transport error, missing usage, malformed usage, and incomplete usage retain the
full reservation. A restored snapshot preserves outstanding reservations and
the request count. Replay errors and unused responses remain visible; unused
recordings are never counted as requests.

`ReplaySpendLedger` is in-memory simulation accounting with validated snapshot
reload. **It is not the durable production spending ledger.** A live runner must
acknowledge a durable reserve before dispatch, reconcile provider billing after
ambiguous completion, handle crashes and concurrent writers, and bind an approved
UTC-day/run budget. Do not connect a real transport to this replay implementation.

## Commands

Run in the verified task worktree with mounted development storage:

```bash
node --import tsx/esm scripts/evaluate-watch-model.mjs

node --import tsx/esm scripts/evaluate-watch-model.mjs \
  --mode validate --stage calibration \
  --corpus /absolute/path/corpus.json \
  --configuration /absolute/path/configuration.json

node --import tsx/esm scripts/evaluate-watch-model.mjs \
  --mode replay --stage calibration \
  --corpus /absolute/path/synthetic-corpus.json \
  --configuration /absolute/path/synthetic-configuration.json \
  --case synthetic-policy-amendment \
  --recordings /absolute/path/synthetic-recordings.json

node --import tsx/esm --test test/watch-model-evaluation.test.ts
```

Validation exits 2 for incomplete or invalid readiness, even when syntax is
correct. Replay exits 2 for accounting/control issues or unused recordings.
`--mode live` always exits 2. Explicit calibration/holdout selection is required.
The CLI writes only JSON to stdout and never writes a corpus or credentials.
File limits are 8 MB corpus, 64 KB configuration, and 5 MB recordings.

Tests create task-owned temporary JSON under `TMPDIR`, honor mounted storage,
and remove it in `finally`. No 100-case real corpus is committed or generated.

## Remaining Acceptance

1. Editors must assemble and adjudicate the actual public 100-case corpus,
   including local provenance, licensing, status conflicts, missing definitions,
   stale baselines, duplicate discoveries, date-only actions, and cancellations.
2. Freeze holdout membership before prompt tuning. Build blinded/randomized
   reviewer packets and the real copy-quality scoring/adjudication workflow.
3. Qualify exact account access, Contributor data handling, current prices,
   supported parameters, token bounds, stage deadlines, and explicit spend scope.
4. Implement a separate durable live-run reservation/reconciliation ledger,
   crash recovery, approved implementation-hash comparison, and per-stage results.
5. Add scoring for real paired wins/losses, critical unsupported claims/holds,
   schema/evidence validity, relevance recall, p50/p95 latency, timeouts, and cost.
   Replay's legacy action/rule is not the new Watch publication-gate score.
6. Run the separately authorized comparison and independent editorial review.
   Only then prepare the model switch and rollback under W03/W12.

Do not report simulated latency, synthetic completion quality, configured rates,
or a structurally complete manifest as a successful Muse comparison.

## Local Verification

Node v24.14.0, task-owned locked dependencies, mounted development scratch:

| Check | Result |
| --- | --- |
| New offline evaluation suite | 16 tests passed |
| New suite plus frozen v1, editor resilience, and lane suites | 63 tests passed |
| Repository `tsc -b` | Passed |
| Repository secret scan | Passed; 270 tracked/untracked files enumerated |
| Guarded CLI subprocesses | Default, blocked live, validation, replay, and malformed input exercised |

This is not the complete repository release gate. CI Node 22, a fresh full build,
local D1/scheduled smoke, live provider qualification, and real editorial scoring
remain separate. Bootstrap reported three pre-existing high dependency advisories;
this assignment made no dependency or lockfile changes.
