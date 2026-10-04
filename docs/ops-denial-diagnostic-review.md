# Temporary Ops denial diagnostic: local review candidate

This is a local-only security disclosure proposal. It is not deployed or enabled.
The default switch is absent/disabled, and both build-bound UTC timestamps are
empty. This exact candidate cannot emit the header even if a runtime switch is
set to `true`. Existing general deployment approval does not authorize enabling
this diagnostic. Specific user approval of the exact artifact and limited
failure-category disclosure is required before production.

## Request and response contract

Only denied `GET` requests whose normalized Request URL is exactly
`https://thevalleydesk.org/ops` or `https://thevalleydesk.org/ops/` may receive
`X-TVD-Ops-Diagnostic`. The existing 404 body, no-store and security headers stay
unchanged. All early host/origin/POST guards run before the verifier and emit no
diagnostic. HEAD, mutations, APIs, other paths, query delimiters/values, fragments,
encoded path aliases, nondefault ports, foreign hosts and www redirects emit none.
Standard Request URL normalization erases explicit default HTTPS port443; that
normalized canonical URL is indistinguishable from one written without443.

The six and only six values are configuration-unavailable, assertion-missing,
header-rejected, key-unavailable, token-rejected and identity-rejected. No token,
claim, identity, issuer/AUD, signing-key identifier, provider body, raw exception,
request data or build identifier appears in the header. A successful authenticated
GET/HEAD remains200 without the header. Other authenticated responses, including
API404 and unsupported method405, have no diagnostic.

The verifier returns a fresh per-request discriminated result; the existing
identity-only API remains available and shares the default key cache. Category
logging retains its original per-category throttle and swallowed callback errors.
Header disclosure does not depend on logging or a global last-denial variable.

## Security impact and approval boundary

When an approved successor window and explicit switch are active, all six coarse
failure categories become visible to ANY caller who reaches the matched Worker
route but fails Worker JWT authentication. This includes an Access-edge-authenticated
caller whose assertion the Worker rejects. The Worker cannot infer a verified
owner identity from a failed assertion; no raw email header, cookie or supplied
context is trusted to gate the header. This creates a bounded authentication and
configuration oracle and deliberately changes failure-detail concealment.

RS256 signature, exact issuer/AUD, protected-header restrictions, bounded
issuer-derived JWKS lookup/cache/cooldown, exp/iat/nbf checks with zero clock
tolerance, app-token type, nonempty subject and sole-owner email remain unchanged.
No failure category authorizes a request. Missing/invalid configuration and all
existing guards still fail closed. No frontend, Access policy, credential,
persistent service, database, collector or publication gate is changed.

Before any approval to enable, independently verify existing owner-only Access
coverage for both exact shell paths and its bypass boundaries. Current source and
retained nonsecret configuration comparisons do not establish that edge policy,
request-time assertion validity or Worker invocation. The denial cause is unknown.

## Immutable window and proposed enablement review

Timing inputs are compiled primitive strings, not environment/request timestamps.
They require canonical millisecond UTC ISO strings and a positive interval at most
30 minutes. Validity is start-inclusive/end-exclusive against the server UTC clock;
invalid timestamps, windows, switch values or clock inputs suppress disclosure.
A runtime flag cannot create or extend a window. No permanent-expiry state or
new persistent service is introduced; correctness relies on the platform UTC clock.

If a successor is requested, propose a15-minute UTC window. Choose the exact start
and deadline during artifact review, fill only those two constants, rebuild/test,
and freeze the successor commit, diff and output hashes. Specific user approval
must name that exact successor artifact, interval and six-category visibility.
An expired window requires a newly reviewed artifact, not a quiet config extension.
Do not deploy this inert candidate or use test fixture window replacement in a
production build. No owner retry is owed until observation is ready and approved.

## Tests and bounded offline execution

`npm test` includes `test/ops-diagnostic.test.ts`. New tests exercise inert defaults,
strict switch values, malformed/reversed/oversized/future/expired intervals, exact
start/end boundaries, invalid clocks, closed categories, URL/method exclusions,
log throttling/callback failure, overlapping category results and the identity-only
compatibility API. Real Worker bundles use test-only immutable windows, fresh
in-memory RSA fixtures and a mock transport that throws on any unexpected network
attempt. Production timestamps remain empty.

Real Worker tests cover all six404 categories, byte-identical denial body and
header parity when disabled, expired/inactive builds, early guards, denied
spoofed headers/cookies/context, JWT/owner/time/claim/signature restrictions,
successful GET/HEAD200, authenticated API404, method405, www308, public health,
path exclusions and mixed concurrent failures. Existing JWT/JWKS tests remain
required. No production session/token/credential is used or emitted.

## Rollback and removal after a separately approved release

Capture the exact immediate pre-change deployment and configuration before any
later approved rollout; verify release drift first. Disabling the runtime switch
suppresses the header immediately but does not remove code. On faulty behavior,
restore that captured deployment rather than rolling back unrelated regional
changes. The currently retained baseline is version96; it must not be assumed
current at a later rollout. No database rollback or data operation is needed.

The immutable deadline suppresses the header without a second deployment. Disable
the switch explicitly after the approved window and remove diagnostic module,
route wiring, window constants and switch in the next separately reviewed cleanup
artifact. The structured verifier result can be removed or retained only with
normal review. No rollback, removal or deployment is executed by this candidate.

## Production97 integration — 2026-10-04

This isolated successor rebases the reviewed inert f4bb72b326269e07a9092e20b611d2a32c6ce4ba code onto the exact production97-equivalent tree64ad6549be0ecc56522cbae4cd61dee4a5f0fe4f (local21e445a, merged/live0f5ea0b3193a50f9fc5c230c1b5f1fb5ae0f3501). The sole integration conflict was the package test command; both leadership and diagnostic tests are retained. JWT/route/diagnostic module bytes are identical to the original reviewed patch.

Cole specifically authorized the proposed15-minute diagnostic on2026-10-04 (approvalSentinel_5468eccbe7b88191ba05b62480133346). Existing authorization permits publishing, merging and deploying this bounded test. This artifact still has empty timestamps and no enabled switch, so it remains inert pending exact window preparation and an observation-ready browser session. No broader category disclosure, auth relaxation or new credentials is authorized.

Actual immediate pre-test rollback is production97 d6408e1e-4e04-45c2-84d3-56da39e4efca, BUILD_SHA0f5ea0b3193a50f9fc5c230c1b5f1fb5ae0f3501, subject to another current-deployment check immediately before activation. Restore that baseline at the end; do not revert the regional leadership fixes by rolling back to96. No D1 operation is involved.

## Exact approved test window — timed successor

Parent has an existing owner browser tab on canonical /ops and will issue exactly one request after observation is ready and the test is armed. Compiled start:2026-10-04T03:55:00.000Z inclusive. Compiled deadline:2026-10-04T04:10:00.000Z exclusive. Exact interval900000ms (15minutes); unchanged guard rejects any interval greater than30minutes. Runtime/request inputs cannot extend it. Specific diagnostic approval persists; no new permission is required.

Timing-only successor changes the two primitive constants/comments, adapts test-only marker matching to actual immutable constants, tests exact production boundaries/switch closure, and records this window. JWT authentication and route/category/URL predicates are byte-identical to the reviewed inert production97 successor. Production runtime activation adds only OPS_DIAGNOSTIC_ENABLED=true alongside merged BUILD_SHA on the existing Worker; no credential or Access policy change. Frontend/assets/source schedules remain unchanged.

Observe before the parent's single canonical GET /ops. Persist only fixed category/status/time, never identities/cookies/assertions/claims/provider raw logs. Restore immediate predecessor production97 d6408e1e-4e04-45c2-84d3-56da39e4efca (BUILD_SHA0f5ea0b3193a50f9fc5c230c1b5f1fb5ae0f3501) after the attempt or at expiry, subject to immediate drift checks. Expiry independently suppresses the header even before cleanup. If a fresh Access challenge appears, use only a freshly issued OTP; no old OTP or additional owner retry.
