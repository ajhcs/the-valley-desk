# Production failure inventory — 2026-09-06

This inventory reconciles read-only production D1 queries, public `/health`, and 55 operational notices received from August 28 through September 5, 2026. The inspection did not clear alerts, import mail, mutate D1, deploy, or run a live backfill. Production reported schema `0026` and build `a09dc7bbb813eced9fb145bfc5ee4dd696bf509b` during the inspection.

## Active incidents

| Fingerprint | State | First / last observed | Occurrences | Last successful coverage | Affected records or coverage | Disposition |
|---|---|---|---:|---|---|---|
| `valley-desk:source-fallback:cooper-newsroom` | warning, degraded | 2026-09-01T00:27:23.925Z / 2026-09-06T02:02:08.023Z | 491 | Primary `last_success_at` is null; the current fallback returned 14 items | Cooper newsroom is served by a PhillyVoice discovery fallback, not Cooper first-party evidence | Unresolved. Keep open until consecutive primary successes; fallback is review discovery only. |
| `valley-desk:leadership-monitor` | critical, blocked | 2026-08-28T03:17:07.420Z / 2026-09-05T19:17:28.576Z | 131 | No successful readable snapshot for the currently failing Penn Princeton and Penn Doylestown pages | 2 of 2 attempted pages failed; runtime alert reported loss across 11 named institutions; next retry was 2026-09-09 | Unresolved. Do not infer departures from empty, blocked, or unreadable pages. |

The latest inspected ingest run (`2026-09-06T02:01:37.672Z`–`02:02:07.620Z`) succeeded with 104 items, and no automation lock was held. A successful overall run does not resolve either active coverage incident.

### Source-specific read-only evidence

A final read-only check at 02:46 UTC showed `cooper-newsroom` as nominally healthy only because the PhillyVoice fallback succeeded; `last_fallback_url` remained populated. The first-party Cooper executive page was separately `blocked`, HTTP 403, six consecutive failures, no successful snapshot, next retry September 11. The release keeps this distinction visible and does not let fallback success establish Cooper's official position.

| Source | Current classification | Last success | Retry | Evidence-backed cause |
|---|---|---|---|---|
| Cooper executive leadership | blocked, 6 failures | none | 2026-09-11 22:15 UTC | HTTP 403; unavailable to the bounded collector. |
| LVHN leadership and committees | blocked, 6 failures | none | 2026-09-11 22:15 UTC | HTTP 403; unavailable to the bounded collector. |
| Penn Information Services leadership | upstream failed, 6 failures | none | 2026-09-11 22:15 UTC | Page fetched but contained no readable leadership evidence. |
| Penn Doylestown CEO article | upstream failed, 5 failures | 2026-09-01 00:11 UTC | 2026-09-09 19:15 UTC | Previously readable official article now yields no readable leadership evidence. |
| Penn Princeton article | upstream failed, 5 failures | 2026-09-01 00:11 UTC | 2026-09-09 19:15 UTC | Previously readable official article now yields no readable leadership evidence. |

These sources remain degraded. Registered first-party alternatives can supply discovery or corroboration, but no alternative silently changes the failing source's state, no empty page creates a departure, and retry schedules remain bounded.

## Recovered incidents with historical evidence

| Fingerprint / incident | Resolved at | Historical failure evidence | Recovery interpretation |
|---|---|---|---|
| `valley-desk:model-verifier` | 2026-09-05T10:47:14.816Z | Last stored failure payload said 4 attempted, 1 failed | Recovered, but the old recovery email repeated this stale failure payload. Schema 0027 stores the healthy observation separately. |
| `valley-desk:automation-lock-busy` | 2026-09-05T03:32:10.177Z | Repeated overlapping hourly claims | Recovered after consecutive successful lock observations; inspected lock table was empty. |
| ChristianaCare RSS degradation | 2026-09-04T06:47:06.169Z | Historical failure detail remained on the alert row | Recovered; prior failure stays as incident history, not current health. |
| DVHIMSS timeout | 2026-09-01 | Upstream timeout | Recovered after later source success. |
| Automation persistence failure | 2026-09-01 | `NOT NULL constraint failed: source_health.next_attempt_at` | Recovered. The current persistence path always derives a non-null next attempt and schema 0022 enforces it. |
| Legacy Cooper critical degradation | 2026-09-01 | Primary coverage failure | Critical coverage condition recovered when fallback coverage became available; the separate fallback warning remains active. |
| Technical.ly, LinkedIn, and X configuration notices | 2026-08-28 | Missing credentials or unsupported collection | Alert lifecycle is resolved, but the inspected `source_health` rows remain `misconfigured`; they are not evidence of healthy collection. |
| Model enrichment incident | 2026-08-28 | Editor-model operational failures | Recovered after successful observations. Validation holds remain review outcomes, not operational failures. |

## Source-health findings not represented by an open immediate alert

- Technical.ly has 27 consecutive failures and no successful collection.
- Three LinkedIn sources remain misconfigured without a token and have never succeeded.
- X remains misconfigured; its last recorded success predates the inspection.
- Official-source schedules contain continuing 403, 404, 526, oversized-response, and access-challenge outcomes across CHOP, Cooper, ChristianaCare, Delaware, Jefferson, LVHN, Microsoft, NJHA, OCR, Pennsylvania agencies, and Penn finance pages.
- Official discovery contained 317 candidates across events, filings, finance, news, policy, procurement, and product categories. None had converted to `content_candidates`; policy had 52 discoveries, 38 detail failures, and zero conversions.
- `email_discoveries` contained zero rows. The 55 operational notices and 65 Scher correspondence messages used for this inventory were read-only external evidence, not silently imported production data.

### Detail-failure reconciliation and bounded remediation

The 38 policy failures above are the original inspection snapshot. A second read-only query at 2026-09-06 02:31 UTC found 26 current policy failures and 192 failures across all categories; production activity, not this unshipped change, accounts for the changed count. The 26 policy rows were fully classified:

| Rows | Source | Stored outcome | Cause | Release behavior |
|---:|---|---|---|---|
| 20 | CMS newsroom | `Upstream redirect left the source allowlist` | Candidate URLs use `cms.gov` and canonically redirect to `www.cms.gov` | Retry within the registry-derived host set containing only CMS apex/`www`; unknown hosts remain blocked. |
| 4 | Delaware DHSS newsroom | `Official detail redirect changed host` | Discovered links were child-welfare, meal, or assistance navigation, not newsroom developments | Migration marks them `filtered/outside-registered-policy-path`; they no longer consume retries or KPI denominators. |
| 1 | NJ Department of Health | `Official detail redirect changed host` | Statewide department-services navigation escaped the `/health/` scope | Mark filtered and require `/health/`. |
| 1 | NJ public notices | `Official detail redirect changed host` | Same department-services navigation link | Mark filtered and require `/health/public-notices/`. |

New discovery applies the same path scopes before persistence. The detail scheduler spends its bounded budget on policy first and the source scheduler reserves HB 1925, SB 1113, HB 1993, the AI topic index, HAP, NCSL, and the House/Senate health committees. This is release acceptance evidence, not a claim that production has recovered: schema 0027 and the new collector code have not been deployed, and no failed rows were altered during this task.

## Notice reconciliation and repaired contracts

- The September 5 digest omitted the still-open leadership incident because the old query required `last_seen_at` after midnight. Schema 0027 includes every open incident and snapshots the fingerprints included in each digest.
- Recovery messages previously labeled the incident-opening payload as current `details`. Schema 0027 adds `recovery_detail_json`; recovery mail now labels `recovery_observation` and `prior_failure` separately.
- Dynamic executive departures could close a role and then throw while rendering a person absent from the static pack. Read-only tracing identified two exact CHOP role rows closed in the September 2 failure window and 205 dynamic roles overall, 204 already closed across 10 institutions. The old verifier also treated person-bio omissions as roster-wide absence evidence. The candidate now accepts absence only from complete `leadership-page` rosters, renders and validates the stored identity before closure, and isolates malformed identities as bounded `identity-invalid` failures. Historical roles were not changed; the exact evidence and recovery boundary are in `docs/evidence/leadership-identity-trace-2026-09-06.md`.
- Model enrichment and verifier notices now record successful-attempt counts in the recovery observation instead of presenting historical failures as current.
