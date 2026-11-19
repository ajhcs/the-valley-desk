# The Valley Desk

Find and follow healthcare research connected to the nine-county Delaware Valley. Each listing identifies the source of its regional connection. Search the directory by institution, county or topic, or follow additions by the date they entered the directory.

The public site is server-rendered by the Cloudflare Worker. Projects come from the reviewed repository projection. The publications index uses D1 and is gated by `PUBLICATIONS_PUBLIC_ENABLED`. Keep it disabled until a reviewed import has been checked. See [the listing rule](AGENTS.md) and [project removal setup](ops/directory-removals.sql).

## Historical editorial runtime

The following sections describe the earlier editorial system and its operational tooling.

Owner: Cole Lyons (co-founder). Engineering: Knox. Product: Reed. Brand: Mira. CEO: Vale.

Vite + React + TypeScript + TanStack Router + Tailwind on Cloudflare Workers. News and Events sit alongside separate Policy Watch and Technology Watch pages and an event calendar. Voices URLs remain available without promotion. Agents GET `/feed.json` using the same `ContentItem` envelope; Watch has separate v2 APIs. Signed editorial source: `fixtures/catalog.json`.

## Automation

One production Worker runs a 15-minute freshness lane and a daily catch-up lane. Every News pass checks newsroom RSS, current chapter events, and configured social sources; the daily pass provides a second bounded reconciliation window. Both write every raw candidate to D1 before any model call. The production configuration selects Muse Spark 1.3 Contributor (`meta/muse-spark-1.3-contributor`) to classify and ground relevant candidates through OpenRouter's OpenAI-compatible API. Deterministic rules—not the model—make the final publication decision.

Watch uses a separate cron with alternating collection and publication jobs. Each collects one due source or attempts one queued dossier, with a 750-statement budget and persistent retry progress. Complete official representative rosters can advance during collection under the explicit source-rule flag; Watch does not consume the News model budget.

The same locked hourly run seeds the 16-system executive coverage registry and performs bounded checks against enabled first-party leadership sources. Every canonical system has an explicit active or degraded official-source posture; each monitorable source may declare up to four explicit HTTPS alternate URLs, which are tried only after a blocked or incomplete primary and remain within the source host allowlist. Transitional, partial, and PDF evidence is retained as metadata without being used to infer departures. LinkedIn inventory is reusable for identity context but is never fetched. Complete, non-hostile snapshots produce protected observations. Additions and title changes are applied automatically only after two consecutive daily snapshots or two independent registered official sources; departures additionally require two consecutive complete snapshots from independent official sources. Conflicts and incomplete evidence remain unresolved. Verified changes emit review-status editorial candidates; they never publish directly. The observation endpoint is for diagnostics and explicit override only.

The automatic editor-in-chief publishes official future chapter events when their official source and attendance link validate without model calls. Other events and news go through deterministic specialist lanes for news, policy, finance, procurement, products, events, voices, and leadership. Each lane keeps its own quota and freshness ordering, while a hard per-run editorial cap (default 32, deadline 110 s per editorial pass) bounds runtime. Official-source discovery separately selects up to 40 sources and 20 detail/relevance candidates per pass at concurrency 4; eight policy-critical PA/HAP/NCSL sources run every 30 minutes and sort ahead of ordinary backlog. Every nonempty lane receives capacity, unused quota is redistributed, and each pass reserves room for current news, time-sensitive events, and current executive/social evidence before lending capacity to the durable backlog. Fresh source publication dates outrank later article-hydration timestamps. Every run merges up to 1,000 durable D1 review candidates with the current snapshot and deduplicates by canonical source identity. News requires a named local health system, a material operating/technology change, literal evidence spans, and impact/body copy that is verbatim-supported by the source; cited context must likewise be verbatim-supported by verified prior coverage. First-party and exact-registry sources use a moderate evidence floor, while the Inquirer and WHYY may publish at a higher corroboration floor; unknown secondary sources still require first-party corroboration. Source-dated items older than 45 days cannot auto-publish, delayed runs preserve the source date instead of making backfill look current, and exact-registry discoveries without a verified source date remain in review. A structured claim-ledger maps atomic claims (names/numbers/dates/roles) to evidence spans/source/context IDs with exact-match enforcement, while source text remains untrusted. High-risk news classes (financial, policy/regulatory, security/safety/outage, executive change) pass through an independent second verification window that fails closed and never adds facts. Unsupported paraphrase, unverified claims, instruction-like source text, or model-written claims stay in review. Model transport/provider failures cool down with exponential backoff; evidence-validation rejections stay visible in metrics but do not generate outage mail, and an empty cooldown queue is not treated as provider recovery. Changed fingerprints become eligible immediately.

Allowlisted HTTPS article pages are fetched after RSS discovery. JSON-LD `articleBody` wins, then `article`/`main`. Normalized text is cached in D1 by URL (`0011`); successes refresh after 7 days, while `failed`/`no-content` cool down from 6 hours with exponential backoff capped at 7 days. A failed refresh keeps the last successful body so the full article never regresses to the RSS snippet. Raw HTML is never stored. The candidate cap is round-robin across sources; exact-host HTTPS, redirects, size, time, and concurrency bounds stay closed.

Every source check records a specific outcome—healthy, healthy-empty, disabled, misconfigured, auth-failed, rate-limited, upstream-failed, parser-failed, or timed-out—plus item count, last success, and consecutive failures. A transient failure with a successful observation inside the two-hour source freshness SLO does not claim institution coverage loss; it remains warning-level while durable retry state advances. The hourly and daily lanes share a durable lock, source state, alert fingerprints, and recovery counters, so a retry or Worker isolate cannot duplicate notifications or erase an incident. An automatically published event is withdrawn only after two healthy, complete checks of its authoritative source omit it. Timeouts, HTTP failures, empty snapshots, parser-shape changes, catastrophic count drops, partial feeds, and rolling RSS windows never trigger disappearance withdrawal. Explicit cancellations stay on the permalink as cancelled and drop off upcoming; completed events keep their URLs. Cooper’s public RSS also has an exact-host independent PhillyVoice discovery fallback; those candidates are explicitly non-authoritative, are not article-hydrated, and require first-party corroboration. Active fallback use remains warning-level digest data. Missing social tokens and unsupported person accounts are recorded as misconfigured rather than empty success.

Authenticated email and LinkedIn notifications are pointers only. The Email Worker resolves sender authentication through Cloudflare's read-only `emailRoutingAdaptive` dataset using the exact zone and routing-rule identifiers; raw MIME authentication headers are never authority. If Analytics has not indexed the event yet, bounded metadata and attachments remain in an `ignored` authentication quarantine until a scheduled retry promotes a DMARC-pass/SPF-or-DKIM-pass receipt. Untrusted rows never enter the hourly signal-verification stage (`0018`). Authenticated PDF bytes remain pending until Knox (Engineering) runs the documented offline extractor and submits its checksum-bound page payload to the protected review API; there is no automatic in-Worker PDF extraction. That stage checks at most 20 authenticated discoveries/40 URLs, strips tracking data, requires a normalized HTTPS host/path in the official source registry, re-checks the final redirect, and extracts a bounded candidate from the fetched first-party page. Instruction-like source text, unmatched hosts, unsupported pages, and transient failures remain explicitly rejected/failed with durable provenance and retry state. Verified candidates are deduplicated and sent through the normal raw-persist, Muse, editor, and second-pass gates; no signal can publish directly.

Vale’s social collector is a separate, review-only lane. `GET /api/signals/social/manifest` returns the hashed covered-account/current-executive target manifest; `POST /api/signals/social` accepts bounded LinkedIn/X evidence packets; and `POST /api/signals/social/runs` records a manifest-bound collector receipt. All three routes use `SOCIAL_INGEST_TOKEN`, which must be distinct from `REVIEW_API_TOKEN`, `OPENROUTER_API_KEY`, and platform credentials. LinkedIn targets remain inventory-only until `SOCIAL_LINKEDIN_ACCESS_VERIFIED=true` is explicitly provisioned after connector access is verified; X remains inactive until both access and verified targets exist. Social packets remain evidence until the ordinary Muse/editor publication gates succeed. Keep the external Vale routine paused until a production manifest fetch, packet ingest, scheduled consume/ack, idempotency replay, and `/ops` receipt have all passed.

Approved content is written to `published_content`. The Worker merges that D1 overlay into the bundled signed catalog for HTML, dynamic permalinks, `/feed.json`, `/api/content`, `/feed.xml`, and `/sitemap.xml`. If D1 is unavailable, the bundled catalog remains a complete fallback. Automated rows cannot replace editorial rows or set the featured lead.

Product news is admitted to model review only when `fixtures/product-watch.json` verifies that a named regional health system uses the mentioned product. Generic vendor marketing and unverified local-use claims stay out. The official-source discovery lane also watches three verified product/vendor channels (Epic and Microsoft) and three exact, institution-scoped procurement pages (Penn, CHOP, and Cooper). Product/vendor candidates carry a trusted mapped-product relationship; procurement candidates must additionally name a mapped product for the covered institution. Both categories require an accepted Muse regional/materiality result before entering the normal evidence editor and second-pass verifier, and remain review-only until those downstream gates pass.

Public URL generation uses `PUBLIC_ORIGIN=https://thevalleydesk.org`. The same Worker remains available on its workers.dev hostname for operational fallback; `www.thevalleydesk.org` redirects to the apex. See `docs/OPERATIONS.md`.

### Policy And Technology Watch

The implementation blueprint is in [docs/watch-v1-blueprint/README.md](docs/watch-v1-blueprint/README.md).
The [implementation checkpoint](docs/evidence/watch-implementation-checkpoint-2026-09-12.md)
is a historical implementation checkpoint, not a current deployment receipt.
The original blueprint and reference mockups describe the broader roadmap.

Policy Watch and Technology Watch use separate accepted read models and bounded
GET/HEAD APIs under `/api/v2/watch/`. They do not change the v1 feed envelope.
`WATCH_PUBLIC_ENABLED` must be exactly `true` for public Watch reads; the separate
`POLICY_BACKGROUND_PUBLIC_ENABLED` gate controls the inherited `/policy` page and
its public background API. Collection and deterministic publication are separate:
`WATCH_COLLECTION_ENABLED=true` runs the bounded collector, and
`WATCH_SOURCE_RULE_ENABLED=true` permits its supported source-rule workflows.
Protected operator review remains independently authenticated. Enabling a public
page does not qualify its sources or approve unsupported claims.

The collector retains raw source evidence before staging records. Supported
native workflows verify official Federal Register metadata, federal House/Senate
rosters, and exact registered technology captures. Source-rule publication
requires current source qualifications, parser/provenance checks, and transactional
dependency guards. Model output cannot authorize it; unsupported interpretation,
legal effect, and historical membership remain unavailable or in review.
News and Events retain their existing editorial pipeline. The configured model is
`meta/muse-spark-1.3-contributor`; keep the explicit setting during deployment
and record the actual previous Worker configuration for rollback.

The September 15 launch candidate targets **22 CMS federal proposals, three
documented regional technology projects, and 36 federal representatives**
(30 House members and six senators across PA/NJ/DE). These are intended candidate
contents, not production-verified counts. Technology coverage is limited to
verified Delaware Valley connections. The candidate is **not** comprehensive
PA/NJ/DE state-legislative or county/local policy coverage, nor a complete
technology inventory. Federal delegations are not substitutes for state or local
representatives. Missing records do not establish absence of policy activity.

See [Watch launch operations](docs/OPERATIONS.md#watch-launch-scope) and the
[representative workflow evidence](docs/evidence/representative-launch-workflow-20260915.md).
Complete the exact-candidate release gate, source enrollment, migration, scheduled
refresh, and public readback before describing this candidate as live. Never seed
production from synthetic fixtures.

### Local verification

Version-bound legislative PDF extraction, persistent review and the background
watchlist are documented in `docs/policy-pdf-review-workflow.md`. Run
`npm run policy:pdf:bootstrap` followed by `npm run test:policy-pdf` for mandatory
official PDF-byte regressions. The integrated candidate adds schema 0028 and
`/policy`, but production migration, deployment and operator PDF processing
require separate authorization. It does not feed PDF text automatically to the
news editor, import a baseline, or alter freshness/publication gates.

```bash
cp .dev.vars.example .dev.vars
npm test
npm run build
CI=true npm exec -- wrangler d1 migrations apply the-valley-desk --local
npm run ops:smoke
npm exec -- wrangler dev --local --test-scheduled
```

Trigger the local cron at `/cdn-cgi/handler/scheduled?format=json`. Public health is `GET /api/health` (`ok`, schema version, build SHA). Private endpoints are:

- `GET /api/automation/status`
- `GET /api/automation/status/review`
- `GET /api/review-queue?status=review`
- `POST /api/review-queue/:id/decision` with `{"decision":"approved","note":"..."}` or `{"decision":"rejected","note":"..."}`
- `GET /api/executive-observations?status=unverified`
- `POST /api/executive-observations/:id/decision` for diagnostics or an explicit `verified`/`ignored` override; routine verification is autonomous
- `GET /api/email-pdf-attachments/:id/content` to retrieve checksum-validated retained PDF bytes
- `POST /api/email-pdf-attachments/:id/extraction` for a checksum-bound manual PDF extraction receipt
- `GET /api/policy-background` for protected legislative artifact/provision review
- `POST /api/policy-versions/:id/capture` to retain the exact official PDF selected by a durable version
- `GET /api/policy-pdf/:id/content` and `/pages/:n/render` for retained review evidence
- `POST /api/policy-pdf/:id/pages/:n`, `/complete`, or `/failure` for bounded operator extraction
- `POST /api/policy-provisions/:id/review` for a hash-specific background summary or interpretation hold (never a news publication)
- `GET /api/signals/social/manifest` with `Authorization: Bearer $SOCIAL_INGEST_TOKEN`
- `GET`/`POST /api/signals/social/runs` with the same token for the Vale collector receipt

Machine review/status routes require `Authorization: Bearer $REVIEW_API_TOKEN`; social routes require the separate `SOCIAL_INGEST_TOKEN`; `/ops` and `/ops/api/*` require a signature-verified Cloudflare Access application JWT instead. A valid review-queue approval publishes immediately through the same dynamic content layer. A policy-provision review is different: it admits only a background summary or hold, never a news article. `HEAD` is supported on public machine routes and private GET APIs. GitHub Actions runs locked install, tests, typecheck/build, local D1/scheduled smoke, `npm audit`, and a secret scan without production secrets.

### Cloudflare provisioning

1. Create the single D1 database: `wrangler d1 create the-valley-desk`.
2. If Wrangler does not provision the binding automatically, add the returned `database_id` to the root D1 entry in `wrangler.jsonc`.
3. Apply migrations remotely: `wrangler d1 migrations apply the-valley-desk --remote`.
4. Add secrets with `wrangler secret put REVIEW_API_TOKEN`, `wrangler secret put SOCIAL_INGEST_TOKEN`, and `wrangler secret put OPENROUTER_API_KEY`. For email intake, also add `CF_EMAIL_ANALYTICS_TOKEN` (zone-scoped Analytics Read only), `CF_EMAIL_ZONE_ID`, and the exact `CF_EMAIL_ROUTING_RULE_ID`; the handler rejects mail if any correlation setting is absent. These credentials have separate purposes: `REVIEW_API_TOKEN` authorizes machine review operations, `SOCIAL_INGEST_TOKEN` authorizes only Vale manifest/evidence/receipt routes, `OPENROUTER_API_KEY` authorizes model spending, and the Cloudflare token can only read analytics for the selected zone. No token belongs in Git, browser code, or `wrangler.jsonc`; provision the same social token only in the one approved Vale routine.
5. `EDITOR_MODEL` is pinned to `meta/muse-spark-1.2-contributor`; `EDITOR_MODEL_BASE_URL` defaults to `https://openrouter.ai/api/v1`. There is no automatic fallback to standard Muse. Contributor requires OpenRouter Settings → Privacy to allow routing to providers that may train on prompts; any account or guardrail Zero Data Retention enforcement for non-frontier models must also be disabled for this key. If those policies block the endpoint, OpenRouter returns HTTP 404 and the item cools down in review while deterministic official-event publication continues. Muse is a reasoning model: calls request low reasoning effort, keep a 4,096-token shared reasoning/output budget, request `json_object`, and extract JSON from fences/whitespace without loosening Zod or evidence checks. Each scheduled invocation selects at most `EDITOR_MODEL_BUDGET` (default 32) eligible items across specialist lanes with `EDITOR_MODEL_CONCURRENCY` (default 4). Calls time out after `EDITOR_MODEL_TIMEOUT_MS` (default 45s); enrichment and high-risk verification each receive a bounded `EDITOR_MODEL_DEADLINE_MS` window (default 110s) inside the scheduled handler's `waitUntil` work. Set `EDITOR_MODEL_BUDGET=0` to disable model calls without stopping official-event publication.
6. Keep the machine review/status routes undiscoverable and bearer-token protected. Verify the existing Cloudflare Access application covers `thevalleydesk.org/ops` and its `/ops/*` paths with only `clyons@ajhcs.org`. Provision the reviewed application inputs `OPS_ACCESS_ISSUER` (exact `https://<team>.cloudflareaccess.com`, no trailing slash) and `OPS_ACCESS_AUDIENCE` (the application AUD tag, 64 lowercase hexadecimal characters). Both are required server-side configuration; they are intentionally absent from the default Wrangler config until the application/audience is verified. Missing or invalid configuration keeps Ops denied. Static Assets routing does not propagate `ctx.access`, so the Worker verifies the RS256 `Cf-Access-Jwt-Assertion` signature against issuer-derived public keys, issuer, audience, expiry, not-before, issued-at, application-token type, human subject and the fixed allowed email. Raw email headers, cookies and a supplied context do not authorize Ops; direct `workers.dev/ops`, foreign origins and POSTs without the exact canonical Origin remain denied. Public traffic is not placed behind whole-Worker Access by this change. The browser operations surface uses `/ops/api/*` and never receives `REVIEW_API_TOKEN`.
7. Qualify the exact candidate using the repository release gate, then deploy its verified source and retained assets with the locked Wrangler CLI and exact `BUILD_SHA`, following `docs/OPERATIONS.md`. Do not run `npm run deploy` after qualification because that convenience script rebuilds. The configured apex and `www` Custom Domains remain attached to the same Worker; no second Worker is created.
8. Operations, rollback, D1 Time Travel, alert thresholds, and the Cloudflare Bot skip-rule requirement are in `docs/OPERATIONS.md`.

### Private Ops JWT runtime qualification

The supported identity path follows [Cloudflare JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) and its [Static Assets context limitation](https://developers.cloudflare.com/workers/configuration/cloudflare-access/). Tokens are limited to 8 KiB. Public-key reads use only the configured issuer's `/cdn-cgi/access/certs`, omit credentials and reject redirects, and cap the full response at 64 KiB and three seconds. Public keys expire after five minutes; cold/refresh concurrency and failed attempts are denied with a 30-second attempt cooldown. Failures expose only the existing private 404 and never log tokens or provider bodies. No persistent service, public auth endpoint, key pinning or new credential is needed.

Tests use ephemeral signed RSA fixtures and mock key responses, including the actual Worker entry with ASSETS and no `ctx.access`. They do not verify a live Access policy/session or native browser readiness. Before release acceptance, verify real Cole-only session behavior on the canonical private paths, public pages/feeds, denied spoof/unauthenticated/workers.dev/Origin requests, and native tool lifecycle against served assets. Account-level empty inventory and zone-read 403 do not prove there is no Access application; resolve the exact issuer, application audience and path policy through an already-authorized owner session. Creating/changing an Access application or granting another identity remains a separately authorized operation.
