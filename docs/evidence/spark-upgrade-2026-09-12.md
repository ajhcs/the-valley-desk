# Spark 1.3 Existing-Pipeline Upgrade

Prepared September 12, 2026. This is a candidate qualification record, not a
production deployment receipt. Final gate, provider replay, backup, deployment
and readback evidence is retained under:
`/mnt/d/tmp/plumbob/tvd-spark-release-HchTeo`.

## Authorization and Scope

The owner explicitly requested Spark activation and confirmed that this platform
contains public news data, with permission to send its data to Contributor.
Hypothetical private-data categories are not an unresolved approval requirement
for this task. This approval is distinct from accepting a source claim as true.

The release upgrades the existing News/Events and official-source model pipeline,
alongside the already-qualified News/Events improvements and disabled Watch
foundation. It does not claim completion of the 100-case Watch evaluation corpus,
staffed tri-state coverage, new collectors, representative data, or public Watch
activation. Those remain separate work. No synthetic case or AI research note is
represented as an independently approved source or gold editorial label.

## Model and Provenance

- Explicit deployment setting: `meta/muse-spark-1.3-contributor`.
- Editor classification/copy retains `minimal` reasoning; verifier retains `low`.
- Official-source transport, quoted model metadata, input hashes and stored
  relevance model now consistently use the configured model instead of hardcoded 1.2.
- Enrichment and verifier caches are scoped to model, endpoint and prompt version.
  Legacy untagged results remain reusable only for 1.2 at the original endpoint.
- Publication/content identities are unchanged. The upgrade does not reset the
  backlog, reopen approved/rejected rows, change source dates, or retimestamp news.
- Source-level defaults retain 1.2 when model configuration is omitted. This is a
  baseline configuration default, not automatic error fallback from 1.3.
- Existing prompts, schemas, literal-span/publication gates, schedules, 32-item
  editor quota, 4-way concurrency, 45-second timeout and 110-second editorial
  deadline remain unchanged. Official-source quotas remain independently bounded.
- Existing per-run bounds are not a durable aggregate daily currency ledger.
  The bounded evaluation ledgers below do not claim to implement that future
  infrastructure or an end-to-end production spending guarantee.

Both public Watch flags remain false. Voices navigation and the paused external
social collector remain unchanged.

## Provider Compatibility

Actual authenticated calls through the existing completion and verifier wrappers
passed six checks: both exact models with minimal JSON-object, minimal strict
JSON-schema, and low-reasoning verifier requests. These use fixed synthetic
prompts and establish transport/parameter compatibility, not editorial quality.

- Exact returned model identities and HTTP 200 were verified; no retries.
- Provider-reported total cost: $0.0003100.
- Conservative reservations: $0.0434176, within the $0.05 run cap.
- 568 prompt and 1, 266 completion tokens were reported.
- Receipt: `/mnt/d/tmp/plumbob/tvd-spark-compatibility-2XDY2P/report.json`.
- Receipt SHA256: `9c9608a8d94f6c59f43f168c84bd04e5bde10a14fb1e5d2762ba179a59f1a005`.
- Ledger SHA256: `e0a7198f4eb0523949d549b27f7b9fce1df60e23fb18ec9c5c30194786279c6a`.

The first pricing preflight stopped with zero inference requests because it had
not classified search pricing. Its receipt remains at
`/mnt/d/tmp/plumbob/tvd-spark-compatibility-jF4TTy/report.json`.
The corrected probe excludes tools/plugins/online model suffixes and bounds
cache pricing at or below normal input pricing; unknown components still block.
The original failed preflight was not replaced or reported as a successful run.

Pricing and Contributor data use were checked against
[OpenRouter's exact model listing](https://openrouter.ai/meta/muse-spark-1.3-contributor)
and its public model metadata. Account access was tested without printing or
retaining credentials.

## Public Catalog Replay

A separate paired replay uses six fixed existing public catalog items, three News
and three Events, with unchanged source/title/body/dates and review-only evaluation
copies. Exact selected IDs, input hashes, responses, literal-span checks, pure
editor decisions, cost and latency are recorded under
`/mnt/d/tmp/plumbob/tvd-public-catalog-replay-H0Y7b8`.

This is public-catalog replay, not a newly fetched primary-source gold corpus,
blinded human scoring, or statistical proof of model superiority. No replay output
is written to publication storage. The maximum was 36 actual wrapper calls with a
$0.50 reservation cap and no retries. The completed replay made 25 paid requests
and reported $0.0070632 charged, with $0.1826816 conservative reservations retained.
Its independent receipt audit passed 17 checks.

Both models produced valid enrichments on five of six cases and rejected the same
non-literal DVHIMSS classification before copy. Baseline produced five valid copy
responses and candidate four: 1.3 withheld HAP copy below the existing threshold.
The 1.3 Jefferson financial-news verifier objected where 1.2 approved. All ten
successfully evaluated outcomes remained in review; nothing was published.
This is acceptable evidence for a monitored reversible configuration rollout,
not an accepted broad editorial-quality or noninferiority claim. Preserve the
shared failure and stricter holds rather than tuning this replay to pass.

Report SHA256: `359fb02a00835c019f805a0845a89544172c77efd71333044f8b47a002e9aeb0`.
Ledger SHA256: `3ceeb1a610ce2cb6a671616f6e7de8bd9409dda01961defc10b12c3ba5869008`.

## Verification and Release

The official routing regressions passed 89 focused tests. The independent cache
change passed 220 tests in its separate worktree; offline review-packet tooling
passed 24. These overlapping counts are not a combined release-test total.

The first integrated run passed 664 of 666 tests. One remaining check asserted the
old configured model; its expectation was updated to 1.3 while retaining budget and
binding assertions. The other needed the declared PDF runtime in the fresh
worktree. After bootstrap, both focused checks passed. The full exact-candidate
gate must still pass independently, with one retained build and no masked retry.

Independent review found no blocking routing/cache regressions. The authoritative
release policy is `local-exact-tree`, unchanged from the previous production
source. Controlled manual deployment can use that qualified source and retained
assets; this does not claim hosted CI passed. GitHub pushes/merges remain held
because automatic Builds are owner-confirmed enabled, while the operator session
cannot read their branch/deployment controls (HTTP 403).

Before deploying, verify the completed replay, fresh backup and local restore
drill, genuinely pending 0028-0030 migrations, exact retained assets and actual
rollback target. After deploying, verify bindings/model identity, public routes
and a natural scheduled cycle without forced ingestion.

Rollback restores Worker `29af8da5-807f-412d-a019-ac9d34e4ac0a` with its recorded
1.2 configuration, not old code with 1.3 variables. Additive tables are retained;
do not destroy current data merely to roll code back. The historical 8239.929-second
policy miss remains historical evidence; an absence of new eligible samples does not establish
recovery.
