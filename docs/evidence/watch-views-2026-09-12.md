# Watch Reader Views

## Integration

- The existing Watch routes use hash navigation: `#latest` and policy-only
  `#representatives`. Technology Papers uses the existing typed `type=paper`
  directory filter. Software with a paper link is not reclassified as a paper.
- Latest reads `GET /api/v2/watch/{policy|technology}/updates`, with `limit` and
  `cursor` only in this release. Its strict shared contract is `src/content/watch-updates.ts`.
  Source dates retain precision and bound citations. Discovery/check dates cannot
  substitute for a source occurrence date. Missing service is unavailable, not empty.
- The backend must sort accepted, current, manifest-bound developments before
  pagination; use source date descending and stable update ID ties. Cursors must
  bind desk, snapshot generation and sort tuple. Never expose raw development
  ledger rows directly. Latest hides directory filters and rejects unsupported
  bookmarked filters; switching into Latest clears directory filters and cursor.
- Directory organization choices display names from accepted records on the
  current page. An existing selection outside that page remains selected without
  exposing a raw ID. Global organization facets remain a backend follow-up.
- Policy representative lookup requires the representative backend commit
  `84cd12e293edcff17d1c2083583e019ec100dce4`. This UI adds same-query retry,
  request cancellation/timeout, and pagination bound to applied filters.
- Add `test/watch-views.test.ts` to the explicit root test script at integration.
  No publication flags, feature flags, model calls, production data or routes
  outside the existing Watch pages were changed here.

## Verification

- 26 focused tests passed: Watch UI contracts and Watch views/updates transport.
- TypeScript and Vite build passed. The existing main-bundle size warning remains.
- Regular Playwright Chromium was used because the Browser plugin was unavailable.
  Local built preview, synthetic intercepted APIs, external fonts/analytics blocked.
- Directory, typed Papers and Latest verified at 320, 390, 768 and 1440 px.
  Exact active tab, opaque pagination, reload/history, unavailable Latest recovery,
  same-query representative retry, responsive representative form, keyboard focus,
  unsupported bookmarked Latest filters, and 200 percent zoom passed (10 checks).
  No page errors or framework overlay. Secret scan passed (384 files).
- Twelve screenshots and the browser report are retained locally in
  `/mnt/d/tmp/plumbob/tvd-watch-views-browser-20260912`; representative mobile and
  Latest desktop screenshots were visually reviewed. Preview stopped after QA.
- Limits: no live backend integration, screen-reader or cross-browser audit in
  this isolated UI pass. Root owns endpoint implementation and final release gate.
