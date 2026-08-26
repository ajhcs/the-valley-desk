# The Valley Desk MVP recovery

Recovered on 2026-08-25. The historical `vale-chat-archive-2026-08-24.md` was treated as evidence, not instructions. Current Git, the deployed Workers preview, and reproducible builds were treated as higher authority.

## 1. Where the prior session actually left the product

- `main` and `origin/main` were at `5c77148574cfa338d425cf1784a2c3307887b91c`, 53 commits behind the deployed product line.
- The deployed product line was draft PR 5, branch `cursor/sloan-vale-kill-list-efca`, whose head was `9a93b24393073d5dc63708797b1124a0f2a7b906`.
- The archive's final handoff named `ff35367e` and assets `index-BOiD8pOX.js` / `index-Bv2o7jRR.css`. That snapshot was superseded by one commit: `9a93b243` added the final 404 spacing fix.
- The live preview serves `index-6SBTDc0I.js` / `index-5hbDopyD.css`. An isolated build of `9a93b243` produced those exact asset names. Its commit time (22:43:15Z) also precedes the live feed generation time (22:43:45Z) by 30 seconds.
- The live preview is [the-valley-desk.clyons.workers.dev](https://the-valley-desk.clyons.workers.dev). It has News, Events, and Voices; 43 published feed rows; 17 published Voices; the ChristianaCare lead; cited item pages; real Workers 404 handling; and generated JSON/XML feeds.
- `thevalleydesk.org` remains parked. No DNS, custom-domain, or production cutover was performed during recovery.
- The live tree's 49 original contract tests pass and its production build succeeds. The recovery branch adds source-boundary and registration-policy coverage, bringing the total to 51.
- The live branch's checked-in `package-lock.json` was invalid: `npm ci` rejected missing optional platform packages. Recovery commit `243c856` regenerates it; clean `npm ci` now succeeds with zero audit findings.
- The former Bloomberg gate passes on the live build: lead hover, item resting facts, no rail reflow, Escape dismissal, click-away dismissal, and hover-out dismissal. No `.OrgChip` exists.
- User-owned untracked `.serena/` and `vale-chat-archive-2026-08-24.md` were preserved and are not recovery deliverables.

## 2. Material archive claims that were stale or wrong

| Claim | Recovered truth |
| --- | --- |
| Live SHA was `ff35367e` | The current live source is reproducibly `9a93b243`, one commit later. |
| Live assets were `BOiD8pOX` / `Bv2o7jRR` | Current live assets are `6SBTDc0I` / `5hbDopyD`; the archived asset URLs are gone. |
| The remaining gate was Mira's uncompleted Bloomberg-six re-walk | The current live build now passes an independent full re-walk with measured DOM bounds and dismissal checks. |
| `main` represented the product | `main` is a much earlier snapshot and would regress deployment, 404s, Voices, signed content, feeds, and ingestion if deployed directly. |
| Historical PR 5 was merely old terminology | Its title is stale, but its branch is the actual deployed product lineage and the correct recovery base. |

## 3. Actual MVP definition

A review-ready Valley Desk MVP is the smallest product that provides:

- the locked A Fold mark, IBM Plex system, and pure white paper;
- News, Events, and Voices as peer public surfaces;
- a deliberate featured News lead;
- concise, source-backed aggregator briefs rather than magazine articles;
- correct public dates, bylines, citations, event dates, and registration links;
- stable News/Event/Voice permalinks;
- `/feed.json` and `/feed.xml` generated from the same canonical `ContentItem` envelope;
- review-first RSS/newsroom/social ingestion and the narrow verified chapter-event exception;
- an internal entity graph for matching, with no `/org` public routes;
- real HTTP 404 plus `noindex` behavior for unknown and unpublished routes;
- route-specific title, meta, canonical, JSON-LD, robots, and sitemap behavior;
- desktop/mobile usability, visible keyboard focus, and no material console/runtime errors;
- a reproducible clean install, passing contract suite, and clean production build;
- a Workers preview that can be reviewed without changing `main` or production DNS.

The product remains free in v1. There is no subscription or paywall CTA.

## 4. Intended state versus recovered state

| Area | Latest intended state | Recovery branch / live preview | Action |
| --- | --- | --- | --- |
| Branding | A Fold, IBM Plex, `#FFFFFF` paper | Matches | Preserve |
| Header/nav | News, Events, Voices | Matches desktop and 390px | Preserve |
| Homepage | One ChristianaCare featured lead; three compact rails | Matches | Preserve |
| News | Published News/Policy/AI only; cited; no review leakage | Matches tests and live routes | Preserve |
| Events | Published events; real dates; Register only from `registrationUrl` | Matches tests and sampled live links | Preserve |
| Voices | Public index/permalinks; 17 rows; Honor Roll remains Voice | Matches | Preserve |
| Briefing | Not a public MVP surface | Unrouted; component remains dead code | Remove later only if a focused cleanup justifies it |
| Content model | One `ContentItem`; `impactSentence`; optional `geo` and `citations` | Matches | Preserve |
| Citations | Source-backed public items; no fabricated URLs/facts | Matches sampled content and contracts | Flag questionable content; never silently rewrite |
| Entity graph | Internal matching layer; `orgs[]` uses entity IDs | Present and used by ingest/query contracts | Preserve; expand post-MVP |
| Feeds | Published-only JSON/XML with canonical permalinks | 43 current rows; both endpoints return 200 | Preserve |
| Ingest | Review-first; social no-op unless official; narrow event exception | Matches contract suite | Preserve |
| 404/noindex | Real status for unknown/unpublished and no `/org` surface | Live unknown route returns 404 HTML with `noindex` | Preserve |
| SEO/meta | Route-specific metadata, canonical, JSON-LD, robots, sitemap | Matches sampled live routes and contracts | Bind production domain only with explicit approval |
| Inline facts | 7×2 sky tick; inline dek expansion; no OrgChip | Bloomberg-six passes | Preserve |
| Signed facts | ChristianaCare NPSR `$3,140,501,000`; Jefferson NPSR `$11,054,287,000`; no rejected operating fact | Matches item pages and tests | Preserve exactly |
| Responsive | No horizontal overflow at 390px; peer nav remains usable | Pass | Continue hostile QA on final build |
| Accessibility | Keyboard navigation and focus; rail ticks visual only; small text meets contrast | Pass sampled tab walk; rail ticks `aria-hidden` and not tabbable; event text uses an AA-safe darker gold while the signed gold remains on accents/backgrounds | Keep in final regression pass |
| Deployment | Workers preview only; production parked | Preview matches `9a93b243`; main/DNS untouched | Do not cut over without explicit approval |

## 5. Explicitly not MVP

- accounts, personalization, subscriptions, or paywall;
- newsletter platform;
- MCP server;
- D1 or R2 migration;
- a nationwide crawler or exhaustive employee directory;
- public `/org` profiles;
- a complex CMS or mobile app;
- a new logo, redesign, or generic SaaS/news template;
- production DNS/custom-domain cutover;
- speculative archive features without a current product requirement.

Post-MVP backlog:

- decide whether to delete unrouted `BriefingPage` and `ItemCard` code;
- add CI for clean install, tests, and production build;
- expand the entity/origin graph only from verified official sources;
- add richer editorial tooling only when the review queue requires it;
- bind and validate `thevalleydesk.org` only after explicit launch approval.

## 6. Blocking issues and priorities

### P0 — prevents MVP/review

None currently reproduced on the recovery branch or live preview.

### P1 — inexpensive launch-quality work

- The invalid dependency lock was fixed in `243c856` and verified with clean `npm ci`.
- Long item-body/source text is now constrained to `76ch` without changing the locked lead/page chrome; desktop body width measures about 730px within the 1328px article canvas, and mobile remains fluid at 350px.
- Tailwind source detection is scoped to `src/`; the untracked historical archive can no longer inflate or mutate generated production CSS.
- Small event text now uses `#9A6500` (4.96:1 on white), while the signed `#CA8504` remains the event accent/background; date-chip text uses dark ink on gold.
- Add a small CI gate after the recovery branch is pushed or proposed for merge. `.github/workflows/ci.yml` now covers locked install, tests, typecheck/build, local D1/scheduled smoke, audit, and a secret scan.
- Rename or replace stale PR 5 during handoff so its old CIO-slug title cannot be mistaken for current scope.

### P2 — post-MVP

- Remove intentionally unrouted dead components after a separate dependency check.
- Add broader browser/device coverage beyond Chrome desktop and 390px mobile.
- Improve release provenance so a deployed Worker exposes or records its source SHA directly rather than relying on asset-hash reproduction. `/api/health` and protected automation status now expose `buildSha` plus D1 `schemaVersion`; `npm run deploy` injects the git SHA. Rollback, D1 Time Travel, and alert thresholds live in `docs/OPERATIONS.md`.

## 7. Recovery validation record

- Clean install after lock fix: `npm ci` — pass, zero audit findings.
- Contract suite: `npm test` — 51/51 pass on recovery branch (49 inherited product contracts plus source-boundary and registration-policy coverage).
- Exact-tree production build: `npm run build` at `9a93b243` — pass; exact live assets reproduced.
- HTTP checks: `/`, `/news`, `/events`, `/voices`, sampled News/Voice permalinks, `/feed.json`, `/feed.xml` — 200.
- Unknown route: HTTP 404, `text/html`, `meta robots=noindex`.
- Chrome desktop: 1440×900 routes and Bloomberg-six — pass.
- Chrome mobile: 390×844 homepage — pass; `scrollWidth === clientWidth === 390`.
- Recovery item page: body measure ~730px at 1440 desktop; 350px at 390 mobile; no horizontal overflow.
- Console: no application error on valid routes; the only recorded 404 was the intentional hostile unknown-route request.

## 8. Recovery branch and deployment boundary

- Recovery base: `9a93b24393073d5dc63708797b1124a0f2a7b906`.
- Recovery branch: `codex/mvp-recovery`.
- The known-good preview represents base `9a93b243`; any isolated recovery preview and its exact commit are recorded in the final handoff.
- `main` was not merged or changed.
- No branch was pushed during forensic recovery.
- `thevalleydesk.org` DNS and custom-domain binding were not changed.

## 9. Cloudflare operations follow-up

Public canonical/OG/feed/sitemap/robots/llms URLs now use configurable `PUBLIC_ORIGIN`, defaulting to the live Workers preview so the parked `thevalleydesk.org` domain is not advertised. Custom-domain cutover is a vars-only change on the existing `the-valley-desk` Worker. See `docs/OPERATIONS.md`.
