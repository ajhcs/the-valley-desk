# The Valley Desk

Product source. Human news + agent feed. Delaware Valley / Greater Philadelphia healthcare technology.

Owner: Cole Lyons (co-founder). Engineering: Knox. Product: Reed. Brand: Mira. CEO: Vale.

Vite + React + TypeScript + TanStack Router + Tailwind on Cloudflare Workers. Humans get News, Events, Voices, a local-product watch, and an anti-FOMO event calendar. Agents GET `/feed.json` using the same `ContentItem` envelope. Signed editorial source: `fixtures/catalog.json`.

## Automation

One production Worker runs an hourly freshness lane and a daily deep-scan lane. The hourly lane fetches newsroom RSS and configured social sources; the daily lane adds official chapter and broader Events discovery. Both write every raw candidate to D1 before any model call. Muse Spark 1.2 Contributor (`meta/muse-spark-1.2-contributor`) classifies and grounds a small budget of relevant candidates through OpenRouter's OpenAI-compatible API. Deterministic rules—not the model—make the final publication decision.

The same locked hourly run seeds the 16-system executive coverage registry and performs bounded checks against enabled first-party leadership sources. Every canonical system has an explicit active or degraded official-source posture; transitional, partial, and PDF evidence is retained as metadata without being used to infer departures. LinkedIn inventory is reusable for identity context but is never fetched. Complete, non-hostile snapshots produce protected observations. Additions and title changes are applied automatically only after two consecutive daily snapshots or two independent registered official sources; departures additionally require two consecutive complete snapshots from independent official sources. Conflicts and incomplete evidence remain unresolved. Verified changes emit review-status editorial candidates; they never publish directly. The observation endpoint is for diagnostics and explicit override only.

The automatic editor-in-chief publishes official future chapter events when their official source and attendance link validate without model calls. Other events and news go through a freshness-first scheduler: deterministic priority ordering prefers critical materiality → first-party origin → age under 24 h → age under 72 h → event/executive-change → secondary corroboration → old backlog, with a bounded budget (default 4, concurrency 2, deadline 110 s). Fresh work never loses the final slot to stale backlog, including when the fresh row is a retry. Every run merges a bounded, durable D1 review backlog with the current snapshot and deduplicates by canonical source identity. News requires a named local health system, first-party corroboration, a material operating/technology change, literal evidence spans, and impact/body copy that is verbatim-supported by the source; cited context must likewise be verbatim-supported by verified prior coverage. A structured claim-ledger maps atomic claims (names/numbers/dates/roles) to evidence spans/source/context IDs with exact-match enforcement, while source text remains untrusted. High-risk news classes (financial, policy/regulatory, security/safety/outage, executive change) pass through a second independent verification that fails closed and never adds facts; it returns structured objections/approval. Unsupported paraphrase, unverified claims, instruction-like source text, or model-written claims stay in review. A model failure, timeout, or skipped budget slot leaves news in review; it never blocks rule-confirmed official events. Unchanged successful enrichments are reused. Unchanged failures cool down with exponential backoff instead of retrying every hour. A changed content fingerprint clears stale enrichment/claims/verification and becomes eligible again immediately; `first_seen_at` is preserved while `last_seen_at` advances monotonically (`0014` adds content-change and verification persistence).

Allowlisted HTTPS article pages are fetched after RSS discovery. JSON-LD `articleBody` wins, then `article`/`main`. Normalized text is cached in D1 by URL (`0011`); successes refresh after 7 days, while `failed`/`no-content` cool down from 6 hours with exponential backoff capped at 7 days. A failed refresh keeps the last successful body so the full article never regresses to the RSS snippet. Raw HTML is never stored. The candidate cap is round-robin across sources; exact-host HTTPS, redirects, size, time, and concurrency bounds stay closed.

Every source check records a specific outcome—healthy, healthy-empty, disabled, misconfigured, auth-failed, rate-limited, upstream-failed, parser-failed, or timed-out—plus item count, last success, and consecutive failures. The hourly and daily lanes share a durable lock, source state, alert fingerprints, and recovery counters, so a retry or Worker isolate cannot duplicate notifications or erase an incident. An automatically published event is withdrawn only after two healthy, complete checks of its authoritative source omit it. Timeouts, HTTP failures, empty snapshots, parser-shape changes, catastrophic count drops, partial feeds, and rolling RSS windows never trigger disappearance withdrawal. Explicit cancellations stay on the permalink as cancelled and drop off upcoming; completed events keep their URLs. Missing social tokens and unsupported person accounts are recorded as misconfigured rather than empty success.

Approved content is written to `published_content`. The Worker merges that D1 overlay into the bundled signed catalog for HTML, dynamic permalinks, `/feed.json`, `/api/content`, `/feed.xml`, and `/sitemap.xml`. If D1 is unavailable, the bundled catalog remains a complete fallback. Automated rows cannot replace editorial rows or set the featured lead.

Product news is admitted to model review only when `fixtures/product-watch.json` verifies that a named regional health system uses the mentioned product. Generic vendor marketing and unverified local-use claims stay out.

Public URL generation uses `PUBLIC_ORIGIN=https://thevalleydesk.org`. The same Worker remains available on its workers.dev hostname for operational fallback; `www.thevalleydesk.org` redirects to the apex. See `docs/OPERATIONS.md`.

### Local verification

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

Machine review/status routes require `Authorization: Bearer $REVIEW_API_TOKEN`; `/ops` and `/ops/api/*` use Cloudflare Access context instead. A valid approval publishes immediately through the same dynamic content layer. `HEAD` is supported on public machine routes and private GET APIs. GitHub Actions runs locked install, tests, typecheck/build, local D1/scheduled smoke, `npm audit`, and a secret scan without production secrets.

### Cloudflare provisioning

1. Create the single D1 database: `wrangler d1 create the-valley-desk`.
2. If Wrangler does not provision the binding automatically, add the returned `database_id` to the root D1 entry in `wrangler.jsonc`.
3. Apply migrations remotely: `wrangler d1 migrations apply the-valley-desk --remote`.
4. Add secrets with `wrangler secret put REVIEW_API_TOKEN` and `wrangler secret put OPENROUTER_API_KEY`. These are separate credentials: `REVIEW_API_TOKEN` authorizes machine review operations and `OPENROUTER_API_KEY` authorizes model spending. Neither belongs in Git, browser code, or `wrangler.jsonc`.
5. `EDITOR_MODEL` is pinned to `meta/muse-spark-1.2-contributor`; `EDITOR_MODEL_BASE_URL` defaults to `https://openrouter.ai/api/v1`. There is no automatic fallback to standard Muse. Contributor requires OpenRouter Settings → Privacy to allow routing to providers that may train on prompts; any account or guardrail Zero Data Retention enforcement for non-frontier models must also be disabled for this key. If those policies block the endpoint, OpenRouter returns HTTP 404 and the item cools down in review while deterministic official-event publication continues. Muse is a reasoning model: calls request low reasoning effort, keep a 4,096-token shared reasoning/output budget, request `json_object`, and extract JSON from fences/whitespace without loosening Zod or evidence checks. Each scheduled invocation attempts at most `EDITOR_MODEL_BUDGET` (default 4) eligible items with `EDITOR_MODEL_CONCURRENCY` (default 2). Calls time out after `EDITOR_MODEL_TIMEOUT_MS` (default 45s) and the model stage stops starting new work after `EDITOR_MODEL_DEADLINE_MS` (default 110s), allowing two bounded waves plus cleanup inside Worker `waitUntil`. Set `EDITOR_MODEL_BUDGET=0` to disable model calls without stopping official-event publication. A 100-item backfill therefore progresses across hourly runs instead of trying every candidate in one invocation.
6. Keep the machine review/status routes undiscoverable and bearer-token protected. Configure Cloudflare Access for `thevalleydesk.org/ops*` with only `clyons@ajhcs.org`; the Worker also requires `ctx.access`, so direct `workers.dev/ops` requests remain denied. The browser operations surface uses `/ops/api/*` and never receives `REVIEW_API_TOKEN`.
7. Run `npm run deploy` to update the one existing `the-valley-desk` Worker with the current git SHA as `BUILD_SHA`. The configured apex and `www` Custom Domains are attached to that same Worker; no second Worker is created.
8. Operations, rollback, D1 Time Travel, alert thresholds, and the Cloudflare Bot skip-rule requirement are in `docs/OPERATIONS.md`.
