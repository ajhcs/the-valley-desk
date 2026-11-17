# WP03 case-selection attestation

Preparation correction only. The actual reference manifest has zero cases and
remains blocked/not_frozen. This change does not enroll reviewers, grant source
rights or freeze a corpus.

The earlier selection expectation omitted county disposition, route appearances
and challenge tags used by readiness. Terra and Sol independently reproduced a
modified fictional manifest returning ready with its unchanged signed receipts.
The corrected expectation uses `discovery-case-selection-review-v2` and binds:

- Manifest revision, rubric, policy and evaluation design.
- Every case descriptor: id, partition, subject, claim mode, primary route,
  appearances, counties, countyUnknown, families, sourceIds and challenges.
- Referenced source snapshots, sorted by source ID: id, revision, native identity,
  origin family, observation time and representation digest. Missing sources stay
  explicit null entries and retain their separate validation finding.
- The existing partition-specific sampling object, including its receipt refs,
  or null where no sampling partition applies.

Case annotations, adjudication and receipt references, and source evidence and
permission references, are excluded from this payload. Their existing separate
receipt checks still apply. This avoids circular annotation/receipt dependencies
and permits renewal of a receipt for unchanged underlying evidence. Replacing
source metadata under the same source ID invalidates selection even if its new
evidence/permission receipts are otherwise valid.

Old partial selection receipts deliberately fail the new expectation. There is no
legacy fallback, automatic upgrade or signing tool. An accountable reviewer must
review the exact case/source/context again, obtain an independently authenticated
selection receipt for that payload and update its reference. Copying a checksum
or version string does not accomplish re-attestation. The actual empty manifest
has no real selection records to migrate. Earlier synthetic receipts remain
retained as historical and rejection evidence.

This is case-selection attestation, not a signed whole-manifest snapshot. Manifest
creation time and array ordering are not newly attested as freeze facts. Source
and case truth, human independence, permissions, current trust/clock/revocation,
sampling quality and accountable freeze remain external requirements. No threshold,
manifest schema, native model or corpus status changes.

Sol owns the correction; Terra tests descriptor mutation, valid source replacement
with stale selection, signed legacy rejection and fresh re-attestation; Astra
reviews and challenges those cases independently. Complete signed fixtures use
fictional people, labels and ephemeral keys only. Their ready result still means
ready for accountable freeze review, with freezeIssued=false and packageAccepted=false.
