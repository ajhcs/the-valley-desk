# WP03 offline receipt intake

Preparation only; WP03 remains incomplete. The current manifest has zero real cases,
no independent human reviewers and no evidence/permission records. E01–E05 remain
`not_run`. This work does not acquire evidence, recruit people, grant rights or freeze a corpus.

`src/ingest/discovery-reference-receipts.ts` supplies a local reference boundary:
`createDiscoveryReferenceReceiptVerifier(store, now)` plugs into the unchanged
`assessDiscoveryReferenceReadiness`; `assessDiscoveryReferenceIntake(manifest, store,
now)` returns its findings as `requiredExternalInputs`, plus `freezeIssued: false`.
Both preserve `status: not_frozen`, including a readiness result of
`ready_for_accountable_freeze_review`.

The store and clock are trusted application capabilities, supplied separately from
untrusted intake. No store implementation or external authentication integration is
delivered here. An uploaded record, matching digest, authority JSON or Boolean cannot
establish authenticity. The caller must implement `readAuthenticated(id)` against an
independently authenticated record registry and `readAuthority(id)` against separately
provisioned authority configuration. Never populate either from uploaded intake or
allow the uploader to select the clock. A fake implementation returning attacker
objects defeats that trust assumption; this adapter cannot detect a dishonest caller.
An offline controlled registry must have an accountable owner, authenticated import
procedure, documented provenance and current revocation snapshot. Live provider
integration and authority enrollment remain outside this work.

Each authenticated receipt is strict versioned JSON with id, authorityId, purpose,
subjectId, nullable principalId, contentSha256, issuedAt and expiresAt. The reference
sha256 is `discoveryEvaluationDigest(record)`, using the existing canonical digest.
It binds the entire authenticated receipt, including validity; it does not authenticate
it. The content digest remains the existing evaluation expectation digest. Authorities
specify exact purpose and principal allowlists, validity and revocation. Null principal
must be explicitly allowed for receipts without a human principal. Unknown authorities,
missing/revoked records, wrong bindings, out-of-scope authority, future/expired records
and authority expiry all fail closed. Records and authority are read anew per resolution;
store operators must make current revocations visible. This is a per-call check, not a
transactional corpus snapshot or sealed freeze review. Inputs are parsed into detached
snapshots before use; references and expectations are captured before asynchronous lookup.

An empty store can exercise the real inventory without pretending to grant trust:

```ts
const report = await assessDiscoveryReferenceIntake(manifest, {
  readAuthenticated: async () => null,
  readAuthority: async () => null,
});
```

The report is read-only, does not persist labels or records, and performs no network calls.
Findings are validator codes tied to the manifest, not substitute human acceptance.

Missing inputs for accountable handoff:

- Independently authenticated record-store implementation, operator/trust enrollment,
  documented authority scopes and current revocation/clock policy.
- Permitted original evidence and separate access, retention, annotation and evaluation
  permissions with source representation digests and observation dates.
- At least two actual independent reviewers with authenticated authority and rubric;
  blinded annotations, preserved disagreement and accountable adjudication.
- Development material and a disjoint 360-case held-out corpus with 60 cases for each
  of the six routes, family provenance and overlap checks.
- Independently assembled eligible recall roster of at least 100 cases, held-out/recall
  frames, assembly/selection receipts, scopes and time windows.
- Prespecified admitted-audit selection plan; the actual audit of at least 100 items
  belongs to WP24. Revision/exposure history and independently reviewed denominators
  remain required.
- Accountable owner and independent review of the complete corpus, followed by a
  separately authenticated sealed freeze receipt. This helper never issues it.

Synthetic tests cover plumbing and negative trust/binding cases only. They establish
neither record authenticity in a deployment nor reference truth or achieved pilot gates.
