# WP03 offline signed receipt intake

This preparation increment adds real offline cryptographic verification to the earlier
record-store seam. It does not enroll actual humans, establish source truth or freeze
WP03. The actual manifest still has zero real cases and reviewers; E01–E05 remain not run.

`createDiscoverySignedReceiptStore(trustedPolicy, untrustedBundle, now)` returns the
existing `DiscoveryTrustedReceiptStore`. `assessDiscoverySignedReferenceIntake` connects
it to the unchanged readiness validator and returns the same blocked/not_frozen rules.
The wrapper identifies the integration as
`offline_signature_verification_under_supplied_operator_pins`. The earlier generic
adapter does not independently establish authenticity; the new store implements
signature verification under explicit operator pins. No receipt or freeze is issued.

Trust policy is separately provisioned operator input, never uploaded alongside records
as self-enrollment. It has revision, validFrom/validUntil, pinned keys and explicit
revoked receipt/authority IDs. Each pin has id, Ed25519 SPKI encoded as 88 lowercase hex
characters (44 bytes), exact receipt/authority roles, exact authority IDs, validity and
revoked flag. Key identifiers and public keys must be unique. Ed25519 is the only
algorithm; no key inference or algorithm negotiation occurs. Pinning a key delegates
authority for the listed authority IDs: a pinned authority-role signer may grant purposes
and principals in its signed authority statement. Operators must review that delegation.
Receipt-role signers cannot self-authorize or expand those signed grants.

The untrusted bundle has only `receipts` and `authorities`. Each envelope has exact
`domain`, `algorithm: Ed25519`, `keyId`, `payload`, and 128-character lowercase hex
signature (64 bytes). Receipt domain is `discovery-reference-receipt-signature-v1`;
authority domain is `discovery-reference-authority-signature-v1`. Receipt payload is the
existing strict `DiscoveryAuthenticatedReceipt`. Authority payload has
`schemaVersion: discovery-authority-statement-v1`, issuedAt, expiresAt and the existing
strict authority object. The grant's effective validity is the signed statement window,
which must lie inside the authority validity. Receipt validity must fit that grant.

`discoveryReferenceSigningBytes(domain, keyId, payload)` produces UTF-8 JSON of
`[domain, "Ed25519", keyId, discoveryEvaluationDigest(payload)]`. This binds the domain,
key selector and canonical payload digest. The existing manifest reference digest
continues to bind the authenticated receipt payload, not its envelope. Purpose, subject,
principal, content and time are signed; the existing expectation checker still compares
them against the manifest. Signatures alone do not establish truth of these claims.

The constructor parses detached snapshots before asynchronous key import. Limits are
100 pins, 100 authority IDs per pin, 20,000 receipts, 1,000 authority statements,
10,000 revoked receipt IDs and 1,000 revoked authority IDs. Before schema cloning, a
conservative aggregate UTF-8 JSON preflight limits policy to 262,144 bytes and bundle
to 16,000,000 bytes, with depth 12 and 500,000 visited-node limits. It rejects cycles,
nonplain objects, accessors, symbols and sparse arrays without invoking getters.
Schema strings and arrays are bounded. Duplicate IDs,
unknown fields, embedded keys and non-Ed25519 algorithms fail closed. These are parsed
object bounds; callers receiving raw files must separately bound file bytes before JSON
parsing. This API does not parse or load files.

Every lookup verifies signatures, roles/scopes, policy/key/record validity and revocation.
It rechecks time after awaited cryptographic work and rechecks the authority before
returning a receipt. Returned values are detached copies. The clock is trusted wiring.

Revocation is a versioned expiring **snapshot**, not a live revocation feed. Replace the
store whenever policy changes. Choose policy expiry for the operational freshness
requirement. Revision strings and validity do not prevent rollback to an older still-valid
policy; authenticated policy distribution, current-revision selection and anti-rollback
are operator responsibilities. No runtime maximum TTL or persistent monotonic revision
store is provided. An intentionally dishonest caller can replace pins or clock.

For an honest empty-inventory diagnostic, pass no keys or signed records, using a clearly
unenrolled diagnostic policy with an explicit validity window. This does not invent an
authority. The current report remains blocked with no reviewers, sampling, development,
360 held-out/route-balanced cases, eligible recall roster or exposure history. An empty
bundle cannot produce authenticated evidence. Malformed policy/bundle returns
`invalid-signed-intake-or-trust-policy`, blocked and not_frozen.

Accountable handoff still requires actual operator trust enrollment and current policy,
permitted original evidence and separate retention/annotation/evaluation rights,
independent human reviewers and blinded adjudication, independent sampling frames and
family provenance, the required real corpus and review, then a separately authenticated
sealed freeze receipt. See [the intake handoff](wp03-intake.md) for the complete list.
Test ephemeral private keys exist only in process memory; none are retained or enrolled.
