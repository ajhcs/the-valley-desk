# PA native acceptance slice — local evidence, September 30, 2026

BuilderBob checkout: `tvd-dvhimss-pa-darkmode-20260930`, branch
`codex/dvhimss-pa-darkmode-20260930`. This continues the earlier
[review collection slice](pa-watch-collection-slice-20260930.md).
It establishes offline behavior, not current production source coverage.

## Implemented scope

- `fixtures/watch-launch-candidates.ts` adds four **pending candidates** for
  exact canonical 2025–2026 HB1925, HB1993, SB1113 and HB2787 bill pages.
  HB2787 uses the bill-page parser, not a co-sponsorship memo. No Senate
  companion number is inferred. All rights/access/reviewer assignments,
  qualification and activation remain unestablished.
- Preparation and qualification dispatch `watch-pa-bill-history` version `1`;
  editorial replay recognizes the emitted native `pa-bill-history-html-2`.
  Qualification still requires named engineering/editorial approval, accepted
  rights/access decisions, distinct coherent samples, healthy deterministic
  replay and a rejected negative sample. Preparing evidence grants no activation
  or publication permission.
- PA source-rule acceptance reconstructs the capture from acknowledged original
  raw bytes, validates raw SHA/configuration digest and page receipt, exact
  source URL, bill/session/chamber and PN/PDF/text date association, and requires
  observation/capture replay equality. Current enrollment, qualification,
  review, permission and native-head guards remain mandatory. The raw/page
  proof is also fenced in the decision transaction. FR-specific dispatch and
  permission/replay guards remain in place. PA supports the explicit
  `publishVerified` option only through these proofs.
- Literal official short-title text is retained as `native.synopsis` with
  `/native/synopsis` evidence. Accepted policy identity supports spaced/compact
  bill search; current accepted synopsis evidence supports literal text search.
  Retracted synopsis evidence cannot leave a search match. Operator labels,
  research assertions, inferred topics and legal interpretations cannot supply
  these facts.
- Latest-action wording/date and current text PN/date stay independent. A
  PN conflict or unreconciled/incomplete history exposes an explicit unknown
  latest-action gap while retaining dated literal action evidence. Committee
  reports/votes never establish adopted lifecycle, enactment or legal effect.
- Unchanged 200/304 checks reuse the original capture, draft, decision and
  development identities, including a later explicit acceptance of an existing
  review draft. Successful-check and failure metadata are returned through the
  existing typed source-health interface. A failed check preserves the previous
  successful check. Snapshot/asOf and fact verification times remain unchanged
  during refresh. Replay reads select one receipt per representation, with the
  exact PA raw hash, instead of duplicating HTML for every unchanged receipt.
- `scripts/capture-pa-watch-local.mjs` uses the existing bounded robots-aware
  helper for only those four pages, writes private evidence outside the checkout
  on private validation storage outside the checkout, and performs no enrollment/database/model
  or publication operation.

## Validation

Pinned existing Node 22.23.2 and dependencies were reused. TypeScript ran first:
`node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.app.json`.
No install or lockfile change was needed.

The targeted Node test command ran these nine files at concurrency 1:

```text
test/watch-pennsylvania.test.ts
test/watch-pa-d1.test.ts
test/watch-source-preparation.test.ts
test/watch-collection.test.ts
test/policy-watch-workflow.test.ts
test/watch-editorial.test.ts
test/watch-editorial-runtime.test.ts
test/watch-d1.test.ts
test/watch-updates-scale.test.ts
```

Results: **101/101 targeted checks**, **8/8 theme checks**, TypeScript and
`git diff --check` passed. Logs and result totals:
private validation storage outside the checkout
and `results.json`.

The PA suite covers parser/source/session/chamber/bill/text mismatch, missing or
failed raw acknowledgment, corruption/replay/tamper, expired/unqualified/revoked
or changed permission/configuration, transaction races, committee wording,
PN conflict, incomplete history, accepted PA directory/bill/synopsis search,
optional evidence retraction, unchanged acceptance/refresh/failure, and 34
unchanged checks without duplicate developments or proof rows. The new PA D1
test exercises the actual collector → native ledger → source-rule decision →
public read model in ephemeral local workerd/D1, including conditional refresh
and qualification expiry.

All qualification/approval/activation state in those tests is explicitly
**synthetic**. Three September 6 retained official HTML files are historical;
HB2787 and new PN/action scenarios are synthesized mechanics. None represents
current access, current qualification or production acceptance. The user's
September 30 research benchmarks were not used as source facts.

`npm test` now requires both PA test files through `test:watch-launch`, and a
separate `test:theme` through `posttest`. Theme SSR uses the app's automatic JSX
configuration (`TSX_TSCONFIG_PATH=tsconfig.app.json`). Existing theme code/tests
were preserved. Instruction files and all theme files match the prior recovery
snapshot; the prior scheduler/query recovery diff was preserved. No agents,
Git commits, push/merge, production DB/jobs or deployment were changed.

## Current-source and remaining blockers

Exact-command automatic review permitted the bounded capture command. On
September 30 at **19:22:55–19:22:56 UTC**, canonical
`https://www.palegis.us/robots.txt` returned **HTTP 406** for each candidate.
The existing access policy returned `access-held / robots-unavailable`, without
requesting any bill page. Original current bill bytes were therefore **not
captured**. There were no retries, credential/challenge bypasses or alternate
hosts. Per-source access-held receipts are under
private validation storage outside the checkout; each has
`bodyFile: null`. Current page/PN/action/text assertions remain unverified here.
No current fixtures, approval or qualification receipts were seeded.

The documented official index already exists at
`https://www.palegis.us/legislation/bills/topics?MajorId=719&SessInd=0&SessYr=2025`.
The existing News registry entry `ofs-pa-legislature-ai-topic` dispatches
`parsePaAiTopicBillLinks` and has current-session link-shape tests. This slice
did not fetch that index or establish its current contents. **Smallest discovery
follow-up:** validate an original current index response under access policy,
then retain exact bill identity/link provenance in a bounded candidate intake
for Watch; separately approve/qualify/activate each exact source. Discovery
must never supply publication authority or turn topic labels into source facts.

**Smallest public freshness follow-up:** public Watch schemas/directory/detail
responses currently carry `verifiedAt` and `asOf`, without a typed source-health
sidecar. Add a bounded read of `watch_collection_state` plus the latest run by
citation source ID, bind the reported success to a retained healthy page under
the current configuration, verify current enrollment, and expose typed
last-check/outcome/last-success/retry state independently of immutable public
facts and pagination snapshots. Define unknown/stale delivery semantics in that
API/UI contract. A success from a previous configuration must remain unknown
for the new configuration; current run rows do not carry a configuration digest,
so that association needs a retained-page proof or a scoped health-receipt schema
change. This slice exposes collection health but does not pretend that
public verification dates are live source freshness; no schema migration was
introduced to manufacture that result.

Current authorized access, actual qualification/activation, public health
integration, independent final review and full gates remain outstanding.
Publication/deployment/live editorial work requires separate scope. The
production memory file is unavailable locally; no production runtime work was
attempted. This slice is ready for the separately requested review step, not a
claim of production readiness.
