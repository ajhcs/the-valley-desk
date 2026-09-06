# Leadership history review gate

The 205 dynamically enrolled roles (204 closed) are a review population, not a
repair list. Migration 0027 and the preventive verifier fix must not reopen any
row. Deployment approval remains blocked until this separate review is signed.

## Ownership and evidence standard

- Cole Lyons (editorial owner) owns the historical disposition.
- Knox (engineering) produces the read-only export and evidence bundle.
- Each closed role needs two complete, independent, registered first-party
  leadership-roster observations covering the relevant effective date. A
  person biography, search result, newsroom item, or incomplete roster cannot
  establish absence.
- The two CHOP roles identified in
  `leadership-identity-trace-2026-09-06.md` must be individually represented in
  the manifest; their shared timestamp is not evidence that either closure was
  correct.

## Required reviewed manifest

Run `leadership-role-audit.sql` read-only and create an off-repository restricted
manifest with one row per dynamic role:

```text
role_id, person_id, display_name, institution_id, title, source_id,
effective_from, effective_to, roster_1_url, roster_1_observed_at,
roster_1_complete, roster_2_url, roster_2_observed_at, roster_2_complete,
disposition, rationale, reviewer, reviewed_at
```

`disposition` must be one of `confirmed-closure`, `suspect-closure`,
`indeterminate`, or `still-open`. Counts must reconcile to 205 total and 204
currently closed roles. The reviewer signs the manifest hash and records the
two CHOP role IDs explicitly.

## Repair boundary

No SQL update belongs in this review. A suspect or indeterminate disposition
may propose a later repair, but reopening a role requires its own reviewed,
idempotent manifest, Time Travel bookmark/export, dry run, and explicit
production authorization. Blanket reopening is prohibited.
