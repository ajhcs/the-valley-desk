# WP05 independent review — Astra

2026-11-14. **Final independent recommendation: accept the bounded WP05
implementation after root integration checks. No unresolved implementation blocker
found at the final reviewed freeze below.** Root retains package acceptance. The review is limited to the selected
`tvd-discovery-implementation-20261113` checkout and isolated synthetic local D1.
No source qualification, rights truth, authenticated human decision, publication,
production migration, provider request or deployment is established by these tests.

## Initial review invariants

- Capture receipts bind actual supplied captured bytes to stored bytes and a
  separately derived normalized text digest. Re-encoded text cannot substitute for
  captured response bytes. Exact parser/normalizer versions and endpoint,
  enrollment/configuration and captured instant remain pinned.
- UTF-16 offsets must equal the literal stored quote. Typed pointers must resolve
  against the pinned representation and equal the supplied typed value. Invalid
  references fail before an acknowledgment, with no partial persisted state.
- Identical byte re-observation preserves representation identity and records the
  new observation explicitly. An idempotent operation replay does not create a new
  observation or undo later heads. A→B→A values advance revision twice.
- Evidence and claims remain exact-revision references. Contradictions coexist;
  authenticated authority selects a supported head. A caller-supplied authority
  string/object is not authentication.
- Origins are independent of URLs. Three mirrors of one release count once;
  reviewed merge/split changes invalidate affected corroboration decisions.
- SQL transaction guards recheck expected heads, grant/permission revisions and
  lease fences at commit. Stale, revoked, expired and final-statement failures
  abort the entire batch. Durable acknowledgment follows verified commit only.
- D1 plus separate object storage is not an atomic transaction. Either bounded
  payloads and metadata commit together, or the implementation must describe and
  exercise a real staged-object protocol without pretending external atomicity.
- Failure preserves still-permitted prior evidence without advancing last-good
  health or asserting complete coverage. Rights removal separately erases every
  forbidden payload, quote, structured value, claim copy, rationale, private note
  and cached operation result. Replay cannot restore removed content.
- Rights removal retains only the specifically permitted minimal audit metadata
  and invalidates every material dependent anchor. Immutability is no exception.
- WP06 qualification sampling can use an authenticated bounded pending-enrollment
  grant without requiring the completed qualification it is intended to produce.

## Review environment

`bob-admin workspace-status` reported the mounted Samsung SSD 990 PRO 2TB at
`/workspace`, writable, before review scratch creation. The checkout-required
historical production-memory path does not exist; no production inference is made.
Subsequent execution uses existing Node 22.23.2, `env -i`, original HOME, private
workspace TMPDIR/XDG directories, telemetry disabled, a fake local D1 binding,
`envFiles:[]`, `persist:false` and `remoteBindings:false`.

## Acceptance evidence pending

All six actual ACs require independent inspection and execution. Reviewer probes
and input hashes will remain in `.discovery-work/wp05-astra/`; initial failures
will be retained alongside subsequent fixes. No implementation source is owned or
edited by this reviewer.

## Confirmed intermediate findings

1. **P1, open at first complete probe: incomplete scoped erasure.** An origin
   revision 2 containing a synthetic removed-source marker survived revocation of
   its work's retained material. The representation referenced origin revision 1,
   so the revision-2 rationale was outside the traversal. `revocationSurvivors`
   retains the surviving row in `probes-v2/results.json`.
2. **P1, open at first complete probe: unrelated content erased.** The reverse
   removal traversal reached shared enrollment/configuration revisions and then
   every dependent representation. Revoking `artifact/v1/text` tombstoned the
   separate, still-authorized `unrelated:artifact/v2/text` representation. Its exact
   before/after content and tombstone are retained in that same report. A shared
   registry control is not a source-material ownership boundary.

Both counterexamples ran on actual local D1 with the complete 0001–0042 migration
chain, Node 22.23.2 and the credential-free environment described above. Reviewed
source was `38ae83eb0b5341a049c377294880e54c0740eb2b192eb973ad8429606f7d2743`;
migration was `9b1ee1ac078f622c9cd4e73e2ba67bd157d40ff79176a6cf76a8ea2146143835`.
All five input hashes matched before/after. Original probes, snapshots and logs
remain under `.discovery-work/wp05-astra/`; subsequent fixes will be additional
runs rather than overwritten evidence.

The first probe independently rejected malformed pointer escapes, inherited
properties, noncanonical array indexes, array length selectors, non-JSON values,
forged capability tokens, stale catalog-subject decisions and an unchanged-byte
new representation. Each failing mutation preserved the complete database image.
A completed revocation returned a tombstoned replay acknowledgment without any
row change; a new-operation resurrection and direct erased-content reinsertion
also failed. The primary scope's marker was removed from payloads, claims, notes
and receipts; the second probe exposed the later-rationale exception above.

An earlier raw-SQL setup aborted on the newly installed catalog-anchor collision
trigger before its remaining probes executed. This is retained as
`sql-initial.log`/`sql-initial/results.json`, not counted as a completed suite.

## Scoped-erasure fix and second challenge

At schema `34170f09`, store `01e28b2b`, migration `3136be6e`, the two P1 erasure
counterexamples are resolved in actual D1. Every origin revision now declares its
retention-rights owners. Removal walks forward from all grants for the revoked
material/version scope. The newer unconsumed origin rationale is tombstoned, the
unrelated representation is unchanged, and the sentinel has no surviving row.
Source text is rejected in registry-control token fields. Endpoint URLs remain
only in removable origin/representation content, not the membership index.

`probes-v5/results.json` retains full hashes matching before/after. Its additional
checks preserve two JSON keys that differ by Unicode normalization, reject raw
duplicate JSON keys, reject accessor arrays without invoking the getter, and reject
an expired capability even when the injected server clock is backdated. Two
intermediate fixture-adaptation failures remain in `probes-v3.log` and
`probes-v4.log`; they are not successful executions or implementation failures.

Further findings at this freeze:

3. **P1, open: expired owning rights permit new evidence copies.** A capture at
   12:00 with rights expiring at 12:01 accepted a new evidence quote at trusted
   time 12:02. Only the direct representation reference was checked; its owning
   rights expiry was omitted. Recorded as `new-evidence-after-rights-expiry`.
   Required removal must remain possible after expiry under live removal authority.
4. **P2, open: decision scope REPLACE bypass.** Direct `INSERT OR REPLACE` rebinds
   an existing scope key to a different decision ID despite UPDATE/DELETE
   immutability. This is a database-integrity boundary, not a public HTTP exploit.
   The origin-members probe used an outdated five-column fixture against the new
   four-column table and is explicitly not counted as an integrity check.

## Ledger qualification before the source-response amendment

The later ledger candidate resolves findings 3 and 4 and the origin-members
REPLACE omission. Recursive read and commit checks cover owning rights expiry,
tombstones, invalidations and current source-authorization heads. New evidence
from expired owning rights fails without any database change. Historical readback
returns `expired:true`, `usable:false`, `content:null`; authenticated removal still
succeeds after rights expiry. A valid legacy relation with an older unrelated
accepted decision cannot import WP05 evidence; the reverse anchor ordering also
fails atomically.

The independent adversarial run `probes-v7` passes its retained verifier: 17
atomic rejection cases, five pure JSON negatives, exact structured-key fidelity,
scoped erasure, tombstoned replay and foreign-key integrity. Additional numeric
checks reject source integer `9007199254740993` and decimal
`1.0000000000000001` instead of silently rounding; mathematically equivalent
`1e2` remains valid. Durable operations now retain receipt ID/hash, principal ID,
authentication-context ID, action and commit instant under the explicitly required
minimal-audit permission. No opaque capability token or raw grant body is retained.

Independently copied the persistent acceptance suite, changing only import,
configuration and evidence-output paths. `full-ac.log` records **11/11 passing
local D1 tests**, zero skipped, including all six actual ACs, reviewed merge and
split, both catalog-bridge orderings, concurrent winner, stale and final-statement
whole-batch rollback, transitive expiry and scoped removal. Exact adaptation is
`acceptance-adaptation.diff`; before/after input hashes are identical in
`full-ac-inputs-before.json` and `full-ac-inputs-after.json`.

The reviewed schema is
`afc66224b2977c81c55b87cba0d371ba2c4afbf73ddaadad46062149945b58a1`.
Full store/migration/test hashes are retained in those inventories and
`probes-v7/results.json`. These results apply to the ledger candidate before the
following amendment, not to untested subsequent changes.

Root identified a first-acquisition integration gap: source-response rights and
provisional provenance are required before a metadata API page reveals its
artifact identities or original-work origins. The accepted design adds an honest
source-response scope, exact trusted issued-request binding, transactional
currentness and provisional provenance that cannot count as corroboration.
Missing trusted request resolution must deny capture. Mapping separate selectors
from one multi-record response to reviewed original works is an explicit later
WP14 prerequisite; intake alone establishes none of those work-level origins.
Final package recommendation remains pending that extension's independent review.

## Source-response amendment review

The amended `56c368d5` / `71d3f09a` / `9446c353` candidate passed the copied full
acceptance suite **12/12**, with all seven reviewed code/test/contract hashes
unchanged before/after. The independent original-artifact adversarial regression
also passed (`probes-v8`). The new `source-response-v1` run verifies 15 refusal
cases and successful intake with zero invented catalog entities.

The source-response test rejects missing request resolution, unrecognized tokens,
wrong mutation digest, substituted endpoint/request digest/scope/enrollment/
configuration/member/request reference, and unresolved-provenance corroboration.
It advances the issued-request head between resolver return and capture batch:
the stale capture and injected prefix row both disappear, while the legitimate
new issued revision remains. A resolver-owned result object is changed after the
await; capture retains the original snapshot, demonstrating the store does not
keep mutable references to the returned grant. Scoped removal erases both issued
revisions, origin, representation and all selected canaries. Tokens do not appear
in any table; old issuance/capture operations return unusable tombstones without
mutation. This is synthetic trust-boundary evidence, not provider qualification.

5. **P1, reproduced after that run: new-grant resurrection.** Sol's owner
   self-review identified a path not covered by old-operation replay. The reviewer
   independently reproduced it in `source-response-v2`: after revoking a material
   scope, registering a new rights ID for that identical scope succeeded; a new
   origin rationale under that grant also committed with `usable:true`. Both
   operations changed the database. The scope tombstone guarded captures but did
   not guard new affirmative rights. The original failing inputs/results and
   stable input hashes remain retained. Final recommendation is withheld pending
   the scope-level guard and its regression.

## Final reviewed freeze and disposition

All five retained findings are resolved at this freeze. The final scope guard
rejects both new rights and permission IDs for a tombstoned material scope; no
implicit regrant path exists. The actual new-rights/new-origin resurrection probe
now rejects both operations with unchanged complete database images.

| Reviewed input | SHA-256 |
| --- | --- |
| `src/content/discovery-evidence.ts` | `463bd9800f627302f32dc181ffdc86832532afad8b703fc4cd8c717fd4f7d5a6` |
| `src/ingest/discovery-evidence-store.ts` | `a91e848e2be895a50c7723b6b0ccd82af6cc69d0aec29d2e0ac8d32c4b277423` |
| `migrations/0042_discovery_evidence.sql` | `e8fd2e35521450de9b1baf3f6b126d561cd53bde0e280d02b66745a4101d5231` |
| `test/discovery-evidence.test.ts` | `ebcdaf88f289c2e4fc26ef1611fa9a56328eeab9b69c7eebe40ffeb87d7b9580` |

The final independent copied acceptance suite passes **13/13 tests**, zero skipped,
against actual local D1 after all migrations 0001–0042. Its copy changes only
imports, config and output paths. Evidence: `full-ac-release.log`,
`acceptance-release-adaptation.diff` and `full-ac-release/local-d1-results.json`.
Seven code/test/contract input hashes match exactly before/after in
`release-inputs-before.json` and `release-inputs-after.json`. Every named path in
this paragraph is beneath `.discovery-work/wp05-astra/`.

The final artifact adversarial regression is `probes-v9`; the final request-binding,
removal and integrity regression is `source-response-v3`. Their result JSON files
retain exact snapshots and complete before/after hash inventories; verification
logs retain successful assertions. The final runs establish:

| Actual acceptance criterion | Independently observed behavior |
| --- | --- |
| AC-WP05-01 | Changing a character outside the quoted span retains both byte hashes and representation revisions; original evidence remains pinned. Original bytes, normalized text and structured JSON preserve their distinct declared meanings. |
| AC-WP05-02 | Invalid UTF-16 spans, surrogate boundaries, JSON pointers and typed values fail with no table changes. Malformed escapes, inherited properties, numeric rounding, duplicate raw keys and getter-bearing inputs also fail. |
| AC-WP05-03 | Identical operation replay returns its original identity, while a later observation is explicit. Repeated bytes do not create a replacement representation. A→B→A policy values advance to revision 3; stale revision 1 still fails, and original operation replay leaves head 3 unchanged. |
| AC-WP05-04 | Three mirrors contribute one reviewed work origin. Reviewed merge and split invalidate prior dependents. Provisional source-response provenance throws unresolved-provenance instead of contributing corroboration. |
| AC-WP05-05 | Contradictory claims and correction history remain separate revisions; one correction advances the decision head, and replay does not advance it again. Stale catalog-subject decisions and both catalog-bridge creation orderings fail atomically. |
| AC-WP05-06 | Refresh failure preserves still-permitted evidence without changing its successful capture/observation. Scoped removal erases quotes, structured values, claims, decisions, notes, later unconsumed origin rationales and issued-request payloads, preserves unrelated material, and blocks old-op and new-grant resurrection. Removal remains possible after rights expiry. |

The reviewer separately injected an imported corrupt representation payload and
an imported corrupt policy ancestor. Only the isolated fixture temporarily drops
and restores the content UPDATE trigger; no production bypass exists. Both cases
quarantine the representation, dependent evidence and replay acknowledgment:
`quarantined:true`, `usable:false`, content withheld. New evidence use fails with
no state change. Canonical content hashes, actual byte and normalized-text digests,
transform versions and parsed-original JSON are independently recomputed on read.
The bounded ancestry read refuses more than 512 records or 4 MiB of content rather
than returning an unverified partial result.

A separate read interleaving revokes retention immediately after the SQL result is
captured and before JavaScript consumes it. The read performs exactly **one**
ancestry SQL observation and returns a coherent pre-removal result; a subsequent
read returns the tombstone. This demonstrates the declared read linearization,
not a timeless promise that permissions cannot change after a read. New writes
still recheck current dependencies in their committing transaction.

The final source-response run also mutates a resolver-owned object after the await,
substitutes every important request binding, and advances the durable issued head
between resolver preflight and capture commit. The store retains its validated
snapshot; substitutions fail; the stale capture and its injected prefix row roll
back together. Zero catalog entities are required for initial metadata intake.
The trusted request/capability resolvers are fixture integrations, not real
provider authorization or reviewer authentication.

## Practical boundaries retained for later packages

- Payload and metadata live together in bounded D1 rows. The acknowledgment is
  after the actual guarded D1 batch. No cross-database or object-storage atomicity
  is claimed; a later external store requires a separately reviewed protocol.
- Audit retention requires an explicit verified capability decision. Only the
  declared minimal identity/hash/authority metadata survives scoped removal.
  Logical current-database removal is tested; physical backup/Time Travel erasure
  is not. WP26 must reconcile removals after restore before reopening use.
- WP06 must implement real enrollment activation, transport, credentials,
  endpoint grammar, lease/budget/qualification guards and source health. WP07 must
  compose page receipt/checkpoint mutation in the same capture transaction.
  This package emits a private representation acknowledgment, not an IF02 page
  receipt and not a completed provider qualification.
- WP14 must map exact selectors from multi-record responses to reviewed original
  works, implement explicit grant requalification and the reviewed public/removal
  bridge. WP16 must enforce the complete public dependency and snapshot contract.
  Provisional intake and schema/model passes establish none of those external
  truths or publication rights.

No reviewer implementation edit, commit, deployment, remote migration, provider
request, installation or frozen-model modification occurred. Root owns full
regression/build/smoke/secret-scan integration and the acceptance receipt.
Reviewer-owned files are stable; no further review edit is pending.
