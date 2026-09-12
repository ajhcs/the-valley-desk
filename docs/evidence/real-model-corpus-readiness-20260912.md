# Real Evaluation Corpus Readiness

This is an agent-prepared inventory, not a human-labeled evaluation corpus.
No model calls, network access, production writes, invented reviewer labels,
pricing, approvals or model-quality metrics were used. All 20 calibration and
80 holdout assignments remain unset. There are zero runnable/approved cases.

## Actual Coverage

| Desk | Required | Distinct draft groups | Maximum draft slots | Still to acquire or curate |
| --- | ---: | ---: | ---: | ---: |
| News | 20 | 296 | 20 | 0 before human review |
| Events | 10 | 3 | 3 | 7 |
| Policy | 35 | 6 | 6 | 29 |
| Technology | 25 | 3 | 3 | 22 |
| Cross-cutting | 10 | 7 | 7 | 3 |
| Total allocated upper bound | 100 | not a quota total | 39 | 61 |

The 39 is a preparation upper bound, not 39 qualified cases. Regional relevance,
evidence sufficiency, independent grouping, input mapping and labels remain
unreviewed. Three cross-cutting leads retain malformed-verifier audit outcomes
but no raw model response, so they cannot reproduce that formatting failure.
The true remaining work can increase after editorial review.

Policy coverage is federal 1/7, PA 3/7, NJ 1/7, DE 1/7, local 0/7. The six groups
are the federal CY2026 PFS correction/RIN 0938-AV50, PA HB1925/HB1993/SB1113 in
session 2025, NJ A101 with companion S2431 in session 2026, and DE SB360 in
General Assembly 153. A Philadelphia directory HTML capture is not a seventh
instrument. Agency news releases, advocacy pages and hearing listings were not
silently counted as new policy instruments.

## Evidence Examined

The restored pre-0030 local backup contains 487 candidate rows: 450 News, nine
Events and 28 Policy-tagged rows. Its extraction cache contains 302 successful
and 73 failed rows. The tool reads only explicit public-content columns from
content_candidates and news_article_extractions through SQLite readOnly:true.
It never queries email, authentication, subscriber or operational secret tables.

Nine Event rows are not nine independent events: five are aliases of three
actual chapter events. Four other rows point to Billing, Pressroom, Advocacy
and Elections pages and are agent-identified negative-case leads, not approved
ground truth. The two conference/golf aliases remain in the manifest but do
not inflate counts. Existing flattened event copy is not mislabeled as the
original raw calendar response.

The full retained ORCA, CaPTk and OpenPedCan bundles supply three repository
groups. Their releases, commits, documentation, licenses and paper aliases
must not inflate this to 23 independent technologies or 20 independent release
cases. OpenPedCan's 54,500-character README exceeds the existing 24,000-character
case input limit. Its complete hash remains in the inventory; an editor must
choose and label a literal excerpt before any model input is assembled.

Root's three native federal/NJ/DE fixtures supplement the three PA instrument
rows. Their file hashes and retrieval timestamps are retained. These normalized
JSON fixtures are not falsely presented as complete original legislative text.
The root fixtures and technology capture bundles were inspected read-only;
their current Git status does not confer evidence approval.

The manifest has 317 draft records, including two event aliases, and 176 excluded
backup candidate rows with explicit reasons. It includes source URLs, exact
source-text hashes, representation/file hashes where available, row/field
locators, legacy-item hashes, and limitations. It contains no copied news bodies.

- Manifest: fixtures/evaluation-preparation/real-case-inventory-20260912.json
- Evidence manifest SHA-256: 3b31551111bdf8040b25fabd754e39c3c3cf1d09759172bc968360f87debd33b
- Selected public-row snapshot SHA-256: 7c900a590ecd371ef42796946e6860be9d7c49a0ea2347c9a3fef57c04dc154e

The latter hashes canonical selected SQLite values, not the SQLite file or an
assertion that the backup equals current production. Text hashes describe
retained extraction strings; only files explicitly marked as raw representations
carry that stronger provenance. Preserve the referenced backup/capture bundles
before clearing task scratch; the committed hash-only inventory cannot recreate
missing source bytes.

## Junior Operator Workflow

1. Regenerate a new inventory from explicit local inputs. The output file must
   not already exist; the command never replaces evidence.

```sh
node --import tsx scripts/prepare-evaluation-inventory.mjs \
  --db /absolute/task-scratch/restored-backup.sqlite \
  --source-root /absolute/watch-integration-worktree \
  --technology-captures /mnt/d/tmp/plumbob/tvd-technology-dossiers-20260912 \
  --out /absolute/task-scratch/evaluation-inventory-new.json
```

2. Choose candidate groups, not arbitrary rows. News has enough material for
   selection, but choose a balanced range of organizations, topics, dates and
   positive/negative outcomes. Do not use News overflow to fill another desk.
3. Recover each exact text from its row/field locator or capture bundle and
   recompute its hash. For a selected article use a bound query, not URL
   interpolation:

```ts
const row = db.prepare(
  "SELECT cached_text FROM news_article_extractions WHERE url = ?"
).get(candidate.provenance.rowKey);
// Compare sha256(row.cached_text) with candidate.sourceTextSha256.
```

4. Group all versions of a bill, its amendments, companion bills, advocacy
   excerpts and corrections; group syndicated coverage of the same event;
   group all artifacts of each technology project. The tool implements
   transitive grouping for known aliases and identical source-text hashes.
   Distinct URLs alone do not prove semantic independence. A human must review
   remaining cross-source relationships before freezing any split.
5. Prepare actual EvaluationCase objects with reviewed legacy input mapping,
   literal spans, expected identities/dates, allowed/prohibited claims, holds
   and a usefulness rubric. Assign each underlying group to one desk only.
   Use stable bounded case IDs; long legacy candidate IDs are inventory handles,
   not automatically valid EvaluationCase IDs.
6. Obtain the existing harness's independent human labels and critical-case
   adjudication. Agent assessment and existing model verdicts are not labels.
   Preserve the user's public-data authorization; assess excerpt reuse
   separately rather than inventing a new private-data concern.
7. Fill all category and jurisdiction gaps, then freeze exactly 20 calibration
   and 80 holdout cases, stratified by desk and policy jurisdiction. Every
   underlying group stays entirely on one side. Prompt tuning sees calibration
   only; holdout remains untouched. Designate critical cases inside the 100.
8. Validate through the existing evaluation harness. Supply real current
   configuration, access and pricing evidence rather than copying synthetic
   fixture settings. Only then schedule separately authorized paired runs.
   Repetitions measure variability; they never increase the 100-case denominator.

## Remaining Acquisition

Acquire seven additional distinct Events with real cancellation/date-only/
missing-time and registration evidence; four additional PA instruments, six
federal, six NJ, six DE and seven local instruments; 22 additional independently
identified regional technologies including papers, databases and products; and
at least three additional real cross-cutting failures. Also recover sufficient
evidence for the three malformed-verifier leads, or replace those leads honestly.
No synthetic perturbation of an existing source can fill these real-source gaps.

The existing 100-case synthetic fixture remains useful for harness correctness
only. It does not close this corpus requirement. No cost, quality improvement,
approval rate, confidence interval or regression-rate claim is made here.

## Validation

Twenty offline tests passed: four preparation tests plus the existing evaluation
harness regressions. They cover transitive leakage grouping, alias/version grouping,
invalid evidence, absent labels/metrics, and exact committed-manifest recount
without access to the external backup. Add test/evaluation-preparation.test.ts
to the integration branch's explicit test list.
