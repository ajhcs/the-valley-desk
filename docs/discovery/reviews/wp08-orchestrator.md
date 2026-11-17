# WP08 orchestrator review

Status: accepted for local implementation after independent review and final
integrated qualification. The [WP08 receipt](../receipts/WP08.json) records the
exact candidate, evidence and limitations.
The accepted WP02/WP06/WP07 dependency receipts were checked before changes.
The WP07 accepted snapshot matched all 24 files at entry. Work remains in the
selected implementation checkout; deployment and live provider enrollment are held.

Sol owns the GitHub adapter and authored API-shaped fixtures. Terra independently
owns the acceptance tests and challenges actual local D1 behavior. A separate Sol
and Terra pair implemented and reviewed WP03's offline receipt-intake increment.
Root owns shared transport/collection amendments, test wiring and acceptance.

| Finding | Correction and evidence |
| --- | --- |
| A 403 rate-limit response was treated as authentication failure | EX11 recognizes explicit GitHub rate-limit headers and conservatively persists the longest reset/retry hold; plain403 and other providers retain their meanings. Terra retained the failed original transport run. |
| Pagination header was discarded, allowing false completion despite an unsafe next URL | Transport binds the observed Link value in finish_sha256. WP07 checks it before parser invocation and includes it in the scoped private receipt. Actual-D1 unsafe origin/path/query and forged metadata probes now fail without a page. |
| Body-derived source identity could contradict its enrolled path | Exact repository alias, account profile/type and inventory owner binding; baseline scope/config/parser/revision and raw/request hashes are checked. |
| Short search results contradicted total_count but could complete | Contradictory complete-search counts now fail; incomplete/over-cap/private results remain explicit gaps. |
| Stage/role distinctions needed preservation | Release IDs, tag+target SHA and commit SHA use distinct stages/versions; source dates keep their meaning. Contributor and author accounts remain accounts; personal author text remains unresolved. Bot suffix is allowed only for Bot type. |
| The generic transport sent no GitHub API headers | GitHub-only server headers use the existing product User-Agent, JSON media type and pinned API version; actual injected egress checks authenticated and unauthenticated requests. |
| New copied Link text needed removal ownership | Existing page scope removes the header payload; actual-D1 withdrawal check verifies it disappears and resolvePage fails. |

Terra's frozen final2 suite passed 25/25 tests, with eight source/test hashes
identical before and after. It covers all six ACs, creator-first profile/search/
inventory from empty local D1, actual raw/private-lead/page/checkpoint commits,
retained baseline gating, rate/backoff, header binding and scoped erasure. Strict
standalone typechecking uses existing workspace Node declarations; no dependency
was installed. Earlier failures and the corrected test-clock mismatch remain
retained. The actual replay/rollback/fencing regressions are additionally exercised
by unchanged WP06/WP07 tests in root's integrated run.

Rename/transfer verification compares numeric identity and new alias across
normalized bodies; public catalog alias materialization is intentionally absent
at this private acquisition stage. Profile links, license and role hints remain
recoverable from retained raw bytes and inspect provenance, rather than separately
admitted public records. WP14 must supply that bridge. The adapter never merges a
person or decides regional/healthcare relevance.

EX11 specializes the conditional-request design: this implementation uses
unconditional requests. No conditional validator is sent, and unsolicited304
fails without substituting arbitrary cached bytes. Same-endpoint ETag refresh
requires a separately qualified implementation. Full pages without a usable next
Link stay partial, including a full final page; this conservative limitation must
remain visible during provider qualification and coverage reporting.

The local implementation has synthetic capabilities, responses and access samples.
No actual provider access, rights, external reviewer identity, regional census,
semantic completeness or E01–E06 success follows. Four high dependency advisories
remain in the unchanged lockfile. The frozen systems model/interface/native receipt
and all migration files remain unchanged; no new native proof claim is made.
Root's final receipt records regression, build, smoke, secret scan and hash checks.

Final root qualification passed 1,235 tests (937 primary, 146 Watch, 152 discovery),
with zero failures, skips or cancellations. All 550 runtime/test/fixture/configuration
inputs matched before and after. Build, isolated local smoke and final secret scan
passed. This includes unchanged WP06 (21), WP07 (33), collector (6) and evaluation
(21) regressions on the amended runtime, plus the new GitHub (25) and receipt-intake
(17) cases. Counts overlap and are not additive. Frozen manifests checked 70 handoff
and 21 baseline entries without drift. WP03 preparation progresses, but its actual
manifest is still empty/blocked/not_frozen; WP14 cannot consume an accepted corpus.
