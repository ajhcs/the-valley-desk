# Research directory rollout

These commands are for the release operator. Local verification used an isolated D1 simulator. The production database, account plan, available space and Worker deployment require separate checks. Work from the reviewed site revision and the accepted publications revision. Run Node tools with the repository-supported Node runtime. On BuilderBob, use Node 24.22.0.

1. **Check the target and capacity.** Confirm that the configured binding is `VALLEY_DESK_DB` on `the-valley-desk` and that the deployed site flag is false. Read the D1 dashboard for current database size, account usage and plan. Compare the occupied space plus a local import of the actual batch with the applicable database limit. Include indexes and future update headroom. Record the current Worker version and a database Time Travel bookmark. Review pending migrations before applying anything.

   ```sh
   npx --no-install wrangler d1 info the-valley-desk
   npx --no-install wrangler d1 time-travel info the-valley-desk
   npx --no-install wrangler d1 migrations list the-valley-desk --remote
   ```

2. **Enable project removals, then create the search index.** The first SQL file uses `IF NOT EXISTS` and preserves existing tombstones. Apply the migration chain only when the pending list matches the reviewed release. From an installation at 0045, the new migration is 0046.

   ```sh
   npx --no-install wrangler d1 execute the-valley-desk --remote --file ops/directory-removals.sql
   npx --no-install wrangler d1 migrations apply the-valley-desk --remote
   npx --no-install wrangler d1 execute the-valley-desk --remote --command "SELECT count(*) AS project_removals FROM public_directory_removals"
   npx --no-install wrangler d1 execute the-valley-desk --remote --command "SELECT count(*) AS publication_removals FROM publication_removals"
   npx --no-install wrangler d1 execute the-valley-desk --remote --command "SELECT kind,count(*) AS records FROM research_visible GROUP BY kind"
   ```

   Both removal reads must succeed. A new index has no listings. Project-only pages can ship with the flag false before 0046. The existing project removal table is required in either mode.

3. **Validate and prepare the reviewed input offline.** Set `data_tree` to the accepted publication checkout, `batch` to its reviewed JSON Lines file, and `run_dir` to a new private run directory on the workspace disk. Keep the file hashes. Use the publications agent’s schema and cross-file validator for a complete export. For a weekly delta, validate the integrated export including existing version targets, then retain the reviewed additions and changes as the batch. The loader consumes public projections only.

   ```sh
   data_tree=/workspace/path/to/accepted-publications-checkout
   batch="$data_tree/src/content/public-directory-publications.jsonl"
   run_dir=$(mktemp -d /workspace/tmp/builderbob/tvd-import.XXXXXXXX)
   registry="$data_tree/src/content/public-directory-institutions.json"
   removals="$data_tree/src/content/public-directory-publications-removals.json"
   python3 "$data_tree/scripts/publications/validate.py" "$batch"
   sha256sum "$batch" "$registry" "$removals" src/content/public-directory-projects.json > "$run_dir/input.sha256"
   python3 ops/load-research.py --removals "$removals" > "$run_dir/removals.sql"
   python3 ops/load-research.py --institutions "$registry" --projects src/content/public-directory-projects.json --publications "$batch" > "$run_dir/import.sql"
   split -l 1000 -d -a 6 "$run_dir/import.sql" "$run_dir/part-"
   ```

   Continue only after each command succeeds. The loader emits one upsert per listing. Exceptionally long bylines are staged in content-addressed chunks and assembled in the final upsert. Replay the batch after an interruption to finish and clear its staging rows. SQLite triggers update full text and all relationships within that statement. `--projects` takes the **complete** project projection, including when refreshing it alongside a new Worker bundle. It prunes obsolete project search rows. `--publications` takes either a full file or a delta. Absence from a publication batch has no deletion effect. `--removals` only adds tombstones. Replaying an older batch cannot clear one.

4. **Rehearse, then import.** First apply the same migration and files with `--local --persist-to "$run_dir/local-d1"` and compare counts with the reviewed records. In production, apply removals first. Sequential files bound import windows and make a failed part replayable. Keep production receipts private and inspect success and usage after each part. Remote file imports may temporarily interrupt database queries. Schedule large backfills in bounded windows compatible with the existing database's other consumers.

   ```sh
   if test -s "$run_dir/removals.sql"; then
     npx --no-install wrangler d1 execute the-valley-desk --remote --file "$run_dir/removals.sql" || exit 1
   fi
   for part in "$run_dir"/part-[0-9][0-9][0-9][0-9][0-9][0-9]; do
     npx --no-install wrangler d1 execute the-valley-desk --remote --file "$part" > "$part.receipt" || exit 1
   done
   npx --no-install wrangler d1 execute the-valley-desk --remote --command "SELECT kind,count(*) AS records,count(DISTINCT group_id) AS works FROM research_visible GROUP BY kind"
   npx --no-install wrangler d1 execute the-valley-desk --remote --command "SELECT count(*) AS matched FROM research_search WHERE research_search MATCH 'imaging'"
   npx --no-install wrangler d1 info the-valley-desk
   ```

   On a retry select only the numbered SQL files, for example `part-[0-9][0-9][0-9][0-9][0-9][0-9]`. Check the project count against the bundled projection minus removals, publication records against the pilot minus removals, and work totals against its grouped versions. Compare full-text matches with an equivalent local query. Verify an exact DOI, a no-DOI record, an affiliation source, a regional site, and a version pair if present. Check remaining space and row quotas.

5. **Expose publications through a separately approved Worker release.** Set `PUBLICATIONS_PUBLIC_ENABLED` to the string `"true"` in the reviewed release configuration. Check the published home, an institution and county, both detail routes, feeds, API, sitemap index and a part. Verify the served version and the configured production flags, including the editorial automation hold. If exposure needs to be withdrawn, release the same Worker with the publication flag false. Preserve the database and removal tables.

6. **Apply a weekly batch.** Repeat steps 3 and 4 in a fresh run directory. Generate `import.sql` with `--institutions "$registry" --publications "$batch"`. Include the complete project projection only when its source or institution mappings change. Compare the reviewed additions, changed records and removals with before/after counts. Recheck a changed record’s original `added` date, latest `checked` date and search terms. Review the actual D1 row metrics against the [measured batch](research-directory.md).

For an urgent publication removal, put the exact ID in a one-element JSON array, generate SQL with `python3 ops/load-research.py --removals removed.json`, inspect the quoted ID, then apply that file to the target database. Verify HTTP 410 on the HTML and JSON detail URLs and absence from the listing API, feeds and sitemap part. The Worker returns 503 if the required removal state becomes unreadable. Restore readable removal state before resuming reads.
