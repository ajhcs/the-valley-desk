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
optional `prefill_file` below is the adjudicated 100-lead review. Use the
same queue and prefill options for every command against the same ledger.

```sh
python3 scripts/serve-discovery-review.py serve \
  --queue "$queue_file" --prefill "$prefill_file" \
  --ledger "$review_dir/decisions.sqlite"
```

Open `http://127.0.0.1:8789/` on the host running the command. Search the queue,
filter by decision or fork and open a candidate. Match the four findings to the
retained evidence and save a reason. An admission-ready decision requires the
lean draft and source evidence. The server saves a new local revision and
rejects edits based on stale revisions. New screening notes can enter via the
offline `--evidence` file documented in the [Terra method](GL08-terra-screening.md).
Pass the same `--evidence` bundle to both `serve` and `export` when using
imported notes. Export requires an existing ledger and opens it read-only.

```sh
(umask 077; set -C; python3 scripts/serve-discovery-review.py export \
  --queue "$queue_file" --prefill "$prefill_file" \
  --ledger "$review_dir/decisions.sqlite" > "$review_dir/review-export.json")
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
