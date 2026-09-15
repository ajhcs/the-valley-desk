# Watch Live Delivery Readiness

Date: 2026-09-12. Scope: local W04 implementation, not public Watch activation.
Base: `69341c68091f3ffb8adca922be308a20e73fa846`.

## Implemented Boundary

- `compileWatchDelivery` reruns the accepted projection and derives an immutable
  manifest from exact fact, evidence, source-permission, verification-rule,
  artifact, license, interpretation and regional provenance bindings.
- Only an opaque compiler-issued handle can enter `persistCompiledWatchDelivery`.
  HTTP callers cannot provide accepted payloads, manifests, or approval booleans.
- `0030_watch_delivery_dependencies.sql` adds immutable manifests, immutable
  dependency history, typed monotonic dependency heads, and acceptance clocks.
  Its SHA-256 is
  `cb15e65a26eac1ca8a947ced187e735c9a2299bab5f3a9dc1c49f21c4e21f93e`.
- The transaction gate rechecks every asserted dependency and current temporal
  interval at the actual application instant. A stale or missing head rolls
  back clocks, generation, decision, public revision and public-revision count.
- Exact concurrent replay does not create another dependency revision, manifest,
  or publication generation. Changed digests need a newer immutable head record.
  Retraction uses a retained null digest, not deletion.
- Current regional heads bind stable entity membership, not each resource's
  checked day. Accepted regional facts still bind their exact check day. Policy
  interpretation frames are scoped per subject and fact, while definition,
  exception, reference and amendment heads invalidate shared dependencies.

## Delivery Semantics

The directory captures one UTC instant and its America/New_York civil day. Its
single row-selection statement evaluates current dependency heads, current
tombstones, field eligibility, filters, ordering, and body budget together.

| Changed assertion | Public result |
| --- | --- |
| Required title, policy identity, resource type, or artifact | Hold entire record |
| Definition, exception, reference, amendment or interpretation frame | Remove affected current meaning; retain independently accepted metadata |
| Policy lifecycle fact | Deliver lifecycle `unknown`; active-stage filter cannot match |
| Current regional relationship or membership term | Remove that exact edge; recompute organizations; hold technology if no eligible edge remains |
| Present institution location | Does not erase separately accepted historical provenance |
| Historical provenance correction/retraction | Invalidates the historical edge |
| License bytes/version/evidence | Remove that assessment; recompute classifications and OSS |
| Source permission or verification rule | Invalidate every group bound to that exact dependency |

Current relationships require both a future `validThrough` instant and a current
regional membership interval. Membership `validTo` is exclusive and changes at
Eastern civil midnight. Expired current evidence is never relabeled historical.
Historical assertions bind their own accepted region-at-time fact and remain
subject to source, evidence, rule, and correction invalidation.

An OSS match requires a valid reviewed **code** license for the exact version of
a public accepted artifact. Data-only or weights-only licensing does not imply
OSS. Live organization, lifecycle, and license filters run before LIMIT.

Each surviving value is rebuilt into the existing allowlisted public DTO.
Orphaned citations are removed. Validity maps must cover all manifest groups;
payload, manifest, value, fact, citation, regional-term and filter bindings are
checked again before delivery. Missing manifests fail closed, including legacy
0029 rows. Held accepted details return 409; unknown/withdrawn details return 404;
malformed stored data and database failures return unavailable rather than an
apparently healthy empty page.

Directory and detail JSON envelopes remain unchanged. Successful reads include
`X-Watch-Delivery-As-Of`, independently of the historical publication `asOf`.
Responses remain no-store/noindex. The public flag remains off by default.

## Request-Wide Memory Bound

This is a whole-request result bound, not `51 * maximum manifest size`:

1. Admission caps each canonical manifest at 512,000 UTF-8 bytes, each public DTO
   at 150,000 bytes, 100 field groups, and 400 dependencies per group. The database
   additionally caps persisted manifest bytes and payload bytes (200,000).
2. The eligible CTE materializes at most `limit + 1` **identity/size rows**, at most
   51. Eligibility and every requested filter precede that LIMIT. It does not
   return their full manifests or payloads to the Worker.
3. Each row is conservatively charged
   `2 * payloadBytes + 4 * manifestBytes + 32,000`. This covers JSON escaping,
   manifest-derived group-validity keys, hashes and bounded identity metadata.
4. The cumulative body allowance is 2,400,000 bytes. Only its contiguous prefix
   receives bodies and validity maps. At most one further row is returned with
   null body columns as a compact lookahead, bounded at 8,000 bytes.
5. The largest admitted valid body fits the budget:
   `2 * 150,000 + 4 * 512,000 + 32,000 = 2,380,000`.
6. The cursor stays anchored to the last delivered row, retains the requested
   limit in its filter fingerprint, and therefore cannot skip the deferred row.
   A byte-limited page is deliberately shorter than its requested limit.
7. JavaScript validates and shapes rows sequentially; no Promise.all of manifest
   parsing retains 51 large object graphs. A malformed first row fails closed.

The fixed result bound does not claim constant database scan work. Eligible
selection uses the existing ordered directory index and dependency-key primary
keys; the window can sort at most 51 compact candidates. Qualification still
needs representative production-volume D1 latency/load measurements before
public activation, especially when many stored rows are held.

## Verification

Local Node 24.14.0, isolated worktree-owned locked Wrangler 4.125.0 installation.
Root integration must rerun against its upgraded Wrangler and Node 22 candidate.

Final local result: **84/84 tests passed**, zero failures, with
`node --import tsx/esm --test --test-concurrency=1 test/watch-contracts.test.ts test/watch-delivery.test.ts test/watch-persistence.test.ts test/watch-d1.test.ts`
at 2026-09-12 13:41 UTC. `npm run build` passed at 13:42 UTC;
`npm run secret-scan` passed for 299 tracked/untracked files. `git diff --check`
passed. The repository's explicit `npm test` list must include the new
`test/watch-delivery.test.ts` in the root integration commit.

- Dedicated tests cover compiler capability rejection, source/regional provenance,
  exact field/fact/citation/filter bindings, manifest admission, current vs
  historical regional eligibility, Eastern membership expiry, immutable heads,
  acceptance races, optional redaction, pre-LIMIT filtering, old cursors, source
  permission withdrawal, license invalidation, and legacy manifest holds.
- A 32-dossier fixture uses genuine accepted definition/exception/reference/
  amendment dependencies, measures the actual SQL result bytes, and traverses
  every byte-limited page without gaps or duplicate IDs. Lookahead body fields
  are verified null; every measured result is within the aggregate bound.
- Real local D1 applies the complete migration chain with foreign-key checks and
  exercises transaction rollback, input races, exact and competing publication
  decisions, exact concurrent head/manifest replay, missing-head rejection,
  dependency redaction, pre-LIMIT holding and time-based regional expiry.
- Build/type-check passed. The inherited main-bundle >500 KB warning remains;
  this branch does not own the later Watch UI code splitting.
- No live source fetch, provider call, remote database command, push, deployment,
  editorial acceptance, or public source activation was performed by this task.

## Remaining Release Holds

This code is an internal persistence and delivery boundary, **not** the real
editorial/source dependency resolver. Production source permissions, accepted
regional provenance, revision-head writers, reviewer authorization and ongoing
dependency-change scheduling still require qualification and authorized wiring.
The synthetic fixtures manufacture test approvals and must never be imported
into runtime ingestion or editorial modules.

Migration compatibility alone does not qualify Watch publication. Keep the flag
off until actual source coverage, accepted evidence, editorial staffing, model
evaluation and production-volume delivery checks satisfy the broader blueprint.
