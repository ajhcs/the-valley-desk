# WP03 signed labels and review context

This preparation correction does not create real cases, human authority or a
freeze. The actual manifest remains empty, blocked and not_frozen.

The earlier annotation/adjudication expectations bound source IDs and rubric but
not the exact case or source revision. Independent genuine-signature experiments
changed a case's subject/claim mode and source revision/bytes, legitimately
re-attested source/selection records, and still reached readiness using the old
unchanged annotation, blinding and adjudication signatures.

Each case now computes the digest of the exact EX17 review context once: versioned
case descriptors, manifest revision/policy/rubric/design, sorted source snapshots
and partition sampling. Labels and receipt refs are outside that context.

- `discovery-independent-annotation-v2` binds contextSha256 and the existing
  annotation payload under its original purpose, case ID and reviewer principal.
- `discovery-blinding-v2` binds the same context, reviewer/rubric and exact signed
  annotation receipt reference.
- `discovery-adjudication-v2` binds that context, the existing adjudication payload
  and the complete independent annotation set, including annotation/blinding refs.
  Changed disagreement evidence therefore invalidates a stale adjudication.

The dependency graph is acyclic: source/sampling context, independent annotation,
blinding, then adjudication. No expectation includes its own receipt. The older
synthetic fixture's fixed four hashing rounds no longer construct the deeper
graph; its bounded eight-round setup change is fixture migration, not a runtime
fallback or permission to accept old signatures.

Legacy expectations deliberately fail. An accountable independent reviewer must
re-review the actual context, labels and disagreement basis before new authenticated
attestation. Copying a digest, changing a version label or mechanically re-signing
old labels does not establish that review. No signing or automatic migration tool
is added. Real trust enrollment, current policy/clock/revocation, permitted original
evidence, human independence, sampling quality and reference truth remain external.

Sol implemented; Terra tested authentic old-envelope replay and fresh controls;
Astra independently inspected wrappers, context changes and dependency cycles.
Both old and new evidence remain retained. Ready still means only ready for
accountable freeze review, with no corpus freeze or package acceptance.
