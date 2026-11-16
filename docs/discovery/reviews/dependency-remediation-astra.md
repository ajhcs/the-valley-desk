# Independent dependency remediation review

Reviewed against base `d7081f8`, with Sol's Zod migration frozen for the parent
qualification run. The focused review found no remaining blocker in the genuine
Zod 4 migration. Full integration qualification remains pending the parent run;
this record does not authorize deployment or change a discovery acceptance gate.

## Parser fix and implementation boundary

The [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
identifies collection parsing before size rejection. The
[v4 fix](https://github.com/colinhacks/zod/pull/6652) and subsequent
[v3 backport](https://github.com/colinhacks/zod/pull/6696) affect separate
implementations. Installing a newer root package does not establish which parser
the application executes. In the installed 4.6.7 package, an array containing
1,000 invalid entries with `.max(2)` produces one issue through the root import
and 1,001 issues through `zod/v3`. Application and script imports use the genuine
v4 parser; the new regression rejects an active compatibility import.

The eight tests in `test/discovery-dependency-security.test.ts` exercise:

- Oversized arrays, sets and maps reject before child traversal; array checks
  include synchronous and asynchronous parsing, exact length and maximum length,
  bounded diagnostics, and transforms/refinements that must not execute.
- Within-limit inputs still validate and transform normally. A native manifest
  with 10,001 invalid cases produces one case-array bounds issue.
- Pre-migration native context normalization and eleven unchanged Ed25519
  receipt signatures still verify. Strict object fields, required labels,
  invalid dates and unsafe integer revisions fail closed.
- Changing policy, rubric, subject, source context or annotation disagreement
  invalidates the corresponding original binding or adjudication.
- Production source and scripts contain no `zod/v3` import.

These checks establish the exercised bounded-parser behavior. They do not make
unbounded collections bounded or establish a general resource-exhaustion limit.

## Independent native and compatibility evidence

The native fixture was produced from the original `d7081f8` source files resolving
an isolated genuine Zod 3.25.76 package. It includes UTC minute timestamps and
normalization-sensitive rationale text. Its parsed-manifest SHA-256 is
`5c01404665deb337f9b74f4714324b9dc0fdc9e75283473d84bcb2d066185c07`.
The original parser independently verifies all eleven receipts; the new normal
test verifies the same receipts and canonical digest with Zod 4, without
regenerating signatures. The committed fixture contains only fictional records,
public verification material and signatures. It remains `not_frozen` and
`blocked`; no actual human identity, independence, source permission or authority
is established by the fixture.

Review of the migration found that two-argument string-key records preserve
record value validation, `.prefault` preserves nested default parsing, and
shape/refinement changes preserve the intended prior contracts. The compatibility
helpers retain raw URL and timestamp strings. They use actual Zod 4 validation
for UTC seconds or minutes and the URL constructor for the former URL acceptance
rule. Offset-enabled contracts retain the old compact/colon suffix syntax,
including its loose numeric offset range; this is syntax compatibility, not a
new claim that every accepted offset describes a real time zone. Existing
consumer-specific calendar and canonical-date checks remain applicable.

An independent comparison against genuine Zod 3 covered 4,860 UTC date strings,
390 offset strings and 19 URL edge cases: **5,269 comparisons, zero mismatches**.
The legacy suite separately checks the seven captured mutation-matrix output
hashes, thirteen legacy edges and seventy-three helper boundaries. Its comparison
normalizes only identified helper checks and corresponding format errors; other
constraints remain visible. The original frozen v1 schema and item fixtures are
unchanged.

Zod 4 intentionally tightens two boundaries. Integer fields reject imprecise
values outside the safe-integer range, and formerly implicit unknown-valued
properties are required. Consumer probes confirmed valid government identifiers
still parse, unsafe bill/congress identifiers fail instead of permitting rounded
identity collisions, and missing native/fact values fail. An explicitly absent
technology purpose remains valid as `null`. These are appropriate holds for
identifiers, counters, versions, offsets and evidence-bearing facts; the migration
does not restore unsafe integers or manufacture missing evidence values.

## Recorded checks and limits

The independent frozen-source run passed **59/59 tests**: eight dependency
security/native-binding tests, twenty-nine legacy tests and twenty-two private
human-workflow adversarial tests. Application typechecking passed. The earlier
in-progress legacy failures are retained separately and are superseded by this
completed focused run, not erased.

Private evidence is under `.discovery-work/dependency-remediation/astra/`:
`native-zod3-minute-verification.log`, `migration-independent-final.log`,
`compat-comparison.json`, `consumer-boundaries.json` and
`installed-parser-paths.json`, alongside their drivers and isolated baseline.
The final focused log SHA-256 is
`7d1a84ad23874bb87d4be93d2a9628bfb95ad77ee03a15a8e77a01d77f0c06fa`.
The new test SHA-256 is
`a9b49d06d4818abe84298d9bf48d72db0134d5f5b30b822d4439ff9b785b7f43`.
The reviewed compatibility-helper SHA-256 is
`24e7cf5ea7c3e919b964b01e539cdbd66f9d0f8893a232c9223269abcc1096a9`.

The esbuild lockfile change also preserves all twenty-six optional platform
records at version 0.28.2. Linux x64 remains hoisted; the other twenty-five live
under `node_modules/esbuild/node_modules/@esbuild/`, where the shared esbuild
resolves them. Their tarball URLs, integrity hashes and platform metadata match
the corresponding prior 0.28.2 records. The Linux x64 record lacks URL/integrity
in both base and current lock and is unchanged. Wrangler's redundant 0.28.1
tree was removed; no platform record is missing. This structural check, recorded
in `esbuild-lock-platforms.json`, is not an execution test on another OS.

The parent's complete `npm test` including posttest, mandatory PDF checks, build,
local operations smoke, online audit and secret scan are separate qualification
evidence. Their results must be recorded against the frozen input snapshot before
claiming full integration passed. This review does not establish equivalence for
every possible input, qualify live source ingestion, enroll reviewers, freeze a
corpus, admit WP14, implement WP15, or authorize deployment.
