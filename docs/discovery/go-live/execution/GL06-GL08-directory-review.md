# Directory and candidate review

The Worker renders the signed catalog at `/discover/works` and
`/discover/work/:id` when `DISCOVERY_DIRECTORY_ENABLED=true`. Results show
purpose, a dated regional connection and an original source link. Detail shows
the full set of claims and sources. Institution links open the directory filter.
GitHub namespace links appear when the observed repository and native ID share
bound evidence. They describe the namespace at observation.

The same flag enables `GET /api/discovery/v1/works?view=compact`. Compact cards
link to the existing full work API; calls without `view` retain the v1 response.
With the six signed listings, the compact response measured 7,832 bytes
against 29,449 bytes for the full list at `limit=50`. A synthetic 50-work
response fit under the 128,000-byte guard. Detail also offers a draft email to
the existing Leads address. Receipt and maintenance of that channel still
need an operational check.

## Local review

Use a directory owned by the operator under `/workspace/build/builderbob` with
mode `0700`. Set `review_dir` to that directory and `queue_file` to the
validated queue produced by `scripts/discovery-github-enrichment.mjs`. The
optional `prefill_file` below is the adjudicated 100-lead review. To include
reviewed screening notes, set `evidence_file` to the offline bundle described
in the [Terra method](GL08-terra-screening.md).

In Bash, build the argument list once for both commands.

```bash
review_args=(--queue "$queue_file" --ledger "$review_dir/decisions.sqlite")
if [[ -n ${prefill_file:-} ]]; then review_args+=(--prefill "$prefill_file"); fi
if [[ -n ${evidence_file:-} ]]; then review_args+=(--evidence "$evidence_file"); fi

python3 scripts/serve-discovery-review.py serve \
  "${review_args[@]}"
```

Read the server's named launch file in a private editor, then paste its
single-use URL into a browser on the same host. By default the system selects
an available loopback port. Keep the file and URL private.
The browser session stays in that tab across reloads. Restart the server for a
fresh launch URL if that tab closes. The server removes its launch file on
normal shutdown.

Search the queue, filter by decision or fork and open a candidate. Match the
four findings to the retained evidence and save a reason. Prefill references
to local evidence appear as text. An admission-ready decision requires the
lean draft and source evidence. Multiple observed repository URLs for one
native ID require identity review before admission. The server saves a new
local revision and rejects edits based on stale revisions.

The ledger binds the exact queue bytes, prefill bytes and evidence bundle
bytes, including which optional inputs were omitted. Export requires an
existing ledger and opens it read-only. To add reviewed notes, retain the old
inputs, ledger and export, then start a distinct ledger with a new complete
evidence bundle. Review decisions against the new context before recording
them there. Ledgers created before evidence binding are retained as prior
review records and require a new ledger for this workflow.

```bash
(umask 077; set -C; python3 scripts/serve-discovery-review.py export \
  "${review_args[@]}" > "$review_dir/review-export.json")
python3 scripts/build-discovery-review-snapshot.py \
  --queue "$queue_file" --decisions "$review_dir/review-export.json" \
  --output "$review_dir/admission-preview.json"
```

The preview rebuilds from the same native queue and validated decisions, skips
native IDs already in the public catalog, and stays on the workspace. The
existing signed snapshot workflow still requires independent authority for
each public admission. The 549-lead queue with 100 audited prefills produced
seven private drafts and 449 unreviewed leads. The release contains six works.
Homepage cutover, production feedback delivery and the upkeep rehearsal are
pending.

## Independent re-review

Review of the initial PR found that loopback did not prove operator identity,
and that different evidence bundles could share a ledger. The re-review checked
the private launch session and fixed evidence context, descriptions accepted
by the metadata adapter, local evidence references, and holds for conflicting
repository addresses. It also checked retention of the campus basis on public
cards and visible keyboard focus when opening and saving a private record.

The re-review passed 30 focused TypeScript and 16 focused Python tests.
The authenticated Chromium check exercised desktop and mobile saves and
reloading the operator session. A rebuild from the retained queue kept 100
local references across decisions and produced the original seven private
drafts. The public release remains six signed works. The operator must assess
dates against their sources. A different evidence bundle requires a fresh
ledger and review in this version.
