# Offline Watch Review Packets

This optional authoring utility prepares **draft** reviewer packets from an
existing `EvaluationCorpus` and `EvaluationConfiguration`. It is not a runtime
gate, a condition of the narrower existing-news model rollout, a real dataset,
or an approval workflow. It does not collect sources, call models, read provider
credentials, establish source rights, authenticate reviewers, freeze a split,
or authorize publication. It writes only to stdout and never edits input files.

## Commands

Use the existing draft corpus/configuration files. Explicit stage selection is
required; calibration packets contain no holdout source text or expected claims.
All case IDs, strata and content hashes remain in the shared inventory snapshot.

```bash
node --import tsx/esm scripts/prepare-watch-review-packets.mjs \
  --stage calibration --corpus /absolute/path/corpus.json \
  --configuration /absolute/path/configuration.json --format json

node --import tsx/esm scripts/prepare-watch-review-packets.mjs \
  --stage holdout --corpus /absolute/path/corpus.json \
  --configuration /absolute/path/configuration.json --format markdown

node --import tsx/esm --test test/watch-review-packets.test.ts
```

For repeat review, optional `--pin-corpus`, `--pin-configuration`, and `--pin-split`
take prior canonical SHA-256 values. Drift becomes an explicit integrity gap;
the tool never silently updates pins or source/case hashes. Raw input file
SHA-256 receipts are separate from canonical parsed-data hashes.

Exit 0 means preparation completed without reported corpus/configuration gaps,
**not** approval. Exit 2 with a packet means gaps remain visible in `gapReport`;
exit 2 with a bounded error object means input/options were rejected. `--mode live`
always blocks before file access. No live transport exists in this utility.

## Review Procedure

1. Inspect the source representation, exact literal-span offsets, expected
   identity/dates/claims/holds and reviewer rubric in the selected case packet.
2. Resolve `gapReport.gaps` in the actual editorial/configuration workflow.
   Synthetic cases remain visibly synthetic; they cannot substitute for public
   evaluation evidence. Declared reuse/public-data receipt presence is not a
   rights determination by this tool.
3. Resolve disputed labels and stale/duplicate reviewer records outside this
   utility. Critical cases need two distinct current reviewer declarations.
   Adjudication remains separate. The packet issues zero approvals, even when
   the supplied input already contains declared approvals.
4. Recompute after every evidence, expected-label, input-mapping or split edit.
   Source hashes must match before the final case material is hashed. Updating
   `source.sha256` changes case material; the case's self-hash is excluded from
   that material. Rerun and obtain fresh external review receipts for changed
   evidence or labels and their resulting exact hashes.
5. Retain the content-addressed inventory with the editorial freeze record.
   Its in-memory entries are frozen and its SHA-256 binds all case material and
   strata, but the packet does not create or authenticate the freeze attestation.

The JSON packet is authoritative for exact strings. Markdown uses collision-proof
literal fences, never injected HTML or rendered source links. Operational receipt
contents, reviewer/adjudicator identities, private legacy fields, pricing approver
names and source URL query/fragment values are omitted. Reviewers are represented
by stable identifier hashes and numbered slots; the editorial system retains the
identity mapping. The source's exact URL hash remains visible when its display
query or fragment is omitted. Source text and expected claims are intentionally
included for human review, so supply only the intended evaluation data.

Input limits: 8,000,000 corpus bytes; 64,000 configuration bytes. CLI input must
be regular, non-symlink local UTF-8 files. Packet/CLI output is capped at
16,000,000 UTF-8 bytes. Temporary test fixtures honor `TMPDIR` and are removed.
No files from this utility are imported by the Worker or ingestion scheduler.

Remaining work includes actual corpus assembly, independent editorial review and
adjudication, explicit split freezing, account/provider qualification and any
separately authorized live comparison. This utility does not block or alter the
independent, reversible existing-news model rollout.

## Local Verification

On 2026-09-12, Node 24.14.0 with worktree-owned locked dependencies: the 8 new
packet tests and 16 existing evaluation tests passed 24/24. `npm run build` passed
(inherited main-bundle size warning); secret scan passed 357 files; diff check
passed. Guarded subprocesses reject network fetches and operational credential
reads. Add `test/watch-review-packets.test.ts` to the explicit root test command
when integrating; this slice deliberately changes no shared package/config file.
