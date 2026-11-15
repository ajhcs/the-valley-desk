# WP03 independent-label context binding — Sol

2026-11-15. Preparation correction only. WP03 remains incomplete and not_frozen:
there are zero actual reference cases and no accountable human enrollment, real trust
pins, permitted original evidence or freeze. WP14 still requires actual WP03 completion;
this correction does not waive that dependency or establish evaluation performance.

I reproduced a signed-label replay before editing code. A wholly fictional fully signed
baseline was ready_for_accountable_freeze_review with no findings. I changed a held-out
case's subject and claimMode plus its source revision/representation, and re-attested the
source/family/selection context. The five original annotation, blinding and adjudication
envelopes remained byte-identical, including their Ed25519 signatures. Readiness still
returned ready with no findings. Source/selection review therefore did not establish
that the preserved independent labels applied to the revised subject or evidence.
Terra independently reproduced the same gap.

The existing EX17 selection-review payload is now constructed once as `reviewContext`.
Its exact manifest, complete case descriptors, sorted source snapshots and sampling
bindings remain unchanged. Its canonical digest is computed once per case and reused
as `contextSha256` in these new receipt expectations:

```ts
// independent-annotation
{ schemaVersion: "discovery-independent-annotation-v2", contextSha256,
  annotation: existingAnnotationPayloadWithoutReceiptAndBlindedBatch }

// blinding
{ schemaVersion: "discovery-blinding-v2", contextSha256,
  reviewerId, rubric, annotation: signedAnnotationReceiptRef }

// adjudication
{ schemaVersion: "discovery-adjudication-v2", contextSha256,
  adjudication: existingAdjudicationPayloadWithoutReceipt,
  annotations: exactIndependentAnnotationRows }
```

All existing purpose, case subject ID, principal, content digest and authenticated-store
checks remain. The adjudication basis includes the exact independent labels, rationale,
confidence, sources, rubric, time and signed annotation/blinding references, preserving
disagreements. The shared context excludes labels and case/source receipt references;
blinding depends on an annotation receipt and adjudication on completed independent
rows. Nothing points back to adjudication, so this remains an acyclic signing sequence.
Existing sampling frame/assembly references stay bound by EX17.

There is no legacy fallback or automatic re-signing. A changed subject, claim mode,
source revision or other bound context requires actual independent re-review, new
annotation/blinding receipts, then adjudication of those exact annotations. Replacing
IDs, hashes or a wrapper label is not re-review. Existing same-ID label receipts do not
silently become valid for a new context. No actual corpus migration occurs because the
real manifest is empty and remains unchanged.

Post-fix genuine-signature scratch evidence confirms the boundary: baseline ready/no
findings; fully re-reviewed changed-context labels ready/no findings; transplanting the
five exact old signed envelopes and refs into that changed context yields blocked with
two independent-annotation, two blinding and one adjudication unverified findings.
All results remain not_frozen. These are fictional ephemeral test keys and corpus only;
private keys stay in process memory. No real people, permissions or source truth result.

Validation used `.discovery-work/wp12/run.sh` with workspace Node v22.23.2 and a
sanitized environment preserving HOME. Scoped no-emit TypeScript passed. The initial
77-test regression run passed 76 and failed the old case-binding fixture's baseline:
its fixed four receipt-hash propagation passes no longer cover the extended sampling
frame → assembly → annotation → blinding → adjudication dependency chain. A six-pass
scratch construction resolves the acyclic chain and passes full authentic verification.
That failure log is retained; no old tests were edited by this owner. Terra/root own
fixture convergence updates and the new permanent independent mutation tests. The
owner scratch proof is not a substitute for those final independent results.

| Evidence | SHA-256 |
| --- | --- |
| src/ingest/discovery-evaluation.ts | 678353d5066f5d8326b65ad5bea3bb249ab4143cc70214cd41e4330dd1194f02 |
| .discovery-work/wp12-wp03-sol/label-replay.ts | 9fe8a2cfc4639ece7e1d867bbb10a354673a34e05d024506b0340b6f33d86ba9 |
| .discovery-work/wp12-wp03-sol/label-replay.json | 90a8146b5d87b5cc6c3a69f10fdd742ff2aa156fa4a451481c4ece355f018354 |
| .discovery-work/wp12-wp03-sol/label-binding-after.ts | 20e796745f93ff274348ab817783dd6513738c1bd1185f1c0e348ec2bed8eaf8 |
| .discovery-work/wp12-wp03-sol/label-binding-after.json | 5a76ee7aad85f001ef7f500d924075da8176fdadca8e446210fa0aa961cab53f |
| .discovery-work/wp12-wp03-sol/tests.log | d363b4831d3d3b9fa29db1ceed179c625578797e35f312e6043f6e3cd25b4ead |
