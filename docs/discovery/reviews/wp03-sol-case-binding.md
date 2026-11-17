# WP03 case-selection receipt binding — Sol

2026-11-15. Preparation correction only; WP03 remains incomplete. No actual cases,
human reviewers, enrolled public keys, permissions or freeze were created. The actual
zero-case manifest and all thresholds/schemas remain unchanged.

The previous selection receipt bound partition, claim mode and primary route, but
omitted county disposition, appearances and challenge descriptors used by readiness.
The family receipt covered subject/families/source IDs only. I independently reproduced
Terra's finding using the existing wholly synthetic signed full fixture: changing the
first case's counties to NJ:Camden and countyUnknown to true, with an unchanged signed
bundle/policy, left both baseline and mutated readiness at
ready_for_accountable_freeze_review with zero findings. This was a replay of previously
generated synthetic records, without new signing/key generation. The failing pre-fix
evidence is retained under `.discovery-work/wp11-wp03-sol/descriptor-probe.json`.

Changed only the existing selection expectation in `discovery-evaluation.ts`. Its new
canonical payload is:

```ts
{
  schemaVersion: "discovery-case-selection-review-v2",
  manifest: { revision, rubric, policy, design },
  case: {
    id, partition, subject, claimMode, primaryRoute, appearances,
    counties, countyUnknown, families, sourceIds, challenges
  },
  sourceBindings: [
    { id, source: { id, revision, identity, originFamilyId, observedAt, representationSha256 } }
  ],
  sampling: existingPartitionSamplingOrNull
}
```

`sourceBindings` is sorted by source ID; a missing referenced source remains an explicit
`{ id, source: null }` entry plus the existing unknown-source finding. Case descriptor
arrays retain their declared order. The payload omits case annotations, adjudication and
receipt refs, and source evidence/permission refs, avoiding annotation/receipt cycles.
The existing sampling object, including its frame/assembly/procedure refs, remains bound.

Source evidence/permission expectations already bind source identity, revision, time,
origin and representation digest. Unsigned source edits therefore already fail those
receipts. The added source snapshot also prevents an old case-selection attestation
from silently applying to a separately re-attested replacement source under the same
source ID. The selection reviewer must now review the actual referenced source revision.

This intentionally invalidates legacy partial selection receipts. There is no fallback
and no automatic migration/re-signing. After accountable re-review, obtain a new
selection receipt for the exact v2 payload and update its reference. Re-attestation is
not accomplished by copying a hash or version label. No real migration is required by
the actual empty manifest. Receipt authenticity still depends on separately enrolled
trust and does not establish source truth or human agreement.

I evaluated a blinded reviewer packet exporter before this change. The protocol requires
permitted original evidence and independent reviewers, but the manifest currently holds
only references/digests, a rubric reference and no real permitted material. Another
export helper could only emit pointers or add an unimplemented evidence-store seam;
it could not establish original access or blinding. The authenticated descriptor gap
was a concrete correction to the existing readiness path, so no packet helper was added.

Validation on workspace Node v22.23.2, sanitized environment, original HOME preserved,
TMPDIR/XDG_CACHE_HOME/npm cache under `.discovery-work/wp11-wp03-sol/`:

- Existing evaluation, receipt, signature and CLI tests: 76 passed, 0 failed.
- Scoped no-emit TypeScript check of discovery-evaluation.ts: passed.
- Independent permanent fully signed mutation/re-attestation tests are owned by Terra
  and reported separately. Existing 76 tests alone do not demonstrate the new gap closed.
- `not_frozen` semantics and no acceptance/freeze issuance remain unchanged.

Pre-fix probe SHA-256:

| Evidence | SHA-256 |
| --- | --- |
| descriptor-probe.mts | b0f44e81ca300fd8a562e396284b89d136b1439be0a272f708cb15efe8b7bdd6 |
| descriptor-probe.json | c940fe06d11e364d194a8811cb0e9573f04d3cbed9013b88e1b150564be82abb |

Implementation SHA-256: `cf088cfa1d8f36f69884abb6e7fa954f568005e5ca563cc6ceb405944af23a8d`.
