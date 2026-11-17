# WP03 bounded preparation progress — Sol

2026-11-15. WP03 remains incomplete. Actual manifest: zero real cases, reviewers
and permission/evidence records; no corpus frozen and E01–E05 not run.

Added `src/ingest/discovery-reference-receipts.ts`, a strict offline adapter from a
caller-owned authenticated record-store capability to the existing verifier contract.
It checks full record hash and purpose/subject/principal/content bindings, purpose
and principal authority scopes, record/authority validity, current authority revocation
and absent/revoked records. It snapshots caller inputs before asynchronous lookups.
A read-only intake helper emits validator findings plus explicit external trust and
human-review requirements, and cannot issue a freeze.

This is a usable boundary, not an authenticated registry implementation. Separately
provisioned trusted application store and clock remain prerequisites. Uploaded
records, matching hashes and caller-asserted authority JSON cannot authenticate records.
The external-store integration gap remains open. The intake guide documents the
contract, current missing inputs and accountable handoff. Existing evaluation module,
protocol, manifest, schemas, package scripts and acceptance receipts were untouched.

Validation on workspace Node v22.23.2, clean environment with HOME preserved and
TMPDIR/XDG_CACHE_HOME/npm cache under `.discovery-work/wp03-sol/`:

- `node --import tsx/esm --test test/discovery-reference-receipts.test.ts test/discovery-evaluation.test.ts`: 38/38 pass (17 new receipt-boundary tests and 21 existing evaluation tests).
- `node node_modules/typescript/bin/tsc -p .discovery-work/wp03-sol/tsconfig.json`: pass, scoped no-emit check.
- Offline current-manifest report: `blocked`, `not_frozen`, zero heldout/recall/audit,
  `freezeIssued: false`. Retained at `.discovery-work/wp03-sol/intake-report.json`.

Negative tests include uploaded forgery without registry membership, unknown authority,
recomputed-digest wrong purpose/principal/subject/content, future/expired record,
expired/revoked/out-of-scope/misidentified authority, record removal after success,
substituted hash, self-asserted authentication fields and asynchronous caller mutation.
Synthetic capabilities prove local plumbing, not actual external authentication.
Independent review is recorded separately by Terra.

SHA-256 evidence:

| File | SHA-256 |
| --- | --- |
| src/ingest/discovery-reference-receipts.ts | f01ad22554b7291d1327a696161305b1de6146a28c2b6247611a487f1d33e704 |
| test/discovery-reference-receipts.test.ts | 78c81237227d5becbb411c357c74d988ba2e41b53311fb92bc071a175011073e |
| docs/discovery/wp03-intake.md | 007bc4fd4f6880ac39c1297b4cc7bdee05ff4977a47e88b82f0694803cb210cd |
| .discovery-work/wp03-sol/intake-report.json | 26cb4e5e9db6488094cc82d07760ae79aaffbbb374b868cf68121a2b4b23aea3 |
| .discovery-work/wp03-sol/tests.log | 7e998103873421c156ddfaf94eb2319b5fe38d46504969578fd958e116e37043 |
