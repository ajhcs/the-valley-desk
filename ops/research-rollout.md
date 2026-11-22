# Research directory rollout

These commands are for the release operator. Local verification used an isolated D1 simulator. The production database, account plan, available space and Worker deployment require separate checks. Work from the reviewed site revision and the accepted publications revision. Run Node tools with the repository-supported Node runtime. On BuilderBob, use Node 24.22.0.

1. **Check the target and capacity.** Confirm the binding is `VALLEY_DESK_DB` on `the-valley-desk`, the deployed publication flag is false, and the account and database IDs match the release target. Read the plan, current database size and account usage in the D1 dashboard. **Stop here on Workers Free.** Production already occupies about 489 MiB according to the operator. The Free limit is 500 MB per database. Proceed only after the operator confirms paid capacity, checks a local import of the actual records, and allows headroom for other consumers and weekly updates. [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

   **Plan for about 563 MiB after a 30,000-paper year.** Including the post-load filter index and planner statistics, the project-only research database occupied 6,578,176 bytes in the local fixture. With the same 3,466 projects and 200,000 papers it occupied 477,491,200 bytes. The difference is about 2,355 bytes per additional paper. Starting at 489 MiB, allow 6.3 MiB for the project index and 67.4 MiB for 30,000 papers. This estimate uses synthetic bylines and excludes additional growth in other tables.

   Record the current Worker version and a Time Travel bookmark. List pending migrations using the normal checkout configuration. For the reported production ledger ending at 0040, expect 0041 through 0046. Stop and reconcile unexpected schema or ledger state.

   ```sh
   npx --no-install wrangler d1 info the-valley-desk
   npx --no-install wrangler d1 time-travel info the-valley-desk
   npx --no-install wrangler d1 migrations list the-valley-desk --remote
   ```

2. **Apply 0046 alone.** The research migration creates its own tables, indexes and triggers. Its visibility view reads the existing project-removal table. Discovery migrations 0041–0045 have no role in this schema. Prepare a temporary migration directory with the reviewed configuration and just the original 0046 filename. Wrangler uses that filename in the target database’s normal migration ledger. Run from the reviewed checkout root.

   ```sh
   release_dir=$(mktemp -d /workspace/tmp/builderbob/tvd-0046.XXXXXXXX)
   mkdir "$release_dir/migrations"
   cp wrangler.jsonc "$release_dir/"
   cp migrations/0046_research_directory.sql "$release_dir/migrations/"
   npx --no-install wrangler d1 migrations list the-valley-desk --remote --config "$release_dir/wrangler.jsonc"
   ```

   Continue only if this scoped list contains exactly `0046_research_directory.sql`. Ensure project removals exist using the idempotent SQL file. Read the count, then apply with the **same scoped config**.

   ```sh
   npx --no-install wrangler d1 execute the-valley-desk --remote --file ops/directory-removals.sql
   npx --no-install wrangler d1 execute the-valley-desk --remote --command "SELECT count(*) AS project_removals FROM public_directory_removals"
   npx --no-install wrangler d1 migrations apply the-valley-desk --remote --config "$release_dir/wrangler.jsonc"
   ```

   Check the ledger and pending list from the original checkout. Expect the 0046 filename once, with 0041–0045 still pending. Both removal queries must succeed and the new research index should be empty before loading. If a command is interrupted, inspect the ledger, schema and scoped pending list before retrying.

   ```sh
   npx --no-install wrangler d1 execute the-valley-desk --remote --command "SELECT name FROM d1_migrations WHERE name >= '0040' ORDER BY name"
   npx --no-install wrangler d1 migrations list the-valley-desk --remote
   npx --no-install wrangler d1 execute the-valley-desk --remote --command "SELECT count(*) AS publication_removals FROM publication_removals"
   npx --no-install wrangler d1 execute the-valley-desk --remote --command "SELECT kind,count(*) AS records FROM research_visible GROUP BY kind"
   ```

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

   After the initial import, create the covering index and collect statistics on the populated listings table. Run the same checks locally during rehearsal. The filtered search works throughout the import. Check that the plan shows `USING COVERING INDEX research_filter_order` on the scale rehearsal. On production data the planner can choose a different path based on the distribution of the actual records.

   ```sh
   npx --no-install wrangler d1 execute the-valley-desk --remote --file ops/research-filter-index.sql
   npx --no-install wrangler d1 execute the-valley-desk --remote --file ops/research-summary.sql
   npx --no-install wrangler d1 execute the-valley-desk --remote --command "EXPLAIN QUERY PLAN SELECT id,kind,group_id,added FROM research_visible WHERE id IN (SELECT id FROM research_facets WHERE field='institution' AND value='drexel-university' INTERSECT SELECT id FROM research_facets WHERE field='county' AND value='philadelphia')"
   npx --no-install wrangler d1 info the-valley-desk
   ```

5. **Expose publications through a separately approved Worker release.** Set `PUBLICATIONS_PUBLIC_ENABLED` to the string `"true"` in the reviewed release configuration. Check the published home, an institution and county, both detail routes, feeds, API, sitemap index and a part. Verify the served version and the configured production flags, including the editorial automation hold. If exposure needs to be withdrawn, release the same Worker with the publication flag false. Preserve the database and removal tables.

6. **Apply a weekly batch.** Repeat the validation and import in steps 3 and 4 in a fresh run directory. SQLite maintains the covering index on each write. Repeat the statistics and plan check after a large change in volume or distribution. Generate `import.sql` with `--institutions "$registry" --publications "$batch"`. Include the complete project projection only when its source or institution mappings change. Compare the reviewed additions, changed records and removals with before/after counts. Recheck a changed record’s original `added` date, latest `checked` date and search terms. Review the actual D1 row metrics against the [measured batch](research-directory.md).

For an urgent publication removal, put the exact ID in a one-element JSON array, generate SQL with `python3 ops/load-research.py --removals removed.json`, inspect the quoted ID, then apply that file to the target database. Verify HTTP 410 on the HTML and JSON detail URLs and absence from the listing API, feeds and sitemap part. The Worker returns 503 if the required removal state becomes unreadable. Restore readable removal state before resuming reads.
