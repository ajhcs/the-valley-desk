# Watch Routing Readiness

## Scope and Gate

This package implements the bounded W11 page-delivery layer for the W09 Watch
directories and dossiers. It is not approval to publish Watch content or enable
the feature. No source collection, production database access, model call,
deployment, navigation migration, or change to Voices is included.

The Worker uses the same exact `WATCH_PUBLIC_ENABLED === "true"` switch as the
Watch API. Unset, differently cased, padded, boolean, or false values do not
enable pages. Disabled pages return 404 without a Watch database read. The
existing disabled API retains its 503 `watch-not-enabled` response.

| Request | Page Response |
| --- | --- |
| Enabled accepted directory or dossier | 200, noindex, no-store |
| Disabled Watch page | 404, noindex, no-store; no Watch data read |
| Malformed/reserved dossier slug or unpublished subject | 404 |
| Invalid, duplicate, reserved, cross-desk or unknown query field | 400 |
| Changed required evidence / delivery hold | 409; no old current facts |
| Expired directory cursor | 410; restart link drops cursor |
| Missing/unavailable D1 or invalid public DTO response | 503, not an empty 200 |
| Enabled page with non-read method | 405, `Allow: GET, HEAD` |

All Watch page statuses carry HTML content type, `Cache-Control: no-store`,
`CDN-Cache-Control: no-store`, and `X-Robots-Tag: noindex`. HEAD computes the same
accepted read result and metadata as GET, then the existing outer Worker strips
the body. Asset-shell errors preserve an existing error status; an otherwise
successful read becomes 503 with a visible minimal error page.

## Ownership and Data Flow

```text
GET/HEAD /{policy|technology}-watch[/{canonical-slug}]
  -> parseWatchPageRoute (shared strict query grammar)
  -> exact public gate and read-method check
  -> in-process handleWatchRead(GET fixed API path)
  -> bounded decodeWatchResponse + strict evidence/identity binding
  -> WatchPageResult
  -> escaped Watch head + bounded noscript representation
```

Public page slugs are literal lower-case canonical slugs, at most 100 characters;
`updates` is reserved. Dossiers accept no page query fields. Their internal API
lookup always uses `?lookup=slug`; it never retries a slug as an ID or scans a
directory. Private `/ops` paths do not enter this public route classifier.

The internal reader receives a newly constructed same-origin GET request with
only the JSON Accept header. It does not forward reader credentials, fetch an
arbitrary URL, or contact any source URL. Rendering uses the same strict public
response decoder as the browser, extracted to `src/content/watch-response.ts`;
the existing UI module re-exports its previous public imports.

Watch remains separate from `ContentItem`, the v1 catalog, article JSON-LD,
published feed, and sitemap. No synthetic Watch data ships in application code.
Directory canonicals are the base directory; accepted dossier canonicals are
their stable path. All remain noindex until source qualification is complete.
Pagination links retain validated filters and opaque cursors.

## Rendering and Metadata

The noscript view contains accepted titles, context, separate policy lifecycle
and legal-effect states, interpretation readiness, technology workflow/setup,
verified current or historical locality, artifact-specific license scopes, and
source links. Dossier quotes are rendered literally with HTML escaping, not
truncated or synthesized. Directory context previews are capped at 800
characters, with selected source links prioritized for the displayed context.
DTO byte and collection bounds limit the representation; source URLs are never
rendered as executable markup. Replacement callbacks preserve literal dollar
substitution sequences in source text.

`asOf` is the published projection time, not upstream source-check freshness.
Source freshness is explicitly unreported. Only an exact successful
`X-Watch-Data-State: stale` header labels an accepted fallback. A canonical
`X-Watch-Delivery-As-Of` instant is forwarded as delivery evidence, not promoted
to source freshness.

The browser metadata store is advisory and stores only route keys and head
fields, not source records or persisted facts. `useSyncExternalStore` connects
DocumentHead to the existing Watch request lifecycle; it adds no duplicate API
fetch. Each request has an identity token. Starting a new route/retry clears
old head facts; held, unavailable, and missing responses replace them with
curated errors. Late responses and cleanup for an older token cannot replace
the active route. Exact pathname/search keys prevent cross-filter reuse.

## Separate Legacy Policy Background Gate

The inherited `/policy` page and `/api/policy-watchlist` are not Watch v2. They
now require their own exact `POLICY_BACKGROUND_PUBLIC_ENABLED === "true"`
setting. No flag is activated in configuration. While disabled, the page is
404/noindex/no-store before any D1 or feed read; the API is
503/noindex/no-store with `policy-background-not-enabled`. Enabled API methods
remain GET/HEAD only. Private evidence/review routes are unchanged.

Every Worker-rendered shell receives a nonce-bound, allowlisted boolean
`__VALLEY_DESK_PUBLIC_FEATURES__` signal. It contains no credentials or private
settings. The browser defaults to false, removes the footer link, and renders
the existing NotFound component without mounting the baseline's data-fetching
component. Client display state cannot authorize an API read. Hidden-page
metadata and noscript content remain NotFound through navigation and reload.

## Verification

Focused test command:

```sh
node --import tsx/esm --test --test-concurrency=1 \
  test/watch-routing.test.ts test/watch-ui-contracts.test.ts \
  test/watch-persistence.test.ts test/watch-delivery.test.ts \
  test/watch-d1.test.ts test/news-event-crawler.test.ts
```

The final integrated command passed 97 tests at 13:45 UTC on 2026-09-12, with
no failures or skips. Delivery source prerequisite
`9110f23ae810d096c590d63b35f196c164e1388b` was cherry-picked separately as
`368812a449a0f4dae45c39f831bf201d1ced499d` before the routing commit. Earlier
independent query-contract/Cloudflare-ops regression checks passed 181 tests.
The changed legacy baseline HTTP test also passed using retained fixtures;
full PDF extraction is not part of that focused HTTP check.

The final typecheck/build passed at 13:46 UTC. The main bundle is 582.23 KB
(169.97 KB gzip), with the existing >500 KB advisory; this package does not
change build thresholds or dependency versions. The root release candidate
must rerun its full gate with its newer locked Wrangler dependency.

The routing tests exercise the real Worker entrypoint, actual local SQLite
migrations, server-compiled manifests, accepted projection reads, and the
shared decoder. The combined suite also runs real Miniflare local D1. Synthetic
fixtures live only under `test/`. HTTP statuses, disabled/private no-read
behavior, empty versus unavailable, cursor expiry, literal source escaping,
unknown setup fields, GET/HEAD parity, and metadata token races are covered.
Current definition changes remove prior policy meaning from actual Worker
HTML while preserving valid metadata. A required title dependency change
returns 409 without the prior title. Expired current locality holds the detail
and removes directory membership, without rewriting it as historical. Changed
code-license evidence removes OSS-filter membership and license claims from
the dossier. Failed/oversized transport streams are closed, and chunked UTF-8
is decoded without changing literal source text.

Browser QA is separate evidence, not proof of live source qualification or
Worker database behavior. It used the local built app with intercepted
synthetic public DTOs and blocked external requests:

- Script: `/mnt/d/tmp/plumbob/tvd-watch-routing-qa.mjs`.
- Receipt: `/mnt/d/tmp/plumbob/tvd-watch-routing-qa-20260912/report.json`.
- 15 checks, 9 screenshots, zero unexpected browser errors.
- Policy/Technology directories and dossiers at 320px and 1440px: correct
  title/canonical/noindex, no horizontal overflow, one API request per view.
- Held/unavailable/not-found transitions, retry, reload, delayed response with
  back/forward, invalid raw reserved query, and reserved `updates` slug passed.
- Browser and loopback preview on port 4189 stopped after verification.
- This metadata-only run makes no zoom claim. The separate W09 receipt contains
  the genuine 200% browser-zoom checks for the unchanged UI layout.

Additional public-background gate QA at 13:32 UTC used the rebuilt local app,
intercepted synthetic empty-baseline responses, and blocked external requests:

- Script: `/mnt/d/tmp/plumbob/tvd-policy-public-gate-qa.mjs`.
- Receipt: `/mnt/d/tmp/plumbob/tvd-policy-public-gate-qa-20260912/report.json`.
- Eight checks/four screenshots at 320px and 1440px, zero browser errors.
- Disabled `/policy`, footer-to-News navigation, back and reload: zero baseline
  API requests, footer link absent, NotFound title/content and noindex intact.
- Explicitly enabled display retained the baseline and footer link, with one
  initial request. The inherited baseline component made additional read-only
  requests on remount (four total across load/navigation/back/reload); no
  single-fetch guarantee is claimed for that legacy component.
- No overflow or framework overlay. Browser and preview on port 4189 stopped.
- These intercepted browser results supplement, not replace, real Worker
  gate/no-read/status tests. They do not establish real PDF/source qualification.

## Remaining Release Work

Real source qualification, production D1 migration/rollout, Watch baseline
population, and enablement are
release gates, not implied by these local checks. Latest/updates, hearings and
deadlines, representatives, primary navigation and home previews remain separate
packages. All-day/calendar/subscription support remains pending W10 work.
Independent combined browser/Worker/local D1 verification and the exact release
gate remain root integration responsibilities. Public Watch and legacy policy
background flags remain unset; private PDF qualification remains open.

The request/binding/streaming design follows the retrieved
[Cloudflare Workers best-practices reference](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).
No platform configuration or runtime compatibility date changed in this package.
