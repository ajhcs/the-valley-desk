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

Hourly cron writes JSON lines for `cron`, `lock`, `leadership`, `leadership-review`, `run`, `source`, `news-extraction`, `model`, `publication`, and `reconciliation` outcomes. Secrets and token-like keys are redacted. Leadership monitoring is failure-isolated from news/event ingestion; each run seeds the 16-institution coverage registry, fetches at most 16 bounded first-party sources, persists snapshots/observations, and records explicit active/degraded coverage posture. LinkedIn inventory and partial/PDF sources are retained but never fetched. Additions/title changes are autonomously applied only after two consecutive complete daily snapshots or two independent registered official sources. Departures need two consecutive complete non-hostile snapshots plus independent official corroboration. Conflicts stay unresolved. Resulting editorial candidates remain in review and enter the editor-in-chief pipeline; they are never directly published.

`schemaVersion` is the latest D1 migration prefix (currently `0015`). `0014_editor_review_verification.sql` adds content-change freshness plus durable claim-ledger and verification results, and `0015_signals_alerts.sql` adds signal trust state and durable operational alerts; apply both before deploying code that reads these tables. `buildSha` prefers the `BUILD_SHA` var, then `CF_VERSION_METADATA.id`. `npm run deploy` injects `BUILD_SHA=$(git rev-parse HEAD)` onto the existing Worker.

News article extraction is URL-keyed in `news_article_extractions` (`0011`). Successful rows cache bounded normalized text only (never raw HTML) and refresh after 7 days. `failed` and `no-content` cool down from 6 hours with exponential backoff capped at 7 days. A failed refresh keeps the last successful body so the item never regresses to the RSS snippet. Article fetches stay on exact-host HTTPS, with redirect, size, time, concurrency, and per-source candidate-cap bounds.

Executive intelligence is additive in `0012_executive_intelligence.sql` and `0013_executive_verification.sql`. `covered_institutions.official_source_status` is explicit for every covered institution. Empty, challenge, partial, unrecognized, hostile, and failed snapshots do not create departure/title-change observations. The autonomous verifier requires a complete, recognized, non-hostile official source and the confirmation thresholds above before changing role history; unresolved and conflicting records are retained for diagnostics. Replacements close only the normalized prior open title and preserve the old row. The review API remains an authenticated diagnostics/explicit-override path, not a routine human approval gate.

The scheduled handler starts extraction-cache cleanup in its own `waitUntil`, independently of the content automation promise. Cleanup removes stale rows after 45 days, preserves active backoff and recent successful bodies, and converges the table to a 2,000-row cap in bounded 200-row batches.

## Email routing and discovery

Email Routing uses the existing `the-valley-desk` Worker and two intentionally separate paths:

- `leads@thevalleydesk.org` forwards to the verified destination `clyons@ajhcs.org`. It does not enter D1.
- `signals@thevalleydesk.org`, `signals+linkedin@thevalleydesk.org`, `linkedin@thevalleydesk.org`, `page(s)@thevalleydesk.org`, and `newsletter(s)@thevalleydesk.org` route to the Worker's `email()` handler. Plus aliases are an exact allowlist; arbitrary `signals+...` categories are rejected.

The email handler stores only bounded metadata, an excerpt, and normalized public HTTPS URLs in `email_discoveries`. Each row has explicit `trust_state` (`untrusted-pointer` or `authenticated-pointer`); the platform envelope recipient determines the category, while MIME `To`, sender, and authentication data are diagnostic only because forwarded mail can rewrite or spoof them. It never stores raw MIME or attachments; all URL query parameters are removed because notification and unsubscribe links commonly carry secrets. Message text remains untrusted data, is never executed as instruction, and prompt-injection-like mail is rejected. Accepted discoveries remain review-only and are visible through the protected detailed automation-status endpoint. Inbound email never calls the model, fetches a URL, or publishes content; a separate allowlisted public-source verification step is required. Atomic per-domain/global admission caps limit flooding, and isolated hourly cleanup expires rows after 90 days without blocking the content automation. `leads@` is deliberately not an accepted Worker inbox.

Email discovery does not use ordinary MIME `Authentication-Results` or `ARC-Authentication-Results` as authority. A message may be retained as an untrusted pointer when it uses an exact signal alias and contains a bounded public URL; only a separately proven Cloudflare-authenticated result can mark it `authenticated-pointer`. Neither trust state can publish without public-source verification. Lead forwarding is independent of this gate.

Activate routing only after migrations `0010_email_discoveries.sql` and `0015_signals_alerts.sql`, plus the matching Worker version, are deployed:

1. Refresh Wrangler OAuth so it includes `email_routing:write`.
2. Onboard `thevalleydesk.org` in Cloudflare Email Service. Confirm there is no existing MX provider before accepting DNS changes.
3. Add and verify `clyons@ajhcs.org` as a destination address.
4. Create an exact routing rule from `leads@thevalleydesk.org` to that verified destination.
5. Create exact Worker routing rules for the signal inboxes above. Do not use a catch-all.
6. Configure a Gmail filter on the primary `clyons@ajhcs.org` mailbox to forward only LinkedIn notifications to `signals+linkedin@thevalleydesk.org`, label/archive them, and avoid a user-facing copy. Send one synthetic LinkedIn notification; verify one `email_discoveries` row with `trust_state = 'untrusted-pointer'`, then resend the exact message and verify the original row remains unchanged (`receive_count = 1`, unchanged `last_seen_at`).
7. Send a lead to `leads@thevalleydesk.org` and verify delivery to `clyons@ajhcs.org` without a D1 discovery row.

Inbound email is untrusted discovery evidence. It cannot approve, publish, withdraw, or feature content, and it does not reuse `REVIEW_API_TOKEN`.

## Operational alerts and daily digest

Migration `0015_signals_alerts.sql` adds D1-backed `operational_alerts` and `operational_digests`. Alert fingerprints, occurrence counts, notification backoff, and digest claims are durable across Worker isolates; in-memory maps are not used for notification deduplication. Details are allowlisted and bounded, and secrets, raw MIME, body/excerpt text, email addresses, cookies, and URLs are removed before persistence or delivery.

Wrangler declares a restricted `NOTIFY_OPS` send binding: sender `alerts@thevalleydesk.org` and destination `clyons@ajhcs.org`. The binding is intentionally unavailable to arbitrary recipients. Immediate alerts trigger only after repeated run/source failures; the daily digest is claimed at 08:00 UTC and contains bounded operational counts. A send failure is recorded for bounded retry and does not recursively create another alert. No model-budget alert is configured.

Create the Access application for `thevalleydesk.org/ops*` with a deny-by-default policy allowing only `clyons@ajhcs.org`. Keep the same production Worker and do not protect the public site globally.

## Rollback

```bash
npm exec -- wrangler deployments list
npm exec -- wrangler rollback
```

Rollback restores the previous Worker bundle for `the-valley-desk`. It does not create another Worker and does not touch DNS. After rollback, hit `/api/health` and confirm `buildSha` matches the intended deployment. If the rollback predates a D1 migration, restore D1 first (below) or the live code and schema will disagree.

## D1 Time Travel, export, restore

Database: `the-valley-desk` (`b2dbcf15-4cbd-4189-8775-a2f51e8eb014`), binding `VALLEY_DESK_DB`.

```bash
# Point-in-time info
npm exec -- wrangler d1 time-travel info the-valley-desk

# Restore to a bookmark (destructive; copies the chosen time over current)
npm exec -- wrangler d1 time-travel restore the-valley-desk --bookmark BOOKMARK

# Logical export / restore drill
npm exec -- wrangler d1 export the-valley-desk --remote --output /tmp/the-valley-desk.sql
npm exec -- wrangler d1 execute the-valley-desk --remote --file /tmp/the-valley-desk.sql
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
- [ ] Deploy the existing `the-valley-desk` Worker only (`npm run deploy`); verify both configured Custom Domains
- [ ] `GET /api/health` returns `ok`, current `schemaVersion`, and the git `buildSha`
- [ ] `/`, `/news`, `/events`, `/voices`, `/feed.json`, `/feed.xml` return 200
- [ ] HTML canonical/OG/JSON-LD/noscript use `https://thevalleydesk.org`
- [ ] `HEAD /feed.json` and `HEAD /api/health` return 200 with empty bodies
- [ ] Homepage lead remains latest News (`rankedNews[0]`)
- [ ] Public copy does not mention collection machinery
- [ ] After deploy, token `GET /api/automation/status` shows the last cron outcome

## Recovery

See `MVP_RECOVERY.md` for the product recovery record. This file is the Cloudflare/D1 runbook that recovery asked for (CI, provenance, rollback).
