# WP02 independent review — Sol

Status: independent review complete; recommend accepting WP02 for its local
model/interface/contract scope. Root retains package acceptance authority.
Historical reproduction, the final successor and actual TypeScript contracts
were inspected together. This review does not accept future SQL/API/provider or
empirical obligations.

## Historical reproduction inspection

Reviewed `wp02-baseline-reproduction.json`, all decisive raw checker reports,
the selected driver, command history, original scopes/model, and file manifests.
The 14 recorded commands exited zero. Independent hash readback found no mismatch
among 242 output-manifest files, 107 installed CSE runtime files, 100 private
parser-dependency files and 71 retained engineering files. All 21 selected frozen
originals match their scratch copies, allowing the documented historical receipt
rename. Frozen-before and frozen-after manifests are identical. The driver
adaptation diff is empty; private environment/cache paths remain on `/workspace`.

The raw results support exactly the claimed scope:

- Native parser: OMG SysML v2 Pilot 2025-09/kernel 0.52.0, model SHA-256
  `2db650c71d7a8703ff01b814e1db84629b33c9de99b702e2d90bad30235387a9`,
  no parser findings; selected concept/terminology checks pass.
- Native-record inspection checks the retained 44 fields and seven inheritance
  cases against the retained record-scope hash. Documentary coverage includes all
  60 expected IDs with no `not_run` member, while acceptance remains unevaluated.
- Finite workflow completes all six retained obligations; native function/flow
  completes its six obligations and reports native execution unsupported and
  transformation correctness unevaluated.
- Pinned Z3 5.4.1.0 reproduces 74 symbolic lemmas in 30 SMT families. The declared
  Boolean lifecycle explores 320 states/2,348 transitions from 64 initial
  contexts. Separate CLI replay reports all 74 with no failed replay; all 30
  negative controls are detected. Replay uses the same solver implementation,
  not an independent proof kernel.

The full retained scope hashes match the frozen proof, documentary and native
record scopes. No historical obligation or assumption was narrowed. Excluding
v0.3 comparison and old diagrams is explicit and consistent with this selected
baseline reproduction. This result establishes neither successor correctness
nor source/provider truth, D1 interleavings, empirical E01–E06, or deployment.
There is no concern requiring a redundant rerun of the fresh historical checks.

## Successor review matrix

These are required inspection and adverse-case targets from accepted WP01 and
WP02, not findings against code that has not yet been supplied.

| Boundary | Decisive cases and expected observation |
| --- | --- |
| Authority | A model proposal, JSON `authorityKind`, forged reviewer ID, parsed accepted-looking receipt, or engineering-agent label cannot authorize publication. Review target covers person/organization, work, claim and relationship revisions. Real authorization must come from the trusted caller/store boundary; shape parsing supplies no authority. |
| Complete dependencies | Evidence/claim/decision, endpoint and relationship, identity resolution, rights, source enrollment/configuration, qualification and each permission activation/revocation, verification rule, all applicable policy heads, expiry and projection generation are explicit immutable revisions or monotonic heads. Changing any one after preparation rejects the entire publication. A→B→A content restoration still changes revision identity. |
| Atomicity | Pseudocode checks every dependency and authenticated authority inside the committing transaction, then writes immutable row, generation/invalidation changes and durable operation result atomically. A zero-row conditional UPDATE cannot allow later writes. Timeout replay resolves the previously committed operation. Actual D1 qualification remains WP16/WP23 evidence. |
| Typed identities | Creator/person/organization, source account, project, artifact and artifact version remain different types/namespaces. Provider installation/instance belongs to native identity tuples, particularly forums. GitHub rename/transfer retains native ID; forks and independent forum installations differ. DOI/PMID/arXiv equivalents and preprint versions require explicit relations rather than untyped identity collapse. |
| Optional joins | Independent creator has no work prerequisite. An organization-authored paper or qualified forum account can retain an unresolved optional person join. Required creator-role/geographic evidence still gates work; account and person are never merged by name or membership. |
| Time | Reject impossible days/months, leap-day errors, year zero and noncanonical instants. Preserve year/month/day/instant/unknown precision, supported half-open bounds and source timezone/unknown basis. Explicitly define filtering when source timezone is unknown instead of silently inventing UTC. Unknown dates cannot satisfy positive filters; whole partial interval containment is required. Current presence and contribution-time geography remain separate. |
| Rights | Paper/forum/code/data/weight/text/figure/metadata scopes have versioned target/evidence and unknown/restricted values. Source fetch, retain, transform and display permissions are separate. Independently permitted metadata may survive a material hold; blanket public-access permission cannot leak restricted material. Creator-profile material needs applicable display authority too. |
| Snapshot/query | Immutable public-row revisions, actual canonical query, all ordering coordinates, generation, eligibility-as-of, invalidation epoch, external recovery incarnation, expiry and page contract bind a snapshot. Work/people/organization ordering, OR-within/AND-between facets, distinct terms and unknown facts follow the frozen policy. |
| Continuation/recovery | Query/cursor mismatch or malformed input returns 400. Material correction/policy change or expiry returns 410 with preserved query and restart. No silently shrinking membership. Restoring old matching D1 heads cannot revive an old cursor or revoked content after external-incarnation rotation. |
| Input strictness | External request and nested discriminator schemas reject unknown fields, invalid kinds, duplicate dependency keys, impossible intervals, unsafe numeric IDs and oversized arrays/text. Public DTOs are explicit allowlists. A successful schema parse is not admission/publication authority. |
| Six routes | One fixture each for GitHub, PubMed, Crossref, arXiv, enrolled forum and institution/association, with no universal repository prerequisite and precise provider/native IDs. Permission/enrollment is a future actual input, not conferred by the fixture. |

## Pending acceptance review

The initial interface candidate raised these concrete questions for its owner.
The amended specification resolves all four at the document level: explicit
commit-only projection generation, bounded public-row expiry, a uniform calendar
range, and embedded exact request/provider/installation/parser binding. Concrete
schema/model rejection and correspondence checks remain pending:

1. **Generation dependency semantics.** Start with row A published at global
   generation 1 and a dependency on the current `projection-generation` head.
   Add unrelated row B and advance that global head to 2. Treating A's generation
   dependency as live eligibility would invalidate A and every existing snapshot,
   contrary to the stated rule that ordinary additions preserve old snapshots.
   Separate the expected generation compare-and-swap and immutable publication
   coordinate from applicable live dependency validity; identify any subject-local
   generation explicitly.
2. **Public revision expiry.** The initial snapshot schema explicitly bounds
   expiry by dependency expiries, while `DiscoveryPublicRevision` only lists its
   dates. A row published at noon with a material dependency expiring at 12:01
   cannot claim expiry at 12:10, nor may expiry precede publication. Require the
   same conservative bound in the public-revision contract/type and test it.
3. **Calendar upper-bound range.** A day `9999-12-31` requires upper bound
   `10000-01-01`, which is outside a four-digit date schema. Freeze one consistent
   supported range across year/month/day/query bounds and helpers; reject rather
   than overflow or invent precision at this edge.
4. **Request/page binding.** A structurally valid forum observation from
   installation B must not be committed as the result of installation A's
   request, nor may parser/configuration revision drift hide inside a page. The
   page's source/run/operation IDs and observations must bind to the actual
   trusted request's provider, installation, scope and parser qualification at
   commit. A subject-kind equality check alone is insufficient.

Root separately raised missing IF04 expected dependencies, a source-qualification
bootstrap cycle, independent reuse permission, punctuation-only query handling,
and snapshot subject/row uniqueness plus entity compatibility. Those amendments
are present in the revised blueprint; actual implementation review remains.

## Concrete contract findings and follow-up

**Typed review union — resolved.** The initial
Zod variants used broad `DiscoverySubject` with a Boolean refinement. That
rejected account-as-creator and person-as-work at parse time while leaving the
same invalid combinations in the inferred TypeScript type. The owner replaced
these with branch-specific strict subject schemas. Root's
`test/types/discovery-contracts.ts` asserts exact creator/work kind unions,
excludes model authority, and checks sample versus qualified collection types;
`tsconfig.discovery-contracts.json` checks that file under the project's strict
compiler settings. These are real type assertions rather than `tsx` comments.
The reviewer's attempted legacy TypeScript compiler API probe could not run
because installed TypeScript 7 exports version information at its root; no
virtual type-check result is claimed from that failed probe.

**Capture versus durable acknowledgment — resolved.** A legitimate
first provider page can contain a next-page token before persistence. The initial
`DiscoverySourcePage` rejects `{committed:false,nextCheckpoint:"page2"}`, forcing
the continuation metadata to disappear or the collector to claim commitment
before it occurs. IF02 needs a provisional capture with a proposed checkpoint
distinct from its durable acknowledgment. Astra agreed to add
`DiscoverySourceCapture` as collector-to-evidence input and reserve
`DiscoverySourcePage` with `committed:true` for the durable receipt returned after
the transaction. The final code and ninth runtime test implement this split:
proposed continuation survives capture; capture cannot claim a receipt; a durable
acknowledgment rejects `committed:false`. Parsing either structure does not itself
prove persistence.

Root's dedicated local smoke change was also inspected: both Wrangler D1 calls
force `--local`, the fake-only fixture config and checkout-owned persistence.
`../../../migrations` resolves from the fixture directory to this repository's
migrations. The fixture contains no production account, route, cron, email or
Worker entry. Existing injected mock automation/in-memory SQL behavior remains
bounded; the diff is suitable for the local check. Actual smoke pass evidence
belongs to root's later run.

**Native review discriminants — resolved.** Initial native
`CreatorReviewTarget` and `WorkReviewTarget` specialize the abstract target and
add correctly typed endpoint references, but inherit unrestricted `targetKind`
and optional `subjectKind`. Without fixed/derived values, a creator subtype can
carry `targetKind=workTarget, subjectKind=account`, inconsistent with the strict
TypeScript union. This is a source-level correspondence counterexample, not a
claimed solver or native-execution result. The final abstract native target holds
only its expected revision. Its concrete subtype and typed reference derive the
runtime discriminator and identity; contradictory mutable copies were removed.
Creator/Work are abstract families with their original specialization IDs intact.

**Refinement guard evidence — resolved after root challenge.** In the initial RF03
driver, `commit` used an unconstrained Boolean `headsMatch`, while each
`stale_kind` case independently proved `actual != expected` implies inequality.
That tautology does not prove a stale vector prevents the modeled commit. Link
the full named vector's revision equalities into the actual modeled commit,
then prove any stale required entry and ABA prevents it while other gates remain
satisfiable. The negative control must demonstrate a mutated value-only guard
admitting equal-content/stale-revision ABA. RF02's rights-reuse result should
likewise bind actual assessment reuse to the complete version/material target.
The final driver now uses the same quantified aligned-revision-array predicate
inside `commit`, for 1–512 required slots. It proves rejection at any stale slot,
each of the 18 named dependency kinds, and revision+2 ABA despite equal content;
other guards remain satisfiable. The mutated content-only guard actually permits
that stale commit. RF02's reusable predicate now combines exact artifact/version/
material equality with explicit reuse permission; omitted-key mutants are
detected. Attempt 4 identifies these revised model/driver bytes and retains the
earlier attempts. These remain abstract modeled guards, not executable SQL.

## Final evidence and recommendation

The final native model SHA-256 is
`49dfd2946f5fb78615a0bd59c60f883ddaa8463bf791a8e58c41317fc8d67817`.
The interface contract SHA-256 is
`c80b8a6efa3d4a4cf4f024590723d3a9b13ce408bfc136bd72458b7ec41f44ae`.
Every input hash in `model-v0.5/validation/receipt.json` matches current files.
All 978 retained output files match the manifest by bytes/SHA-256; its own hash
`5265e8c3f09da5d1e0cb641321626dc8490651fc509fa64e3b9f128357010243`
matches the receipt. Attempt 4's 14 command outputs match their recorded digests,
with no failed command, finding, missing obligation or failed replay in the
decisive reports.

The fresh successor checks cover 114 native fields/11 specializations, 63
documentary expectations, all retained historical mathematical/finite checks,
and RF01–RF09's 59 explicitly mixed inventory/symbolic/truth-table cases,
13 detected negative controls and 256 snapshot-flag combinations. The original
44 field roles and seven specializations remain; exactly two snapshot field
types refine to immutable row references. All 63 original native short IDs
remain. The frozen proof/documentary scopes and historical proof drivers remain
unchanged. E01–E06 remain `not_run`.

After the final capture/ack change, Sol independently ran these focused commands
with sanitized `env -i`, Node 22.23.2 and workspace TMPDIR/XDG paths:

```sh
node --import tsx/esm --test test/discovery-contracts.test.ts
node_modules/.bin/tsc --project tsconfig.discovery-contracts.json
```

The nine runtime tests pass with no skips; the compile-time contract fixture
passes. The real `posttest` now invokes `test:discovery`, whose first step is the
type-check command, followed by explicitly enumerated discovery runtime tests.
These results are bounded contract checks; they do not authenticate callers,
derive trusted dependency completeness, execute real D1 publication, observe
HTTP/cache behavior, or qualify providers.

### Final source-version and fixture readback

The author froze a final limited amendment after the earlier review of interface
hash `a8e9a996...`. `DiscoverySourceObservation.sourceVersion` is now an optional
1–200 character string, separate from stable native identity. The named synthetic
cases now explicitly show GitHub numeric repository identity/captured version,
PMID, Crossref DOI with organization-evidence reference, arXiv stable base plus
`v2`, separate forum work/account identities, and an institutional person without
work. Empty and oversized source versions fail. These are source-version and
serialization examples, not verified authorship or regional evidence.

Sol read the actual amended schema and cases, verified every
`final_contract_inputs_sha256` entry against current bytes, and read the final
nine-test pass output. The refreshed receipt SHA-256 is
`b7859e6ca2e41a0743ce575a3cab8cc80b1fb8aaf95a3d87bc2178c63ce5ac6e`.
All previous 967 manifest entries are unchanged inside the extended 978-file
manifest. The model hash and all 14 native command records are unchanged, so no
redundant model/proof run was needed. This limited amendment introduces no new
blocking concern; the acceptance recommendation applies to these final hashes.

| Criterion | Final reviewer disposition and evidence |
| --- | --- |
| AC-WP02-01 | Satisfied for model/type specification: independent person/organization creator targets, work/claim/relationship targets, no artifact prerequisite, strict runtime and compile-time account/person separation, explicit subtype-derived native mapping. |
| AC-WP02-02 | Satisfied for scoped contract: explicit artifact/version/material key, all seven material cases, separate permission dimensions including reuse, unknown/restricted states, coupled modeled key-reuse guard. Actual permitted use requires later source/rights qualification. |
| AC-WP02-03 | Satisfied for WP02 design evidence: complete 18-kind vector, trusted-completeness boundary, coupled stale/ABA checks and real negative mutants, aborting transaction pseudocode and enumerated expiry/fence/budget/replay races. SQL atomicity and real authentication remain later obligations. |
| AC-WP02-04 | Satisfied for sequence/helper contract: immutable row references, actual canonical query, explicit 400 mismatch and 410 invalidation/expiry/restore restart, exact expiry and future-asOf tests, no-store/coherent-read/restore requirements. Real API/storage recovery is unexecuted. |
| AC-WP02-05 | Satisfied for synthetic interface fixtures: all six providers serialize independent subject paths, source/account types stay distinct, qualification sampling avoids a bootstrap cycle, provisional capture precedes durable acknowledgment. These structural fixtures establish no provider access, external authorship or regional truth. |

No blocking WP02 contract/model defect remains after readback. Recommend root
accept this bounded package and freeze its revisions for dependent local work.
Trusted manifest derivation, source qualification, real publication/recovery,
independent reference labels and empirical performance retain their later gates.
