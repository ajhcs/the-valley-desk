# PA Watch exact-bill review collection — local evidence

This implementation adds `watch-pa-bill-history` version `1` for one exact
official HTTPS `/legislation/bills/2025/(hb|sb)number` endpoint per source.
Enrollment, activation, and qualification receipts are unchanged and still required
by the collector. No source was enrolled or fetched during this work.

The collector retains original representation bytes, their SHA-256, configuration
digest, page receipt, and compact observation before native/editorial staging.
Staging checks the acknowledgment and reparses the same bytes. Full HTML and literal
actions are retained in the native ledger using `pa-bill-history-html-2`; version 2
adds explicit lifecycle/enactment and conflicting latest-action PN gaps. The old
PA ledger link remains corroboration only. Slugs use PA session and bill identity.

PA staging is review-only even with the collector publication flag enabled.
The Federal Register source-rule proof and source qualification rules are unchanged.
Legal effect/lifecycle remain unavailable. A latest action citing a different PN
from the selected text version remains an explicit gap; no combined or guessed
legislative status is generated. Invalid source scope, page identity, or PN/PDF
associations fail visibly without healthy-empty observations or native staging.

Unchanged 200/304 checks preserve capture/action identities, source event dates,
and the original capture retrieval time. Collection check and last-success times
advance separately. A failed check does not renew success; delivery time is not a
source-check timestamp. This is not public freshness renewal or acceptance evidence.

## Offline checks

Host/account: BuilderBob (`builderbob`). Checkout:
private validation storage outside the checkout,
branch `codex/dvhimss-pa-darkmode-20260930`, starting HEAD `428213e`.

Runtime: private validation storage outside the checkout
(v22.23.2). The default Node 18 lacks `node:sqlite`. The lockfile matches
`tvd-watch-complete-20260915`; this checkout links its existing dependencies for
read-only use. No install, lockfile change, or write to that worktree was performed.

Commands below use that Node 22 executable as `PA_NODE`:

```sh
"$PA_NODE" --import tsx/esm test/watch-pennsylvania.test.ts
"$PA_NODE" --import tsx/esm test/watch-collection.test.ts
"$PA_NODE" --import tsx/esm test/policy-background.test.ts
"$PA_NODE" node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.app.json
git diff --check
```

Results: PA checks 7/7, collection regressions 30/30, background regressions 5/5;
TypeScript and whitespace checks passed. The PA tests use migrated, in-memory
SQLite through the existing D1 test helper and stubbed fetch, never a remote API.
They cover exact raw-byte retention, HB/SB and session separation, source contract
rejection, PN/text mismatch, committee action without enactment, explicit PN
conflicts, acknowledgment-before-staging, failed raw writes, source rejection,
disabled enrollment, unchanged refresh, and preservation of last successful check.

The September 6 HTML fixtures remain original retained official responses, with
provenance in `test/fixtures/pa-legislation/README.md`. They are historical snapshots.
PN3963/PN3349 committee examples are explicitly synthesized mechanics, not original
September 29/30 source bytes. The initially guessed retained text-date expectation
was corrected against the original May 5 field; the final regression passes.

## Outstanding acceptance work

No current official access/qualification is established. Reported Windows 403s
remain unresolved; rejection must not be bypassed. The referenced Plumbob runtime
memory file is unavailable locally; no production runtime or deployment work was
attempted. Cloudflare Worker runtime integration and the full release gate were
not run; these checks establish local fixture behavior only.

Later scoped work must verify original current bytes/qualification, review a PA
acceptance rule and successful-check dependency renewal, and add topic-index
discovery. In particular, this exact-bill adapter does not discover HB2787 or claim
complete PA coverage. Supplied current PN expectations are not source evidence.
No deployments, production jobs, source changes, Git writes, or agents were used.
