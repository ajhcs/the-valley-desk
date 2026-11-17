# WP03 case-selection binding — Astra independent review

Disposition: recommend accepting this bounded EX17 implementation increment. No remaining blocker found in the revised selection expectation. This is not WP03 acceptance, source truth, corpus freeze, or trust enrollment; root retains acceptance authority.

The prior implementation was independently reproduced against the complete fictional signed corpus: changing a case's counties and county-unknown disposition retained `ready_for_accountable_freeze_review` with zero findings. The old evaluator snapshot and reproduction remain in `.discovery-work/wp11-astra/evaluation-before.ts`, `case-binding-before.ts`, and `case-binding-before.log`.

The v2 selection digest now binds every readiness-consumed case descriptor, manifest revision/policy/rubric/design, partition sampling, and referenced source descriptors including identity, revision, origin, observation time, and representation digest. Source snapshots are ordered by ID. Evidence and permission receipt references remain independently authenticated; changing those references cannot substitute a changed source descriptor under an old selection. Annotation, adjudication, reviewer authority, exposure, and history content retain their separate receipt checks. There is no legacy-selection fallback.

This attests case selection rather than an entire manifest. Manifest `createdAt`, array presentation order, and the global membership set are not asserted to be signed by the selection payload. Annotation and adjudication payloads are separately authenticated, avoiding receipt cycles. Any changed selected descriptor requires a new selection attestation; the positive re-attestation control still reports `not_frozen`.

Validation used the sanitized Node 22 runtime and synthetic local data only:

- Independently reran the permanent real Ed25519 test: 20 descriptor/context mutation variants, authentic baseline, separately reissued source evidence with stale selection, authentic legacy selection rejection, and authentic re-attestation all passed.
- Nine additional independent checks passed: explicit expected v2 payload digest, all four source identity fields, source-array ordering, intentional `createdAt` exclusion, annotation exclusion, and rejection of all 561 old signed selection records by the current evaluator. Structural expectation capture is distinguished from the authentic signed-bundle rejection in the retained log.

Reviewed SHA-256:

- `src/ingest/discovery-evaluation.ts`: `cf088cfa1d8f36f69884abb6e7fa954f568005e5ca563cc6ceb405944af23a8d`
- `test/discovery-reference-case-binding.test.ts`: `990c4b4f5f8d8319bd72ebe0b659aa556d1d206fa1af6b86cdc57e75984681b8`
- Independent probe `.discovery-work/wp11-astra/case-binding-independent.ts`: `d0f9ab0f94b2c1c33f70c9d7d3d25155b0917093cf7864e9cfe3c283c882c6f2`

Outputs: `.discovery-work/wp11-astra/case-binding-permanent.log` and `case-binding-independent.log`. Real manifest population remains zero and no accountable freeze was issued.
