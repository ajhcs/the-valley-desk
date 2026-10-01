# PA binary export — reviewed-local candidate milestone

September 30, 2026. BuilderBob only, existing branch
`codex/dvhimss-pa-darkmode-20260930`. No commits, publisher requests, upstream
access changes, production enrollment/activation, jobs, deployment, credentials,
provider settings, global installs, or work on the separate darkmode worktree.
This is an offline engineering candidate. The completed independent review and
its three fixes are recorded below; independent fix verification and packaging
remain a subsequent phase.

## Evidence and implemented boundary

The four supplied retained-file SHA256 values matched. The original ZIP is
1,649,358 bytes and contains one deflated member,
`PA-Bill-History-2025-RegularSession.xml`, 18,875,097 expanded bytes, SHA256
`93f88817a99deeb398fb201926eca027fe8c91ad836b58b472c0edd453aa3692`.
Its original archive SHA256 is
`f1f5484439dd2f2d22ef9e956169aa296fe1893b97b1625b8d917fed7c13a003`.
The export has 5,118 structurally indexed document identities. Only HB1925,
HB1993, SB1113 and HB2787 enter the bounded selected-record adapter; all other
records remain unaccepted inventory. No complete/current coverage is claimed.

The repository `test/fixtures/pa-export/receipt.json` and companion manifest are
now privacy-minimized derived research metadata. They retain public provenance,
raw archive/member hashes and sizes, times and four exact lexical bill records.
The manifest hash binds the revised minimized bytes; original private receipts
remain separately preserved outside the checkout. Private transfer identifiers,
filesystem attributes, host paths and retrieval details are omitted. The unchanged
original publisher archive is now reconstructed from generated lossless base64
text parts beside the receipt; its logical basename is not a tracked binary. The mandatory regression
resolves repository basenames without credentials or live downloads and verifies
original bytes, lexical derivations, minimized metadata and Node/workerd parity.
Synthetic envelopes/ZIPs and all D1 qualification/activation/rights/access receipts
remain labeled synthetic. Historical ZIP mode was 100644; generated transport parts use mode 100644.

`official-zip-xml` requires an explicit configuration-bound profile, exact PA
export endpoint/session, member name and up to four explicit bills. The existing
2,000,000-byte raw limit is unchanged. ZIP32 extraction verifies central/local
structure, safe unique paths, supported flags/methods, sizes, data descriptors,
CRC, no encryption/multidisk/ZIP64/symlinks, <=100 entries and <=64 MiB declared
and actual expansion. The adapter deliberately accepts the single known member
shape. XML validation rejects DTD/custom entities/CDATA/comments, malformed or
deep structure, duplicate/missing selected records/scalars and conflicting
session/chamber/bill/PN/action dates. Predefined and numeric XML escaping present
in the actual export is decoded as literal metadata, not external entities.
Selected text and history/version arrays remain bounded.

Worker extraction uses the installed `DecompressionStream('deflate-raw')` and
existing fast-xml-parser. Actual workerd parsed the retained original archive
with exactly the same receipt as Node. No dependency or lockfile change.
Original compressed bytes remain in raw storage; normalized text is an explicit
versioned derivation receipt binding archive/member/document hashes, document
identity, field paths/value hashes, export date and bill lastUpdate. It is never
cast to UTF-8 or dispatched through federal roster XML parsing.

Preparation, qualification, collector 200/304, durable acknowledgment, evidence
resolution, native staging and strict source-rule replay recognize this binary
contract together. Replay reconstructs the selected capture from acknowledged
original bytes and compares its observation, configuration, derivation and
native document. Acceptance transactions fence immutable raw/page proof plus
the existing qualification/review/permission/native/lease guards. Existing
Federal Register, representative XML and PA HTML regressions remain valid.

The exportDate is `2026-09-30T19:30:06.000Z`. HB1925 lastUpdate is
`2026-09-30T19:05:00.000Z`. Its PNs are current 3963, prior 3349 and 2403, each
with an exact bill/session PDF association. Its last literal action is
“Re-reported as committed, Sept. 30, 2026”. HB1993 is PN2515 with referral to
PROFESSIONAL LICENSURE; SB1113 is PN1376 with referral to INSTITUTIONAL
SUSTAINABILITY AND INNOVATION; HB2787 is PN3918 with referral to EDUCATION.
Action dates, PN text dates, export/bill clocks and retrieval/check clocks stay
separate; the export supplies no PN text date. PDFs remain separate evidence,
with no extracted legal claims. Latest status, enactment, lifecycle and legal
effect remain unknown. The later House final-passage observation in the research
manifest has no retained literal vote response; only labeled synthetic later
observation tests use that scenario. House passage does not establish enactment.

Per-bill native identity/facts exclude archive/export/check/bill-update receipts.
Changed export or bill-update clocks therefore retain new archive/observation
receipts without duplicating semantic captures/drafts/decisions/developments.
Unchanged 200/304 checks retain distinct page/check receipts and renew collection
health. Denials preserve prior success; export regression and inconsistent
per-bill clocks/content are held. Qualification requires two time-separated,
original upstream capture receipts bound to their bytes/endpoints/times and four
named engineering/editorial/rights/access receipts. Library research import is
not an original upstream successful check and cannot qualify from one snapshot.
The BuilderBob publisher ZIP HTTP403 at 20:28 UTC remains access-held.

## Initial milestone validation and reproducibility

Reuse Node 22.23.2 and task-private dependencies. Set `TSX_TSCONFIG_PATH=tsconfig.app.json`
and workspace-backed `TMPDIR`/Wrangler logs. Local workerd/D1 requires supported
exact-command sandbox escalation for loopback IPC; the probe received EPERM
inside the sandbox and succeeded with that escalation. No bypass flags/settings.

The required `test:watch-launch` gate now includes all three binary test files:
`test/watch-pa-export.test.ts`, `test/watch-pa-export-d1.test.ts`, and
`test/watch-pa-export-original.test.ts`. The final focused binary/preparation run
passed **39/39**. The other affected PA HTML, Federal/collection, representative
source-rule, workflow, editorial/runtime and D1 files passed **91/91** in the
initial grouped run: **130 distinct focused checks validated** across 12 files.
The initial run's obsolete candidate count was corrected from thirteen to
fourteen. D1 negative mutation tests assert the installed immutable triggers,
then use the existing revocation API to invalidate delivery permissions.
No current focused test failure remains. TypeScript and `git diff --check` pass.

Command form: `node --import tsx/esm --test --test-concurrency=1 <files>`.
TypeScript: `node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.app.json`.
Scoped baseline, incremental diff/manifest, original derivation receipt and test
logs are retained under ignored `pa-binary.local/` on this Samsung worktree.
The initial dirty files and generated `dist` were archived before tests. No
build or full gates ran; generated assets were not regenerated.

## Exact remaining work

- Independent fix verification of the completed three-finding review disposition
  and exact packaging/separately scoped commits. The required full local gates
  have passed in the fix phase below; no commit or branch publication occurred.
- Obtain two coherent **real** original captures and named rights/access,
  engineering and editorial receipts. The single Library research snapshot
  leaves actual qualification and activation unestablished. Resolve access
  separately under operational authorization; this phase did not request it.
- Wire the explicit freshness contract into a bounded public source-health
  sidecar: exportAge, lastChecked, lastSuccessfulUpstreamCheck and currentFailure
  are separate. This slice provides a pure tested contract and existing typed
  collector health; it does not expose a new public API or imply current status.
- Implement separate evidence arbitration/version associations for later
  independently retained vote/status/PDF observations. Do not let an older export
  or stale RSS erase a later verified source fact. This slice conservatively
  withholds export latest-status facts; it does not ingest or merge the supplied
  research vote observation. No accepted literal vote facts were manufactured.
- Automatic discovery/candidate intake from unaccepted inventory is a subsequent
  separate slice with durable cursor/budget; no discovery enrollment or broad
  coverage claim here. Review production performance of repeated bounded replay
  before activation; the local original-byte/runtime proof is not deployment
  acceptance or a production refresh benchmark.


## Independent review fixes and full offline gates

The completed independent review is retained at
private validation storage outside the checkout.
This fix phase uses the same isolated PA worktree and its own initial dirty-file,
instruction-file and seven-generated-output/dist snapshots. Existing theme,
recovery, preparation and other concurrent work were preserved. No Git index,
branch, credentials, providers, global dependencies or services were changed.

- **PA-BINARY-001 (P1):** vendor the unchanged original ZIP as an explicitly authorized government
  research fixture. The original phase retained private capture metadata; this
  revision replaces repository metadata with a separately hashed minimized form. The mandatory
  original test checks exact archive size/hash, manifest hash, member hash,
  lexical derivations and actual Node/workerd parity. A separate checkout copy
  under `CI=true` passed using repository-default fixture paths; only installed
  private dependencies were reused by symlink. This was a checkout simulation,
  not a new Git clone or a locked-install run. No host fixture lookup or network
  materialization is needed in CI. Missing-fixture and checksum-altered-fixture
  negative probes in that disposable checkout both failed the mandatory gate
  as expected, with zero skips; original fixture bytes were restored afterward.
  ZIP Git mode 100644 is prepared for packaging;
  new files remain unstaged and uncommitted in this run.
- **PA-BINARY-002 (P2):** retain successive derivations during qualification and
  apply `assertPaExportProgress` before granting qualification. Changed semantic
  content with unchanged bill lastUpdate and regressed bill/export clocks fail.
  Repeated capture IDs/times and identical archives relabelled as new captures
  also fail. Coherent unchanged content with a new export and changed content
  with advancing bill/source clocks pass. D1 authority remains explicitly
  fabricated test state. Four distinct named engineering/editorial/rights/access
  receipts and original byte/endpoint/time binding remain required.
- **PA-BINARY-003 (P2):** scalar extraction rejects unexpected child elements and
  attributes, duplicates and partial/exponential numeric values. Type description
  and PN sequence/text-URL attributes remain supported, including observed padded
  numeric sequences. Predefined and numeric XML escapes decode literally through
  the existing parser; the lexical entity allowlist still excludes HTML-only
  names, custom entities, DTDs and unobserved CDATA/comments. Nested number/title
  review triggers now return parser-failed with zero observations.

Pinned Node **22.23.2** and the pre-existing private node_modules/PDF venv were
used with credentials excluded, explicit offline flags and an external-network
blocking Node hook. Only normal loopback/IPC/spawns used scoped sandbox
escalations. No installer, upstream/publisher request or provider call ran.
Backstage tools were unavailable; this local evidence retains the work summary.
The referenced production memory remains absent; no production work was done.

| Check | Result | Provenance |
| --- | --- | --- |
| Broader affected focused checks | 150/150 | Includes 20 new regressions; before final decoder-option typing adjustment |
| Final binary/preparation affected checks | 60/60 | Includes additional HTML-only-entity rejection; overlaps broader run |
| TypeScript and whitespace | Pass | Final implementation |
| `npm test` main suite | 675/675 | Full local gate |
| Required Watch postgate | 212/212 | Includes mandatory original ZIP/workerd parity and all final regressions |
| Required theme postgate | 8/8 | Existing parent-owned theme; no publication |
| `npm run build` | Pass | TypeScript/Vite; existing >500 kB chunk advisory remains |
| `npm run secret-scan` | Pass | Includes vendored binary and untracked candidate files |
| `npm run test:policy-pdf` | 7/7 | Existing hash-locked pypdf 6.9.0/PyMuPDF 1.27.2 |
| Separate PDF integration | 4/4 | Actual 79 retained official PDF pages; also covered in main suite |
| Final checkout-copy original parity | 1/1 | `CI=true`, repository-relative immutable ZIP, offline |

All terminal runs have zero failures, cancellations and skips. `npm test` totals
**895 passed checks** across its main and required postgates. Overlapping focused,
checkout and PDF reruns are reported separately, not added as distinct coverage.
The first focused run had one newly added escaping-positive regression failure
(149/150); numeric escape decoding resolved it. The empty-map decoder option
passed runtime tests but exposed the dependency's boolean-only TypeScript option;
the final supported option passed the strict entity guard and all final gates.
No new repository baseline failure remained or required production diagnosis.

Logs, gate commands/totals, checkout simulation, per-finding disposition, postfix
source hashes and this run's changed-file manifest are retained under
private validation storage outside the checkout.
The seven generated tracked outputs and `dist` matched this agent's own initial
snapshot exactly after the build; restoration verification passed and no bytes
needed replacement. Instructions and unrelated initial dirty files were retained.

**Qualification remains pending:** the single Library research capture does not
establish two real coherent originals or named actual rights/access/engineering/
editorial receipts. Caller declarations are an operator trust boundary; hashes
and distinct timestamps cannot independently authenticate origin or rights. A
fabricated caller can relabel/repackage evidence, so these checks do not establish
mechanical authenticity. The publisher HTTP403 hold remains in effect. No source
activation/jobs, production writes, current coverage or deployment are authorized
or claimed. Durable ordering/arbitration of separately retained later vote/status/
PDF facts and the public freshness sidecar remain named followups. Helper tests
prove nonmanufacture and clock separation, not durable later-observation ordering.
Discovery/public-health API work and production performance proof remain deferred.

## Privacy revision boundary

This new minimized candidate is based on the fixed dark-mode dependency tree.
The original PA publication was denied because its fixture metadata unnecessarily
included private capture details. Those exact original receipts remain preserved
privately; the rewritten manifest is explicitly derived metadata with a new hash.
The historical gate results above describe earlier phases, not this candidate.
Fresh exact-candidate gate receipts and preservation evidence are retained outside
the checkout for independent privacy/provenance review. No original payload retry,
source qualification/activation, publication, push, merge or deployment is authorized.

## Lossless publication packaging candidate — October 1, 2026

This candidate supersedes packaging only. The historical binary candidate and full
capture remain separately preserved. The original logical ZIP path and raw archive
identity describe historical evidence; no standalone binary is tracked there.
The fixture README documents 51 ordered independent canonical base64 parts,
32 KiB raw per part, 43,693 maximum text bytes including LF, and 2,199,263 total
text bytes. Parts are generated transport, not publisher responses. The manifest
binds their digests, sizes and order; the bounded helper pins the whole raw ZIP.
Default CI reconstructs all original bytes and retains full Node/workerd parity,
lexical bill hashes, privacy and Library qualification/activation assertions.
Earlier gate counts below/above remain historical; fresh changed-candidate gate
receipts are retained separately outside this repository for independent review.
