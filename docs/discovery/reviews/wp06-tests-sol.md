# WP06 independent acceptance tests — Sol

Independent acceptance tests completed on the corrected frozen identity candidate; root owns package acceptance and wiring. Registry/runtime contracts/adapter/migration 0043 belong to the lead, endpoint/transport to Terra, and adversarial implementation review to Astra. Sol owns only `test/discovery-transport.test.ts`, this review and `.discovery-work/wp06-tests-sol/`. No implementation file was changed by this test role.

The six WP06 acceptance criteria, accepted WP02/WP05 interfaces and EX08/EX09 determine this matrix. The design note's earlier finite pre-enrolled URL restriction is superseded by source-response material scopes, actual issued requests and provisional provenance. Fixtures do not invent an artifact/original-work ID to authorize first acquisition. They create no public admission or actual provider qualification.

## Test scope and matrix

The fixture starts pending, authorizes bounded sampling, leases and issues a request, acquires bytes through closed injected egress, and uses the registry's safe evidence factory to retain the actual received body. Only then does it record a qualification and separately activate collection. Access/display references are reviewed synthetic policy metadata; explicit scoped permission and affirmative retention/transform grants independently gate acquisition. Real source rights and human authentication remain unqualified.

| Criterion | Executed test contract |
| --- | --- |
| AC01 | Actual D1 parser/configuration head changes and exact rights expiry reject activation/new collection; request budget stays unchanged. Synthetic rejection outcomes are retained. |
| AC02 | Missing/expired/wrong-origin credential bindings, absent resolver, throwing resolver and getter fail before egress; missing egress also sends nothing. Results and durable data exclude dependency error and credential canaries. |
| AC03 | An actually retained first page plus an explicitly synthetic persisted trusted receipt authorizes a distinct second-page issuance. Missing receipt resolver, fabricated parent, changed query, URL-valued token, unknown/duplicate parameters are denied before an unauthorized call. |
| AC04 | Cross-origin, private IPv4, loopback IPv6 and localhost redirects stop before a second send/header leak. Changed same-origin endpoints are intentionally refused by exact issued-endpoint policy and require separate issuance. This test does not claim followed-redirect qualification. |
| AC05 | Two real registry instances and distinct issued plans race actual D1 final request and byte allowances. One send wins; the loser does not partially debit; counter readback agrees across instances/recreation. |
| AC06 | Six distinct trusted synthetic adapters parse two retained pages each. GitHub remains artifact plus separate account; PubMed needs no repository; Crossref retains institutional author/unresolved people; arXiv keeps base/version separate; forum does not infer a person; institutional accepts an independent creator without artifact/repository. Wrong bytes/hash/request, missing retained resolver and fabricated receipt fail. Every lead has publicationAuthorized:false. |
| Item bound | Actual persisted one-item attempt reservation plus a two-record body yields one lead, one explicit rejection, truncation/partial and no healthy-complete assertion. A caller cannot enlarge the trusted cap. |
| Body/dependency boundary | Stalled body deadline, oversize cancellation, egress/read errors containing RuntimeError canaries, reused delivered buffer and credential getter errors remain bounded/redacted. Requests remain charged after failed/uncertain sends. |
| Restart/retry/replay | Persisted 429 Retry-After survives factory recreation; retry consumes a new request after its hold. Reusing the operation/attempt never obtains another free fetch. |
| Retention transaction | Actual control/lease replacement or missing budget after resolver/composer lookup causes the retention SQL batch to abort. Injected prefix rows and an invalid final statement leave no representation/receipt/settlement prefix. |
| Lifetime distinction | A request deadline blocks a new stale capture; already-retained evidence remains usable under its still-current retention grant. A new issued request can proceed afterward. |
| Mutation/authority | Input/target mutation across capability await cannot change the approved target/content. Public concrete registry exposes no reserve/finish completion authority. Mutating a separately returned plan or credential object across reservation cannot redirect or replace headers. |
| Scope removal | Revoking source ID revision 1 scope A preserves revision 2 scope B's retained evidence, qualification, issued plan and active state. New scope B acquisition still succeeds. |
| Opaque token | Binding token is returned once, unrecoverable on durable replay, absent from every durable registry/evidence/fixture table and operation result after retention. Only hashed binding remains. |
| Monotonic deadlines | A slow actual D1 lookup cannot extend an invocation under a frozen clock; no reservation/send occurs. A slow actual reservation plus backward clock cannot extend a short credential lifetime; zero egress and the charged attempt remain. |
| Failure identity | Known missing-egress/budget, expired, disabled and revoked/deleted plans retain verified source and issued-operation identities. Truly unknown plans use reserved unresolved sentinels. Registration rejects sentinel collisions without changing shared DiscoveryId or DB; permanent issuance audit prevents an erased plan ID from being rebound by a fresh source/operation. |
| Endpoint Unicode | Valid emoji pair round-trips unchanged; lone high/low surrogate values in text/token/fixed/enum inputs fail rather than changing to U+FFFD. |

The trusted fixture receipt table is deliberately test-only. It persists exact parent capture/representation/hash/request/next-token metadata after parsing and retention, and adapter receipt lookups recheck actual retained data. It is not `DiscoverySourcePage`, an atomic production page receipt, a checkpoint advancement or proof of terminal scope coverage. WP07 owns that integration. The registry independently checks the actual parent and controls in its issuance transaction; caller `committed:true` objects supply no receipt authority.

## Actual local environment

All 43 migrations (0001–0043) run through Wrangler `getPlatformProxy` with the existing fake D1 binding, `envFiles:[]`, `persist:false`, `remoteBindings:false`. The test adds only its isolated synthetic receipt table. No production-shaped config, secret environment file or native provider egress is used. Actual D1 performs the races and rollback; forwarding wrappers inject timing/final-statement faults without claiming that a JavaScript loop is a database transaction.

Commands use Node 22.23.2 and sanitized `env -i` with HOME/CODEX_HOME unchanged. TMPDIR and XDG config/cache/data are beneath `.discovery-work/wp06-tests-sol` on `/workspace`. No provider call, actual credential provisioning, deployment, migration rollout, scheduler, commit, dependency installation or native-model edit occurred.

The final test automatically creates a unique `runs/<UTC-pid>/` directory containing `inputs-before.json`, `inputs-after.json` and `local-d1-results.json`, including hashes for registry/runtime/endpoint/transport/adapter/evidence contracts/store/source exchange/0042/0043/fixture/test/lockfile. Input changes during a run explicitly fail the parent test. TAP remains authoritative for test disposition; the structured report records observed cases and source consistency rather than declaring acceptance.

## Retained runs and disposition

- `run-1.log`: seven of nine subtests passed. Two failures came from the test fixture advancing 120 seconds while source backoff had correctly grown to 240 seconds. The fixture now advances beyond the maximum hold between independent failure scenarios; the dedicated exact Retry-After test keeps its explicit boundary. Run 1's original JSON was overwritten before capture; only its TAP is claimed as retained.
- `run-2.log`: all 19 tests passed (18 subtests plus parent), approximately 61 seconds. This was a diagnostic candidate while the source review was still progressing. The old shared JSON output and its copied `run-2-results.json` are legacy/intermediate artifacts, not independently proven run-specific provenance. They do not replace the TAP or final unique reports.
- `run-3-final.log`: **historical pre-identity-fix 20/20 passed**, comprising 19 subtests plus parent, zero failures/skips/cancellations, 118.8 seconds. Every captured implementation/test input stayed identical before and after the run. That test/input snapshot is preserved in its unique run directory. It does not cover the subsequently identified failure-attribution correction; no implementation files were modified by this test role.

Earlier passing runs do not waive later corrections. The final independent implementation review, full repository checks and acceptance remain Astra/root responsibilities. These tests do not establish real provider access, DNS/connect-time egress enforcement, physical zero-send semantics after a concurrent revocation, real rights decisions, editorial acceptance or production readiness. SQL request admission and atomic stale-retention refusal are the tested boundaries; a socket send cannot be transacted atomically with D1.

## Historical frozen evidence before identity correction

Unique run directory: `.discovery-work/wp06-tests-sol/runs/2026-11-14T02-10-19-481Z-3014411/`. `inputs-before.json` and `inputs-after.json` match; `local-d1-results.json` records `inputsUnchanged:true`, all 19 case groups, runtime and migration list. The final TAP is `.discovery-work/wp06-tests-sol/run-3-final.log`, SHA-256 `3853647fcc9c661cca3662997e62c7ef5e739085ec1d177c65ffeac7d6912505`.

| Input | SHA-256 |
| --- | --- |
| test/discovery-transport.test.ts | 34fe2952f49fb53922cebd7038154182cc00ecb3f1dc971e99ca21646087dc51 |
| source-registry.ts | 2a47fb223b445c5017160ef7a1337d39548a30cbf178a8d4fa4d30fb22c4e85b |
| runtime-contract.ts | 31e33a4464a6701f66346c4d7e0e632a6534970bb702e005b82951e27196f49f |
| endpoint.ts | c68b45e9f1bda9d4ee86a13876a963a75ed9c420ac25a00f1c5567bd64c055dc |
| transport.ts | e26cd82444e22085023cfa615e2fc4fceb65df8e40d0d7d9c17791b4b0bf9054 |
| adapter.ts | 187236b801bf0191e894ff65552fca63352f6c1907f2ff6a57eac5a03ca993ad |
| migrations/0043_discovery_registry.sql | 5b0a58a4097d879a5392bd43145d5fb58ae0a8a78a456e9064473168e77b0e85 |
| discovery-evidence-store.ts (root-owned compose seam) | b366224eb46276f5143df0fc0df2b9b9ea546b98c363863fb0e0cdab96ce3ea6 |

The complete 13-input manifest additionally includes discovery-evidence/schema/source exchange, migration 0042, fake D1 fixture and unchanged package lock. `git diff --check` reports no whitespace errors on the two owned paths. No broad test, build, deploy or acceptance claim is inferred from this targeted run.

## Identity correction requalification

Root/Astra reproduced an IF02 defect after run 3: missing-egress/readiness failures attributed `planId` as a source, and removal could erase the payload used to resolve real identity. The narrow correction reads permanent verified issuance audit without granting readiness, preserves source/operation IDs after expiry/disablement/removal, uses reserved unresolved sentinels only for unknown/prelookup-failed identity, and prevents plan ID reuse after erasure. Global `DiscoveryId` is unchanged.

`run-4-identity-final.log` is a diagnostic attempt: all twenty behavioral subtests passed, but its parent correctly failed because source/test hashes changed during the sentinel/nonreuse refinement. It is retained as mixed-input evidence, not final qualification. Its unique run report records the drift.

The corrected permanent identity case tests missing egress, missing budget, expired, disabled and revoked/deleted plans; the erased plan cannot be recreated under a fresh source/new operation; unknown identities use exact sentinels; real source and registry-operation sentinel collisions fail with unchanged DB. This makes the final candidate 21 tests (20 subtests plus parent).

`run-5-final.log` was a stable-input failed attempt against the owner-confirmed freeze: registry `d30741724aed9ad051c689f91edcaa49649aad2e3c55c8757d5b019f9b42ffa9`, runtime `fc2d2d85c30d462a3dee68a80dfc452cfcdd330bce1c42599d578e084b8566fc`, transport `2776bf5ea043300ddd984456e69957248f199a3a70cd5332f1c8a637907fdd6c`, SQL `733332e836bfe0c3c0dba2d5af343529e7f783aa4a0274b63e9518a02bf28b89`, test `08075a8de1fa22c921e1d5ddd498f9d7205f9ff27fd820cc716f7806c9aa64a2`. Endpoint/adapter/root evidence seam are unchanged from the historical manifest. Run 5 passed nineteen behavioral subtests; the identity subtest failed on a missing `DiscoveryId` test import before its new sentinel assertions could complete. Its original before/after hashes and failure TAP remain retained. No implementation defect is inferred from that ReferenceError.

The test import is corrected. A strict standalone TypeScript check now passes (`test-typecheck-third.log`) with the project compiler and existing Node declarations under `/workspace/build/builderbob/cole-site-sysml-20261112/source-main/node_modules/@types`; no dependency was installed or changed. Earlier static-check attempts retain their config/type-resolution errors. This auxiliary check is not a replacement for the actual Node/D1 suite or root CI wiring.

`run-6-final.log` **passed 21/21 tests**, comprising twenty subtests plus parent, with zero failures/skips/cancellations in 138.2 seconds. All thirteen implementation/test/fixture/lockfile input hashes matched before and after. No source or test edits occurred during the run; the test is now frozen at `8ed479d609ea1e3886b2ece5111170ad7d1326450123ae21492f60a989af0b37`.

The authoritative corrected run directory is `.discovery-work/wp06-tests-sol/runs/2026-11-14T02-25-27-310Z-3078658/`. Its `inputs-before.json` and `inputs-after.json` agree; `local-d1-results.json` records `inputsUnchanged:true` and all twenty observed case groups. The structured report SHA-256 is `0ad45fe281f480cca28bcb5e987611127e3e46aaaf4cacc62041f421cffab032`. Corrected final TAP `.discovery-work/wp06-tests-sol/run-6-final.log` SHA-256 is `153cc42798166159495d03b36f3f392e6f27193e6291336f010da251dcef0297`.

| Corrected input | SHA-256 |
| --- | --- |
| test/discovery-transport.test.ts | 8ed479d609ea1e3886b2ece5111170ad7d1326450123ae21492f60a989af0b37 |
| source-registry.ts | d30741724aed9ad051c689f91edcaa49649aad2e3c55c8757d5b019f9b42ffa9 |
| runtime-contract.ts | fc2d2d85c30d462a3dee68a80dfc452cfcdd330bce1c42599d578e084b8566fc |
| transport.ts | 2776bf5ea043300ddd984456e69957248f199a3a70cd5332f1c8a637907fdd6c |
| migrations/0043_discovery_registry.sql | 733332e836bfe0c3c0dba2d5af343529e7f783aa4a0274b63e9518a02bf28b89 |

Endpoint `c68b45e9…`, adapter `187236b8…`, the root-owned evidence composition seam `b366224e…`, accepted evidence schema/0042 and package lock match the full thirteen-input manifest. The earlier pre-identity hashes and passes remain historical. Sol recommends acceptance of the tests for this bounded synthetic/local scope; package disposition still belongs to root after Astra's implementation review and root's final integration checks.
