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

Unauthorized private routes return `404 { error: "not_found" }` so they stay undiscoverable. Health never includes run details, source URLs, or tokens.

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

Hourly cron writes JSON lines for `cron`, `lock`, `run`, `source`, `model`, `publication`, and `reconciliation` outcomes. Secrets and token-like keys are redacted.

`schemaVersion` is the latest D1 migration prefix (currently `0009`). `buildSha` prefers the `BUILD_SHA` var, then `CF_VERSION_METADATA.id`. `npm run deploy` injects `BUILD_SHA=$(git rev-parse HEAD)` onto the existing Worker.

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
