# The Valley Desk operations

One production Worker (`the-valley-desk`) serves workers.dev plus the apex and `www` Custom Domains. Do not create a second staging or production Worker.

## Canonical origin

Public HTML canonical/OG tags, JSON-LD, `/feed.json`, `/feed.xml`, `/sitemap.xml`, `/robots.txt`, and `/llms.txt` all resolve URLs through `PUBLIC_ORIGIN`.

Current default (and the Wrangler var) is the canonical live origin:

```
https://thevalleydesk.org
```

The workers.dev hostname remains enabled as an operational fallback. Requests to `www.thevalleydesk.org` receive a 308 redirect to the apex with path and query preserved.

### Custom-domain deployment

1. `wrangler.jsonc` attaches `thevalleydesk.org` and `www.thevalleydesk.org` as Custom Domains on the existing Worker. Cloudflare creates the required DNS records and certificates during deploy.
2. Build with `PUBLIC_ORIGIN=https://thevalleydesk.org` so static fallbacks match the runtime var.
3. Redeploy the same Worker with `BUILD_SHA` set to the exact git SHA.
4. Confirm apex `/`, `/feed.json`, `/sitemap.xml`, `/robots.txt`, and `/llms.txt` use `https://thevalleydesk.org` and `www` redirects to the apex.
5. Keep the initial one-day HSTS policy until the domain has a stable operational history; do not preload yet.

No second Worker or `env.staging` block is used.

## Endpoints

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET`/`HEAD` `/api/health` | none | `{ ok, schemaVersion, buildSha }` |
| `GET`/`HEAD` `/api/automation/status` | `Authorization: Bearer $REVIEW_API_TOKEN` | Last run, queue counts, sources, reconciliation, build/schema |
| `GET`/`HEAD` `/api/automation/status/review` | bearer token | Status plus a short review queue and recent decisions |
| `GET`/`HEAD` `/api/review-queue` | bearer token | Review queue |
| `POST` `/api/review-queue/:id/decision` | bearer token | Approve or reject. JSON body, 20 POSTs / 10 min / token+IP, `Idempotency-Key` supported |
| `GET`/`HEAD` `/api/executive-observations` | bearer token | Leadership observations filtered by verification status |
| `POST` `/api/executive-observations/:id/decision` | bearer token | Diagnostics or explicit override for one complete, non-hostile leadership observation; not required for routine verification |
| `GET`/`HEAD` `/api/email-pdf-attachments/:id/content` | bearer token or trusted Access context | Download exact retained bytes for an authenticated review attachment; checksum revalidated |
| `POST` `/api/email-pdf-attachments/:id/extraction` | bearer token or trusted Access context | Persist an operator-generated, checksum-bound PDF extraction receipt; review-only |
| `GET` `/api/signals/social/manifest` | `SOCIAL_INGEST_TOKEN` | Authenticated, read-only canonical LinkedIn/X target manifest with coverage, verification, and hash |
| `GET`/`POST` `/api/signals/social/runs` | `SOCIAL_INGEST_TOKEN` | Read latest Vale receipt or submit a manifest-bound collector run summary |
| `GET`/`HEAD` `/ops` | Cloudflare Access (`clyons@ajhcs.org`) | Private operations shell |
| `GET`/`HEAD` `/ops/api/*` | Cloudflare Access context | Browser status API; no bearer token in browser |

Unauthorized private routes return `404 { error: "not_found" }` so they stay undiscoverable. The Worker requires trusted Cloudflare `ctx.access` identity for `/ops` and `/ops/api/*`; it never trusts spoofable `cf-access-authenticated-user-email` headers. Direct `workers.dev/ops` access is denied in code even when Access is configured for the apex path. Health never includes run details, source URLs, or tokens.

## Security headers

HTML responses send CSP (nonce for Worker-injected scripts; Google Fonts allowed), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` disabling camera/microphone/geolocation/payment/usb, `X-Frame-Options: DENY`, and `Cross-Origin-Opener-Policy: same-origin`.

HSTS is omitted on `*.workers.dev` and whenever the request host is not the configured public origin. After a real custom-domain cutover, the Worker sends `Strict-Transport-Security: max-age=86400` for that host only. Raise max-age and add `includeSubDomains` only after the domain is known-good. Do not preload yet.

## HEAD and machine clients

`HEAD` is handled for HTML, feeds, sitemap, robots, llms, health, and private GET APIs by returning the GET status/headers with an empty body. The application does not block bots.

If Cloudflare Bot Fight Mode / Super Bot Fight Mode is enabled on the account, add a skip/allow rule for:

- `/feed.json`, `/feed.xml`, `/api/content`, `/api/health`
- `/sitemap.xml`, `/robots.txt`, `/llms.txt`
- `HEAD` on those paths

That rule lives in the Cloudflare dashboard, not in this Worker. Without it, some feed readers and crawlers that send `HEAD` or unusual UAs will get challenged before the Worker runs.

## Logs and provenance

The Worker has two cron lanes on the same deployment: a 15-minute freshness run (`*/15 * * * *`) for News, current Events, Voices, policy, social, signals, and other fast sources, plus a daily catch-up run (`17 3 * * *`, 03:17 UTC) that repeats the bounded checks and reconciliation window. The two schedules deliberately do not overlap. Eight policy-critical PA bill/topic/committee, HAP, and NCSL sources are due every 30 minutes. Each source pass can select 40 sources and hydrate/evaluate 20 detail candidates at concurrency 4; policy-critical rows sort ahead of ordinary backlog at all three stages. This leaves one 15-minute tick of jitter inside the 60-minute detection SLO, including the tested case where a source becomes due two seconds after a cron tick under 64-source/30-detail competing load. The editor routes candidates deterministically into news, policy, finance, procurement, product, events, voices, and leadership lanes; every nonempty lane receives capacity before unused quota is redistributed, with explicit reservations for current news, time-sensitive events, and current executive/social evidence. Both cron modes write JSON lines for `cron`, `lock`, `leadership`, `leadership-review`, `signal-verification`, `run`, `source`, `news-extraction`, `model`, `publication`, and `reconciliation` outcomes, including per-lane and per-priority model counts. Secrets and token-like keys are redacted. Leadership monitoring is failure-isolated from news/event ingestion and is due-gated at daily cadence; each due run seeds the 16-institution coverage registry, fetches at most 16 bounded first-party sources, and records explicit active/degraded coverage posture. A monitorable source may declare at most four explicit HTTPS alternate URLs; the monitor tries them only after a blocked or incomplete primary and adds their hosts to the exact source allowlist. LinkedIn inventory and partial/PDF sources are retained but never fetched. Additions/title changes are autonomously applied only after two consecutive complete daily snapshots or two independent registered official sources. Departures need two consecutive complete non-hostile snapshots plus independent official corroboration. Conflicts stay unresolved. Resulting editorial candidates enter the same fail-closed editor-in-chief pipeline.

## Release A containment and preflight

The external Vale routine stays paused until the authenticated manifest, one synthetic LinkedIn packet, scheduled D1 consumption, editorial review persistence, delayed acknowledgement, duplicate replay, collector receipt, and `/ops` readback have all passed in the target environment. This repository does not activate or cancel external routines.

Before changing a production routine or source behavior, preserve a rollback snapshot and inventory:

1. Record the current deployment SHA and export the current D1 source-health and alert state to a restricted, off-repository artifact. At minimum, capture `source_id`, `state`, `consecutive_failures`, `last_checked_at`, `last_success_at`, `next_attempt_at`, `last_http_status`, `requires_auth`, `last_fallback_url`, alert `fingerprint`, `severity`, `state`, `occurrence_count`, and `detail_json`.
2. List every Vale/Grok routine touching The Valley Desk, including exact ID, owner, schedule, timezone, and enabled/paused state. Do not cancel anything until that inventory is stored.
3. Confirm there is exactly one intended Vale social collector and that all retired Valley Desk routines are disabled. Keep unrelated routines unchanged. Record the final IDs in the release ticket.
4. Report genuine pack-wide failures separately from one source outage. A single blocked RSS origin, including a public Cooper `401`/`403`, is not a site-wide critical incident when a healthy official fallback or other coverage remains.

The release is split into two bounded gates: Release A validates correctness (manifest identity, packet evidence preservation, review-only flow, delayed/idempotent acknowledgement, and no direct publish); Release B validates resilience (retry windows, alert transitions, fallback coverage, `/ops` metrics, and 72-hour stability). Do not enable the recurring collector based only on a local smoke test.

`schemaVersion` is the code's expected D1 migration prefix (`0037` for the Watch launch candidate), not a live database probe. Verify the remote `d1_migrations` ledger independently; production can still be on an earlier version before rollout. `0014_editor_review_verification.sql` adds content-change freshness plus durable claim-ledger and verification results, `0015_signals_alerts.sql` adds signal trust state and durable operational alerts, `0016_operational_alert_recovery.sql` adds durable consecutive recovery state, `0017_executive_enrollment.sql` adds the institution-scoped pending executive identity ledger, `0018_signal_pointer_verification.sql` adds bounded post-inbox pointer verification provenance, `0019_official_source_discovery.sql` adds official-source schedules, snapshots, normalized detail evidence, and review-only candidate provenance, `0020_official_source_retry_provenance.sql` adds bounded detail-retry backoff plus exact evidence/model provenance, `0021_social_evidence_packets.sql` adds authenticated rich LinkedIn/X evidence packets, `0022_source_health_backoff.sql` adds public-block classification and durable retry windows, `0023_social_collector_runs.sql` adds persisted source fallback URLs plus manifest-bound Vale run receipts, `0024_social_lifecycle.sql` adds durable social quarantine reasons plus collector failure streak/pause signals, `0025_operational_alert_context.sql` adds normalized condition state plus institution/subsystem/group dimensions, `0026_source_health_attribution.sql` persists canonical institution associations for source-health rows, and `0027_policy_intelligence_hardening.sql` adds policy/version/review milestones, publication provenance, filtered-detail disposition, authenticated email receipt provenance, bounded PDF storage, and recovery observations. Migrations `0028_policy_pdf_review.sql`, `0029_watch_public_revisions.sql`, and `0030_watch_delivery_dependencies.sql` add policy background review, immutable Watch read models, and live dependency guards. Apply only the exact reviewed pending migrations before deploying code that reads these tables. `buildSha` prefers the `BUILD_SHA` var, then `CF_VERSION_METADATA.id`. `npm run deploy` injects `BUILD_SHA=$(git rev-parse HEAD)` onto the existing Worker but does not apply D1 migrations.

Source health is explicit: public `401`/`403` is `upstream-blocked` and is normally a warning, while a credentialed `401`/`403` is `auth-failed`. A public block can become critical only when the complete required peer set has lost coverage and no usable fallback remains; a recent successful observation inside the two-hour source freshness SLO keeps a transient failure non-critical while the retry proceeds. Failures retry at 15 minutes, 1 hour, 6 hours, then daily; a source in durable `backoff` is skipped and does not increment its failure streak. Cooper’s RSS is checked first, an empty or blocked feed falls through to its official newsroom HTML adapter, then to the explicitly allowlisted independent PhillyVoice tag page. The independent adapter emits discovery-only, non-authoritative candidates with a required first-party corroboration marker and never expands the article-fetch allowlist. Any fallback use is a durable warning in the daily digest (never auth-critical solely because a public source returned `401`/`403`); the fallback URL and authority citation remain visible to operators and editors.

News article extraction is URL-keyed in `news_article_extractions` (`0011`). Successful rows cache bounded normalized text only (never raw HTML) and refresh after 7 days. `failed` and `no-content` cool down from 6 hours with exponential backoff capped at 7 days. A failed refresh keeps the last successful body so the item never regresses to the RSS snippet. Article fetches stay on exact-host HTTPS, with redirect, size, time, concurrency, and per-source candidate-cap bounds.

Executive intelligence is additive in `0012_executive_intelligence.sql` and `0013_executive_verification.sql`. `covered_institutions.official_source_status` is explicit for every covered institution. Empty, challenge, partial, unrecognized, hostile, and failed snapshots do not create departure/title-change observations. The autonomous verifier requires a complete, recognized, non-hostile official source and the confirmation thresholds above before changing role history; unresolved and conflicting records are retained for diagnostics. Replacements close only the normalized prior open title and preserve the old row. Explicit leadership alternate URLs are fetched sequentially only when the primary is blocked or incomplete; the final URL must match one of the registered source hosts. The review API remains an authenticated diagnostics/explicit-override path, not a routine human approval gate.

New names from a complete first-party `leadership-page` or `about-page` are retained in `executive_enrollment_candidates` by institution and normalized name, even when they are absent from the seed registry. Enrollment requires two complete daily snapshots with the same name/title or two distinct registered first-party roster sources. Same-name records already associated with another institution become `ambiguous` instead of being merged; person-bio, newsroom, LinkedIn, hostile, incomplete, or unrecognized pages cannot enroll an identity. Once enrolled, the normal role-history and editorial-candidate safeguards still apply, and no internal workflow language is emitted to readers.

The scheduled handler starts extraction-cache cleanup in its own `waitUntil`, independently of the content automation promise. Cleanup removes stale rows after 45 days, preserves active backoff and recent successful bodies, and converges the table to a 2,000-row cap in bounded 200-row batches.

## Watch Launch Scope

The September 15 candidate intends to expose 22 CMS federal proposals, three
verified Delaware Valley technology projects, and 36 federal representatives
(PA/NJ/DE House delegations totaling 30 members plus six senators). These are
candidate targets, not a production receipt or guaranteed current counts.
PA/NJ/DE state-legislative and county/local native coverage remains incomplete.
Retain explicit coverage disclosure in the directory; a filter with no records
must not imply that the jurisdiction has no relevant policy activity.

The publication boundaries are independent:

- `WATCH_COLLECTION_ENABLED=true` enables bounded, due-time source collection.
- `WATCH_SOURCE_RULE_ENABLED=true` enables supported deterministic native
  publication after exact retained evidence and current permission checks.
- `WATCH_PUBLIC_ENABLED=true` exposes accepted Watch read models and navigation.
- `POLICY_BACKGROUND_PUBLIC_ENABLED` controls the inherited background page
  separately; enabling Watch does not require enabling it.

Enroll only reviewed source configurations using retained real samples. The
operator qualification helper is evidence preparation, not a deployment or
publication command. An accepted source needs an explicit activation, unexpired
configuration-bound qualification, documented access, and approved link scopes.
Honor applicable denials, authentication and rate limits; use publisher-supported
alternatives when access fails. Do not silently replace blocked sources with
unverified scrapers or broaden a source's authority.

Watch uses the separate `2-57/5 * * * *` cron: minutes ending in 2 collect one
due source; minutes ending in 7 attempt one queued publication. Each phase has a
750-statement allowance, with reserved lease/state cleanup. Partial native staging
resumes on a later source check; held publication candidates cannot monopolize the
queue. Complete official rosters may publish during collection only when the
source-rule flag is enabled. News schedules and model budgets remain independent.

Apply reviewed migrations `0037_representative_raw_retention.sql` and
`0038_watch_source_rule_dispatch.sql` after preserving
a production backup and confirming the pending migration ledger. It preserves
existing roster rows while raising the raw XML cap from 500000 to 1000000 bytes;
runtime bounds and immutability remain enforced. Migration 0038 adds only the
bounded publication dispatch cursor and lease. Record the actual Worker version,
build SHA, migration ledger, runtime flags, source activations, and rollback
candidate. Deploy the release gate's retained frontend artifacts without a second
frontend build.

After deployment, verify the exact build and migration state, then observe a real
scheduled collection. Confirm source health, publication decisions, representative
counts, current evidence timestamps, and public Policy/Technology detail pages.
Exercise desktop/mobile navigation, filtering, representative lookups, provenance,
and unavailable states; check existing News, Events, calendars and feeds for
regression. Do not treat a successful deployment or local fixture run as this
production acceptance. Record any held source and actual coverage separately.

Source-rule facts identify their automated verification honestly. Policy legal
effect and unsupported interpretations remain held; roster observations do not
create term dates, vacancies, sponsorship, or address matches. Technology must
retain its documented regional connection and separate artifact/license evidence.
Spark 1.3 remains the explicitly configured News/Events model; no model authorizes
Watch publication.

## Email routing and discovery

Email Routing uses the existing `the-valley-desk` Worker and two intentionally separate paths:

- `leads@thevalleydesk.org` forwards to the verified destination `clyons@ajhcs.org`. It does not enter D1.
- `signals@thevalleydesk.org`, `signals+linkedin@thevalleydesk.org`, `linkedin@thevalleydesk.org`, `page(s)@thevalleydesk.org`, and `newsletter(s)@thevalleydesk.org` route to the Worker's `email()` handler. Plus aliases are an exact allowlist; arbitrary `signals+...` categories are rejected.

The email handler stores only bounded metadata, an excerpt, normalized public HTTPS URLs, a canonical authentication receipt, and bounded decoded PDF chunks. Raw MIME is never retained. Each row has explicit `trust_state` and `auth_state`; the platform envelope recipient determines category, while MIME `To`, `Authentication-Results`, and `ARC-Authentication-Results` are sender-controlled diagnostics and never confer trust. `src/ingest/email-auth.ts` queries Cloudflare's read-only `emailRoutingAdaptive` dataset using a zone-scoped Analytics Read token, the exact zone, the exact routing-rule UUID, the envelope sender/recipient, and Message-ID. Admission requires the final event to be the Worker action within two minutes of receipt, DMARC pass plus SPF or DKIM pass, and a non-spam result. The canonical session/rule receipt and SHA-256 are persisted. If the route event is not visible yet, the row is `ignored`/`pending` and scheduled bounded retries resolve it; it cannot enter public-source verification until atomically promoted to `authenticated-pointer`/`review`. Most query parameters are stripped; exact HAP `resourceid` and PA document identifiers are narrowly preserved. Message text remains untrusted data, is never executed as instruction, and prompt-injection-like mail is rejected. Accepted discoveries remain review-only and are visible through the protected detailed automation-status endpoint. Inbound email never calls the model or publishes content; a separate allowlisted public-source verification step is required. Atomic per-domain/global admission caps limit flooding, and isolated hourly cleanup expires rows after 90 days without blocking the content automation. `leads@` is deliberately not an accepted Worker inbox.

PDF extraction is a manual review operation owned by Knox (Engineering); there
is no automatic production extractor. From the protected detailed status,
record the pending attachment ID and SHA-256, download the retained bytes from
`GET /api/email-pdf-attachments/ATTACHMENT_ID/content`, and verify the response
ETag/local hash. Generate a bounded
payload directly from the PDF bytes:

```bash
python3 scripts/extract-policy-pdf.py /authorized/path/document.pdf \
  --attachment-id ATTACHMENT_ID \
  --persistence-payload \
  --match "required literal evidence" \
  > /mnt/d/tmp/plumbob/policy-pdf-extraction.json
```

Extract the top-level `persistenceRequest` into its own JSON file, then submit
that file to `POST /api/email-pdf-attachments/ATTACHMENT_ID/extraction` with a
review bearer token or trusted Access session. The endpoint requires an
authenticated parent receipt, exact artifact checksum, pending state,
contiguous bounded pages, and literal evidence spans. Verify the detailed
status reports `complete` (or an explicit failure), page count, extractor,
receipt SHA-256, operator, and timestamp. The attachment and parent message
remain review-only. Delete task-owned temporary plaintext after the review
artifact hash is recorded according to the restricted evidence policy.

The hourly signal-verification stage consumes at most 20 pending discoveries and 40 pointers per run. It strips query/hash data, rejects non-HTTPS/private hosts, and fetches only normalized host/path pairs matching the official RSS, events, coverage, or official-source registry. Redirects, bytes, time, and concurrency are bounded; the final URL is checked again. The fetched page becomes a review-status candidate only when a safe title and article body are extracted, and instruction-like source text is held. `signal_pointer_verifications` (`0018`) retains trust state, matched source, final URL, content hash, candidate ids, retry state, and bounded errors. Candidates are deduplicated by canonical source identity and enter the same raw-persist → Muse enrichment → editor policy → second-pass verification pipeline as every other item. A signal can never publish directly.

Email discovery does not use ordinary MIME `Authentication-Results` or `ARC-Authentication-Results` as authority. Missing Analytics configuration fails closed before persistence; a configured lookup that is merely delayed creates an ignored quarantine row, while an authoritative authentication failure is rejected. Even an authenticated pointer cannot publish without public-source verification. Lead forwarding is independent of this gate.

Activate routing only after migrations `0010_email_discoveries.sql`, `0015_signals_alerts.sql`, `0016_operational_alert_recovery.sql`, `0018_signal_pointer_verification.sql`, and `0027_policy_intelligence_hardening.sql`, plus the matching Worker version, are deployed:

1. Refresh Wrangler OAuth so it includes `email_routing:write`.
2. Onboard `thevalleydesk.org` in Cloudflare Email Service. Confirm there is no existing MX provider before accepting DNS changes.
3. Add and verify `clyons@ajhcs.org` as a destination address.
4. Create an exact routing rule from `leads@thevalleydesk.org` to that verified destination.
5. Create exact Worker routing rules for the signal inboxes above. Do not use a catch-all.
6. Create a token restricted to the `thevalleydesk.org` zone with Analytics Read only, then provision `CF_EMAIL_ANALYTICS_TOKEN`, `CF_EMAIL_ZONE_ID`, and the exact Worker rule UUID as `CF_EMAIL_ROUTING_RULE_ID`. The repository adapter is `src/ingest/email-auth.ts`; no external adapter service is required. Configure the intended routing rule only after its UUID is recorded. Send one synthetic notification; verify one `email_discoveries` row with `auth_state = 'authenticated'`, `trust_state = 'authenticated-pointer'`, a 64-character `auth_provenance_sha256`, and no raw MIME. If the initial event is quarantined, verify the scheduled resolver promotes that same row. Resend the exact message and verify the original row remains idempotent. A forged `Authentication-Results` header without a matching Analytics event must never reach review.
7. Send a lead to `leads@thevalleydesk.org` and verify delivery to `clyons@ajhcs.org` without a D1 discovery row.

Inbound email is untrusted discovery evidence. It cannot approve, publish, withdraw, or feature content, and it does not reuse `REVIEW_API_TOKEN`.

## Operational alerts and daily digest

Migrations `0015_signals_alerts.sql` and `0016_operational_alert_recovery.sql` add D1-backed `operational_alerts` and `operational_digests`. Alert fingerprints, occurrence counts, notification backoff, digest claims, and consecutive recovery state are durable across Worker isolates; in-memory maps are not used for notification deduplication. Critical alerts are reserved for a failed automation/persistence stage or loss of required coverage; a source-level failure with a usable fallback is a warning, public blocks normally remain warnings, and ordinary source backoff is informational. Alerts are grouped by stable fingerprint, reminders are backoff-limited, warnings belong in the digest unless an SLO is breached, and an alert closes only after two consecutive healthy observations. Details are allowlisted and bounded, and secrets, raw MIME, body/excerpt text, email addresses, cookies, and URLs are removed before persistence or delivery.

Wrangler declares a restricted `NOTIFY_OPS` send binding: sender `alerts@thevalleydesk.org` and destination `clyons@ajhcs.org`. The binding is intentionally unavailable to arbitrary recipients. Immediate alerts trigger only after repeated run/source/leadership/model failures; the daily digest is claimed at 08:00 UTC and contains bounded operational counts. A send failure is recorded for bounded retry and does not recursively create another alert. Healthy observations close incidents after the recovery threshold and emit one fixed-recipient recovery notice, while fresh failures reopen the same durable fingerprint and reset its recovery counter. Deliberate source or leadership backoff does not count as a healthy observation. No model-budget alert is configured.

Create the Access application for `thevalleydesk.org/ops*` with a deny-by-default policy allowing only `clyons@ajhcs.org`. Keep the same production Worker and do not protect the public site globally.

## Rollback

For an exact-candidate release, deploy the receipt-verified source and retained
`dist` artifacts with the locked Wrangler CLI and the exact final `BUILD_SHA`.
Do not run `npm run deploy` after that gate: its convenience script builds again.
Confirm candidate-tree and asset hashes before the deployment command, and
retain the resulting Worker version and post-deployment readback receipt.

```bash
npm exec -- wrangler deployments list
npm exec -- wrangler rollback
```

Rollback restores the selected previous Worker bundle for `the-valley-desk`. It does not create another Worker and does not touch DNS. Record the actual current version before deployment, select the intended version explicitly, and confirm its `buildSha` through `/api/health` afterward. A code rollback does not automatically require a D1 restore: determine schema compatibility from the exact migration changes and a local previous-Worker/current-schema smoke test.

### Additive policy and Watch migrations

For migrations `0028` through `0030`, the intended foundation-release rollback is the verified previous Worker with the additive tables retained. These migrations add policy PDF review and Watch revision/dependency storage without replacing existing publication tables. Qualify the previous Worker against the new schema before deployment. Do not delete retained evidence, undo later unrelated News/Event writes, clear tombstones, or restore the entire database merely to roll code back.

Keep `WATCH_PUBLIC_ENABLED` and `POLICY_BACKGROUND_PUBLIC_ENABLED` absent or false until their separate public qualification gates pass. The latter independently controls the inherited `/policy` background page; disabling Watch alone is insufficient. The model, collector, source activation, and protected review permissions have separate contracts and are not enabled by either flag.

A destructive Time Travel restore is a separately authorized data-recovery operation for actual corruption or an incompatible migration. Preserve a current backup and account for writes after the old bookmark before considering it. Older migration-specific recovery receipts retain their own compatibility requirements; this additive rollback procedure does not retrospectively qualify them.

## D1 Time Travel, export, restore

Database: `the-valley-desk` (`b2dbcf15-4cbd-4189-8775-a2f51e8eb014`), binding `VALLEY_DESK_DB`.

```bash
# Point-in-time info
npm exec -- wrangler d1 time-travel info the-valley-desk

# Restore to a bookmark (destructive; copies the chosen time over current)
npm exec -- wrangler d1 time-travel restore the-valley-desk --bookmark BOOKMARK

# Logical export; use a restricted task-owned directory on mounted storage
npm exec -- wrangler d1 export the-valley-desk --remote --output "$RELEASE_DIR/the-valley-desk.sql"
# Restore drill is local only, with a fresh disposable persistence directory
npm exec -- wrangler d1 execute the-valley-desk --local --persist-to "$RELEASE_DIR/restore-drill" --file "$RELEASE_DIR/the-valley-desk.sql"

# Pre-release state export (store output in the restricted release artifact)
npm exec -- wrangler d1 execute the-valley-desk --remote --command "SELECT source_id,state,consecutive_failures,last_checked_at,last_success_at,next_attempt_at,last_http_status,requires_auth,last_fallback_url FROM source_health ORDER BY source_id"
npm exec -- wrangler d1 execute the-valley-desk --remote --command "SELECT fingerprint,event,severity,state,occurrence_count,first_seen_at,last_seen_at,detail_json FROM operational_alerts ORDER BY last_seen_at DESC"
```

Drill: export, store the file off-box, restore into a disposable local D1 (`--local`), and confirm `ingest_runs` / `published_content` row counts. Do not restore over production without an explicit recovery decision. Time Travel restore overwrites the current database.

Local migrations:

```bash
npm exec -- wrangler d1 migrations apply the-valley-desk --local
npm exec -- wrangler d1 migrations apply the-valley-desk --remote
```

## Alert thresholds

Watch Cloudflare Worker logs / `/api/automation/status` (token-protected):

| Signal | Threshold | Action |
| --- | --- | --- |
| `/api/health` not 200 | 2 consecutive checks | Inspect Worker deployments; rollback if the bundle is bad |
| `ingest_runs.state=failed` | 2 consecutive hours | Read `run`/`cron` JSON errors; confirm OpenRouter/source fetch |
| source `consecutive_failures` | >= 3 | Check that origin; official events keep publishing independently |
| `lock` outcome `busy` | 3 consecutive hours | Stuck lease or overlapping cron; inspect `automation_locks` |
| `modelFailedCount == modelAttemptedCount` with budget > 0 | 2 consecutive hours | Contributor routing/guardrails; official events should still publish |
| `published_content` `updated_at` | no change for 24h while sources succeed | Review queue backup or publication invariant |

## Operational checklist

- [ ] `npm ci && npm test && npm run build` green
- [ ] `npm run ops:smoke` applies local migrations and a mocked scheduled run
- [ ] `npm run secret-scan` and `npm audit --audit-level=high` clean
- [ ] Deploy the existing `the-valley-desk` Worker using the exact release-gated artifacts; verify both configured Custom Domains
- [ ] `GET /api/health` returns `ok`, current `schemaVersion`, and the git `buildSha`
- [ ] `/`, `/news`, `/events`, `/voices`, `/feed.json`, `/feed.xml` return 200
- [ ] HTML canonical/OG/JSON-LD/noscript use `https://thevalleydesk.org`
- [ ] `HEAD /feed.json` and `HEAD /api/health` return 200 with empty bodies
- [ ] Homepage lead preserves the existing authored/featured `leadItem` contract; no automatic list fallback
- [ ] Disabled Watch/background pages remain 404/noindex; when Watch is explicitly enabled, its public records pass live acceptance and coverage disclosure matches reality
- [ ] Model, source activation, collector state, credentials, and schedules match the approved release scope
- [ ] Public copy does not mention collection machinery
- [ ] After deploy, token `GET /api/automation/status` shows the last cron outcome

## Recovery

See `MVP_RECOVERY.md` for the product recovery record. This file is the Cloudflare/D1 runbook that recovery asked for (CI, provenance, rollback).
