# Operational diagnostic correctness candidate — October 4, 2026

A successful RSS fallback previously called the same recovery counter twice,
allowing one run to satisfy a two-observation threshold. Its alert could also
show null collection freshness while durable source health recorded success.
The repaired candidate counts distinct runs, reports primary and fallback
collection times independently, and labels an open healthy incident recovery
pending until the next independent observation resolves it.

## Behavior and review boundaries

- Recovery uses the durable ingest run ID when available. A per-call guard
  removes duplicate fingerprint updates; the database update rejects adjacent
  repeated run IDs, duplicate legacy timestamps, and observations older than
  the latest failure or accepted recovery. Replay uses the recorded run
  completion time. The generic resolver remembers its last accepted ID only;
  it does not promise global deduplication of every historical ID when callers
  supply new times for old runs. Normal automation supplies stable completion
  times and uses a two-observation threshold.
  Callers without run IDs retain timestamp identity for compatibility.
- Ordinary failure recording and recovery interruption both reject observations
  older than the latest accepted failure or recovery. A rejected stale failure
  cannot claim notification for the retained newer row. Normal automation uses
  its stable completion time for both success and failure, including derived
  collection ages, rather than using a later redelivery time. For open recovery,
  failure wins equal timestamps; healthy observations must strictly follow the
  failure boundary. Late older events do not reconstruct discarded history or
  rewrite newer state. Interruption still updates existing open incidents only.
- Two different successful fallback runs can recover a source availability
  incident. The fallback warning remains degraded; only two primary-serving
  observations resolve that warning. The recovery receipt identifies the
  serving path, so availability recovery does not claim primary recovery.
  Unavailable fallback during cooldown resets pending availability recovery;
  all-path failure resets pending primary recovery of a fallback warning.
  Interruption advances the failure boundary and updates existing incidents
  without inventing a new fallback incident or sending interruption email.
- RSS notes record the actual serving path, primary outcome, and separate
  successful primary/fallback collection times. Independent Cooper discovery
  remains explicitly non-authoritative and requires first-party corroboration.
- Fresh fallback collection during primary backoff advances collection
  freshness while preserving its primary error, failure streak, and retry
  timer. A retained fallback URL after all alternatives fail is unavailable,
  does not count as a healthy observation, and reports currentFallback=false.
- Digest and Ops counts say condition evaluations. They do not count distinct
  outages, physical source attempts, or articles. An open healthy incident
  says recovery pending; its digest includes accepted recovery count and the
  last healthy observation time while preserving the original failure evidence.
- Ops source state is labeled collection state. Separate primary/fallback
  timestamps are collection observations, not publication dates, content
  completeness, current leadership roles, or proof of institutional authority.
  The legacy failure-age API field still measures age since last collection;
  Ops labels it last collection age. Successful fallback alerts use the
  explicit collectionAgeMs field. The actual scheduled source projection now
  carries checkedAt; legacy projected results use a valid stable completion
  timestamp instead of overwriting recovery observedAt with null.

## Local migration prerequisite

Migration 0039 adds nullable last_primary_success_at and
last_fallback_success_at columns only. Historical mixed-path timestamps are
intentionally not backfilled: they cannot establish primary or fallback
success. Pre-migration reads remain compatible and preserve existing retry
holds. Candidate writes require 0039. Under the existing release approval,
review the frozen successor, preserve a database backup and application/config
rollback evidence, verify the intended binding and migration ledger, apply
0039, verify its nullable columns, then deploy the exact reviewed successor.
Do not deploy this write path before the schema. An application rollback leaves
0039 installed; the previous writer ignores the added columns. No blanket new
publishing/merge/deploy approval is required. Credential or security-setting
changes remain outside this patch and require explicit approval.
SCHEMA_VERSION is 0039 for this candidate only.

No source registry, source enrollment, leadership schedule, current-person
record, publication gate, model setting, credential, route, or Cloudflare
configuration is changed. This branch does not activate collectors or add
services. Production 97 remains the supplied operational baseline.

## Offline acceptance coverage

The diagnostic regressions use fake HTTP responses and in-memory SQLite. They
cover one fallback run versus two independent runs; replayed run IDs and
legacy timestamps; an old completed run after a newer failure; primary/fallback
alternation; failed alternatives retaining historical freshness; independent
fallback attribution; primary retry holds; pre-migration reads/no backfill;
recovery-pending digest wording with separate success times; the real scheduled
projection and its legacy timestamp fallback; and both interrupted-recovery
sequences, including a pre-interruption replay and a missing cached URL.
The ordering suite additionally exercises the reviewed07:30 unavailable /07:45
healthy / delayed07:30 replay, pending and resolved ordinary-failure replays,
equal-time success/failure in both orders,48 permutations with reverse replays
and checks after every delivery, both competing SQL update invocation orders,
model-verifier replay, and delayed-delivery freshness. These checks validate
accepted observation ordering, not a global historical run-ID ledger.

Required checks: the focused diagnostic/RSS/alert/leadership suites, npm test
(including its Watch posttest suite), npm run build, npm run secret-scan, and
git diff --check. Exact frozen results and artifact checksums are in the
external candidate manifest. No live source, provider, D1, or browser acceptance
is claimed by these offline checks.
