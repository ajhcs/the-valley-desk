# WP03 offline cryptographic store — Sol

2026-11-15. Bounded preparation progress only. WP03 remains incomplete: no actual
independent human enrollment, permissions, reference cases or sealed freeze. E01–E05
remain not run. No external sources were contacted and no private keys were retained.

Added an offline Ed25519-verifying store over separately supplied operator public-key
pins. Receipt signatures and signed authority grants require independently permitted
roles/authority IDs. Signed preimages bind domain, algorithm, key selector and canonical
payload digest. The existing receipt expectation checker still binds manifest purpose,
subject, principal and content. Issuance/expiry, key/grant validity, revocation snapshot,
duplicate IDs, algorithm/key confusion, unauthorized grants and tamper fail closed.
The signed grant window narrows authority validity and must contain receipt validity.

Root review identified that the initial size check followed schema cloning and counted
JavaScript characters. Replaced it with a conservative aggregate UTF-8 preflight before
Zod cloning, including policy and bundle, with node/depth limits and getter-free rejection
of nonplain/cyclic/accessor inputs. Multibyte-overflow and shape tests verify the fix.
Terra identified the signed grant window containment requirement; it is enforced and
covered by a valid-signature narrow-grant rejection test. Clock validity is rechecked
following awaited crypto; authority is revalidated before receipt return.

This implements actual cryptographic verification under supplied pins. It does not prove
that a pinned key belongs to an accountable human or source. Pin provenance, delegation,
trusted clock, current policy selection and anti-rollback remain operator responsibilities.
Revocation is explicitly a versioned expiring snapshot, requiring store replacement on
change; it is not a live feed. No maximum policy TTL or persistent revision store exists.
The guide specifies all input formats, limits and remaining accountable handoff inputs.

Validation used workspace Node v22.23.2 in sanitized env with original HOME and scratch
TMPDIR/XDG_CACHE_HOME/npm cache under `.discovery-work/wp03-signatures-sol/`:

- `node --import tsx/esm --test test/discovery-reference-signatures.test.ts test/discovery-reference-receipts.test.ts test/discovery-evaluation.test.ts`: 57 passed (19 new signature tests plus 38 prior).
- `node node_modules/typescript/bin/tsc -p .discovery-work/wp03-signatures-sol/tsconfig.json`: scoped no-emit pass.
- Actual manifest signed intake with no enrolled keys or records: blocked/not_frozen,
  zero heldout/recall/audit, freezeIssued false. The synthetic diagnostic policy is
  explicitly unenrolled, evaluated at 2026-11-15T12:00:00Z with a one-day validity
  window solely for reproducible offline reporting; it grants no authority.

Permanent negative tests include forged signatures/claims/authority, unknown or wrong
keys, signed role/scope confusion, revoked keys/receipts/authority, stale policy, missing
authority, algorithm/domain confusion, key injection, duplicate IDs, bounded inputs,
input/output snapshot mutation, validity expiring during crypto and grant containment.
Ephemeral synthetic signers test mathematical integrity only. Independent reviewer
findings/dispositions are recorded separately.

| Evidence | SHA-256 |
| --- | --- |
| src/ingest/discovery-reference-signatures.ts | fdf45e6995a0e2d4e1675600d34254d36caeb9c0c52e3c683153ce5668e7b9d0 |
| test/discovery-reference-signatures.test.ts | c49168738fe629a1140a848744b48662339ec8ded3524a427f792499843d6830 |
| docs/discovery/wp03-signed-intake.md | 5b0fe8a78fef7dc998a179fc1475039779709b18d0bd0386a95b73c49aad5e12 |
| .discovery-work/wp03-signatures-sol/intake-report.json | 130dfad1fdadbee183a55e33403aa6bbcc2a5b0a33cce7f46fd658da42a2ab55 |
| .discovery-work/wp03-signatures-sol/tests.log | 1fee5b858acade83539da491a5e7a38a66ada93c6b394ab5988a7651078e7e8a |
