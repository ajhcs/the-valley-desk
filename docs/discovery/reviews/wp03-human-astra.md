# WP03 human-review workflow independent review

Independent Astra engineering review of the offline human-review preparation,
dispatch, return and adjudicator-handoff increment. This is not an independent
human annotation, source-rights decision, corpus acceptance or freeze.

The implementation, operating procedure and final CLI guide pass this bounded engineering review
after the corrections below. The actual strict reference manifest remains empty
and `not_frozen`.
No actual reviewer, signature, permission, label or source-family determination
was created by this review. Synthetic signing keys existed only in process memory.

## Findings corrected during review

- An asynchronous input mutation could change labels after signature validation:
  the adjudicator handoff re-read caller-owned returns after awaited verification,
  and the return checker cloned its preserved original only after those awaits.
  An independent genuine-signature reproduction changed labels/rationale during
  the blinding lookup and observed unverified content in the handoff. The fix
  snapshots manifest, packets and returns before awaited work and derives output
  from those snapshots. The failing reproduction is retained; its fixed rerun
  passes.
- The packet duplicated the subject-kind enumeration and omitted native `account`
  subjects. It now reuses the native subject schema.
- The first packet lacked neutral source revision, observation-time and
  provider/native metadata needed to interpret the original evidence. These
  fields are now whitelisted; receipt contents, family conclusions, predictions,
  peer labels and adjudication remain absent.
- Sol identified that a two-return handoff could omit an existing third manifest
  annotation. The handoff now refuses any already-integrated annotation set;
  independent testing confirms the refusal with a genuinely signed third review.
  Full-set adjudication remains the accountable native workflow.
- The operating procedure now explicitly treats original content as untrusted
  data, requires controlled source/rubric and underlying rights evidence access,
  and holds duplicate or unexpected returns under the external handoff ledger.

## Verified boundaries

The tests use the existing readiness verifier to construct fictional EX17 and
EX20 expectations, then sign them with ephemeral Ed25519 keys. They do not derive
native expectations from the new human-review helper. Independent checks
cover signed-context compatibility, source-byte changes, changed case/policy/rubric
context, rehashed packet attacks, reviewer/label/source mutations, duplicate
reviewer pairs, unsigned-return hold, and the asynchronous mutation regression.

Independent subprocess checks cover native signed return verification, exact raw
return-byte preservation, separately selected policy-file checksum, forged
signatures, final/ancestor symlinks, hardlink aliases, normalized paths, absent and
nonregular inputs, duplicate and escaped JSON keys, invalid UTF-8, oversized
originals, private output modes and no-clobber behavior. Encoded source instructions
remain original data. Diagnostics do not reveal synthetic source/reviewer content.

The source-preparation draft has no reference-case credit, dispatch authority or
labels. Reviewer IDs, signatures and private mode bits do not prove distinct
humans or operational blinding. Native EX20 binds case/source context and
annotation/blinding content, not a new delivery round. Same-context replay and
same-person aliases require the controlled external identity/assignment ledger;
local verification remains a detached proposal. Two verified returns preserve
genuinely signed disagreements and leave adjudication null. Existing native
signed-label tests continue to reject changed-context labels and stale adjudication.

## Sampling, freshness and evidence

Independent fixtures establish successful first-review dispatch for authenticated
complete 360-case, six-route held-out frames and 100-case recall frames without
prepopulated labels. Tests reject development/held-out contamination through a
recall bridge, exposed connected families, unknown exposure IDs, reused revisions,
and prior exposed or differently labeled family history. Missing or forged sampling,
assembly and history records fail. The gate uses all current case descriptors and
the native family, subject, provider/native and byte identities; it does not infer
missing real-world relationships. Audit execution remains WP24.

Private evidence is retained under `.discovery-work/wp03-human/astra/`:
`final-independent.log` records 22 passing independent core/CLI/freshness groups;
`final-native.log` records 21 passing existing native case, label and CLI regression
tests. `final-structure.log` records seven passing structural-gate tests, also
reviewed to confirm that structural readiness does not imply authentication.
`adversarial-race-before.log` retains the original asynchronous mutation
failure; `freshness-before-integration.log` retains the expected missing-guard
failures before integration. Fixture and test sources are retained beside them.
Checks used the qualified workspace Node 22.23.2 runtime. No completed human
record or source body is copied into this review document.

The final CLI guide was checked against the frozen operations, bounds, private
file handling and native signature/context contracts. Its descriptions distinguish
verified reviewer IDs from actual human independence and accurately scope hardlink
alias rejection to selected inputs. Independent readback of the actual preparation
request/output confirmed eight groups (six project and two background), 16
acquisition records, 14 body hashes, 16 blank reviewer slots and 128 null labels.
Every draft remains blocked, development-exposed and undispatched, with null case,
context and adjudication fields and zero reference-case credit. Request/output
hashes and 0700/0600 modes match the preparation receipt; the manifest bytes match
HEAD. Evidence is retained in `final-preparation-check.json`.

The actual manifest was read back with zero cases, sources and reviewers. Real
operator trust, current revocation/clock policy, source permission,
accountable independent humans, source-family review, representative fresh frames,
complete exposure history and separately authenticated freeze are external inputs.
Local software verification cannot satisfy those missing WP03 inputs.
