# GL05 independent search/HTTP/HTML review

Reviewed 2026-11-16 by Sol search reviewer. Scope: directory search module, read wrapper, API/HTML handlers, frozen query tasks and focused tests. No source HTTP, deployment, publication, source attestation or code edits performed. Source acceptance is separately owned by Sol overall/source reviewer.

## Findings requiring correction

1. **P2 — generated cursors exceed their own request limits.** A valid 200-character Unicode query can produce an `after` value exceeding 3000 characters and a URL exceeding the parser's 4096-character bound. Reproduction: set reviewed diagnostic snapshot titles to `界` repeated 200 times, request that query with limit 1, then parse the returned cursor with unchanged controls. The generated next request is rejected. Use a fixed-size query digest/opaque bounded cursor or reconcile generated cursor/request bounds. Private reproduction: `/workspace/build/builderbob/tvd-gl05-20261116/sol-search/challenge.mts`.

2. **P2 — declared long Rutgers alias is inconsistent between query and facet.** `DIRECTORY_SEARCH_ALIASES.institutions` and `institutionKey` declare `rutgers the state university of new jersey camden`, but free-text `terms` recognizes only short Rutgers-Camden/Rutgers University-Camden aliases. On the proposed six-work diagnostic snapshot, `Rutgers–Camden` returns SleepBoost paper and repository; `Rutgers, The State University of New Jersey, Camden` returns zero. Consume all declared aliases in free text and add a regression covering equivalence.

## Verification and limits

The explicit own-plus-one-neighbor plan construction prevents satisfying a conjunction across two neighbors. Facet plan enumeration retains the other controls and only collects values reachable on an eligible single relation. An independent rerun oracle checked 127 facet counts across seven queries and repository/publication/all kind controls against applying each facet value as a filter: all agreed. Directional relation IDs/from/to/predicate and claim/evidence IDs survive into API reasons; related evidence remains separately counted. HTML escapes input and displays directional citation text without promoting a publication affiliation into repository ownership.

Focused command: `node --experimental-global-webcrypto --import tsx/esm --test test/discovery-directory-search.test.ts test/discovery-directory-gl05-tasks.test.ts test/discovery-directory-gl05-http.test.ts`. Current result: 13 pass, 1 fail. Failure is the HTML pagination assertion against the still-two-work public GL04 catalog (Camden limit 1 has no next page). The proposed six-work task fixture passes; this does not establish that the actual public six-work generation passes HTTP tests. Re-run all focused checks after generation and corrections. Node in this shell is 18.19.1; initial invocation without global Web Crypto failed and is not used as acceptance evidence.

Initial status: **not accepted pending corrections and actual-generation HTTP verification**.

## Correction re-review

Both findings are resolved in the exact files below. `terms` now consumes the declared long Rutgers alias before shorter variants. The cursor now holds a SHA-256 digest of all normalized query controls alongside the complete snapshot digest and alias revision; parser bounds accommodate the emitted cursor. Inspection confirms cursor mismatch still produces restart and the content digest still binds the entire validated snapshot.

Qualified runtime: `.discovery-work/wp12/run.sh node --version` reports **v22.23.2**. Running that wrapper with `--import tsx/esm --test` and the three focused files above passes **18/18**, including actual public catalog API/HTML form, empty/error, reset and pagination tests, plus the new maximum-Unicode query/institution cases. These results supersede the earlier Node18 diagnostic result while preserving it as investigation history.

Independent repetitions used the generated six-work public catalog, not the proposed source-selection fixture. Both original Rutgers queries now return the same two SleepBoost works. The original 200-character Unicode reproduction emits a 225-character cursor and 2074-character URL query accepted by the parser. An independently repeated 127-case facet apply-filter oracle passes against the actual generated catalog. Reproduction files are `challenge-actual.mts` and `facets-actual.mts` under the private `/workspace/build/builderbob/tvd-gl05-20261116/sol-search/` directory. No remaining search/HTTP/HTML blocker found within this review scope. This is bounded local acceptance, not source acceptance, deployment or broader GL10 qualification.

Exact SHA-256 file bindings:

- `src/ingest/discovery-directory-search.ts`: `afc88a37d4681c57969ab6c57109576e8de8b2eb8b2c359b56cf220e91f271fe`
- `src/ingest/discovery-directory-page.ts`: `12e542af0ecaf7541a3c2ef50fcebb4c667c9d9a7c05daf2c3ecadcc21dfbe72`
- `src/ingest/discovery-directory-http.ts`: `81cb088e18f0bc961ea3ae56bf07ebc5cfc83d3cbb5c9235b8ec44d4ed92a38c`
- `src/ingest/discovery-directory.ts`: `a9306c1d1b982bd85ac79aed2e75c693e3e810007149f342372515f134f297b2`
- `src/content/discovery-directory-catalog.json`: `9c5f02be7e090a456042edeea2f99166d1f3992a218dcd8f00e48981fa54834f`
- `test/discovery-directory-search.test.ts`: `cafa2e062bbe83e4e84ecd0687d10ed0c0e701d79f4b7fb0e940998b86db9414`
- `test/discovery-directory-gl05-http.test.ts`: `6c752999e751b484de44885c12072305b0e25e85aea29dbb665e9b592172e6e3`
- `test/discovery-directory-gl05-tasks.test.ts`: `4b3b1b80e7640dd5cdc70760d00a40c4f06ac00b780cf1993ce7f36e8705a07e`
- `docs/discovery/go-live/evidence/GL05/query-tasks.json`: `7a81c2bf9d3393d1faff8edaf5e30f746e303585b2bdae6857df9ceb871ab5a0`

Final search/HTTP/HTML review status: **accepted for the exact local files and six-work generation above**.
