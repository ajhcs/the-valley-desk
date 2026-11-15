# WP04 independent review — Astra

2026-11-14. **Final scoped review recommendation: no unresolved WP04 implementation
blocker found at the revised freeze identified in the addendum below.** The
earlier findings and evidence remain retained here. Root required additional
static account/relation narrowing, artifact-subtype compatibility and
documentation/readability changes; the addendum independently rechecks those
changes. Root has accepted WP02 in `docs/discovery/receipts/WP02.json`. WP04
orchestrator integration/acceptance remains separate; no operational or
source-truth acceptance is implied.

Prior reviewed migration SHA-256:
`c80889186773615f10afd2f52436e9f855ee27d35972bd88f04dd45042644c6c`.
Catalog: `214e50da0c6d0fd226381483ca617365f935e4c62b114cda94ef4632dc0e9e10`.
Store: `b5b345e00b68b9b6618ba96b60555616021fef2989157a18dcde1becf9a1576e`.
Seven reviewed input files, including the shared WP02 schema and interface
contract, were hashed before/after execution with no drift. Full inventory:
`.discovery-work/wp04-review/review-input-sha256.json` and its `-after` sibling.

## Findings and dispositions

1. **P2, resolved: fractional SQL revisions.** The initial migration declared
   INTEGER-affinity columns with only positive/range bounds. An independent
   SQLite insert of entity revision `1.5`, with matching JSON and valid parent,
   succeeded. Application Zod rejected it, but database integrity did not enforce
   the declared integer contract. Sol added explicit integer-type checks to
   revision/reference and guard columns. The identical independent probe now
   fails; the local D1 regression also fails the write without partial state.

2. **P2, resolved: missing evidence arrays passed SQL checks.** An alias with
   valid identity/value fields but no `evidence`, and a decision with valid
   ID/revision/target but no `evidence`, were accepted by SQLite. Missing JSON
   paths yielded NULL, which passed CHECK; `json_each` produced no row to reject.
   Sol added explicit `json_type(...,'$.evidence') IS 'array'` and nonempty bounds
   to decisions, aliases and relations. Independent post-fix probes reject both
   original inputs. These were storage-integrity findings, not an exposed HTTP
   authentication bypass.

Initial accepted counterexamples are retained in
`.discovery-work/wp04-review/sql-shape-probes.json`, against the retained initial
SQL copy. Fixed outcomes and exact final migration hash are in
`sql-shape-final.json`. No failing input or scope was removed to obtain a pass.

## Independent execution and substantive review

Node **22.23.2**, credential-free `env -i`, existing workspace TMPDIR/XDG caches,
telemetry disabled. Ran a private adapted copy of the owner's full local D1 suite:
**8/8 tests pass**, zero skipped. The original six AC assertions were retained;
adaptations change import/config/output paths and add an independent adversarial
subtest. Exact diff, commands and output are under
`.discovery-work/wp04-review/{test-adaptation.diff,commands.json,independent-d1.log}`.
`local-d1-results.json` retains before/after transaction dumps; `review-summary.json`
provides bounded counts. Targeted strict TypeScript checking also passes.

The isolated D1 run applies the complete legacy 0001–0040 migration chain, inserts
a legacy sentinel, applies 0041, compares the legacy schema and sentinel before
and after, and checks foreign keys. The new catalog leaves legacy semantics and
rows intact in that fixture. It uses no production database ID or remote binding,
persists no runtime database, and performs no source/provider acquisition.

- **Atomic writes and replay:** actual statement order is aborting guard, family
  and immutable revision inserts, head advance, durable operation result. The
  stale-CAS guard raises ABORT; it does not rely on a zero-row conditional update.
  Actual D1 batch tests roll back earlier prefix writes and all catalog changes
  after a final-statement failure. Two competing writers produce one winner;
  A→B→A advances the head to revision 5. Independently replaying an original
  revision-1 operation after that advance returns its original result without
  changing the later head or any table. Conflicting operation reuse is rejected.
- **Identity:** source keys include exact provider, installation, kind and native
  ID in both the deterministic digest and SQL unique tuple. Independent cases
  vary provider, installation and kind while retaining native ID `42`; they stay
  distinct. Concatenation-ambiguous tuples also hash differently. Binding an
  existing source identity to another subject is rejected without partial data.
  Matching names and reused aliases remain separate subjects. Equivalence is an
  explicit accepted-target relation, remains retractable by a new revision, and
  never deletes or silently merges the original identities.
- **Typed graph and immutability:** relation-kind predicates and composite
  endpoint foreign keys pin exact kinds/revisions. An accepted decision must
  target the exact relationship/revision. Invalid endpoint inserts abort the
  entire batch. UPDATE/DELETE and conflicting REPLACE are defended; explicit
  insert guards cover SQLite's implicit REPLACE deletion behavior. Head advances
  require a matching pending guard and increment by one. The reviewer inspected
  these SQL conditions, not merely their test names.
- **Independent paths and temporal meaning:** creator-before-artifact and
  repository/project-free paper persist. Year/month/day/instant/unknown dates
  use unchanged shared WP02 helpers; a year does not fit a one-month filter.
  All nine exact county keys are exercised. Outside/unknown counties, unknown
  effective end, expired or future checks, residence/membership and retraction
  do not become current professional presence. The independent added case also
  excludes a future effective start. These checks do not establish geography or
  creator truth and do not infer work-at-creation location from current presence.

## Remaining boundaries

Evidence/decision references are internal persistence anchors, not authenticated
editorial authority. This package has no HTTP route that accepts such authority.
Later protected APIs must derive authority from verified server context; public
projection commits must guard all current dependencies, not merely catalog heads.

Immutable metadata is not a retention exemption. The documented future removal
path requires a separately reviewed authenticated operation/migration when
metadata itself must be removed; raw source content belongs to the independently
removable WP05 evidence store. No current deletion bypass is supplied or required
by this bounded catalog package.

Root still owns package/CI registration, migration-version integration and full
regression qualification. The review does not close WP02, WP05 evidence/rights,
public publication/snapshot concurrency, recovery, empirical E01–E06, deployment
or production readback. No owner source file was edited by this reviewer.

## Final addendum: revised owner freeze

The final checked migration is
`de141d4f4a342747905d69c27629c7a2102097118604336628ba67a35a63cd8d`.
Catalog: `06732d425a2e8934afe4c3b599994554bb4a33d8887e5670975009473caf9683`.
Store: `889df95001abd95023afc9f3323dcd8c48bf54ee1e77da42f331a7d3c3d6424f`.
Eight final input hashes, including the static assertions and shared contracts,
match before/after the independent rerun; retained in
`.discovery-work/wp04-review/review-v2-input-sha256.json` and its `-after` sibling.

The revised owner AC suite plus both independent adversarial subtests passes
**9/9 local D1 tests**, zero failed/skipped. It again exercises the complete legacy
migration chain and sentinel, immutable writes/REPLACE, missing evidence,
fractional revision, namespace separation, stale CAS, final-statement rollback,
concurrent winner, ABA and old-operation replay. The new subtype cases reject
repository/publication artifact-version and equivalence in application validation
and SQL, preserving full before/after state. Same-subtype publication links remain
possible between separate identities.

The added reviewer subtype test goes further: both endpoint payloads claim
`publication`, so runtime shape validation deliberately succeeds, but one stored
endpoint is actually a repository. The database's stored-type comparison rejects
both the version and equivalence attempts with
`discovery-endpoint-artifact-kind`, and the complete batch rolls back. Thus callers
cannot bypass subtype integrity by relabeling endpoint metadata.

I inspected the literal account-kind schema and the individual endpoint union
members. The static negative assertions check ownership endpoints, cross-kind
equivalence and cross-subtype version/equivalence pairs; these are compile-time
constraints, not merely runtime refinements retaining broad inferred types.
`node node_modules/typescript/bin/tsc -p tsconfig.discovery-contracts.json --noEmit
--incremental false` passes, as does targeted strict source checking of the catalog
and store. Readability edits preserve the inspected guard/write/result sequence.

The affiliation comments and handoff now distinguish `validFrom`/`validUntil` as
the supported professional-presence assertion interval from factual employment
start/end. A bounded WP14 assessment needs its own evidence and policy basis;
an unknown employment end is not to be filled from observation time or freshness
expiry. `expiresAt` separately limits usable freshness. An unknown supported
assertion bound still fails this helper. That preserves uncertainty without
requiring a fabricated employment termination.

Final evidence: `independent-d1-v2.log`, `test-v2-adaptation.diff`,
`v2/local-d1-results.json`, `review-v2-summary.json`,
`typecheck-contracts-v2.log` and `typecheck-source-v2.log`, all beneath
`.discovery-work/wp04-review/`. The second rerun used private scratch TMPDIR/XDG
directories, Node 22.23.2, `env -i`, no inherited credentials, no remote bindings
and disabled telemetry. Root owns full build/test/CI/integration acceptance.
Reviewer-owned files are now stable; no further implementation edit is pending.
