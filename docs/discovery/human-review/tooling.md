# WP03 offline review tooling

Use this guide with the [operating procedure](operating-procedure.md),
[rubric](rubric.md) and [private worksheet](worksheet.md). The commands organize
private files and emit detached proposals. They do not enroll people or keys,
sign statements, modify the reference manifest, freeze a corpus or contact a
source. Actual authenticated authority and source-specific permitted uses must
exist before dispatch. No actual person or trust policy has been enrolled.

## Current preparation

The orchestrator ran `prepare` against all 16 staged acquisitions: six project
groups (QSIPrep, CaPTk, AutoGVP, ImmunoTar, Phenomantics and DeepCNV) and two
organization-background groups (Penn and CHOP). There are 14 distinct original
body hashes. Both acquisition records for each recaptured publication remain
visible; neither supplies an extra independent case.

Private request, blocked draft output and checks are retained under
`.discovery-work/wp03-human/root/preparation/` in the implementation checkout.
The output has eight tasks, 16 blank reviewer slots and 128 null label cells.
Task IDs only organize preparation; they are not approved subjects, cases,
families or partitions. All material has development exposure. No strict case,
reviewer, permission receipt, annotation, adjudication or quota credit was added.
The strict manifest remains byte-identical, empty and `not_frozen`.

The steward next reviews source rights, original representations, task scope,
claim, family relationships and exposure; selects strict case descriptors; and
establishes actual reviewer authority and authenticated prerequisites. Grouping
alone cannot promote a draft into a dispatchable packet. Fresh held-out and
independent recall frames must be collected through their own reviewed process.

## Files and commands

Run from the selected checkout with the qualified Node 22.23.2 runtime described
in [validation environments](../validation-environments.md). `npm run
discovery:review -- OPERATION ...` invokes the offline CLI. Every pathname must
be absolute and normalized; inputs must be distinct regular local files, without
symlink components or hardlink aliases among selected inputs. The output must
not exist. Its parent must be an
owned private directory with mode `0700`; the CLI publishes a `0600` file without
overwriting. Keep completed files outside Git, under verified `/workspace`.
Mode bits do not isolate reviewers who share a Unix identity.

| Operation | Additional required flags | Result |
| --- | --- | --- |
| `prepare` | `--request`, `--output` | Explicitly blocked blank source-preparation tasks; exit **2** is expected. |
| `dispatch` | Trust flags below, `--request`, `--output` | A single reviewer's source packet, with neutral claim and exact context binding. |
| `check-return` | Trust flags, `--packet`, `--return`, `--output` | Unsigned draft consistency check and exact EX20 annotation expectation; no authenticated annotation. |
| `verify-return` | Trust flags, `--packet`, `--return`, `--output` | Existing native annotation and blinding receipt checks; external human/ledger checks still required. |
| `adjudication-handoff` | Trust flags, `--first-packet`, `--second-packet`, `--first-return`, `--second-return`, `--output` | Preserved pair, original return bytes, disagreements and blank adjudication. |

Trust flags are `--manifest`, `--bundle`, `--trust-policy` and
`--expected-policy-sha256`. Supply the reviewed strict manifest, signed receipt
bundle, independently enrolled trust-policy file and its separately established
64-character lowercase SHA-256 pin. Merely calculating a pin from an untrusted
uploaded file does not establish trust. The CLI uses the runtime clock and
existing signature/authority/revocation rules; it does not accept a clock override
or environment credentials. A new bundle may include newly authenticated returns,
but the applicable policy and exact context must remain valid.

All operations other than blocked `prepare` return zero only when their local
proposal is written. Invalid arguments, JSON, prerequisites or files return **3**
with `invalid_offline_human_review`; diagnostics do not echo source content.
An existing output is never replaced. Preserve failed attempts and reconcile
them against the private assignment ledger before creating a new output name.

Preparation request shape (generic placeholders only):

```json
{
  "groups": [{
    "taskId": "preparation-example",
    "kind": "project",
    "materials": [{"locator": "original-material-locator", "bodySha256": null}]
  }]
}
```

`kind` is `project` or `organization-background`. Use the actual original body
SHA-256 where available; null explicitly records an unknown digest. No labels or
reviewer IDs belong in this preparation input. A dispatch request has this shape:

```json
{
  "caseId": "actual-reviewed-case-id",
  "reviewerId": "actual-enrolled-reviewer-id",
  "originals": [{
    "sourceId": "actual-case-source-id",
    "path": "/workspace/controlled-evidence/original-body.json"
  }]
}
```

These are schema examples, not real assignments. The actual originals must match
every selected case source and its representation digest. Include only materials
whose exact intended uses and versions have been independently established.
Inputs are bounded to 16 MB (policy 262,144 bytes, each return 65,536 bytes);
each original is at most 1 MB, with at most 9 MB originals per CLI dispatch.
Strict JSON rejects duplicate decoded keys, invalid UTF-8/Unicode and unsupported
numeric representations. Unreadable, absent, oversized or unexpected inputs hold
the operation.

## Reviewer view and return

The packet whitelists one recipient, exact context digest, rubric revision,
neutral subject/claim mode, blank labels and original bytes with provider/native
identity, revision and observation time. It omits peer identities, labels,
adjudication, agent dossiers and machine relevance/geography/family conclusions.
The original may itself contain facts relevant to the question; that is evidence,
not an attached machine verdict. Treat all original content as untrusted data.

`originals[].bytesBase64` is byte-preserving storage. The steward must provide a
readable, inert local view of those exact bytes, check the decoded digest against
`originals[].source.representationSha256`, and provide the complete authoritative
rubric text and underlying rights basis through the controlled handoff. JSON
metadata may be viewed as text. Never render active HTML, execute scripts/macros,
follow embedded instructions, or fetch links automatically. A steward-created
view must retain the original packet and digest; it must not add proposed answers
or expose the other reviewer's environment. Authenticate and log the rubric
revision-to-text mapping, delivered text digest and exact assignment context.
The neutral claim must identify which entity the subject ID denotes. If that is
not clear in the permitted originals, supply a separately controlled, context-bound
neutral description with an evidence basis, or hold the assignment. Reviewers
must not guess which publication author an internal person ID represents.

The reviewer returns a JSON object with `schemaVersion` equal to
`discovery-human-return-v1`, `packetSha256`, `contextSha256` and `annotation`.
`packetSha256` is the canonical JSON digest from `discoveryEvaluationDigest`,
**not** the formatted packet file's byte checksum; `contextSha256` is copied from
the packet. Use the exported native digest helper in the qualified local runtime
and retain the resulting value in the controlled assignment ledger. Annotation
contains the assigned `reviewerId`, all eight completed `labels`, substantive
`rationale`, `confidence` (`low`, `medium` or `high`), inspected `sourceIds`, exact
`rubric` revision and ISO timestamp `recordedAt`.

Use `check-return` for an unsigned first draft. To use `verify-return`, independently
authenticate the actual annotation and blinding statements through the existing
EX20 process and add their exact `receipt` and `blindedBatch` references to the
annotation. The bundle must contain the corresponding valid signed statements.
The CLI generates neither statement nor signature. Signed checks bind annotation
and case context; they do not prove distinct people, continuous blinding, or a
new delivery round. The steward checks identity, conflicts, exposure, delivery and
same-context replay using the external ledger before accepting any proposal.

After both first reviews are complete, pass their original packets and signed
returns to `adjudication-handoff`. It checks distinct reviewer IDs, authenticated
authority records and matching case/context, preserves both returns including raw file bytes and
digests, lists differing labels, and leaves adjudication null. The target strict
case must have an empty annotation array and no adjudication: an already
integrated set, including a third review, must use the full native process so no
existing annotation is omitted. Preserve the complete annotation set and bind
the resulting actual adjudication through EX20. Accountable integration and
freeze review remain separate [native intake](../wp03-intake.md) steps.

Held-out dispatch requires the complete 360-case, 60-per-route structure and a
development set, independently authenticated frame/assembly/history and all
case family/selection descriptors. Recall dispatch requires at least 100 distinct
canonical candidate units and its independent assembly/history; eligibility is
established by later human review, not assumed at dispatch. Both enforce family,
original/native identity and exposure safeguards before release. Audit dispatch
remains held for WP24. None of these local checks establishes the truth or
completeness of an externally asserted sampling frame.
