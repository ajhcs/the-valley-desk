# WP03 label-context binding — Astra independent review

Disposition: recommend accepting this bounded receipt-contract correction, subject to root's integration qualification. No remaining blocker found in the reviewed evaluator. Real corpus population remains zero, WP03 remains incomplete, and no freeze or accountable acceptance is implied.

The independently reported signed reproduction changed the subject, claim mode and source revision, legitimately re-attested the source/family/selection context, and reused the old annotation, blinding and adjudication statements while retaining readiness. The correction wraps all three purposes in explicit v2 domains and binds each to the exact EX17 case-selection context digest. It does not silently reinterpret legacy statements or migrate signatures.

The context includes manifest policy/rubric/design/revision, all case descriptors, source identity/revision/origin/time/representation snapshots, and partition sampling. It excludes annotations and receipt references to avoid cycles. An annotation binds its own payload and context. Blinding binds that context and the annotation receipt. Adjudication binds its own payload, context, and complete annotation set including annotation and blinding receipt references. A changed annotation or replacement receipt therefore invalidates stale adjudication without introducing a dependency on its own signature.

Independent validation:

- Reran the permanent authentic Ed25519 suite: stale label statements fail after separately re-attesting changed subject, claim, policy or source context; all legacy purpose payloads fail; changed independent judgment cannot retain old adjudication; complete re-attestation restores only `ready_for_accountable_freeze_review` and `not_frozen`.
- Fourteen additional structural checks passed. Explicit expected wrapper digests match; county, county-unknown, family, challenge, source identity/time and manifest changes alter all five label-related expectations. Annotation receipt replacement changes blinding/adjudication while leaving its own payload digest and selection context unchanged; adjudication receipt replacement has no self-dependency.

The fixture receipt generator must converge over this longer acyclic chain before signing. Increasing its convergence rounds is test construction, not a verifier fallback or authorization relaxation. Structural expectation capture is not presented as cryptographic evidence; the permanent suite exercises authentic signatures separately.

Reviewed SHA-256:

- `src/ingest/discovery-evaluation.ts`: `678353d5066f5d8326b65ad5bea3bb249ab4143cc70214cd41e4330dd1194f02`
- `test/discovery-reference-label-binding.test.ts`: `971d165f5f1c4f62cc5f18af1413ac26d16778d3e8c16b1ea97fcace7d575623`
- `.discovery-work/wp12-astra/label-context-probe.ts`: `b1fe289f6b442d48b0b67599a44fdd59cbd233262692755d698eeb875e119e3b`

Logs: `.discovery-work/wp12-astra/label-binding-permanent.log` and `label-context-probe.log`. Only synthetic local inputs were used; no enrollment, trust installation, or real annotation occurred.
