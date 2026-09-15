# Slug correction and prospective timeliness — 2026-09-07

Local implementation only, based on deployed `6fa9fd855de9e6ab945768d0cf79f7eb9c8e15b1`. No deployment or persisted candidate repair is authorized by this change. Exact-candidate release qualification is recorded separately in the release-gate receipt.

## Operator access and refreshed readback — 17:59 UTC

The failed request was the `discoveries` SELECT sent via POST to `https://api.cloudflare.com/client/v4/accounts/1e5f92087e779df50f3f3546a0eed22e/d1/database/b2dbcf15-4cbd-4189-8775-a2f51e8eb014/query`. Authentication was the existing Wrangler operator OAuth bearer, not `/ops`, Cloudflare Access, or a Worker secret. HTTP401 was retained; the original script discarded the provider error body, so its Cloudflare error code and request ID are unavailable, not inferred. Future errors now retain only endpoint, HTTP status, numeric error codes and request ID; no credential values.

The documented Wrangler operator path (`wrangler whoami`, version4.125.0) successfully identified clyons@ajhcs.org, production account1e5f92087e779df50f3f3546a0eed22e, and existing D1/offline-access scopes. The same configured database then accepted SELECT queries with zero write metadata. Access recovered through the existing session path; no new login consent, API-token provisioning, Worker secret retrieval/rotation, or scope expansion was needed. The direct scratch client bypasses Wrangler's session lifecycle, consistent with a stale access token; the historical401 body is insufficient to prove its precise provider cause. For recurrence, run the normal Wrangler session check first; if interactive login is required, have the authorized operator complete `wrangler login` rather than provisioning replacement Worker credentials. See Cloudflare's Wrangler command documentation.

Refreshed immutable capture: `/mnt/d/tmp/plumbob/tvd-slug-timeliness-2026-09-07T17-59-51-930Z.json`. Health still reports exact6fa9fd/schema0027, no lock held. Of90 policy discovery records,22 have current-fingerprint editorial milestones and68 remain without one; unresolved ages range72866.192–916449.049seconds. These are historical records, including filtered/unadmitted rows, not all actionable backlog. Per-record completed durations and unresolved ages are produced by the offline audit. All three bills still show8239.929seconds. None of90 discoveries originated after deployment: after18h8m56.181s there are still zero eligible new-discovery samples. No sustained recovery is claimed.

The refreshed collision audit covers380 candidate rows,20 published rows and the bundled catalog. A third affected official path is the CMS149.3million telehealth candidate; its corrected downstream rule is `model-evidence-required`, not publication. All affected paths are unoccupied. The audit also checks event publication paths and exits nonzero for an existing or proposed collision, requiring resolution before any repair. No generic collision suffix is introduced. Captured-byte regressions now explicitly prove stable bill IDs, deterministic/new editorial fingerprints, maximum slug length, and the legitimate stale-source blocker for all three bills.

## Identity and freshness

`publicationSlug` removes trailing separators after the existing 72-character truncation. Official discoveries and event publication paths use it; legacy `slugify` remains unchanged for durable event identity keys, URL disambiguators, and committee identity parameters. No hash suffix, date substitution, or freshness exception is introduced. Empty inputs retain the existing `event` fallback. Truncation was never a uniqueness guarantee.

Read-only production audit at 2026-09-07T00:18:06.316Z inspected 344 content candidates, 19 published rows, and bundled catalog paths. The two affected official candidates are HB1925 and HB1993. Their corrected paths collide with neither existing paths nor each other, and neither is published. Offline evaluation of the actual retained content exposes `stale-source-publication` for both, as already recorded for SB1113. They remain policy background, not fresh-news publications. Source action dates, provenance and legislative version identity are untouched.

Candidate IDs are independent of these publication slugs and remain stable. Editorial fingerprints explicitly include the slug (`candidateFingerprint`), so a future authorized deployment can change the two fingerprints when ordinary collection re-admits their content. Do not copy the old milestone onto the new fingerprint: normal editorial evaluation must record the stale-source blocker. Preserve first discovery, historical milestones, publication history and policy-version IDs. Recheck path collisions at that release; this snapshot is not a permanent uniqueness guarantee. No persisted slug was changed here.

Restricted raw evidence: `/mnt/d/tmp/plumbob/tvd-slug-timeliness-readback.json`; capture script beside it uses only SELECT queries and verifies zero write metadata. The first query attempt used nonexistent `relevance_state` and failed HTTP400; it was corrected against migration0019 to `relevance_decision` before the successful capture. No Worker secret was retrieved.

Reproduce offline analysis:

```sh
node --import tsx/esm scripts/audit-slug-timeliness.mjs /mnt/d/tmp/plumbob/tvd-slug-timeliness-readback.json
```

## Prospective timing, not a reset

Preserve the original discovery-to-blocker miss: 8239.929 seconds (2h17m19.929s), 1039.929 seconds over the two-hour target. That cross-deployment cohort is historical and is not evidence of current-build sustained performance.

Current-build cohort starts at the verified deployment time, 2026-09-06T23:50:55.749552Z. At the readback, none of the 90 policy discoveries had an original `discovered_at` at or after that boundary. The 1630.567-second observation window therefore has zero eligible samples, not zero latency or 100% compliance. Sustained acceptance remains unproven.

For continued read-only sampling across natural cycles, retain every new policy discovery, join editorial milestones by BOTH candidate ID and current fingerprint, and report disposition seconds only for an actual brief/blocker milestone. Unresolved age is a separate nullable measure, never time-to-disposition. Keep relevance decisions/technical failures separate from editorial outcomes. Report cohort size, observation interval, outstanding ages, misses and latency distribution; do not exclude unresolved or failed records. Preserve snapshots before another build change and attribute processing with retained build/version logs. D1 alone does not retain a build stamp for every discovery. An empty cohort cannot satisfy sustained acceptance. No schedule reset, timestamp rewrite, synthetic production discovery or forced ingestion is permitted.

Genuinely new source-authored legislative actions remain monitored by the existing natural schedule. Their source dates and legislative-material identity—not changing page hashes or this slug correction—determine whether they are new developments. Existing idempotency acceptance remains closed.

## Local validation

Prior full suite:364 passed, zero failed; affected suites57 passed. The additional captured-bill identity/freshness regression passed locally. Final immutable validation is governed by the repository release-gate receipt, not these earlier checks. Deployment and historical row repair remain separate authorization decisions.
