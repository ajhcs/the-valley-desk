# Completed Ops diagnostic: source cleanup and bounded investigation

## Cleanup scope and preserved evidence

The approved15-minute diagnostic (PR22) ended early following the parent-reported browser-policy rejection. Production97 was restored at2026-10-04T03:57:57.991985Z, versiond6408e1e-4e04-45c2-84d3-56da39e4efca,100%, BUILD_SHA0f5ea0b3193a50f9fc5c230c1b5f1fb5ae0f3501. The diagnostic flag is absent; observer and finite supervisor stopped. No further owner attempt or route around the rejection was made.

This cleanup restores the six temporary files to their exact reviewed production97-equivalent state (tree64ad6549be0ecc56522cbae4cd61dee4a5f0fe4f), then adds only this document. It removes the response diagnostic module, compiled activation window, temporary route wiring/result API, diagnostic-only tests and temporary proposal document. The package test list retains all leadership/source-quality tests. Existing97 authentication, fixed-category server logging, regional attribution fixes, frontend, Cloudflare config, sources and schedules remain unchanged. No runtime or deployment action is part of this cleanup.

The original proposal, both frozen successors, PR22/commit00350b836722b9f1f4de6b435cceea02a8cef96f, retained BuilderBob artifacts and18 hash-verified handoff files preserve historical evidence. Authoritative lifecycle receipts are retained under /workspace/tmp/builderbob/tvd-ops-diagnostic-window-20261004T035500Z and copied into /workspace/tmp/builderbob/tvd-ops-diagnostic-cleanup-20261004/preserved-test-evidence. No token, cookie, claim or identity data was collected in diagnostic receipts.

## Observed fact and attribution limits

Parent reported one reload attempt2026-10-04T03:57:04–03:57:12Z, rejected by browser URL/protocol security policy before observable page response. HTTPstatus, response header and delivery remain unconfirmed; do not count it as an origin failure.

The passive observer recorded one canonical Ops-shell GET category header-rejected at collector time2026-10-04T03:57:12.286195Z. This is receive/parse time,286ms after the reported interval end, not the origin request timestamp. It has no requestID/identity correlation. Owner attribution remains unverified; the clue cannot establish the parent's response or a confirmed JWT root cause.

## What header-rejected means in the unchanged verifier

The source is src/ingest/ops-jwt.ts, createOpsJwtVerifier. Configuration must be available and an assertion header present before reaching this category. Header-rejected is returned for either:

- Assertion .length greater than8192, or failure of the compact three-nonempty-base64url-segment shape. Padding, whitespace, a Bearer prefix and other characters outside that shape fail this guard.
- After protected-header decoding:alg is not exactly RS256;typ is not exactly JWT;kid is not a string of1–128ASCII letters/digits/underscore/hyphen;or any jku,jwk,x5u,x5c,crit member is present, regardless of its value.

These guards run before JWKS resolution and cryptographic JWT verification. The category therefore does not prove a bad signature, issuer, audience, expiry, owner identity or source of the assertion. A thrown protected-header decode error takes the existing token-rejected catch path instead. The coarse category cannot identify which predicate failed. Do not weaken any guard or inspect a real token based on this unattributed clue.

## Next safe investigation step — separate browser restriction work

First inspect the parent browser tool's documented reload/tab contract and read-only current-tab URL metadata. Retain only sanitized scheme, host and path, excluding userinfo/query/fragment/title or browser storage. Compare that metadata and the supported API/protocol contract with canonical https://thevalleydesk.org/ops and the reported allowlist(http,https). This child environment has no browser tools; the parent owns this check.

Do not navigate, reload,fetch through another route, change browser/network identity, reset a session,copy cookies/assertions,or repeat the owner action while the policy rejection remains unresolved. If the supported-tool contract is inconsistent, prepare a local tool-issue summary for the parent using only the method, sanitized URL components and sanitized policy error. Resolve the supported tooling limitation before proposing a later owner attempt. Any future diagnostic requires a separately reviewed bounded artifact/window and authorized coordinated attempt; never quietly extend the expired timestamps or rearm this test.

No authentication fix is supported by current owner evidence. Existing reviewed engineering authorization remains; no new permission is requested for this source cleanup. No deploy,Access policy/credential change,D1 operation,manual collector,source activation,blocked-source retry,PA/PR18 change,paid API,service or outreach. Six regional coverage gaps remain open.
