# Version-bound PDF evidence and policy background

Local integration candidate; **not deployed**. Production remains on e0d03be,
Worker 9d6e69c8-43b0-49d4-98ac-24520a2c450b, schema 0027, with newsletter intake
disabled. Those are the prior accepted operational facts, not a fresh production
readback in this task. Keep production running unchanged.

## Delivery and ownership

Engineering owner: Knox. Authorized background interpretation/release owner:
Cole Lyons. The workflow is operator-initiated, not an automatic cron PDF stage.
The integrated path is:

1. Existing authenticated review API resolves a durable `policy_versions.id` to
   its official PA bill/session/printer URL. A caller cannot supply another URL.
2. Capture retains the actual PDF as immutable bounded D1 chunks, checksum,
   official-record binding, first capture time and operator identity. Failed
   transport is a failed command, not successful empty extraction.
3. The operator command downloads those retained bytes, verifies their checksum
   and bill/session/printer header, extracts full layout text, renders every page,
   uploads page packets, and finalizes only a complete contiguous extraction.
4. `/ops` provides full provision/context text, retained PDF download, lossless
   PNG page renders, and an evidence-specific review form under existing Access
   protection. Machine operations retain the existing bearer contract.
5. `/policy` and read-only `/api/policy-watchlist` present each tracked bill's
   observed action, legislative date, text-version date, observation/capture dates,
   printer/checksum, proposed section groups, reviewed summaries, questions and
   official page citations. This is background, not a news feed or an assertion
   that a proposal is enacted.

The operator needs an existing authorized credential. Do not retrieve Worker
secrets, put credentials in shell arguments/receipts, change routing, or weaken
Access. Browser requests use `/ops/api/*`; no bearer is shipped in browser code.
Questions and approved summaries are public; verification notes remain private.

## Exact storage and retry contract

Migration `0028_policy_pdf_review.sql` is additive. `policy_pdf_artifacts` binds
`version_row_id + sha256`; `policy_pdf_chunks` retains original bytes;
`policy_pdf_pages` binds page text/layout and PNG hashes to that artifact;
`policy_provisions` binds complete printed groups to an evidence hash;
`policy_provision_reviews` appends decisions against that exact hash.

An identical capture or page upload reuses its row. Changed bytes at the same
official URL create a different artifact with no inherited pages or approvals.
The public view selects the latest captured artifact for the current durable
version, not an older approved artifact. Capture times remain first-capture
times on retries; legislative discovery timestamps are never rewritten.
Conflicting page contents, different completion hashes, missing pages, incorrect
header identity, or a stale review hash fail explicitly. Once complete, an
extraction cannot be overwritten. A newer review hold supersedes an approval;
replaying an older superseded decision fails rather than claiming a new approval.
Re-extraction with a different renderer/grouping contract is deliberately held;
it requires a separately designed evidence-revision path, not row repair.

Database triggers enforce artifact capacity and prevent a concurrent page upload
from producing a falsely complete extraction. D1 batches make chunk capture and
provision finalization atomic. There are no writes to `policy_versions`, editorial
candidates/milestones, published content, aliases, schedules, locks or credentials.

Limits: 15-second official capture, four same-record redirects, 5 MB/PDF,
eight checksum artifacts per durable version, 100 pages/artifact, 500 KB/PNG,
2,000 × 3,000 PNG dimensions, 32,000 text characters/page, two million total,
80 provision groups, and 12 literal supporting spans per review. Page uploads
have bounded JSON bodies; capture/review retain the existing mutation rate guard.
The Linux renderer has a 1 GiB address-space limit, 90-second CPU limit and
120-second parent wall-clock timeout. Unsupported/image-only/mismatched or
oversized PDFs remain explicit failures. There is no OCR or automatic repair.
This bounded manual workflow is not a general-purpose document storage service.

## Complete text is not automatically interpreted text

All body fragments survive grouping exactly once, including continuations across
page boundaries. A reference such as `section 3503.` is not a heading. Split
amendment headings retain both printed numbers, e.g. `§ 3507 3506. Oversight.`
The system does **not** silently choose one number or combine deleted and added
language into supposedly operative prose. Stroke classifications are review hints;
original PDF bytes and PNGs are authoritative for typography.

The reviewer must inspect definitions, exceptions and the transitive section
reference context, select literal supporting spans, reconcile amendment formatting,
and attest to the summary against exact render hashes. Approval fails for missing
rendered context, nonliteral spans, unresolved indexed references, missing
confirmation, or outstanding questions. This is an authenticated editorial
attestation, not a machine proof that a paraphrase follows from its citations.
Numbered references are indexed conservatively; named external statutes and other
legal context still require reviewer examination. No summary of external law is
authorized merely because that law is named in a bill.

The captured HB1993 example includes the complete section 4 continuation through
page 7, section 2 definitions, section 3 consent conditions and section 6 exceptions.
All seven rendered pages were visually inspected for the local example. The
fixture `captured-pdf-interpretation-review-20260907.json` is **not** a production
approval or import manifest. HB1993 enforcement references remain held. HB1925's
full amendment reconciliation and SB1113's external definitions remain unfinished;
the baseline must show those interpretation gaps, not imply full coverage.

## Local reproduction

Use the verified development data mount and a **throwaway local** bearer token.
Do not use a production credential for a fixture preview. Check `ss -tlnp` before
binding. Set the local token in the operator environment, never a tracked file.

```bash
npm ci
npm run policy:pdf:bootstrap
node --import tsx/esm --test test/policy-pdf-integration.test.ts
npm run test:policy-pdf
node --import tsx/esm scripts/preview-policy-evidence.mjs /mnt/d/tmp/plumbob/NEW-PREVIEW 5197
```

The preview creates a new local SQLite database from every migration and seeds
only the captured official discovery fixtures. Its outgoing official PDF fetches
are replaced by the captured PDF bytes. It is not production collection evidence.
Read its `versions.json`, then in a second terminal with the same local token:

```bash
npm run policy:pdf:process -- http://127.0.0.1:5197 EXACT-VERSION-ROW-ID /mnt/d/tmp/plumbob/NEW-PDF-RECEIPT
```

The command requires a new directory, retains original PDF/page renders and
receipts, and submits no summary automatically. On failure it writes a bounded
redacted `failure-receipt.json` with stage, typed outcome, uploaded-page count and
whether the failure was persisted. A network outage can prevent persistence;
that is recorded, never silently described as a durable hold. A complete artifact
is not downgraded by a failed replay. Shut down the task-owned preview afterward.

The renderer uses SHA-256-locked pypdf and PyMuPDF wheels in an ignored venv;
system Python is unchanged. The current PyMuPDF wheel is Linux x86-64 / Python
3.10+ ABI3; the workflow uses Python 3.12. PyMuPDF is AGPL/commercially licensed.
It is an offline operator dependency, not part of the Worker JavaScript bundle;
the owner must review licensing obligations before distribution or operational
adoption. Do not infer a licensing exemption from that separation.

## Future release and rollback — authorization required

This candidate requires **schema 0028**; it is not a schema-preserving code-only
release like the slug fix. Before proposing deployment:

- Freeze an immutable commit, replay fresh official pages/PDFs read-only, run the
  repository release gate, and bind browser/API evidence to that candidate.
- Recheck the production build/version, schema, newsletter state, source schedules,
  D1 capacity/limits, existing operator access and code rollback target. Record
  a restricted backup/checkpoint using the existing operational runbook.
- Obtain explicit authorization covering migration 0028 and exact-candidate
  deployment. PDF capture/page persistence and background review decisions are
  additional production writes and need their own bounded scope. No baseline
  import, backfill, schedule reset, credentials or routing change is implied.
- After authorized migration/deployment, verify public health/schema/build and
  public surfaces; verify protected denial and one real operator PDF workflow;
  reconcile each bill/session/printer/checksum/page count in D1 and `/ops`;
  verify reader background, still-held interpretations and unchanged publication
  tables. Local fixture receipts cannot establish those production facts.

Code rollback uses the freshly verified preflight Worker through the existing
release workflow. Leave additive 0028 tables intact for evidence retention; the
prior Worker ignores them. Do not drop tables or restore D1 to undo a code release.
If migration fails, do not deploy the new code; preserve the error/transaction
state and request an explicit repair plan. D1 restore, evidence deletion and
historical repair are not authorized by a code rollback.

## Separate unfinished measurement and capabilities

Prospective timing keeps the SELECT-only contract in
`docs/evidence/policy-prospective-timing.sql`. Preserve original discovery and
milestone times and the historical **2h17m20s** miss. No new production timing
readback was performed for this integration. Zero eligible new developments
means no evidence of sustained timeliness, neither success nor a new miss.

Automatic PDF scheduling, supplying selected page text to the news model/editor,
external statutory-context ingestion, complete HB1925/SB1113 interpretation,
production PDF processing and reader delivery remain distinct from local
integration. `/ops` credential qualification, the 17 remaining detail failures,
historical leadership repair and baseline import remain separately controlled.
