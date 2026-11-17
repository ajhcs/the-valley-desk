# Metadata-and-link pilot qualification

The exercised flow is `/discover` → search/filter/sort → inspect a dated source
record or repository citation → follow its original-source link. This is a finite
read-only metadata pilot, not the original automated admission system or a
validated regional roster. MP04 public release remains held.

## Implemented and independently exercised

The deterministic offline builder reconstructs fourteen distinct listings from
fourteen retained native metadata bodies: six GitHub repositories, six Crossref
publications and two ROR organizations. Two repository-to-publication citations
use a separately retained connector-derived observation. Exact hashes, provider
identity, semantic field paths and values bind the projection. No additional
source acquisition, full-text copy, database write or scheduler is involved.

The API and page require the exact `DISCOVERY_PILOT_ENABLED=true` flag. Production
configuration remains unchanged. Disabled routes do not read the catalog; HEAD,
trailing-slash paths, method rejection and unsupported query handling are tested.
The API allowlist omits raw captures, internal paths and private review fields.
Browser bundles contain schema/UI code without the source catalog or raw bodies.
The normal discovery test chain checks generated projection drift.

Sol's nineteen focused tests and the orchestrator's five assembled-routing tests
passed before integration. Astra independently passed fifteen Node probe groups,
twelve browser checks and four response-boundary cases. Terra's separate three
Node groups, source-pointer script and mobile affiliation check passed. These
counts overlap the integrated suite and are not summed as unique coverage.

## Rendered verification

The Browser plugin was absent. Existing Playwright 1.64.1 and Chromium headless
shell 1248 ran against the isolated loopback Worker at `127.0.0.1:4178`. Existing
workspace libraries supplied browser dependencies; no package baseline changed.
The orchestrator exercised desktop 1440×1100 and mobile 390×844, plus a
JavaScript-disabled context. Its final run passed twenty-six flow assertions.

| Check | Observed result |
| --- | --- |
| Identity / meaningful content / overlay | Correct research-directory title, fourteen cards, no framework overlay. |
| Search / URL / reload | Naqvi returns the expected publication; filters remain in the URL and survive reload. |
| Filter / order | Repository filter returns six; visible titles match API ordering. Unknown dates remain last in either direction. |
| Original-source journey | Two pinned repository citation evidence links; the selected DOI action navigates correctly under an intercepted destination. No actual article was fetched by that action. |
| Empty / invalid / unavailable | Unmatched search has an empty state, invalid filters return 400 with reset, and independent simulated API failure gives a bounded unavailable state. |
| Metadata honesty | Selected author labels, separate repository owners, publication-time affiliation qualifiers and unknown county/current-role distinctions remain visible. Terra verified Rockville and Philadelphia affiliations against their respective authors. |
| Safety | Independent hostile-title injection renders as text; invalid UTF-8, oversized responses, unsafe links and wrong content types are rejected. |
| Responsive / keyboard basics | No horizontal overflow at either exercised width; keyboard reaches the labeled controls. No claim of complete accessibility conformance. |
| No JavaScript | Server fallback retains original-source links and historical limitations. |
| Console / network | No uncaught app errors. The root run records its deliberate 400 probe; independent runs record blocked font requests and deliberate failure probes. |

The existing site shell requests Google Fonts. Root and Terra's initial visit
recorded that dependency; later independent browser contexts blocked it. These
font requests are not source-provider acquisition. Screenshots and browser
drivers are retained outside Git under the workspace build directory, with
hashes in the pilot receipt. Other browsers, broader assistive-technology testing,
production performance and actual source-link availability remain unqualified.
The existing large-main-bundle build warning remains.

## Findings and repairs

Astra reproduced an owner-ID/repository-ID substitution in the first builder.
The repaired builder requires provider-specific semantic field paths and native
identity/request consistency; permanent regressions reject identity, title, date
and author-path substitutions. Source-use links were corrected to GitHub's actual
API terms section. The affiliation heading and selected-author labels preserve
the narrower source meaning.

The root's first routing assertion expected exactly `noindex`, while the API
correctly returned the stronger `noindex, nofollow`; the assertion now tests the
required noindex token. Its first browser run exposed filter-label ambiguity;
explicit label/control bindings fixed it. The failed browser observation is
retained. Terra corrected a probe that mistook a permitted README evidence URL
for copied README text. Astra corrected an initial browser library-path failure
and retained a bundle probe that mistook shared schema code for catalog data. Harness
corrections are distinguished from the actual product defect.

## Acceptance and remaining work

Full regression results, the frozen runtime input manifest, source commit and
portable artifact hashes are recorded in the [pilot receipt](receipts/metadata-link-pilot.json)
after final qualification. Delivered-head CI is recorded on PR30 before handoff
completion. Local pilot acceptance does not accept WP14/WP16/WP30 or discharge
the original automated catalog's complete dependency/invalidation obligations.

The strict WP03 manifest remains empty and not frozen, with no human labels or
reviewer enrollment. Benchmark review proceeds independently; E01–E06 remain
unexecuted. Full-text, forum-body and other richer reuse remain optional and
source-specific. Before a public pilot release, review actual fields/use basis,
snapshot ages, correction/removal ownership, live configuration and rollback,
then obtain the separate release authorization. No deployment occurred.

## Completed full local run

Source commit `77fab963271407b32753fb0b7bcb407c1d72b885` passed 939 application, 146 Watch and
346 Discovery tests: **1,431 executed tests**, zero failures, skips or cancellations.
Seven mandatory PDF regressions, typecheck/build, local D1/scheduled smoke, online
audit (zero reported vulnerabilities) and secret scan passed. All 629 runtime
input hashes stayed unchanged through the run. The final rebuilt browser output
passed the same three assembled Worker/bundle checks and the same twenty-six
root browser assertions; these repeated checks are not additional coverage.
All 91 frozen handoff entries, three native model/contract files, source-material
index and empty benchmark manifest are unchanged. Delivered-head CI is tracked
on PR30 separately from this completed local qualification.
